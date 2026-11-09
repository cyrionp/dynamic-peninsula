//! The taskbar dock (experimental): a second, small window that sits on the
//! empty left part of the Windows 11 taskbar when its icons are centred.
//!
//! Windows 11 has no API for adding things to the taskbar (deskbands are
//! gone), so the dock is an ordinary always-on-top window laid over the
//! taskbar. This module keeps it there:
//!
//! - measures the free space between the left edge (or the Widgets button)
//!   and the Start button, through UI Automation;
//! - keeps the dock above the taskbar, which raises itself whenever it is
//!   clicked;
//! - hides the dock while the taskbar is auto-hidden, while something runs
//!   full screen, and while Start, search or Task View is open;
//! - tells the dock window the taskbar's height and the system's light or
//!   dark look and accent colour, so it can match the taskbar.
//!
//! Only the primary monitor's taskbar is used. Explorer restarting needs no
//! special care: the taskbar is looked up again on every pass.

use serde::Serialize;

/// Label of the dock window.
pub const DOCK: &str = "dock";
/// Sent to every window when the dock can or can't be used any more.
pub const STATUS_EVENT: &str = "dock://status";
/// Sent to the dock window when the taskbar's size or look changes.
pub const LAYOUT_EVENT: &str = "dock://layout";

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockStatus {
    /// The user switched the dock on.
    pub enabled: bool,
    /// This system can show it (Windows 11, centred taskbar at the bottom).
    pub available: bool,
    /// Why not, when it can't; in words for the Settings page.
    pub reason: Option<String>,
    /// It is on the taskbar right now.
    pub showing: bool,
    /// Why it is tucked away for the moment (full screen, Start open…).
    pub note: Option<String>,
}

/// What the dock page needs to look like the taskbar.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockLayout {
    /// The taskbar's height in CSS pixels.
    pub height: f64,
    /// The free width the dock may use, in CSS pixels.
    pub width: f64,
    /// The taskbar is light (Windows mode "light").
    pub light: bool,
    /// The Windows accent colour, "#rrggbb".
    pub accent: String,
    /// Windows' "Transparency effects" switch.
    pub transparency: bool,
}

#[cfg(windows)]
pub use windows_impl::{init, layout, set_enabled, status};

#[cfg(not(windows))]
mod fallback {
    use super::DockStatus;
    use tauri::AppHandle;

    pub fn init(_app: &AppHandle) {}

    pub fn layout() -> Option<super::DockLayout> {
        None
    }

    pub fn set_enabled(_app: &AppHandle, _on: bool) {}

    pub fn status() -> DockStatus {
        DockStatus {
            enabled: false,
            available: false,
            reason: Some("The taskbar dock needs Windows 11.".into()),
            ..Default::default()
        }
    }
}

#[cfg(not(windows))]
pub use fallback::{init, layout, set_enabled, status};

#[cfg(windows)]
mod windows_impl {
    use super::{DockLayout, DockStatus, DOCK, LAYOUT_EVENT, STATUS_EVENT};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{
        AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
        WebviewWindowBuilder,
    };
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_AutomationIdPropertyId,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        SHAppBarMessage, SHQueryUserNotificationState, ABM_GETSTATE, ABS_AUTOHIDE, APPBARDATA,
        QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
        GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GW_HWNDPREV, HWND_TOPMOST,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    /// How often the dock's place and z-order are checked. Short, because
    /// the taskbar covers the dock as soon as it is clicked.
    const TICK: Duration = Duration::from_millis(100);
    /// How often the taskbar's buttons are measured (UI Automation is the
    /// slow part), unless the taskbar itself moved or resized.
    const MEASURE_EVERY: Duration = Duration::from_millis(1000);
    /// Room left between the dock and the buttons beside it, in CSS pixels.
    const GAP: f64 = 8.0;
    /// When the Start button can't be found: this much from the left.
    const FALLBACK_WIDTH: f64 = 300.0;
    /// Less room than this and the dock stays hidden.
    const MIN_WIDTH: f64 = 96.0;

    static ENABLED: AtomicBool = AtomicBool::new(false);
    static STATUS: Mutex<Option<DockStatus>> = Mutex::new(None);
    /// Why the dock window couldn't be opened, if it couldn't.
    static OPEN_ERROR: Mutex<Option<String>> = Mutex::new(None);
    /// The last layout sent, for a dock page that loads after it was sent.
    static LAYOUT: Mutex<Option<DockLayout>> = Mutex::new(None);

    pub fn layout() -> Option<DockLayout> {
        LAYOUT.lock().ok().and_then(|l| l.clone())
    }

