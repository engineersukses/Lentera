mod glass;
mod lyrics;
mod system;

use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Area di jendela (dalam piksel CSS) yang boleh menerima klik.
/// Di luar area ini, klik "tembus" ke aplikasi di bawahnya.
#[derive(Deserialize, Clone, Copy, Default)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct Interactive(Mutex<Vec<Rect>>);

#[tauri::command]
fn set_interactive(rects: Vec<Rect>, state: State<Interactive>) {
    *state.0.lock().unwrap() = rects;
}

// Panggilan WinRT bersifat blocking, jadi dijalankan di thread terpisah
// supaya tampilan tidak tersendat.
async fn blocking<T: Send + Default + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f).await.unwrap_or_default()
}

#[tauri::command]
async fn media_info() -> system::MediaInfo {
    blocking(system::media_info).await
}

#[tauri::command]
async fn media_control(action: String) {
    blocking(move || system::media_control(&action)).await
}

#[tauri::command]
async fn media_seek(position_ms: i64) {
    blocking(move || system::media_seek(position_ms)).await
}

#[tauri::command]
fn idle_ms() -> u64 {
    system::idle_ms()
}

#[tauri::command]
async fn system_status() -> system::SystemStatus {
    blocking(system::system_status).await
}

#[tauri::command]
async fn notifications_poll(app: AppHandle) -> system::NotificationPoll {
    blocking(move || system::notifications_poll(&app.state::<system::NotificationState>())).await
}

#[tauri::command]
async fn fetch_lyrics(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> Option<lyrics::Lyrics> {
    blocking(move || lyrics::fetch(&title, &artist, &album, duration)).await
}

/// Ambil JSON dari layanan jadwal sholat. Hanya host tertentu yang diizinkan.
#[tauri::command]
async fn http_json(url: String) -> Result<serde_json::Value, String> {
    const ALLOWED: [&str; 2] = ["https://api.myquran.com/", "https://api.aladhan.com/"];
    if !ALLOWED.iter().any(|h| url.starts_with(h)) {
        return Err("host not allowed".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        lyrics::agent()
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?
            .into_json::<serde_json::Value>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Default)]
struct Glass(Mutex<(bool, Vec<glass::Shape>)>);

/// Hidupkan/matikan kaca buram dan potong jendela mengikuti notch.
#[tauri::command]
fn set_glass(on: bool, shapes: Vec<glass::Shape>, window: WebviewWindow, state: State<Glass>) {
    let mut cur = state.0.lock().unwrap();
    let changed_on = cur.0 != on;
    if !changed_on && cur.1 == shapes {
        return;
    }
    #[cfg(windows)]
    if let (Ok(hwnd), Ok(scale)) = (window.hwnd(), window.scale_factor()) {
        let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
        if changed_on {
            glass::set_blur(hwnd, on);
        }
        glass::set_shape(hwnd, if on { &shapes } else { &[] }, scale);
    }
    #[cfg(not(windows))]
    let _ = &window;
    *cur = (on, shapes);
}

#[tauri::command]
fn open_file(path: String) {
    let _ = tauri_plugin_opener::open_path(path, None::<&str>);
}

#[tauri::command]
fn reveal_file(path: String) {
    let _ = tauri_plugin_opener::reveal_item_in_dir(path);
}

#[derive(serde::Serialize)]
struct FileInfo {
    exists: bool,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn file_info(path: String) -> FileInfo {
    match std::fs::metadata(&path) {
        Ok(m) => FileInfo { exists: true, is_dir: m.is_dir(), size: if m.is_dir() { 0 } else { m.len() } },
        Err(_) => FileInfo { exists: false, is_dir: false, size: 0 },
    }
}

/// Letakkan jendela di tengah atas layar utama.
fn place_window(win: &WebviewWindow) {
    let monitor = win.primary_monitor().ok().flatten().or_else(|| win.current_monitor().ok().flatten());
    if let (Some(m), Ok(size)) = (monitor, win.outer_size()) {
        let x = m.position().x + (m.size().width as i32 - size.width as i32) / 2;
        let _ = win.set_position(PhysicalPosition::new(x, m.position().y));
    }
}

/// Cek posisi kursor terus-menerus: kalau di atas notch, jendela menerima
/// klik; kalau tidak, klik diteruskan ke aplikasi di belakang.
fn start_click_through(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(win) = app.get_webview_window("main") else { continue };
            let (Ok(cursor), Ok(pos), Ok(scale)) =
                (win.cursor_position(), win.outer_position(), win.scale_factor())
            else {
                continue;
            };
            let cx = (cursor.x - pos.x as f64) / scale;
            let cy = (cursor.y - pos.y as f64) / scale;
            let inside = app
                .state::<Interactive>()
                .0
                .lock()
                .unwrap()
                .iter()
                .any(|r| cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
            let ignore = !inside;
            if ignoring != Some(ignore) {
                let _ = win.set_ignore_cursor_events(ignore);
                // Beri tahu tampilan, karena mouseleave tidak selalu terkirim
                // setelah jendela menjadi tembus klik.
                let _ = app.emit("lentera-cursor", inside);
                ignoring = Some(ignore);
            }
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let show = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &settings, &autostart, &sep, &quit])?;

    let autostart_item = autostart.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("ikon aplikasi"))
        .tooltip("Lentera")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(true) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                    }
                }
            }
            "settings" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.eval("window.lentera && window.lentera.openTab('settings')");
                }
            }
            "autostart" => {
                let al = app.autolaunch();
                let enabled = al.is_enabled().unwrap_or(false);
                let _ = if enabled { al.disable() } else { al.enable() };
                let _ = autostart_item.set_checked(al.is_enabled().unwrap_or(false));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Interactive::default())
        .manage(Glass::default())
        .manage(system::NotificationState::default())
        .invoke_handler(tauri::generate_handler![
            set_interactive,
            media_info,
            media_control,
            system_status,
            notifications_poll,
            fetch_lyrics,
            http_json,
            set_glass,
            file_info,
            media_seek,
            idle_ms,
            open_file,
            reveal_file,
        ])
        .setup(|app| {
            let win = app.get_webview_window("main").expect("jendela utama");
            place_window(&win);
            let _ = win.set_ignore_cursor_events(true);
            let _ = win.show();
            start_click_through(app.handle().clone());
            system::watch_input(app.handle().clone());
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("gagal menjalankan Lentera");
}
