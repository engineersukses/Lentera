import { invoke, listen, startDrag, focusWindow, autostart, isTauri, pickFiles } from "./bridge.js";
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
  minimal: true,
  miniLyrics: true,
  prayerSrc: "online",
  myqId: null,
  myqName: "",
  notifPeek: true,
  overlays: true,
  lyricsOpen: false,
};
const settings = { ...DEFAULTS, ...load("settings", {}) };
const saveSettings = () => save("settings", settings);

// Versi 2: tampilan berbahasa Inggris, notch setengah ukuran, garis tipis saat tidak dipakai.
if (!settings.v2) {
  Object.assign(settings, { v2: true, minimal: true, scale: 0.5 });
  if (settings.city === "Singapura") settings.city = "Singapore";
  saveSettings();
}

// Ukuran notch: seluruh tampilan diperkecil dengan CSS zoom.
// Ukuran notch dikunci di 60%; seluruh tampilan diperkecil dengan CSS zoom.
const ZOOM = 0.6;
const zoom = () => ZOOM;
document.documentElement.style.zoom = ZOOM;

/* ================= Halaman (panah kiri/kanan + titik) ================= */

const PAGES = ["music", "timer", "prayer", "water", "shelf", "convert", "todo", "notif"];
let page = PAGES.includes(load("page", "music")) ? load("page", "music") : "music";
let settingsOpen = false;
let gearTurns = 0;

// Pengaturan bukan halaman geser: dibuka lewat ikon gerigi di kiri atas.
function showSettings(on) {
  settingsOpen = on;
  gearTurns++;
  $("gearBtn").querySelector("svg").style.transform = `rotate(${gearTurns * 90}deg)`;
  $("gearBtn").classList.toggle("on", on);
  notch.dataset.page = on ? "settings" : page;
  applyLyricsMode();
  renderAll();
}

$("gearBtn").addEventListener("click", () => showSettings(!settingsOpen));

function setPage(p) {
  if (p === "settings") return showSettings(true);
  if (settingsOpen) {
    settingsOpen = false;
    $("gearBtn").classList.remove("on");
  }
  page = p;
  notch.dataset.page = p;
  save("page", p);
  setHtml($("dots"), PAGES.map((x) => `<button data-p="${x}" class="${x === p ? "on" : ""}"></button>`).join(""));
  if (p === "shelf") renderShelf();
  if (p === "convert") renderConvert();
  if (p === "music") lyricsBuiltFor = "";
  if (p !== "timer") $("fEdit").hidden = true;
  if (p !== "water" && !$("waterSet").hidden) waterAdjust(false);
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

const lyricsMode = () => expanded && !settingsOpen && page === "music" && settings.lyricsOpen;
// Halaman sholat sedikit lebih lebar supaya enam kartu waktunya muat.
const expandedSize = () => ({
  w: lyricsMode() ? 820 : notch.dataset.page === "prayer" ? 730 : 660,
  h: notch.dataset.page === "convert" ? 300 : 228,
});

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
  if (settingsOpen) {
    settingsOpen = false;
    $("gearBtn").classList.remove("on");
    notch.dataset.page = page;
  }
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
  convert(paths) {
    setPage("convert");
    startConvert(paths);
    expand(15000);
  },
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
  // getBoundingClientRect sudah memperhitungkan zoom (piksel layar CSS).
  const z = zoom();
  const r = notch.getBoundingClientRect();
  // Saat sedang membesar, pakai ukuran tujuan supaya kursor tidak "jatuh" keluar.
  const size = expandedSize();
  // Garis tipis tetap punya area hover yang cukup besar untuk disentuh kursor.
  const w = expanded ? Math.max(r.width, size.w * z) : Math.max(r.width, 140);
  const h = expanded ? Math.max(r.height, size.h * z) : Math.max(r.height, 12);
  rects.push({ x: r.left + r.width / 2 - w / 2 - 14 * z, y: 0, w: w + 28 * z, h: h + 6 });
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
  // Posisi style dihitung dalam satuan sebelum zoom.
  // Hanya diperbarui saat Spidey tampil, dan hanya kalau posisinya berubah.
  if (!mascot.isVisible()) return;
  const left = `${r.right / z + 14}px`;
  const bubble = $("bubble");
  if ($("mascot").style.left !== left) $("mascot").style.left = left;
  const bl = `${Math.min(parseFloat(left) + 104, window.innerWidth / z - bubble.offsetWidth - 6)}px`;
  if (bubble.style.left !== bl) bubble.style.left = bl;
}
setInterval(syncInteractive, 100);


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
  syncInteractive();
}

