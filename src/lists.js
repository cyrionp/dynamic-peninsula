// Notes and the to-do list, saved locally as you go.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";

let todos = load("todos", []);
let todoList = null;

/* ---------- notes ---------- */

// Older versions kept a single note under "note"; it becomes the first one.
let notes = load("notes", null) ?? [{ id: newId(), text: load("note", "") }];
let activeNote = load("noteActive", notes[0].id);
if (!notes.some((n) => n.id === activeNote)) activeNote = notes[0].id;

let noteList = null;
let noteEl = null;

const currentNote = () => notes.find((n) => n.id === activeNote);

/** First non-empty line, which doubles as the note's title. */
function noteTitle(note) {
  const line = note.text.split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 60) : "Empty note";
}

function saveNotes() {
  save("notes", notes);
  save("noteActive", activeNote);
}

function openNote(id, focus = false) {
  activeNote = id;
  save("noteActive", activeNote);
  noteEl.value = currentNote().text;
  renderNotes();
  if (focus) noteEl.focus();
}

export function initNotes() {
  noteEl = document.getElementById("note");
  noteList = document.getElementById("note-list");
  noteEl.value = currentNote().text;

  let timer = null;
  noteEl.addEventListener("input", () => {
    currentNote().text = noteEl.value;
    // Only the active title can change while typing.
    const title = noteList.querySelector(".note-item.is-active .note-title");
    if (title) title.textContent = noteTitle(currentNote());
    clearTimeout(timer);
    timer = setTimeout(saveNotes, 300);
  });

  document.getElementById("note-add").addEventListener("click", () => {
    // Reuse an untouched empty note instead of piling them up.
    const blank = notes.find((n) => !n.text.trim());
    if (blank) return openNote(blank.id, true);
    const note = { id: newId(), text: "" };
    notes.unshift(note);
    saveNotes();
    openNote(note.id, true);
  });

  noteList.addEventListener("click", (e) => {
    const item = e.target.closest(".note-item");
    if (!item) return;
    const id = Number(item.dataset.id);
    if (e.target.closest("[data-act=delete]")) {
      const index = notes.findIndex((n) => n.id === id);
      notes.splice(index, 1);
      // There is always at least one note to type into.
      if (notes.length === 0) notes.push({ id: newId(), text: "" });
      if (id === activeNote) activeNote = notes[Math.min(index, notes.length - 1)].id;
      saveNotes();
      openNote(activeNote);
      return;
    }
    openNote(id, true);
  });

  renderNotes();
}

export function renderNotes() {
  if (!noteList) return;
  noteList.innerHTML = notes
    .map(
      (n) => `
      <li class="note-item ${n.id === activeNote ? "is-active" : ""}" data-id="${n.id}">
        <span class="note-title">${escapeHtml(noteTitle(n))}</span>
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
