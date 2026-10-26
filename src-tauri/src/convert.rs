//! Pengubah format gambar untuk halaman File Converter.
//! Hasil disimpan di folder yang sama dengan file aslinya.

use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use serde::Serialize;

/// Ekstensi gambar yang bisa dibaca.
pub const INPUTS: [&str; 9] = ["png", "jpg", "jpeg", "webp", "bmp", "ico", "tif", "tiff", "gif"];

#[derive(Serialize, Default)]
pub struct Converted {
    pub src: String,
    pub out: Option<String>,
    pub error: Option<String>,
}

pub fn convert_all(paths: &[String], format: &str) -> Vec<Converted> {
    paths
        .iter()
        .map(|p| match convert(Path::new(p), format) {
            Ok(out) => Converted { src: p.clone(), out: Some(out.to_string_lossy().into_owned()), error: None },
            Err(e) => Converted { src: p.clone(), out: None, error: Some(e) },
        })
        .collect()
}

fn convert(src: &Path, format: &str) -> Result<PathBuf, String> {
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !INPUTS.contains(&ext.as_str()) {
        return Err("Only images can be converted".into());
    }
    let img = image::open(src).map_err(|e| e.to_string())?;
    let out_ext = match format {
        "jpg" => "jpg",
        "png" | "webp" | "pdf" | "ico" | "bmp" | "tiff" | "gif" => format,
        _ => return Err("Unknown format".into()),
    };
    let out = unique_path(src, out_ext);
    let file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(file);
    let res = match format {
        "jpg" => JpegEncoder::new_with_quality(&mut w, 90).encode_image(&flatten(&img)).map_err(|e| e.to_string()),
        "webp" => WebPEncoder::new_lossless(&mut w).encode(
            img.to_rgba8().as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string()),
        "pdf" => write_pdf(&mut w, &img),
        "ico" => {
            // Ikon Windows paling besar 256×256.
            let small = if img.width() > 256 || img.height() > 256 { img.thumbnail(256, 256) } else { img.clone() };
            DynamicImage::ImageRgba8(small.to_rgba8()).write_to(&mut w, ImageFormat::Ico).map_err(|e| e.to_string())
        }
        "png" => img.write_to(&mut w, ImageFormat::Png).map_err(|e| e.to_string()),
        "bmp" => DynamicImage::ImageRgba8(img.to_rgba8()).write_to(&mut w, ImageFormat::Bmp).map_err(|e| e.to_string()),
        "tiff" => DynamicImage::ImageRgba8(img.to_rgba8()).write_to(&mut w, ImageFormat::Tiff).map_err(|e| e.to_string()),
        "gif" => DynamicImage::ImageRgba8(img.to_rgba8()).write_to(&mut w, ImageFormat::Gif).map_err(|e| e.to_string()),
        _ => unreachable!(),
    };
    let res = res.and_then(|_| w.flush().map_err(|e| e.to_string()));
    if let Err(e) = res {
        drop(w);
        let _ = std::fs::remove_file(&out);
        return Err(e);
    }
    Ok(out)
}

/// Gambar tanpa transparansi: bagian transparan diberi latar putih.
fn flatten(img: &DynamicImage) -> RgbImage {
    let rgba = img.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y).0;
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        Rgb([mix(p[0]), mix(p[1]), mix(p[2])])
    })
}

/// PDF satu halaman berisi gambar (JPEG di dalamnya), ukuran halaman = ukuran gambar.
fn write_pdf(w: &mut impl Write, img: &DynamicImage) -> Result<(), String> {
    let rgb = flatten(img);
    let mut jpg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpg, 92).encode_image(&rgb).map_err(|e| e.to_string())?;
    let (iw, ih) = (rgb.width(), rgb.height());
    // 96 dpi layar → 72 pt per inci.
    let (pw, ph) = (iw as f64 * 0.75, ih as f64 * 0.75);
    let content = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im0 Do Q");

    let mut buf: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    let mut obj = |buf: &mut Vec<u8>, head: String, stream: Option<&[u8]>| {
        offsets.push(buf.len());
        buf.extend_from_slice(head.as_bytes());
        if let Some(s) = stream {
            buf.extend_from_slice(b"\nstream\n");
            buf.extend_from_slice(s);
            buf.extend_from_slice(b"\nendstream");
        }
        buf.extend_from_slice(b"\nendobj\n");
    };
    obj(&mut buf, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>".into(), None);
    obj(&mut buf, "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(), None);
    obj(
        &mut buf,
        format!(
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.2} {ph:.2}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
        ),
        None,
    );
    obj(
        &mut buf,
        format!(
            "4 0 obj\n<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>",
            jpg.len()
        ),
        Some(&jpg),
    );
    obj(&mut buf, format!("5 0 obj\n<< /Length {} >>", content.len()), Some(content.as_bytes()));
    let xref = buf.len();
    let mut tail = format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1);
    for o in &offsets {
        tail.push_str(&format!("{o:010} 00000 n \n"));
    }
    tail.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", offsets.len() + 1));
    buf.extend_from_slice(tail.as_bytes());
    w.write_all(&buf).map_err(|e| e.to_string())
}

/// "foto.jpg" → "foto.png", atau "foto (1).png" kalau sudah ada.
fn unique_path(src: &Path, ext: &str) -> PathBuf {
    let dir = src.parent().unwrap_or(Path::new("."));
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("converted");
    let mut out = dir.join(format!("{stem}.{ext}"));
    let mut n = 1;
    while out.exists() {
        out = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_every_format() {
        let dir = std::env::temp_dir().join("spidey-convert-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("pic.png");
        let img = image::RgbaImage::from_fn(300, 200, |x, y| image::Rgba([x as u8, y as u8, 120, if x < 20 { 0 } else { 255 }]));
        img.save(&src).unwrap();
        for f in ["png", "jpg", "webp", "pdf", "ico", "bmp", "tiff", "gif"] {
            let r = convert_all(&[src.to_string_lossy().into_owned()], f);
            assert!(r[0].error.is_none(), "{f}: {:?}", r[0].error);
            let out = PathBuf::from(r[0].out.clone().unwrap());
            assert!(std::fs::metadata(&out).unwrap().len() > 0);
            if f != "pdf" {
                image::open(&out).unwrap_or_else(|e| panic!("{f}: {e}"));
            }
        }
        assert!(dir.join("pic (1).png").exists());
    }
}
