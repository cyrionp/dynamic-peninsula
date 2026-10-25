// Where the peninsula sits and how it looks: drag it anywhere, pick the bar
// and panel sizes, a minimal look, transparency, and the click-through lock.
//
// The window is a transparent frame a little larger than the open panel.
// Inside it the peninsula is anchored to the side it should grow from, so
// near a screen edge it opens away from the edge instead of off screen.

import { call, on, inTauri } from "./tauri.js";
import { load, save } from "./store.js";

export const BAR_SIZES = [
  { id: "s", label: "Small", width: 180, height: 28, font: 12 },
  { id: "m", label: "Medium", width: 220, height: 34, font: 13 },
  { id: "l", label: "Large", width: 260, height: 40, font: 14 },
  { id: "xl", label: "Huge", width: 300, height: 46, font: 15 },
];

export const PANEL_SIZES = [
  { id: "s", label: "Small", width: 400, height: 280 },
  { id: "m", label: "Medium", width: 480, height: 320 },
  { id: "l", label: "Large", width: 560, height: 380 },
  { id: "xl", label: "Huge", width: 640, height: 440 },
];

const DEFAULTS = {
  bar: "m",
  panel: "m",
  minimal: false,
  opacity: 1,
  solidOpen: true,
  locked: false,
};

// Room around the peninsula for its shadow, in CSS pixels.
const PAD = 24;
// The alert card needs at least this much room.
const ALERT = { width: 380, height: 64 };
// Dropped this close to the top of a screen, it docks and hangs from it.
const SNAP = 18;
// Minimal look: a short pill instead of the full bar.
const MINIMAL_WIDTH = 0.55;

let look = { ...DEFAULTS, ...load("layout", {}) };
// Bar center in physical screen pixels, and whether it hangs from the top.
let anchor = load("position", null);

const stage = document.getElementById("stage");
const peninsula = document.getElementById("peninsula");
let mode = { h: "center", v: "start", docked: true };
let hooks = { onLayout() {}, onLock() {} };

export const getLook = () => look;

function barSize() {
  const bar = BAR_SIZES.find((s) => s.id === look.bar) ?? BAR_SIZES[1];
  return look.minimal ? { ...bar, width: Math.round(bar.width * MINIMAL_WIDTH), height: bar.height - 4 } : bar;
}

const panelSize = () => PANEL_SIZES.find((s) => s.id === look.panel) ?? PANEL_SIZES[1];

// The window frame, in CSS pixels.
function frame() {
  const bar = barSize();
  const panel = panelSize();
  return {
    width: Math.max(bar.width, panel.width, ALERT.width) + PAD * 2,
    height: Math.max(bar.height, panel.height, ALERT.height) + PAD * 2,
  };
}

function applyLook() {
  const bar = barSize();
  const panel = panelSize();
  const style = peninsula.style;
  style.setProperty("--bar-w", `${bar.width}px`);
  style.setProperty("--bar-h", `${bar.height}px`);
  style.setProperty("--bar-font", `${bar.font}px`);
  style.setProperty("--panel-w", `${panel.width}px`);
  style.setProperty("--panel-h", `${panel.height}px`);
  style.setProperty("--pen-opacity", String(look.opacity));
  peninsula.classList.toggle("is-minimal", look.minimal);
  peninsula.classList.toggle("solid-open", look.solidOpen);
  peninsula.classList.toggle("is-locked", look.locked);
  stage.style.setProperty("--pad", `${PAD}px`);
}

function applyMode() {
  stage.dataset.h = mode.h;
  stage.dataset.v = mode.v;
  stage.dataset.docked = String(mode.docked);
}

// Where the bar's top-left corner sits inside the window, in CSS pixels.
function barOffset(m) {
  const bar = barSize();
  const f = frame();
  const x = m.h === "start" ? PAD : m.h === "end" ? f.width - PAD - bar.width : (f.width - bar.width) / 2;
  const y = m.v === "end" ? f.height - PAD - bar.height : m.docked ? 0 : PAD;
  return { x, y };
}

