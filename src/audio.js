// Playback devices and headphones: the output picker under "now playing",
// AirPods battery and in-ear status, and short pop-ups on the slim bar when
// headphones connect or an earbud goes in or out.

import { call, on, inTauri } from "./tauri.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";
import { getSettings } from "./settings.js";

let devices = [];
let pods = null;
let menuOpen = false;
let boxEl = null;
let changed = () => {};

// The pop-up currently on the slim bar: what it is about, and until when.
let notice = null;
const NOTICE_MS = 4000;

const current = () => devices.find((d) => d.isDefault) ?? null;

/** "Headphones (AirPods Pro)" → "AirPods Pro" for Bluetooth devices. */
function shortName(device) {
  const inner = device.bluetooth && /^[^(]*\((.+)\)\s*$/.exec(device.name);
  return inner ? inner[1] : device.name;
}

const isAirPods = (device) => Boolean(device?.bluetooth && /airpods|beats/i.test(device.name));

/** AirPods data, only while AirPods are what's playing. */
function currentPods() {
  return isAirPods(current()) ? pods : null;
}

function deviceIcon(device) {
  const headphones = device.bluetooth || device.kind === "headphones" || device.kind === "headset";
  return icon(headphones ? "headphones" : "speaker");
}

const pct = (n) => (n == null ? "–" : `${n}%`);

/** Battery summary for the slim bar: "L 80% R 70%", or a headset's "80%". */
function batteryText() {
  const p = currentPods();
  if (p) return `L ${pct(p.left.battery)} R ${pct(p.right.battery)}`;
  const battery = current()?.battery;
  return battery == null ? "" : `${battery}%`;
}

function earText(p) {
  const { left, right } = p;
  if (left.inEar && right.inEar) return "Both earbuds in";
  if (left.inEar) return "Left earbud in";
  if (right.inEar) return "Right earbud in";
  return "Earbuds out";
}

function raise(kind) {
  if (!getSettings().headphoneAlerts) return;
  notice = { kind, until: Date.now() + NOTICE_MS };
  setTimeout(() => {
    if (notice && Date.now() >= notice.until) {
      notice = null;
      changed();
    }
  }, NOTICE_MS + 50);
  changed();
}

/** What the slim bar shows while a pop-up is up; null otherwise. Worked out
 * on every paint, so battery that arrives a moment later still shows up. */
export function noticeView() {
  if (!notice || Date.now() >= notice.until) return null;
  const device = current();
  if (!device) return null;
  const p = currentPods();
  const text = notice.kind === "ears" && p ? earText(p) : p?.model || shortName(device);
  return { lead: "headphones", text, value: batteryText() };
}

function setDevices(next) {
  const before = current();
  devices = next?.devices ?? [];
  const after = current();
  // Only a switch to headphones pops up; speakers are just the output.
  if (before && after && before.id !== after.id && (after.bluetooth || ["headphones", "headset"].includes(after.kind))) {
    raise("connected");
  }
  render();
  changed();
}

function setPods(next) {
  const before = pods;
  pods = next;
  const ears = (p) => (p?.fresh ? `${p.left.inEar}${p.right.inEar}` : null);
  if (isAirPods(current()) && next?.fresh && before?.fresh && ears(before) !== ears(next)) raise("ears");
  render();
  changed();
}

async function switchTo(id) {
  menuOpen = false;
  // Feel instant; the real state follows from the event.
  devices = devices.map((d) => ({ ...d, isDefault: d.id === id }));
  render();
  changed();
  try {
    await call("audio_set_default", { id });
  } catch {
    setDevices(await call("audio_devices"));
  }
}

export async function initAudio(onChange) {
  changed = onChange;
  boxEl = document.getElementById("audio-box");

  boxEl.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-audio-id]");
    if (pick) return switchTo(pick.dataset.audioId);
    if (e.target.closest("#audio-out")) {
      menuOpen = !menuOpen;
      render();
    }
  });
  document.addEventListener("click", (e) => {
    // The path, not contains(): the clicked button may be re-rendered away.
    if (menuOpen && !e.composedPath().includes(boxEl)) {
      menuOpen = false;
      render();
    }
  });

  render();
  if (!inTauri) return;
  await on("audio://devices", setDevices);
  await on("airpods://update", setPods);
  const [d, p] = await Promise.all([call("audio_devices"), call("airpods_state")]);
  devices = d?.devices ?? [];
  pods = p ?? null;
  render();
  changed();
}

function podHtml(label, pod, title) {
  const cls = ["pod", pod.inEar ? "is-in" : "", pod.charging ? "is-charging" : ""].join(" ");
  const state = pod.inEar ? " · in ear" : pod.charging ? " · charging" : "";
  return `<span class="${cls}" title="${title}${state}">
      <b>${label}</b>${pct(pod.battery)}${pod.charging ? icon("bolt") : ""}
    </span>`;
}

export function render() {
  if (!boxEl) return;
  const device = current();
  if (!devices.length || !device) {
    boxEl.innerHTML = "";
    return;
  }

  const p = currentPods();
  const status = p
    ? `<div class="pods ${p.fresh ? "" : "is-stale"}" title="${p.fresh ? escapeHtml(p.model) : "Last known: open the case to refresh"}">
        ${podHtml("L", p.left, "Left")}${podHtml("R", p.right, "Right")}${podHtml("Case", p.case, "Case")}
      </div>`
    : device.battery != null
      ? `<div class="pods"><span class="pod">${pct(device.battery)}</span></div>`
      : "";

  boxEl.innerHTML = `
    <div class="audio-strip">
      <button class="audio-out ${menuOpen ? "is-open" : ""}" id="audio-out" title="Change output: ${escapeHtml(device.name)}">
        ${deviceIcon(device)}<span>${escapeHtml(shortName(device))}</span>${devices.length > 1 ? icon("up") : ""}
      </button>
      ${status}
      ${
        menuOpen && devices.length > 1
          ? `<ul class="audio-menu">
              ${devices
                .map(
                  (d) => `<li><button class="${d.isDefault ? "is-active" : ""}" data-audio-id="${escapeHtml(d.id)}" title="${escapeHtml(d.name)}">
                    ${deviceIcon(d)}<span>${escapeHtml(d.name)}</span>${d.battery != null ? `<small>${d.battery}%</small>` : ""}
                  </button></li>`
                )
                .join("")}
            </ul>`
          : ""
      }
    </div>`;
}
