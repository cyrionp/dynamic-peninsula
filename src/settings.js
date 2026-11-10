// Settings page, in groups: Appearance (theme, mode, sizes, look), Slim bar
// (what it shows, clock format, hiding when idle), Taskbar dock, Position &
// lock, Sounds & alerts, and App (startup, updates).

import { load, save } from "./store.js";
import { THEMES, MODES, themeById } from "./themes.js";
import { setIconStyle, paintIcons, icon } from "./icons.js";
import { playChime } from "./sound.js";
import { initUpdates, checkForUpdates, installUpdate, paintUpdates } from "./updates.js";
import { paintLayout } from "./layout.js";
import { inTauri } from "./tauri.js";
import { escapeHtml } from "./util.js";
import { DOCK_ITEMS, DOCK_LOOKS, DOCK_DEFAULTS, normaliseDockItems } from "./dockconfig.js";
import { dockStatus } from "./dockctl.js";
import { t, LANGUAGES, systemLang } from "./i18n.js";

const DEFAULTS = {
  // Interface language; the system language until one is picked.
  lang: systemLang(),
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
  ],
  ...DOCK_DEFAULTS,
};

export const SMART_ITEMS = {
  countdown: { label: "Countdown", hint: "a running countdown" },
  media: { label: "Now playing", hint: "music while it plays" },
  stopwatch: { label: "Stopwatch", hint: "a running stopwatch" },
};