    pub fn status() -> DockStatus {
        STATUS
            .lock()
            .ok()
            .and_then(|s| s.clone())
            .unwrap_or_else(|| DockStatus {
                enabled: ENABLED.load(Ordering::Relaxed),
                available: true,
                ..Default::default()
            })
    }

    fn set_status(app: &AppHandle, next: DockStatus) {
        let Ok(mut cur) = STATUS.lock() else { return };
        if cur.as_ref() == Some(&next) {
            return;
        }
        *cur = Some(next.clone());
        drop(cur);
        let _ = app.emit(STATUS_EVENT, next);
    }

    /// Switches the dock on or off: creates its window, or closes it so it
    /// costs nothing while off.
    pub fn set_enabled(app: &AppHandle, on: bool) {
        ENABLED.store(on, Ordering::Relaxed);
        let existing = app.get_webview_window(DOCK);
        if on && existing.is_none() {
            let built = WebviewWindowBuilder::new(app, DOCK, WebviewUrl::App("dock.html".into()))
                .title("Dynamic Peninsula dock")
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .shadow(false)
                .focused(false)
                .focusable(false)
                .visible(false)
                .inner_size(FALLBACK_WIDTH, 48.0)
                .build();
            if let Ok(mut err) = OPEN_ERROR.lock() {
                *err = built
                    .as_ref()
                    .err()
                    .map(|e| format!("Couldn't open the dock window: {e}"));
            }
            if let Ok(window) = built {
                if let Ok(hwnd) = window.hwnd() {
                    // Never in Alt+Tab, never takes the keyboard focus.
                    let hwnd = HWND(hwnd.0 as _);
                    unsafe {
                        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                        SetWindowLongPtrW(
                            hwnd,
                            GWL_EXSTYLE,
                            ex | (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize,
                        );
                    }
                }
            }
        } else if !on {
            if let Some(window) = existing {
                let _ = window.destroy();
            }
        }
        let mut s = status();
        s.enabled = on;
        set_status(app, s);
    }

    pub fn init(app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || run(app));
    }

    /// Where the dock goes, in physical pixels, and how it should look.
    #[derive(Clone, PartialEq)]
    struct Place {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        layout: DockLayout,
    }

    enum Verdict {
        /// Show it here.
        Show(Place),
        /// Hide it for now (auto-hidden taskbar, full screen, Start open…),
        /// and why, for Settings.
        Hide(&'static str),
        /// It can't work on this setup; the reason goes to Settings.
        Unavailable(String),
    }

    /// Bounds of the Start and Widgets buttons, measured now and then.
    #[derive(Default)]
    struct Buttons {
        start: Option<RECT>,
        widgets: Option<RECT>,
        taskbar: RECT,
        at: Option<Instant>,
    }

    fn run(app: AppHandle) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let uia: Option<IUIAutomation> =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };
        let mut buttons = Buttons::default();
        let mut shown: Option<Place> = None;
        let mut visible = false;

