// Notes and the to-do list, saved locally as you go.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";

let todos = load("todos", []);
let todoList = null;

/* ---------- notes ---------- */

// Each note is a card with an optional title. Older versions kept a single
// note under "note"; it becomes the first card.
let notes = (load("notes", null) ?? [{ id: newId(), text: load("note", "") }]).map((n) => ({
  title: "",
  ...n,
}));
let openId = null;

let notesEl = null;
let noteGrid = null;
let titleEl = null;
let noteEl = null;

const openNoteData = () => notes.find((n) => n.id === openId);
const isBlank = (n) => !n.title.trim() && !n.text.trim();

function saveNotes() {
  save("notes", notes);
}

function openNote(id, focus) {
  openId = id;
  const note = openNoteData();
  titleEl.value = note.title;
  noteEl.value = note.text;
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
    notes.unshift(note);
    openNote(note.id, titleEl);
  });
  document.getElementById("note-back").addEventListener("click", closeNote);
  document.getElementById("note-delete").addEventListener("click", () => deleteNote(openId));

  noteGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".note-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    if (e.target.closest("[data-act=delete]")) return deleteNote(id);
    openNote(id, noteEl);
  });

  // Old single notes may be empty; don't show them as blank cards.
  notes = notes.filter((n) => !isBlank(n));
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
      <li class="note-card" data-id="${n.id}" title="Open">
        ${n.title.trim() ? `<strong class="note-card-title">${escapeHtml(n.title)}</strong>` : ""}
        <p class="note-card-text">${escapeHtml(n.text.trim() || "")}</p>
        <button class="icon-btn danger" data-act="delete" title="Delete note">${icon("close")}</button>
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