/* ---------- placing the window ---------- */

let expected = null;

async function windowApi() {
  const api = await import("@tauri-apps/api/window");
  const dpi = await import("@tauri-apps/api/dpi");
  return { ...api, ...dpi, win: api.getCurrentWindow() };
}

function contains(area, x, y) {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

async function pickMonitor(api, point) {
  const monitors = await api.availableMonitors();
  const areas = monitors.map((m) => ({
    x: m.workArea.position.x,
    y: m.workArea.position.y,
    width: m.workArea.size.width,
    height: m.workArea.size.height,
    scale: m.scaleFactor,
  }));
  if (point) {
    const hit = areas.find((a) => contains(a, point.cx, point.cy));
    if (hit) return hit;
    // Off every screen (a monitor was unplugged): the nearest one.
    const dist = (a) =>
      Math.hypot(point.cx - (a.x + a.width / 2), point.cy - (a.y + a.height / 2));
    return areas.sort((a, b) => dist(a) - dist(b))[0];
  }
  const primary = await api.primaryMonitor();
  return areas.find((a) => primary && a.x === primary.workArea.position.x && a.y === primary.workArea.position.y) ?? areas[0];
}

/** Moves the window so the bar sits at `target` (or the top-center). */
async function place(target) {
  applyLook();
  if (!inTauri) return applyMode();
  const api = await windowApi();
  const area = await pickMonitor(api, target);
  if (!area) return;
  const s = area.scale;
  const bar = barSize();
  const panel = panelSize();
  const bw = bar.width * s;
  const bh = bar.height * s;
  const pw = panel.width * s;
  const ph = panel.height * s;
  const right = area.x + area.width;
  const bottom = area.y + area.height;

  let cx = target ? target.cx : area.x + area.width / 2;
  let cy = target ? target.cy : area.y + bh / 2;
  cx = Math.min(Math.max(cx, area.x + bw / 2), right - bw / 2);
  cy = Math.min(Math.max(cy, area.y + bh / 2), bottom - bh / 2);

  const docked = !target || target.docked || cy - bh / 2 - area.y < SNAP * s;
  if (docked) cy = area.y + bh / 2;

  const h =
    cx - pw / 2 >= area.x && cx + pw / 2 <= right ? "center" : cx < area.x + area.width / 2 ? "start" : "end";
  const v = docked || cy - bh / 2 + ph <= bottom ? "start" : "end";
  mode = { h, v, docked };
  applyMode();

  const f = frame();
  const offset = barOffset(mode);
  const x = Math.round(cx - bw / 2 - offset.x * s);
  const y = Math.round(cy - bh / 2 - offset.y * s);
  expected = { x, y };
  anchor = { cx, cy, docked };
  save("position", anchor);

  await api.win.setSize(new api.PhysicalSize(Math.round(f.width * s), Math.round(f.height * s)));
  await api.win.setPosition(new api.PhysicalPosition(x, y));
  await api.win.show();
  hooks.onLayout();
}

// After the user drags the window, work out where the bar ended up and
// re-place it there: that snaps it to the top edge and picks the side to
// open towards.
let settleTimer = null;
async function onMoved(pos) {
  if (expected && Math.abs(pos.x - expected.x) <= 1 && Math.abs(pos.y - expected.y) <= 1) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(async () => {
    const api = await windowApi();
    const s = await api.win.scaleFactor();
    const at = await api.win.outerPosition();
    const bar = barSize();
    const offset = barOffset(mode);
    place({
      cx: at.x + (offset.x + bar.width / 2) * s,
      cy: at.y + (offset.y + bar.height / 2) * s,
      docked: false,
    });
  }, 350);
}

export function resetPosition() {
  return place(null);
}

/* ---------- dragging ---------- */

const DRAG_THRESHOLD = 4;

function initDrag() {
  const bar = document.getElementById("bar");
  bar.addEventListener("mousedown", (down) => {
    if (down.button !== 0 || look.locked || !inTauri) return;
    const move = async (e) => {
      if (!(e.buttons & 1)) return stop();
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_THRESHOLD) return;
      stop();
      const { win } = await windowApi();
      win.startDragging().catch(() => {});
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  });
}

/* ---------- lock ---------- */

function setLocked(locked) {
  if (look.locked !== locked) update({ locked });
  call("set_locked", { locked }).catch(() => {});
}

/* ---------- settings section ---------- */

function update(patch) {
  look = { ...look, ...patch };
  save("layout", look);
  if ("bar" in patch || "panel" in patch || "minimal" in patch) place(anchor);
  else applyLook();
  if ("locked" in patch) hooks.onLock(look.locked);
  paintLayout();
}

const chips = (list, key) =>
  list
    .map((s) => `<button class="chip ${s.id === look[key] ? "is-active" : ""}" data-${key}-size="${s.id}">${s.label}</button>`)
    .join("");

export function paintLayout() {
  const box = document.getElementById("layout-box");
  if (!box) return;
  box.innerHTML = `
    <h3>Bar size</h3>
    <div class="chips">${chips(BAR_SIZES, "bar")}</div>

    <h3>Opens to</h3>
    <div class="chips">${chips(PANEL_SIZES, "panel")}</div>

    <h3>Look</h3>
    <label class="switch-row">
      <span>Minimal bar</span>
      <input type="checkbox" class="switch" id="set-minimal" ${look.minimal ? "checked" : ""} />
    </label>
    <div class="switch-row">
      <span>Opacity</span>
      <input type="range" id="set-opacity" min="0.2" max="1" step="0.05" value="${look.opacity}" />
      <span class="range-value">${Math.round(look.opacity * 100)}%</span>
    </div>
    <label class="switch-row">
      <span>Solid while open</span>
      <input type="checkbox" class="switch" id="set-solid-open" ${look.solidOpen ? "checked" : ""} />
    </label>

    <h3>Position</h3>
    <div class="switch-row">
      <span>Drag the bar to move it anywhere</span>
      <button class="mini" id="reset-position">Top center</button>
    </div>
    <div class="switch-row">
      <span>Lock: clicks go to the windows below</span>
      <button class="mini" id="lock-now">Lock</button>
    </div>
    <p class="hint">Unlock from the tray icon's menu.</p>
  `;
}

function initSection() {
  // Settings re-renders its page, so listen on the page rather than the box.
  const page = document.getElementById("settings-page");
  page.addEventListener("click", (e) => {
    const bar = e.target.closest("[data-bar-size]");
    if (bar) return update({ bar: bar.dataset.barSize });
    const panel = e.target.closest("[data-panel-size]");
    if (panel) return update({ panel: panel.dataset.panelSize });
    if (e.target.closest("#reset-position")) resetPosition();
    if (e.target.closest("#lock-now")) setLocked(true);
  });
  page.addEventListener("change", (e) => {
    if (e.target.id === "set-minimal") update({ minimal: e.target.checked });
    if (e.target.id === "set-solid-open") update({ solidOpen: e.target.checked });
  });
  // Live while sliding, so the result is visible straight away.
  page.addEventListener("input", (e) => {
    if (e.target.id !== "set-opacity") return;
    look = { ...look, opacity: Number(e.target.value) };
    save("layout", look);
    applyLook();
    const label = e.target.parentElement.querySelector(".range-value");
    if (label) label.textContent = `${Math.round(look.opacity * 100)}%`;
  });
}

export async function initLayout({ onLayout, onLock }) {
  hooks = { onLayout, onLock };
  applyLook();
  applyMode();
  initDrag();
  initSection();
  paintLayout();

  await on("lock-changed", (locked) => {
    if (look.locked !== locked) update({ locked });
  });
  await on("reset-position", () => resetPosition());
  if (inTauri) {
    const { win } = await windowApi();
    await win.onMoved(({ payload }) => onMoved(payload));
    // Moved onto a screen with another scale: resize the frame to match.
    await win.onScaleChanged(() => place(anchor));
  }
  call("set_locked", { locked: look.locked }).catch(() => {});
  await place(anchor);
}
