import { invoke, listen, startDrag, focusWindow, autostart, isTauri } from "./bridge.js";
import { load, save, clearAll, todayKey } from "./store.js";
import { sounds } from "./sound.js";
import { prayerTimes, PRAYERS, CITIES } from "./prayer.js";
import { createMascot, chooseLine } from "./mascot.js";

const $ = (id) => document.getElementById(id);
const notch = $("notch");
const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (id) => `<svg><use href="#${id}" /></svg>`;
const setHtml = (el, html) => {
  if (el.innerHTML !== html) el.innerHTML = html;
};

if (!isTauri) document.body.classList.add("preview");

/* ================= Pengaturan ================= */

const DEFAULTS = {
  name: "",
  city: "Jakarta",
  lat: -6.2088,
  lng: 106.8456,
  preMin: 10,
  offset: 0,
  prayerSound: true,
  mascotEvery: 4,
  eyes: true,
  minimal: false,
  miniLyrics: true,
  notifPeek: true,
  overlays: true,
  lyricsOpen: false,
};
const settings = { ...DEFAULTS, ...load("settings", {}) };
const saveSettings = () => save("settings", settings);

/* ================= Halaman (panah kiri/kanan + titik) ================= */

const PAGES = ["music", "timer", "prayer", "water", "shelf", "todo", "notif", "settings"];
let page = PAGES.includes(load("page", "music")) ? load("page", "music") : "music";

function setPage(p) {
  page = p;
  notch.dataset.page = p;
  save("page", p);
  setHtml($("dots"), PAGES.map((x) => `<button data-p="${x}" class="${x === p ? "on" : ""}"></button>`).join(""));
  if (p === "shelf") renderShelf();
  if (p === "music") lyricsBuiltFor = "";
  if (p !== "timer") $("fEdit").hidden = true;
  applyLyricsMode();
  renderAll();
}

function step(dir) {
  const i = PAGES.indexOf(page);
  setPage(PAGES[(i + dir + PAGES.length) % PAGES.length]);
}

$("navL").addEventListener("click", () => step(-1));
$("navR").addEventListener("click", () => step(1));
$("dots").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-p]");
  if (b) setPage(b.dataset.p);
});

// Gulir mouse di panel juga berpindah halaman (kecuali di daftar yang bisa digulir).
let lastWheel = 0;
document.querySelector(".panel").addEventListener(
  "wheel",
  (e) => {
    if (e.target.closest(".t-list, .n-list, .settings, .shelf-items, .lyrics, .fedit, .w-set")) return;
    e.preventDefault();
    if (Date.now() - lastWheel < 450) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 4) return;
    lastWheel = Date.now();
    step(d > 0 ? 1 : -1);
  },
  { passive: false },
);

/* ================= Buka/tutup notch ================= */

let expanded = false;
let hoverDom = false;
let hoverNative = false;
let pinUntil = 0;
let collapseTimer = null;

const lyricsMode = () => expanded && page === "music" && settings.lyricsOpen;
const expandedSize = () => ({ w: lyricsMode() ? 820 : 660, h: 228 });

function applyLyricsMode() {
  notch.classList.toggle("lyrics-mode", lyricsMode());
}

function expand(pinMs = 0) {
  clearTimeout(collapseTimer);
  if (pinMs) pinUntil = Date.now() + pinMs;
  if (expanded) return;
  expanded = true;
  hidePeekNow();
  mascot.hide();
  notch.classList.remove("collapsed", "peeking", "small", "idle", "dozing", "waving", "wide");
  notch.classList.add("expanded");
  applyLyricsMode();
  renderAll();
}

function collapse() {
  if (!expanded) return;
  expanded = false;
  notch.classList.remove("expanded", "dragging", "lyrics-mode");
  notch.classList.add("collapsed");
  $("fEdit").hidden = true;
  renderMini();
  setTimeout(nextPeek, 450);
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  const wait = Math.max(450, pinUntil - Date.now());
  collapseTimer = setTimeout(() => {
    const typing = document.activeElement && ["INPUT", "SELECT"].includes(document.activeElement.tagName);
    if (hoverDom || hoverNative || (typing && document.hasFocus())) return;
    collapse();
  }, wait);
}

notch.addEventListener("mouseenter", () => {
  hoverDom = true;
  expand();
});
notch.addEventListener("mouseleave", () => {
  hoverDom = false;
  scheduleCollapse();
});
window.addEventListener("blur", () => {
  hoverDom = false;
  scheduleCollapse();
});

// Rust memberi tahu kapan kursor masuk/keluar area notch (lebih andal
// daripada mouseleave karena jendela dibuat tembus klik di luar notch).
listen("lentera-cursor", (e) => {
  hoverNative = !!e.payload;
  if (hoverNative) expand();
  else {
    hoverDom = false;
    scheduleCollapse();
  }
});

document.querySelectorAll("input, select").forEach((el) => el.addEventListener("focus", focusWindow));

window.lentera = {
  openTab(p) {
    setPage(p);
    expand(8000);
  },
  peek: (p) => peek(p),
  collapse() {
    pinUntil = 0;
    hoverDom = hoverNative = false;
    collapse();
  },
};

/* ================= Area yang bisa diklik ================= */

let lastRects = "";
function syncInteractive() {
  const rects = [];
  const r = notch.getBoundingClientRect();
  // Saat sedang membesar, pakai ukuran tujuan supaya kursor tidak "jatuh" keluar.
  const size = expandedSize();
  const w = expanded ? Math.max(r.width, size.w) : r.width;
  // Notch minimal hanya garis tipis: beri area hover yang sedikit lebih tinggi.
  const h = expanded ? Math.max(r.height, size.h) : Math.max(r.height, 10);
  rects.push({ x: r.left + r.width / 2 - w / 2 - 14, y: 0, w: w + 28, h: h + 6 });
  if (mascot.isVisible()) {
    const m = $("mascot").getBoundingClientRect();
    rects.push({ x: m.left, y: m.top, w: m.width, h: m.height });
  }
  const json = JSON.stringify(rects.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))));
  if (json !== lastRects) {
    lastRects = json;
    invoke("set_interactive", { rects: JSON.parse(json) });
  }
  // Tera selalu menempel di sisi kanan notch (di luar lengkungan telinga).
  const left = r.right + 14;
  const bubble = $("bubble");
  $("mascot").style.left = `${left}px`;
  bubble.style.left = `${Math.min(left + 8, window.innerWidth - bubble.offsetWidth - 6)}px`;
}
setInterval(syncInteractive, 60);

/* ================= Kartu sekilas (peek) ================= */

// p: { icon ("i-…" atau emoji), ring (0-100), color, title, body, side, sideIcon,
//      bar (0-100), theme, small, ms, key, urgent }
const peekQueue = [];
let peekCur = null;
let peekTimer = null;

function peek(p) {
  p = { body: "", ms: 5000, ...p };
  if (p.key && peekCur?.key === p.key) {
    showPeek(p);
    return;
  }
  if (p.urgent && peekCur && !expanded) {
    peekQueue.unshift(peekCur);
    showPeek(p);
    return;
  }
  peekQueue.push(p);
  if (peekQueue.length > 8) peekQueue.shift();
  nextPeek();
}

