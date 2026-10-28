// Settings page: theme and dark/light mode, what the slim bar shows, size and
// look, clock format, weather, sound, startup and updates.

import { load, save } from "./store.js";
import { THEMES, MODES, themeById } from "./themes.js";
import { setIconStyle, paintIcons, icon } from "./icons.js";
import { playChime } from "./sound.js";
import { initUpdates, checkForUpdates, installUpdate, paintUpdates } from "./updates.js";
import { paintLayout } from "./layout.js";
import { inTauri } from "./tauri.js";
import { paintWeather, weatherOn } from "./weather.js";

const DEFAULTS = {
  theme: "lagoon",
  mode: "dark",
  bar: "smart",
  clock24: true,
  sound: true,
  volume: 0.6,
  // Pop up on the slim bar when headphones connect or an earbud goes in.
  headphoneAlerts: true,
  // Tuck the peninsula away while it has nothing but the clock to show.
  hideIdle: false,
  // What Smart shows, most important first; the clock fills in otherwise.
  smart: [
    { id: "countdown", on: true },
    { id: "media", on: true },
    { id: "stopwatch", on: true },
    { id: "weather", on: true },
  ],
};

export const SMART_ITEMS = {
  countdown: { label: "Countdown", hint: "a running countdown" },
  media: { label: "Now playing", hint: "music while it plays" },
  stopwatch: { label: "Stopwatch", hint: "a running stopwatch" },
  weather: { label: "Weather", hint: "the weather", needs: weatherOn },
};

// Items whose feature is switched off stay out of the list.
const smartAvailable = (s) => SMART_ITEMS[s.id].needs?.() ?? true;

export const BAR_MODES = [
  { id: "smart", label: "Smart" },
  { id: "media", label: "Now playing" },
  { id: "countdown", label: "Countdown" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "weather", label: "Weather", needs: weatherOn },
  { id: "clock", label: "Clock" },
  { id: "date", label: "Date & time" },
];

const saved = load("settings", {});
// Paper was the only light theme before modes existed; keep it light.
if (!saved.mode && saved.theme === "paper") saved.mode = "light";
let settings = { ...DEFAULTS, ...saved };
// Keep exactly one entry per known item, whatever was stored.
settings.smart = [
  ...(Array.isArray(saved.smart) ? saved.smart : []).filter((s) => SMART_ITEMS[s?.id]),
  ...DEFAULTS.smart,
].filter((s, i, all) => all.findIndex((t) => t.id === s.id) === i);
let changed = () => {};

// Launch at startup lives in the OS (a Run registry entry on Windows), not in
// our settings, so it is read from and written to the autostart plugin.
// null until known; stays null outside Tauri.
let autostart = null;

async function autostartApi() {
  return inTauri ? import("@tauri-apps/plugin-autostart") : null;
}

async function loadAutostart() {
  const api = await autostartApi();
  if (!api) return;
  try {
    autostart = await api.isEnabled();
  } catch {
    autostart = null;
  }
  render();
}

async function setAutostart(on) {
  const api = await autostartApi();
  if (!api) return;
  try {
    await (on ? api.enable() : api.disable());
    autostart = await api.isEnabled();
  } catch {
    // leave the switch showing the real state
  }
  render();
}

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

    const move = e.target.closest("[data-smart-move]");
    if (move) {
      const smart = [...settings.smart];
      const shown = smart.filter(smartAvailable);
      const at = shown.findIndex((s) => s.id === move.closest("[data-smart]").dataset.smart);
      const other = shown[at + Number(move.dataset.smartMove)];
      if (!other) return;
      const i = smart.indexOf(shown[at]);
      const j = smart.indexOf(other);
      [smart[i], smart[j]] = [smart[j], smart[i]];
      return update({ smart });
    }

    if (e.target.closest("#test-sound")) playChime(settings.volume);
    if (e.target.closest("#check-updates")) checkForUpdates();
    if (e.target.closest("#install-update")) installUpdate();
  });

  page.addEventListener("change", (e) => {
    if (e.target.id === "set-24h") update({ clock24: e.target.checked });
    if (e.target.id === "set-hide-idle") update({ hideIdle: e.target.checked });
    if (e.target.dataset.smartToggle) {
      const id = e.target.dataset.smartToggle;
      update({ smart: settings.smart.map((s) => (s.id === id ? { ...s, on: e.target.checked } : s)) });
    }
    if (e.target.id === "set-sound") update({ sound: e.target.checked });
    if (e.target.id === "set-headphones") update({ headphoneAlerts: e.target.checked });
    if (e.target.id === "set-autostart") setAutostart(e.target.checked);
    if (e.target.id === "set-volume") {
      update({ volume: Number(e.target.value) });
      playChime(settings.volume);
    }
  });

  render();
  initUpdates();
  loadAutostart();
}

