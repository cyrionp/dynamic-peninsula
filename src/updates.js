// Update check for the settings page. Asks the Tauri updater plugin whether
// the latest GitHub Release is newer, then downloads and installs it.

import { inTauri } from "./tauri.js";
import { escapeHtml } from "./util.js";

// idle | checking | latest | available | installing | error
let state = { status: "idle" };
let version = "";
let pending = null;

function set(patch) {
  state = { ...state, ...patch };
  paintUpdates();
}

export async function initUpdates() {
  if (!inTauri) return;
  const { getVersion } = await import("@tauri-apps/api/app");
  version = await getVersion();
  paintUpdates();
}

export async function checkForUpdates() {
  if (!inTauri || state.status === "checking" || state.status === "installing") return;
  set({ status: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    set(pending ? { status: "available", next: pending.version } : { status: "latest" });
  } catch (err) {
    set({ status: "error", message: String(err) });
  }
}

export async function installUpdate() {
  if (!pending || state.status === "installing") return;
  let total = 0;
  let done = 0;
  set({ status: "installing", progress: 0 });
  try {
    await pending.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") {
        done += e.data.chunkLength;
        if (total) set({ progress: Math.round((done / total) * 100) });
      }
    });
    // On Windows the installer usually closes the app itself; this covers the rest.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    set({ status: "error", message: String(err) });
  }
}

function statusLine() {
  switch (state.status) {
    case "checking":
      return "Checking…";
    case "latest":
      return "You're on the latest version.";
    case "available":
      return `Version ${escapeHtml(state.next)} is available.`;
    case "installing":
      return `Downloading… ${state.progress}%`;
    case "error":
      return `Couldn't check for updates: ${escapeHtml(state.message)}`;
    default:
      return "";
  }
}

export function paintUpdates() {
  const box = document.getElementById("updates-box");
  if (!box) return;

  if (!inTauri) {
    box.innerHTML = `<p class="hint">Updates work in the desktop app only.</p>`;
    return;
  }

  const busy = state.status === "checking" || state.status === "installing";
  const button =
    state.status === "available"
      ? `<button class="mini" id="install-update">Install & restart</button>`
      : `<button class="mini" id="check-updates" ${busy ? "disabled" : ""}>Check now</button>`;

  box.innerHTML = `
    <div class="switch-row">
      <span>Version ${escapeHtml(version)}</span>
      ${button}
    </div>
    <p class="hint">${statusLine()}</p>
  `;
}
