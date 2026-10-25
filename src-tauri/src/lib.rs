mod media;

use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, Manager, State, WebviewWindow,
};

/// Logical width of the peninsula window; must match `tauri.conf.json`.
const WINDOW_WIDTH: f64 = 520.0;

/// How often the cursor is checked for click-through. Cheap: one syscall.
const HIT_TEST_INTERVAL: Duration = Duration::from_millis(40);

/// The painted part of the window in CSS pixels, reported by the frontend.
/// Everything outside it lets clicks fall through to the apps underneath.
#[derive(Clone, Copy, Default, serde::Deserialize)]
struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Default)]
struct HitState(Mutex<HitRect>);

#[tauri::command]
fn set_hit_rect(rect: HitRect, state: State<'_, HitState>) {
    if let Ok(mut r) = state.0.lock() {
        *r = rect;
    }
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

/// Places the window at the top-center of the primary monitor.
fn position_top_center(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window.primary_monitor()?.or(window.current_monitor()?);

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        let x = origin.x + (size.width - WINDOW_WIDTH) / 2.0;
        window.set_position(LogicalPosition::new(x, origin.y))?;
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = position_top_center(&window);
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    }
}

/// Lets clicks pass through the transparent part of the window: while the
/// cursor is outside the painted peninsula, the window ignores the mouse.
fn spawn_click_through(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            std::thread::sleep(HIT_TEST_INTERVAL);
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            let (Ok(cursor), Ok(origin), Ok(scale)) = (
                app.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let rect = app
                .state::<HitState>()
                .0
                .lock()
                .map(|r| *r)
                .unwrap_or_default();

            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;
            let inside = x >= rect.x
                && x <= rect.x + rect.width
                && y >= rect.y
                && y <= rect.y + rect.height;

            let ignore = !inside;
            if ignoring != Some(ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
                ignoring = Some(ignore);
            }
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Dynamic Peninsula")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
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
        .manage(HitState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            media_state,
            media_control
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            show_main(app.handle());
            spawn_click_through(app.handle());
            media::init(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dynamic Peninsula");
}
