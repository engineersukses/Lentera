// Jembatan ke bagian Rust. Kalau dibuka di browser biasa (tanpa Tauri),
// pakai data contoh supaya tampilan tetap bisa dicoba.

const T = window.__TAURI__;
export const isTauri = !!T;

let demoStart = Date.now();
const demo = {
  playing: true,
  media() {
    const duration = 214000;
    const pos = (Date.now() - demoStart) % duration;
    return {
      available: true,
      title: "Lagu Contoh",
      artist: "Penyanyi Contoh",
      album: "Album Contoh",
      app: "Spotify.exe",
      playing: this.playing,
      position_ms: pos,
      duration_ms: duration,
      updated_unix_ms: Date.now(),
      thumbnail: null,
    };
  },
};

const mock = {
  media_info: () => demo.media(),
  media_control: ({ action }) => {
    if (action === "toggle") demo.playing = !demo.playing;
  },
  system_status: () => ({
    battery: { present: true, percent: 76, charging: false, plugged: false },
    network: { connected: true, internet: true, wifi: true, name: "WiFi Rumah" },
    bluetooth: ["Galaxy Buds2"],
  }),
  notifications_poll: () => ({ access: "allowed", items: [] }),
  fetch_lyrics: () => ({
    synced: "[00:00.00]Ini baris lirik pertama\n[00:05.00]Notch membelah jadi dua panel\n[00:10.00]Baris yang dinyanyikan menyala\n[00:15.00]Klik satu baris untuk loncat\n[00:20.00]Lirik asli diambil dari LRCLIB\n[00:25.00]Ini hanya contoh untuk pratinjau\n[00:30.00]Lagu terus berjalan\n[00:35.00]Sampai baris terakhir",
    plain: null,
    instrumental: false,
  }),
  file_info: ({ path }) => ({ exists: true, is_dir: !path.includes("."), size: 2516582 }),
  media_seek: ({ positionMs }) => {
    demoStart = Date.now() - positionMs;
  },
  idle_ms: () => 0,
  set_interactive: () => {},
  open_file: () => {},
  reveal_file: () => {},
};

export async function invoke(cmd, args = {}) {
  if (T) return T.core.invoke(cmd, args);
  const f = mock[cmd];
  return f ? f(args) : null;
}

export function listen(event, cb) {
  if (T) return T.event.listen(event, cb);
  return Promise.resolve(() => {});
}

/** Mulai drag file keluar dari notch ke Explorer/aplikasi lain. */
export async function startDrag(paths, imageDataUrl) {
  if (!T) return;
  const onEvent = new T.core.Channel();
  return T.core.invoke("plugin:drag|start_drag", {
    item: paths,
    image: imageDataUrl,
    options: { mode: "copy" },
    onEvent,
  });
}

export async function focusWindow() {
  if (!T) return;
  try {
    await T.window.getCurrentWindow().setFocus();
  } catch {}
}

export const autostart = {
  async get() {
    if (!T) return false;
    try {
      return await T.core.invoke("plugin:autostart|is_enabled");
    } catch {
      return false;
    }
  },
  async set(on) {
    if (!T) return;
    await T.core.invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable");
  },
};
