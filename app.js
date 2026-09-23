'use strict';
/* ============================================================================
   NEXORA WEATHER — app.js
   A fully customizable weather application.
   Data sources (free, no API key required):
     - Open-Meteo Forecast API      https://api.open-meteo.com
     - Open-Meteo Geocoding API     https://georaphy-api... (see below)
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
    if (!res.ok) {
      /* Open-Meteo returns a JSON body like {"error":true,"reason":"..."} on 4xx —
         surface that reason instead of a bare status code so real bugs are visible. */
      let reason = '';
      try { const body = await res.json(); reason = body && body.reason ? body.reason : ''; }
      catch (e) { /* body wasn't JSON — ignore */ }
      throw new Error('HTTP ' + res.status + (reason ? ': ' + reason : ''));
    }
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
/* A theme = named set of appearance overrides. Users can also create,
   duplicate, rename, export and import their own themes. */
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
  settings: null,        // merged settings object
  customThemes: [],      // user-created themes
  locations: [],         // saved locations
  activeLoc: null,       // location id | 'gps'
  gps: null,             // { lat, lon, label }
  weather: null,         // last forecast payload
  aqi: null,             // last air-quality payload
  loading: false,
  source: 'live',        // 'live' | 'cached'
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
  /* make sure any new widgets get added at the end */
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
/* time zone used for weather display: location tz ('auto') or device tz */
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

/* moon phase — simple synodic-month calculation (no external API needed) */
function moonInfo(dateMs) {
  const synodic = 29.53058867;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = ((dateMs - ref) / 86400000) % synodic;
  const phase = ((days % synodic) + synodic) % synodic; // 0..29.53 days since new moon
  const illum = (1 - Math.cos(2 * Math.PI * phase / synodic)) / 2;
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const idx = Math.floor(((phase / synodic) * 8) + 0.5) % 8;
  return { phase, illumination: illum, name: names[idx] };
}

/* ============================ 7. SVG ICON SYSTEM ============================ */
/* Lightweight hand-drawn stroke icons, mapped from Open-Meteo WMO codes.
   Day/night variants included where relevant. */
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
  if (code === 1) return isDay === false ? 'moon-cloud' : 'sun-cloud';
  if (code === 2) return isDay === false ? 'moon-cloud' : 'sun-cloud';
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
  /* first-run fallback: New York City */
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
function forecastUrl(loc) {
  return FORECAST_URL +
    '?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,snowfall,weather_code,cloud_cover,visibility,pressure_msl,surface_pressure,wind_speed_10m,wind_gusts_10m,uv_index,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,rain_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max' +
    '&timezone=auto&forecast_days=16&wind_speed_unit=kmh&precipitation_unit=mm&timeformat=unix';
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
  try { store.set(cacheKey(loc), { time: Date.now(), w: payload.w, a: payload.a }); } catch (e) { /* quota — non-fatal */ }
}
function cacheGet(loc) { return store.get(cacheKey(loc), null); }

/* ============================ 11. THEME & APPEARANCE ENGINE ============================ */
function findTheme(id) {
  return BUILTIN_THEMES.find(t => t.id === id) || state.customThemes.find(t => t.id === id) || null;
}
/* Apply a theme = reset appearance to defaults, then merge theme overrides. */
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

/* write every setting into CSS custom properties — the whole UI restyles live */
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
/* Handles: dynamic (weather based, toggleable), solid, gradient, image,
   and a lightweight animated canvas (rain / snow / stars / clouds). */
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
  /* clouds */
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
    } else { /* clouds */
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
    /* subtle ambient particles for the current condition (cheap, capped) */
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
    /* dynamic switched off */
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
      '<header class="widget-head"><button class="grip" title="Drag to reorder (or use Dashboard settings)" aria-label="Drag ' + esc(w.name) + ' to reorder">⋮⋮</button>' +
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
  updateClock();
}
function placeholder(body, msg) { body.innerHTML = '<p class="search-status">' + esc(msg) + '</p>'; }

/* small stat widget helper */
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
      (conf.mode === 'detailed' ? extraHtml([['Next 24 h total', uPrecip(sum)], ['Rain', uPrecip(c.rain || 0)], ['Snowfall', uPrecip(c.snowfall || 0) + (state.settings.units.precip === 'mm' ? '' : '')]]) : '');
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
    const c = w.current;
    /* uv_index is hourly — find current hour */
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
      '<div class="sun-arc-wrap" role="img" aria-label="Sun position: ' + Math.round(frac * 100) + '% through the day">' +
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
    const w = state.weather;
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

  html += '<div class="hours-scroll" tabindex="0" aria-label="Hourly forecast, horizontally scrollable">';
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

/* generic small line/bar chart on canvas (no external libraries) */
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

  /* grid lines */
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
    /* area fill */
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
    /* min / max labels */
    ctx.fillStyle = s.color; ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    const maxI = s.data.indexOf(Math.max(...s.data)), minI = s.data.indexOf(Math.min(...s.data));
    ctx.fillText(Math.round(Math.max(...vals)), clamp(x(maxI) + 4, 0, W - 26), clamp(y(s.data[maxI]) - 4, 10, H - 4));
    ctx.fillText(Math.round(Math.min(...vals)), clamp(x(minI) + 4, 0, W - 26), clamp(y(s.data[minI]) + 12, 10, H - 4));
  }
  /* legend */
  if (o.legend !== false) {
    ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    let lx = padL;
    const ly = H - 5;
    for (const s of series) {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 7, 8, 3);
      ctx.fillText(s.label, lx + 12, ly - 3);
      lx += 12 + ctx.measureText(s.label).width + 14;
    }
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
  if (s.metrics.includes('temp')) series.push({ label: state.settings.units.temp === 'f' ? 'Temp °F' : 'Temp °C', color: colors.temp, data: pick(w.hourly.temperature_2m), fill: true });
  if (s.metrics.includes('feels')) series.push({ label: 'Feels', color: colors.feels, data: pick(w.hourly.apparent_temperature) });
  if (s.metrics.includes('precip')) series.push({ label: 'Precip mm', color: colors.precip, data: pick(w.hourly.precipitation), type: 'bar' });
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
    [7, 10, 14, 16].map(v => '<option value="' + v + '"' + (n === Math.min(v, d.daily ? 16 : 16) || n === v ? ' selected' : '') + '>' + v + '</option>').join('') +
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
  if (t) drawChart(t, [{ label: state.settings.units.temp === 'f' ? 'Temp °F' : 'Temp °C', color: graphCol, data: idxs.map(i2 => w.hourly.temperature_2m[i2]), fill: true }], { legend: false });
  if (p) drawChart(p, [{ label: 'Precip mm', color: '#60a5fa', data: idxs.map(i2 => w.hourly.precipitation[i2]), type: 'bar' }], { legend: false });
}

/* ============================ 18. MODAL HELPERS ============================ */
function openModal(id) {
  $('#' + id).classList.remove('hidden');
  const panel = $('#' + id + ' .modal-panel');
  if (panel) { const btn = $('.modal-head .icon-btn', panel); if (btn) btn.focus(); }
}
function closeModal(id) { $('#' + id).classList.add('hidden'); }
function anyModalOpen() { return $$('.modal').some(m => !m.classList.contains('hidden')); }

