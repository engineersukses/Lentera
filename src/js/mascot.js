// "Tera" versi v1.2: Spider-Man kecil bergaya pixel art yang bergelantungan
// di benang jaring di samping notch. Sprite digambar dari peta piksel di bawah.

// K tinta, R merah, D merah gelap, B biru, N biru gelap, W putih.
const PALETTE = { K: "#0d0b14", R: "#e0262f", D: "#9e1219", B: "#2a5bd7", N: "#1a3a96", W: "#ffffff", S: "#c9d6ea" };

// Separuh kiri (12 kolom) badan + kepala; dicerminkan jadi 24 kolom. Posisi terbalik: kaki di atas.
const HALF = [
  ".......KKKK.",
  ".......KRRK.",
  ".......KRRK.",
  ".......KBBK.",
  ".......KBBK.",
  ".......KBNK.",
  "......KBBNKK",
  "......KBBBBB",
  "......KBBBBB",
  ".....KRRRRRR",
  ".....KRRRKRK",
  ".....KRRRRKK",
  ".....KRRRKRK",
  ".....KRRRRRR",
  "......KKRRRR",
  ".....KKRRRRR",
  "...KKRRRDRRR",
  "..KRRRRDRRRD",
  ".KRRRRDRRRDR",
  ".KRKKRRRRRDR",
  "KRKWWKKRRDRR",
  "KRKWWWWKKRRR",
  "KRKWWWWWWKRD",
  "KRRKWWWWWKRR",
  ".KRKKKKKKKRR",
  ".KRRRDRRRRRD",
  "..KRRRRDRRRR",
  "...KKRRRRDRR",
  ".....KKKKKKK",
];
const PAD = 2; // ruang untuk lengan di kiri-kanan
const W = 24 + PAD * 2;
const ROWS = HALF.map((h) => ".".repeat(PAD) + h + [...h].reverse().join("") + ".".repeat(PAD));

// Lengan kiri (7 kolom pertama); kanan dicerminkan. Digambar terpisah supaya bisa melambai.
const ARM = [
  [10, "....KKK"],
  [11, "...KBBB"],
  [12, "..KBBK."],
  [13, "..KBK.."],
  [14, ".KBBK.."],
  [15, ".KBK..."],
  [16, ".KBK..."],
  [17, ".KRK..."],
  [18, "KRRRK.."],
  [19, "KRRRK.."],
  [20, ".KKK..."],
];

const TOP = 8; // baris sprite dimulai di bawah benang jaring

// Piksel digabung jadi satu <path> per warna (bukan ratusan <rect>), supaya
// animasi ayunan tidak membuat browser menghitung ulang ratusan elemen.
function paths(pixels) {
  const byColor = {};
  for (const [x, y, c] of pixels) (byColor[c] ??= []).push(`M${x} ${y + TOP}h1.02v1.02h-1.02z`);
  return Object.entries(byColor)
    .map(([c, d]) => `<path fill="${PALETTE[c]}" d="${d.join("")}"/>`)
    .join("");
}

function grid(rows, filter = () => true, color) {
  const px = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c !== "." && filter(c, x, y) && px.push([x, y, color?.(c, x, y) ?? c])));
  return paths(px);
}

function arm(mirror) {
  const px = [];
  for (const [y, row] of ARM) [...row].forEach((c, i) => c !== "." && px.push([mirror ? W - 1 - i : i, y, c]));
  return paths(px);
}

// Mata (bagian putih) dipisah supaya bisa berkedip / tertutup / membesar.
const isEye = (c) => c === "W";
const body = grid(ROWS, (c) => !isEye(c));
const eyes = grid(ROWS, isEye);
// Mata tertutup: putihnya ditutup merah, lalu satu garis tinta.
const eyesClosed = grid(ROWS, isEye, (c, x, y) => (y === 22 ? "K" : "R"));

