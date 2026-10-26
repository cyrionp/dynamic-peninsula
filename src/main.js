// Dynamic Peninsula — frontend entry point.
// Wires the slim bar, hover open/close, tabs, the shared ticker and alerts
// together; each feature lives in its own module.

import { call } from "./tauri.js";
import { load, save } from "./store.js";
import { icon, paintIcons } from "./icons.js";
import { playChime } from "./sound.js";
import { formatClock, formatElapsedShort, formatRemaining, escapeHtml } from "./util.js";
import { initSettings, applyTheme, getSettings, render as renderSettings } from "./settings.js";
import * as stopwatches from "./stopwatches.js";
import * as countdowns from "./countdowns.js";
import {
  initMedia,
  media,
  hasControls,
  control as mediaControl,
  prettySource,
  coverHtml,
  guardCovers,
  render as renderMedia,
} from "./media.js";
import { initNotes, renderNotes, initTodos, renderTodos } from "./lists.js";
import { initAudio, noticeView, render as renderAudio } from "./audio.js";
import { initLayout } from "./layout.js";
import { initWeather, current as currentWeather } from "./weather.js";

const peninsula = document.getElementById("peninsula");
const barLead = document.getElementById("bar-lead");
const barText = document.getElementById("bar-text");
const barValue = document.getElementById("bar-value");
const barControls = document.getElementById("bar-controls");
guardCovers(barLead);

let page = load("tab", "media");

/* ---------- click-through: tell Rust where the painted area is ---------- */

let hitFrame = 0;
function reportHitRect() {
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(() => {
    const r = peninsula.getBoundingClientRect();
    call("set_hit_rect", {
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    }).catch(() => {});
  });
}
new ResizeObserver(reportHitRect).observe(peninsula);

/* ---------- open / close on hover ---------- */

let hovering = false;
let closeTimer = null;

const state = () => peninsula.dataset.state;
function setState(next) {
  if (state() === next) return;
  peninsula.dataset.state = next;
  syncTicker();
  paintBar(true);
}

// Typing somewhere keeps the panel open even if the mouse wanders off;
// clicking another app (window blur) closes it.
function isEditing() {
  const el = document.activeElement;
  if (!el || !peninsula.contains(el)) return false;
  return el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "range"].includes(el.type));
}

// Hovering the bar's media buttons leaves it closed, so they stay put under
// the mouse; anywhere else opens the panel.
peninsula.addEventListener("mouseover", (e) => {
  hovering = true;
  clearTimeout(closeTimer);
  if (e.target.closest("#bar-controls")) return;
  if (state() !== "alert") setState("expanded");
});

peninsula.addEventListener("mouseleave", () => {
  hovering = false;
  if (isEditing()) return;
  // small delay so a brief mouse-out doesn't snap it shut
  closeTimer = setTimeout(() => {
    if (state() === "expanded") setState("collapsed");
  }, 220);
});

window.addEventListener("blur", () => {
  if (state() === "expanded" && !hovering) {
    document.activeElement?.blur();
    setState("collapsed");
  }
});

/* ---------- tabs ---------- */

function showPage(next) {
  page = next;
  save("tab", page);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("is-active", p.dataset.page === page));
  syncTicker();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) showPage(tab.dataset.page);
});

/* ---------- the slim bar ---------- */

function clockView() {
  const now = new Date();
  const { bar, clock24 } = getSettings();
  const time = formatClock(now, clock24);
  if (bar === "date") {
    const day = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    return { lead: "dot", text: day, value: time };
  }
  return { lead: "dot", text: "", value: time };
}

// The weather sits next to the clock, so the time never goes missing.
function weatherView() {
  const w = currentWeather();
  if (!w) return null;
  return { lead: w.icon, text: `${w.temp} ${w.place}`, value: formatClock(new Date(), getSettings().clock24) };
}

function countdownView() {
  const cd = countdowns.soonest();
  return cd && { lead: "countdown", text: cd.name, value: formatRemaining(countdowns.remaining(cd)), live: true };
}

