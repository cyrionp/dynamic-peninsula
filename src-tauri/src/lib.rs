mod airpods;
mod audio;
mod media;
mod taskbar;
mod volume;

use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, State, WebviewWindow, Wry,
};

/// If the frontend hasn't placed and shown the window by then, show it at the
/// top-center so the peninsula never stays invisible.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// How often the cursor is checked for click-through. Cheap: one syscall.
const HIT_TEST_INTERVAL: Duration = Duration::from_millis(40);

/// The painted part of a window in CSS pixels, reported by its page.
/// Everything outside it lets clicks fall through to the apps underneath.
#[derive(Clone, Copy, Default, serde::Deserialize)]
struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// One painted area per window: the peninsula ("main") and the taskbar dock.
#[derive(Default)]
struct HitState(Mutex<HashMap<String, HitRect>>);

/// The windows whose transparent parts let clicks through.
const HIT_WINDOWS: [&str; 2] = ["main", taskbar::DOCK];

/// Locked: the window ignores the mouse, so the apps underneath get every
/// click. Only the tray menu can unlock it again.
#[derive(Default)]
struct LockState(AtomicBool);

/// While locked, the spots that still take clicks: the media buttons on the
/// bar, if the user allows them. Empty means the whole window ignores the
/// mouse. Reported by the frontend, in CSS pixels like `HitRect`.
#[derive(Default)]
struct LockHoles(Mutex<Vec<HitRect>>);

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }
}

/// The tray's lock item, kept so its tick follows the lock from either side.
struct LockItem(CheckMenuItem<Wry>);

/// The tray's taskbar dock item, likewise.
struct DockItem(CheckMenuItem<Wry>);

fn set_lock(app: &AppHandle, locked: bool) {
    app.state::<LockState>().0.store(locked, Ordering::Relaxed);
    if let Some(item) = app.try_state::<LockItem>() {
        let _ = item.0.set_checked(locked);
    }
    let _ = app.emit("lock-changed", locked);
}

#[tauri::command]
fn set_locked(locked: bool, app: AppHandle) {
    set_lock(&app, locked);
}

#[tauri::command]
fn set_hit_rect(rect: HitRect, window: WebviewWindow, state: State<'_, HitState>) {
    if let Ok(mut r) = state.0.lock() {
        r.insert(window.label().to_string(), rect);
    }
}

#[tauri::command]
fn set_lock_holes(rects: Vec<HitRect>, state: State<'_, LockHoles>) {
    if let Ok(mut r) = state.0.lock() {
        *r = rects;
    }
}

/// Taskbar dock (experimental) on or off; the Settings switch and the tray
/// item both end up here. Async so creating its window doesn't block.
#[tauri::command]
async fn set_dock_enabled(enabled: bool, app: AppHandle) {
    taskbar::set_enabled(&app, enabled);
    if let Some(item) = app.try_state::<DockItem>() {
        let _ = item.0.set_checked(enabled);
    }
}

#[tauri::command]
fn dock_status() -> taskbar::DockStatus {
    taskbar::status()
}

/// The taskbar's size and look, for the dock page as it loads.
#[tauri::command]
fn dock_layout() -> Option<taskbar::DockLayout> {
    taskbar::layout()
}

/// A click on the dock: open the peninsula on that page.
#[tauri::command]
fn dock_open(page: String, app: AppHandle) {
    show_main(&app);
    let _ = app.emit_to("main", "dock://open", page);
}

#[tauri::command]
fn media_state() -> media::MediaState {
    media::snapshot()
}

// Async so the blocking WinRT call runs off the main (UI) thread.
#[tauri::command]
async fn media_control(action: String) -> Result<(), String> {
    media::control(&action)
}

#[tauri::command]
async fn media_seek(position_ms: u64) -> Result<(), String> {
    media::seek(position_ms)
}

/// Mouse wheel over the bar: moves the system volume by `delta` (0.0 – 1.0).
#[tauri::command]
async fn volume_step(delta: f32) -> Result<volume::Volume, String> {
    volume::step(delta)
}

