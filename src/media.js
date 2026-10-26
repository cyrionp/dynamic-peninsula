// "Now playing" page. The Rust side pushes updates as they happen; this
// module only renders them and forwards button presses.

import { call, on, inTauri } from "./tauri.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";

let state = { available: false, hasSession: false };
let pageEl = null;
let changed = () => {};

export const media = () => state;

// When playback last stopped, so the slim bar keeps its controls for a while
// after pausing and the music can be resumed from there.
let pausedAt = 0;
const KEEP_CONTROLS_MS = 5 * 60_000;

function setState(next) {
  if (state.playing && !next.playing) pausedAt = Date.now();
  state = next;
  render();
  changed();
}

/** Music is playing, or was paused only a few minutes ago. */
export function hasControls() {
  if (!state.hasSession) return false;
  return state.playing || Date.now() - pausedAt < KEEP_CONTROLS_MS;
}

/** Play/pause, next or previous, from the media page or the slim bar. */
export function control(action) {
  call("media_control", { action }).catch(() => {});
  // Feel instant; the real state follows from the event.
  if (action === "toggle") setState({ ...state, playing: !state.playing });
}

// Shown when a player shares no artwork, or the artwork fails to load: a
// music note on the theme's accent, so it always matches the current theme.
const NOTE_ART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 17.5a3 3 0 1 1-2-2.83V5.5l12-2.5v11.5a3 3 0 1 1-2-2.83V7.6l-8 1.66z"/></svg>`;

/** Artwork, or the default art when there is none. `cls` sizes it. */
export function coverHtml(src, cls) {
  return src
    ? `<img class="${cls}" src="${src}" alt="" />`
    : `<span class="${cls} cover-default">${NOTE_ART}</span>`;
}

/** Swaps any artwork under `root` that fails to load for the default art. */
export function guardCovers(root) {
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName !== "IMG") return;
      img.outerHTML = coverHtml(null, img.className);
    },
    true
  );
}

/** "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify". */
export function prettySource(id = "") {
  const last = id.split("!").pop().replace(/\.exe$/i, "");
  const known = { msedge: "Edge", chrome: "Chrome", firefox: "Firefox", spotify: "Spotify" };
  return known[last.toLowerCase()] ?? last.split(/[._]/)[0];
}

export async function initMedia(onChange) {
  changed = onChange;
  pageEl = document.getElementById("media-page");
  guardCovers(pageEl);

  pageEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-media]");
    if (btn) control(btn.dataset.media);
  });

  render();
  if (!inTauri) return;
  await on("media://update", setState);
  setState((await call("media_state")) ?? state);
}

export function render() {
  if (!pageEl) return;
  if (!state.available) {
    pageEl.innerHTML = `<div class="media-empty">${icon("media")}<p>Media controls work on Windows.</p></div>`;
    return;
  }
  if (!state.hasSession) {
    pageEl.innerHTML = `<div class="media-empty">${icon("media")}<p>Nothing is playing.</p><small>Start music in Spotify, a browser or any player.</small></div>`;
    return;
  }

  pageEl.innerHTML = `
    <div class="media-card">
      ${coverHtml(state.thumbnail, "cover")}
      <div class="media-info">
        <span class="media-source">${escapeHtml(prettySource(state.source))}</span>
        <strong class="media-title">${escapeHtml(state.title || "Unknown title")}</strong>
        <span class="media-artist">${escapeHtml(state.artist || "")}</span>
        <div class="media-controls">
          <button class="icon-btn big" data-media="previous" title="Previous">${icon("previous")}</button>
          <button class="icon-btn big accent play" data-media="toggle" title="${state.playing ? "Pause" : "Play"}">${icon(state.playing ? "pause" : "play")}</button>
          <button class="icon-btn big" data-media="next" title="Next">${icon("next")}</button>
        </div>
      </div>
    </div>`;
}
