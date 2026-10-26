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
      title: "Sample Song",
      artist: "Sample Artist",
      album: "Sample Album",
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
    battery: { present: true, percent: 76, charging: false, plugged: false, ...(window.__mockBattery || {}) },
    network: { connected: true, internet: true, wifi: true, name: "Home WiFi" },
    bluetooth: ["Galaxy Buds2"],
  }),
  notifications_poll: () => ({ access: "allowed", items: [] }),
  fetch_lyrics: () => ({
    synced: "[00:00.00]This is the first lyric line\n[00:05.00]The notch splits into two panels\n[00:10.00]The line being sung lights up\n[00:15.00]Click a line to jump there\n[00:20.00]Real lyrics come from LRCLIB\n[00:25.00]This is only a preview sample\n[00:30.00]The song keeps playing\n[00:35.00]Until the very last line",
    plain: null,
    instrumental: false,
  }),
  convert_files: ({ paths, format }) =>
    new Promise((ok) => setTimeout(() => ok(paths.map((src) => ({ src, out: src.replace(/\.[^.]+$/, "." + format) }))), 700)),
  file_info: ({ path }) => ({ exists: true, is_dir: !path.includes("."), size: 2516582 }),
  media_seek: ({ positionMs }) => {
    demoStart = Date.now() - positionMs;
  },
  http_json: ({ url }) => {
    if (url.includes("/kota/cari/")) return { data: [{ id: "1301", lokasi: "KOTA JAKARTA" }, { id: "1501", lokasi: "KAB. SLEMAN" }] };
    const m = url.match(/jadwal\/\d+\/(\d+)\/(\d+)/);
    if (!m) return null;
    const days = new Date(+m[1], +m[2], 0).getDate();
    const jadwal = Array.from({ length: days }, (_, i) => ({
      date: `${m[1]}-${m[2]}-${String(i + 1).padStart(2, "0")}`,
      imsak: "04:01", subuh: "04:11", terbit: "05:25", dzuhur: "11:40", ashar: "14:52", maghrib: "17:49", isya: "18:59",
    }));
    return { data: { jadwal } };
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

/** Jendela "Open" Windows untuk memilih file dari folder mana saja. */
export async function pickFiles(title, extensions) {
  if (!T) return ["C:\\Users\\demo\\Documents\\poster.png"];
  const res = await T.core.invoke("plugin:dialog|open", {
    options: { title, multiple: true, filters: [{ name: "Images", extensions }] },
  });
  return Array.isArray(res) ? res : res ? [res] : [];
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
