// The peninsula's side of the taskbar dock: switches it on and off from the
// saved setting, keeps Settings told whether it can work here, and opens the
// peninsula on a page when the dock is clicked.

import { call, on, inTauri } from "./tauri.js";

let status = { enabled: false, available: true, reason: null };

export const dockStatus = () => status;

/** Tells Rust whether the dock should be up. */
export function syncDock(enabled) {
  call("set_dock_enabled", { enabled: Boolean(enabled) }).catch(() => {});
}

export async function initDock({ enabled, onStatus, onOpen, onToggle }) {
  if (!inTauri) return;
  await on("dock://status", (next) => {
    status = next;
    onStatus();
  });
  await on("dock://open", onOpen);
  await on("dock://toggle", onToggle);
  syncDock(enabled);
  try {
    status = (await call("dock_status")) ?? status;
    onStatus();
  } catch {
    // keep the default
  }
}
