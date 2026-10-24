//! Info sistem Windows: lagu yang diputar, baterai, internet, Bluetooth, notifikasi.
//! Di luar Windows modul ini mengembalikan data kosong supaya tetap bisa dikompilasi.

use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Serialize, Default, Clone)]
pub struct MediaInfo {
    pub available: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub playing: bool,
    pub position_ms: i64,
    pub duration_ms: i64,
    /// Waktu (Unix ms) saat posisi di atas dicatat oleh pemutar.
    pub updated_unix_ms: i64,
    /// Sampul album sebagai data URL, kalau ada.
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Default)]
pub struct Battery {
    pub present: bool,
    pub percent: u8,
    pub charging: bool,
    pub plugged: bool,
}

#[derive(Serialize, Default)]
pub struct Network {
    pub connected: bool,
    pub internet: bool,
    pub wifi: bool,
    pub name: String,
}

#[derive(Serialize, Default)]
pub struct SystemStatus {
    pub battery: Battery,
    pub network: Network,
    pub bluetooth: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct NotificationItem {
    pub id: u32,
    pub app: String,
    pub title: String,
    pub body: String,
}

#[derive(Serialize, Default)]
pub struct NotificationPoll {
    /// "allowed", "denied" atau "unsupported".
    pub access: String,
    /// Hanya notifikasi yang baru muncul sejak panggilan sebelumnya.
    pub items: Vec<NotificationItem>,
}

/// Perubahan kecil dari keyboard dan audio untuk ditampilkan sekilas di notch.
#[derive(Serialize, Clone, Default)]
pub struct InputEvent {
    /// "caps", "lang" atau "volume".
    pub kind: String,
    pub caps: bool,
    /// Kode bahasa keyboard, contoh "en-US" atau "id-ID".
    pub lang: String,
    pub volume: u8,
    pub muted: bool,
}

#[derive(Default)]
pub struct NotificationState {
    seen: Mutex<Option<HashSet<u32>>>,
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
pub use stub::*;

#[cfg(not(windows))]
mod stub {
    use super::*;
    pub fn media_info() -> MediaInfo {
        MediaInfo::default()
    }
    pub fn media_control(_action: &str) {}
    pub fn media_seek(_position_ms: i64) {}
    pub fn idle_ms() -> u64 {
        0
    }
    pub fn watch_input(_app: tauri::AppHandle) {}
    pub fn system_status() -> SystemStatus {
        SystemStatus::default()
    }
    pub fn notifications_poll(_state: &NotificationState) -> NotificationPoll {
        NotificationPoll { access: "unsupported".into(), items: vec![] }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use windows::core::{Result, HSTRING};
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
    use windows::Storage::Streams::DataReader;
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    /// Selisih 1601-01-01 (epoch Windows) dan 1970-01-01 dalam satuan 100 ns.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;

    static THUMB_CACHE: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

    fn session() -> Result<Session> {
        SessionManager::RequestAsync()?.get()?.GetCurrentSession()
    }

    pub fn media_info() -> MediaInfo {
        read_media().unwrap_or_default()
    }

    fn read_media() -> Result<MediaInfo> {
        let s = session()?;
        let props = s.TryGetMediaPropertiesAsync()?.get()?;
        let timeline = s.GetTimelineProperties()?;
        let status = s.GetPlaybackInfo()?.PlaybackStatus()?;
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();
        let key = format!("{title}\u{1}{artist}");

        let thumbnail = {
            let mut cache = THUMB_CACHE.lock().unwrap();
            match cache.as_ref() {
                Some((k, t)) if *k == key => t.clone(),
                _ => {
                    let t = read_thumbnail(&props).ok().flatten();
                    // Sampul kadang belum siap di detik pertama: jangan simpan hasil kosong.
                    if t.is_some() {
                        *cache = Some((key.clone(), t.clone()));
                    }
                    t
                }
            }
        };

        let start = timeline.StartTime()?.Duration;
        Ok(MediaInfo {
            available: true,
            title,
            artist,
            album: props.AlbumTitle()?.to_string(),
            app: s.SourceAppUserModelId()?.to_string(),
            playing: status == PlaybackStatus::Playing,
            position_ms: (timeline.Position()?.Duration - start) / 10_000,
            duration_ms: (timeline.EndTime()?.Duration - start) / 10_000,
            updated_unix_ms: (timeline.LastUpdatedTime()?.UniversalTime - EPOCH_DIFF) / 10_000,
            thumbnail,
        })
    }

    fn read_thumbnail(
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Result<Option<String>> {
        let Ok(r) = props.Thumbnail() else { return Ok(None) };
        let stream = r.OpenReadAsync()?.get()?;
        let size = stream.Size()? as u32;
        if size == 0 || size > 8 * 1024 * 1024 {
            return Ok(None);
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.get()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf)?;
        let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
        let mime = if mime.is_empty() { "image/png".to_string() } else { mime };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
        Ok(Some(format!("data:{mime};base64,{b64}")))
    }

    pub fn media_control(action: &str) {
        let Ok(s) = session() else { return };
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "prev" => s.TrySkipPreviousAsync(),
            _ => return,
        };
        if let Ok(op) = op {
            let _ = op.get();
        }
    }

    pub fn media_seek(position_ms: i64) {
        let Ok(s) = session() else { return };
        let Ok(start) = s.GetTimelineProperties().and_then(|t| t.StartTime()) else { return };
        if let Ok(op) = s.TryChangePlaybackPositionAsync(start.Duration + position_ms.max(0) * 10_000) {
            let _ = op.get();
        }
    }

    /// Berapa lama (ms) sejak terakhir ada gerakan mouse atau ketikan.
    pub fn idle_ms() -> u64 {
        use windows::Win32::System::SystemInformation::GetTickCount;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
            return 0;
        }
        unsafe { GetTickCount() }.wrapping_sub(info.dwTime) as u64
    }