$("mascot").addEventListener("click", () => {
  const reactions = [
    ["love", "Hehe, that tickles! 😆"],
    ["cheer", "Hey! My spider-sense tingled ✨"],
    ["wave", `Yes${settings.name ? ", " + settings.name : ""}? Spidey is here!`],
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
    // Sampul album hanya dikirim ulang kalau lagunya berganti.
    const m = await invoke("media_info", { thumbKey: media.thumb_key || "" });
    const prevKey = lyrics.key;
    if (m && m.available && !m.thumbnail && m.thumb_key && m.thumb_key === media.thumb_key) m.thumbnail = media.thumbnail;
    media = m || { available: false };
    const key = media.available ? `${media.title}|${media.artist}` : "";
    if (key && key !== prevKey) {
      lyrics = { key, lines: [], plain: null, instrumental: false, loading: true };
      if (media.playing && Math.random() < 0.35) mascotSay("dance", `Ooh, ${media.title}! 🎶`, 4500);
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
    if (!media.available) html = `<div class="msg">Nothing is playing</div>`;
    else if (lyrics.loading) html = `<div class="msg">Loading lyrics…</div>`;
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
    else html = `<div class="msg">No lyrics available for this song</div>`;
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

// Tombol lirik membuka tampilan lirik penuh; tombol kecil di pojok menutupnya lagi.
$("lyricsBack").addEventListener("click", () => $("lyricsBtn").click());

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
  $("track").textContent = has ? media.title || "Untitled" : "Nothing playing";
  $("artist").textContent = has ? media.artist || media.app || "" : "Play music in any app";
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
  cd: { secs: 25 * 60, endAt: null, remaining: 25 * 60 * 1000, running: false, label: "Focus", repeat: false },
  sw: { startAt: null, acc: 0, laps: [] },
  presets: [
    { label: "Focus", secs: 25 * 60 },
    { label: "Break", secs: 5 * 60 },
    { label: "Long break", secs: 15 * 60 },
    { label: "Noodles", secs: 3 * 60 },
  ],
});
const saveTimer = () => save("timer", timer);
{
  // Nama preset bawaan lama (bahasa Indonesia) diganti ke bahasa Inggris.
  const EN = { Fokus: "Focus", Istirahat: "Break", "Istirahat panjang": "Long break", "Masak mie": "Noodles" };
  for (const p of timer.presets) p.label = EN[p.label] ?? p.label;
  timer.cd.label = EN[timer.cd.label] ?? timer.cd.label;
}
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
        `<span class="preset" data-i="${i}"><button class="use">${esc(p.label)} · ${esc(hms(p.secs * 1000))}</button><button class="x" title="Delete">×</button></span>`,
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
    peek({ icon: "i-timer", ring: 100, color: "#ff4b55", title: `Time's up: ${label}`, body: cd.repeat ? "Timer restarted automatically" : "Open the notch to set it again", ms: 7000 });
    mascotSay("cheer", `${label} done! Great job 🎉`, 6000);
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
    $("fSub").textContent = cd.remaining === 0 && !cd.running ? "Done ✓" : cd.label || "Timer";
  } else {
    const el = swElapsed();
    $("fClock").textContent = hms(el, el >= 3600000);
    frac = (el % 60000) / 60000;
    const lap = sw.laps.length ? ` · Lap ${sw.laps.length}: ${hms(sw.laps[0], sw.laps[0] >= 3600000)}` : "";
    $("fSub").textContent = (running ? "Running" : el ? "Paused" : "Stopwatch") + lap;
  }
  $("fprg").style.strokeDashoffset = `${RING * (1 - frac)}`;
  setHtml($("fStart"), icon(running ? "i-pause" : "i-play"));
  setHtml($("fLeft"), cdMode ? `${icon("i-sliders")}Set` : `${icon("i-flag")}Lap`);
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

/* Jadwal online:
 * - Kota di Indonesia: data resmi Kemenag RI (Bimas Islam) lewat api.myquran.com.
 * - Kuala Lumpur / Singapura / koordinat sendiri: api.aladhan.com (metode JAKIM, MUIS, atau Kemenag).
 * Jadwal sebulan disimpan dan diperbarui tiap 6 jam, jadi perubahan jadwal ikut terbawa.
 * Kalau internet mati dan belum ada data, pakai hitungan offline. */
const FOREIGN = { "Kuala Lumpur": 17, Singapore: 11 };
const KEYS = ["imsak", "subuh", "terbit", "dzuhur", "ashar", "maghrib", "isya"];
const prayerCache = load("prayerCache", {});
let prayerFetching = false;
let prayerError = "";

function prayerSourceKey() {
  if (settings.myqId) return `myq:${settings.myqId}`;
  const method = FOREIGN[settings.city] ?? 20;
  return `ala:${method}:${(+settings.lat).toFixed(3)},${(+settings.lng).toFixed(3)}`;
}

const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

async function resolveMyqId() {
  // Kota dari daftar populer: cari ID kotanya di myquran sekali saja.
  if (settings.myqId || FOREIGN[settings.city] || !CITIES.some(([n]) => n === settings.city)) return;
  const name = { Solo: "Surakarta" }[settings.city] || settings.city;
  const res = await invoke("http_json", { url: `https://api.myquran.com/v2/sholat/kota/cari/${encodeURIComponent(name)}` });
  const list = res?.data || [];
  const want = `KOTA ${name.toUpperCase()}`;
  const hit = list.find((c) => c.lokasi === want) || list.find((c) => c.lokasi.endsWith(name.toUpperCase())) || list[0];
  if (hit) {
    settings.myqId = hit.id;
    settings.myqName = hit.lokasi;
    saveSettings();
  }
}

async function fetchPrayerMonth(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const days = {};
  if (settings.myqId) {
    const res = await invoke("http_json", { url: `https://api.myquran.com/v2/sholat/jadwal/${settings.myqId}/${y}/${pad(m)}` });
    for (const j of res?.data?.jadwal || []) days[j.date] = Object.fromEntries(KEYS.map((k) => [k, j[k]]));
  } else {
    const method = FOREIGN[settings.city] ?? 20;
    // Kemenag memakai ihtiyat (pengaman) sekitar 2 menit; aladhan belum, jadi ditambahkan lewat tune.
    const tune = method === 20 ? "&tune=3,3,-3,3,2,3,0,2,0" : "";
    const res = await invoke("http_json", {
      url: `https://api.aladhan.com/v1/calendar/${y}/${m}?latitude=${settings.lat}&longitude=${settings.lng}&method=${method}${tune}`,
    });
    const map = { imsak: "Imsak", subuh: "Fajr", terbit: "Sunrise", dzuhur: "Dhuhr", ashar: "Asr", maghrib: "Maghrib", isya: "Isha" };
    for (const e of res?.data || []) {
      const [dd, mm, yy] = e.date.gregorian.date.split("-");
      days[`${yy}-${mm}-${dd}`] = Object.fromEntries(KEYS.map((k) => [k, String(e.timings[map[k]]).slice(0, 5)]));
    }
  }
  return Object.keys(days).length ? days : null;
}

async function refreshPrayer(force = false) {
  if (settings.prayerSrc !== "online" || prayerFetching) return;
  prayerFetching = true;
  try {
    await resolveMyqId();
    const now = new Date();
    const months = [now, new Date(now.getFullYear(), now.getMonth() + 1, 1)];
    const keep = new Set();
    for (const d of months) {
      const key = `${prayerSourceKey()}|${monthKey(d)}`;
      keep.add(key);
      const c = prayerCache[key];
      if (!force && c && Date.now() - c.fetched < 6 * 3600000) continue;
      const days = await fetchPrayerMonth(d);
      if (days) prayerCache[key] = { fetched: Date.now(), days };
    }
    for (const k of Object.keys(prayerCache)) if (!keep.has(k)) delete prayerCache[k];
    save("prayerCache", prayerCache);
    prayerError = "";
  } catch (e) {
    prayerError = String(e?.message || e || "offline");
  } finally {
    prayerFetching = false;
    renderPrayerSource();
  }
}

function onlineDay(date) {
  if (settings.prayerSrc !== "online") return null;
  const c = prayerCache[`${prayerSourceKey()}|${monthKey(date)}`];
  return c?.days[todayKey(date)] || null;
}

function prayerSourceLabel() {
  if (onlineDay(new Date())) return settings.myqId ? "Kemenag RI" : FOREIGN[settings.city] ? "Aladhan" : "Aladhan · Kemenag";
  return "Offline calc";
}

function renderPrayerSource() {
  const el = $("prayerSrcInfo");
  if (!el) return;
  const on = !!onlineDay(new Date());
  const c = prayerCache[`${prayerSourceKey()}|${monthKey(new Date())}`];
  el.textContent =
    settings.prayerSrc !== "online"
      ? "Using offline calculation (Kemenag method)."
      : on
        ? `Source: ${prayerSourceLabel()}${settings.myqName ? " · " + settings.myqName : ""} · updated ${hm(new Date(c.fetched))}`
        : prayerFetching
          ? "Downloading prayer times…"
          : "Couldn't reach the prayer times server, using offline calculation for now.";
}

function scheduleFor(date) {
  const off = (+settings.offset || 0) * 60000;
  const out = {};
  const day = onlineDay(date);
  if (day) {
    for (const k of KEYS) {
      const [h, m] = String(day[k]).split(":").map(Number);
      out[k] = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0 + off);
    }
    return out;
  }
  const t = prayerTimes(date, settings.lat, settings.lng);
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
      peek({ icon: st.icon, ring: 100 - (mins / settings.preMin) * 100, color: st.color, title: `${p.name} in ${mins} min`, body: `Starts at ${hm(today[p.key])}. Time to get ready for wudu`, side: hm(today[p.key]), theme: p.key, ms: 7000 });
    }
    if (now >= t && now - t < 10 * 60000 && !fired[nowKey]) {
      fired[nowKey] = fired[preKey] = 1;
      if (settings.prayerSound) sounds.prayer();
      peek({ icon: st.icon, ring: 100, color: st.color, title: `It's time for ${p.name}`, body: settings.city, side: hm(today[p.key]), theme: p.key, ms: 12000 });
      mascotSay("pray", `It's ${p.name} time. Let's pray first 🤲`, 9000);
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
  $("prCount").textContent = `${h ? h + "h " : ""}${m}m ${pad(s)}s left · ${settings.city} · ${prayerSourceLabel()}`;
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
  if (res.items.length && Math.random() < 0.3) mascotSay("shock", `New notification from ${res.items[0].app || "an app"}!`, 3500);
  if (expanded && page === "notif") renderNotifs();
}