const SVG = `
<svg viewBox="0 0 ${W} ${ROWS.length + TOP + 1}" class="tera" shape-rendering="crispEdges" aria-hidden="true">
  <g class="t-swing">
    <rect class="t-web" x="${W / 2 - 0.4}" y="-80" width="0.8" height="${80 + TOP + 1}" fill="#f4f4f8"/>
    <g class="t-body">${body}</g>
    <g class="t-eyes">${eyes}</g>
    <g class="t-eyes-closed">${eyesClosed}</g>
    <g class="t-arm t-arm-l">${arm(false)}</g>
    <g class="t-arm t-arm-r">${arm(true)}</g>
    <g class="t-acc t-cup"><rect x="${W - 5}" y="${20 + TOP}" width="4" height="5" fill="#7cc8ff"/><rect x="${W - 5}" y="${20 + TOP}" width="4" height="1" fill="#e8f6ff"/></g>
    <g class="t-acc t-book"><rect x="6" y="${25 + TOP}" width="16" height="4" fill="#ffd34d"/><rect x="${W / 2 - 0.5}" y="${25 + TOP}" width="1" height="4" fill="${PALETTE.K}"/></g>
  </g>
  <g class="t-acc t-zzz"><text x="${W - 7}" y="14" font-size="6" fill="#cfd8ff" font-weight="700">z</text><text x="${W - 3}" y="8" font-size="5" fill="#cfd8ff" font-weight="700">z</text></g>
  <g class="t-acc t-notes"><text x="${W - 7}" y="16" font-size="7" fill="#ffd36e">♪</text><text x="0" y="20" font-size="6" fill="#ff9fd2">♫</text></g>
  <g class="t-acc t-hearts"><text x="${W - 7}" y="16" font-size="7" fill="#ff4b6b">♥</text><text x="1" y="20" font-size="5" fill="#ff4b6b">♥</text></g>
  <g class="t-acc t-sweat"><rect x="${W - 4}" y="${16 + TOP}" width="1" height="2" fill="#8fd3ff"/></g>
  <g class="t-acc t-spark"><text x="${W - 7}" y="15" font-size="6" fill="#fff3a0">✦</text><text x="0" y="17" font-size="5" fill="#fff3a0">✦</text></g>
</svg>`;

export const ACTIONS = ["wave", "sleep", "drink", "dance", "read", "shock", "love", "pray", "think", "cheer"];

function greetingByHour(h) {
  if (h >= 3 && h < 10) return "Good morning";
  if (h >= 10 && h < 15) return "Good afternoon";
  if (h >= 15 && h < 18) return "Good evening";
  return "Good night";
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Pilih aksi dan kalimat yang cocok dengan keadaan sekarang. */
export function chooseLine(ctx) {
  const name = ctx.name ? `, ${ctx.name}` : "";
  const h = new Date().getHours();
  const options = [];

  options.push(["wave", `${greetingByHour(h)}${name}! 👋`]);
  options.push(["wave", pick([`Hi${name}! I'll keep you company here.`, `Hello${name}~ what are you up to?`, "Your friendly neighborhood notch! 🕷️"])]);
  options.push(["think", pick(["Hmm... thinking about snacks.", "If you're tired, take a short break.", "One small step is still progress."])]);
  options.push(["cheer", pick(["You got this! 💪", "You're doing great today!", "Slow and steady, just keep going."])]);
  options.push(["read", pick(["Reading for a bit... 📖", "Learning something new today."])]);
  options.push(["wave", pick(["Just hanging around... literally 🕸️", "My spider-sense says you're doing great!", "With great power comes great productivity."])]);
  options.push(["love", pick(["Don't forget to smile today 💛", "Thank you for making it this far."])]);

  if (h >= 22 || h < 4) {
    options.push(["sleep", "It's late... don't stay up too long 😴"], ["sleep", "Yawn... even Spidey needs sleep."]);
  }
  if (ctx.music?.playing && ctx.music.title) {
    options.push(["dance", `Great song! 🎶 ${ctx.music.title}`], ["dance", "Dance time~ ♪"]);
  }
  if (ctx.waterPct != null && ctx.waterPct < 100) {
    options.push(["drink", ctx.waterPct < 50 ? "You haven't drunk much yet, have some water 💧" : "Almost at your water goal!"]);
  }
  if (ctx.todoLeft > 0) {
    options.push(["think", `${ctx.todoLeft} tasks left on your to-do. One at a time!`]);
  }
  if (ctx.nextPrayer && ctx.nextPrayer.minutes <= 30) {
    options.push(["pray", `${ctx.nextPrayer.name} in ${ctx.nextPrayer.minutes} min. Time to get ready 🤲`]);
  }
  if (ctx.battery && ctx.battery.present && !ctx.battery.plugged && ctx.battery.percent <= 25) {
    options.push(["shock", `Only ${ctx.battery.percent}% battery! Find a charger 🔌`]);
  }
  if (ctx.timerRunning) {
    options.push(["cheer", "Focus! Spidey is guarding the timer ⏱"]);
  }
  return pick(options);
}

export function createMascot(root, bubble) {
  root.innerHTML = SVG;
  let hideTimer = null;
  let visible = false;

  function show(action, text, ms = 6500) {
    root.className = `mascot show m-${action}`;
    bubble.textContent = text;
    bubble.classList.add("show");
    visible = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, ms);
  }

  function hide() {
    root.classList.remove("show");
    bubble.classList.remove("show");
    visible = false;
  }

  return { show, hide, isVisible: () => visible };
}
