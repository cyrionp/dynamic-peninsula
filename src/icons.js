// Two hand-drawn icon sets on a 24×24 grid. "line" icons are strokes whose
// weight, caps and joins come from the theme's CSS variables; "solid" icons
// are filled shapes. Each theme picks one of the two.

const line = {
  media: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  stopwatch: `<circle cx="12" cy="14" r="8"/><path d="M12 10v4l2 2M10 2h4M12 2v4"/>`,
  countdown: `<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>`,
  note: `<path d="M4 4h11l5 5v11H4z"/><path d="M8 11h8M8 15h8M8 19h0"/>`,
  todo: `<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>`,
  settings: `<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.5"/><circle cx="10" cy="12" r="2.5"/><circle cx="18" cy="18" r="2.5"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  reset: `<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`,
  bell: `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>`,
  play: `<path d="M7 4l13 8-13 8z"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  next: `<path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/>`,
  previous: `<path d="M19 5L9 12l10 7z"/><path d="M5 5v14"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  up: `<path d="M6 15l6-6 6 6"/>`,
  down: `<path d="M6 9l6 6 6-6"/>`,
  pin: `<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>`,
  volume: `<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>`,
  mute: `<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 10l5 5M21 10l-5 5"/>`,
  trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
};

const solid = {
  media: `<path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="6" cy="18" r="3.4"/><circle cx="18" cy="16" r="3.4"/>`,
  stopwatch: `<path fill-rule="evenodd" d="M12 5a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-1 5v5l3.5 2 1-1.6-2.5-1.5V10z"/><rect x="9" y="1" width="6" height="2.4" rx="1.2"/>`,
  countdown: `<path d="M5 2h14v2h-1v2.5c0 1.7-.9 3.2-2.4 4.1L13.2 12l2.4 1.4c1.5.9 2.4 2.4 2.4 4.1V20h1v2H5v-2h1v-2.5c0-1.7.9-3.2 2.4-4.1l2.4-1.4-2.4-1.4C6.9 9.7 6 8.2 6 6.5V4H5z"/>`,
  note: `<path fill-rule="evenodd" d="M4 3h11l5 5v13H4zm4 7v2h8v-2zm0 4v2h8v-2z"/>`,
  todo: `<path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm1.6 9.2l-1.4 1.4L11 18l7-8.4-1.5-1.3-5.6 6.7z"/>`,
  settings: `<rect x="3" y="5" width="18" height="2.2" rx="1.1"/><rect x="3" y="11" width="18" height="2.2" rx="1.1"/><rect x="3" y="17" width="18" height="2.2" rx="1.1"/><circle cx="15" cy="6.1" r="3"/><circle cx="9" cy="12.1" r="3"/><circle cx="17" cy="18.1" r="3"/>`,
  plus: `<path d="M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5z"/>`,
  close: `<path d="M5.6 3.5L12 9.9l6.4-6.4 2.1 2.1-6.4 6.4 6.4 6.4-2.1 2.1-6.4-6.4-6.4 6.4-2.1-2.1 6.4-6.4-6.4-6.4z"/>`,
  reset: `<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></g>`,
  bell: `<path d="M12 2a6.5 6.5 0 0 1 6.5 6.5c0 6 2.5 8 3 8.5V18H2.5v-1c.5-.5 3-2.5 3-8.5A6.5 6.5 0 0 1 12 2z"/><path d="M9.5 20h5a2.5 2.5 0 0 1-5 0z"/>`,
  play: `<path d="M6 3.8v16.4a1 1 0 0 0 1.5.86l13.2-8.2a1 1 0 0 0 0-1.72L7.5 2.94A1 1 0 0 0 6 3.8z"/>`,
  pause: `<rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/>`,
  next: `<path d="M4 5.2v13.6a1 1 0 0 0 1.6.8l9.4-6.8a1 1 0 0 0 0-1.6L5.6 4.4a1 1 0 0 0-1.6.8z"/><rect x="17" y="4" width="3" height="16" rx="1.2"/>`,
  previous: `<path d="M20 5.2v13.6a1 1 0 0 1-1.6.8L9 12.8a1 1 0 0 1 0-1.6l9.4-6.8a1 1 0 0 1 1.6.8z"/><rect x="4" y="4" width="3" height="16" rx="1.2"/>`,
  clock: `<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v6l4.5 2.7 1-1.7-3.5-2.1V7z"/>`,
  back: `<path d="M14.6 3.4l2.1 2.1L10.2 12l6.5 6.5-2.1 2.1L6 12z"/>`,
  up: `<path d="M12 6.6l8.1 8.1-2.1 2.1-6-6-6 6-2.1-2.1z"/>`,
  down: `<path d="M12 17.4l-8.1-8.1 2.1-2.1 6 6 6-6 2.1 2.1z"/>`,
  pin: `<path d="M8.5 2h7l-1 6.5 4.5 4.5v2H5v-2l4.5-4.5z"/><rect x="11" y="14" width="2" height="8" rx="1"/>`,
  volume: `<path d="M3 8.5h4.5L13 4v16l-5.5-4.5H3z"/><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19 6.5a7.5 7.5 0 0 1 0 11"/></g>`,
  mute: `<path d="M3 8.5h4.5L13 4v16l-5.5-4.5H3z"/><path d="M16 10l5 5M21 10l-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  trash: `<path fill-rule="evenodd" d="M9 2h6v3h5v2.5H4V5h5zM5.5 9h13l-1 13h-11zm4 2.5v7h2v-7zm3 0v7h2v-7z"/>`,
};

let style = "line";

export function setIconStyle(next) {
  style = next === "solid" ? "solid" : "line";
}

export function icon(name) {
  if (style === "solid") {
    return `<svg class="i i-solid" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${solid[name] ?? ""}</svg>`;
  }
  return `<svg class="i i-line" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${line[name] ?? ""}</svg>`;
}

/** Fills every `<i data-icon="…">` placeholder under `root`. */
export function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
