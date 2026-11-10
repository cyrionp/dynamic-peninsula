// What the taskbar dock (experimental) can show, and its defaults. Shared by
// Settings (in the peninsula window) and the dock window itself, which only
// reads the saved settings.

export const DOCK_ITEMS = {
  countdown: { label: "Countdown", hint: "a running countdown" },
  media: { label: "Now playing", hint: "music and its buttons" },
  stopwatch: { label: "Stopwatch", hint: "a running stopwatch" },
  headphones: { label: "Headphones", hint: "earbud and headset battery" },
};

export const DOCK_LOOKS = [
  { id: "windows", label: "Windows", hint: "Matches the taskbar: its light or dark look and your accent colour." },
  { id: "peninsula", label: "Peninsula theme", hint: "Uses the peninsula's theme, toned down to sit on the taskbar." },
];

export const DOCK_DEFAULTS = {
  // Off until switched on: it's experimental.
  dock: false,
  dockLook: "windows",
  // Shown left to right, in this order.
  dockItems: [
    { id: "countdown", on: true },
    { id: "media", on: true },
    { id: "stopwatch", on: true },
    { id: "headphones", on: true },
  ],
};

/** Exactly one entry per known item, in the saved order, new ones last. */
export function normaliseDockItems(saved) {
  return [...(Array.isArray(saved) ? saved : []).filter((s) => DOCK_ITEMS[s?.id]), ...DOCK_DEFAULTS.dockItems].filter(
    (s, i, all) => all.findIndex((t) => t.id === s.id) === i
  );
}
