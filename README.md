# Nexora Weather v1.0
# **Status: Fixed, fully operational**

A complete, fully client-side weather application with extreme customization.
No API key, no backend, no build step, no frameworks — plain HTML/CSS/vanilla JS.

## Run it
**Option A — Go to the website (recommended)**
The website is being hosted at https://nexora-weather.vercel.app/

**Option B — just open the file**
Double-click `index.html` (or drag it into a browser). Everything works over
`file://` except that some browsers block the Google-Fonts stylesheet or
`fetch()` to third-party APIs in rare local-file configurations. If the page
looks unstyled or data never loads, use Option B.

**Option C — tiny local server**
From this folder run any one of:

python3 -m http.server 8000
npx serve .

then open http://localhost:8000

## Features

- Live weather from the free Open-Meteo API (no key required): current
conditions, feels-like, humidity, wind/gusts/direction, precipitation,
rain, snowfall, probability, pressure, cloud cover, visibility, UV,
sunrise/sunset, day/night, 16-day daily + hourly forecasts, air quality.
- Location search (city/region/country/postal where supported) with flags,
browser geolocation with graceful manual fallback, and saved locations
with rename / delete / reorder (drag or arrows).
- 10 built-in themes (Default, Dark, Light, AMOLED, Glass, Minimal,
Cyberpunk, Retro, Material, Monochrome) plus full custom theme
create / modify / save / duplicate / rename / delete / export / import.
- Deep live customization panel: every color (incl. per-weather-condition
colors), font family/size/weight/spacing/line-height, card radius, gaps,
padding, grid columns, icon & temperature sizes, header/sidebar sizes,
blur, glass opacity, shadows, opacity, transitions, animation speed,
and backgrounds (dynamic-weather / solid / gradient / image / animated
particles). Per-control reset, theme reset, full reset, auto-save,
JSON export/import with validation.
- Configurable dashboard: 16 widgets, each with show/hide, small/medium/
full-width sizes, normal/compact/detailed modes, drag-and-drop or
button reordering; layout persists.
- Hourly forecast (12/24/48/all hours) with a customizable canvas graph
(temperature, feels-like, precipitation, wind, UV).
- Expandable daily cards with highs/lows, precipitation, wind, UV,
sunrise/sunset and day length.
- Full detail view (click the current-weather card) with charts.
- Fully independent units (°C/°F, wind mph/kmh/ms/kn, pressure
hPa/inHg/mmHg, precipitation mm/in, visibility km/mi).
- 12/24 h clock, location-timezone or device time, 5 date formats.
- Accessibility: keyboard navigation, focus rings, ARIA labels, reduced
motion, large text, high contrast.
- Offline handling: last data is cached and shown with a clear
"cached" indicator, last-updated time and a retry button.
- Manual + auto refresh with configurable interval; duplicate requests
are prevented; search is debounced; attribution included.

## Data & privacy

All data comes from Open-Meteo (CC BY 4.0) and, for GPS place names,
BigDataCloud's free client API. Nothing leaves your browser except those
API requests; all preferences stay in localStorage.

## Files

index.html   — markup, modals, popovers
style.css    — all styling (driven by CSS custom properties)
app.js       — application logic (~2,900 lines, commented)