/* ============================ 19. SETTINGS PANEL ============================ */
const SETTINGS_CATS = [
  ['general', 'General', 'M3 12h18M12 3v18'],
  ['appearance', 'Appearance', 'M12 3a9 9 0 1 0 9 9c-2-1-3-3-3-5s1-4 3-5a9 9 0 0 0-9 1z'],
  ['dashboard', 'Dashboard', 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z'],
  ['units', 'Units', 'M4 7h16M4 7l4 13M8 7L4 20M6.5 14h3M20 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM17 6v4'],
  ['time', 'Time & Date', 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  ['accessibility', 'Accessibility', 'M12 4a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 12 4zM4 9l7 1 7-1M12 10v5l-3 6M12 15l3 6'],
  ['data', 'Data', 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  ['about', 'About', 'M12 8h.01M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z']
];

function buildSettingsNav() {
  $('#settings-nav').innerHTML = SETTINGS_CATS.map(c =>
    '<button data-cat="' + c[0] + '" class="' + (state.activeCat === c[0] ? 'on' : '') + '" aria-current="' + (state.activeCat === c[0]) + '">' +
    '<svg class="nav-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + c[2] + '"/></svg>' + c[1] + '</button>').join('');
}
function openSettings(cat) {
  state.activeCat = cat || state.activeCat;
  buildSettingsNav();
  renderSettingsContent();
  openModal('settings-modal');
}

/* ----- customization control definitions ----- */
const FONT_OPTIONS = [
  ['Inter, system-ui, -apple-system, sans-serif', 'Inter (modern)'],
  ["'Space Grotesk', system-ui, sans-serif", 'Space Grotesk'],
  ["'JetBrains Mono', ui-monospace, monospace", 'JetBrains Mono'],
  ["Georgia, 'Times New Roman', serif", 'Georgia (serif)'],
  ["'Trebuchet MS', Verdana, sans-serif", 'Trebuchet'],
  ["'Segoe UI', Tahoma, sans-serif", 'Segoe UI'],
  ['custom', 'Custom…']
];
const CONTROL_GROUPS = [
  { title: 'Colors', note: 'Card color is combined with the “Glass opacity” effect below.', controls: [
    { p: 'appearance.colors.bg', l: 'Background', t: 'color' },
    { p: 'appearance.colors.bg2', l: 'Secondary background', t: 'color' },
    { p: 'appearance.colors.card', l: 'Cards', t: 'color' },
    { p: 'appearance.colors.text', l: 'Text', t: 'color' },
    { p: 'appearance.colors.text2', l: 'Secondary text', t: 'color' },
    { p: 'appearance.colors.accent', l: 'Accent', t: 'color' },
    { p: 'appearance.colors.border', l: 'Borders', t: 'color' },
    { p: 'appearance.colors.button', l: 'Buttons', t: 'color' },
    { p: 'appearance.colors.icon', l: 'Icons', t: 'color' },
    { p: 'appearance.colors.graph', l: 'Graphs', t: 'color' }
  ]},
  { title: 'Weather-condition colors', note: 'Used to tint icons and dynamic weather backgrounds.', controls: [
    { p: 'appearance.condColors.clear', l: 'Clear', t: 'color' },
    { p: 'appearance.condColors.cloudy', l: 'Cloudy', t: 'color' },
    { p: 'appearance.condColors.rain', l: 'Rain', t: 'color' },
    { p: 'appearance.condColors.snow', l: 'Snow', t: 'color' },
    { p: 'appearance.condColors.storm', l: 'Storm', t: 'color' },
    { p: 'appearance.condColors.fog', l: 'Fog', t: 'color' },
    { p: 'appearance.condColors.night', l: 'Night', t: 'color' }
  ]},
  { title: 'Typography', controls: [
    { p: 'appearance.typography.fontFamily', l: 'Font family', t: 'select', options: FONT_OPTIONS },
    { p: 'appearance.typography.fontSize', l: 'Font size (px)', t: 'range', min: 12, max: 22, step: 1 },
    { p: 'appearance.typography.fontWeight', l: 'Font weight', t: 'range', min: 300, max: 800, step: 100 },
    { p: 'appearance.typography.letterSpacing', l: 'Letter spacing (em)', t: 'range', min: -0.5, max: 3, step: 0.1 },
    { p: 'appearance.typography.lineHeight', l: 'Line height', t: 'range', min: 1.1, max: 2, step: 0.05 }
  ]},
  { title: 'Layout', controls: [
    { p: 'appearance.layout.cols', l: 'Grid columns', t: 'range', min: 1, max: 6, step: 1 },
    { p: 'appearance.layout.cardRadius', l: 'Card radius (px)', t: 'range', min: 0, max: 32, step: 1 },
    { p: 'appearance.layout.gap', l: 'Spacing / gap (px)', t: 'range', min: 4, max: 40, step: 1 },
    { p: 'appearance.layout.padding', l: 'Card padding (px)', t: 'range', min: 8, max: 40, step: 1 },
    { p: 'appearance.layout.iconSize', l: 'Weather icon size (px)', t: 'range', min: 16, max: 96, step: 1 },
    { p: 'appearance.layout.tempSize', l: 'Temperature size (px)', t: 'range', min: 28, max: 120, step: 1 },
    { p: 'appearance.layout.sectionGap', l: 'Section spacing (px)', t: 'range', min: 8, max: 64, step: 1 },
    { p: 'appearance.layout.cardHeight', l: 'Card height (px, 0 = auto)', t: 'range', min: 0, max: 400, step: 2 },
    { p: 'appearance.layout.cardWidth', l: 'Card width (px, 0 = auto)', t: 'range', min: 0, max: 640, step: 4 },
    { p: 'appearance.layout.headerHeight', l: 'Header height (px)', t: 'range', min: 48, max: 96, step: 1 },
    { p: 'appearance.layout.sidebarWidth', l: 'Settings sidebar (px)', t: 'range', min: 180, max: 360, step: 4 }
  ]},
  { title: 'Effects', controls: [
    { p: 'appearance.effects.blur', l: 'Glass blur (px)', t: 'range', min: 0, max: 40, step: 1 },
    { p: 'appearance.effects.glass', l: 'Glass opacity', t: 'range', min: 0, max: 0.6, step: 0.01 },
    { p: 'appearance.effects.shadow', l: 'Shadow strength', t: 'range', min: 0, max: 1, step: 0.02 },
    { p: 'appearance.effects.opacity', l: 'Widget opacity', t: 'range', min: 0.5, max: 1, step: 0.02 },
    { p: 'appearance.effects.transition', l: 'Transition speed (s)', t: 'range', min: 0, max: 1, step: 0.05 },
    { p: 'appearance.effects.animSpeed', l: 'Animation speed', t: 'range', min: 0, max: 2, step: 0.1 },
    { p: 'appearance.effects.gradient', l: 'Gradient backgrounds', t: 'toggle' }
  ]}
];

function ctlRow(c) {
  const val = getPath(state.settings, c.p);
  const defVal = getPath(DEFAULTS, c.p);
  let input;
  if (c.t === 'color') {
    input = '<input type="color" data-ctl="' + c.p + '" value="' + (/^#([a-f\d]{6})$/i.test(val) ? val : '#888888') + '" aria-label="' + esc(c.l) + '">';
  } else if (c.t === 'range') {
    input = '<input type="range" data-ctl="' + c.p + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + val + '" aria-label="' + esc(c.l) + '">' +
      '<span class="ctl-val">' + val + '</span>';
  } else if (c.t === 'select') {
    input = '<select data-ctl="' + c.p + '" aria-label="' + esc(c.l) + '">' +
      c.options.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    if (c.p === 'appearance.typography.fontFamily' && !FONT_OPTIONS.some(o => o[0] === val)) {
      input += '<input type="text" data-ctl-customfont value="' + esc(val) + '" placeholder="e.g. Arial, sans-serif" aria-label="Custom font family" style="margin-top:6px;max-width:210px">';
    }
  } else if (c.t === 'toggle') {
    input = '<span class="switch"><input type="checkbox" data-ctl="' + c.p + '"' + (val ? ' checked' : '') + ' aria-label="' + esc(c.l) + '"><i></i></span>';
  } else {
    input = '<input type="text" data-ctl="' + c.p + '" value="' + esc(val) + '" aria-label="' + esc(c.l) + '">';
  }
  return '<div class="set-row"><label>' + esc(c.l) + '</label><div class="ctl">' + input +
    '<button class="ctl-reset" data-reset="' + c.p + '" title="Reset “' + esc(c.l) + '” to default" aria-label="Reset ' + esc(c.l) + ' to default">⟲</button></div></div>';
}

function renderSettingsContent() {
  const cat = state.activeCat;
  const el = $('#settings-content');
  const S = state.settings;

  if (cat === 'general') {
    el.innerHTML = '<h3>General</h3>' +
      setRow('Auto-refresh interval', '<select data-set="general.refreshMinutes">' +
        [[0, 'Disabled'], [5, 'Every 5 minutes'], [10, 'Every 10 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour']]
          .map(o => '<option value="' + o[0] + '"' + (S.general.refreshMinutes === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Ask for my location on start-up', switchHtml('general.startGeolocate', S.general.startGeolocate)) +
      '<p class="group-note">You can always set your location manually from the search box — geolocation is optional.</p>';
  }

  else if (cat === 'appearance') {
    const bg = S.appearance.background;
    el.innerHTML = '<h3>Theme</h3>' +
      '<div class="set-row"><label>Active theme</label><div class="ctl">' +
        '<select data-set="appearance.theme">' +
          BUILTIN_THEMES.map(t => '<option value="' + t.id + '"' + (S.appearance.theme === t.id ? ' selected' : '') + '>' + esc(t.name) + ' (built-in)</option>').join('') +
          state.customThemes.map(t => '<option value="' + t.id + '"' + (S.appearance.theme === t.id ? ' selected' : '') + '>' + esc(t.name) + ' (custom)</option>').join('') +
        '</select><button class="btn small ghost" id="open-themes-btn">Manage themes…</button></div></div>' +
      '<h3>Background</h3>' +
      setRow('Background type', '<select data-set="appearance.background.type">' +
        [['dynamic', 'Weather-based (dynamic)'], ['solid', 'Solid color'], ['gradient', 'Gradient'], ['image', 'Image (URL)'], ['animated', 'Animated (weather particles)']]
          .map(o => '<option value="' + o[0] + '"' + (bg.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Dynamic weather background', switchHtml('appearance.background.dynamicOn', bg.dynamicOn !== false)) +
      setRow('Solid color', '<input type="color" data-set="appearance.background.color" value="' + bg.color + '">') +
      setRow('Gradient colors', '<input type="color" data-set="appearance.background.color" value="' + bg.color + '" aria-label="Gradient color 1"> <input type="color" data-set="appearance.background.color2" value="' + bg.color2 + '" aria-label="Gradient color 2">') +
      setRow('Image URL', '<input type="text" data-set="appearance.background.image" value="' + esc(bg.image) + '" placeholder="https://…" style="width:260px;max-width:60vw">') +
      CONTROL_GROUPS.map(g => '<h3>' + g.title + '</h3>' + (g.note ? '<p class="group-note">' + g.note + '</p>' : '') + g.controls.map(ctlRow).join('')).join('') +
      '<div class="settings-actions">' +
        '<button class="btn ghost" id="reset-theme-btn">Reset theme</button>' +
        '<button class="btn ghost" id="reset-appearance-btn">Reset appearance</button>' +
        '<button class="btn" id="export-settings-btn">Export settings</button>' +
        '<button class="btn ghost" id="import-settings-btn">Import settings</button>' +
        '<input type="file" id="import-settings-file" accept="application/json,.json" class="hidden" aria-label="Import settings file">' +
      '</div>';
  }

  else if (cat === 'dashboard') {
    el.innerHTML = '<h3>Dashboard widgets</h3>' +
      '<p class="group-note">Toggle visibility, change size and display mode, and reorder with drag & drop or the arrow buttons. Changes save automatically.</p>' +
      state.settings.dashboard.map((c, i) => {
        const w = WIDGETS.find(x => x.id === c.id);
        return '<div class="dash-row" draggable="true" data-dash="' + c.id + '">' +
          '<button class="dash-grip" data-dashmove title="Drag to reorder" aria-label="Drag ' + esc(w.name) + '">⋮⋮</button>' +
          '<span class="dash-name">' + esc(w.name) + '</span>' +
          '<label style="display:flex;align-items:center;gap:5px;font-size:0.8em;color:var(--text2)">Show <span class="switch"><input type="checkbox" data-dashvis="' + c.id + '"' + (c.visible ? ' checked' : '') + ' aria-label="Show ' + esc(w.name) + '"><i></i></span></label>' +
          '<select data-dashsize="' + c.id + '" aria-label="Size of ' + esc(w.name) + '">' +
            [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Full width']].map(o => '<option value="' + o[0] + '"' + (c.size === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
          '<select data-dashmode="' + c.id + '" aria-label="Mode of ' + esc(w.name) + '">' +
            [['normal', 'Normal'], ['compact', 'Compact'], ['detailed', 'Detailed']].map(o => '<option value="' + o[0] + '"' + (c.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
          '<button class="icon-btn" data-dashup="' + i + '" aria-label="Move ' + esc(w.name) + ' up">▲</button>' +
          '<button class="icon-btn" data-dashdown="' + i + '" aria-label="Move ' + esc(w.name) + ' down">▼</button>' +
        '</div>';
      }).join('');
  }

  else if (cat === 'units') {
    el.innerHTML = '<h3>Units — each setting is independent</h3>' +
      setRow('Temperature', unitSelect('units.temp', [['c', 'Celsius (°C)'], ['f', 'Fahrenheit (°F)']])) +
      setRow('Wind speed', unitSelect('units.wind', [['kmh', 'km/h'], ['mph', 'mph'], ['ms', 'm/s'], ['kn', 'knots']])) +
      setRow('Pressure', unitSelect('units.pressure', [['hpa', 'hPa'], ['inhg', 'inHg'], ['mmhg', 'mmHg']])) +
      setRow('Precipitation', unitSelect('units.precip', [['mm', 'millimeters'], ['in', 'inches']])) +
      setRow('Visibility', unitSelect('units.vis', [['km', 'kilometers'], ['mi', 'miles']])) +
      '<p class="group-note">Changing one unit never affects the others.</p>';
  }

  else if (cat === 'time') {
    el.innerHTML = '<h3>Time & date</h3>' +
      setRow('Clock format', '<select data-set="time.hour12">' +
        [['true', '12-hour (AM/PM)'], ['false', '24-hour']].map(o => '<option value="' + o[0] + '"' + (String(S.time.hour12) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Time zone', '<select data-set="time.tz">' +
        [['auto', "Weather location's time zone"], ['device', 'This device']].map(o => '<option value="' + o[0] + '"' + (S.time.tz === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Date format', '<select data-set="time.dateFormat">' +
        [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD'], ['long', 'Weekday, Month D'], ['short', 'Short with weekday']]
          .map(o => '<option value="' + o[0] + '"' + (S.time.dateFormat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Hours shown in hourly forecast', '<select data-set="hourly.count">' +
        [[12, '12 hours'], [24, '24 hours'], [48, '48 hours'], ['all', 'Full forecast']]
          .map(o => '<option value="' + o[0] + '"' + (String(S.hourly.count) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>') +
      setRow('Days shown in daily forecast', '<select data-set="dailyCount">' +
        [7, 10, 14, 16].map(v => '<option value="' + v + '"' + (S.dailyCount === v ? ' selected' : '') + '>' + v + ' days</option>').join('') + '</select>');
  }

  else if (cat === 'accessibility') {
    el.innerHTML = '<h3>Accessibility</h3>' +
      setRow('Reduce motion & animated effects', switchHtml('accessibility.reducedMotion', S.accessibility.reducedMotion)) +
      setRow('Large text', switchHtml('accessibility.largeText', S.accessibility.largeText)) +
      setRow('Boost contrast', switchHtml('accessibility.highContrast', S.accessibility.highContrast)) +
      '<p class="group-note">All controls are keyboard reachable, show visible focus rings, and include ARIA labels. Weather is never communicated by color alone — text labels accompany every icon.</p>';
  }

  else if (cat === 'data') {
    el.innerHTML = '<h3>Data management</h3>' +
      '<div class="settings-actions" style="margin-top:0;border-top:0;padding-top:0">' +
        '<button class="btn" id="export-settings-btn2">Export all settings</button>' +
        '<button class="btn ghost" id="import-settings-btn2">Import settings</button>' +
        '<input type="file" id="import-settings-file2" accept="application/json,.json" class="hidden" aria-label="Import settings file">' +
        '<button class="btn ghost" id="clear-cache-btn">Clear weather cache</button>' +
        '<button class="btn danger" id="wipe-btn">Erase all app data</button>' +
      '</div>' +
      '<h3>API</h3>' +
      '<p class="group-note">Forecast, geocoding and air-quality data come from the free ' +
      '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo API</a> (no key required, CC BY 4.0). ' +
      'Reverse geocoding for “my location” uses the free BigDataCloud client API. Requests are debounced, cached and never duplicated. ' +
      'Your settings, themes, locations and dashboard live only in this browser (localStorage) — nothing is uploaded anywhere.</p>';
  }

  else if (cat === 'about') {
    el.innerHTML = '<h3>About Nexora Weather</h3>' +
      '<p>Version ' + APP_VERSION + '</p><br>' +
      '<p>Nexora Weather is a fully client-side weather application with deep customization: themes, colors, typography, layout, effects, backgrounds, units, widgets and more — all stored locally.</p><br>' +
      '<h3>Attribution</h3>' +
      '<p>Weather data © <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>, licensed under ' +
      '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. ' +
      'Location search by the Open-Meteo Geocoding API. Air quality by the Open-Meteo Air Quality API. ' +
      'Place names for browser geolocation by BigDataCloud. Fonts by Google Fonts.</p>';
  }
}
function setRow(label, inputHtml) {
  return '<div class="set-row"><label>' + esc(label) + '</label><div class="ctl">' + inputHtml + '</div></div>';
}
function switchHtml(path, on) {
  return '<span class="switch"><input type="checkbox" data-set="' + path + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(path) + '"><i></i></span>';
}
function unitSelect(path, options) {
  const cur = getPath(state.settings, path);
  return '<select data-set="' + path + '" aria-label="' + esc(path) + '">' +
    options.map(o => '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
}

/* live-applied settings change (data-set controls) */
function handleSetChange(el) {
  const path = el.dataset.set;
  if (!path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.tagName === 'SELECT' && el.dataset.num !== undefined) v = Number(v);
  if (el.type === 'checkbox') { setPath(state.settings, path, v); }
  else if (path === 'general.refreshMinutes' || path === 'dailyCount' || path === 'hourly.count' || path === 'appearance.layout.cols') setPath(state.settings, path, isNaN(Number(v)) ? v : Number(v));
  else if (path === 'time.hour12') setPath(state.settings, path, v === 'true');
  else setPath(state.settings, path, v);

  saveSettings();
  if (path === 'appearance.theme') { applyTheme(v, { silent: true }); renderSettingsContent(); renderAllBodies(); return; }
  if (path.startsWith('appearance.')) applyAppearance();
  if (path.startsWith('units.') || path.startsWith('time.')) renderAllBodies();
  if (path === 'hourly.count' || path === 'dailyCount') renderAllBodies();
  if (path === 'general.refreshMinutes') startRefreshLoop();
  if (path.startsWith('accessibility.')) { applyAppearance(); renderAllBodies(); }
  if (path === 'appearance.background.type' || path.startsWith('appearance.background')) applyAppearance();
}

/* customization panel controls (data-ctl) */
function handleCtlInput(el) {
  const path = el.dataset.ctl;
  if (!path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'range') v = Number(v);
  setPath(state.settings, path, v);
  saveSettings();
  if (el.type === 'range') { const sv = el.parentElement.querySelector('.ctl-val'); if (sv) sv.textContent = v; }
  applyAppearance();
  renderAllBodies();
}

/* ============================ 20. THEMES MANAGER ============================ */
function themeSwatchStyle(t) {
  const o = t.overrides || {};
  const c = deepMerge(deepMerge(clone(DEFAULT_COLORS), (BUILTIN_THEMES[0].overrides || {})), o.colors || {});
  return 'background:linear-gradient(135deg,' + c.bg + ' 55%,' + c.bg2 + ' 55%);';
}
function buildThemesModal() {
  const all = BUILTIN_THEMES.map(t => Object.assign({ builtin: true }, t))
    .concat(state.customThemes.map(t => Object.assign({ builtin: false }, t)));
  $('#themes-body').innerHTML =
    '<div class="theme-grid">' + all.map(t =>
      '<div class="theme-card' + (state.settings.appearance.theme === t.id ? ' on' : '') + '" data-themeapply="' + t.id + '" role="button" tabindex="0" aria-label="Apply theme ' + esc(t.name) + '">' +
        '<div class="theme-swatch" style="' + themeSwatchStyle(t) + '"></div>' +
        '<div class="theme-info"><b>' + esc(t.name) + '</b><span class="theme-tag">' + (t.builtin ? 'built-in' : 'custom') + '</span></div>' +
        (t.builtin ? '' :
          '<div class="theme-actions" style="padding:0 10px 10px">' +
            '<button class="btn small ghost" data-themerename="' + t.id + '">Rename</button>' +
            '<button class="btn small ghost" data-themedupe="' + t.id + '">Duplicate</button>' +
            '<button class="btn small ghost" data-themeexport="' + t.id + '">Export</button>' +
            '<button class="btn small danger" data-themedelete="' + t.id + '">Delete</button>' +
          '</div>') +
      '</div>').join('') + '</div>' +
    '<div class="save-theme-row">' +
      '<input type="text" id="new-theme-name" placeholder="Name for a theme based on current appearance…" aria-label="New theme name">' +
      '<button class="btn" id="save-theme-btn">Save current as theme</button>' +
      '<button class="btn ghost" id="import-theme-btn">Import theme</button>' +
      '<input type="file" id="import-theme-file" accept="application/json,.json" class="hidden" aria-label="Import theme file">' +
    '</div>' +
    '<p class="group-note">Tip: customize anything in Settings → Appearance, then save the result as your own theme here.</p>';
}
function openThemes() { buildThemesModal(); openModal('themes-modal'); }
function saveCurrentAsTheme(name) {
  const ap = state.settings.appearance;
  const overrides = {
    colors: clone(ap.colors), condColors: clone(ap.condColors),
    typography: clone(ap.typography), layout: clone(ap.layout),
    effects: clone(ap.effects), background: clone(ap.background)
  };
  const t = { id: 'theme-' + Date.now(), name, custom: true, overrides };
  state.customThemes.push(t);
  saveThemes();
  state.settings.appearance.theme = t.id; saveSettings();
  buildThemesModal(); renderSettingsContent();
  toast('Theme “' + name + '” saved.', 'ok');
}
function exportTheme(id) {
  const t = findTheme(id);
  if (!t) return;
  downloadJSON({ app: 'nexora-weather', kind: 'theme', theme: t }, 'nexora-theme-' + t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
}
function importThemeFile(file) {
  readJSONFile(file, j => {
    const t = j && (j.theme || j);
    if (!t || typeof t !== 'object' || !t.name || typeof t.overrides !== 'object') {
      toast('That file is not a valid Nexora theme.', 'error'); return;
    }
    const nt = { id: 'theme-' + Date.now(), name: String(t.name).slice(0, 40), custom: true, overrides: t.overrides };
    state.customThemes.push(nt); saveThemes();
    buildThemesModal();
    toast('Theme “' + nt.name + '” imported.', 'ok');
  });
}

/* ============================ 21. SAVED LOCATIONS ============================ */
function buildLocPopover() {
  const list = $('#loc-list');
  const gpsActive = state.activeLoc === 'gps';
  let html = '<li class="loc-item' + (gpsActive ? ' active' : '') + '" draggable="false">' +
    '<button class="loc-info" data-locswitch="gps"><span class="loc-name">📍 Current location (GPS)</span>' +
    '<span class="loc-meta">' + (state.gps ? esc(state.gps.label || '') + ' · ' + state.gps.lat.toFixed(2) + ', ' + state.gps.lon.toFixed(2) : 'Not set — click to enable') + '</span></button></li>';
  html += state.locations.map((l, i) =>
    '<li class="loc-item' + (state.activeLoc === l.id ? ' active' : '') + '" draggable="true" data-locid="' + l.id + '">' +
      '<button class="loc-info" data-locswitch="' + l.id + '">' +
        '<span class="loc-name" data-locname="' + l.id + '">' + flagEmoji(l.cc) + ' ' + esc(l.name) + '</span>' +
        '<span class="loc-meta">' + esc([l.region, l.country].filter(Boolean).join(', ')) + ' · ' + l.lat.toFixed(2) + ', ' + l.lon.toFixed(2) + '</span>' +
      '</button>' +
      '<button class="icon-btn" data-locup="' + i + '" aria-label="Move ' + esc(l.name) + ' up">▲</button>' +
      '<button class="icon-btn" data-locdown="' + i + '" aria-label="Move ' + esc(l.name) + ' down">▼</button>' +
      '<button class="icon-btn" data-locrename="' + l.id + '" aria-label="Rename ' + esc(l.name) + '">✎</button>' +
      '<button class="icon-btn" data-locdel="' + l.id + '" aria-label="Delete ' + esc(l.name) + '">🗑</button>' +
    '</li>').join('');
  list.innerHTML = html;
}
function toggleLocPopover() {
  const p = $('#loc-popover');
  const willOpen = p.classList.contains('hidden');
  p.classList.toggle('hidden');
  $('#btn-locations').setAttribute('aria-expanded', String(willOpen));
  if (willOpen) buildLocPopover();
}
function addLocation(r) {
  const loc = locFromGeocodeResult(r);
  const existing = state.locations.find(l => l.id === loc.id);
  if (!existing) { state.locations.push(loc); }
  state.activeLoc = loc.id;
  saveLocations();
  loadWeather('location');
  toast('Now showing ' + loc.name + (loc.country ? ', ' + loc.country : ''), 'ok');
}
function moveLocation(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.locations.length) return;
  const arr = state.locations;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveLocations(); buildLocPopover();
}

/* ============================ 22. SEARCH ============================ */
function renderSearchResults(results, status) {
  const box = $('#search-results');
  state.searchActive = -1;
  if (status) { box.innerHTML = '<div class="search-status">' + esc(status) + '</div>'; return; }
  if (!results.length) { box.innerHTML = '<div class="search-status">No matching places found. Try a nearby city or the postal code of a larger city.</div>'; return; }
  box.innerHTML = results.map((r, i) =>
    '<button class="search-result" role="option" data-result="' + i + '" aria-selected="false">' +
      '<span class="flag">' + flagEmoji(r.country_code) + '</span>' +
      '<span><span class="sr-name">' + esc(r.name) + '</span><br>' +
      '<span class="sr-meta">' + esc([r.admin1, r.country].filter(Boolean).join(', ')) + '</span></span>' +
    '</button>').join('');
  box.dataset.results = JSON.stringify(results.map(r => ({ id: r.id, name: r.name, admin1: r.admin1, country: r.country, country_code: r.country_code, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone })));
}
const runSearch = debounce(async q => {
  const box = $('#search-results');
  if (!q || q.trim().length < 2) { box.classList.add('hidden'); return; }
  renderSearchResults([], 'Searching…');
  box.classList.remove('hidden');
  try {
    const results = await geocode(q.trim());
    renderSearchResults(results, results.length ? '' : 'No matches. Postal-code search works best with larger cities.');
  } catch (e) {
    renderSearchResults([], 'Search failed — check your network connection.');
  }
}, 350);
function pickResult(i) {
  const box = $('#search-results');
  let r;
  try { r = JSON.parse(box.dataset.results || '[]')[i]; } catch (e) { return; }
  if (!r) return;
  box.classList.add('hidden');
  $('#search-input').value = '';
  $('#search-clear').classList.add('hidden');
  addLocation(r);
}

/* ============================ 23. GEOLOCATION ============================ */
function useMyLocation() {
  if (!navigator.geolocation) {
    toast('Geolocation is not supported by this browser — search for a place instead.', 'error');
    return;
  }
  toast('Locating you…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    const label = await reverseGeocode(lat, lon);
    state.gps = { lat, lon, label };
    state.activeLoc = 'gps';
    saveLocations();
    $('#loc-popover').classList.add('hidden');
    loadWeather('gps');
    toast('Location set: ' + label, 'ok');
  }, err => {
    toast('Could not get your location (' + (err.code === 1 ? 'permission denied' : 'unavailable') + '). You can search for a place manually.', 'error');
    if (!state.weather) loadWeather('fallback');   /* never leave the app blank */
  }, { timeout: 10000, maximumAge: 300000 });
}

/* ============================ 24. LOAD WEATHER ============================ */
async function loadWeather(reason) {
  if (state.loading) return;               /* prevent duplicate simultaneous requests */
  state.loading = true;
  $('#btn-refresh').classList.add('spinning');
  const loc = currentLocation();
  try {
    const aqiP = fetchAQI(loc).catch(() => null);
    const w = await fetchForecast(loc);
    if (!validForecast(w)) throw new Error('Malformed response');
    state.weather = w;
    state.aqi = await aqiP;
    state.source = 'live';
    state.lastLoad = Date.now();
    cacheSet(loc, { w: state.weather, a: state.aqi });
    hideOffline();
  } catch (err) {
    const cached = cacheGet(loc);
    if (cached && cached.w) {
      state.weather = cached.w; state.aqi = cached.a;
      state.source = 'cached'; state.lastLoad = cached.time;
      showOffline('Network problem — showing the last data retrieved for this location.', cached.time);
    } else {
      state.weather = null;
      showOffline('Could not load weather (' + (err.name === 'AbortError' ? 'request timed out' : (err.message || 'network error')) + '). Check your connection and retry.', 0);
    }
  } finally {
    state.loading = false;
    $('#btn-refresh').classList.remove('spinning');
    renderAllBodies();
    applyBackground();
  }
}
function showOffline(msg, cachedTime) {
  $('#offline-banner').classList.remove('hidden');
  $('#offline-msg').textContent = msg;
  $('#offline-meta').textContent = cachedTime ? 'Last updated ' + fmtTime(Math.floor(cachedTime / 1000)) + ' · ' + fmtDate(Math.floor(cachedTime / 1000)) : '';
}
function hideOffline() { $('#offline-banner').classList.add('hidden'); }

/* auto refresh loop */
let refreshTimer = 0;
function startRefreshLoop() {
  clearInterval(refreshTimer);
  const mins = state.settings.general.refreshMinutes;
  if (!mins || mins <= 0) return;
  refreshTimer = setInterval(() => {
    if (document.hidden || state.loading) return;
    if (Date.now() - state.lastLoad >= mins * 60000) loadWeather('auto');
  }, 20000);
}

/* ============================ 25. CLOCK ============================ */
function updateClock() {
  const el = $('#clock');
  if (!el) return;
  const now = Math.floor(Date.now() / 1000);
  el.textContent = fmtTime(now) + (state.weather && state.weather.timezone && state.settings.time.tz !== 'device' ? ' · ' + state.weather.timezone.split('/').pop().replace(/_/g, ' ') : '');
}

/* ============================ 26. EXPORT / IMPORT ============================ */
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function readJSONFile(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    try { cb(JSON.parse(fr.result)); }
    catch (e) { toast('That file is not valid JSON.', 'error'); }
  };
  fr.onerror = () => toast('Could not read that file.', 'error');
  fr.readAsText(file);
}
function exportAll() {
  downloadJSON({
    app: 'nexora-weather', kind: 'settings', version: APP_VERSION, exportedAt: new Date().toISOString(),
    settings: state.settings, themes: state.customThemes, locations: state.locations
  }, 'nexora-weather-settings.json');
  toast('Settings exported.', 'ok');
}
function importAll(file) {
  readJSONFile(file, j => {
    try {
      if (!j || typeof j !== 'object') throw new Error('bad');
      const src = j.settings && typeof j.settings === 'object' ? j.settings : j;
      /* validate & sanitize: only known top-level keys are merged */
      const allowed = ['general', 'units', 'time', 'accessibility', 'hourly', 'dailyCount', 'appearance'];
      const clean = {};
      for (const k of allowed) if (src[k] && typeof src[k] === 'object') clean[k] = src[k];
      if (src.dailyCount != null) clean.dailyCount = src.dailyCount;
      if (!Object.keys(clean).length) throw new Error('bad');
      deepMerge(state.settings, clean);
      if (Array.isArray(src.dashboard)) state.settings.dashboard = src.dashboard;
      if (Array.isArray(j.themes)) state.customThemes = j.themes.filter(t => t && t.name && t.overrides);
      if (Array.isArray(j.locations)) { state.locations = j.locations.filter(l => l && l.id && isFinite(l.lat) && isFinite(l.lon)); }
      saveSettings(); saveThemes(); saveLocations();
      applyAppearance(); buildDashboard(); renderAllBodies();
      if (state.activeCat) renderSettingsContent();
      toast('Settings imported successfully.', 'ok');
    } catch (e) {
      toast('Import failed: the file does not look like a valid Nexora settings export.', 'error');
    }
  });
}

/* ============================ 27. EVENT BINDING ============================ */
function bindEvents() {
  /* --- header buttons --- */
  $('#btn-settings').addEventListener('click', () => { openSettings(); $('#btn-settings').setAttribute('aria-expanded', 'true'); });
  $('#btn-themes').addEventListener('click', openThemes);
  $('#btn-refresh').addEventListener('click', () => loadWeather('manual'));
  $('#btn-locate').addEventListener('click', useMyLocation);
  $('#btn-locations').addEventListener('click', toggleLocPopover);
  $('#retry-btn').addEventListener('click', () => loadWeather('retry'));
  $('#brand').addEventListener('click', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: state.settings.accessibility.reducedMotion ? 'auto' : 'smooth' }); });

  /* --- search --- */
  const si = $('#search-input'), sr = $('#search-results');
  si.addEventListener('input', () => {
    $('#search-clear').classList.toggle('hidden', !si.value);
    runSearch(si.value);
  });
  si.addEventListener('keydown', e => {
    const items = $$('.search-result', sr);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      state.searchActive = (state.searchActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === state.searchActive));
      items[state.searchActive].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (state.searchActive >= 0) pickResult(state.searchActive);
      else if (items.length) pickResult(0);
    } else if (e.key === 'Escape') { sr.classList.add('hidden'); }
  });
  sr.addEventListener('click', e => {
    const b = e.target.closest('[data-result]');
    if (b) pickResult(Number(b.dataset.result));
  });
  $('#search-clear').addEventListener('click', () => { si.value = ''; sr.classList.add('hidden'); $('#search-clear').classList.add('hidden'); si.focus(); });
  document.addEventListener('click', e => {
    if (!e.target.closest('.searchbox')) sr.classList.add('hidden');
    if (!e.target.closest('#loc-popover') && !e.target.closest('#btn-locations')) $('#loc-popover').classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !anyModalOpen()) {
      e.preventDefault(); si.focus();
    }
    if (e.key === 'Escape') {
      $$('.modal').forEach(m => m.classList.add('hidden'));
      $('#loc-popover').classList.add('hidden');
      sr.classList.add('hidden');
      $('#btn-settings').setAttribute('aria-expanded', 'false');
    }
  });

  /* --- global delegated clicks --- */
  document.addEventListener('click', e => {
    const t = e.target;

    const closeM = t.closest('[data-close-modal]');
    if (closeM) { closeM.closest('.modal').classList.add('hidden'); $('#btn-settings').setAttribute('aria-expanded', 'false'); }
    if (t.closest('[data-close-popover]')) $('#loc-popover').classList.add('hidden');

    /* settings nav */
    const nav = t.closest('[data-cat]');
    if (nav && nav.closest('#settings-nav')) { state.activeCat = nav.dataset.cat; buildSettingsNav(); renderSettingsContent(); return; }

    /* appearance buttons */
    if (t.closest('#open-themes-btn')) { openThemes(); return; }
    if (t.closest('#reset-theme-btn')) { applyTheme('default'); renderSettingsContent(); renderAllBodies(); toast('Theme reset to Default.', 'ok'); return; }
    if (t.closest('#reset-appearance-btn')) {
      state.settings.appearance = clone(DEFAULTS.appearance);
      saveSettings(); applyAppearance(); renderSettingsContent(); renderAllBodies();
      toast('All appearance settings reset to defaults.', 'ok'); return;
    }
    if (t.closest('#export-settings-btn') || t.closest('#export-settings-btn2')) { exportAll(); return; }
    if (t.closest('#import-settings-btn')) { $('#import-settings-file').click(); return; }
    if (t.closest('#import-settings-btn2')) { $('#import-settings-file2').click(); return; }
    if (t.closest('#clear-cache-btn')) { store.del('cache'); Object.keys(localStorage).filter(k => k.startsWith('nexora.cache')).forEach(k => localStorage.removeItem(k)); toast('Weather cache cleared.', 'ok'); return; }
    if (t.closest('#wipe-btn')) {
      if (confirm('Erase ALL Nexora data (settings, themes, locations, cache) and reload?')) {
        Object.keys(localStorage).filter(k => k.startsWith('nexora.')).forEach(k => localStorage.removeItem(k));
        location.reload();
      }
      return;
    }

    /* per-control reset */
    const rst = t.closest('[data-reset]');
    if (rst) {
      const p = rst.dataset.reset;
      setPath(state.settings, p, clone(getPath(DEFAULTS, p)));
      saveSettings(); applyAppearance(); renderSettingsContent(); renderAllBodies();
      return;
    }

    /* dashboard: hourly controls */
    const hc = t.closest('[data-hcount]');
    if (hc) { state.settings.hourly.count = isNaN(Number(hc.dataset.hcount)) ? 'all' : Number(hc.dataset.hcount); saveSettings(); renderAllBodies(); return; }
    if (t.closest('#open-detail')) { openDetail(); return; }

    /* daily expand */
    const drow = t.closest('.day-row');
    if (drow) {
      const card = drow.closest('.day-card');
      const open = card.classList.toggle('open');
      drow.setAttribute('aria-expanded', String(open));
      return;
    }

    /* themes modal */
    const ta = t.closest('[data-themeapply]');
    if (ta && !t.closest('.theme-actions')) { applyTheme(ta.dataset.themeapply); buildThemesModal(); renderSettingsContent(); renderAllBodies(); return; }
    if (t.closest('#save-theme-btn')) {
      const name = ($('#new-theme-name').value || '').trim() || 'My theme';
      saveCurrentAsTheme(name); return;
    }
    if (t.closest('#import-theme-btn')) { $('#import-theme-file').click(); return; }
    const tRename = t.closest('[data-themerename]');
    if (tRename) {
      const th = state.customThemes.find(x => x.id === tRename.dataset.themerename);
      const name = prompt('Rename theme:', th.name);
      if (name && name.trim()) { th.name = name.trim().slice(0, 40); saveThemes(); buildThemesModal(); renderSettingsContent(); }
      return;
    }
    const tDupe = t.closest('[data-themedupe]');
    if (tDupe) {
      const th = findTheme(tDupe.dataset.themedupe);
      state.customThemes.push({ id: 'theme-' + Date.now(), name: th.name + ' copy', custom: true, overrides: clone(th.overrides || {}) });
      saveThemes(); buildThemesModal(); toast('Theme duplicated.', 'ok'); return;
    }
    const tExp = t.closest('[data-themeexport]');
    if (tExp) { exportTheme(tExp.dataset.themeexport); return; }
    const tDel = t.closest('[data-themedelete]');
    if (tDel) {
      const id = tDel.dataset.themedelete;
      state.customThemes = state.customThemes.filter(x => x.id !== id);
      if (state.settings.appearance.theme === id) applyTheme('default', { silent: true });
      saveThemes(); buildThemesModal(); renderSettingsContent();
      toast('Theme deleted.', 'ok'); return;
    }

    /* locations popover */
    const lsw = t.closest('[data-locswitch]');
    if (lsw) {
      const id = lsw.dataset.locswitch;
      if (id === 'gps' && !state.gps) { useMyLocation(); return; }
      state.activeLoc = id; saveLocations();
      $('#loc-popover').classList.add('hidden');
      loadWeather('switch');
      return;
    }
    const lup = t.closest('[data-locup]'); if (lup) { moveLocation(Number(lup.dataset.locup), -1); return; }
    const ldn = t.closest('[data-locdown]'); if (ldn) { moveLocation(Number(ldn.dataset.locdown), 1); return; }
    const lren = t.closest('[data-locrename]');
    if (lren) {
      const id = lren.dataset.locrename;
      const loc = state.locations.find(x => x.id === id);
      const nameEl = $('[data-locname="' + id + '"]');
      const input = document.createElement('input');
      input.value = loc.name; input.setAttribute('aria-label', 'Rename location');
      nameEl.textContent = ''; nameEl.appendChild(input);
      input.focus(); input.select();
      const commit = () => {
        if (!input.isConnected) return;
        const v = input.value.trim();
        if (v) { loc.name = v.slice(0, 40); saveLocations(); }
        buildLocPopover(); renderAllBodies();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') buildLocPopover(); });
      return;
    }
    const ldel = t.closest('[data-locdel]');
    if (ldel) {
      const id = ldel.dataset.locdel;
      state.locations = state.locations.filter(x => x.id !== id);
      if (state.activeLoc === id) state.activeLoc = state.locations[0] ? state.locations[0].id : null;
      saveLocations(); buildLocPopover(); renderAllBodies();
      return;
    }
    if (t.closest('#loc-use-gps')) { useMyLocation(); return; }

    /* dashboard settings rows */
    const dup = t.closest('[data-dashup]');
    if (dup) { moveDash(Number(dup.dataset.dashup), -1); return; }
    const ddn = t.closest('[data-dashdown]');
    if (ddn) { moveDash(Number(ddn.dataset.dashdown), 1); return; }
  });

  /* keyboard activation for detail + theme cards */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'open-detail') openDetail();
    const tc = e.target.closest && e.target.closest('[data-themeapply]');
    if (tc) { applyTheme(tc.dataset.themeapply); buildThemesModal(); renderSettingsContent(); renderAllBodies(); }
  });

  /* delegated changes (selects, checkboxes, range inputs, text inputs) */
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.set) { handleSetChange(el); return; }
    if (el.dataset.ctl) { handleCtlInput(el); return; }
    if (el.dataset.hgraph !== undefined) {
      state.settings.hourly.graph = el.checked; saveSettings(); renderAllBodies(); return;
    }
    if (el.dataset.hmetric) {
      const ms = state.settings.hourly.metrics;
      const i = ms.indexOf(el.dataset.hmetric);
      if (el.checked && i < 0) ms.push(el.dataset.hmetric);
      if (!el.checked && i >= 0) ms.splice(i, 1);
      saveSettings(); renderAllBodies(); return;
    }
    if (el.dataset.dailycount !== undefined) {
      state.settings.dailyCount = Number(el.value); saveSettings(); renderAllBodies(); return;
    }
    if (el.dataset.dashvis) {
      widgetConf(el.dataset.dashvis).visible = el.checked;
      saveDashboard(); buildDashboard(); renderAllBodies(); return;
    }
    if (el.dataset.dashsize) {
      widgetConf(el.dataset.dashsize).size = el.value;
      saveDashboard(); buildDashboard(); renderAllBodies(); return;
    }
    if (el.dataset.dashmode) {
      widgetConf(el.dataset.dashmode).mode = el.value;
      saveDashboard(); buildDashboard(); renderAllBodies(); return;
    }
    if (el.id === 'import-settings-file' || el.id === 'import-settings-file2') {
      if (el.files && el.files[0]) importAll(el.files[0]);
      el.value = ''; return;
    }
    if (el.id === 'import-theme-file') {
      if (el.files && el.files[0]) importThemeFile(el.files[0]);
      el.value = ''; return;
    }
  });
  document.addEventListener('input', e => {
    if (e.target.dataset.ctl && e.target.type === 'range') handleCtlInput(e.target);
    if (e.target.dataset.ctlCustomfont !== undefined) {
      /* custom font family text box */
      setPath(state.settings, 'appearance.typography.fontFamily', e.target.value);
      saveSettings(); applyAppearance(); renderAllBodies();
    }
  });

  /* --- drag & drop: dashboard widgets --- */
  let dragId = null;
  document.addEventListener('dragstart', e => {
    const card = e.target.closest && e.target.closest('.widget');
    const row = e.target.closest && e.target.closest('.dash-row');
    const li = e.target.closest && e.target.closest('.loc-item[draggable="true"]');
    if (li) { e.dataTransfer.setData('text/loc', li.dataset.locid); li.classList.add('dragging'); return; }
    if (row) { e.dataTransfer.setData('text/dash', row.dataset.dash); row.classList.add('dragging'); return; }
    if (!card) return;
    if (!e.target.closest('.grip')) { e.preventDefault(); return; }   /* only drag from the grip handle */
    dragId = card.dataset.widget;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', () => {
    $$('.dragging').forEach(x => x.classList.remove('dragging'));
    $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
    dragId = null;
  });
  document.addEventListener('dragover', e => {
    const card = e.target.closest && e.target.closest('.widget');
    const row = e.target.closest && e.target.closest('.dash-row');
    const li = e.target.closest && e.target.closest('.loc-item[draggable="true"]');
    if (card && dragId && card.dataset.widget !== dragId) {
      e.preventDefault(); card.classList.add('drop-target');
    } else if (row && e.dataTransfer.types.includes('text/dash')) { e.preventDefault(); }
    else if (li && e.dataTransfer.types.includes('text/loc')) { e.preventDefault(); }
  });
  document.addEventListener('dragleave', e => {
    const c = e.target.closest && e.target.closest('.drop-target');
    if (c) c.classList.remove('drop-target');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    /* locations */
    const li = e.target.closest && e.target.closest('.loc-item[draggable="true"]');
    if (li && e.dataTransfer.getData('text/loc')) {
      const fromId = e.dataTransfer.getData('text/loc');
      const from = state.locations.findIndex(l => l.id === fromId);
      const to = state.locations.findIndex(l => l.id === li.dataset.locid);
      if (from >= 0 && to >= 0 && from !== to) {
        const [m] = state.locations.splice(from, 1);
        state.locations.splice(to, 0, m);
        saveLocations(); buildLocPopover();
      }
      return;
    }
    /* dashboard settings rows */
    const row = e.target.closest && e.target.closest('.dash-row');
    if (row && e.dataTransfer.getData('text/dash')) {
      const fromId = e.dataTransfer.getData('text/dash');
      const from = state.settings.dashboard.findIndex(c => c.id === fromId);
      const to = state.settings.dashboard.findIndex(c => c.id === row.dataset.dash);
      if (from >= 0 && to >= 0 && from !== to) {
        const [m] = state.settings.dashboard.splice(from, 1);
        state.settings.dashboard.splice(to, 0, m);
        saveDashboard(); buildDashboard(); renderAllBodies(); renderSettingsContent();
      }
      return;
    }
    /* dashboard cards on the main grid */
    const card = e.target.closest && e.target.closest('.widget');
    if (card && dragId && card.dataset.widget !== dragId) {
      const from = state.settings.dashboard.findIndex(c => c.id === dragId);
      const to = state.settings.dashboard.findIndex(c => c.id === card.dataset.widget);
      if (from >= 0 && to >= 0) {
        const [m] = state.settings.dashboard.splice(from, 1);
        state.settings.dashboard.splice(to, 0, m);
        saveDashboard(); buildDashboard(); renderAllBodies();
      }
    }
  });

  /* --- network status --- */
  window.addEventListener('offline', () => showOffline('You are offline — showing the last available data.', state.lastLoad));
  window.addEventListener('online', () => { hideOffline(); loadWeather('online'); });

  /* --- redraw canvases on resize --- */
  window.addEventListener('resize', debounce(() => { drawHourlyGraph(); drawDetailCharts(); fxResize(); }, 150));
}
function moveDash(i, dir) {
  const j = i + dir, arr = state.settings.dashboard;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveDashboard(); buildDashboard(); renderAllBodies(); renderSettingsContent();
}

/* ============================ 28. INIT ============================ */
function init() {
  loadAll();
  $('#brand-icon').innerHTML = iconSvg(2, true);
  applyAppearance();
  buildDashboard();
  bindEvents();
  renderAllBodies();
  updateClock();
  setInterval(updateClock, 1000);
  startRefreshLoop();

  /* startup location behaviour */
  if (!state.activeLoc && state.settings.general.startGeolocate && navigator.geolocation) {
    useMyLocation();
  } else if (!state.activeLoc && !state.locations.length) {
    /* sensible built-in default so the app is never blank */
    loadWeather('init');
  } else {
    loadWeather('init');
  }
}
init();
