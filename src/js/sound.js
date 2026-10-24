// Bunyi lembut dibuat langsung dengan Web Audio, tanpa file suara.
let ctx;

function tone(freq, start, dur, gain = 0.18, type = "sine") {
  ctx ??= new AudioContext();
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  pop() {
    tone(880, 0, 0.12, 0.08, "triangle");
  },
  done() {
    tone(660, 0, 0.25, 0.12);
    tone(990, 0.12, 0.35, 0.12);
  },
  timer() {
    for (let i = 0; i < 3; i++) {
      tone(880, i * 0.5, 0.3, 0.16, "triangle");
      tone(1320, i * 0.5 + 0.12, 0.3, 0.1, "triangle");
    }
  },
  prayer() {
    // Nada lonceng yang turun perlahan.
    [784, 659, 523, 659].forEach((f, i) => tone(f, i * 0.45, 1.4, 0.14));
  },
  water() {
    tone(520, 0, 0.12, 0.1);
    tone(780, 0.1, 0.18, 0.1);
  },
};
