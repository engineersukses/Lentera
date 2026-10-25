//! Efek kaca buram (frosted) sungguhan di Windows.
//!
//! Jendela Lentera transparan dan lebih besar dari notch. Supaya buramnya hanya
//! muncul di belakang notch (dan maskot), bentuk jendela dipotong mengikuti
//! notch dengan SetWindowRgn, lalu Windows diminta memburamkan latar di
//! belakang jendela (SetWindowCompositionAttribute, blur-behind).

use serde::Deserialize;

/// Kotak dalam piksel CSS relatif terhadap jendela, dengan jari-jari sudut bawah.
#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub r: f64,
    /// true: hanya sudut bawah yang membulat (menempel di tepi atas layar).
    #[serde(default)]
    pub top: bool,
}

#[cfg(windows)]
mod imp {
    use super::Shape;
    use std::ffi::c_void;
    use windows::core::{s, w, BOOL};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        gradient: u32,
        animation: u32,
    }

    #[repr(C)]
    struct CompositionData {
        attribute: u32,
        data: *mut c_void,
        size: usize,
    }

    type SetWca = unsafe extern "system" fn(HWND, *mut CompositionData) -> BOOL;

    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_DISABLED: u32 = 0;
    const ACCENT_ENABLE_BLURBEHIND: u32 = 3;

    pub fn set_blur(hwnd: HWND, on: bool) {
        unsafe {
            let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else { return };
            let Some(f) = GetProcAddress(user32, s!("SetWindowCompositionAttribute")) else { return };
            let f: SetWca = std::mem::transmute(f);
            let mut policy = AccentPolicy {
                state: if on { ACCENT_ENABLE_BLURBEHIND } else { ACCENT_DISABLED },
                flags: 0,
                gradient: 0,
                animation: 0,
            };
            let mut data = CompositionData {
                attribute: WCA_ACCENT_POLICY,
                data: &mut policy as *mut _ as *mut c_void,
                size: std::mem::size_of::<AccentPolicy>(),
            };
            let _ = f(hwnd, &mut data);
        }
    }

    /// Potong jendela mengikuti kotak-kotak `shapes` (piksel CSS × skala layar).
    /// Daftar kosong mengembalikan jendela ke bentuk penuh.
    pub fn set_shape(hwnd: HWND, shapes: &[Shape], scale: f64) {
        unsafe {
            if shapes.is_empty() {
                let _ = SetWindowRgn(hwnd, None, true);
                return;
            }
            let total = CreateRectRgn(0, 0, 0, 0);
            for s in shapes {
                let px = |v: f64| (v * scale).round() as i32;
                let d = px(s.r * 2.0).max(1);
                // Untuk notch, sudut atas digeser ke luar jendela supaya hanya sudut bawah yang bulat.
                let top = if s.top { px(s.y) - d } else { px(s.y) };
                let part: HRGN = CreateRoundRectRgn(px(s.x), top, px(s.x + s.w) + 1, px(s.y + s.h) + 1, d, d);
                CombineRgn(Some(total), Some(total), Some(part), RGN_OR);
                let _ = DeleteObject(part.into());
            }
            // Setelah SetWindowRgn berhasil, region dimiliki Windows (jangan dihapus).
            if SetWindowRgn(hwnd, Some(total), true) == 0 {
                let _ = DeleteObject(total.into());
            }
        }
    }
}

#[cfg(windows)]
pub use imp::{set_blur, set_shape};
