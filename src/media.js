// "Now playing" page. The Rust side pushes updates as they happen; this
// module only renders them and forwards button presses.

import { call, on, inTauri } from "./tauri.js";
import { icon } from "./icons.js";
import { escapeHtml, formatTrack } from "./util.js";

let state = { available: false, hasSession: false };
let pageEl = null;
let nowEl = null;
let changed = () => {};

export const media = () => state;

// When playback last stopped, so the slim bar keeps its controls for a while
// after pausing and the music can be resumed from there.
let pausedAt = 0;
const KEEP_CONTROLS_MS = 5 * 60_000;

// The position as of `timelineAt`; while playing it moves on by itself.
let timelineAt = Date.now();
let progressTimer = null;

function setState(next) {
  if (state.playing && !next.playing) pausedAt = Date.now();
  state = next;
  timelineAt = Date.now();
  render();
  changed();
}

function position() {
  const { positionMs = 0, durationMs = 0 } = state.timeline ?? {};
  const now = positionMs + (state.playing ? Date.now() - timelineAt : 0);
  return durationMs ? Math.min(now, durationMs) : now;
}

/** Moves only the progress bar and its times; the rest stays as rendered. */
function paintProgress() {
  const box = pageEl?.querySelector(".media-progress");
  if (!box) return;
  const duration = state.timeline?.durationMs ?? 0;
  const now = position();
  box.querySelector(".fill").style.width = `${duration ? (now / duration) * 100 : 0}%`;
  box.querySelector(".t-now").textContent = formatTrack(now);
  box.querySelector(".t-total").textContent = formatTrack(duration);
}

// Ticks only while a track with a known length is playing.
function syncProgress() {
  const run = state.playing && state.timeline?.durationMs > 0;
  if (run && !progressTimer) progressTimer = setInterval(paintProgress, 500);
  if (!run && progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

/** Music is playing, or was paused only a few minutes ago. */
export function hasControls() {
  if (!state.hasSession) return false;
  return state.playing || Date.now() - pausedAt < KEEP_CONTROLS_MS;
}

// How far the back / forward buttons jump, as in most podcast apps.
const SKIP_MS = 15_000;

/** Players that report where the track is can be jumped back and forward. */
export const canSkip = () => state.timeline?.durationMs > 0;

/** Jumps to `positionMs` and moves the progress bar there straight away. */
function seekTo(positionMs) {
  call("media_seek", { positionMs }).catch(() => {});
  state = { ...state, timeline: { ...state.timeline, positionMs } };
  timelineAt = Date.now();
  paintProgress();
}

/** Play/pause, next, previous, or 15 s back / forward, from the media page
 *  or the slim bar. */
export function control(action) {
  if (action === "back" || action === "forward") {
    if (!canSkip()) return;
    const target = position() + (action === "back" ? -SKIP_MS : SKIP_MS);
    // Clamped, so pressing it quickly several times adds up from here.
    return seekTo(Math.round(Math.min(state.timeline.durationMs, Math.max(0, target))));
  }
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
  nowEl = document.getElementById("media-now");
  guardCovers(pageEl);

  pageEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-media]");
    if (btn) control(btn.dataset.media);
  });

  // Click anywhere on the bar to jump there.
  pageEl.addEventListener("pointerdown", (e) => {
    const track = e.target.closest(".track");
    const duration = state.timeline?.durationMs ?? 0;
    if (!track || !duration) return;
    const r = track.getBoundingClientRect();
    seekTo(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration));
  });

  render();
  if (!inTauri) return;
  await on("media://update", setState);
  await on("media://timeline", (timeline) => {
    state = { ...state, timeline };
    timelineAt = Date.now();
    paintProgress();
  });
  setState((await call("media_state")) ?? state);
}

export function render() {
  if (!pageEl) return;
  syncProgress();
  if (!state.available) {
    nowEl.innerHTML = `<div class="media-empty">${icon("media")}<p>Media controls work on Windows.</p></div>`;
    return;
  }
  if (!state.hasSession) {
    nowEl.innerHTML = `<div class="media-empty">${icon("media")}<p>Nothing is playing.</p><small>Start music in Spotify, a browser or any player.</small></div>`;
    return;
  }

  nowEl.innerHTML = `
    <div class="media-card">
      ${coverHtml(state.thumbnail, "cover")}
      <div class="media-info">
        <span class="media-source">${escapeHtml(prettySource(state.source))}</span>
        <strong class="media-title">${escapeHtml(state.title || "Unknown title")}</strong>
        <span class="media-artist">${escapeHtml(state.artist || "")}</span>
        ${
          state.timeline?.durationMs > 0
            ? `<div class="media-progress">
                <span class="t-now"></span>
                <div class="track" title="Jump to"><div class="fill"></div></div>
                <span class="t-total"></span>
              </div>`
            : ""
        }
        <div class="media-controls">
          <button class="icon-btn big" data-media="previous" title="Previous">${icon("previous")}</button>
          ${canSkip() ? `<button class="icon-btn big" data-media="back" title="Back 15 seconds">${icon("back15")}</button>` : ""}
          <button class="icon-btn big accent play" data-media="toggle" title="${state.playing ? "Pause" : "Play"}">${icon(state.playing ? "pause" : "play")}</button>
          ${canSkip() ? `<button class="icon-btn big" data-media="forward" title="Forward 15 seconds">${icon("forward15")}</button>` : ""}
          <button class="icon-btn big" data-media="next" title="Next">${icon("next")}</button>
        </div>
      </div>
    </div>`;
  paintProgress();
}
