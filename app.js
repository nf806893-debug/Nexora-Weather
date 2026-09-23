'use strict';
/* ============================================================================
   NEXORA WEATHER — app.js
   A fully customizable weather application.
   Data sources (free, no API key required):
     - Open-Meteo Forecast API      https://api.open-meteo.com
     - Open-Meteo Geocoding API     https://geocoding-api.open-meteo.com
     - Open-Meteo Air Quality API   https://air-quality-api.open-meteo.com
     - BigDataCloud reverse geocode https://api.bigdatacloud.net (free, no key)
   Everything runs client-side; preferences persist in localStorage.
   ============================================================================ */

/* ============================ 1. UTILITIES ============================ */
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function deepMerge(target, source) {
  for (const k of Object.keys(source || {})) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}
/* safe localStorage wrapper */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('nexora.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('nexora.' + key, JSON.stringify(value)); }
    catch (e) { toast('Could not save — browser storage is full or unavailable.', 'error'); }
  },
  del(key) { try { localStorage.removeItem('nexora.' + key); } catch (e) { /* ignore */ } }
};

let toastTimer = {};
function toast(msg, kind) {
  const root = $('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

async function fetchJSON(url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/* ============================ 2. CONSTANTS ============================ */
const APP_VERSION = '1.0.0';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AQI_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/* WMO weather-code interpretation (Open-Meteo) */
const WMO_TEXT = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snowfall', 73: 'Snowfall', 75: 'Heavy snowfall', 77: 'Snow grains',
  80: 'Light showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm'
};
function wmoText(code) { return WMO_TEXT[code] != null ? WMO_TEXT[code] : 'Unknown'; }
function condKey(code, isDay) {
  if (code === 0) return isDay === false ? 'night' : 'clear';
  if (code === 1 || code === 2) return 'cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}
/* category -> css color variable name (condition colors) */
const COND_VARS = { clear: 'cc-clear', cloudy: 'cc-cloudy', rain: 'cc-rain', snow: 'cc-snow', storm: 'cc-storm', fog: 'cc-fog', night: 'cc-night' };

/* ============================ 3. DEFAULTS ============================ */
const DEFAULT_COLORS = {
  bg: '#0b1220', bg2: '#111a2e', card: '#ffffff', text: '#e6edf7', text2: '#8b9bb4',
  accent: '#4cc2ff', border: '#ffffff', button: '#4cc2ff', icon: '#7dd3fc', graph: '#4cc2ff'
};
const DEFAULT_COND_COLORS = {
  clear: '#fbbf24', cloudy: '#94a3b8', rain: '#60a5fa', snow: '#e2e8f0',
  storm: '#f59e0b', fog: '#9ca3af', night: '#818cf8'
};
const DEFAULT_TYPOGRAPHY = {
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeight: 1.5
};
const DEFAULT_LAYOUT = {
  cardRadius: 16, gap: 16, padding: 20, cols: 4, iconSize: 44, tempSize: 64,
  sectionGap: 24, cardHeight: 0, cardWidth: 0, headerHeight: 64, sidebarWidth: 240
};
const DEFAULT_EFFECTS = {
  blur: 12, glass: 0.07, shadow: 0.35, opacity: 1, gradient: true,
  transition: 0.25, animSpeed: 1
};
const DEFAULT_BACKGROUND = { type: 'dynamic', dynamicOn: true, color: '#0b1220', color2: '#1e293b', image: '' };

const DEFAULTS = {
  version: 1,
  general: { refreshMinutes: 15, startGeolocate: true },
  units: { temp: 'c', wind: 'kmh', pressure: 'hpa', precip: 'mm', vis: 'km' },
  time: { hour12: true, tz: 'auto', dateFormat: 'mdy' },
  accessibility: { reducedMotion: false, largeText: false, highContrast: false },
  hourly: { count: 24, graph: true, metrics: ['temp'] },
  dailyCount: 7,
  appearance: {
    theme: 'default',
    colors: clone(DEFAULT_COLORS),
    condColors: clone(DEFAULT_COND_COLORS),
    typography: clone(DEFAULT_TYPOGRAPHY),
    layout: clone(DEFAULT_LAYOUT),
    effects: clone(DEFAULT_EFFECTS),
    background: clone(DEFAULT_BACKGROUND)
  }
};

/* Widget registry — id, display name, default grid span */
const WIDGETS = [
  { id: 'current',  name: 'Current Weather',   def: 'lg' },
  { id: 'hourly',   name: 'Hourly Forecast',   def: 'lg' },
  { id: 'daily',    name: 'Daily Forecast',    def: 'lg' },
  { id: 'feels',    name: 'Feels Like',        def: 'sm' },
  { id: 'precip',   name: 'Precipitation',     def: 'sm' },
  { id: 'wind',     name: 'Wind',              def: 'sm' },
  { id: 'humidity', name: 'Humidity',          def: 'sm' },
  { id: 'pressure', name: 'Pressure',          def: 'sm' },
  { id: 'uv',       name: 'UV Index',          def: 'sm' },
  { id: 'visibility', name: 'Visibility',      def: 'sm' },
  { id: 'cloud',    name: 'Cloud Cover',       def: 'sm' },
  { id: 'sun',      name: 'Sunrise & Sunset',  def: 'md' },
  { id: 'aqi',      name: 'Air Quality',       def: 'md' },
  { id: 'moon',     name: 'Moon',              def: 'sm' },
  { id: 'location', name: 'Location',          def: 'md' },
  { id: 'updated',  name: 'Last Updated',      def: 'sm' }
];
function defaultDashboard() {
  return WIDGETS.map(w => ({ id: w.id, visible: true, size: w.def, mode: 'normal' }));
}

/* ============================ 4. BUILT-IN THEMES ============================ */
const BUILTIN_THEMES = [
  { id: 'default', name: 'Default', overrides: {} },
  { id: 'dark', name: 'Dark', overrides: {
    colors: { bg: '#070b14', bg2: '#0d1526', card: '#a5b4cd', text: '#e6edf7', text2: '#8b9bb4', accent: '#60a5fa', border: '#94a3b8', button: '#3b82f6', icon: '#93c5fd', graph: '#60a5fa' },
    effects: { blur: 4, glass: 0.09, shadow: 0.35, gradient: true } } },
  { id: 'light', name: 'Light', overrides: {
    colors: { bg: '#eef2f8', bg2: '#dde6f2', card: '#ffffff', text: '#16233a', text2: '#5b6b84', accent: '#0284c7', border: '#64748b', button: '#0284c7', icon: '#0369a1', graph: '#0284c7' },
    effects: { blur: 10, glass: 0.65, shadow: 0.2, gradient: true } } },
  { id: 'amoled', name: 'AMOLED', overrides: {
    colors: { bg: '#000000', bg2: '#000000', card: '#dbe4f0', text: '#f2f6fc', text2: '#8a94a6', accent: '#00e5ff', border: '#3a4356', button: '#00e5ff', icon: '#66f0ff', graph: '#00e5ff' },
    effects: { blur: 0, glass: 0.06, shadow: 0.25, gradient: false } } },
  { id: 'glass', name: 'Glass', overrides: {
    colors: { bg: '#16233f', bg2: '#1d3054', card: '#cfe3ff', text: '#eef5ff', text2: '#a9c2e4', accent: '#7cc4ff', border: '#cfe3ff', button: '#7cc4ff', icon: '#aadcff', graph: '#7cc4ff' },
    effects: { blur: 26, glass: 0.14, shadow: 0.25, gradient: true } } },
  { id: 'minimal', name: 'Minimal', overrides: {
    colors: { bg: '#f7f8fa', bg2: '#eef1f5', card: '#ffffff', text: '#1a2433', text2: '#6b7a90', accent: '#111827', border: '#94a3b8', button: '#111827', icon: '#334155', graph: '#334155' },
    effects: { blur: 0, glass: 0.03, shadow: 0.06, gradient: false, transition: 0.15 },
    layout: { cardRadius: 8 } } },
  { id: 'cyberpunk', name: 'Cyberpunk', overrides: {
    colors: { bg: '#07010f', bg2: '#12042a', card: '#b18cff', text: '#e9dcff', text2: '#9d8fd1', accent: '#00ffe0', border: '#7c5cd6', button: '#00ffe0', icon: '#ff2fd6', graph: '#00ffe0' },
    typography: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
    condColors: { clear: '#ffe600', cloudy: '#8f7bd9', rain: '#00cfff', snow: '#dff6ff', storm: '#ff2fd6', fog: '#6d6491', night: '#7a5cff' },
    effects: { blur: 14, glass: 0.1, shadow: 0.5, gradient: true } } },
  { id: 'retro', name: 'Retro', overrides: {
    colors: { bg: '#f2e3c6', bg2: '#e8d3ac', card: '#fffaf0', text: '#4a2c17', text2: '#8a6a4e', accent: '#c2410c', border: '#a16207', button: '#c2410c', icon: '#b45309', graph: '#c2410c' },
    typography: { fontFamily: "'Courier New', Courier, monospace", fontWeight: 600 },
    effects: { blur: 0, glass: 0.55, shadow: 0.18, gradient: false },
    layout: { cardRadius: 4 } } },
  { id: 'material', name: 'Material', overrides: {
    colors: { bg: '#f5f7fb', bg2: '#e8edf5', card: '#ffffff', text: '#1f2937', text2: '#64748b', accent: '#3f51b5', border: '#b0bccd', button: '#3f51b5', icon: '#5c6bc0', graph: '#3f51b5' },
    effects: { blur: 8, glass: 0.75, shadow: 0.4, gradient: false },
    layout: { cardRadius: 10 } } },
  { id: 'monochrome', name: 'Monochrome', overrides: {
    colors: { bg: '#101010', bg2: '#1a1a1a', card: '#e5e5e5', text: '#f5f5f5', text2: '#9e9e9e', accent: '#e5e5e5', border: '#525252', button: '#e5e5e5', icon: '#c4c4c4', graph: '#e5e5e5' },
    condColors: { clear: '#d4d4d4', cloudy: '#a3a3a3', rain: '#d4d4d4', snow: '#f5f5f5', storm: '#a3a3a3', fog: '#737373', night: '#a3a3a3' },
    effects: { blur: 6, glass: 0.08, shadow: 0.3, gradient: false } } }
];

/* ============================ 5. STATE ============================ */
const state = {
  settings: null,
  customThemes: [],
  locations: [],
  activeLoc: null,
  gps: null,
  weather: null,
  aqi: null,
  loading: false,
  source: 'live',
  lastLoad: 0,
  activeCat: 'appearance',
  searchActive: -1
};

function loadAll() {
  const savedSettings = store.get('settings', null);
  state.settings = clone(DEFAULTS);
  if (savedSettings && typeof savedSettings === 'object') deepMerge(state.settings, savedSettings);
  if (!Array.isArray(state.settings.hourly.metrics)) state.settings.hourly.metrics = ['temp'];

  const dash = store.get('dashboard', null);
  state.settings.dashboard = (Array.isArray(dash) && dash.length)
    ? dash
    : defaultDashboard();
  const known = new Set(state.settings.dashboard.map(d => d.id));
  for (const w of WIDGETS) if (!known.has(w.id)) state.settings.dashboard.push({ id: w.id, visible: true, size: w.def, mode: 'normal' });

  state.customThemes = store.get('themes', []) || [];
  state.locations = store.get('locations', []) || [];
  state.activeLoc = store.get('activeLoc', null);
  state.gps = store.get('gps', null);
}
function saveSettings() { store.set('settings', state.settings); }
function saveDashboard() { store.set('dashboard', state.settings.dashboard); }
function saveThemes() { store.set('themes', state.customThemes); }
function saveLocations() { store.set('locations', state.locations); store.set('activeLoc', state.activeLoc); store.set('gps', state.gps); }

/* ============================ 6. UNITS & FORMATTING ============================ */
function uTemp(c, precise) {
  if (c == null || isNaN(c)) return '—';
  const v = state.settings.units.temp === 'f' ? c * 9 / 5 + 32 : c;
  return (precise ? v.toFixed(1) : Math.round(v)) + '°';
}
function uWind(kmh) {
  if (kmh == null || isNaN(kmh)) return '—';
  const u = state.settings.units.wind;
  let v = kmh, unit = 'km/h';
  if (u === 'mph') { v = kmh / 1.609344; unit = 'mph'; }
  else if (u === 'ms') { v = kmh / 3.6; unit = 'm/s'; }
  else if (u === 'kn') { v = kmh / 1.852; unit = 'kn'; }
  return v.toFixed(v >= 100 || u === 'ms' ? 0 : 1) + ' ' + unit;
}
function uPressure(hpa) {
  if (hpa == null || isNaN(hpa)) return '—';
  const u = state.settings.units.pressure;
  if (u === 'inhg') return (hpa * 0.02952998).toFixed(2) + ' inHg';
  if (u === 'mmhg') return Math.round(hpa * 0.7500617) + ' mmHg';
  return Math.round(hpa) + ' hPa';
}
function uPrecip(mm) {
  if (mm == null || isNaN(mm)) return '0';
  if (state.settings.units.precip === 'in') return (mm / 25.4).toFixed(2) + ' in';
  return (mm >= 10 ? Math.round(mm) : mm.toFixed(1)) + ' mm';
}
function uVis(km) {
  if (km == null || isNaN(km)) return '—';
  if (state.settings.units.vis === 'mi') return (km / 1.609344).toFixed(1) + ' mi';
  return km >= 10 ? Math.round(km) + ' km' : km.toFixed(1) + ' km';
}
function compass(deg) {
  if (deg == null || isNaN(deg)) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16] + ' ' + Math.round(deg) + '°';
}
function tzName() {
  if (state.settings.time.tz === 'device') return undefined;
  return (state.weather && state.weather.timezone) || undefined;
}
function fmtTime(unixSec, opts) {
  if (unixSec == null) return '—';
  const base = { hour: 'numeric', minute: '2-digit', hour12: state.settings.time.hour12 };
  try {
    return new Intl.DateTimeFormat(undefined, Object.assign(base, opts || {}, tzName() ? { timeZone: tzName() } : {}))
      .format(new Date(unixSec * 1000));
  } catch (e) { return '—'; }
}
function fmtHour(unixSec) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', hour12: state.settings.time.hour12, timeZone: tzName() })
      .format(new Date(unixSec * 1000));
  } catch (e) { return '—'; }
}
const DATE_FORMATS = {
  mdy: { year: 'numeric', month: '2-digit', day: '2-digit' },
  dmy: { year: 'numeric', day: '2-digit', month: '2-digit' },
  ymd: { year: 'numeric', month: '2-digit', day: '2-digit' },
  long: { weekday: 'long', month: 'long', day: 'numeric' },
  short: { weekday: 'short', month: 'short', day: 'numeric' }
};
function fmtDate(unixSec, withWeekday) {
  if (unixSec == null) return '—';
  let key = state.settings.time.dateFormat;
  if (withWeekday && key !== 'long' && key !== 'short') key = 'short';
  try {
    return new Intl.DateTimeFormat(undefined,
      Object.assign({}, DATE_FORMATS[key] || DATE_FORMATS.mdy, tzName() ? { timeZone: tzName() } : {}))
      .format(new Date(unixSec * 1000));
  } catch (e) { return '—'; }
}
function fmtDayName(unixSec, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  try {
    return new Intl.DateTimeFormat(undefined,
      Object.assign({ weekday: 'long' }, tzName() ? { timeZone: tzName() } : {}))
      .format(new Date(unixSec * 1000));
  } catch (e) { return '—'; }
}
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '🏳️';
  return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(ch => 127397 + ch.charCodeAt(0)));
}
function uvLevel(uv) {
  if (uv == null) return { label: '—', color: '#9ca3af' };
  if (uv < 3) return { label: 'Low', color: '#22c55e' };
  if (uv < 6) return { label: 'Moderate', color: '#eab308' };
  if (uv < 8) return { label: 'High', color: '#f97316' };
  if (uv < 11) return { label: 'Very high', color: '#ef4444' };
  return { label: 'Extreme', color: '#a855f7' };
}
function aqiLevel(aqi) {
  if (aqi == null) return { label: '—', color: '#9ca3af' };
  if (aqi <= 50) return { label: 'Good', color: '#22c55e' };
  if (aqi <= 100) return { label: 'Moderate', color: '#eab308' };
  if (aqi <= 150) return { label: 'Sensitive', color: '#f97316' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ef4444' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#a855f7' };
  return { label: 'Hazardous', color: '#7f1d1d' };
}
function moonInfo(dateMs) {
  const synodic = 29.53058867;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = ((dateMs - ref) / 86400000) % synodic;
  const phase = ((days % synodic) + synodic) % synodic;
  const illum = (1 - Math.cos(2 * Math.PI * phase / synodic)) / 2;
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const idx = Math.floor(((phase / synodic) * 8) + 0.5) % 8;
  return { phase, illumination: illum, name: names[idx] };
}

