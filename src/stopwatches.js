// Any number of named stopwatches. Elapsed time is derived from timestamps,
// so they keep counting correctly across sleep and even app restarts.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml, formatElapsed } from "./util.js";

let items = load("stopwatches", []);
let listEl = null;
let changed = () => {};

const persist = () => save("stopwatches", items);

export function elapsed(sw, now = Date.now()) {
  return sw.running ? sw.accumulated + (now - sw.startedAt) : sw.accumulated;
}

export function anyRunning() {
  return items.some((sw) => sw.running);
}

/** The longest-running active stopwatch, for the slim bar. */
export function leadingRunning() {
  return items
    .filter((sw) => sw.running)
    .sort((a, b) => elapsed(b) - elapsed(a))[0];
}

export function initStopwatches(onChange) {
  changed = onChange;
  listEl = document.getElementById("sw-list");

  document.getElementById("add-sw").addEventListener("click", () => {
    items.push({
      id: newId(),
      name: `Stopwatch ${items.length + 1}`,
      running: false,
      accumulated: 0,
      startedAt: 0,
    });
    persist();
    render();
    changed();
    // Ready to be named right away.
    listEl.querySelector(".item:last-child .name")?.select();
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.closest(".item").dataset.id);
    const sw = items.find((s) => s.id === id);
    if (!sw) return;
    const now = Date.now();

    switch (btn.dataset.act) {
      case "toggle":
        if (sw.running) {
          sw.accumulated = elapsed(sw, now);
          sw.running = false;
        } else {
          sw.startedAt = now;
          sw.running = true;
        }
        break;
      case "reset":
        sw.accumulated = 0;
        sw.startedAt = now;
        break;
      case "delete":
        items = items.filter((s) => s.id !== id);
        break;
    }
    persist();
    render();
    changed();
  });

  // Renaming edits the model in place; no re-render, so focus is kept.
  listEl.addEventListener("input", (e) => {
    if (!e.target.classList.contains("name")) return;
    const sw = items.find((s) => s.id === Number(e.target.closest(".item").dataset.id));
    if (sw) {
      sw.name = e.target.value;
      persist();
      changed();
    }
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("name")) e.target.blur();
  });

  render();
}

export function render() {
  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty">No stopwatches yet. Add one and give it a name.</li>`;
    return;
  }
  listEl.innerHTML = items
    .map(
      (sw) => `
      <li class="item ${sw.running ? "is-running" : ""}" data-id="${sw.id}">
        <div class="item-main">
          <input class="name" value="${escapeHtml(sw.name)}" placeholder="Name" spellcheck="false" />
          <span class="time">${formatElapsed(elapsed(sw))}</span>
        </div>
        <button class="icon-btn accent" data-act="toggle" title="${sw.running ? "Pause" : "Start"}">${icon(sw.running ? "pause" : "play")}</button>
        <button class="icon-btn" data-act="reset" title="Reset">${icon("reset")}</button>
        <button class="icon-btn danger" data-act="delete" title="Delete">${icon("close")}</button>
      </li>`
    )
    .join("");
}

export function paintTimes(now) {
  for (const sw of items) {
    if (!sw.running) continue;
    const el = listEl.querySelector(`[data-id="${sw.id}"] .time`);
    if (el) el.textContent = formatElapsed(elapsed(sw, now));
  }
}
