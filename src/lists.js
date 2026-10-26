// Notes and the to-do list, saved locally as you go.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";

let todos = load("todos", []);
let todoList = null;

/* ---------- notes ---------- */

// Each note is a card with an optional title; pinned cards come first, and
// cards are put in order by dragging. Older versions kept a single note under
// "note"; it becomes the first card.
let notes = (load("notes", null) ?? [{ id: newId(), text: load("note", "") }]).map((n) => ({
  title: "",
  pinned: false,
  ...n,
}));
let openId = null;

let notesEl = null;
let noteGrid = null;
let titleEl = null;
let noteEl = null;

const openNoteData = () => notes.find((n) => n.id === openId);
// Pinned first, each group in its own order. Saved this way too.
const sorted = (list) => [...list.filter((n) => n.pinned), ...list.filter((n) => !n.pinned)];
const isBlank = (n) => !n.title.trim() && !n.text.trim();

function saveNotes() {
  save("notes", notes);
}

function openNote(id, focus) {
  openId = id;
  const note = openNoteData();
  titleEl.value = note.title;
  noteEl.value = note.text;
  paintPinButton();
  notesEl.dataset.view = "editor";
  focus?.focus();
}

/** Back to the cards. A note left with nothing in it is dropped. */
function closeNote() {
  const note = openNoteData();
  if (note && isBlank(note)) notes = notes.filter((n) => n !== note);
  openId = null;
  saveNotes();
  notesEl.dataset.view = "grid";
  document.activeElement?.blur();
  renderNotes();
}

function togglePin(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  notes = sorted(notes);
  saveNotes();
  renderNotes();
  paintPinButton();
}

function paintPinButton() {
  const btn = document.getElementById("note-pin");
  const pinned = Boolean(openNoteData()?.pinned);
  btn.classList.toggle("is-on", pinned);
  btn.title = pinned ? "Unpin" : "Pin to the top";
}

/* Dragging a card onto another moves it there, within its own group. */
const DRAG_THRESHOLD = 5;
let drag = null;
let justDragged = false;

function initDrag() {
  noteGrid.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".note-card");
    if (!card || e.button !== 0 || e.target.closest("button")) return;
    drag = { id: Number(card.dataset.id), x: e.clientX, y: e.clientY, moving: false };
  });

  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moving = true;
      noteGrid.classList.add("is-sorting");
      renderNotes();
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".note-card");
    const targetId = over && Number(over.dataset.id);
    if (!targetId || targetId === drag.id) return;
    const from = notes.findIndex((n) => n.id === drag.id);
    const to = notes.findIndex((n) => n.id === targetId);
    if (notes[from].pinned !== notes[to].pinned) return;
    const [moved] = notes.splice(from, 1);
    notes.splice(to, 0, moved);
    renderNotes();
  });

  const end = () => {
    if (!drag) return;
    if (drag.moving) {
      justDragged = true;
      // The click that ends a drag shouldn't open the card.
      setTimeout(() => (justDragged = false), 0);
      noteGrid.classList.remove("is-sorting");
      saveNotes();
    }
    drag = null;
    renderNotes();
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function deleteNote(id) {
  notes = notes.filter((n) => n.id !== id);
  saveNotes();
  if (id === openId) closeNote();
  else renderNotes();
}

export function initNotes() {
  notesEl = document.getElementById("notes");
  noteGrid = document.getElementById("note-grid");
  titleEl = document.getElementById("note-title");
  noteEl = document.getElementById("note");

  let timer = null;
  const edited = () => {
    const note = openNoteData();
    if (!note) return;
    note.title = titleEl.value;
    note.text = noteEl.value;
    note.updated = Date.now();
    clearTimeout(timer);
    timer = setTimeout(saveNotes, 300);
  };
  titleEl.addEventListener("input", edited);
  noteEl.addEventListener("input", edited);

  // Enter in the title moves on to the text, Escape goes back to the cards.
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      noteEl.focus();
    }
  });
  notesEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openId !== null) closeNote();
  });

  document.getElementById("note-add").addEventListener("click", () => {
    const note = { id: newId(), title: "", text: "", updated: Date.now() };
    // New notes go on top, just below the pinned ones.
    notes.splice(notes.filter((n) => n.pinned).length, 0, note);
    openNote(note.id, titleEl);
  });
  document.getElementById("note-back").addEventListener("click", closeNote);
  document.getElementById("note-delete").addEventListener("click", () => deleteNote(openId));
  document.getElementById("note-pin").addEventListener("click", () => togglePin(openId));

  noteGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".note-card");
    if (!card || justDragged) return;
    const id = Number(card.dataset.id);
    if (e.target.closest("[data-act=delete]")) return deleteNote(id);
    if (e.target.closest("[data-act=pin]")) return togglePin(id);
    openNote(id, noteEl);
  });
  initDrag();

  // Old single notes may be empty; don't show them as blank cards.
  notes = sorted(notes.filter((n) => !isBlank(n)));
  saveNotes();
  renderNotes();
}

export function renderNotes() {
  if (!noteGrid) return;
  if (notes.length === 0) {
    noteGrid.innerHTML = `<li class="empty">No notes yet. Add one with “New note”.</li>`;
    return;
  }
  noteGrid.innerHTML = notes
    .map(
      (n) => `
      <li class="note-card ${n.pinned ? "is-pinned" : ""} ${drag?.moving && drag.id === n.id ? "is-dragging" : ""}" data-id="${n.id}">
        ${n.title.trim() ? `<strong class="note-card-title">${escapeHtml(n.title)}</strong>` : ""}
        <p class="note-card-text">${escapeHtml(n.text.trim() || "")}</p>
        <span class="note-card-tools">
          <button class="icon-btn pin" data-act="pin" title="${n.pinned ? "Unpin" : "Pin to the top"}">${icon("pin")}</button>
          <button class="icon-btn danger" data-act="delete" title="Delete note">${icon("close")}</button>
        </span>
      </li>`
    )
    .join("");
}

/* ---------- to-do ---------- */

export function initTodos() {
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  todoList = document.getElementById("todo-list");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    todos.push({ id: newId(), text, done: false });
    input.value = "";
    save("todos", todos);
    renderTodos();
  });

  todoList.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const t = todos.find((t) => t.id === Number(e.target.closest(".todo").dataset.id));
    if (t) t.done = e.target.checked;
    save("todos", todos);
    renderTodos();
  });

  todoList.addEventListener("click", (e) => {
    if (!e.target.closest("[data-act=delete]")) return;
    const id = Number(e.target.closest(".todo").dataset.id);
    todos = todos.filter((t) => t.id !== id);
    save("todos", todos);
    renderTodos();
  });

  renderTodos();
}

export function renderTodos() {
  if (!todoList) return;
  if (todos.length === 0) {
    todoList.innerHTML = `<li class="empty">Nothing to do yet.</li>`;
    return;
  }
  todoList.innerHTML = todos
    .map(
      (t) => `
      <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <label class="check"><input type="checkbox" ${t.done ? "checked" : ""} /><span></span></label>
        <span class="todo-text">${escapeHtml(t.text)}</span>
        <button class="icon-btn danger" data-act="delete" title="Delete">${icon("close")}</button>
      </li>`
    )
    .join("");
}