/* ============================ 7. SVG ICON SYSTEM ============================ */
const ICON_PARTS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1.8v2.4M12 19.8v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M1.8 12h2.4M19.8 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/>',
  moon: '<path d="M20.6 13.2A8.8 8.8 0 1 1 10.8 3.4a7 7 0 0 0 9.8 9.8z"/>',
  cloud: '<path d="M17.4 18.6a4.4 4.4 0 0 0 .4-8.8 6.3 6.3 0 0 0-12.2-1.5A3.9 3.9 0 0 0 6.9 18.6z"/>',
  fog: '<path d="M4 9.5h12.6a3 3 0 1 0-3-3"/><path d="M2.5 13.5h17M4.5 17h13"/>',
  drizzle: '<path d="M17.4 15.6a4.4 4.4 0 0 0 .4-8.8 6.3 6.3 0 0 0-12.2-1.5A3.9 3.9 0 0 0 6.9 15.6z"/><path d="M8 18.4v.01M12 19.6v.01M16 18.4v.01"/>',
  rain: '<path d="M17.4 15.4a4.4 4.4 0 0 0 .4-8.8 6.3 6.3 0 0 0-12.2-1.5A3.9 3.9 0 0 0 6.9 15.4z"/><path d="M8 17.6l-1 3M12.5 17.6l-1 3M17 17.6l-1 3"/>',
  snow: '<path d="M17.4 15.2a4.4 4.4 0 0 0 .4-8.8 6.3 6.3 0 0 0-12.2-1.5A3.9 3.9 0 0 0 6.9 15.2z"/><path d="M8 18.2v.01M12 19.4v.01M16 18.2v.01M10 21.4v.01M14 21.4v.01"/>',
  thunder: '<path d="M17.4 14.8a4.4 4.4 0 0 0 .4-8.8 6.3 6.3 0 0 0-12.2-1.5A3.9 3.9 0 0 0 6.9 14.8z"/><path d="M12.6 14.2l-2.8 3.8h2.6l-1.8 4 3.8-4.6h-2.6z"/>',
  'sun-cloud': '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.6v1.6M2.2 8h1.6M3.6 3.6l1.1 1.1M12.4 12.4l1.1 1.1"/><path d="M19.2 20a3.8 3.8 0 0 0 .4-7.6 5.4 5.4 0 0 0-10.5-1.3A3.3 3.3 0 0 0 10.2 20z"/>',
  'moon-cloud': '<path d="M9.2 3.2a5 5 0 0 0 4.3 6.6 5 5 0 0 0 .7-9.9 4 4 0 0 0-5 3.3z"/><path d="M19.4 20a3.7 3.7 0 0 0 .4-7.4 5.3 5.3 0 0 0-10.3-1.2A3.2 3.2 0 0 0 10.7 20z"/>'
};
function iconName(code, isDay) {
  if (code === 0) return isDay === false ? 'moon' : 'sun';
  if (code === 1 || code === 2) return isDay === false ? 'moon-cloud' : 'sun-cloud';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}