function stopwatchView() {
  const sw = stopwatches.leadingRunning();
  return sw && { lead: "stopwatch", text: sw.name, value: formatElapsedShort(stopwatches.elapsed(sw)), live: true };
}

function mediaView(onlyPlaying) {
  const m = media();
  if (!m.hasSession || (onlyPlaying && !m.playing)) return null;
  return {
    lead: { cover: m.thumbnail || null },
    text: [m.title, m.artist].filter(Boolean).join(" · ") || prettySource(m.source),
    value: "",
    playing: m.playing,
  };
}

/* ---------- mouse wheel over the bar: system volume ---------- */

const VOLUME_STEP = 0.02;
let volumeShown = null;
let volumeTimer = null;
let volumePending = 0;
let volumeBusy = false;

// One call at a time; wheel ticks that arrive meanwhile are added up.
async function sendVolume() {
  if (volumeBusy || !volumePending) return;
  volumeBusy = true;
  const delta = volumePending;
  volumePending = 0;
  try {
    const v = await call("volume_step", { delta });
    if (v) showVolume(v);
  } catch {
    // no audio device: nothing to show
  }
  volumeBusy = false;
  sendVolume();
}

function showVolume(v) {
  volumeShown = v;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    volumeShown = null;
    paintBar();
  }, 1400);
  paintBar();
}

document.getElementById("bar").addEventListener(
  "wheel",
  (e) => {
    if (!e.deltaY) return;
    e.preventDefault();
    volumePending += e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP;
    sendVolume();
  },
  { passive: false }
);

function volumeView() {
  const { level, muted } = volumeShown;
  return { lead: muted ? "mute" : "volume", text: muted ? "Muted" : "Volume", value: `${Math.round(level * 100)}%` };
}

function barView() {
  if (volumeShown) return volumeView();
  const headphones = noticeView();
  if (headphones) return headphones;
  switch (getSettings().bar) {
    case "media":
      return mediaView(false) ?? clockView();
    case "countdown":
      return countdownView() ?? clockView();
    case "stopwatch":
      return stopwatchView() ?? clockView();
    case "weather":
      return weatherView() ?? clockView();
    case "clock":
    case "date":
      return clockView();
    default:
      return smartView();
  }
}

const SMART_VIEWS = {
  countdown: countdownView,
  media: () => mediaView(true),
  stopwatch: stopwatchView,
  weather: weatherView,
};

// The first item in the user's order that has something to show.
function smartView() {
  for (const item of getSettings().smart) {
    const view = item.on && SMART_VIEWS[item.id]?.();
    if (view) return view;
  }
  return clockView();
}

let lastLead = "";
let lastText = null;

// Only touches the DOM for what actually changed.
function paintBar(force = false) {
  const view = barView();
  const leadKey = typeof view.lead === "string" ? view.lead : `cover:${view.lead.cover}`;
  if (force || leadKey !== lastLead) {
    lastLead = leadKey;
    barLead.innerHTML =
      view.lead === "dot"
        ? `<span class="dot"></span>`
        : typeof view.lead === "string"
          ? icon(view.lead)
          : coverHtml(view.lead.cover, "lead-cover");
  }
  if (force || view.text !== lastText) {
    lastText = view.text;
    barText.innerHTML = escapeHtml(view.text);
  }
  barValue.textContent = view.value;
  paintControls(force);
  peninsula.classList.toggle("bar-media-paused", view.playing === false);
  peninsula.classList.toggle("bar-has-text", Boolean(view.text));
}

let lastControls = null;

function paintControls(force) {
  const show = hasControls();
  const key = show ? `${media().playing}` : "";
  peninsula.classList.toggle("bar-has-controls", show);
  if (!force && key === lastControls) return;
  lastControls = key;
  const button = (action, name, title) =>
    `<button class="bar-btn" data-media="${action}" title="${title}">${icon(name)}</button>`;
  barControls.innerHTML = show
    ? button("previous", "previous", "Previous") +
      button("toggle", media().playing ? "pause" : "play", media().playing ? "Pause" : "Play") +
      button("next", "next", "Next")
    : "";
}