function nextPeek() {
  if (peekCur || expanded || !peekQueue.length) return;
  showPeek(peekQueue.shift());
}

function showPeek(p) {
  peekCur = p;
  const ring = $("peekRing");
  ring.innerHTML = p.icon?.startsWith("i-") ? icon(p.icon) : esc(p.icon || "");
  ring.style.setProperty("--p", p.ring ?? 100);
  ring.style.setProperty("--c", p.color || "#fff");
  ring.style.color = p.iconColor || "#fff";
  $("peekTitle").textContent = p.title || "";
  $("peekBody").textContent = p.body || "";
  $("peekSide").innerHTML = p.sideIcon
    ? `<span class="bubble-icon" style="color:${p.color || "#9fe3ff"}">${icon(p.sideIcon)}</span>`
    : esc(p.side || "");
  $("peekBar").classList.toggle("on", p.bar != null);
  $("peekBar").firstElementChild.style.width = `${p.bar ?? 0}%`;
  if (p.theme) notch.dataset.theme = p.theme;
  else delete notch.dataset.theme;
  notch.classList.toggle("small", !!p.small);
  notch.classList.remove("collapsed", "idle", "dozing", "waving", "wide");
  notch.classList.add("peeking");
  clearTimeout(peekTimer);
  peekTimer = setTimeout(endPeek, p.ms);
}

function clearPeekLook() {
  peekCur = null;
  delete notch.dataset.theme;
  notch.classList.remove("peeking", "small");
}

function endPeek() {
  clearPeekLook();
  if (!expanded) notch.classList.add("collapsed");
  renderMini();
  setTimeout(nextPeek, 450);
}

function hidePeekNow() {
  clearTimeout(peekTimer);
  if (peekCur) clearPeekLook();
}

/* ================= Tera si maskot ================= */

const mascot = createMascot($("mascot"), $("bubble"));
let lastMascot = Date.now();

function mascotContext() {
  const np = upcomingPrayer();
  return {
    name: settings.name.trim(),
    music: media.available ? { playing: media.playing, title: media.title } : null,
    waterPct: Math.round((waterToday() / water.goal) * 100),
    todoLeft: todos.filter((t) => !t.done).length,
    nextPrayer: np ? { name: np.name, minutes: Math.max(0, Math.round((np.time - Date.now()) / 60000)) } : null,
    battery: status.battery,
    timerRunning: timer.cd.running || timer.sw.startAt != null,
  };
}

function mascotSay(action, text, ms) {
  if (!settings.mascotEvery || expanded) return;
  lastMascot = Date.now();
  mascot.show(action, text, ms);
}

$("mascot").addEventListener("click", () => {
  const reactions = [
    ["love", "Hehe, geli! 😆"],
    ["cheer", "Yay! Ada yang nyolek Tera ✨"],
    ["wave", `Iya${settings.name ? ", " + settings.name : ""}? Tera di sini!`],
  ];
  const [a, t] = Math.random() < 0.5 ? reactions[Math.floor(Math.random() * reactions.length)] : chooseLine(mascotContext());
  mascot.show(a, t, 5000);
});

setInterval(() => {
  if (!settings.mascotEvery || expanded || peekCur || mascot.isVisible()) return;
  if (Date.now() - lastMascot < settings.mascotEvery * 60000) return;
  const [action, text] = chooseLine(mascotContext());
  mascotSay(action, text);
}, 5000);

/* ================= Musik + lirik ================= */

let media = { available: false };
let lyrics = { key: "", lines: [], plain: null, instrumental: false, loading: false };
let lyricsBuiltFor = "";

function parseLrc(text) {
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) out.push({ t: (+t[1] * 60 + +t[2]) * 1000, text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}

function mediaPos() {
  if (!media.available) return 0;
  let pos = media.position_ms;
  if (media.playing && media.updated_unix_ms > 0) pos += Date.now() - media.updated_unix_ms;
  return media.duration_ms > 0 ? Math.min(Math.max(pos, 0), media.duration_ms) : Math.max(pos, 0);
}

const fmt = (ms) => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

async function pollMedia() {
  try {
    const m = await invoke("media_info");
    const prevKey = lyrics.key;
    media = m || { available: false };
    const key = media.available ? `${media.title}|${media.artist}` : "";
    if (key && key !== prevKey) {
      lyrics = { key, lines: [], plain: null, instrumental: false, loading: true };
      if (media.playing && Math.random() < 0.35) mascotSay("dance", `Wah, ${media.title}! 🎶`, 4500);
      const res = await invoke("fetch_lyrics", {
        title: media.title,
        artist: media.artist,
        album: media.album || "",
        duration: (media.duration_ms || 0) / 1000,
      }).catch(() => null);
      if (lyrics.key === key) {
        lyrics = {
          key,
          lines: parseLrc(res?.synced),
          plain: res?.plain || null,
          instrumental: !!res?.instrumental,
          loading: false,
        };
      }
    } else if (!key) {
      lyrics = { key: "", lines: [], plain: null, instrumental: false, loading: false };
    }
  } catch {}
}

function currentLyricIndex() {
  const pos = mediaPos() + 250;
  let idx = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if (lyrics.lines[i].t <= pos) idx = i;
    else break;
  }
  return idx;
}

async function seekTo(ms) {
  // Langsung geser tampilan, lalu minta pemutar ikut.
  media.position_ms = ms;
  media.updated_unix_ms = Date.now();
  await invoke("media_seek", { positionMs: Math.round(ms) });
  setTimeout(pollMedia, 300);
}

function renderLyrics() {
  const box = $("lyrics");
  const state = `${lyrics.key}|${lyrics.loading}|${lyrics.lines.length}|${!!lyrics.plain}|${lyrics.instrumental}`;
  if (lyricsBuiltFor !== state) {
    lyricsBuiltFor = state;
    let html;
    if (!media.available) html = `<div class="msg">Tidak ada lagu yang diputar</div>`;
    else if (lyrics.loading) html = `<div class="msg">Memuat lirik…</div>`;
    else if (lyrics.instrumental) html = `<div class="msg">🎼 Instrumental</div>`;
    else if (lyrics.lines.length)
      html = `<div class="lyrics-inner">${lyrics.lines
        .map((l, i) => `<div class="l" data-i="${i}">${esc(l.text) || "♪"}</div>`)
        .join("")}</div>`;
    else if (lyrics.plain)
      html = `<div class="lyrics-inner">${lyrics.plain
        .split(/\n/)
        .filter(Boolean)
        .map((l) => `<div class="l">${esc(l)}</div>`)
        .join("")}</div>`;
    else html = `<div class="msg">Lirik belum tersedia untuk lagu ini</div>`;
    box.innerHTML = html + (lyrics.lines.length || lyrics.plain ? `<span class="credit">LRCLIB</span>` : "");
  }
  if (!lyrics.lines.length) return;
  const i = currentLyricIndex();
  const inner = box.querySelector(".lyrics-inner");
  const lines = inner.children;
  for (let k = 0; k < lines.length; k++) lines[k].classList.toggle("cur", k === i);
  const cur = lines[Math.max(0, i)];
  if (cur) inner.style.transform = `translateY(${box.clientHeight / 2 - cur.offsetTop - cur.offsetHeight / 2}px)`;
}

