// Optional weather for one city, off until switched on in Settings.
// Uses Open-Meteo (https://open-meteo.com): free, no account or key. Only the
// city name (to find it) and its coordinates (for the forecast) leave this
// computer, and only while the feature is on.

import { load, save } from "./store.js";
import { escapeHtml, formatClock } from "./util.js";
import { getSettings } from "./settings.js";

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
// How often the reading is refreshed, and how old it may get before the bar
// stops showing it.
const REFRESH = 15 * 60_000;
const STALE = 3 * 60 * 60_000;
const RETRY = 2 * 60_000;

const DEFAULTS = { on: false, place: null, unit: "c" };

let config = { ...DEFAULTS, ...load("weather", {}) };
// Last reading: { temp, code, day, unit, at }, kept so the bar has something
// to show straight after launch.
let reading = load("weather.now", null);
let status = "";
let timer = null;
let changed = () => {};

export const weatherOn = () => config.on && Boolean(config.place);

// WMO weather codes, as Open-Meteo reports them.
function condition(code, day) {
  if (code === 0) return { icon: day ? "sun" : "moon", label: day ? "Sunny" : "Clear" };
  if (code === 1 || code === 2) return { icon: day ? "partly" : "partly-night", label: "Partly cloudy" };
  if (code === 3) return { icon: "cloud", label: "Cloudy" };
  if (code === 45 || code === 48) return { icon: "fog", label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "rain", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "rain", label: "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "snow", label: "Snow" };
  if (code >= 95) return { icon: "storm", label: "Thunderstorm" };
  return { icon: "cloud", label: "" };
}

/** What the bar shows, or null when there is nothing fresh to show. */
export function current() {
  if (!weatherOn() || !reading || reading.unit !== config.unit) return null;
  if (Date.now() - reading.at > STALE) return null;
  const { icon, label } = condition(reading.code, reading.day);
  return { icon, label, temp: `${Math.round(reading.temp)}°`, place: config.place.name };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refresh() {
  clearTimeout(timer);
  if (!weatherOn()) return;
  const { place, unit } = config;
  try {
    const params = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      current: "temperature_2m,weather_code,is_day",
      temperature_unit: unit === "f" ? "fahrenheit" : "celsius",
      timezone: "auto",
    });
    const data = await getJson(`${FORECAST}?${params}`);
    const c = data.current;
    if (typeof c?.temperature_2m !== "number") throw new Error("no reading");
    // The city may have changed while this was on its way.
    if (config.place !== place || config.unit !== unit) return;
    reading = { temp: c.temperature_2m, code: c.weather_code, day: c.is_day === 1, unit, at: Date.now() };
    save("weather.now", reading);
    status = "";
    timer = setTimeout(refresh, REFRESH);
  } catch {
    status = "Couldn't reach the weather service; trying again shortly.";
    timer = setTimeout(refresh, RETRY);
  }
  paintWeather();
  changed(false);
}

async function findCity(name) {
  status = "Looking it up…";
  paintWeather();
  try {
    const params = new URLSearchParams({ name, count: "1", language: "en", format: "json" });
    const data = await getJson(`${GEOCODE}?${params}`);
    const hit = data.results?.[0];
    if (!hit) {
      status = `No city called “${name}” was found.`;
    } else {
      status = "";
      reading = null;
      update({
        place: {
          name: hit.name,
          region: [hit.admin1 !== hit.name && hit.admin1, hit.country].filter(Boolean).join(", "),
          lat: hit.latitude,
          lon: hit.longitude,
        },
      });
      return;
    }
  } catch {
    status = "Couldn't reach the weather service. Check the connection and try again.";
  }
  paintWeather();
}

function update(patch) {
  config = { ...config, ...patch };
  save("weather", config);
  changed(true);
  if (weatherOn()) refresh();
  else clearTimeout(timer);
}

export function paintWeather() {
  const box = document.getElementById("weather-box");
  if (!box) return;
  const now = current();
  const place = config.place;
  const units = [
    { id: "c", label: "°C" },
    { id: "f", label: "°F" },
  ];
  box.innerHTML = `
    <h3>Weather</h3>
    <label class="switch-row">
      <span>Show the weather</span>
      <input type="checkbox" class="switch" id="set-weather" ${config.on ? "checked" : ""} />
    </label>
    ${
      config.on
        ? `<form class="weather-form" id="weather-form" autocomplete="off">
            <input class="field" name="city" placeholder="City, e.g. Istanbul" spellcheck="false" value="${escapeHtml(place?.name ?? "")}" />
            <button class="mini" type="submit">Set city</button>
          </form>
          <div class="switch-row">
            <span>Unit</span>
            <div class="chips">
              ${units
                .map((u) => `<button class="chip ${u.id === config.unit ? "is-active" : ""}" data-weather-unit="${u.id}">${u.label}</button>`)
                .join("")}
            </div>
          </div>
          <p class="hint">${escapeHtml(
            status ||
              (!place
                ? "Pick a city to see its weather on the bar."
                : now
                  ? `${now.temp}${config.unit === "f" ? "F" : "C"}${now.label ? `, ${now.label.toLowerCase()}` : ""} in ${place.name}${place.region ? ` (${place.region})` : ""}. Updated ${formatClock(new Date(reading.at), getSettings().clock24)}.`
                  : `${place.name}${place.region ? ` (${place.region})` : ""}: fetching…`)
          )}</p>`
        : `<p class="hint">Off. When on, the city you pick is sent to Open-Meteo, a free weather service.</p>`
    }
  `;
}

export function initWeather(onChange) {
  changed = onChange;
  // Settings re-renders its page, so listen on the page rather than the box.
  const page = document.getElementById("settings-page");
  page.addEventListener("change", (e) => {
    if (e.target.id === "set-weather") update({ on: e.target.checked });
  });
  page.addEventListener("click", (e) => {
    const unit = e.target.closest("[data-weather-unit]");
    if (unit && unit.dataset.weatherUnit !== config.unit) update({ unit: unit.dataset.weatherUnit });
  });
  page.addEventListener("submit", (e) => {
    if (e.target.id !== "weather-form") return;
    e.preventDefault();
    const name = e.target.elements.city.value.trim();
    if (name) findCity(name);
  });
  // Back from sleep or a dropped connection: don't wait for the next round.
  window.addEventListener("online", () => weatherOn() && refresh());
  paintWeather();
  refresh();
}
