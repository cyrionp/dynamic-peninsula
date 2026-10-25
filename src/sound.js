// A short, soft three-note chime made with Web Audio, so no sound file is
// needed. The audio context is unlocked on the first click, since WebView2
// may refuse to start audio that no user gesture led to.

let ctx = null;

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

window.addEventListener("pointerdown", () => context(), { once: true });

export function playChime(volume = 0.6) {
  const ac = context();
  if (!ac || volume <= 0) return;

  const master = ac.createGain();
  master.gain.value = 0.35 * volume;
  master.connect(ac.destination);

  // A major arpeggio, then the octave: bright but gentle.
  const notes = [880, 1108.73, 1318.51, 1760];
  const start = ac.currentTime + 0.02;

  notes.forEach((freq, i) => {
    const t = start + i * 0.12;
    for (const [type, level] of [
      ["sine", 1],
      ["triangle", 0.25],
    ]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.95);
    }
  });
}
