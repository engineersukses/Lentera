// "Tera", si lentera kecil yang muncul di samping notch.

const SVG = `
<svg viewBox="0 0 64 72" class="tera" aria-hidden="true">
  <defs>
    <radialGradient id="teraBody" cx="45%" cy="40%" r="65%">
      <stop offset="0" stop-color="#ffe2a8"/>
      <stop offset="0.6" stop-color="#ffb259"/>
      <stop offset="1" stop-color="#f08a3c"/>
    </radialGradient>
    <linearGradient id="teraFlame" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff8a3d"/>
      <stop offset="1" stop-color="#ffe9a6"/>
    </linearGradient>
  </defs>
  <g class="t-flame"><path d="M32 4 C26 12 26 17 32 20 C38 17 38 12 32 4 Z" fill="url(#teraFlame)"/></g>
  <g class="t-body">
    <path d="M32 18 C49 18 56 30 56 44 C56 59 46 66 32 66 C18 66 8 59 8 44 C8 30 15 18 32 18 Z" fill="url(#teraBody)"/>
    <g class="t-eyes">
      <ellipse class="t-eye" cx="24" cy="41" rx="3.6" ry="4.6" fill="#2b1a10"/>
      <ellipse class="t-eye" cx="40" cy="41" rx="3.6" ry="4.6" fill="#2b1a10"/>
      <circle cx="25.2" cy="39.4" r="1.3" fill="#fff"/>
      <circle cx="41.2" cy="39.4" r="1.3" fill="#fff"/>
    </g>
    <g class="t-eyes-closed">
      <path d="M20 42 Q24 45 28 42" stroke="#2b1a10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M36 42 Q40 45 44 42" stroke="#2b1a10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    </g>
    <ellipse cx="17" cy="49" rx="4" ry="2.5" fill="#ff7d8a" opacity=".55"/>
    <ellipse cx="47" cy="49" rx="4" ry="2.5" fill="#ff7d8a" opacity=".55"/>
    <path class="t-mouth t-mouth-smile" d="M28 50 Q32 54 36 50" stroke="#2b1a10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse class="t-mouth t-mouth-o" cx="32" cy="52" rx="2.6" ry="3.2" fill="#2b1a10"/>
  </g>
  <g class="t-arm t-arm-l"><ellipse cx="9" cy="44" rx="5" ry="7" fill="#f59a47"/></g>
  <g class="t-arm t-arm-r"><ellipse cx="55" cy="44" rx="5" ry="7" fill="#f59a47"/></g>
  <g class="t-acc t-cup"><rect x="44" y="44" width="11" height="13" rx="2" fill="#7cc8ff"/><rect x="44" y="44" width="11" height="4" rx="1.5" fill="#d8f0ff"/></g>
  <g class="t-acc t-book"><path d="M16 50 L32 54 L48 50 L48 62 L32 66 L16 62 Z" fill="#6aa7ff"/><path d="M32 54 L32 66" stroke="#2f5fb3" stroke-width="1.5"/></g>
  <g class="t-acc t-zzz"><text x="46" y="18" font-size="10" fill="#cfd8ff" font-weight="700">z</text><text x="53" y="10" font-size="8" fill="#cfd8ff" font-weight="700">z</text></g>
  <g class="t-acc t-notes"><text x="50" y="20" font-size="12" fill="#ffd36e">♪</text><text x="4" y="26" font-size="10" fill="#ff9fd2">♫</text></g>
  <g class="t-acc t-hearts"><text x="48" y="20" font-size="11" fill="#ff6b8b">♥</text><text x="6" y="24" font-size="8" fill="#ff6b8b">♥</text></g>
  <g class="t-acc t-sweat"><path d="M50 28 C48 32 48 34 50 35 C52 34 52 32 50 28 Z" fill="#8fd3ff"/></g>
  <g class="t-acc t-spark"><text x="48" y="20" font-size="11" fill="#fff3a0">✦</text><text x="6" y="22" font-size="8" fill="#fff3a0">✦</text></g>
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
  options.push(["wave", pick([`Hi${name}! I'll keep you company here.`, `Hello${name}~ what are you up to?`, "Check check, Tera is here! ✨"])]);
  options.push(["think", pick(["Hmm... thinking about snacks.", "If you're tired, take a short break.", "One small step is still progress."])]);
  options.push(["cheer", pick(["You got this! 💪", "You're doing great today!", "Slow and steady, just keep going."])]);
  options.push(["read", pick(["Reading for a bit... 📖", "Learning something new today."])]);
  options.push(["love", pick(["Don't forget to smile today 💛", "Thank you for making it this far."])]);

  if (h >= 22 || h < 4) {
    options.push(["sleep", "It's late... don't stay up too long 😴"], ["sleep", "Yawn... Tera is sleepy."]);
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
    options.push(["cheer", "Focus! Tera is watching the timer ⏱"]);
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
