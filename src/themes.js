// The ten built-in themes, each with a dark and a light mode. Colours, fonts and shapes live in styles.css
// under [data-theme="…"]; this list adds what JavaScript needs to know.

export const THEMES = [
  { id: "lagoon", name: "Lagoon", icons: "line", blurb: "Cool teal glass" },
  { id: "ember", name: "Ember", icons: "solid", blurb: "Warm and bold" },
  { id: "paper", name: "Paper", icons: "line", blurb: "Light, ink and serif" },
  { id: "terminal", name: "Terminal", icons: "line", blurb: "Green phosphor mono" },
  { id: "aurora", name: "Aurora", icons: "solid", blurb: "Violet night gradient" },
  { id: "frost", name: "Frost", icons: "line", blurb: "Icy blue, crisp and thin" },
  { id: "moss", name: "Moss", icons: "solid", blurb: "Soft forest green" },
  { id: "graphite", name: "Graphite", icons: "line", blurb: "Minimal monochrome" },
  { id: "sakura", name: "Sakura", icons: "solid", blurb: "Blossom pink, extra round" },
  { id: "citrus", name: "Citrus", icons: "solid", blurb: "Sunny yellow, punchy" },
];

export const MODES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