$("lyrics").addEventListener("click", (e) => {
  const l = e.target.closest(".l[data-i]");
  if (l) seekTo(lyrics.lines[+l.dataset.i].t);
});

$("lyricsBtn").addEventListener("click", () => {
  settings.lyricsOpen = !settings.lyricsOpen;
  saveSettings();
  lyricsBuiltFor = "";
  applyLyricsMode();
  renderMusic();
});

$("seek").addEventListener("click", (e) => {
  if (!media.available || !media.duration_ms) return;
  const r = $("seek").getBoundingClientRect();
  seekTo(((e.clientX - r.left) / r.width) * media.duration_ms);
});

let artFor;
function renderMusic() {
  const has = media.available;
  $("lyricsBtn").innerHTML = icon(settings.lyricsOpen ? "i-lyrics-on" : "i-lyrics");
  $("track").textContent = has ? media.title || "Tanpa judul" : "Tidak ada lagu";
  $("artist").textContent = has ? media.artist || media.app || "" : "Putar dari aplikasi apa saja";
  setHtml($("playBtn"), icon(has && media.playing ? "i-pause" : "i-play"));
  const art = $("art");
  const thumb = has ? media.thumbnail : null;
  if (artFor !== thumb) {
    artFor = thumb;
    art.style.backgroundImage = thumb ? `url("${thumb}")` : "";
    art.innerHTML = thumb ? "" : `<svg style="font-size:38px;color:#8e8e93"><use href="#i-music" /></svg>`;
  }
  const pos = mediaPos();
  const dur = media.duration_ms || 0;
  const pct = dur ? (pos / dur) * 100 : 0;
  $("seekFill").style.width = `${pct}%`;
  $("tPos").textContent = fmt(pos);
  $("tLeft").textContent = `-${fmt(dur - pos)}`;
  if (lyricsMode()) renderLyrics();
}

document.querySelectorAll("[data-media]").forEach((b) =>
  b.addEventListener("click", async () => {
    if (b.dataset.media === "toggle" && media.available) media.playing = !media.playing;
    await invoke("media_control", { action: b.dataset.media });
    setTimeout(pollMedia, 300);
  }),
);

/* ================= Timer & stopwatch ================= */

const timer = load("timer", {
  mode: "countdown",
  cd: { secs: 25 * 60, endAt: null, remaining: 25 * 60 * 1000, running: false, label: "Fokus", repeat: false },
  sw: { startAt: null, acc: 0, laps: [] },
  presets: [
    { label: "Fokus", secs: 25 * 60 },
    { label: "Istirahat", secs: 5 * 60 },
    { label: "Istirahat panjang", secs: 15 * 60 },
    { label: "Masak mie", secs: 3 * 60 },
  ],
});
const saveTimer = () => save("timer", timer);
const RING = 2 * Math.PI * 44;

const hms = (ms, forceH = false) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h || forceH ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
const swElapsed = () => timer.sw.acc + (timer.sw.startAt != null ? Date.now() - timer.sw.startAt : 0);
const cdLeft = () => (timer.cd.running ? timer.cd.endAt - Date.now() : timer.cd.remaining);

function readCdInputs() {
  const h = Math.min(23, Math.max(0, +$("cdH").value || 0));
  const m = Math.min(59, Math.max(0, +$("cdM").value || 0));
  const s = Math.min(59, Math.max(0, +$("cdS").value || 0));
  return h * 3600 + m * 60 + s;
}

function writeCdInputs(secs) {
  $("cdH").value = Math.floor(secs / 3600);
  $("cdM").value = Math.floor((secs % 3600) / 60);
  $("cdS").value = secs % 60;
}

function setCountdown(secs, label) {
  timer.cd = { ...timer.cd, secs, remaining: secs * 1000, endAt: null, running: false, label: label ?? timer.cd.label };
  writeCdInputs(secs);
  $("cdLabel").value = timer.cd.label;
  saveTimer();
  renderTimer();
}

["cdH", "cdM", "cdS"].forEach((id) =>
  $(id).addEventListener("input", () => {
    if (!timer.cd.running) setCountdown(readCdInputs());
  }),
);
$("cdLabel").addEventListener("input", (e) => {
  timer.cd.label = e.target.value;
  saveTimer();
});
$("cdRepeat").addEventListener("change", (e) => {
  timer.cd.repeat = e.target.checked;
  saveTimer();
});

function toggleCountdown() {
  const cd = timer.cd;
  if (cd.running) {
    cd.remaining = Math.max(0, cd.endAt - Date.now());
    cd.running = false;
    cd.endAt = null;
  } else {
    if (cd.remaining <= 0) cd.remaining = cd.secs * 1000;
    if (cd.remaining <= 0) return;
    cd.endAt = Date.now() + cd.remaining;
    cd.running = true;
    sounds.pop();
  }
}

function toggleStopwatch() {
  const sw = timer.sw;
  if (sw.startAt != null) {
    sw.acc += Date.now() - sw.startAt;
    sw.startAt = null;
  } else {
    sw.startAt = Date.now();
    sounds.pop();
  }
}

$("fStart").addEventListener("click", () => {
  if (timer.mode === "countdown") toggleCountdown();
  else toggleStopwatch();
  saveTimer();
  renderTimer();
});

$("fReset").addEventListener("click", () => {
  if (timer.mode === "countdown") setCountdown(timer.cd.secs);
  else {
    timer.sw = { startAt: null, acc: 0, laps: [] };
    saveTimer();
    renderTimer();
  }
});

// Tombol kiri: "Atur" untuk timer, "Putaran" untuk stopwatch.
$("fLeft").addEventListener("click", () => {
  if (timer.mode === "countdown") {
    $("fEdit").hidden = false;
    writeCdInputs(timer.cd.secs);
    $("cdLabel").value = timer.cd.label || "";
    renderPresets();
    focusWindow();
    return;
  }
  if (swElapsed() <= 0) return;
  timer.sw.laps.unshift(swElapsed());
  timer.sw.laps = timer.sw.laps.slice(0, 50);
  saveTimer();
  renderTimer();
});

$("fMode").addEventListener("click", () => {
  timer.mode = timer.mode === "countdown" ? "stopwatch" : "countdown";
  saveTimer();
  renderTimer();
});

$("fEditDone").addEventListener("click", () => {
  $("fEdit").hidden = true;
  renderTimer();
});

$("cdSave").addEventListener("click", () => {
  const secs = readCdInputs();
  if (!secs) return;
  const label = $("cdLabel").value.trim() || hms(secs * 1000);
  timer.presets = timer.presets.filter((p) => p.label !== label).concat({ label, secs });
  saveTimer();
  renderPresets();
});

function renderPresets() {
  $("presets").innerHTML = timer.presets
    .map(
      (p, i) =>
        `<span class="preset" data-i="${i}"><button class="use">${esc(p.label)} · ${esc(hms(p.secs * 1000))}</button><button class="x" title="Hapus">×</button></span>`,
    )
    .join("");
}

$("presets").addEventListener("click", (e) => {
  const el = e.target.closest(".preset");
  if (!el) return;
  const p = timer.presets[+el.dataset.i];
  if (e.target.classList.contains("x")) {
    timer.presets.splice(+el.dataset.i, 1);
    saveTimer();
    renderPresets();
  } else if (p && !timer.cd.running) {
    setCountdown(p.secs, p.label);
  }
});

