//! Kaca buram asli di belakang notch.
//!
//! Windows hanya bisa memburamkan satu jendela utuh, bukan sebagian, jadi
//! dibuat jendela kecil terpisah ("frost") yang selalu diletakkan tepat di
//! bawah notch, seukuran notch. Jendela utama yang transparan menggambar
//! notch di atasnya, sehingga aplikasi apa pun di belakang notch terlihat buram.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Color, Effect, EffectState};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "frost", WebviewUrl::App("frost.html".into()))
        .title("Lentera Frost")
        .inner_size(10.0, 10.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        // Blur "behind" (bukan Acrylic/Mica): tetap aktif walau jendela tidak
        // sedang difokus, dan ikut memburamkan aplikasi lain, bukan cuma desktop.
        .effects(WindowEffectsConfig {
            effects: vec![Effect::Blur],
            state: Some(EffectState::Active),
            radius: None,
            color: Some(Color(20, 18, 30, 60)),
            ..Default::default()
        })
        .build()?;
    let _ = win.set_ignore_cursor_events(true);
    #[cfg(windows)]
    if let Ok(h) = win.hwnd() {
        win32::no_dwm_corners(h.0 as isize);
    }
    Ok(())
}

/// x, y, w, h dalam piksel CSS jendela utama; r = jari-jari sudut bawah.
pub fn set(app: &AppHandle, x: f64, y: f64, w: f64, h: f64, r: f64, show: bool) -> bool {
    let (Some(main), Some(frost)) = (app.get_webview_window("main"), app.get_webview_window("frost")) else {
        return false;
    };
    if !show || w < 4.0 || h < 4.0 || !main.is_visible().unwrap_or(false) {
        let _ = frost.hide();
        return true;
    }
    #[cfg(windows)]
    {
        let (Ok(pos), Ok(scale), Ok(mh), Ok(fh)) = (main.outer_position(), main.scale_factor(), main.hwnd(), frost.hwnd())
        else {
            return false;
        };
        // Sedikit masuk ke dalam supaya sudut persegi jendela blur tidak
        // menyembul di luar lengkungan sudut notch.
        let inset = r * 0.3;
        let px = |v: f64| (v * scale).round() as i32;
        win32::place(
            fh.0 as isize,
            mh.0 as isize,
            pos.x + px(x + inset),
            pos.y + px(y),
            px(w - inset * 2.0).max(1),
            px(h - inset).max(1),
            px(r),
        );
    }
    #[cfg(not(windows))]
    let _ = (x, y, r);
    true
}

pub fn hide(app: &AppHandle) {
    if let Some(f) = app.get_webview_window("frost") {
        let _ = f.hide();
    }
}

#[cfg(windows)]
mod win32 {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND};
    use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR};
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_SHOWWINDOW};

    fn hwnd(h: isize) -> HWND {
        HWND(h as *mut core::ffi::c_void)
    }

    pub fn no_dwm_corners(h: isize) {
        let pref = DWMWCP_DONOTROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd(h),
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const _ as *const core::ffi::c_void,
                std::mem::size_of_val(&pref) as u32,
            );
        }
    }

    /// Letakkan jendela blur tepat di bawah jendela utama (urutan tumpukan),
    /// lalu potong bentuknya: atas lurus, bawah melengkung.
    pub fn place(frost: isize, main: isize, x: i32, y: i32, w: i32, h: i32, r: i32) {
        unsafe {
            let _ = SetWindowPos(hwnd(frost), Some(hwnd(main)), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let d = (r * 2).max(1);
            let rgn = CreateRoundRectRgn(0, -d, w + 1, h + 1, d, d);
            let top = CreateRectRgn(0, 0, w, (h - r).max(0));
            CombineRgn(Some(rgn), Some(rgn), Some(top), RGN_OR);
            let _ = DeleteObject(top.into());
            // Setelah SetWindowRgn, region jadi milik Windows (jangan dihapus).
            SetWindowRgn(hwnd(frost), Some(rgn), true);
        }
    }
}