function renderNotifs() {
  let html;
  if (notifAccess !== "allowed") {
    html = `<li class="empty">${
      notifAccess === "denied"
        ? "Notification access denied. Allow it in Windows Settings → Privacy & security → Notifications."
        : "Windows doesn't let Spidey read other apps' notifications on this device yet."
    }</li>`;
  } else if (!notifs.length) html = `<li class="empty">No new notifications since Spidey started.</li>`;
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
const liters = (ml) => (ml / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });

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
    peek({ icon: "i-drop", ring: 100, color: "#2f8cff", iconColor: "#5ab4ff", title: "Water goal reached!", body: `${liters(water.goal)} L today`, side: "100%" });
    mascotSay("love", "Water goal reached! Spidey is proud 💙", 6000);
  }
  renderWater();
}

$("waterAdd").addEventListener("click", () => addWater(+water.glass));
$("waterUndo").addEventListener("click", () => {
  water.log[todayKey()]?.pop();
  saveWater();
  renderWater();
});
// "Adjust" membuka pengaturan air sebagai halaman tersendiri di dalam panel.
function waterAdjust(on) {
  $("waterSet").hidden = !on;
  $("waterChart").hidden = on;
  document.querySelector(".water").classList.toggle("adjusting", on);
  renderAll();
}
$("waterSetBtn").addEventListener("click", () => waterAdjust(true));
$("waterSetDone").addEventListener("click", () => waterAdjust(false));
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
  $("waterAdd").querySelector("span").textContent = `Drink ${water.glass} ml`;
  let sub;
  if (now >= water.goal) sub = `<b>Goal reached</b> · ${pct}%`;
  else if (!water.enabled) sub = `Reminder off · ${pct}%`;
  else {
    const left = Math.max(0, water.every * 60000 - (Date.now() - (water.lastRemind || Date.now())));
    sub = `Next reminder in <b>${Math.max(1, Math.ceil(left / 60000))} min</b>`;
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
  peek({ icon: "i-drop", ring: pct, color: "#2f8cff", iconColor: "#5ab4ff", title: "Time to drink", body: `${liters(waterToday())} / ${liters(water.goal)} L today`, side: `${pct}%`, ms: 7000 });
  mascotSay("drink", "Gulp gulp... drink with Spidey! 💧", 6500);
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
      if (!todos.some((x) => !x.done)) mascotSay("cheer", "All tasks done! You're awesome 🥳", 5000);
    }
  }
  saveTodos();
  renderTodos();
});