function iconSvg(code, isDay, extraClass) {
  const name = iconName(code, isDay);
  const key = condKey(code, isDay);
  return '<svg class="wicon ' + (extraClass || '') + ' cond-' + key + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICON_PARTS[name] + '</svg>';
}

/* ============================ 8. LOCATION RESOLUTION ============================ */
function currentLocation() {
  if (state.activeLoc === 'gps' && state.gps) {
    return { key: 'gps', label: state.gps.label || 'Current location', lat: state.gps.lat, lon: state.gps.lon };
  }
  const loc = state.locations.find(l => l.id === state.activeLoc) || state.locations[0];
  if (loc) return { key: loc.id, label: loc.name, lat: loc.lat, lon: loc.lon, tz: loc.tz };
  return { key: 'default', label: 'New York', lat: 40.7143, lon: -74.006, cc: 'US' };
}
function locFromGeocodeResult(r) {
  return {
    id: 'loc-' + r.id,
    name: r.name,
    region: r.admin1 || '',
    country: r.country || '',
    cc: r.country_code || '',
    lat: r.latitude, lon: r.longitude, tz: r.timezone || ''
  };
}

/* ============================ 9. API LAYER ============================ */
async function geocode(query) {
  const url = GEOCODE_URL + '?name=' + encodeURIComponent(query) + '&count=8&language=en&format=json';
  const j = await fetchJSON(url);
  return Array.isArray(j.results) ? j.results : [];
}
async function reverseGeocode(lat, lon) {
  try {
    const j = await fetchJSON(REVERSE_URL + '?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en', 8000);
    return [j.city || j.locality, j.principalSubdivision || j.countryName].filter(Boolean).join(', ') || 'Current location';
  } catch (e) { return 'Current location'; }
}

/* FIXED: Corrected timeformat to 'unixtime' and fixed daily parameters (removed duplicate max temperature, added apparent_temperature_max) */
function forecastUrl(loc) {
  return FORECAST_URL +
    '?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,pressure_msl,surface_pressure,wind_speed_10m,wind_gusts_10m,uv_index,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,rain_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max' +
    '&timezone=auto&forecast_days=16&wind_speed_unit=kmh&precipitation_unit=mm&timeformat=unixtime';
}

async function fetchForecast(loc) { return fetchJSON(forecastUrl(loc), 15000); }
async function fetchAQI(loc) {
  const url = AQI_URL + '?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto';
  return fetchJSON(url, 10000);
}
function validForecast(j) {
  return j && j.current && j.hourly && Array.isArray(j.hourly.time) &&
    j.daily && Array.isArray(j.daily.time) && j.hourly.time.length > 0;
}

/* ============================ 10. CACHE (offline support) ============================ */
function cacheKey(loc) { return 'cache-' + loc.key + '-' + Math.round(loc.lat * 100) + '-' + Math.round(loc.lon * 100); }
function cacheSet(loc, payload) {
  try { store.set(cacheKey(loc), { time: Date.now(), w: payload.w, a: payload.a }); } catch (e) { /* quota */ }
}
function cacheGet(loc) { return store.get(cacheKey(loc), null); }