function tickTimer() {
  const cd = timer.cd;
  if (cd.running && cd.endAt <= Date.now()) {
    const label = cd.label || "Timer";
    sounds.timer();
    peek({ icon: "i-timer", ring: 100, color: "#ff4b55", title: `Waktu habis: ${label}`, body: cd.repeat ? "Timer diulang otomatis" : "Buka notch untuk mengatur ulang", ms: 7000 });
    mascotSay("cheer", `${label} selesai! Kerja bagus 🎉`, 6000);
    if (cd.repeat) {
      cd.endAt = Date.now() + cd.secs * 1000;
    } else {
      cd.running = false;
      cd.endAt = null;
      cd.remaining = 0;
    }
    saveTimer();
  }
}

function renderTimer() {
  const cdMode = timer.mode === "countdown";
  const cd = timer.cd;
  const sw = timer.sw;
  const running = cdMode ? cd.running : sw.startAt != null;
  $("fring").style.setProperty("--c", cdMode ? "#ff4b55" : "#2f8cff");
  $("fring").querySelector(".ficon use").setAttribute("href", cdMode ? "#i-timer" : "#i-flag");
  let frac;
  if (cdMode) {
    $("fClock").textContent = hms(cdLeft(), cd.secs >= 3600);
    frac = cd.secs ? Math.max(0, cdLeft()) / (cd.secs * 1000) : 0;
    $("fSub").textContent = cd.remaining === 0 && !cd.running ? "Selesai ✓" : cd.label || "Timer";
  } else {
    const el = swElapsed();
    $("fClock").textContent = hms(el, el >= 3600000);
    frac = (el % 60000) / 60000;
    const lap = sw.laps.length ? ` · Putaran ${sw.laps.length}: ${hms(sw.laps[0], sw.laps[0] >= 3600000)}` : "";
    $("fSub").textContent = (running ? "Berjalan" : el ? "Dijeda" : "Stopwatch") + lap;
  }
  $("fprg").style.strokeDashoffset = `${RING * (1 - frac)}`;
  setHtml($("fStart"), icon(running ? "i-pause" : "i-play"));
  setHtml($("fLeft"), cdMode ? `${icon("i-sliders")}Atur` : `${icon("i-flag")}Putaran`);
  setHtml($("fMode"), cdMode ? `${icon("i-flag")}Stopwatch` : `${icon("i-timer")}Timer`);
  $("cdRepeat").checked = !!cd.repeat;
}

writeCdInputs(timer.cd.secs);
$("cdLabel").value = timer.cd.label || "";
renderPresets();

/* ================= Jadwal sholat ================= */

const PRAYER_STYLE = {
  imsak: { icon: "🌌", color: "#94a3b8" },
  subuh: { icon: "🌄", color: "#a78bfa" },
  terbit: { icon: "🌅", color: "#94a3b8" },
  dzuhur: { icon: "☀️", color: "#facc15" },
  ashar: { icon: "🌤️", color: "#fb923c" },
  maghrib: { icon: "🌇", color: "#f43f5e" },
  isya: { icon: "🌙", color: "#60a5fa" },
};

function scheduleFor(date) {
  const t = prayerTimes(date, settings.lat, settings.lng);
  const off = (+settings.offset || 0) * 60000;
  const out = {};
  for (const k of Object.keys(t)) out[k] = new Date(t[k].getTime() + off);
  return out;
}

function upcomingPrayer(now = new Date()) {
  const today = scheduleFor(now);
  for (const p of PRAYERS) if (p.fard && today[p.key] > now) return { ...p, time: today[p.key] };
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  return { ...PRAYERS[0], time: scheduleFor(tmr).subuh };
}

const fired = load("prayerFired", {});
function prayerReminders() {
  const now = new Date();
  const today = scheduleFor(now);
  const day = todayKey(now);
  for (const p of PRAYERS.filter((x) => x.fard)) {
    const t = today[p.key].getTime();
    const st = PRAYER_STYLE[p.key];
    const preKey = `${day}-${p.key}-pre`;
    const nowKey = `${day}-${p.key}-now`;
    const pre = (+settings.preMin || 0) * 60000;
    if (pre && now >= t - pre && now < t && !fired[preKey]) {
      fired[preKey] = 1;
      const mins = Math.max(1, Math.round((t - now) / 60000));
      peek({ icon: st.icon, ring: 100 - (mins / settings.preMin) * 100, color: st.color, title: `${mins} menit lagi ${p.name}`, body: `Masuk waktu pukul ${hm(today[p.key])}. Siap-siap wudhu yuk`, side: hm(today[p.key]), theme: p.key, ms: 7000 });
    }
    if (now >= t && now - t < 10 * 60000 && !fired[nowKey]) {
      fired[nowKey] = fired[preKey] = 1;
      if (settings.prayerSound) sounds.prayer();
      peek({ icon: st.icon, ring: 100, color: st.color, title: `Waktunya sholat ${p.name}`, body: settings.city, side: hm(today[p.key]), theme: p.key, ms: 12000 });
      mascotSay("pray", `Sudah masuk waktu ${p.name}. Yuk sholat dulu 🤲`, 9000);
    }
  }
  // Bersihkan catatan hari-hari sebelumnya.
  for (const k of Object.keys(fired)) if (!k.startsWith(day)) delete fired[k];
  save("prayerFired", fired);
}

function renderPrayer() {
  const now = new Date();
  const today = scheduleFor(now);
  const next = upcomingPrayer(now);
  const st = PRAYER_STYLE[next.key];
  const diff = next.time - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  setHtml($("prName"), `<span style="color:${st.color}">${esc(next.name)}</span>`);
  $("prTime").textContent = `${st.icon} ${hm(next.time)}`;
  $("prCount").textContent = `${h ? h + " jam " : ""}${m} mnt ${pad(s)} dtk lagi · ${settings.city}`;
  const html = PRAYERS.map((p) => {
    const t = today[p.key];
    const isNext = next.key === p.key && next.time.toDateString() === now.toDateString();
    const past = t <= now && !isNext;
    return `<div class="pcard p-${p.key} ${p.fard ? "fard" : ""} ${isNext ? "next" : ""} ${past ? "past" : ""}">
      <div class="pi">${PRAYER_STYLE[p.key].icon}</div>
      <div><div class="pn">${p.name}</div><div class="pt">${hm(t)}</div></div>
    </div>`;
  }).join("");
  setHtml($("prList"), html);
}

/* ================= Notifikasi aplikasi lain ================= */

let notifAccess = "allowed";
const notifs = [];

async function pollNotifs() {
  let res;
  try {
    res = await invoke("notifications_poll");
  } catch {
    return;
  }
  if (!res) return;
  notifAccess = res.access;
  for (const n of res.items) {
    notifs.unshift({ ...n, at: new Date() });
    if (settings.notifPeek) peek({ icon: "i-bell", ring: 100, color: "#ff9f0a", title: n.app ? `${n.app}: ${n.title}` : n.title, body: n.body, ms: 5000 });
  }
  notifs.splice(30);
  if (res.items.length && Math.random() < 0.3) mascotSay("shock", `Ada notifikasi dari ${res.items[0].app || "aplikasi"}!`, 3500);
  if (expanded && page === "notif") renderNotifs();
}