const doneToday = (t) => t.done && t.doneAt && todayKey(new Date(t.doneAt)) === todayKey();

let lastTodoHtml = "";
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
            `<li data-id="${t.id}" class="${t.done ? "done" : ""}"><span class="check">${t.done ? icon("i-check") : ""}</span><span class="tt"><span class="tt-in">${esc(t.text)}</span></span>${
              t.time ? `<span class="ttime">${esc(t.time)}</span>` : ""
            }<button class="act edit" title="Edit">${icon("i-pencil")}</button><button class="act del" title="Delete">${icon("i-x")}</button></li>`,
        )
        .join("")
    : `<li class="empty">No tasks yet. Click "Add" ✍️</li>`;
  // Bandingkan dengan HTML terakhir (bukan innerHTML), karena teks berjalan mengubah isi baris.
  if (html !== lastTodoHtml) {
    lastTodoHtml = html;
    $("todoList").innerHTML = html;
  }
  if (expanded && page === "todo") marqueeTodos();
  const pending = todos.filter((t) => !t.done).length;
  const dt = todos.filter(doneToday).length;
  $("todoScore").textContent = `${dt}/${dt + pending}`;
}

// Nama tugas yang lebih panjang dari barisnya bergulir terus (seperti teks berjalan).
function marqueeTodos() {
  for (const tt of $("todoList").querySelectorAll(".tt")) {
    const inner = tt.firstElementChild;
    if (!inner || tt.classList.contains("marquee")) continue;
    if (tt.scrollWidth <= tt.clientWidth + 1) continue;
    const text = inner.textContent;
    tt.classList.add("marquee");
    tt.innerHTML = `<span class="tt-run"><span>${esc(text)}</span><span aria-hidden="true">${esc(text)}</span></span>`;
    // Kecepatan tetap ±40 px/detik, berapa pun panjang namanya.
    const w = tt.querySelector(".tt-run > span").offsetWidth;
    tt.style.setProperty("--dur", `${Math.max(4, w / 40)}s`);
  }
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
    peek({ icon: "i-check", ring: 100, color: "#32d74b", title: t.text, body: `Task at ${t.time}`, ms: 8000 });
    mascotSay("think", `Psst, it's time: ${t.text}`, 6000);
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
  return `${b.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${u[i]}`;
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
      const meta = !info.exists ? "Not found" : info.is_dir ? "Folder" : humanSize(info.size);
      return `<li class="file ${info.exists ? "" : "missing"}" data-i="${i}" title="${esc(f.path)}">
        ${fi}<div class="fname">${esc(f.name)}</div><div class="fsize">${meta}</div>
        <button class="fx" title="Remove from shelf">${icon("i-x")}</button>
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

// File diseret dari Explorer ke notch. Di halaman Converter langsung masuk
// ke pengubah format; di tempat lain masuk ke Shelf, kecuali dilepas di
// kotak "Convert" di sisi kanan Shelf.
let dropToConvert = false;
function overConvertZone(pos) {
  if (!pos) return false;
  const r = $("shelfConv").getBoundingClientRect();
  const x = pos.x / devicePixelRatio;
  const y = pos.y / devicePixelRatio;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
listen("tauri://drag-enter", () => {
  if (page !== "convert" || settingsOpen) setPage("shelf");
  expand(4000);
  notch.classList.add("dragging");
  if (page === "convert") {
    $("convDropText").textContent = "Release to convert";
    return;
  }
  $("shelfDropText").textContent = "Release to add";
  $("shelfEmpty").style.display = "";
});
listen("tauri://drag-over", (e) => {
  if (page !== "shelf") return;
  dropToConvert = overConvertZone(e.payload?.position);
  $("shelfConv").classList.toggle("hot", dropToConvert);
});
listen("tauri://drag-leave", () => {
  notch.classList.remove("dragging");
  $("shelfDropText").textContent = "Drop files here";
  $("convDropText").textContent = "Drop images here";
  $("shelfConv").classList.remove("hot");
  dropToConvert = false;
  renderShelf();
  scheduleCollapse();
});
listen("tauri://drag-drop", (e) => {
  notch.classList.remove("dragging");
  $("shelfDropText").textContent = "Drop files here";
  $("convDropText").textContent = "Drop images here";
  $("shelfConv").classList.remove("hot");
  const paths = e.payload?.paths || [];
  if (page === "convert" || dropToConvert || overConvertZone(e.payload?.position)) {
    dropToConvert = false;
    setPage("convert");
    startConvert(paths);
    expand(15000);
  } else {
    addToShelf(paths);
    renderShelf();
    expand(2500);
  }
  scheduleCollapse();
});

/* ================= Pengubah format (File Converter) ================= */

const CONV_IN = ["png", "jpg", "jpeg", "webp", "bmp", "ico", "tif", "tiff", "gif"];
const CONV_OUT = ["png", "webp", "pdf", "jpg", "ico", "bmp", "tiff", "gif"];
// conv.state: "idle" | "pick" (roda format) | "busy"
let conv = { state: "idle", files: [], skipped: 0, results: [] };

function startConvert(paths) {
  const files = paths.filter((p) => CONV_IN.includes(extOf(baseName(p))));
  conv = { state: files.length ? "pick" : "idle", files, skipped: paths.length - files.length, results: [] };
  if (!files.length && paths.length) mascotSay("think", "Hmm, I can only convert images for now 🖼️", 4500);
  renderConvert();
}

const sameFormat = (fmt) => conv.files.length && conv.files.every((p) => {
  const e = extOf(baseName(p));
  return e === fmt || (fmt === "jpg" && e === "jpeg") || (fmt === "tiff" && e === "tif");
});

function wheelSvg() {
  const n = CONV_OUT.length;
  const R = 112, r = 46, step = (Math.PI * 2) / n;
  const pt = (rad, a) => `${(rad * Math.cos(a)).toFixed(2)} ${(rad * Math.sin(a)).toFixed(2)}`;
  const slices = CONV_OUT.map((fmt, i) => {
    const a0 = -Math.PI / 2 - step / 2 + i * step + 0.012;
    const a1 = a0 + step - 0.024;
    const mid = (a0 + a1) / 2;
    const [lx, ly] = pt(79, mid).split(" ");
    const off = sameFormat(fmt);
    return `<g class="slice ${off ? "off" : ""}" data-f="${fmt}">
      <path d="M${pt(r, a0)} L${pt(R, a0)} A${R} ${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r} ${r} 0 0 0 ${pt(r, a0)}Z"/>
      <text x="${lx}" y="${ly}">${fmt.toUpperCase()}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="-118 -118 236 236">${slices}</svg>`;
}

function renderConvert() {
  const wheel = $("convWheel");
  const picking = conv.state === "pick" || conv.state === "busy";
  $("conv").classList.toggle("picking", picking);
  if (picking) {
    const exts = [...new Set(conv.files.map((p) => extOf(baseName(p)).toUpperCase()))];
    const label = conv.state === "busy" ? "Converting…" : `${conv.files.length} ${exts.length === 1 ? exts[0] : "files"}`;
    wheel.innerHTML = wheelSvg() + `<button class="conv-center" id="convCancel" title="Close"><b>${esc(label)}</b><span>${conv.state === "busy" ? "please wait" : "click to close"}</span></button>`;
    wheel.classList.toggle("busy", conv.state === "busy");
  } else {
    wheel.innerHTML = `<div class="conv-hint">${icon("i-convert")}<span>Pick a format after dropping</span></div>`;
  }
  // Setelah berhasil, roda tetap terbuka untuk file yang sama, jadi bisa
  // langsung dikonversi lagi ke format lain tanpa menyeret ulang.
  const list = conv.results.length
    ? conv.results.map((r) => ({ name: baseName(r.out || r.src), sub: r.error ? r.error : "Converted · drag me out", out: r.out, err: !!r.error }))
    : conv.files.map((p) => ({ name: baseName(p), sub: "Ready · pick a format" }));
  $("convDrop").hidden = picking || conv.results.length > 0;
  $("convList").innerHTML = list
    .map((f, i) => {
      const ext = extOf(f.name);
      return `<li class="file conv-file ${f.err ? "missing" : ""}" data-i="${i}" title="${esc(f.out || f.name)}">
        <div class="ficon" style="background:${EXT_COLORS[ext] || "#d1d1d6"}">${esc(ext.toUpperCase() || "FILE")}</div>
        <div class="cf-text"><div class="fname">${esc(f.name)}</div><div class="fsize">${esc(f.sub)}</div></div>
      </li>`;
    })
    .join("") +
    (picking && !conv.results.length && conv.skipped ? `<li class="conv-more">${conv.skipped} non-image file${conv.skipped > 1 ? "s" : ""} skipped</li>` : "") +
    (conv.results.length ? `<li class="conv-more">Pick another format, or drop new images</li>` : "");
  $("convTools").hidden = !(conv.files.length || conv.results.length);
}

// pointerdown (bukan click): tetap jalan walau Windows "menelan" lepasan
// tombol mouse setelah file diseret keluar dari notch.
$("convWheel").addEventListener("pointerdown", async (e) => {
  if (e.button !== 0 || conv.state !== "pick") return;
  if (e.target.closest("#convCancel")) {
    conv.state = "idle";
    conv.files = [];
    return renderConvert();
  }
  const s = e.target.closest(".slice");
  if (!s || s.classList.contains("off")) return;
  conv.state = "busy";
  renderConvert();
  const res = (await invoke("convert_files", { paths: conv.files, format: s.dataset.f }).catch((err) => conv.files.map((src) => ({ src, error: String(err) })))) || [];
  conv = { state: "pick", files: conv.files, skipped: 0, results: res };
  const ok = res.filter((r) => r.out).length;
  if (ok) sounds.pop();
  if (ok) mascotSay("cheer", `Thwip! ${ok} file${ok > 1 ? "s" : ""} converted to ${s.dataset.f.toUpperCase()} 🕸️`, 4000);
  renderConvert();
});

// Hasil konversi bisa diseret keluar, diklik untuk dibuka, klik kanan untuk membuka foldernya.
let convDrag = null;
$("convList").addEventListener("mousedown", (e) => {
  const el = e.target.closest(".conv-file");
  if (!el || e.button !== 0 || !conv.results.length) return;
  convDrag = { i: +el.dataset.i, x: e.clientX, y: e.clientY, started: false };
});
window.addEventListener("mousemove", (e) => {
  if (!convDrag || convDrag.started) return;
  if (Math.hypot(e.clientX - convDrag.x, e.clientY - convDrag.y) > 5) {
    convDrag.started = true;
    const r = conv.results[convDrag.i];
    if (r?.out) startDrag([r.out], dragIcon(baseName(r.out))).catch(() => {});
  }
});
window.addEventListener("mouseup", (e) => {
  if (convDrag && !convDrag.started && e.target.closest(".conv-file")) {
    const r = conv.results[convDrag.i];
    if (r?.out) invoke("open_file", { path: r.out });
  }
  convDrag = null;
});
$("convList").addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".conv-file");
  if (!el || !conv.results.length) return;
  e.preventDefault();
  const r = conv.results[+el.dataset.i];
  if (r?.out) invoke("reveal_file", { path: r.out });
});
// Pilih gambar dari folder mana saja lewat jendela "Open" Windows.
document.addEventListener("click", async (e) => {
  if (!e.target.closest(".conv-browse")) return;
  pinUntil = Date.now() + 120000;
  const paths = await pickFiles("Choose images to convert", CONV_IN).catch(() => []);
  pinUntil = Date.now() + 15000;
  if (paths.length) startConvert(paths);
  expand(15000);
});

// Reset: kosongkan file dan hasil, kembali ke kotak "Drop images here".
document.addEventListener("click", (e) => {
  if (!e.target.closest("#convClear")) return;
  conv = { state: "idle", files: [], skipped: 0, results: [] };
  renderConvert();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && conv.state === "pick") {
    conv.state = "idle";
    conv.files = [];
    renderConvert();
  }
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
  el.title = b.present ? `Battery ${b.percent}%${b.plugged ? " · charging" : ""}` : "";
}

// Ikon petir muncul di samping baterai saat charger tersambung.
function renderBattery(pre) {
  const b = status.battery;
  batteryRing($(`${pre}Ring`));
  $(`${pre}Batt`).classList.toggle("charging", !!(b.present && b.plugged));
  $(`${pre}Batt`).style.display = b.present ? "" : "none";
  const pct = $(`${pre}Pct`);
  if (pct) pct.textContent = b.present ? `${b.percent}%` : "";
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
      peek({ icon: "i-bolt", ring: nb.percent, color: "#32d74b", title: "Charging", body: "Charger connected", side: `${nb.percent}%`, ms: 3500 });
    }
    if (nb.present && !nb.plugged) {
      for (const lvl of [20, 10]) {
        if (ob.percent > lvl && nb.percent <= lvl) {
          peek({ icon: "i-battery-low", ring: nb.percent, color: "#ff453a", iconColor: "#ff453a", title: lvl === 10 ? "Battery critical" : "Battery low", body: "Plug in the charger", side: `${nb.percent}%` });
          mascotSay("shock", `Only ${nb.percent}% battery left! 😱`, 5000);
        }
      }
    }
    if (nb.present && nb.plugged && nb.percent >= 100 && ob.percent < 100) {
      peek({ icon: "i-bolt", ring: 100, color: "#32d74b", title: "Fully charged", body: "You can unplug the charger", side: "100%" });
    }
    if (status.network.internet && !s.network.internet) {
      peek({ icon: "i-wifi-off", ring: 100, color: "#ffd60a", title: "Wi-Fi disconnected", body: s.network.connected ? "Connected, but no internet" : "No network" });
    } else if (!status.network.internet && s.network.internet) {
      peek({ icon: "i-wifi", ring: 100, color: "#32d74b", title: "Back online", body: s.network.name || "", ms: 3000 });
    }
    for (const d of s.bluetooth)
      if (!status.bluetooth.includes(d)) peek({ icon: "i-bt", ring: 100, color: "#2f8cff", title: d, body: "Connected", sideIcon: "i-headphones", ms: 3500 });
    for (const d of status.bluetooth)
      if (!s.bluetooth.includes(d)) peek({ icon: "i-bt", ring: 0, color: "#8e8e93", title: d, body: "Disconnected", sideIcon: "i-headphones", ms: 3000 });
  }
  status = s;
  statusReady = true;
}

/* ================= Volume, Caps Lock, bahasa keyboard ================= */

const langName = (code) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
};

listen("lentera-input", (e) => {
  const ev = e.payload || {};
  if (!settings.overlays || expanded) return;
  if (ev.kind === "volume") {
    const muted = ev.muted || ev.volume === 0;
    peek({ key: "volume", urgent: true, small: true, icon: muted ? "i-mute" : "i-vol", ring: muted ? 0 : ev.volume, color: "#fff", title: muted ? "Muted" : "Volume", side: muted ? "" : `${ev.volume}`, bar: muted ? 0 : ev.volume, ms: 1500 });
  } else if (ev.kind === "caps") {
    peek({ key: "caps", urgent: true, small: true, icon: "i-caps", ring: ev.caps ? 100 : 0, color: "#32d74b", title: ev.caps ? "Caps Lock on" : "Caps Lock off", ms: 1300 });
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
  if (prayerSoon) text = `<span style="color:${st.color}">${st.icon} ${next.name} in ${Math.max(1, Math.ceil(minsToPrayer))} min</span>`;
  else if (timer.cd.running) text = `<span style="color:#ff4b55">⏱ ${hms(cdLeft())}</span>${timer.cd.label ? `<span class="tlabel"> · ${esc(timer.cd.label)}</span>` : ""}`;
  else if (timer.sw.startAt != null) text = `<span style="color:#5ab4ff">⏱ ${hms(swElapsed(), true)}</span>`;
  // Mode garis tipis: lirik tidak dimunculkan supaya notch tetap jadi garis saat tidak dipakai.
  else if (settings.miniLyrics && !settings.minimal && playing && lyrics.lines.length) text = esc(lyrics.lines[currentLyricIndex()]?.text || "♪");

  const waving = Date.now() < wavingUntil;
  const showEyes = !expanded && !peekCur && eyesAllowed() && (idleLevel > 0 || waving);
  notch.classList.toggle("idle", showEyes);
  notch.classList.toggle("dozing", showEyes && idleLevel === 2);
  notch.classList.toggle("waving", showEyes && waving && idleLevel === 0);
  notch.classList.toggle("minimal", !!settings.minimal);
  notch.classList.toggle("has-text", !!text);
  notch.classList.toggle("timer-text", !prayerSoon && (timer.cd.running || timer.sw.startAt != null));
  notch.classList.toggle("wide", !!text && !expanded && !peekCur);
  notch.classList.toggle("glow", prayerSoon && !peekCur);
  if (prayerSoon) notch.style.setProperty("--accent", st.color);
  else notch.style.removeProperty("--accent");

  renderBattery("mini");
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
    return `Prayer <em style="color:${st.color}">Times</em>`;
  }
  if (p === "water") return $("waterSet").hidden ? `Drink <em style="color:#2f8cff">Water</em>` : `Water <em style="color:#2f8cff">Settings</em>`;
  if (p === "shelf") return "Shelf";
  if (p === "convert") return `File <em style="color:#ff4b55">Converter</em>`;
  if (p === "todo") return `To-do <em style="color:#32d74b">List</em>`;
  if (p === "notif") return "Notifications";
  return "Settings";
}

function renderHead() {
  const now = new Date();
  setHtml($("ptitle"), settingsOpen ? "Settings" : titleFor(page));
  $("clockBig").textContent = hm(now);
  $("dateBig").textContent = now.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  renderBattery("head");
  $("headWave").classList.toggle("on", media.available && media.playing);
  $("headWave").style.visibility = media.available ? "" : "hidden";
}

/* ================= Pengaturan ================= */

const titleCase = (t) => t.toLowerCase().replace(/(^|[\s.(])\S/g, (c) => c.toUpperCase());

// Daftar kota: hasil pencarian (kalau ada), kota terpilih dari pencarian, lalu kota populer.
function fillCities(found = []) {
  const sel = $("setCity");
  const extra = [...found];
  if (settings.myqId && !found.some((c) => String(c.id) === String(settings.myqId)) && !CITIES.some(([n]) => n === settings.city))
    extra.unshift({ id: settings.myqId, lokasi: settings.myqName || settings.city });
  const opt = (c) => `<option value="myq:${esc(c.id)}" data-name="${esc(c.lokasi)}">${esc(titleCase(c.lokasi))}</option>`;
  sel.innerHTML =
    (extra.length ? `<optgroup label="Search results">${extra.map(opt).join("")}</optgroup>` : "") +
    `<optgroup label="Popular cities">${CITIES.map(([name]) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</optgroup>` +
    `<option value="__custom">Other (set coordinates)</option>`;
  const inList = CITIES.some(([n]) => n === settings.city);
  sel.value = inList ? settings.city : settings.myqId ? `myq:${settings.myqId}` : "__custom";
  $("customLoc").hidden = sel.value !== "__custom";
}

function initSettings() {
  const sel = $("setCity");
  fillCities();
  $("setPrayerSrc").value = settings.prayerSrc;
  $("setPrayerSrc").addEventListener("change", (e) => {
    settings.prayerSrc = e.target.value;
    saveSettings();
    refreshPrayer(true);
    renderPrayerSource();
  });
  // Cari kabupaten/kota lain di Indonesia (data Kemenag).
  const search = async () => {
    const q = $("citySearch").value.trim();
    if (q.length < 3) return;
    $("citySearchBtn").textContent = "…";
    const res = await invoke("http_json", { url: `https://api.myquran.com/v2/sholat/kota/cari/${encodeURIComponent(q)}` }).catch(() => null);
    $("citySearchBtn").textContent = "Search";
    const list = res?.data || [];
    if (!list.length) {
      $("prayerSrcInfo").textContent = res ? `No city found for "${q}".` : "Couldn't search right now, check your internet.";
      return;
    }
    fillCities(list);
    sel.value = `myq:${list[0].id}`;
    sel.dispatchEvent(new Event("change"));
  };
  $("citySearchBtn").addEventListener("click", search);
  $("citySearch").addEventListener("keydown", (e) => e.key === "Enter" && search());
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
    if (sel.value.startsWith("myq:")) {
      const opt = sel.selectedOptions[0];
      Object.assign(settings, { myqId: sel.value.slice(4), myqName: opt.dataset.name, city: opt.textContent });
      $("customLoc").hidden = true;
    } else if (sel.value === "__custom") {
      Object.assign(settings, { city: "My location", myqId: null, myqName: "" });
      $("customLoc").hidden = false;
    } else {
      settings.myqId = null;
      settings.myqName = "";
      const c = CITIES.find(([n]) => n === sel.value);
      Object.assign(settings, { city: c[0], lat: c[1], lng: c[2] });
      $("setLat").value = c[1];
      $("setLng").value = c[2];
      $("customLoc").hidden = true;
    }
    saveSettings();
    refreshPrayer(true);
    renderAll();
  });
  const bind = (id, key, conv) =>
    $(id).addEventListener("change", (e) => {
      settings[key] = conv(e.target.value);
      saveSettings();
      renderAll();
    });
  bind("setLat", "lat", Number);
  bind("setLng", "lng", Number);
  ["setLat", "setLng", "setOffset"].forEach((id) => $(id).addEventListener("change", () => refreshPrayer(true)));
  bind("setName", "name", (v) => v.trim());
  bind("setPreMin", "preMin", Number);
  bind("setOffset", "offset", (v) => Math.max(-15, Math.min(15, Number(v) || 0)));
  bind("setMascot", "mascotEvery", Number);

  let armed = false;
  $("resetAll").addEventListener("click", (e) => {
    if (!armed) {
      armed = true;
      e.target.textContent = "Sure? Click again to erase";
      setTimeout(() => {
        armed = false;
        e.target.textContent = "Erase all Spidey data";
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
  if (settingsOpen) renderPrayerSource();
}

initSettings();
setPage(page);
renderTodos();
renderWater();
renderTimer();

// Saat notch tertutup cukup diperbarui dua kali per detik.
let renderTick = 0;
setInterval(() => {
  tickTimer();
  if (expanded || peekCur || renderTick++ % 2 === 0) renderAll();
}, 250);
setInterval(prayerReminders, 5000);
setInterval(refreshPrayer, 15 * 60000);
refreshPrayer();
setInterval(waterReminder, 30000);
setInterval(todoAlerts, 15000);
setInterval(pollMedia, 1000);
setInterval(pollIdle, 1000);
setInterval(pollStatus, 10000);
setInterval(pollNotifs, 5000);
pollMedia();
pollStatus();
pollNotifs();
prayerReminders();
todoAlerts();

// Sapaan pertama setelah Spidey dibuka.
setTimeout(() => {
  const [a, t] = chooseLine({ ...mascotContext(), music: null, todoLeft: 0, waterPct: null });
  mascotSay(a === "sleep" ? "sleep" : "wave", t, 6000);
}, 2500);
