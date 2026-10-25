// Dynamic Peninsula — frontend shell.
//
// For now everything lives in memory: this is the Phase 0/1 shell from PLAN.md.
// Persistence (notes, to-dos) and media controls move to the Rust side later.

const peninsula = document.getElementById("peninsula");
const clockEl = document.getElementById("clock");

/* ---------- open / close on hover ---------- */

let closeTimer = null;

function expand() {
  clearTimeout(closeTimer);
  peninsula.dataset.state = "expanded";
}

function collapse() {
  // small delay so a brief mouse-out doesn't snap it shut
  closeTimer = setTimeout(() => {
    peninsula.dataset.state = "collapsed";
  }, 220);
}

peninsula.addEventListener("mouseenter", expand);
peninsula.addEventListener("mouseleave", collapse);

/* ---------- clock ---------- */

function paintClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
paintClock();
setInterval(paintClock, 10_000);

/* ---------- tabs ---------- */

document.getElementById("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  const page = tab.dataset.page;

  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("is-active", t === tab));
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.toggle("is-active", p.dataset.page === page));
});

/* ---------- stopwatches ---------- */

const swList = document.getElementById("sw-list");
let stopwatches = [];
let nextSwId = 1;
let tick = null;

function format(ms) {
  const total = Math.floor(ms / 10); // centiseconds
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function elapsed(sw) {
  return sw.running ? sw.accumulated + (Date.now() - sw.startedAt) : sw.accumulated;
}

// Only tick while at least one stopwatch runs — idle means no work at all.
function syncTicker() {
  const anyRunning = stopwatches.some((sw) => sw.running);
  if (anyRunning && tick === null) {
    tick = setInterval(paintTimes, 50);
  } else if (!anyRunning && tick !== null) {
    clearInterval(tick);
    tick = null;
  }
}

function paintTimes() {
  for (const sw of stopwatches) {
    const el = swList.querySelector(`[data-id="${sw.id}"] .time`);
    if (el) el.textContent = format(elapsed(sw));
  }
}

function renderStopwatches() {
  if (stopwatches.length === 0) {
    swList.innerHTML = `<li class="empty">No stopwatches yet — add one.</li>`;
    syncTicker();
    return;
  }

  swList.innerHTML = stopwatches
    .map(
      (sw) => `
      <li class="sw" data-id="${sw.id}">
        <span class="time">${format(elapsed(sw))}</span>
        <button data-act="toggle">${sw.running ? "Pause" : "Start"}</button>
        <button data-act="reset">Reset</button>
        <button data-act="delete" class="del">✕</button>
      </li>`
    )
    .join("");

  syncTicker();
}

document.getElementById("add-sw").addEventListener("click", () => {
  stopwatches.push({
    id: nextSwId++,
    running: false,
    accumulated: 0,
    startedAt: 0,
  });
  renderStopwatches();
});

swList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = Number(btn.closest(".sw").dataset.id);
  const sw = stopwatches.find((s) => s.id === id);
  if (!sw) return;

  switch (btn.dataset.act) {
    case "toggle":
      if (sw.running) {
        sw.accumulated = elapsed(sw);
        sw.running = false;
      } else {
        sw.startedAt = Date.now();
        sw.running = true;
      }
      break;
    case "reset":
      sw.accumulated = 0;
      sw.startedAt = Date.now();
      break;
    case "delete":
      stopwatches = stopwatches.filter((s) => s.id !== id);
      break;
  }
  renderStopwatches();
});

renderStopwatches();

/* ---------- quick note (in memory for now) ---------- */

const noteEl = document.getElementById("note");
noteEl.addEventListener("input", () => {
  // TODO: persist through a Rust command (see PLAN.md, phase 2)
});

/* ---------- to-do (in memory for now) ---------- */

const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const todoList = document.getElementById("todo-list");
let todos = [];
let nextTodoId = 1;

function renderTodos() {
  if (todos.length === 0) {
    todoList.innerHTML = `<li class="empty">Nothing to do yet.</li>`;
    return;
  }
  todoList.innerHTML = todos
    .map(
      (t) => `
      <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <input type="checkbox" ${t.done ? "checked" : ""} />
        <span>${escapeHtml(t.text)}</span>
        <button class="del" data-act="delete">✕</button>
      </li>`
    )
    .join("");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

todoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  todos.push({ id: nextTodoId++, text, done: false });
  todoInput.value = "";
  renderTodos();
  // TODO: persist through a Rust command (see PLAN.md, phase 2)
});

todoList.addEventListener("click", (e) => {
  const li = e.target.closest(".todo");
  if (!li) return;
  const id = Number(li.dataset.id);
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  if (e.target.matches('[data-act="delete"]')) {
    todos = todos.filter((t) => t.id !== id);
  } else if (e.target.matches('input[type="checkbox"]')) {
    todo.done = e.target.checked;
  }
  renderTodos();
});

renderTodos();