/* ============================ 11. THEME & APPEARANCE ENGINE ============================ */
function findTheme(id) {
  return BUILTIN_THEMES.find(t => t.id === id) || state.customThemes.find(t => t.id === id) || null;
}
function applyTheme(id, opts) {
  const theme = findTheme(id) || BUILTIN_THEMES[0];
  const ap = state.settings.appearance;
  ap.theme = theme.id;
  ap.colors = clone(DEFAULT_COLORS);
  ap.condColors = clone(DEFAULT_COND_COLORS);
  ap.typography = clone(DEFAULT_TYPOGRAPHY);
  ap.layout = clone(DEFAULT_LAYOUT);
  ap.effects = clone(DEFAULT_EFFECTS);
  const o = theme.overrides || {};
  if (o.colors) deepMerge(ap.colors, o.colors);
  if (o.condColors) deepMerge(ap.condColors, o.condColors);
  if (o.typography) deepMerge(ap.typography, o.typography);
  if (o.layout) deepMerge(ap.layout, o.layout);
  if (o.effects) deepMerge(ap.effects, o.effects);
  if (o.background) ap.background = deepMerge(clone(DEFAULT_BACKGROUND), o.background);
  saveSettings();
  applyAppearance();
  if (!opts || !opts.silent) toast('Theme applied: ' + theme.name, 'ok');
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex || '');
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function hexA(hex, alpha) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(alpha, 0, 1) + ')';
}

function applyAppearance() {
  const ap = state.settings.appearance;
  const r = document.documentElement.style;
  const L = ap.layout, E = ap.effects, T = ap.typography, C = ap.colors;

  r.setProperty('--bg', C.bg);
  r.setProperty('--bg2', C.bg2);
  r.setProperty('--card', C.card);
  r.setProperty('--card-alpha', E.glass);
  r.setProperty('--text', C.text);
  r.setProperty('--text2', C.text2);
  r.setProperty('--accent', C.accent);
  r.setProperty('--border', C.border);
  r.setProperty('--border-alpha', (typeof C.borderAlpha === 'number') ? C.borderAlpha : 0.14);
  r.setProperty('--btn', C.button);
  r.setProperty('--icon', C.icon);
  r.setProperty('--graph', C.graph);

  r.setProperty('--font', T.fontFamily);
  r.setProperty('--fs', T.fontSize + 'px');
  r.setProperty('--fw', T.fontWeight);
  r.setProperty('--ls', T.letterSpacing + 'em');
  r.setProperty('--lh', T.lineHeight);

  r.setProperty('--radius', L.cardRadius + 'px');
  r.setProperty('--gap', L.gap + 'px');
  r.setProperty('--pad', L.padding + 'px');
  r.setProperty('--cols', clamp(L.cols, 1, 6));
  r.setProperty('--icon-size', L.iconSize + 'px');
  r.setProperty('--temp-size', L.tempSize + 'px');
  r.setProperty('--section-gap', L.sectionGap + 'px');
  r.setProperty('--header-h', L.headerHeight + 'px');
  r.setProperty('--sidebar-w', L.sidebarWidth + 'px');

  r.setProperty('--blur', E.blur);
  r.setProperty('--shadow', E.shadow);
  r.setProperty('--opacity', E.opacity);
  r.setProperty('--transition', E.transition);
  r.setProperty('--anim-speed', E.animSpeed);

  for (const k of Object.keys(ap.condColors)) r.setProperty('--' + COND_VARS[k], ap.condColors[k]);

  document.body.classList.toggle('reduced-motion', state.settings.accessibility.reducedMotion || E.animSpeed === 0);
  document.body.classList.toggle('large-text', state.settings.accessibility.largeText);
  document.body.classList.toggle('high-contrast', state.settings.accessibility.highContrast);

  applyBackground();
  drawHourlyGraph();
  drawDetailCharts();
}

/* ============================ 12. BACKGROUND ENGINE ============================ */
function dynamicGradient(key, isDay) {
  const cc = state.settings.appearance.condColors;
  switch (key) {
    case 'clear':
      return isDay
        ? 'linear-gradient(165deg,#075985 0%,#0284c7 45%,' + cc.clear + ' 130%)'
        : 'linear-gradient(165deg,#020410 0%,#0b1026 55%,#1b1f4b 120%)';
    case 'cloudy':
      return isDay
        ? 'linear-gradient(165deg,#334155 0%,#5b6b82 60%,#7c8aa0 130%)'
        : 'linear-gradient(165deg,#0a0f1c 0%,#1c2536 70%)';
    case 'fog':
      return isDay
        ? 'linear-gradient(165deg,#475569 0%,#7b8aa0 100%)'
        : 'linear-gradient(165deg,#0d1220 0%,#232c3d 100%)';
    case 'rain':
      return isDay
        ? 'linear-gradient(165deg,#16324f 0%,#2c5578 60%,#3d6d94 130%)'
        : 'linear-gradient(165deg,#060d18 0%,#12253c 70%)';
    case 'snow':
      return isDay
        ? 'linear-gradient(165deg,#546a8a 0%,#8ba3c2 70%,#c3d5ea 140%)'
        : 'linear-gradient(165deg,#0a1224 0%,#203450 75%)';
    case 'storm':
      return isDay
        ? 'linear-gradient(165deg,#1e1b3a 0%,#39306b 60%,#4c3f8f 130%)'
        : 'linear-gradient(165deg,#0a0716 0%,#221a44 70%)';
    case 'night':
      return 'linear-gradient(165deg,#020410 0%,#0b1026 55%,#191d45 120%)';
    default:
      return 'linear-gradient(165deg,' + state.settings.appearance.colors.bg + ',' + state.settings.appearance.colors.bg2 + ')';
  }
}

