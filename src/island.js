// The Island theme behaves like Apple's Dynamic Island, not just looks like
// it: an empty black pill while idle, artwork on one side and a waveform in
// the artwork's colour on the other while music plays, and a short peek at
// the title when the track changes. Shapes and springs live in styles.css
// under [data-theme="island"].

import { getSettings } from "./settings.js";
import { themeById } from "./themes.js";

// How long a new track's title stays out before the pill shrinks back.
const PEEK_MS = 3200;
// The waveform is drawn in the artwork's colour, but never darker than this,
// so it stays visible on black.
const MIN_BRIGHTNESS = 170;

const peninsula = document.getElementById("peninsula");
let repaint = () => {};
let lastTrack;
let peekTimer = null;
let tintSrc = null;

export const isIsland = () => Boolean(themeById(getSettings().theme).island);

export function initIsland(onChange) {
  repaint = onChange;
}

/** Tags the peninsula with what the bar shows, so the CSS can lay it out. */
export function paintIsland(view, media) {
  peninsula.dataset.kind = view.idle ? "idle" : view.kind ?? "other";
  // Followed in every theme, so switching to Island doesn't peek at once.
  const track = media.hasSession && media.title ? `${media.title}\n${media.artist ?? ""}` : null;
  const changed = lastTrack !== undefined && track !== lastTrack;
  lastTrack = track;
  if (!isIsland()) return stopPeek();
  if (changed && track && media.playing && view.kind === "media") peek();
  tint(view.kind === "media" ? view.lead.cover : null);
}

function peek() {
  if (peninsula.dataset.state !== "collapsed") return;
  peninsula.classList.add("island-peek");
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    stopPeek();
    repaint();
  }, PEEK_MS);
}

function stopPeek() {
  clearTimeout(peekTimer);
  peninsula.classList.remove("island-peek");
}

// The artwork's most vivid colour, weighted towards saturated, bright pixels.
function tint(src) {
  if (src === tintSrc) return;
  tintSrc = src;
  if (!src) return peninsula.style.removeProperty("--art");
  const img = new Image();
  img.onload = () => {
    if (src !== tintSrc) return;
    const size = 12;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const weight = ((max - min) / 255) * (max / 255) + 0.01;
      r += d[i] * weight;
      g += d[i + 1] * weight;
      b += d[i + 2] * weight;
      total += weight;
    }
    const rgb = [r, g, b].map((c) => c / total);
    const lift = Math.max(1, MIN_BRIGHTNESS / Math.max(...rgb, 1));
    const [cr, cg, cb] = rgb.map((c) => Math.round(Math.min(255, c * lift)));
    peninsula.style.setProperty("--art", `rgb(${cr}, ${cg}, ${cb})`);
  };
  img.src = src;
}
