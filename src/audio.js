// Playback devices and headphones: the output picker under "now playing",
// AirPods battery and in-ear status, and short pop-ups on the slim bar when
// headphones connect or an earbud goes in or out.

import { call, on, inTauri } from "./tauri.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";
import { getSettings } from "./settings.js";
import { getLook } from "./layout.js";

let devices = [];
let pods = null;
let menuOpen = false;
let boxEl = null;
let changed = () => {};

// The pop-up currently on the slim bar: what it is about, and until when.
let notice = null;
const NOTICE_MS = 4000;

// AirPods report their in-ear state from both earbuds, and the bits flicker
// for a moment while they hand over or settle in. A change only counts once
// it has held this long, and pops up at most this often.
const EARS_SETTLE_MS = 3000;
const EARS_GAP_MS = 20_000;
// Windows can drop and re-add the same headset (a Bluetooth hiccup, AirPods
// hopping to the phone and back); that isn't worth a pop-up every time.
const CONNECT_GAP_MS = 60_000;

let ears = null; // the settled in-ear state, e.g. "truefalse"
let pendingEars = null;
let earsTimer = null;
const lastPopup = { connected: 0, ears: 0 };

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
  const now = Date.now();
  if (now - lastPopup[kind] < (kind === "ears" ? EARS_GAP_MS : CONNECT_GAP_MS)) return;
  lastPopup[kind] = now;
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
  // The minimal pill is too small for it; it stays on the clock or music.
  if (getLook().minimal) return null;
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
  // Only a switch to headphones pops up; speakers are just the output. The
  // same headset coming back (or moving to its hands-free endpoint) doesn't.
  const headphones = after && (after.bluetooth || ["headphones", "headset"].includes(after.kind));
  if (before && headphones && before.id !== after.id && shortName(after) !== shortName(before)) raise("connected");
  render();
  changed();
}

const earsOf = (p) => (p?.fresh ? `${p.left.inEar}${p.right.inEar}` : null);

/** Pops up when the in-ear state changed and has stayed that way. */
function settleEars() {
  const now = earsOf(pods);
  if (now === pendingEars) return; // already waiting on this one
  clearTimeout(earsTimer);
  pendingEars = now;
  if (now === ears) return; // flickered back
  if (now === null || ears === null) {
    // Just appeared, or went quiet: remember it without a pop-up.
    ears = now;
    return;
  }
  earsTimer = setTimeout(() => {
    ears = now;
    if (isAirPods(current())) raise("ears");
  }, EARS_SETTLE_MS);
}

function setPods(next) {
  pods = next;
  settleEars();
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
