// Interface language: English or Turkish. The English text is the key, so
// code reads naturally (t("Settings")) and anything without a translation
// simply stays in English. Placeholders look like {name}.
//
// The choice is saved with the other settings ("lang"), so the taskbar dock
// window, which reads the same storage, follows it too. Until it is chosen,
// the system language decides.

import { load } from "./store.js";
import { TR } from "./i18n-tr.js";

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
];

const DICTS = { en: {}, tr: TR };

/** Turkish when the system is Turkish, English otherwise. */
export function systemLang() {
  const list = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language];
  return list.some((l) => /^tr\b/i.test(l ?? "")) ? "tr" : "en";
}

const known = (id) => (DICTS[id] ? id : null);

let lang = known(load("settings", {}).lang) ?? systemLang();

export const getLang = () => lang;

/** For dates and times: "tr-TR" or "en-GB". */
export const locale = () => (lang === "tr" ? "tr-TR" : "en-GB");

/** Switches the language; returns true if it changed. */
export function setLang(next) {
  const id = known(next) ?? systemLang();
  if (id === lang) return false;
  lang = id;
  document.documentElement.lang = lang;
  return true;
}

/** The text in the current language, with {placeholders} filled in. */
export function t(text, vars) {
  const out = DICTS[lang][text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

// The static markup in index.html is written in English. Elements marked
// data-i18n (text), data-i18n-title and data-i18n-placeholder remember
// their English on the first pass, so they can be switched back and forth.
const ATTRS = ["title", "placeholder"];

export function translatePage(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    if (!el.dataset.i18n) el.dataset.i18n = el.textContent.trim();
    el.textContent = t(el.dataset.i18n);
  }
  for (const attr of ATTRS) {
    const key = `i18n${attr[0].toUpperCase()}${attr.slice(1)}`;
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      if (!el.dataset[key]) el.dataset[key] = el.getAttribute(attr) ?? "";
      el.setAttribute(attr, t(el.dataset[key]));
    }
  }
}
