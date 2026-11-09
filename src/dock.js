// The taskbar dock (experimental): the page inside the small window that
// Rust lays over the empty left part of the taskbar (see taskbar.rs).
//
// It keeps no data of its own. Countdowns, stopwatches and settings are
// read from the same local storage the peninsula writes; music and
// headphones come from the same events the peninsula listens to. A click
// on an item opens the peninsula on that page.

import { call, on, inTauri } from "./tauri.js";
import { load } from "./store.js";
import { icon, setIconStyle } from "./icons.js";
import { themeById } from "./themes.js";
import { escapeHtml, formatRemaining, formatElapsedShort } from "./util.js";
import { coverHtml, guardCovers, prettySource } from "./media.js";
import { DOCK_DEFAULTS, normaliseDockItems } from "./dockconfig.js";
import appIcon from "./app-icon.png";

const root = document.documentElement;
const dock = document.getElementById("dock");
guardCovers(dock);

// The last few seconds of a countdown pulse; when it ends it rings this long.
const URGENT_MS = 10_000;
const RING_MS = 8_000;
// Like the peninsula: a track paused a moment ago keeps its buttons.
const KEEP_MEDIA_MS = 5 * 60_000;
const VOLUME_STEP = 0.02;

let settings = {};
let countdowns = [];
let stopwatches = [];
let media = { hasSession: false };
let pausedAt = 0;
let devices = [];
let pods = null;

/* ---------- saved data, shared with the peninsula ---------- */

function readStore() {
  const saved = load("settings", {});
  settings = { ...DOCK_DEFAULTS, theme: "lagoon", mode: "dark", ...saved, dockItems: normaliseDockItems(saved.dockItems) };
  countdowns = load("countdowns", []);
  stopwatches = load("stopwatches", []);
  applyLook();
}

function applyLook() {
  const theme = themeById(settings.theme);
  const windows = settings.dockLook !== "peninsula";
  root.dataset.dockLook = windows ? "windows" : "peninsula";
  root.dataset.theme = theme.id;
  root.dataset.mode = settings.mode;
  // Windows' own icons are thin outlines.
  setIconStyle(windows ? "line" : theme.icons);
}

/* ---------- the taskbar's size and look, from Rust ---------- */

function applyLayout(layout) {
  if (!layout) return;
  root.style.setProperty("--tb-h", `${layout.height}px`);
  root.style.setProperty("--dock-w", `${layout.width}px`);
  root.style.setProperty("--win-accent", layout.accent || "#0078d4");
  root.dataset.light = String(Boolean(layout.light));
  root.dataset.transparency = String(layout.transparency !== false);
  root.dataset.small = String(layout.height < 40);
}

/* ---------- what each item shows ---------- */

// Countdowns whose ringing was clicked away.
const quieted = new Set();

const remaining = (cd, now) => (cd.running ? Math.max(0, cd.endsAt - now) : cd.remainingMs);
const elapsed = (sw, now) => (sw.running ? sw.accumulated + (now - sw.startedAt) : sw.accumulated);

function countdownView(now) {
  const running = countdowns.filter((cd) => cd.running && cd.endsAt > now).sort((a, b) => a.endsAt - b.endsAt);
  const rang = countdowns.find((cd) => cd.done && !quieted.has(cd.id) && now - cd.endsAt >= 0 && now - cd.endsAt < RING_MS);
  if (rang && !running.length) return { kind: "countdown", ringing: true, id: rang.id, name: rang.name, time: "Time's up", more: 0 };
  const cd = running[0];
  if (!cd) return null;
  const left = remaining(cd, now);
  return { kind: "countdown", name: cd.name, time: formatRemaining(left), urgent: left <= URGENT_MS, more: running.length - 1 };
}

function stopwatchView(now) {
  const sw = stopwatches.filter((s) => s.running).sort((a, b) => elapsed(b, now) - elapsed(a, now))[0];
  return sw && { kind: "stopwatch", name: sw.name, time: formatElapsedShort(elapsed(sw, now)) };
}

