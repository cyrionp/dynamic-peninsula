// Quick note and to-do list, saved locally as you go.

import { load, save, newId } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";

let todos = load("todos", []);
let todoList = null;

export function initNotes() {
  const noteEl = document.getElementById("note");
  noteEl.value = load("note", "");
  let timer = null;
  noteEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => save("note", noteEl.value), 300);
  });
}

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