const FX = { raf: 0, kind: null, parts: [], w: 0, h: 0 };
function fxResize() {
  const c = $('#fx-canvas');
  FX.w = c.width = window.innerWidth;
  FX.h = c.height = window.innerHeight;
}
function fxStop() { cancelAnimationFrame(FX.raf); FX.raf = 0; FX.kind = null; }
function fxStart(kind) {
  if (state.settings.accessibility.reducedMotion) { fxStop(); return; }
  if (FX.kind === kind && FX.raf) return;
  fxStop();
  FX.kind = kind; FX.parts = [];
  fxResize();
  const count = kind === 'rain' ? 90 : kind === 'snow' ? 70 : kind === 'stars' ? 110 : 8;
  for (let i = 0; i < count; i++) FX.parts.push(fxSpawn(kind, true));
  fxLoop();
}
function fxSpawn(kind, anywhere) {
  const w = FX.w, h = FX.h;
  if (kind === 'rain') return { x: Math.random() * w, y: anywhere ? Math.random() * h : -20, l: 12 + Math.random() * 16, v: 9 + Math.random() * 7, o: 0.12 + Math.random() * 0.22 };
  if (kind === 'snow') return { x: Math.random() * w, y: anywhere ? Math.random() * h : -10, r: 1 + Math.random() * 2.4, v: 0.5 + Math.random() * 1.1, sway: Math.random() * 2 * Math.PI, o: 0.25 + Math.random() * 0.5 };
  if (kind === 'stars') return { x: Math.random() * w, y: Math.random() * h * 0.75, r: 0.4 + Math.random() * 1.3, tw: Math.random() * 2 * Math.PI, ts: 0.5 + Math.random() * 1.5, o: 0.3 + Math.random() * 0.6 };
  return { x: Math.random() * w, y: Math.random() * h * 0.5, s: 120 + Math.random() * 220, v: 0.12 + Math.random() * 0.25, o: 0.05 + Math.random() * 0.06 };
}
function fxLoop() {
  const c = $('#fx-canvas'); if (!c) return;
  const ctx = c.getContext('2d');
  const speed = Math.max(state.settings.appearance.effects.animSpeed, 0.2);
  ctx.clearRect(0, 0, FX.w, FX.h);
  const kind = FX.kind;
  for (const p of FX.parts) {
    if (kind === 'rain') {
      p.y += p.v * speed; if (p.y > FX.h + 20) Object.assign(p, fxSpawn('rain', false));
      ctx.strokeStyle = 'rgba(174,214,255,' + p.o + ')'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + p.l); ctx.stroke();
    } else if (kind === 'snow') {
      p.sway += 0.01 * speed; p.y += p.v * speed; p.x += Math.sin(p.sway) * 0.4;
      if (p.y > FX.h + 8) Object.assign(p, fxSpawn('snow', false));
      ctx.fillStyle = 'rgba(255,255,255,' + p.o + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else if (kind === 'stars') {
      p.tw += 0.02 * p.ts * speed;
      const a = p.o * (0.55 + 0.45 * Math.sin(p.tw));
      ctx.fillStyle = 'rgba(226,232,255,' + a + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else {
      p.x += p.v * speed; if (p.x - p.s > FX.w) { p.x = -p.s; p.y = Math.random() * FX.h * 0.5; }
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s);
      g.addColorStop(0, 'rgba(255,255,255,' + p.o + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
    }
  }
  FX.raf = requestAnimationFrame(fxLoop);
}
function fxKindFor(key) {
  if (key === 'rain') return 'rain';
  if (key === 'snow') return 'snow';
  if (key === 'storm') return 'rain';
  if (key === 'night') return 'stars';
  if (key === 'cloudy') return 'clouds';
  if (key === 'fog') return 'clouds';
  if (key === 'clear') return 'clouds';
  return null;
}

function applyBackground() {
  const bg = state.settings.appearance.background;
  const layer = $('#bg-layer');
  const cur = state.weather && state.weather.current;
  const key = cur ? condKey(cur.weather_code, cur.is_day === 1) : 'cloudy';
  fxStop();

  if (bg.type === 'dynamic' && bg.dynamicOn !== false) {
    layer.style.background = dynamicGradient(key, cur ? cur.is_day === 1 : true);
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundImage = layer.style.background;
    if (state.settings.appearance.effects.gradient === false) {
      layer.style.background = hexA(state.settings.appearance.colors.bg, 1);
    }
    const kind = fxKindFor(key);
    if (kind && ['rain', 'snow', 'stars'].includes(kind)) fxStart(kind);
  } else if (bg.type === 'solid') {
    layer.style.background = bg.color;
  } else if (bg.type === 'gradient') {
    layer.style.background = 'linear-gradient(165deg,' + bg.color + ',' + bg.color2 + ')';
  } else if (bg.type === 'image' && bg.image) {
    layer.style.background = 'linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0.35)), url("' + bg.image.replace(/"/g, '%22') + '") center/cover no-repeat';
  } else if (bg.type === 'animated') {
    layer.style.background = dynamicGradient(key, cur ? cur.is_day === 1 : true);
    const kind = fxKindFor(key) || 'clouds';
    fxStart(kind === 'clouds' ? 'clouds' : kind);
  } else {
    layer.style.background = 'linear-gradient(165deg,' + state.settings.appearance.colors.bg + ',' + state.settings.appearance.colors.bg2 + ')';
  }
}

/* ============================ 13. DASHBOARD ============================ */
function buildDashboard() {
  const dash = $('#dashboard');
  dash.innerHTML = '';
  for (const conf of state.settings.dashboard) {
    if (!conf.visible) continue;
    const w = WIDGETS.find(x => x.id === conf.id);
    if (!w) continue;
    const card = document.createElement('section');
    card.className = 'widget span-' + conf.size + (conf.mode !== 'normal' ? ' ' + conf.mode : '');
    card.dataset.widget = conf.id;
    card.draggable = true;
    card.setAttribute('aria-label', w.name + ' widget');
    card.innerHTML =
      '<header class="widget-head"><button class="grip" title="Drag to reorder" aria-label="Drag ' + esc(w.name) + ' to reorder">⋮⋮</button>' +
      '<h3>' + esc(w.name) + '</h3></header>' +
      '<div class="widget-body" id="wb-' + conf.id + '"></div>';
    dash.appendChild(card);
  }
}
function widgetConf(id) { return state.settings.dashboard.find(d => d.id === id) || { visible: true, size: 'sm', mode: 'normal' }; }
function renderAllBodies() {
  for (const conf of state.settings.dashboard) {
    if (!conf.visible) continue;
    const fn = RENDERERS[conf.id];
    const body = $('#wb-' + conf.id);
    if (fn && body) {
      try { fn(body, conf); } catch (e) { body.innerHTML = '<p class="search-status">Unable to render this widget.</p>'; }
    }
  }
}
function placeholder(body, msg) { body.innerHTML = '<p class="search-status">' + esc(msg) + '</p>'; }

function statHtml(iconCode, isDay, value, label, sub) {
  return '<div class="stat"><span class="stat-icon">' + iconSvg(iconCode, isDay) + '</span>' +
    '<div><div class="stat-value">' + value + '</div><div class="stat-label">' + esc(label) + '</div>' +
    (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div></div>';
}
function extraHtml(rows) {
  return '<div class="stat-extra">' + rows.map(r => '<div class="kv"><span>' + esc(r[0]) + '</span><span>' + r[1] + '</span></div>').join('') + '</div>';
}

/* ============================ 14. WIDGET RENDERERS ============================ */
const RENDERERS = {
  current(body, conf) {
    const w = state.weather;
    if (!w) return placeholder(body, 'Loading weather…');
    const c = w.current, d = w.daily;
    const loc = currentLocation();
    const cc = state.locations.find(l => l.id === loc.key);
    const locLine = cc
      ? esc(cc.name) + (cc.region ? ', ' + esc(cc.region) : '') + (cc.country ? ' ' + flagEmoji(cc.cc) : '')
      : esc(loc.label);
    body.innerHTML =
      '<div class="current-body" id="open-detail" role="button" tabindex="0" aria-label="Open detailed weather view">' +
        '<div class="current-main">' +
          '<span class="current-icon">' + iconSvg(c.weather_code, c.is_day === 1) + '</span>' +
          '<div><div class="current-temp">' + uTemp(c.temperature_2m) + '</div>' +
          '<div class="current-cond">' + esc(wmoText(c.weather_code)) + '</div>' +
          '<div class="current-loc">' + locLine + '</div></div>' +
        '</div>' +
        '<div class="current-side">' +
          '<div class="current-hilo"><span>H: <b>' + uTemp(d.temperature_2m_max[0]) + '</b></span>' +
          '<span>L: <b>' + uTemp(d.temperature_2m_min[0]) + '</b></span></div>' +
          '<div class="current-meta">Feels like ' + uTemp(c.apparent_temperature) + ' · ' +
            uPrecip(c.precipitation) + ' precip</div>' +
          '<div class="current-meta">' + fmtDate(Math.floor(Date.now() / 1000), true) + ' · ' + fmtTime(Math.floor(Date.now() / 1000)) + ' local</div>' +
          '<div class="detail-hint">Click for full details →</div>' +
        '</div>' +
      '</div>';
  },

  feels(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const c = w.current;
    const diff = c.apparent_temperature - c.temperature_2m;
    const note = Math.abs(diff) < 1 ? 'Similar to the actual temperature'
      : diff < 0 ? 'Feels cooler than the actual temperature' : 'Feels warmer than the actual temperature';
    body.innerHTML = statHtml(2, c.is_day === 1, uTemp(c.apparent_temperature), 'Feels like', note) +
      (conf.mode === 'detailed' ? extraHtml([['Actual', uTemp(c.temperature_2m)], ['Humidity', c.relative_humidity_2m + '%'], ['Wind', uWind(c.wind_speed_10m)]]) : '');
  },

  precip(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const c = w.current;
    const next = nextHours(24);
    const popMax = next.reduce((m, i) => Math.max(m, w.hourly.precipitation_probability[i] || 0), 0);
    const sum = next.reduce((m, i) => m + (w.hourly.precipitation[i] || 0), 0);
    body.innerHTML = statHtml(61, true, uPrecip(c.precipitation), 'Precipitation now',
      'Max ' + Math.round(popMax) + '% chance in the next 24 h') +
      (conf.mode === 'detailed' ? extraHtml([['Next 24 h total', uPrecip(sum)], ['Rain', uPrecip(c.rain || 0)], ['Snowfall', uPrecip(c.snowfall || 0)]]) : '');
  },

  wind(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const c = w.current;
    body.innerHTML = statHtml(2, true, uWind(c.wind_speed_10m), 'Wind', compass(c.wind_direction_10m)) +
      (conf.mode === 'detailed' ? extraHtml([['Gusts', uWind(c.wind_gusts_10m)], ['Direction', Math.round(c.wind_direction_10m) + '°'], ['Today max', uWind(w.daily.wind_gusts_10m_max[0]) + ' gusts']]) :
       conf.mode === 'compact' ? '' : '<div class="stat-sub" style="margin-top:8px">Gusts ' + uWind(c.wind_gusts_10m) + '</div>');
  },

  humidity(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const c = w.current;
    const note = c.relative_humidity_2m >= 70 ? 'Humid' : c.relative_humidity_2m >= 40 ? 'Comfortable' : 'Dry';
    body.innerHTML = statHtml(3, true, c.relative_humidity_2m + '%', 'Humidity', note) +
      (conf.mode === 'detailed' ? extraHtml([['Dew feel', c.relative_humidity_2m >= 60 ? 'Muggy' : 'Pleasant'], ['Cloud cover', w.current.cloud_cover + '%']]) : '');
  },

  pressure(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const c = w.current;
    const h = w.hourly, i0 = nowHourIndex();
    const trend = (h.pressure_msl && i0 > 0) ? h.pressure_msl[i0] - h.pressure_msl[Math.max(0, i0 - 3)] : 0;
    body.innerHTML = statHtml(3, true, uPressure(c.pressure_msl), 'Pressure',
      trend > 0.4 ? 'Rising' : trend < -0.4 ? 'Falling' : 'Steady');
  },

  uv(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const i = nowHourIndex();
    const nowUv = w.hourly.uv_index ? w.hourly.uv_index[i] : null;
    const maxUv = w.daily.uv_index_max ? w.daily.uv_index_max[0] : null;
    const lvl = uvLevel(nowUv != null ? nowUv : 0);
    body.innerHTML = statHtml(0, true, nowUv != null ? nowUv.toFixed(1) : '—', 'UV index (now)', lvl.label) +
      (conf.mode !== 'compact' ? extraHtml([['Today max', maxUv != null ? maxUv.toFixed(1) + ' — ' + uvLevel(maxUv).label : '—']]) : '');
  },

  visibility(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const i = nowHourIndex();
    const v = w.hourly.visibility ? w.hourly.visibility[i] / 1000 : null;
    body.innerHTML = statHtml(45, true, uVis(v), 'Visibility',
      v == null ? '' : v >= 10 ? 'Excellent' : v >= 5 ? 'Good' : v >= 2 ? 'Moderate' : 'Poor');
  },

  cloud(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    body.innerHTML = statHtml(3, true, w.current.cloud_cover + '%', 'Cloud cover',
      w.current.cloud_cover >= 80 ? 'Overcast' : w.current.cloud_cover >= 40 ? 'Scattered clouds' : w.current.cloud_cover >= 10 ? 'Mostly clear' : 'Clear skies');
  },

  sun(body, conf) {
    const w = state.weather; if (!w) return placeholder(body, 'Loading…');
    const sr = w.daily.sunrise[0], ss = w.daily.sunset[0];
    const now = Math.floor(Date.now() / 1000);
    const frac = clamp((now - sr) / (ss - sr), 0, 1);
    const x = 20 + frac * 260, y = 95 - Math.sin(frac * Math.PI) * 70;
    const up = now >= sr && now <= ss;
    body.innerHTML =
      '<div class="sun-arc-wrap" role="img" aria-label="Sun position">' +
      '<svg viewBox="0 0 300 110" preserveAspectRatio="none">' +
        '<path d="M20 95 A 130 130 0 0 1 280 95" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2" stroke-dasharray="4 5"/>' +
        '<path d="M20 95 A 130 130 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + '" fill="none" stroke="var(--cc-clear)" stroke-width="2.5"/>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7" fill="var(--cc-clear)"/>' +
        '<line x1="6" y1="95" x2="294" y2="95" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>' +
      '</svg></div>' +
      '<div class="sun-times"><div><span>Sunrise</span><b>' + fmtTime(sr) + '</b></div>' +
      '<div style="text-align:right"><span>Sunset</span><b>' + fmtTime(ss) + '</b></div></div>' +
      (conf.mode === 'detailed' ? '<div class="stat-sub" style="margin-top:8px">Day length: ' + fmtDuration(ss - sr) + (up ? ' · Sun is up' : ' · Sun is down') + '</div>' : '');
  },

  moon(body, conf) {
    const m = moonInfo(Date.now());
    body.innerHTML = statHtml(0, false, Math.round(m.illumination * 100) + '%', 'Moon illumination', m.name);
  },

  aqi(body, conf) {
    const a = state.aqi;
    if (!a || !a.current || a.current.us_aqi == null) return placeholder(body, 'Air quality unavailable for this location.');
    const c = a.current, lvl = aqiLevel(c.us_aqi);
    const pol = [['PM2.5', c.pm2_5, 'µg/m³'], ['PM10', c.pm10, 'µg/m³'], ['Ozone', c.ozone, 'µg/m³'], ['NO₂', c.nitrogen_dioxide, 'µg/m³']];
    body.innerHTML =
      '<div class="stat"><span class="stat-icon">' + iconSvg(0, true) + '</span>' +
      '<div><div class="stat-value">' + Math.round(c.us_aqi) + '</div><div class="stat-label">US AQI</div></div>' +
      '<span class="aqi-badge" style="--aqi-color:' + lvl.color + ';margin-left:auto">' + lvl.label + '</span></div>' +
      '<div class="aqi-scale" aria-hidden="true">' +
        ['#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#7f1d1d'].map(col => '<i style="background:' + col + '"></i>').join('') +
      '</div>' +
      (conf.mode !== 'compact' ? '<div class="aqi-pollutants">' + pol.map(p =>
        '<div class="kv"><span>' + p[0] + '</span><span>' + (p[1] == null ? '—' : Math.round(p[1]) + ' ' + p[2]) + '</span></div>').join('') + '</div>' : '');
  },

  location(body) {
    const loc = currentLocation();
    const saved = state.locations.find(l => l.id === loc.key);
    const tz = state.weather ? state.weather.timezone : (saved && saved.tz) || '—';
    body.innerHTML =
      '<div class="loc-line"><span>Place</span><span>' + esc(loc.label) + (saved && saved.cc ? ' ' + flagEmoji(saved.cc) : '') + '</span></div>' +
      '<div class="loc-line"><span>Region</span><span>' + esc(saved && saved.region || '—') + '</span></div>' +
      '<div class="loc-line"><span>Country</span><span>' + esc(saved && saved.country || '—') + '</span></div>' +
      '<div class="loc-line"><span>Coordinates</span><span>' + loc.lat.toFixed(3) + ', ' + loc.lon.toFixed(3) + '</span></div>' +
      '<div class="loc-line"><span>Time zone</span><span>' + esc(tz) + '</span></div>' +
      '<div class="loc-line"><span>Elevation</span><span>' + (state.weather && state.weather.elevation != null ? Math.round(state.weather.elevation) + ' m' : '—') + '</span></div>';
  },

  updated(body) {
    const t = state.lastLoad ? state.lastLoad : (cacheGet(currentLocation()) || {}).time;
    body.innerHTML = statHtml(2, true, t ? fmtTime(Math.floor(t / 1000)) : '—', 'Last updated',
      (state.source === 'cached' ? 'Cached data' : 'Live data') + (t ? ' · ' + fmtDate(Math.floor(t / 1000)) : ''));
  },

  hourly(body) { renderHourly(body); },
  daily(body) { renderDaily(body); }
};

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h + ' h ' + m + ' min';
}
function nowHourIndex() {
  const w = state.weather;
  if (!w) return 0;
  const now = Math.floor(Date.now() / 1000);
  const times = w.hourly.time;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < now) lo = mid + 1; else hi = mid; }
  return clamp(lo, 0, times.length - 1);
}
function nextHours(n) {
  const w = state.weather; if (!w) return [];
  const i0 = nowHourIndex();
  const out = [];
  for (let i = i0; i < Math.min(w.hourly.time.length, i0 + n); i++) out.push(i);
  return out;
}

