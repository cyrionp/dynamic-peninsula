// Tiny wrapper around localStorage. Everything stays on this computer.
// Reads and writes never throw: a broken or missing store just means defaults.

const PREFIX = "dp.";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: keep running in memory
  }
}

let nextIdCounter = Date.now();
export function newId() {
  return nextIdCounter++;
}