function mediaView(now) {
  if (!media.hasSession || !(media.playing || now - pausedAt < KEEP_MEDIA_MS)) return null;
  return {
    kind: "media",
    cover: media.thumbnail || null,
    title: [media.title, media.artist].filter(Boolean).join(" · ") || prettySource(media.source),
    playing: Boolean(media.playing),
    canSkip: canSkip(),
  };
}

const current = () => devices.find((d) => d.isDefault) ?? null;
const isAirPods = (d) => Boolean(d?.bluetooth && /airpods|beats/i.test(d.name));
const pct = (n) => (n == null ? "–" : `${n}%`);

function headphonesView() {
  const device = current();
  if (!device) return null;
  if (isAirPods(device) && pods) {
    return { kind: "headphones", title: pods.model || device.name, time: `L ${pct(pods.left.battery)} R ${pct(pods.right.battery)}`, stale: !pods.fresh };
  }
  const headset = device.bluetooth || ["headphones", "headset"].includes(device.kind);
  return headset && device.battery != null ? { kind: "headphones", title: device.name, time: `${device.battery}%` } : null;
}

const VIEWS = { countdown: countdownView, stopwatch: stopwatchView, media: mediaView, headphones: headphonesView };

/** The views to show, left to right: { apart, items }. */
function views(now) {
  const on = settings.dockItems.filter((i) => i.on);
  // Apart, the countdown leaves the order and goes first, in its own pill.
  const apart = settings.dockApart && on.some((i) => i.id === "countdown") ? countdownView(now) : null;
  const items = on
    .filter((i) => !(settings.dockApart && i.id === "countdown"))
    .map((i) => VIEWS[i.id](now))
    .filter(Boolean);
  return { apart, items };
}

/* ---------- painting ---------- */

