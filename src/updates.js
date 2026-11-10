// Update check. Asks the Tauri updater plugin whether the latest GitHub
// Release is newer, then downloads and installs it. Runs once by itself a
// little after launch; Settings → Updates can check again any time.

import { inTauri } from "./tauri.js";
import { escapeHtml } from "./util.js";
import { t } from "./i18n.js";

// Every line the user can see, in one place, in the current language.
export const UPDATE_TEXT = {
  get checking() { return t("Checking…"); },
  get latest() { return t("You're on the latest version."); },
  available: (v) => t("Version {version} is available.", { version: v }),
  downloading: (p) => t("Downloading… {percent}%", { percent: p }),
  error: (m) => t("Couldn't check for updates: {error}", { error: m }),
  installFailed: (m) => t("Couldn't install the update: {error}", { error: m }),
  get desktopOnly() { return t("Updates work in the desktop app only."); },
  version: (v) => t("Version {version}", { version: v }),
  get checkNow() { return t("Check now"); },
  get install() { return t("Install & restart"); },
  // The notice on the peninsula.
  get noticeTitle() { return t("Update available"); },
  noticeBody: (v) => t("Version {version} is ready", { version: v }),
  get noticeInstall() { return t("Install"); },
  get noticeLater() { return t("Later"); },
  noticeInstalling: (p) => t("Installing… {percent}%", { percent: p }),
};

// Give the network a moment after sign-in before the first check, and try a
// few more times if it is not up yet.
const LAUNCH_DELAY_MS = 8_000;
const RETRY_MS = 60_000;
const RETRIES = 3;

// idle | checking | latest | available | installing | error
let state = { status: "idle" };
let version = "";
let pending = null;
let onChange = () => {};

export const updateState = () => state;

function set(patch) {
  state = { ...state, ...patch };
  paintUpdates();
  onChange(state);
}

/** `changed(state)` runs on every step, so the peninsula can tell the user. */
export async function initUpdates(changed) {
  if (changed) onChange = changed;
  if (!inTauri) return;
  const { getVersion } = await import("@tauri-apps/api/app");
  version = await getVersion();
  paintUpdates();
}

/** The check made by itself at launch. Quiet unless there is an update. */
export function checkOnLaunch() {
  if (!inTauri) return;
  let tries = 0;
  const attempt = async () => {
    await checkForUpdates();
    if (state.status === "error" && ++tries <= RETRIES) setTimeout(attempt, RETRY_MS);
  };
  setTimeout(attempt, LAUNCH_DELAY_MS);
}

export async function checkForUpdates() {
  if (!inTauri || state.status === "checking" || state.status === "installing") return;
  set({ status: "checking", failed: null });
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
  set({ status: "installing", progress: 0, failed: null });
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
    // Keep the update on offer so it can be tried again.
    set({ status: "available", failed: String(err) });
  }
}

function statusLine() {
  switch (state.status) {
    case "checking":
      return UPDATE_TEXT.checking;
    case "latest":
      return UPDATE_TEXT.latest;
    case "available":
      return state.failed
        ? escapeHtml(UPDATE_TEXT.installFailed(state.failed))
        : escapeHtml(UPDATE_TEXT.available(state.next));
    case "installing":
      return UPDATE_TEXT.downloading(state.progress);
    case "error":
      return escapeHtml(UPDATE_TEXT.error(state.message));
    default:
      return "";
  }
}

export function paintUpdates() {
  const box = document.getElementById("updates-box");
  if (!box) return;

  if (!inTauri) {
    box.innerHTML = `<p class="hint">${UPDATE_TEXT.desktopOnly}</p>`;
    return;
  }

  const busy = state.status === "checking" || state.status === "installing";
  const button =
    state.status === "available"
      ? `<button class="mini accent" id="install-update">${UPDATE_TEXT.install}</button>`
      : `<button class="mini" id="check-updates" ${busy ? "disabled" : ""}>${UPDATE_TEXT.checkNow}</button>`;

  box.innerHTML = `
    <div class="switch-row">
      <span>${escapeHtml(UPDATE_TEXT.version(version))}</span>
      ${button}
    </div>
    <p class="hint">${statusLine()}</p>
  `;
}