/* ============================ 15. HOURLY FORECAST ============================ */
function renderHourly(body) {
  const w = state.weather;
  const s = state.settings.hourly;
  if (!w) return placeholder(body, 'Loading hourly forecast…');

  const idxs = nextHours(s.count === 'all' ? 384 : s.count);
  const metricToggles = [['temp', 'Temperature'], ['feels', 'Feels like'], ['precip', 'Precipitation'], ['wind', 'Wind'], ['uv', 'UV']];

  let html = '<div class="hourly-controls">' +
    '<div class="seg" role="group" aria-label="Hours to display">' +
      [[12, '12 h'], [24, '24 h'], [48, '48 h'], ['all', 'All']].map(v =>
        '<button data-hcount="' + v[0] + '" class="' + (String(s.count) === String(v[0]) ? 'on' : '') + '" aria-pressed="' + (String(s.count) === String(v[0])) + '">' + v[1] + '</button>').join('') +
    '</div>' +
    '<label class="metric-toggles" style="margin-left:auto"><input type="checkbox" data-hgraph ' + (s.graph ? 'checked' : '') + '> Graph</label>' +
    '<div class="metric-toggles" role="group" aria-label="Graph metrics">' +
      metricToggles.map(m => '<label><input type="checkbox" data-hmetric="' + m[0] + '" ' + (s.metrics.includes(m[0]) ? 'checked' : '') + '> ' + m[1] + '</label>').join('') +
    '</div></div>';

  if (s.graph && s.metrics.length) html += '<div class="hourly-graph-wrap"><canvas class="graph" id="hourly-graph" aria-label="Hourly graph"></canvas></div>';

  html += '<div class="hours-scroll" tabindex="0" aria-label="Hourly forecast">';
  for (const i of idxs) {
    const t = w.hourly.time[i];
    const isNow = i === nowHourIndex();
    html += '<div class="hour-card' + (isNow ? ' now' : '') + '">' +
      '<span class="hour-time">' + (isNow ? 'Now' : fmtHour(t)) + '</span>' +
      '<span class="hour-icon">' + iconSvg(w.hourly.weather_code[i], w.hourly.is_day[i] === 1) + '</span>' +
      '<span class="hour-temp">' + uTemp(w.hourly.temperature_2m[i]) + '</span>' +
      '<span class="hour-sub"><span class="pop">' + (w.hourly.precipitation_probability ? Math.round(w.hourly.precipitation_probability[i]) + '%' : '—') + '</span> · ' + uPrecip(w.hourly.precipitation[i]) + '</span>' +
      '<span class="hour-sub wind">' + uWind(w.hourly.wind_speed_10m[i]) + '</span>' +
      (w.hourly.uv_index && w.hourly.uv_index[i] != null ? '<span class="hour-sub">UV ' + Number(w.hourly.uv_index[i]).toFixed(0) + '</span>' : '') +
      '</div>';
  }
  html += '</div>';
  body.innerHTML = html;
  drawHourlyGraph();
}

