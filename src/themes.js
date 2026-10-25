// The five built-in themes. Colours, fonts and shapes live in styles.css
// under [data-theme="…"]; this list adds what JavaScript needs to know.

export const THEMES = [
  { id: "lagoon", name: "Lagoon", icons: "line", blurb: "Cool teal glass" },
  { id: "ember", name: "Ember", icons: "solid", blurb: "Warm and bold" },
  { id: "paper", name: "Paper", icons: "line", blurb: "Light, ink and serif" },
  { id: "terminal", name: "Terminal", icons: "line", blurb: "Green phosphor mono" },
  { id: "aurora", name: "Aurora", icons: "solid", blurb: "Violet night gradient" },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