#[tauri::command]
fn audio_devices() -> audio::AudioState {
    audio::snapshot()
}

#[tauri::command]
async fn audio_set_default(id: String) -> Result<(), String> {
    audio::set_default(&id)
}

#[tauri::command]
fn airpods_state() -> Option<airpods::Pods> {
    airpods::snapshot()
}

/// Places the window at the top-center of the primary monitor. Only a
/// fallback: the frontend normally places it where the user left it.
fn position_top_center(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window.primary_monitor()?.or(window.current_monitor()?);

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        let width = window.outer_size()?.to_logical::<f64>(window.scale_factor()?).width;
        let x = origin.x + (size.width - width) / 2.0;
        window.set_position(LogicalPosition::new(x, origin.y))?;
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    }
}

fn spawn_show_fallback(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_FALLBACK);
        if let Some(window) = app.get_webview_window("main") {
            if !window.is_visible().unwrap_or(true) {
                let _ = position_top_center(&window);
                show_main(&app);
            }
        }
    });
}

/// Lets clicks pass through the transparent part of the window: while the
/// cursor is outside the painted peninsula, the window ignores the mouse.
fn spawn_click_through(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut ignoring: HashMap<&str, bool> = HashMap::new();
        loop {
            std::thread::sleep(HIT_TEST_INTERVAL);
            let Ok(cursor) = app.cursor_position() else {
                continue;
            };
            for label in HIT_WINDOWS {
                let Some(window) = app.get_webview_window(label) else {
                    ignoring.remove(label);
                    continue;
                };
                let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
                    continue;
                };
                let rect = app
                    .state::<HitState>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|r| r.get(label).copied())
                    .unwrap_or_default();

                let x = (cursor.x - origin.x as f64) / scale;
                let y = (cursor.y - origin.y as f64) / scale;
                // The lock is the peninsula's; the dock always takes clicks.
                let locked = label == "main" && app.state::<LockState>().0.load(Ordering::Relaxed);
                // Locked, only the allowed holes (the media buttons) take clicks.
                let inside = if locked {
                    app.state::<LockHoles>()
                        .0
                        .lock()
                        .map(|holes| holes.iter().any(|h| h.contains(x, y)))
                        .unwrap_or(false)
                } else {
                    rect.contains(x, y)
                };
                let ignore = !inside;
                if ignoring.get(label) != Some(&ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
                    ignoring.insert(label, ignore);
                }
            }
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", "Lock (click-through)", true, false, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "Move to top center", true, None::<&str>)?;
    let dock = CheckMenuItem::with_id(app, "dock", "Taskbar dock (experimental)", true, false, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &lock, &center, &dock, &exit])?;
    app.manage(LockItem(lock));
    app.manage(DockItem(dock));

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Dynamic Peninsula")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "lock" => {
                let locked = app.state::<LockState>().0.load(Ordering::Relaxed);
                set_lock(app, !locked);
            }
            "center" => {
                show_main(app);
                let _ = app.emit("reset-position", ());
            }
            // The setting lives in the peninsula's Settings; it switches
            // the dock and saves the choice.
            "dock" => {
                let _ = app.emit_to("main", "dock://toggle", ());
            }
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A left click on the tray icon brings the peninsula back too.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(HitState::default())
        .manage(LockState::default())
        .manage(LockHoles::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            set_locked,
            set_lock_holes,
            set_dock_enabled,
            dock_status,
            dock_layout,
            dock_open,
            media_state,
            media_control,
            media_seek,
            volume_step,
            audio_devices,
            audio_set_default,
            airpods_state
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = position_top_center(&window);
            }
            spawn_show_fallback(app.handle());
            spawn_click_through(app.handle());
            media::init(app.handle());
            audio::init(app.handle());
            airpods::init(app.handle());
            taskbar::init(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dynamic Peninsula");
}