function renderNotifs() {
  let html;
  if (notifAccess !== "allowed") {
    html = `<li class="empty">${
      notifAccess === "denied"
        ? "Akses notifikasi ditolak. Izinkan di Pengaturan Windows → Privasi & keamanan → Notifikasi."
        : "Windows belum mengizinkan Lentera membaca notifikasi aplikasi lain di perangkat ini."
    }</li>`;
  } else if (!notifs.length) html = `<li class="empty">Belum ada notifikasi baru sejak Lentera dibuka.</li>`;
  else
    html = notifs
      .map((n) => `<li><div class="na"><span>${esc(n.app)}</span><span>${hm(n.at)}</span></div><div class="nt">${esc(n.title)}</div><div class="nb">${esc(n.body)}</div></li>`)
      .join("");
  setHtml($("notifList"), html);
}

/* ================= Minum air ================= */

const water = load("water", { goal: 2000, glass: 250, from: 7, to: 22, every: 60, enabled: true, log: {}, lastRemind: 0 });
water.glass ??= 250;
water.from ??= 7;
water.to ??= 22;
water.every = +water.every || 60;
water.enabled ??= true;
// Versi lama menyimpan angka saja; ubah jadi { ml, t } supaya bisa digrafikkan per jam.
for (const d of Object.keys(water.log)) water.log[d] = water.log[d].map((x) => (typeof x === "number" ? { ml: x, t: 0 } : x));
const saveWater = () => save("water", water);
const todayLog = () => water.log[todayKey()] || [];
const waterToday = () => todayLog().reduce((a, b) => a + b.ml, 0);
const liters = (ml) => (ml / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 });

function addWater(ml) {
  const k = todayKey();
  const before = waterToday();
  (water.log[k] ||= []).push({ ml, t: Date.now() });
  water.lastRemind = Date.now();
  // Simpan 14 hari terakhir saja.
  Object.keys(water.log)
    .sort()
    .slice(0, -14)
    .forEach((d) => delete water.log[d]);
  saveWater();
  sounds.water();
  if (before < water.goal && waterToday() >= water.goal) {
    peek({ icon: "i-drop", ring: 100, color: "#2f8cff", iconColor: "#5ab4ff", title: "Target minum tercapai!", body: `${liters(water.goal)} L hari ini`, side: "100%" });
    mascotSay("love", "Target minum tercapai! Tera bangga 💙", 6000);
  }
  renderWater();
}

$("waterAdd").addEventListener("click", () => addWater(+water.glass));
$("waterUndo").addEventListener("click", () => {
  water.log[todayKey()]?.pop();
  saveWater();
  renderWater();
});
$("waterSetBtn").addEventListener("click", () => {
  $("waterSet").hidden = !$("waterSet").hidden;
  $("waterChart").hidden = !$("waterSet").hidden;
  $("waterSetBtn").classList.toggle("light", !$("waterSet").hidden);
  renderWater();
});
$("wSwitch").addEventListener("click", () => {
  water.enabled = !water.enabled;
  water.lastRemind = Date.now();
  saveWater();
  renderWater();
});

const GOALS = [1500, 2000, 2500, 3000];
const GLASSES = [200, 250, 330, 500, 600];

function renderWater() {
  const now = waterToday();
  const pct = Math.round((now / water.goal) * 100);
  $("wNow").textContent = liters(now);
  $("wGoal").textContent = liters(water.goal);
  $("wSwitch").classList.toggle("on", !!water.enabled);
  $("wBar").style.width = `${Math.min(100, pct)}%`;
  $("waterAdd").querySelector("span").textContent = `Minum ${water.glass} ml`;
  let sub;
  if (now >= water.goal) sub = `<b>Target tercapai</b> · ${pct}%`;
  else if (!water.enabled) sub = `Pengingat mati · ${pct}%`;
  else {
    const left = Math.max(0, water.every * 60000 - (Date.now() - (water.lastRemind || Date.now())));
    sub = `Pengingat berikutnya <b>${Math.max(1, Math.ceil(left / 60000))} mnt</b>`;
  }
  setHtml($("wSub"), sub);

  if (!$("waterSet").hidden) {
    setHtml($("goalChips"), GOALS.map((g) => `<button data-g="${g}" class="${g === water.goal ? "on" : ""}">${liters(g)} L</button>`).join(""));
    setHtml($("glassChips"), GLASSES.map((g) => `<button data-s="${g}" class="${g === water.glass ? "on" : ""}">${g}</button>`).join(""));
    if (document.activeElement !== $("wFrom")) $("wFrom").value = water.from;
    if (document.activeElement !== $("wTo")) $("wTo").value = water.to;
    $("wEvery").value = String(water.every);
    return;
  }

  // Grafik minum per jam untuk 9 jam terakhir (seperti Nusa).
  const curH = new Date().getHours();
  const hours = Array.from({ length: 9 }, (_, i) => (curH - 8 + i + 24) % 24);
  const perHour = hours.map(() => 0);
  const dayStart = new Date().setHours(0, 0, 0, 0);
  for (const e of todayLog()) {
    if (!e.t || e.t < dayStart) continue;
    const i = hours.indexOf(new Date(e.t).getHours());
    if (i >= 0 && curH - 8 + i >= 0) perHour[i] += e.ml;
  }
  const max = Math.max(500, Math.ceil(Math.max(...perHour) / 250) * 250);
  const bars = perHour.map((v, i) => `<span title="${pad(hours[i])}:00 · ${v} ml"><i style="height:${(v / max) * 100}%"></i></span>`).join("");
  const ticks = hours.map((h, i) => `<span>${i % 2 === 0 ? pad(h) : ""}</span>`).join("");
  const html = `<div class="bars">${bars}</div><div class="axis"><span>${max}</span><span>${max / 2}</span><span>0 ml</span></div><div class="ticks">${ticks}</div>`;
  setHtml($("waterChart"), html);
}

$("goalChips").addEventListener("click", (e) => {
  const g = +e.target.dataset.g;
  if (!g) return;
  water.goal = g;
  saveWater();
  renderWater();
});
$("glassChips").addEventListener("click", (e) => {
  const g = +e.target.dataset.s;
  if (!g) return;
  water.glass = g;
  saveWater();
  renderWater();
});
$("wFrom").addEventListener("change", (e) => {
  water.from = Math.max(0, Math.min(23, +e.target.value || 0));
  saveWater();
});
$("wTo").addEventListener("change", (e) => {
  water.to = Math.max(1, Math.min(24, +e.target.value || 24));
  saveWater();
});
$("wEvery").addEventListener("change", (e) => {
  water.every = +e.target.value;
  saveWater();
});

function waterReminder() {
  if (!water.enabled) return;
  const h = new Date().getHours();
  if (h < water.from || h >= water.to || waterToday() >= water.goal) return;
  if (!water.lastRemind) {
    water.lastRemind = Date.now();
    saveWater();
    return;
  }
  if (Date.now() - water.lastRemind < water.every * 60000) return;
  water.lastRemind = Date.now();
  saveWater();
  sounds.water();
  const pct = Math.round((waterToday() / water.goal) * 100);
  peek({ icon: "i-drop", ring: pct, color: "#2f8cff", iconColor: "#5ab4ff", title: "Waktunya minum", body: `${liters(waterToday())} / ${liters(water.goal)} L hari ini`, side: `${pct}%`, ms: 7000 });
  mascotSay("drink", "Glek glek... ayo minum bareng Tera! 💧", 6500);
}