barControls.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-media]");
  if (btn) mediaControl(btn.dataset.media);
});

// The clock repaints exactly on the minute, so it never lags behind.
function scheduleClock() {
  const now = Date.now();
  setTimeout(() => {
    paintBar();
    scheduleClock();
  }, 60_000 - (now % 60_000) + 30);
}

/* ---------- shared ticker: runs only while something is counting ---------- */

let tick = null;
let tickRate = 0;

function onTick() {
  const now = Date.now();
  for (const cd of countdowns.tick(now)) raiseAlert(cd);
  if (state() === "expanded") {
    if (page === "timers") stopwatches.paintTimes(now);
    if (page === "countdowns") countdowns.paintTimes(now);
  }
  paintBar();
}

function syncTicker() {
  const running = stopwatches.anyRunning() || countdowns.anyRunning();
  const rate = !running ? 0 : state() === "expanded" && page === "timers" ? 50 : 200;
  if (rate === tickRate) return;
  clearInterval(tick);
  tick = rate ? setInterval(onTick, rate) : null;
  tickRate = rate;
}

/* ---------- alerts when a countdown ends ---------- */

const alertQueue = [];
let alertTimer = null;
let soundRepeat = null;

function raiseAlert(cd) {
  alertQueue.push({ id: cd.id, name: cd.name });
  if (alertQueue.length === 1) showAlert();
}

function showAlert() {
  const current = alertQueue[0];
  document.getElementById("alert-name").textContent = current.name;
  clearTimeout(closeTimer);
  setState("alert");
  // restart the entrance animation for back-to-back alerts
  peninsula.classList.remove("alert-anim");
  void peninsula.offsetWidth;
  peninsula.classList.add("alert-anim");

  const { sound, volume } = getSettings();
  clearTimeout(soundRepeat);
  if (sound) {
    playChime(volume);
    soundRepeat = setTimeout(() => playChime(volume * 0.7), 2400);
  }
  clearTimeout(alertTimer);
  alertTimer = setTimeout(dismissAlert, 30_000);
}

function dismissAlert() {
  clearTimeout(alertTimer);
  clearTimeout(soundRepeat);
  alertQueue.shift();
  if (alertQueue.length) return showAlert();
  peninsula.classList.remove("alert-anim");
  setState(hovering ? "expanded" : "collapsed");
}

document.getElementById("alert-dismiss").addEventListener("click", dismissAlert);
document.getElementById("alert-restart").addEventListener("click", () => {
  const current = alertQueue[0];
  if (current) countdowns.restart(current.id);
  dismissAlert();
  syncTicker();
});

/* ---------- boot ---------- */

function onDataChange() {
  syncTicker();
  paintBar();
}

function onSettingsChange(patch) {
  if ("theme" in patch || "mode" in patch) {
    applyTheme();
    paintIcons();
    // Lists embed icons, so redraw them in the new style.
    stopwatches.render();
    countdowns.render();
    renderNotes();
    renderTodos();
    renderMedia();
    renderAudio();
    renderSettings();
  }
  paintBar(true);
}

applyTheme();
paintIcons();
initSettings(onSettingsChange);
stopwatches.initStopwatches(onDataChange);
countdowns.initCountdowns(onDataChange);
initNotes();
initTodos();
initMedia(() => paintBar());
initAudio(() => paintBar());
initWeather((configChanged) => {
  // Switching it on or off adds or removes it from the Smart list.
  if (configChanged) renderSettings();
  paintBar(true);
});
initLayout({
  onLayout: reportHitRect,
  // Locked: it can't be hovered any more, so fold it away.
  onLock(locked) {
    if (!locked || state() !== "expanded") return;
    hovering = false;
    document.activeElement?.blur();
    setState("collapsed");
  },
});
showPage(page);
paintBar(true);
scheduleClock();
syncTicker();