export function render() {
  const page = document.getElementById("settings-page");
  const barHint = BAR_MODES.find((m) => m.id === settings.bar)?.hint ?? "";
  const smartShown = settings.smart.filter(smartAvailable);
  const barModes = BAR_MODES.filter((m) => m.needs?.() ?? true);
  const smartOn = smartShown.filter((s) => s.on).map((s) => SMART_ITEMS[s.id].hint);
  const smartHint = smartOn.length
    ? `Shows ${smartOn.join(", then ")}; otherwise the clock.`
    : "Everything is off, so it shows the clock.";

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
      ${barModes.map(
        (m) => `<button class="chip ${m.id === settings.bar ? "is-active" : ""}" data-bar="${m.id}">${m.label}</button>`
      ).join("")}
    </div>
    ${
      settings.bar === "smart"
        ? `<ol class="smart-order">
            ${smartShown
              .map(
                (s, i, all) => `
              <li class="smart-item ${s.on ? "" : "is-off"}" data-smart="${s.id}">
                <span class="smart-rank">${i + 1}</span>
                <span class="smart-label">${SMART_ITEMS[s.id].label}</span>
                <button class="icon-btn" data-smart-move="-1" title="Move up" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
                <button class="icon-btn" data-smart-move="1" title="Move down" ${i === all.length - 1 ? "disabled" : ""}>${icon("down")}</button>
                <input type="checkbox" class="switch" data-smart-toggle="${s.id}" title="Show in Smart" ${s.on ? "checked" : ""} />
              </li>`
              )
              .join("")}
          </ol>
          <p class="hint">${smartHint}</p>`
        : `<p class="hint">${barHint}</p>`
    }
    <label class="switch-row">
      <span>Only show when there's something to show</span>
      <input type="checkbox" class="switch" id="set-hide-idle" ${settings.hideIdle ? "checked" : ""} />
    </label>
    <p class="hint">Music, timers and pop-ups bring it out. Otherwise point at its spot to open it.</p>

    <div id="layout-box"></div>

    <h3>Clock</h3>
    <label class="switch-row">
      <span>24-hour clock</span>
      <input type="checkbox" class="switch" id="set-24h" ${settings.clock24 ? "checked" : ""} />
    </label>

    <div id="weather-box"></div>

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

    <h3>Headphones</h3>
    <label class="switch-row">
      <span>Show battery when they connect, and which earbud is in</span>
      <input type="checkbox" class="switch" id="set-headphones" ${settings.headphoneAlerts ? "checked" : ""} />
    </label>
    <p class="hint">AirPods battery and in-ear status come from their Bluetooth signal; other headsets show the battery Windows reports.</p>

    <h3>Startup</h3>
    <label class="switch-row">
      <span>Launch when the computer starts</span>
      <input type="checkbox" class="switch" id="set-autostart" ${autostart ? "checked" : ""} ${autostart === null ? "disabled" : ""} />
    </label>
    ${autostart === null && !inTauri ? `<p class="hint">Available in the desktop app.</p>` : ""}

    <h3>Updates</h3>
    <div id="updates-box"></div>
  `;
  paintUpdates();
  paintLayout();
  paintWeather();

  // Each tile previews its own theme's icon style.
  for (const tile of page.querySelectorAll(".theme-tile")) {
    setIconStyle(themeById(tile.dataset.themePick).icons);
    paintIcons(tile);
  }
  setIconStyle(themeById(settings.theme).icons);
}
