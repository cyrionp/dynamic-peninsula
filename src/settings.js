// Settings page: theme and dark/light mode, what the slim bar shows, size and
// look, clock format, sound and updates.

import { load, save } from "./store.js";
import { THEMES, MODES, themeById } from "./themes.js";
import { setIconStyle, paintIcons } from "./icons.js";
import { playChime } from "./sound.js";
import { initUpdates, checkForUpdates, installUpdate, paintUpdates } from "./updates.js";
import { paintLayout } from "./layout.js";

const DEFAULTS = {
  theme: "lagoon",
  mode: "dark",
  bar: "smart",
  clock24: true,
  sound: true,
  volume: 0.6,
};

export const BAR_MODES = [
  { id: "smart", label: "Smart", hint: "Countdown, then music, then stopwatch, else the clock" },
  { id: "media", label: "Now playing" },
  { id: "countdown", label: "Countdown" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "clock", label: "Clock" },
  { id: "date", label: "Date & time" },
];

const saved = load("settings", {});
// Paper was the only light theme before modes existed; keep it light.
if (!saved.mode && saved.theme === "paper") saved.mode = "light";
let settings = { ...DEFAULTS, ...saved };
let changed = () => {};

export const getSettings = () => settings;

export function applyTheme() {
  const theme = themeById(settings.theme);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.mode = settings.mode;
  setIconStyle(theme.icons);
}

function update(patch) {
  settings = { ...settings, ...patch };
  save("settings", settings);
  render();
  changed(patch);
}

export function initSettings(onChange) {
  changed = onChange;
  const page = document.getElementById("settings-page");

  page.addEventListener("click", (e) => {
    const theme = e.target.closest("[data-theme-pick]");
    if (theme) return update({ theme: theme.dataset.themePick });

    const mode = e.target.closest("[data-mode-pick]");
    if (mode) return update({ mode: mode.dataset.modePick });

    const bar = e.target.closest("[data-bar]");
    if (bar) return update({ bar: bar.dataset.bar });

    if (e.target.closest("#test-sound")) playChime(settings.volume);
    if (e.target.closest("#check-updates")) checkForUpdates();
    if (e.target.closest("#install-update")) installUpdate();
  });

  page.addEventListener("change", (e) => {
    if (e.target.id === "set-24h") update({ clock24: e.target.checked });
    if (e.target.id === "set-sound") update({ sound: e.target.checked });
    if (e.target.id === "set-volume") {
      update({ volume: Number(e.target.value) });
      playChime(settings.volume);
    }
  });

  render();
  initUpdates();
}

export function render() {
  const page = document.getElementById("settings-page");
  const barHint = BAR_MODES.find((m) => m.id === settings.bar)?.hint ?? "";

  page.innerHTML = `
    <h3>Theme</h3>
    <div class="chips mode-chips">
      ${MODES.map(
        (m) => `<button class="chip ${m.id === settings.mode ? "is-active" : ""}" data-mode-pick="${m.id}">${m.label}</button>`
      ).join("")}
    </div>
    <div class="theme-grid">
      ${THEMES.map(
        (t) => `
        <button class="theme-tile ${t.id === settings.theme ? "is-active" : ""}" data-theme="${t.id}" data-mode="${settings.mode}" data-theme-pick="${t.id}" title="${t.blurb}">
          <span class="tile-pill"><span class="dot"></span><i data-icon="media"></i></span>
          <span class="tile-name">${t.name}</span>
        </button>`
      ).join("")}
    </div>

    <h3>The slim bar shows</h3>
    <div class="chips">
      ${BAR_MODES.map(
        (m) => `<button class="chip ${m.id === settings.bar ? "is-active" : ""}" data-bar="${m.id}">${m.label}</button>`
      ).join("")}
    </div>
    <p class="hint">${barHint}</p>

    <div id="layout-box"></div>

    <h3>Clock</h3>
    <label class="switch-row">
      <span>24-hour clock</span>
      <input type="checkbox" class="switch" id="set-24h" ${settings.clock24 ? "checked" : ""} />
    </label>

    <h3>When a countdown ends</h3>
    <label class="switch-row">
      <span>Play a sound</span>
      <input type="checkbox" class="switch" id="set-sound" ${settings.sound ? "checked" : ""} />
    </label>
    <div class="switch-row">
      <span>Volume</span>
      <input type="range" id="set-volume" min="0.1" max="1" step="0.1" value="${settings.volume}" />
      <button class="mini" id="test-sound">Test</button>
    </div>

    <h3>Updates</h3>
    <div id="updates-box"></div>
  `;
  paintUpdates();
  paintLayout();

  // Each tile previews its own theme's icon style.
  for (const tile of page.querySelectorAll(".theme-tile")) {
    setIconStyle(themeById(tile.dataset.themePick).icons);
    paintIcons(tile);
  }
  setIconStyle(themeById(settings.theme).icons);
}
