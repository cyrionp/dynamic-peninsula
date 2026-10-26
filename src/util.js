export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Stopwatch time: mm:ss.cs, or h:mm:ss.cs past an hour. */
export function formatElapsed(ms) {
  const total = Math.floor(ms / 10);
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}` : `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Countdown time, rounded up so "0:00" only shows when it is really over. */
export function formatRemaining(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Track time: m:ss, or h:mm:ss for long tracks. */
export function formatTrack(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Stopwatch time without centiseconds, for the slim bar. */
export function formatElapsedShort(ms) {
  return formatRemaining(Math.floor(ms / 1000) * 1000);
}

export function formatClock(date, use24h) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24h,
  });
}