/* ================= To-do ================= */

let todos = load("todos", []);
const saveTodos = () => save("todos", todos);
let editingId = null;
let editMode = false;

function openTodoForm(t = null) {
  editingId = t?.id ?? null;
  $("todoForm").hidden = false;
  $("todoInput").value = t?.text ?? "";
  $("todoTime").value = t?.time ?? "";
  focusWindow();
  setTimeout(() => $("todoInput").focus(), 30);
}

function closeTodoForm() {
  editingId = null;
  $("todoForm").hidden = true;
}

$("todoAddBtn").addEventListener("click", () => ($("todoForm").hidden ? openTodoForm() : closeTodoForm()));
$("todoCancel").addEventListener("click", closeTodoForm);
$("todoEditBtn").addEventListener("click", () => {
  editMode = !editMode;
  renderTodos();
});

$("todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("todoInput").value.trim();
  if (!text) return;
  const time = $("todoTime").value || null;
  const t = todos.find((x) => x.id === editingId);
  if (t) Object.assign(t, { text, time, alerted: t.time === time ? t.alerted : null });
  else todos.push({ id: Date.now(), text, time, done: false, doneAt: null, alerted: time && time <= hm(new Date()) ? todayKey() : null });
  saveTodos();
  closeTodoForm();
  renderTodos();
});

$("todoList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const t = todos.find((x) => x.id === +li.dataset.id);
  if (!t) return;
  if (e.target.closest(".del")) todos = todos.filter((x) => x !== t);
  else if (e.target.closest(".edit")) return openTodoForm(t);
  else {
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    if (t.done) {
      sounds.done();
      if (!todos.some((x) => !x.done)) mascotSay("cheer", "Semua tugas beres! Kamu keren 🥳", 5000);
    }
  }
  saveTodos();
  renderTodos();
});

const doneToday = (t) => t.done && t.doneAt && todayKey(new Date(t.doneAt)) === todayKey();

function renderTodos() {
  // Tugas yang selesai di hari sebelumnya disembunyikan (dan dibuang dari daftar).
  const before = todos.length;
  todos = todos.filter((t) => !t.done || doneToday(t));
  if (todos.length !== before) saveTodos();
  $("todoEditBtn").classList.toggle("on", editMode);
  document.querySelector(".todo").classList.toggle("editing", editMode);
  const html = todos.length
    ? todos
        .map(
          (t) =>
            `<li data-id="${t.id}" class="${t.done ? "done" : ""}"><span class="check">${t.done ? icon("i-check") : ""}</span><span class="tt">${esc(t.text)}</span>${
              t.time ? `<span class="ttime">${esc(t.time)}</span>` : ""
            }<button class="act edit" title="Ubah">${icon("i-pencil")}</button><button class="act del" title="Hapus">${icon("i-x")}</button></li>`,
        )
        .join("")
    : `<li class="empty">Belum ada tugas. Klik "Tambah" ✍️</li>`;
  setHtml($("todoList"), html);
  const pending = todos.filter((t) => !t.done).length;
  const dt = todos.filter(doneToday).length;
  $("todoScore").textContent = `${dt}/${dt + pending}`;
}

// Ingatkan tugas yang punya jam.
function todoAlerts() {
  const now = new Date();
  const day = todayKey(now);
  const cur = hm(now);
  let changed = false;
  for (const t of todos) {
    if (t.done || !t.time || t.alerted === day || cur < t.time) continue;
    t.alerted = day;
    changed = true;
    // Lewat lebih dari 30 menit (mis. komputer mati): tandai saja tanpa bunyi.
    const [th, tm] = t.time.split(":").map(Number);
    if (now - new Date(now.getFullYear(), now.getMonth(), now.getDate(), th, tm) > 30 * 60000) continue;
    sounds.timer();
    peek({ icon: "i-check", ring: 100, color: "#32d74b", title: t.text, body: `Tugas jam ${t.time}`, ms: 8000 });
    mascotSay("think", `Psst, waktunya: ${t.text}`, 6000);
  }
  if (changed) saveTodos();
}

/* ================= Rak file ================= */

let shelf = load("shelf", []);
const saveShelf = () => save("shelf", shelf);
const EXT_COLORS = {
  pdf: "#ff6b6b", doc: "#64a8ff", docx: "#64a8ff", xls: "#4cd97b", xlsx: "#4cd97b", csv: "#4cd97b", ppt: "#ff9f43", pptx: "#ff9f43",
  png: "#c58bff", jpg: "#c58bff", jpeg: "#c58bff", gif: "#c58bff", webp: "#c58bff", mp3: "#ff7ac6", wav: "#ff7ac6",
  mp4: "#ffd60a", mkv: "#ffd60a", mov: "#ffd60a", zip: "#b0b0b5", rar: "#b0b0b5", txt: "#e5e5ea", exe: "#98a2b3",
};
const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase().slice(0, 4) : "");
const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const humanSize = (b) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    b /= 1024;
    i++;
  } while (b >= 1024 && i < u.length - 1);
  return `${b.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${u[i]}`;
};

function addToShelf(paths) {
  let added = 0;
  for (const path of paths || []) {
    if (shelf.some((f) => f.path === path)) continue;
    shelf.push({ path, name: baseName(path), added: Date.now() });
    added++;
  }
  if (added) {
    saveShelf();
    sounds.pop();
    renderShelf();
  }
}

async function renderShelf() {
  $("shelfEmpty").style.display = shelf.length ? "none" : "";
  $("shelfClear").style.display = shelf.length ? "" : "none";
  const infos = await Promise.all(shelf.map((f) => invoke("file_info", { path: f.path }).catch(() => null)));
  $("shelfItems").innerHTML = shelf
    .map((f, i) => {
      const info = infos[i] || { exists: true, is_dir: false, size: 0 };
      const ext = extOf(f.name);
      const fi = info.is_dir
        ? `<div class="ficon folder">${icon("i-folder")}</div>`
        : `<div class="ficon" style="background:${EXT_COLORS[ext] || "#d1d1d6"}">${esc(ext.toUpperCase() || "FILE")}</div>`;
      const meta = !info.exists ? "Tidak ditemukan" : info.is_dir ? "Folder" : humanSize(info.size);
      return `<li class="file ${info.exists ? "" : "missing"}" data-i="${i}" title="${esc(f.path)}">
        ${fi}<div class="fname">${esc(f.name)}</div><div class="fsize">${meta}</div>
        <button class="fx" title="Keluarkan dari rak">${icon("i-x")}</button>
      </li>`;
    })
    .join("");
}

function dragIcon(name) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const ext = extOf(name);
  g.fillStyle = EXT_COLORS[ext] || "#d1d1d6";
  g.beginPath();
  g.roundRect(10, 4, 44, 56, 8);
  g.fill();
  g.fillStyle = "#111";
  g.font = "bold 13px Segoe UI, sans-serif";
  g.textAlign = "center";
  g.fillText((ext || "file").toUpperCase(), 32, 38);
  return c.toDataURL("image/png");
}