function drawChart(canvas, series, opts) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const padL = 8, padR = 8, padT = 12, padB = 18;
  const o = opts || {};
  const n = (series[0] && series[0].data.length) || 0;
  if (!n) return;
  const x = i => padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1));

  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const y = padT + (H - padT - padB) * g / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }

  for (const s of series) {
    if (s.type === 'bar') {
      const maxV = Math.max(0.001, ...s.data);
      const bw = Math.max(2, (W - padL - padR) / n * 0.55);
      ctx.fillStyle = s.color;
      for (let i = 0; i < n; i++) {
        const h = (H - padT - padB) * (s.data[i] / maxV) * 0.9;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x(i) - bw / 2, H - padB - h, bw, h);
      }
      ctx.globalAlpha = 1;
      continue;
    }
    const vals = s.data.filter(v => v != null);
    if (!vals.length) continue;
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    min -= (max - min) * 0.12; max += (max - min) * 0.12;
    const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
    if (s.fill) {
      const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
      grad.addColorStop(0, s.color + '55'); grad.addColorStop(1, s.color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(x(0), H - padB);
      for (let i = 0; i < n; i++) ctx.lineTo(x(i), y(s.data[i]));
      ctx.lineTo(x(n - 1), H - padB); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const px = x(i), py = y(s.data[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    ctx.fillStyle = s.color; ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    const maxI = s.data.indexOf(Math.max(...s.data)), minI = s.data.indexOf(Math.min(...s.data));
    ctx.fillText(Math.round(Math.max(...vals)), clamp(x(maxI) + 4, 0, W - 26), clamp(y(s.data[maxI]) - 4, 10, H - 4));
    ctx.fillText(Math.round(Math.min(...vals)), clamp(x(minI) + 4, 0, W - 26), clamp(y(s.data[minI]) + 12, 10, H - 4));
  }
}

function drawHourlyGraph() {
  const canvas = $('#hourly-graph');
  if (!canvas || !state.weather) return;
  const w = state.weather, s = state.settings.hourly;
  const idxs = nextHours(s.count === 'all' ? 96 : Math.min(s.count, 96));
  const colors = {
    temp: getComputedStyle(document.documentElement).getPropertyValue('--graph').trim() || '#4cc2ff',
    feels: '#f472b6', precip: '#60a5fa', wind: '#34d399', uv: '#fbbf24'
  };
  const series = [];
  const pick = arr => idxs.map(i => arr && arr[i] != null ? arr[i] : null);
  if (s.metrics.includes('temp')) series.push({ label: 'Temp', color: colors.temp, data: pick(w.hourly.temperature_2m), fill: true });
  if (s.metrics.includes('feels')) series.push({ label: 'Feels', color: colors.feels, data: pick(w.hourly.apparent_temperature) });
  if (s.metrics.includes('precip')) series.push({ label: 'Precip', color: colors.precip, data: pick(w.hourly.precipitation), type: 'bar' });
  if (s.metrics.includes('wind')) series.push({ label: 'Wind', color: colors.wind, data: pick(w.hourly.wind_speed_10m) });
  if (s.metrics.includes('uv')) series.push({ label: 'UV', color: colors.uv, data: pick(w.hourly.uv_index) });
  drawChart(canvas, series.filter(s2 => s2.data.some(v => v != null)), {});
}

/* ============================ 16. DAILY FORECAST ============================ */
function renderDaily(body) {
  const w = state.weather;
  if (!w) return placeholder(body, 'Loading daily forecast…');
  const n = clamp(state.settings.dailyCount || 7, 1, w.daily.time.length);
  const d = w.daily;
  const weekMin = Math.min(...d.temperature_2m_min.slice(0, n));
  const weekMax = Math.max(...d.temperature_2m_max.slice(0, n));
  const span = Math.max(1, weekMax - weekMin);

  let html = '<div class="daily-controls"><label style="font-size:0.85em;color:var(--text2)">Days: <select data-dailycount>' +
    [7, 10, 14, 16].map(v => '<option value="' + v + '"' + (n === v ? ' selected' : '') + '>' + v + '</option>').join('') +
    '</select></label></div>';

  html += '<div class="day-list">';
  for (let i = 0; i < n; i++) {
    const t = d.time[i];
    const lo = (d.temperature_2m_min[i] - weekMin) / span, hi = (d.temperature_2m_max[i] - weekMin) / span;
    const dl = d.sunset[i] - d.sunrise[i];
    html +=
      '<div class="day-card" data-day="' + i + '">' +
        '<button class="day-row" aria-expanded="false">' +
          '<span class="day-name">' + fmtDayName(t, i) + '<small>' + fmtDate(t) + '</small></span>' +
          '<span class="day-icon">' + iconSvg(d.weather_code[i], true) + '</span>' +
          '<span class="day-cond">' + esc(wmoText(d.weather_code[i])) + '</span>' +
          '<span class="day-pop">' + (d.precipitation_probability_max ? Math.round(d.precipitation_probability_max[i]) + '%' : '—') + ' 💧</span>' +
          '<span class="day-temps"><span class="day-low">' + uTemp(d.temperature_2m_min[i]) + '</span>' +
            '<span class="day-temp-bar"><i style="left:' + (lo * 100).toFixed(1) + '%;width:' + Math.max(4, (hi - lo) * 100).toFixed(1) + '%"></i></span>' +
            '<span class="day-high">' + uTemp(d.temperature_2m_max[i]) + '</span></span>' +
          '<span class="day-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="day-detail"><div class="day-detail-grid">' +
          '<div class="kv"><span>Feels like</span><span>' + uTemp(d.apparent_temperature_min[i]) + ' / ' + uTemp(d.apparent_temperature_max[i]) + '</span></div>' +
          '<div class="kv"><span>Precipitation</span><span>' + (d.precipitation_probability_max ? Math.round(d.precipitation_probability_max[i]) + '%' : '—') + ' · ' + uPrecip(d.precipitation_sum[i]) + '</span></div>' +
          '<div class="kv"><span>Rain / Snow</span><span>' + uPrecip(d.rain_sum[i]) + ' / ' + uPrecip(d.snowfall_sum[i]) + '</span></div>' +
          '<div class="kv"><span>Wind max</span><span>' + uWind(d.wind_speed_10m_max[i]) + '</span></div>' +
          '<div class="kv"><span>Gusts max</span><span>' + uWind(d.wind_gusts_10m_max[i]) + '</span></div>' +
          '<div class="kv"><span>UV max</span><span>' + (d.uv_index_max ? d.uv_index_max[i].toFixed(1) + ' — ' + uvLevel(d.uv_index_max[i]).label : '—') + '</span></div>' +
          '<div class="kv"><span>Sunrise</span><span>' + fmtTime(d.sunrise[i]) + '</span></div>' +
          '<div class="kv"><span>Sunset</span><span>' + fmtTime(d.sunset[i]) + '</span></div>' +
          '<div class="kv"><span>Day length</span><span>' + fmtDuration(dl) + '</span></div>' +
        '</div></div>' +
      '</div>';
  }
  html += '</div>';
  body.innerHTML = html;
}

/* ============================ 17. DETAIL MODAL ============================ */
function openDetail() {
  const w = state.weather;
  if (!w) return;
  const c = w.current, d = w.daily, i = nowHourIndex();
  const vis = w.hourly.visibility ? w.hourly.visibility[i] / 1000 : null;
  const uvNow = w.hourly.uv_index ? w.hourly.uv_index[i] : null;
  const sr = d.sunrise[0], ss = d.sunset[0];
  const sec = (title, rows) =>
    '<div class="detail-section"><h4>' + esc(title) + '</h4>' +
    rows.map(r => '<div class="kv"><span>' + esc(r[0]) + '</span><span>' + r[1] + '</span></div>').join('') + '</div>';

  $('#detail-content').innerHTML =
    '<div class="detail-grid">' +
      sec('Temperature', [['Current', uTemp(c.temperature_2m, true)], ['Feels like', uTemp(c.apparent_temperature, true)],
        ['Today high', uTemp(d.temperature_2m_max[0], true)], ['Today low', uTemp(d.temperature_2m_min[0], true)]]) +
      sec('Atmosphere', [['Humidity', c.relative_humidity_2m + '%'], ['Pressure', uPressure(c.pressure_msl)],
        ['Cloud cover', c.cloud_cover + '%'], ['Visibility', uVis(vis)]]) +
      sec('Wind', [['Speed', uWind(c.wind_speed_10m)], ['Direction', compass(c.wind_direction_10m)],
        ['Gusts', uWind(c.wind_gusts_10m)], ['Today max gusts', uWind(d.wind_gusts_10m_max[0])]]) +
      sec('Precipitation', [['Right now', uPrecip(c.precipitation)], ['Rain', uPrecip(c.rain || 0)],
        ['Snowfall', uPrecip(c.snowfall || 0)], ['Cloud cover', c.cloud_cover + '%']]) +
      sec('Sun', [['Sunrise', fmtTime(sr)], ['Sunset', fmtTime(ss)], ['Day length', fmtDuration(ss - sr)]]) +
      sec('UV', [['Current', uvNow != null ? uvNow.toFixed(1) : '—'], ['Level', uvLevel(uvNow || 0).label],
        ['Today maximum', d.uv_index_max ? d.uv_index_max[0].toFixed(1) : '—']]) +
    '</div>' +
    '<div class="chart-title">Next 24 hours — temperature & precipitation</div>' +
    '<canvas class="detail-chart" id="detail-chart-temp"></canvas>' +
    '<canvas class="detail-chart" id="detail-chart-precip" style="height:90px"></canvas>';
  openModal('detail-modal');
  drawDetailCharts();
}
function drawDetailCharts() {
  if ($('#detail-modal').classList.contains('hidden') || !state.weather) return;
  const w = state.weather;
  const idxs = nextHours(24);
  const graphCol = getComputedStyle(document.documentElement).getPropertyValue('--graph').trim() || '#4cc2ff';
  const t = $('#detail-chart-temp'), p = $('#detail-chart-precip');
  if (t) drawChart(t, [{ label: 'Temp', color: graphCol, data: idxs.map(i2 => w.hourly.temperature_2m[i2]), fill: true }], { legend: false });
  if (p) drawChart(p, [{ label: 'Precip', color: '#60a5fa', data: idxs.map(i2 => w.hourly.precipitation[i2]), type: 'bar' }], { legend: false });
}

/* ============================ 18. MODAL HELPERS ============================ */
function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
function anyModalOpen() { return $$('.modal').some(m => !m.classList.contains('hidden')); }