// `off`: shown but greyed out (a player that doesn't say where the track is
// can't be jumped back or forward).
const button = (action, name, title, off = false) =>
  `<button class="dk-btn" data-media="${action}" title="${off ? `${title} (this player doesn't allow it)` : title}" aria-label="${title}" ${off ? "disabled" : ""}>${icon(name)}</button>`;

// Every item but the countdown pill carries data-slot: when the taskbar
// leaves too little room, slots are dropped from the end (see fit()).
function itemHtml(v, apart = false) {
  const slot = apart ? "" : "data-slot";
  switch (v.kind) {
    case "countdown":
      return `<button ${slot} class="dk-item dk-countdown ${apart ? "is-apart" : ""} ${v.urgent ? "is-urgent" : ""} ${v.ringing ? "is-ringing" : ""}"
          ${v.ringing ? `data-quiet="${v.id}"` : `data-open="countdowns"`} title="${v.ringing ? "Click to silence" : escapeHtml(v.name)}">
          <span class="dk-icon">${icon(v.ringing ? "bell" : "countdown")}</span>
          <span class="dk-text">${escapeHtml(v.name)}</span>
          <span class="dk-time" data-time="countdown">${v.time}</span>
          ${v.more > 0 ? `<span class="dk-badge">+${v.more}</span>` : ""}
        </button>`;
    case "stopwatch":
      return `<button ${slot} class="dk-item dk-stopwatch" data-open="timers" title="${escapeHtml(v.name)}">
          <span class="dk-icon">${icon("stopwatch")}</span>
          <span class="dk-time" data-time="stopwatch">${v.time}</span>
        </button>`;
    case "media":
      return `<div ${slot} class="dk-group dk-media ${v.playing ? "is-playing" : "is-paused"}">
          <button class="dk-item dk-now" data-open="media" title="${escapeHtml(v.title)}">
            <span class="dk-cover">${coverHtml(v.cover, "dk-art")}</span>
            <span class="dk-text">${escapeHtml(v.title)}</span>
          </button>
          <span class="dk-controls">
            ${button("previous", "previous", "Previous")}
            ${button("back", "back15", "Back 15 seconds", !v.canSkip)}
            ${button("toggle", v.playing ? "pause" : "play", v.playing ? "Pause" : "Play")}
            ${button("forward", "forward15", "Forward 15 seconds", !v.canSkip)}
            ${button("next", "next", "Next")}
          </span>
        </div>`;
    case "idle":
      // Nothing going on: the app's own button, so the dock is always
      // there to be found, and opens the peninsula.
      return `<button class="dk-item dk-idle" data-open="" title="Open Dynamic Peninsula" aria-label="Open Dynamic Peninsula">
          <img class="dk-app" src="${appIcon}" alt="" />
        </button>`;
    case "headphones":
      return `<button ${slot} class="dk-item dk-headphones ${v.stale ? "is-stale" : ""}" data-open="media" title="${escapeHtml(v.title)}">
          <span class="dk-icon">${icon("headphones")}</span>
          <span class="dk-time">${escapeHtml(v.time)}</span>
        </button>`;
    default:
      return "";
  }
}

// What the markup depends on, apart from the ticking times; the DOM is
// only rebuilt when this changes, so hover and artwork don't flicker.
const keyOf = (v) =>
  v && JSON.stringify({ ...v, time: v.kind === "headphones" ? v.time : undefined });

let lastKey = null;

function paint() {
  const now = Date.now();
  const { apart, items: shown } = views(now);
  const items = apart || shown.length ? shown : [{ kind: "idle" }];
  const key = [root.dataset.dockLook, root.dataset.theme, root.dataset.mode, keyOf(apart), ...items.map(keyOf)].join("|");
  if (key !== lastKey) {
    lastKey = key;
    dock.innerHTML =
      (apart ? itemHtml(apart, true) + (items.length ? `<span class="dk-sep" aria-hidden="true"></span>` : "") : "") +
      items.map((v) => itemHtml(v)).join("");
  }
  // Only the times move every second.
  const times = { countdown: apart ?? items.find((v) => v.kind === "countdown"), stopwatch: items.find((v) => v.kind === "stopwatch") };
  for (const el of dock.querySelectorAll("[data-time]")) {
    const v = times[el.dataset.time];
    if (v && el.textContent !== v.time) el.textContent = v.time;
  }
  fit();
  schedule(now);
}

// Too little room: the last items in the order go first. The countdown
// pill always stays.
let fitted = "";
function fit() {
  const slots = [...dock.querySelectorAll(":scope > [data-slot]")];
  const sep = dock.querySelector(":scope > .dk-sep");
  for (const el of slots) el.hidden = false;
  if (sep) sep.hidden = false;
  for (let i = slots.length - 1; i >= 0 && dock.scrollWidth > dock.clientWidth + 1; i--) slots[i].hidden = true;
  if (sep) sep.hidden = slots.every((el) => el.hidden);
  const shape = `${slots.map((el) => (el.hidden ? 0 : 1)).join("")}:${dock.offsetWidth}`;
  if (shape !== fitted) {
    fitted = shape;
    reportHitRect();
  }
}

// Fast while something counts, otherwise just often enough to notice new
// data quickly.
let timer = null;
function schedule(now) {
  clearTimeout(timer);
  const counting = countdowns.some((cd) => cd.running) || stopwatches.some((sw) => sw.running);
  timer = setTimeout(paint, counting ? 250 - (now % 250) : 1000);
}

/* ---------- click-through: only the painted items take clicks ---------- */

let hitFrame = 0;
function reportHitRect() {
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(() => {
    const r = dock.getBoundingClientRect();
    call("set_hit_rect", { rect: { x: r.left, y: r.top, width: r.width, height: r.height } }).catch(() => {});
  });
}
new ResizeObserver(reportHitRect).observe(dock);
window.addEventListener("resize", () => fit());

/* ---------- input ---------- */

dock.addEventListener("click", (e) => {
  const media = e.target.closest("[data-media]");
  if (media) {
    const action = media.dataset.media;
    if (action === "back" || action === "forward") return skip(action === "back" ? -1 : 1);
    call("media_control", { action }).catch(() => {});
    return;
  }
  const quiet = e.target.closest("[data-quiet]");
  if (quiet) {
    quieted.add(Number(quiet.dataset.quiet));
    call("dock_open", { page: "silence" }).catch(() => {});
    paint();
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) call("dock_open", { page: open.dataset.open }).catch(() => {});
});

// The wheel over the music changes the volume, as on the peninsula's bar.
dock.addEventListener(
  "wheel",
  (e) => {
    if (!e.deltaY || !e.target.closest(".dk-media")) return;
    e.preventDefault();
    call("volume_step", { delta: e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP }).catch(() => {});
  },
  { passive: false }
);

// No context menu, text selection or focus rings of a web page.
window.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- boot ---------- */

function setMedia(next) {
  if (media.playing && !next?.playing) pausedAt = Date.now();
  media = next ?? { hasSession: false };
  timelineAt = Date.now();
  paint();
}

/* ---------- 15 s back / forward, as on the peninsula ---------- */

const SKIP_MS = 15_000;
// When media.timeline was last known; while playing it moves on by itself.
let timelineAt = Date.now();

const canSkip = () => media.timeline?.durationMs > 0;

function position() {
  const { positionMs = 0, durationMs = 0 } = media.timeline ?? {};
  const now = positionMs + (media.playing ? Date.now() - timelineAt : 0);
  return durationMs ? Math.min(now, durationMs) : now;
}

function skip(direction) {
  if (!canSkip()) return;
  const target = position() + direction * SKIP_MS;
  const positionMs = Math.round(Math.min(media.timeline.durationMs, Math.max(0, target)));
  call("media_seek", { positionMs }).catch(() => {});
  // Pressed again quickly, it adds up from here.
  media = { ...media, timeline: { ...media.timeline, positionMs } };
  timelineAt = Date.now();
}

// The peninsula writes; this window hears about it at once.
window.addEventListener("storage", (e) => {
  if (!e.key || e.key.startsWith("dp.")) {
    readStore();
    paint();
  }
});

readStore();
applyLayout({ height: 48, width: 300, light: false, accent: "#0078d4", transparency: true });
paint();

// Outside the app (`npm run dev`, then /dock.html?demo), sample music and
// headphones so the look can be worked on in a browser.
if (!inTauri && new URLSearchParams(location.search).has("demo")) {
  const q = new URLSearchParams(location.search);
  devices = [{ id: "demo", name: "Headphones (AirPods Pro)", bluetooth: true, isDefault: true }];
  pods = { model: "AirPods Pro", fresh: true, left: { battery: 80 }, right: { battery: 70 }, case: { battery: 60 } };
  applyLayout({ height: Number(q.get("h") || 48), width: Number(q.get("w") || 360), light: q.has("light"), accent: q.get("accent") || "#0078d4", transparency: true });
  setMedia({ hasSession: true, playing: !q.has("paused"), title: "Midnight City", artist: "M83", source: "Spotify.exe", timeline: { positionMs: 60000, durationMs: 240000 } });
}

if (inTauri) {
  on("dock://layout", (layout) => {
    applyLayout(layout);
    fit();
    reportHitRect();
  });
  on("media://update", setMedia);
  on("media://timeline", (timeline) => {
    media = { ...media, timeline };
    timelineAt = Date.now();
    paint();
  });
  on("audio://devices", (next) => {
    devices = next?.devices ?? [];
    paint();
  });
  on("airpods://update", (next) => {
    pods = next;
    paint();
  });
  call("dock_layout")
    .then((layout) => {
      applyLayout(layout);
      fit();
    })
    .catch(() => {});
  Promise.all([call("media_state"), call("audio_devices"), call("airpods_state")])
    .then(([m, d, p]) => {
      devices = d?.devices ?? [];
      pods = p ?? null;
      setMedia(m);
    })
    .catch(() => {});
}
