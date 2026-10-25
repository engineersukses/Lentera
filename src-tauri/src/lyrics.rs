//! Ambil lirik dari LRCLIB (https://lrclib.net), gratis dan tanpa API key.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const UA: &str = "Lentera/1.0 (https://github.com/; aplikasi notch Windows)";

#[derive(Serialize, Clone)]
pub struct Lyrics {
    /// Lirik bertanda waktu format LRC, contoh: "[00:12.34] baris".
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    duration: f64,
}

impl From<Record> for Lyrics {
    fn from(r: Record) -> Self {
        Lyrics { synced: r.synced_lyrics, plain: r.plain_lyrics, instrumental: r.instrumental }
    }
}

pub fn agent() -> ureq::Agent {
    let mut b = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).user_agent(UA);
    // Pakai TLS bawaan Windows (SChannel), jadi tidak perlu library kripto tambahan.
    if let Ok(tls) = native_tls::TlsConnector::new() {
        b = b.tls_connector(std::sync::Arc::new(tls));
    }
    b.build()
}

pub fn fetch(title: &str, artist: &str, album: &str, duration: f64) -> Option<Lyrics> {
    let title = clean_title(title, artist);
    if title.is_empty() {
        return None;
    }
    let agent = agent();

    // 1) Cocokkan persis (paling akurat).
    if duration > 0.0 {
        let res = agent
            .get("https://lrclib.net/api/get")
            .query("track_name", &title)
            .query("artist_name", artist)
            .query("album_name", album)
            .query("duration", &format!("{}", duration.round() as i64))
            .call();
        if let Ok(r) = res {
            if let Ok(rec) = r.into_json::<Record>() {
                if rec.synced_lyrics.is_some() || rec.plain_lyrics.is_some() || rec.instrumental {
                    return Some(rec.into());
                }
            }
        }
    }

    // 2) Cari, lalu pilih yang durasinya paling dekat dan punya lirik sinkron.
    let mut req = agent.get("https://lrclib.net/api/search").query("track_name", &title);
    if !artist.is_empty() {
        req = req.query("artist_name", artist);
    }
    let list: Vec<Record> = req.call().ok()?.into_json().ok()?;
    list.into_iter()
        .filter(|r| r.synced_lyrics.is_some() || r.plain_lyrics.is_some())
        .min_by(|a, b| score(a, duration).total_cmp(&score(b, duration)))
        .map(Into::into)
}

fn score(r: &Record, duration: f64) -> f64 {
    let diff = if duration > 0.0 { (r.duration - duration).abs() } else { 0.0 };
    diff + if r.synced_lyrics.is_some() { 0.0 } else { 30.0 }
}

/// Buang embel-embel seperti "(Official Video)" atau "[Lyrics]" dari judul YouTube.
fn clean_title(t: &str, artist: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in t.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let out = out.trim();
    match out.split_once(" - ") {
        // "Artis - Judul" (judul video YouTube): ambil judulnya.
        Some((a, rest)) if !artist.is_empty() && a.trim().eq_ignore_ascii_case(artist.trim()) => {
            rest.trim().to_string()
        }
        // "Judul - Remastered 2011" dan sejenisnya: ambil judulnya.
        Some((head, _)) if !head.trim().is_empty() => head.trim().to_string(),
        _ => out.to_string(),
    }
}