export const BAR_MODES = [
  { id: "smart", label: "Smart" },
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

/** Changes settings from outside the page (the tray's dock item). */
export function setSetting(patch) {
  update(patch);
}

/** Moves item `id` of an ordered list one step up (-1) or down (1). */
function moved(list, id, step) {
  const next = [...list];
  const i = next.findIndex((s) => s.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= next.length) return null;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function update(patch) {
  settings = { ...settings, ...patch };
  save("settings", settings);
  render();
  changed(patch);
}

export function initSettings(onChange, onUpdate) {
  changed = onChange;
  const page = document.getElementById("settings-page");

  page.addEventListener("click", (e) => {
    const theme = e.target.closest("[data-theme-pick]");
    if (theme) return update({ theme: theme.dataset.themePick });

    const mode = e.target.closest("[data-mode-pick]");
    if (mode) return update({ mode: mode.dataset.modePick });

    const lang = e.target.closest("[data-lang-pick]");
    if (lang) return update({ lang: lang.dataset.langPick });

    const bar = e.target.closest("[data-bar]");
    if (bar) return update({ bar: bar.dataset.bar });

    const move = e.target.closest("[data-smart-move]");
    if (move) {
      const smart = moved(settings.smart, move.closest("[data-smart]").dataset.smart, Number(move.dataset.smartMove));
      return smart && update({ smart });
    }

    const look = e.target.closest("[data-dock-look]");
    if (look) return update({ dockLook: look.dataset.dockLook });

    const dockMove = e.target.closest("[data-dock-move]");
    if (dockMove) {
      const dockItems = moved(settings.dockItems, dockMove.closest("[data-dock-item]").dataset.dockItem, Number(dockMove.dataset.dockMove));
      return dockItems && update({ dockItems });
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
    if (e.target.id === "set-dock") update({ dock: e.target.checked });
    if (e.target.dataset.dockToggle) {
      const id = e.target.dataset.dockToggle;
      update({ dockItems: settings.dockItems.map((s) => (s.id === id ? { ...s, on: e.target.checked } : s)) });
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
  initUpdates(onUpdate);
  loadAutostart();
}

export function render() {
  const page = document.getElementById("settings-page");
  const barHint = BAR_MODES.find((m) => m.id === settings.bar)?.hint ?? "";
  const smartOn = settings.smart.filter((s) => s.on).map((s) => t(SMART_ITEMS[s.id].hint));
  const smartHint = smartOn.length
    ? t("Shows {list}; otherwise the clock.", { list: smartOn.join(t(", then ")) })
    : t("Everything is off, so it shows the clock.");

  const group = (title, body) => `<section class="settings-group"><h2>${title}</h2>${body}</section>`;

  page.innerHTML = [
    group(
      t("Language"),
      `
      <div class="chips">
        ${LANGUAGES.map(
          (l) => `<button class="chip ${l.id === settings.lang ? "is-active" : ""}" data-lang-pick="${l.id}">${l.label}</button>`
        ).join("")}
      </div>`
    ),
    group(
      t("Appearance"),
      `
      <h3>${t("Theme")}</h3>
      <div class="chips mode-chips">
        ${MODES.map(
          (m) => `<button class="chip ${m.id === settings.mode ? "is-active" : ""}" data-mode-pick="${m.id}">${t(m.label)}</button>`
        ).join("")}
      </div>
      <div class="theme-grid">
        ${THEMES.map(
          (theme) => `
          <button class="theme-tile ${theme.id === settings.theme ? "is-active" : ""}" data-theme="${theme.id}" data-mode="${settings.mode}" data-theme-pick="${theme.id}" title="${t(theme.blurb)}">
            <span class="tile-pill"><span class="dot"></span><i data-icon="media"></i></span>
            <span class="tile-name">${theme.name}</span>
          </button>`
        ).join("")}
      </div>
      <div id="layout-look-box"></div>`
    ),
    group(
      t("Slim bar"),
      `
      <h3>${t("Shows")}</h3>
      <div class="chips">
        ${BAR_MODES.map(
          (m) => `<button class="chip ${m.id === settings.bar ? "is-active" : ""}" data-bar="${m.id}">${t(m.label)}</button>`
        ).join("")}
      </div>
      ${
        settings.bar === "smart"
          ? `<ol class="smart-order">
              ${settings.smart
                .map(
                  (s, i, all) => `
                <li class="smart-item ${s.on ? "" : "is-off"}" data-smart="${s.id}">
                  <span class="smart-rank">${i + 1}</span>
                  <span class="smart-label">${t(SMART_ITEMS[s.id].label)}</span>
                  <button class="icon-btn" data-smart-move="-1" title="${t("Move up")}" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
                  <button class="icon-btn" data-smart-move="1" title="${t("Move down")}" ${i === all.length - 1 ? "disabled" : ""}>${icon("down")}</button>
                  <input type="checkbox" class="switch" data-smart-toggle="${s.id}" title="${t("Show in Smart")}" ${s.on ? "checked" : ""} />
                </li>`
                )
                .join("")}
            </ol>
            <p class="hint">${smartHint}</p>`
          : `<p class="hint">${barHint}</p>`
      }
      <h3>${t("Behaviour")}</h3>
      <label class="switch-row">
        <span>${t("24-hour clock")}</span>
        <input type="checkbox" class="switch" id="set-24h" ${settings.clock24 ? "checked" : ""} />
      </label>
      <label class="switch-row">
        <span>${t("Only show when there's something to show")}</span>
        <input type="checkbox" class="switch" id="set-hide-idle" ${settings.hideIdle ? "checked" : ""} />
      </label>
      <p class="hint">${t("Music, timers and pop-ups bring it out. Otherwise point at its spot to open it.")}</p>`
    ),
    dockGroup(group),
    group(t("Position & lock"), `<div id="layout-position-box"></div>`),
    group(
      t("Sounds & alerts"),
      `
      <h3>${t("When a countdown ends")}</h3>
      <label class="switch-row">
        <span>${t("Play a sound")}</span>
        <input type="checkbox" class="switch" id="set-sound" ${settings.sound ? "checked" : ""} />
      </label>
      <div class="switch-row">
        <span>${t("Volume")}</span>
        <input type="range" id="set-volume" min="0.1" max="1" step="0.1" value="${settings.volume}" />
        <button class="mini" id="test-sound">${t("Test")}</button>
      </div>

      <h3>${t("Headphones")}</h3>
      <label class="switch-row">
        <span>${t("Show battery when they connect, and which earbud is in")}</span>
        <input type="checkbox" class="switch" id="set-headphones" ${settings.headphoneAlerts ? "checked" : ""} />
      </label>
      <p class="hint">${t("AirPods battery and in-ear status come from their Bluetooth signal; other headsets show the battery Windows reports.")}</p>`
    ),
    group(
      t("App"),
      `
      <h3>${t("Startup")}</h3>
      <label class="switch-row">
        <span>${t("Launch when the computer starts")}</span>
        <input type="checkbox" class="switch" id="set-autostart" ${autostart ? "checked" : ""} ${autostart === null ? "disabled" : ""} />
      </label>
      ${autostart === null && !inTauri ? `<p class="hint">${t("Available in the desktop app.")}</p>` : ""}

      <h3>${t("Updates")}</h3>
      <div id="updates-box"></div>`
    ),
  ].join("");
  paintUpdates();
  paintLayout();

  // Each tile previews its own theme's icon style.
  for (const tile of page.querySelectorAll(".theme-tile")) {
    setIconStyle(themeById(tile.dataset.themePick).icons);
    paintIcons(tile);
  }
  setIconStyle(themeById(settings.theme).icons);
}

/** An ordered list with up / down buttons and a switch on each row. */
function orderList(items, labels, attr) {
  return `<ol class="smart-order">
    ${items
      .map(
        (s, i, all) => `
      <li class="smart-item ${s.on ? "" : "is-off"}" data-${attr}-item="${s.id}">
        <span class="smart-rank">${i + 1}</span>
        <span class="smart-label">${t(labels[s.id].label)}</span>
        <button class="icon-btn" data-${attr}-move="-1" title="${t("Move up")}" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
        <button class="icon-btn" data-${attr}-move="1" title="${t("Move down")}" ${i === all.length - 1 ? "disabled" : ""}>${icon("down")}</button>
        <input type="checkbox" class="switch" data-${attr}-toggle="${s.id}" title="${t("Show")}" ${s.on ? "checked" : ""} />
      </li>`
      )
      .join("")}
  </ol>`;
}

/** Taskbar dock (experimental): on/off, its look, and what it shows. */
function dockGroup(group) {
  const status = dockStatus();
  // Unavailable here: it can still be switched off, never on.
  const blocked = !status.available && !settings.dock;
  const title = `${t("Taskbar dock")} <small class="tag">${t("experimental")}</small>`;
  const reason = !status.available && status.reason ? `<p class="hint">${escapeHtml(t(status.reason))}</p>` : "";
  if (!inTauri) {
    return group(title, `<p class="hint">${t("Available in the desktop app on Windows 11.")}</p>`);
  }
  const lookHint = t(DOCK_LOOKS.find((l) => l.id === settings.dockLook)?.hint ?? "");
  return group(
    title,
    `
    <label class="switch-row">
      <span>${t("Show a dock on the left of the taskbar")}</span>
      <input type="checkbox" class="switch" id="set-dock" ${settings.dock ? "checked" : ""} ${blocked ? "disabled" : ""} />
    </label>
    ${reason || `<p class="hint">${t("Sits in the empty space left of the centred taskbar icons, on the main screen. Turn it off here or from the tray icon.")}</p>`}
    ${settings.dock && status.available ? `<p class="hint dock-now">${status.showing ? t("Right now: on the taskbar.") : t("Hidden right now: {why}", { why: escapeHtml(t(status.note ?? "starting…")) })}</p>` : ""}
    ${
      settings.dock
        ? `
    <h3>${t("Look")}</h3>
    <div class="chips">
      ${DOCK_LOOKS.map((l) => `<button class="chip ${l.id === settings.dockLook ? "is-active" : ""}" data-dock-look="${l.id}">${t(l.label)}</button>`).join("")}
    </div>
    <p class="hint">${lookHint}</p>
    <h3>${t("Shows")}</h3>
    ${orderList(settings.dockItems, DOCK_ITEMS, "dock")}
    <p class="hint">${t("A running countdown is pinned on the left, just its time. Right of it the bar shows the first of the others that has something going on.")}</p>`
        : ""
    }`
  );
}