let dragState = null;
$("shelfItems").addEventListener("mousedown", (e) => {
  const el = e.target.closest(".file");
  if (!el || e.button !== 0 || e.target.closest(".fx")) return;
  dragState = { i: +el.dataset.i, x: e.clientX, y: e.clientY, started: false };
});
window.addEventListener("mousemove", (e) => {
  if (!dragState || dragState.started) return;
  if (Math.hypot(e.clientX - dragState.x, e.clientY - dragState.y) > 5) {
    dragState.started = true;
    const f = shelf[dragState.i];
    if (f) startDrag([f.path], dragIcon(f.name)).catch(() => {});
  }
});
window.addEventListener("mouseup", (e) => {
  if (dragState && !dragState.started) {
    const f = shelf[dragState.i];
    if (f && e.target.closest(".file")) invoke("open_file", { path: f.path });
  }
  dragState = null;
});
$("shelfItems").addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".file");
  if (!el) return;
  e.preventDefault();
  const f = shelf[+el.dataset.i];
  if (f) invoke("reveal_file", { path: f.path });
});
$("shelfItems").addEventListener("click", (e) => {
  const el = e.target.closest(".file");
  if (!el || !e.target.closest(".fx")) return;
  shelf.splice(+el.dataset.i, 1);
  saveShelf();
  renderShelf();
});
$("shelfClear").addEventListener("click", () => {
  shelf = [];
  saveShelf();
  renderShelf();
});

// File diseret dari Explorer ke notch.
listen("tauri://drag-enter", () => {
  setPage("shelf");
  expand(4000);
  notch.classList.add("dragging");
  $("shelfDropText").textContent = "Lepas untuk menambah";
  $("shelfEmpty").style.display = "";
});
listen("tauri://drag-leave", () => {
  notch.classList.remove("dragging");
  $("shelfDropText").textContent = "Tarik file ke sini";
  renderShelf();
  scheduleCollapse();
});
listen("tauri://drag-drop", (e) => {
  notch.classList.remove("dragging");
  $("shelfDropText").textContent = "Tarik file ke sini";
  addToShelf(e.payload?.paths);
  renderShelf();
  expand(2500);
  scheduleCollapse();
});

/* ================= Status perangkat ================= */

let status = { battery: { present: false }, network: { connected: true, internet: true }, bluetooth: [] };
let statusReady = false;

const batteryColor = (b) => (b.plugged ? "#32d74b" : b.percent <= 20 ? "#ff453a" : "#32d74b");

function batteryRing(el) {
  const b = status.battery;
  el.style.display = b.present ? "" : "none";
  el.style.setProperty("--p", b.percent ?? 0);
  el.style.setProperty("--c", batteryColor(b));
  el.title = b.present ? `Baterai ${b.percent}%${b.plugged ? " · mengisi" : ""}` : "";
}

async function pollStatus() {
  let s;
  try {
    s = await invoke("system_status");
  } catch {
    return;
  }
  if (!s) return;
  if (statusReady) {
    const ob = status.battery;
    const nb = s.battery;
    if (nb.present && nb.plugged && !ob.plugged) {
      peek({ icon: "i-bolt", ring: nb.percent, color: "#32d74b", title: "Mengisi daya", body: "Charger tersambung", side: `${nb.percent}%`, ms: 3500 });
    }
    if (nb.present && !nb.plugged) {
      for (const lvl of [20, 10]) {
        if (ob.percent > lvl && nb.percent <= lvl) {
          peek({ icon: "i-battery-low", ring: nb.percent, color: "#ff453a", iconColor: "#ff453a", title: lvl === 10 ? "Baterai kritis" : "Baterai lemah", body: "Colokkan charger ya", side: `${nb.percent}%` });
          mascotSay("shock", `Baterai tinggal ${nb.percent}%! 😱`, 5000);
        }
      }
    }
    if (nb.present && nb.plugged && nb.percent >= 100 && ob.percent < 100) {
      peek({ icon: "i-bolt", ring: 100, color: "#32d74b", title: "Baterai penuh", body: "Charger boleh dicabut", side: "100%" });
    }
    if (status.network.internet && !s.network.internet) {
      peek({ icon: "i-wifi-off", ring: 100, color: "#ffd60a", title: "Wi-Fi terputus", body: s.network.connected ? "Tersambung, tapi tanpa internet" : "Tidak ada jaringan" });
    } else if (!status.network.internet && s.network.internet) {
      peek({ icon: "i-wifi", ring: 100, color: "#32d74b", title: "Kembali online", body: s.network.name || "", ms: 3000 });
    }
    for (const d of s.bluetooth)
      if (!status.bluetooth.includes(d)) peek({ icon: "i-bt", ring: 100, color: "#2f8cff", title: d, body: "Tersambung", sideIcon: "i-headphones", ms: 3500 });
    for (const d of status.bluetooth)
      if (!s.bluetooth.includes(d)) peek({ icon: "i-bt", ring: 0, color: "#8e8e93", title: d, body: "Terputus", sideIcon: "i-headphones", ms: 3000 });
  }
  status = s;
  statusReady = true;
}

/* ================= Volume, Caps Lock, bahasa keyboard ================= */

