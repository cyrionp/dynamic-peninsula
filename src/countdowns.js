// Any number of named countdowns, of two kinds:
//   "duration" — e.g. 25:00 from now; can be paused.
//   "until"    — until a clock time, e.g. 18:30; if that time has passed
//                today it counts to the same time tomorrow.
// Like stopwatches, remaining time is derived from timestamps.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml, formatRemaining } from "./util.js";

let items = load("countdowns", []);
let listEl = null;
let changed = () => {};
let mode = "duration";

const persist = () => save("countdowns", items);

// Anything that ended while the app was closed is simply marked done.
{
  const now = Date.now();
  for (const cd of items) {
    if (cd.running && cd.endsAt <= now) {
      cd.running = false;
      cd.done = true;
      cd.remainingMs = 0;
    }
  }
}

export function remaining(cd, now = Date.now()) {
  return cd.running ? Math.max(0, cd.endsAt - now) : cd.remainingMs;
}

function progress(cd, now) {
  const total = cd.mode === "until" ? cd.endsAt - cd.armedAt : cd.durationMs;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remaining(cd, now) / total));
}

/** Next timestamp at which the wall clock shows `hhmm` ("18:30"). */
function nextOccurrence(hhmm, now) {
  const [h, m] = hhmm.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function arm(cd, now) {
  cd.done = false;
  cd.running = true;
  cd.armedAt = now;
  if (cd.mode === "until") {
    cd.endsAt = nextOccurrence(cd.untilTime, now);
    cd.remainingMs = cd.endsAt - now;
  } else {
    cd.endsAt = now + cd.durationMs;
    cd.remainingMs = cd.durationMs;
  }
}

export function anyRunning() {
  return items.some((cd) => cd.running);
}

/** The running countdown that ends first, for the slim bar. */
export function soonest() {
  return items.filter((cd) => cd.running).sort((a, b) => a.endsAt - b.endsAt)[0];
}

/** Re-arms a countdown from an alert ("Restart"). */
export function restart(id) {
  const cd = items.find((c) => c.id === id);
  if (!cd) return;
  arm(cd, Date.now());
  persist();
  render();
  changed();
}

/** Advances time; returns countdowns that just finished. */
export function tick(now) {
  const finished = [];
  for (const cd of items) {
    if (cd.running && cd.endsAt <= now) {
      cd.running = false;
      cd.done = true;
      cd.remainingMs = 0;
      finished.push(cd);
    }
  }
  if (finished.length) {
    persist();
    render();
  }
  return finished;
}

function subtitle(cd) {
  if (cd.mode === "until") {
    const end = new Date(cd.endsAt);
    const tomorrow = end.toDateString() !== new Date().toDateString();
    return `until ${cd.untilTime}${tomorrow && cd.running ? " tomorrow" : ""}`;
  }
  return `${formatRemaining(cd.durationMs)} timer`;
}

export function initCountdowns(onChange) {
  changed = onChange;
  listEl = document.getElementById("cd-list");
  const form = document.getElementById("cd-form");

  form.querySelector(".seg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    mode = btn.dataset.mode;
    form.dataset.mode = mode;
    form.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("is-active", b === btn));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim() || `Countdown ${items.length + 1}`;
    const cd = { id: newId(), name, mode };

    if (mode === "until") {
      const t = form.elements.until.value;
      if (!/^\d{2}:\d{2}$/.test(t)) {
        form.elements.until.focus();
        return;
      }
      cd.untilTime = t;
    } else {
      const num = (f) => Math.max(0, Math.floor(Number(form.elements[f].value) || 0));
      const ms = ((num("h") * 60 + num("m")) * 60 + num("s")) * 1000;
      if (ms <= 0) {
        form.elements.m.focus();
        return;
      }
      cd.durationMs = ms;
    }

    arm(cd, Date.now());
    items.push(cd);
    form.elements.name.value = "";
    persist();
    render();
    changed();
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.closest(".item").dataset.id);
    const cd = items.find((c) => c.id === id);
    if (!cd) return;
    const now = Date.now();

    switch (btn.dataset.act) {
      case "toggle":
        if (cd.running) {
          cd.remainingMs = remaining(cd, now);
          cd.running = false;
        } else if (cd.done) {
          arm(cd, now);
        } else {
          cd.endsAt = now + cd.remainingMs;
          cd.running = true;
        }
        break;
      case "reset":
        if (cd.mode === "until") {
          arm(cd, now);
        } else {
          cd.running = false;
          cd.done = false;
          cd.remainingMs = cd.durationMs;
        }
        break;
      case "delete":
        items = items.filter((c) => c.id !== id);
        break;
    }
    persist();
    render();
    changed();
  });

  listEl.addEventListener("input", (e) => {
    if (!e.target.classList.contains("name")) return;
    const cd = items.find((c) => c.id === Number(e.target.closest(".item").dataset.id));
    if (cd) {
      cd.name = e.target.value;
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
  if (!listEl) return;
  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty">No countdowns yet. Set a length or a time above.</li>`;
    return;
  }
  const now = Date.now();
  listEl.innerHTML = items
    .map((cd) => {
      // "until" countdowns always run; pausing one would make no sense.
      const toggle =
        cd.mode === "until" && !cd.done
          ? ""
          : `<button class="icon-btn accent" data-act="toggle" title="${cd.running ? "Pause" : "Start"}">${icon(cd.running ? "pause" : "play")}</button>`;
      return `
      <li class="item cd ${cd.running ? "is-running" : ""} ${cd.done ? "is-done" : ""}" data-id="${cd.id}">
        <div class="item-main">
          <div class="name-row">
            <input class="name" value="${escapeHtml(cd.name)}" placeholder="Name" spellcheck="false" />
            <span class="sub">${icon(cd.mode === "until" ? "clock" : "countdown")}${escapeHtml(subtitle(cd))}</span>
          </div>
          <span class="time">${cd.done ? "Done" : formatRemaining(remaining(cd, now))}</span>
          <div class="progress"><span style="transform: scaleX(${progress(cd, now)})"></span></div>
        </div>
        ${toggle}
        <button class="icon-btn" data-act="reset" title="${cd.mode === "until" ? "Restart" : "Reset"}">${icon("reset")}</button>
        <button class="icon-btn danger" data-act="delete" title="Delete">${icon("close")}</button>
      </li>`;
    })
    .join("");
}

export function paintTimes(now) {
  for (const cd of items) {
    if (!cd.running) continue;
    const row = listEl.querySelector(`[data-id="${cd.id}"]`);
    if (!row) continue;
    row.querySelector(".time").textContent = formatRemaining(remaining(cd, now));
    row.querySelector(".progress span").style.transform = `scaleX(${progress(cd, now)})`;
  }
}