        loop {
            std::thread::sleep(TICK);
            let Some(window) = app.get_webview_window(DOCK) else {
                shown = None;
                visible = false;
                // Still keep Settings told whether it could be switched on.
                let reason = match check_setup() {
                    Verdict::Unavailable(reason) => Some(reason),
                    _ => None,
                };
                let enabled = ENABLED.load(Ordering::Relaxed);
                let note = enabled
                    .then(|| OPEN_ERROR.lock().ok().and_then(|e| e.clone()))
                    .flatten();
                set_status(
                    &app,
                    DockStatus {
                        enabled,
                        available: reason.is_none(),
                        reason,
                        note,
                        ..Default::default()
                    },
                );
                std::thread::sleep(MEASURE_EVERY);
                continue;
            };

            let verdict = match check_setup() {
                Verdict::Show(_) => measure(uia.as_ref(), &mut buttons),
                other => other,
            };
            let enabled = ENABLED.load(Ordering::Relaxed);
            match verdict {
                Verdict::Unavailable(reason) => {
                    set_status(
                        &app,
                        DockStatus {
                            enabled,
                            available: false,
                            reason: Some(reason),
                            ..Default::default()
                        },
                    );
                    if visible {
                        let _ = window.hide();
                        visible = false;
                    }
                }
                Verdict::Hide(why) => {
                    set_status(
                        &app,
                        DockStatus {
                            enabled,
                            available: true,
                            note: Some(why.into()),
                            ..Default::default()
                        },
                    );
                    if visible {
                        let _ = window.hide();
                        visible = false;
                    }
                }
                Verdict::Show(place) => {
                    set_status(
                        &app,
                        DockStatus {
                            enabled,
                            available: true,
                            showing: true,
                            ..Default::default()
                        },
                    );
                    if shown.as_ref() != Some(&place) {
                        let moved = shown.as_ref().map_or(true, |s| {
                            (s.x, s.y, s.width, s.height)
                                != (place.x, place.y, place.width, place.height)
                        });
                        if moved {
                            let _ = window.set_size(PhysicalSize::new(place.width, place.height));
                            let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
                        }
                        if let Ok(mut last) = LAYOUT.lock() {
                            *last = Some(place.layout.clone());
                        }
                        let _ = window.emit_to(DOCK, LAYOUT_EVENT, place.layout.clone());
                        shown = Some(place);
                    }
                    if !visible {
                        let _ = window.show();
                        visible = true;
                    }
                    if let Ok(hwnd) = window.hwnd() {
                        keep_above_taskbar(HWND(hwnd.0 as _));
                    }
                }
            }
        }
    }

    /// The parts that don't need measuring: Windows 11, a centred taskbar
    /// at the bottom of the primary screen, and nothing covering it.
    fn check_setup() -> Verdict {
        if windows_build() < 22000 {
            return Verdict::Unavailable("The taskbar dock needs Windows 11.".into());
        }
        if read_dword(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced"),
            w!("TaskbarAl"),
        ) == Some(0)
        {
            return Verdict::Unavailable("Your taskbar icons are aligned left, so there's no free space. Centre them in Windows Settings › Personalisation › Taskbar.".into());
        }
        let Some(taskbar) = taskbar() else {
            return Verdict::Hide("The taskbar can't be found (Explorer may be restarting).");
        };
        let (Some(tb), Some(monitor)) = (rect_of(taskbar), monitor_rect(taskbar)) else {
            return Verdict::Hide("The taskbar can't be measured.");
        };
        let height = tb.bottom - tb.top;
        if tb.top < monitor.top + (monitor.bottom - monitor.top) / 2
            || tb.right - tb.left < (monitor.right - monitor.left) / 2
        {
            return Verdict::Unavailable(
                "The taskbar dock needs the taskbar at the bottom of the screen.".into(),
            );
        }
        // Auto-hide slides it down until only a sliver shows.
        if autohide() && monitor.bottom - tb.top < height * 9 / 10 {
            return Verdict::Hide("The taskbar is auto-hidden; it comes back with it.");
        }
        if let Some(why) = covered() {
            return Verdict::Hide(why);
        }
        Verdict::Show(Place {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            layout: DockLayout::default(),
        })
    }

    fn measure(uia: Option<&IUIAutomation>, buttons: &mut Buttons) -> Verdict {
        let Some(taskbar) = taskbar() else {
            return Verdict::Hide("The taskbar can't be found (Explorer may be restarting).");
        };
        let Some(tb) = rect_of(taskbar) else {
            return Verdict::Hide("The taskbar can't be measured.");
        };
        let scale = unsafe { GetDpiForWindow(taskbar) }.max(96) as f64 / 96.0;

        let stale =
            buttons.at.map_or(true, |at| at.elapsed() >= MEASURE_EVERY) || buttons.taskbar != tb;
        if stale {
            buttons.taskbar = tb;
            buttons.at = Some(Instant::now());
            buttons.start = uia.and_then(|u| find_button(u, taskbar, "StartButton"));
            buttons.widgets = uia.and_then(|u| find_button(u, taskbar, "WidgetsButton"));
        }

        let gap = (GAP * scale).round() as i32;
        let centre = tb.left + (tb.right - tb.left) / 2;
        // Widgets sits at the far left when it is on; start right of it.
        let left = match buttons.widgets {
            Some(w) if w.right <= centre && w.right > tb.left => w.right + gap,
            _ => tb.left + gap,
        };
        let right = match buttons.start {
            Some(s) if s.left > left && s.left <= centre => s.left - gap,
            _ => left + (FALLBACK_WIDTH * scale).round() as i32,
        };
        let width = right - left;
        if (width as f64) < MIN_WIDTH * scale {
            return Verdict::Hide("There's too little room left of the taskbar icons.");
        }

        let height = tb.bottom - tb.top;
        let layout = DockLayout {
            height: height as f64 / scale,
            width: width as f64 / scale,
            light: read_dword(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
                w!("SystemUsesLightTheme"),
            ) == Some(1),
            accent: accent_colour(),
            transparency: read_dword(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
                w!("EnableTransparency"),
            ) != Some(0),
        };
        Verdict::Show(Place {
            x: left,
            y: tb.top,
            width: width as u32,
            height: height as u32,
            layout,
        })
    }

    fn taskbar() -> Option<HWND> {
        unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()).ok() }.filter(|h| !h.is_invalid())
    }

    fn rect_of(hwnd: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut r) }.ok().map(|_| r)
    }

    fn monitor_rect(hwnd: HWND) -> Option<RECT> {
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(monitor, &mut info)
                .as_bool()
                .then_some(info.rcMonitor)
        }
    }

    fn autohide() -> bool {
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            ..Default::default()
        };
        let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) };
        state as u32 & ABS_AUTOHIDE != 0
    }

    fn class_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    /// Something that should have the bottom of the screen to itself: a
    /// full-screen game, video or presentation, or Start, search, Task
    /// View, Widgets and the like (shell flyouts).
    fn covered() -> Option<&'static str> {
        // Only the clear cases: a Direct3D game, or presentation mode.
        // QUNS_BUSY is left out on purpose, so a wrong "busy" can't keep
        // the dock away; full-screen windows are caught below instead.
        if let Ok(state) = unsafe { SHQueryUserNotificationState() } {
            if [QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE].contains(&state) {
                return Some("A full-screen app or presentation is running.");
            }
        }
        let fg = unsafe { GetForegroundWindow() };
        if fg.is_invalid() {
            return None;
        }
        let class = class_of(fg);
        if matches!(
            class.as_str(),
            "Windows.UI.Core.CoreWindow"
                | "XamlExplorerHostIslandWindow"
                | "MultitaskingViewFrame"
                | "TaskSwitcherWnd"
        ) {
            return Some("Start, search or Task View is open.");
        }
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
            return None;
        }
        // A borderless window covering the taskbar's whole screen
        // (a video or a browser in F11).
        let screen = taskbar().and_then(monitor_rect)?;
        match (rect_of(fg), monitor_rect(fg)) {
            (Some(w), Some(m))
                if m == screen
                    && w.left <= m.left
                    && w.top <= m.top
                    && w.right >= m.right
                    && w.bottom >= m.bottom =>
            {
                Some("A full-screen window is in front.")
            }
            _ => None,
        }
    }

    /// The taskbar raises itself when clicked; put the dock back on top of
    /// it, without taking the focus. Only touches the z-order when the
    /// taskbar really is above the dock.
    fn keep_above_taskbar(dock: HWND) {
        let Some(taskbar) = taskbar() else { return };
        let mut above = dock;
        let mut taskbar_above = false;
        for _ in 0..512 {
            match unsafe { GetWindow(above, GW_HWNDPREV) } {
                Ok(h) if !h.is_invalid() => {
                    if h == taskbar {
                        taskbar_above = true;
                        break;
                    }
                    above = h;
                }
                _ => break,
            }
        }
        if taskbar_above {
            unsafe {
                let _ = SetWindowPos(
                    dock,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
        }
    }

    fn find_button(uia: &IUIAutomation, taskbar: HWND, id: &str) -> Option<RECT> {
        unsafe {
            let root = uia.ElementFromHandle(taskbar).ok()?;
            let condition = uia
                .CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from(id))
                .ok()?;
            let element = root.FindFirst(TreeScope_Descendants, &condition).ok()?;
            let r = element.CurrentBoundingRectangle().ok()?;
            (r.right > r.left).then_some(r)
        }
    }

    fn read_dword(key: HKEY, sub: PCWSTR, name: PCWSTR) -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let err = unsafe {
            RegGetValueW(
                key,
                sub,
                name,
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut _),
                Some(&mut size),
            )
        };
        err.is_ok().then_some(value)
    }

    fn windows_build() -> u32 {
        let mut buf = [0u16; 32];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let err = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
                w!("CurrentBuildNumber"),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
        };
        if err.is_err() {
            // Can't tell: let it try.
            return u32::MAX;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
            .trim()
            .parse()
            .unwrap_or(u32::MAX)
    }

    /// The accent colour Windows paints the taskbar's highlights with.
    /// Stored as 0xAABBGGRR.
    fn accent_colour() -> String {
        let abgr = read_dword(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\DWM"),
            w!("AccentColor"),
        )
        .unwrap_or(0xffd77800);
        let (r, g, b) = (abgr & 0xff, (abgr >> 8) & 0xff, (abgr >> 16) & 0xff);
        format!("#{r:02x}{g:02x}{b:02x}")
    }
}