const langName = (code) => {
  try {
    return new Intl.DisplayNames(["id"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
};

listen("lentera-input", (e) => {
  const ev = e.payload || {};
  if (!settings.overlays || expanded) return;
  if (ev.kind === "volume") {
    const muted = ev.muted || ev.volume === 0;
    peek({ key: "volume", urgent: true, small: true, icon: muted ? "i-mute" : "i-vol", ring: muted ? 0 : ev.volume, color: "#fff", title: muted ? "Bisu" : "Volume", side: muted ? "" : `${ev.volume}`, bar: muted ? 0 : ev.volume, ms: 1500 });
  } else if (ev.kind === "caps") {
    peek({ key: "caps", urgent: true, small: true, icon: "i-caps", ring: ev.caps ? 100 : 0, color: "#32d74b", title: ev.caps ? "Caps Lock aktif" : "Caps Lock mati", ms: 1300 });
  } else if (ev.kind === "lang") {
    peek({ key: "lang", urgent: true, small: true, icon: "i-key", ring: 100, color: "#2f8cff", title: langName(ev.lang), side: ev.lang.split("-")[0].toUpperCase(), ms: 1500 });
  }
});

/* ================= Mata maskot saat komputer diam ================= */

const IDLE_EYES = 45 * 1000;
const IDLE_DOZE = 3 * 60 * 1000;
let idleLevel = 0; // 0 aktif, 1 mata terbuka, 2 tertidur
let wavingUntil = 0;
let lastLocalInput = Date.now();
["mousemove", "keydown", "mousedown"].forEach((ev) => window.addEventListener(ev, () => (lastLocalInput = Date.now())));

async function pollIdle() {
  const idle = isTauri ? await invoke("idle_ms").catch(() => 0) : Date.now() - lastLocalInput;
  const level = idle >= IDLE_DOZE ? 2 : idle >= IDLE_EYES ? 1 : 0;
  if (idleLevel > 0 && level === 0) wavingUntil = Date.now() + 2600;
  idleLevel = level;
}

function eyesAllowed() {
  return settings.eyes && !expanded && !peekCur && !(media.available && media.playing) && !timer.cd.running && timer.sw.startAt == null;
}

/* ================= Notch tertutup ================= */

function renderMini() {
  const now = new Date();
  const next = upcomingPrayer(now);
  const minsToPrayer = (next.time - now) / 60000;
  const st = PRAYER_STYLE[next.key];
  const pre = +settings.preMin || 10;
  const prayerSoon = minsToPrayer <= pre;
  const playing = media.available && media.playing;

  // Prioritas teks: sholat sebentar lagi > timer berjalan > lirik.
  let text = "";
  if (prayerSoon) text = `<span style="color:${st.color}">${st.icon} ${next.name} ${Math.max(1, Math.ceil(minsToPrayer))} mnt lagi</span>`;
  else if (timer.cd.running) text = `<span style="color:#ff4b55">⏱ ${hms(cdLeft())}</span>${timer.cd.label ? ` · ${esc(timer.cd.label)}` : ""}`;
  else if (timer.sw.startAt != null) text = `<span style="color:#5ab4ff">⏱ ${hms(swElapsed(), true)}</span>`;
  else if (settings.miniLyrics && playing && lyrics.lines.length) text = esc(lyrics.lines[currentLyricIndex()]?.text || "♪");

  const waving = Date.now() < wavingUntil;
  const showEyes = !expanded && !peekCur && eyesAllowed() && (idleLevel > 0 || waving);
  notch.classList.toggle("idle", showEyes);
  notch.classList.toggle("dozing", showEyes && idleLevel === 2);
  notch.classList.toggle("waving", showEyes && waving && idleLevel === 0);
  notch.classList.toggle("minimal", !!settings.minimal);
  notch.classList.toggle("has-text", !!text);
  notch.classList.toggle("wide", !!text && !expanded && !peekCur);
  notch.classList.toggle("glow", prayerSoon && !peekCur);
  if (prayerSoon) notch.style.setProperty("--accent", st.color);
  else notch.style.removeProperty("--accent");

  batteryRing($("miniRing"));
  $("miniWave").classList.toggle("on", playing);
  $("miniWave").style.visibility = media.available ? "" : "hidden";
  const clock = hm(now);
  if ($("miniClock").textContent !== clock) $("miniClock").textContent = clock;
  setHtml($("miniText"), text);
}

/* ================= Kepala panel ================= */

function titleFor(p) {
  if (p === "music") return "";
  if (p === "timer") return timer.mode === "countdown" ? "Timer" : "Stopwatch";
  if (p === "prayer") {
    const st = PRAYER_STYLE[upcomingPrayer().key];
    return `Jadwal <em style="color:${st.color}">Sholat</em>`;
  }
  if (p === "water") return `Pengingat <em style="color:#2f8cff">Minum</em>`;
  if (p === "shelf") return "Rak";
  if (p === "todo") return `Daftar<em style="color:#32d74b">Tugas</em>`;
  if (p === "notif") return "Notifikasi";
  return "Pengaturan";
}

function renderHead() {
  const now = new Date();
  setHtml($("ptitle"), titleFor(page));
  $("clockBig").textContent = hm(now);
  $("dateBig").textContent = now.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
  batteryRing($("headRing"));
  $("headWave").classList.toggle("on", media.available && media.playing);
  $("headWave").style.visibility = media.available ? "" : "hidden";
}

/* ================= Pengaturan ================= */

function initSettings() {
  const sel = $("setCity");
  sel.innerHTML =
    CITIES.map(([name]) => `<option value="${esc(name)}">${esc(name)}</option>`).join("") + `<option value="__custom">Lainnya (atur sendiri)</option>`;
  const isCustom = !CITIES.some(([n]) => n === settings.city);
  sel.value = isCustom ? "__custom" : settings.city;
  $("customLoc").hidden = !isCustom;
  $("setLat").value = settings.lat;
  $("setLng").value = settings.lng;
  $("setName").value = settings.name;
  $("setPreMin").value = String(settings.preMin);
  $("setOffset").value = settings.offset;
  $("setMascot").value = String(settings.mascotEvery);
  for (const [id, key] of [
    ["setPrayerSound", "prayerSound"],
    ["setEyes", "eyes"],
    ["setMinimal", "minimal"],
    ["setMiniLyrics", "miniLyrics"],
    ["setNotifPeek", "notifPeek"],
    ["setOverlays", "overlays"],
  ]) {
    $(id).checked = !!settings[key];
    $(id).addEventListener("change", (e) => {
      settings[key] = e.target.checked;
      saveSettings();
      renderAll();
    });
  }
  autostart.get().then((on) => ($("setAutostart").checked = on));
  $("setAutostart").addEventListener("change", (e) => autostart.set(e.target.checked).catch(() => {}));

  sel.addEventListener("change", () => {
    if (sel.value === "__custom") {
      settings.city = "Lokasi saya";
      $("customLoc").hidden = false;
    } else {
      const c = CITIES.find(([n]) => n === sel.value);
      Object.assign(settings, { city: c[0], lat: c[1], lng: c[2] });
      $("setLat").value = c[1];
      $("setLng").value = c[2];
      $("customLoc").hidden = true;
    }
    saveSettings();
  });
  const bind = (id, key, conv) =>
    $(id).addEventListener("change", (e) => {
      settings[key] = conv(e.target.value);
      saveSettings();
      renderAll();
    });
  bind("setLat", "lat", Number);
  bind("setLng", "lng", Number);
  bind("setName", "name", (v) => v.trim());
  bind("setPreMin", "preMin", Number);
  bind("setOffset", "offset", (v) => Math.max(-15, Math.min(15, Number(v) || 0)));
  bind("setMascot", "mascotEvery", Number);

  let armed = false;
  $("resetAll").addEventListener("click", (e) => {
    if (!armed) {
      armed = true;
      e.target.textContent = "Yakin? Klik sekali lagi untuk menghapus";
      setTimeout(() => {
        armed = false;
        e.target.textContent = "Hapus semua data Lentera";
      }, 4000);
      return;
    }
    clearAll();
    location.reload();
  });
}

/* ================= Putaran utama ================= */

function renderAll() {
  renderMini();
  if (!expanded) return;
  renderHead();
  if (page === "music") renderMusic();
  if (page === "timer") renderTimer();
  if (page === "prayer") renderPrayer();
  if (page === "water") renderWater();
  if (page === "todo") renderTodos();
  if (page === "notif") renderNotifs();
}

initSettings();
setPage(page);
renderTodos();
renderWater();
renderTimer();

setInterval(() => {
  tickTimer();
  renderAll();
}, 250);
setInterval(prayerReminders, 5000);
setInterval(waterReminder, 30000);
setInterval(todoAlerts, 15000);
setInterval(pollMedia, 1000);
setInterval(pollIdle, 1000);
setInterval(pollStatus, 5000);
setInterval(pollNotifs, 3000);
pollMedia();
pollStatus();
pollNotifs();
prayerReminders();
todoAlerts();

// Sapaan pertama setelah Lentera dibuka.
setTimeout(() => {
  const [a, t] = chooseLine({ ...mascotContext(), music: null, todoLeft: 0, waterPct: null });
  mascotSay(a === "sleep" ? "sleep" : "wave", t, 6000);
}, 2500);
