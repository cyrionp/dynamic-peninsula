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
import { initMedia, media, prettySource, render as renderMedia } from "./media.js";
import { initNotes, initTodos, renderTodos } from "./lists.js";

const peninsula = document.getElementById("peninsula");
const barLead = document.getElementById("bar-lead");
const barText = document.getElementById("bar-text");
const barValue = document.getElementById("bar-value");

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

peninsula.addEventListener("mouseenter", () => {
  hovering = true;
  clearTimeout(closeTimer);
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
    lead: m.thumbnail ? { cover: m.thumbnail } : "media",
    text: [m.title, m.artist].filter(Boolean).join(" · ") || prettySource(m.source),
    value: "",
    playing: m.playing,
  };
}

function barView() {
  switch (getSettings().bar) {
    case "media":
      return mediaView(false) ?? clockView();
    case "countdown":
      return countdownView() ?? clockView();
    case "stopwatch":
      return stopwatchView() ?? clockView();
    case "clock":
    case "date":
      return clockView();
    default:
      return countdownView() ?? mediaView(true) ?? stopwatchView() ?? clockView();
  }
}

let lastLead = "";
let lastText = null;

// Only touches the DOM for what actually changed.
function paintBar(force = false) {
  const view = barView();
  const leadKey = typeof view.lead === "string" ? view.lead : view.lead.cover;
  if (force || leadKey !== lastLead) {
    lastLead = leadKey;
    barLead.innerHTML =
      view.lead === "dot"
        ? `<span class="dot"></span>`
        : typeof view.lead === "string"
          ? icon(view.lead)
          : `<img src="${view.lead.cover}" alt="" />`;
  }
  if (force || view.text !== lastText) {
    lastText = view.text;
    barText.innerHTML = escapeHtml(view.text);
  }
  barValue.textContent = view.value;
  peninsula.classList.toggle("bar-media-paused", view.playing === false);
  peninsula.classList.toggle("bar-has-text", Boolean(view.text));
}

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
  if ("theme" in patch) {
    applyTheme();
    paintIcons();
    // Lists embed icons, so redraw them in the new style.
    stopwatches.render();
    countdowns.render();
    renderTodos();
    renderMedia();
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
showPage(page);
paintBar(true);
scheduleClock();
syncTicker();