    /// Pantau Caps Lock, bahasa keyboard, dan volume. Cukup dibaca berkala,
    /// tanpa hook keyboard, jadi tidak ada ketikan yang direkam.
    pub fn watch_input(app: tauri::AppHandle) {
        use tauri::Emitter;
        use windows::Win32::Globalization::LCIDToLocaleName;
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, GetKeyboardLayout, VK_CAPITAL};
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

        std::thread::spawn(move || {
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let endpoint = || -> Result<IAudioEndpointVolume> {
                unsafe {
                    let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                    en.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)
                }
            };
            let mut vol_ep = endpoint().ok();
            let mut last_caps: Option<bool> = None;
            let mut last_lang: Option<String> = None;
            let mut last_vol: Option<(u8, bool)> = None;
            let mut tick: u32 = 0;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(150));
                tick = tick.wrapping_add(1);

                let caps = unsafe { GetKeyState(VK_CAPITAL.0 as i32) } & 1 != 0;
                if last_caps.is_some_and(|c| c != caps) {
                    let _ = app.emit("lentera-input", InputEvent { kind: "caps".into(), caps, ..Default::default() });
                }
                last_caps = Some(caps);

                let lang = unsafe {
                    let tid = GetWindowThreadProcessId(GetForegroundWindow(), None);
                    let langid = (GetKeyboardLayout(tid).0 as usize & 0xffff) as u32;
                    let mut buf = [0u16; 85];
                    let n = LCIDToLocaleName(langid, Some(&mut buf), 0);
                    String::from_utf16_lossy(&buf[..(n.max(1) as usize - 1)])
                };
                if !lang.is_empty() {
                    if last_lang.as_ref().is_some_and(|l| *l != lang) {
                        let _ = app.emit("lentera-input", InputEvent { kind: "lang".into(), lang: lang.clone(), ..Default::default() });
                    }
                    last_lang = Some(lang);
                }

                // Perangkat audio bisa berganti (mis. headphone dicolok), ambil ulang tiap ±3 detik.
                if tick.is_multiple_of(20) {
                    vol_ep = endpoint().ok();
                }
                if let Some(ep) = &vol_ep {
                    let v = unsafe { ep.GetMasterVolumeLevelScalar() }.ok();
                    let m = unsafe { ep.GetMute() }.map(|b| b.as_bool()).unwrap_or(false);
                    if let Some(v) = v {
                        let cur = ((v * 100.0).round() as u8, m);
                        if last_vol.is_some_and(|l| l != cur) {
                            let _ = app.emit(
                                "lentera-input",
                                InputEvent { kind: "volume".into(), volume: cur.0, muted: cur.1, ..Default::default() },
                            );
                        }
                        last_vol = Some(cur);
                    }
                }
            }
        });
    }

    pub fn system_status() -> SystemStatus {
        SystemStatus { battery: battery(), network: network(), bluetooth: bluetooth() }
    }

    fn battery() -> Battery {
        let mut st = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&mut st) }.is_err() {
            return Battery::default();
        }
        // BatteryFlag 128 = tidak ada baterai (PC desktop), 255 = tidak diketahui.
        let present = st.BatteryFlag != 128 && st.BatteryFlag != 255 && st.BatteryLifePercent <= 100;
        Battery {
            present,
            percent: if st.BatteryLifePercent <= 100 { st.BatteryLifePercent } else { 0 },
            charging: st.BatteryFlag & 8 != 0,
            plugged: st.ACLineStatus == 1,
        }
    }

    fn network() -> Network {
        let Ok(p) = NetworkInformation::GetInternetConnectionProfile() else {
            return Network::default();
        };
        let level = p.GetNetworkConnectivityLevel().unwrap_or(NetworkConnectivityLevel::None);
        Network {
            connected: level != NetworkConnectivityLevel::None,
            internet: level == NetworkConnectivityLevel::InternetAccess,
            wifi: p.IsWlanConnectionProfile().unwrap_or(false),
            name: p.ProfileName().map(|n| n.to_string()).unwrap_or_default(),
        }
    }

    fn bluetooth() -> Vec<String> {
        let mut names = Vec::new();
        let selectors = [
            BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
            BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
        ];
        for sel in selectors.into_iter().flatten() {
            if let Ok(list) = find_devices(&sel) {
                for n in list {
                    if !n.is_empty() && !names.contains(&n) {
                        names.push(n);
                    }
                }
            }
        }
        names
    }

    fn find_devices(selector: &HSTRING) -> Result<Vec<String>> {
        let col = DeviceInformation::FindAllAsyncAqsFilter(selector)?.get()?;
        Ok(col.into_iter().filter_map(|d| d.Name().ok().map(|n| n.to_string())).collect())
    }

    pub fn notifications_poll(state: &NotificationState) -> NotificationPoll {
        match read_notifications(state) {
            Ok(p) => p,
            // Biasanya terjadi kalau Windows tidak mengizinkan aplikasi non-Store membaca notifikasi.
            Err(_) => NotificationPoll { access: "unsupported".into(), items: vec![] },
        }
    }

    fn read_notifications(state: &NotificationState) -> Result<NotificationPoll> {
        let listener = UserNotificationListener::Current()?;
        let mut access = listener.GetAccessStatus()?;
        if access == UserNotificationListenerAccessStatus::Unspecified {
            access = listener.RequestAccessAsync()?.get()?;
        }
        if access != UserNotificationListenerAccessStatus::Allowed {
            return Ok(NotificationPoll { access: "denied".into(), items: vec![] });
        }

        let list = listener.GetNotificationsAsync(NotificationKinds::Toast)?.get()?;
        let binding_name = KnownNotificationBindings::ToastGeneric()?;
        let mut seen_guard = state.seen.lock().unwrap();
        let first_poll = seen_guard.is_none();
        let seen = seen_guard.get_or_insert_with(HashSet::new);
        let mut items = Vec::new();
        let mut current = HashSet::new();

        for n in list {
            let Ok(id) = n.Id() else { continue };
            current.insert(id);
            if seen.contains(&id) || first_poll {
                continue;
            }
            let app = n
                .AppInfo()
                .and_then(|a| a.DisplayInfo())
                .and_then(|d| d.DisplayName())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let texts: Vec<String> = n
                .Notification()
                .and_then(|x| x.Visual())
                .and_then(|v| v.GetBinding(&binding_name))
                .and_then(|b| b.GetTextElements())
                .map(|els| els.into_iter().filter_map(|t| t.Text().ok().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            items.push(NotificationItem {
                id,
                app,
                title: texts.first().cloned().unwrap_or_default(),
                body: texts.iter().skip(1).cloned().collect::<Vec<_>>().join(" "),
            });
        }
        *seen = current;
        Ok(NotificationPoll { access: "allowed".into(), items })
    }
}
