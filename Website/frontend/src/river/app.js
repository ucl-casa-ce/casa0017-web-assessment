// Live ThameSafe Spill Map — entry point.
// Priority: a plain traffic-light status for the user's spot / stretch.
// Layout: find-your-spot controls on the map (search with predictive club/place/postcode
// suggestions, locate me, saved spots); a tabbed panel (Status / Report / Alerts) that is
// a side panel on wide screens and a three-position bottom sheet on phones.
// Embed mode (?embed=card|map) gives club websites a compact live status card.
// Part of Rain To Spill: the Live map page (live.html → src/pages/live.js), below the team top bar.
// Data: the backend's GET /api/river/inputs (Website/backend/src/services/riverInputs.service.js).
// Model + tunables: Website/shared/river (shared with the backend's WhatsApp alerts). Method: method.html#live-map.

import { Map as MLMap, setWorkerUrl, NavigationControl, GeolocateControl, ScaleControl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { scaleLog, scaleLinear, interpolateYlOrRd, interpolatePuRd, rgb } from 'd3';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

import { CONFIG } from '../../../shared/river/config.js';
import { THAMES_WAYPOINTS } from '../../../shared/river/data/thamesCentreline.js';
import { buildRiver, snapToRiver, distKm } from '../../../shared/river/model/river.js';
import { ModelView } from '../../../shared/river/model/impact.js';
import { riskOf, riskInfo, stretchAt, stretchHours, stretchDays, nextChange } from '../../../shared/river/model/risk.js';
import { next24, riskRuns } from '../../../shared/river/model/context.js';
import centrelineUrl from '../../../shared/river/data/thames-centreline.geojson?url';
import { searchSpots, searchRemote, mergeSuggestions, setRiverSnap, loadClubs, clubsInfo, getClubs, loadFavourites, addFavourite, removeFavourite } from './spots.js';
import { spotUrl, shareText, outlookCsv, outlookCard, download, shareOutlook } from './share.js';

// ------------------------------------------------- backend connection
// [PARAM] VITE_API_URL in Website/frontend/.env (default http://localhost:3000, the backend's PORT)
CONFIG.api.base = (import.meta.env.VITE_API_URL || CONFIG.api.base).replace(/\/$/, '');
CONFIG.sightings.apiBase = CONFIG.api.base + CONFIG.sightings.apiBase;
CONFIG.alerts.apiBase = CONFIG.api.base + CONFIG.alerts.apiBase;
CONFIG.sightings.recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally { clearTimeout(t); }
}

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, MarkLineComponent, LegendComponent, CanvasRenderer]);
setWorkerUrl(maplibreWorkerUrl);

const $ = (id) => document.getElementById(id);
const H = 3600e3;
const T = CONFIG.impact.thresholds;
const UNIT = CONFIG.impact.unit;
const pct = (p) => `${Math.round(p * 100)}%`;
const fmt2 = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex2rgb = (h, a = 235) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

// ------------------------------------------------------------- page mode
const Q = new URLSearchParams(location.search);
let framed;
try { framed = window.self !== window.top; } catch { framed = true; }
// [ASSUMPTION] Framed without ?embed= (someone pasted the plain link into an iframe): show the embed map view.
const EMBED = ['card', 'map'].includes(Q.get('embed')) ? Q.get('embed') : framed ? 'map' : null;
if (EMBED) document.body.classList.add('embed', EMBED === 'card' ? 'embed-card-only' : 'embed-map');
const PHONE = window.matchMedia('(max-width: 700px)');
// height of the map area below the team top bar (#stage), used by the phone bottom sheet
const viewH = () => document.getElementById('stage')?.clientHeight || innerHeight;
const TOUCH = window.matchMedia('(hover: none)');

// ------------------------------------------------------------- colours
const CLEAR = [70, 150, 200];
const logScale = scaleLog().domain([T.low, T.high * 1.5]).range([0.18, 1]).clamp(true);
const probScale = scaleLinear().domain([0.05, 1]).range([0.15, 1]).clamp(true);
const rgbArr = (css) => { const c = rgb(css); return [c.r, c.g, c.b, 235]; };
const RISK_RGB = Object.fromEntries(['low', 'moderate', 'high'].map((r) => [r, hex2rgb(riskInfo(r).colour)]));
const COLOUR = {
  central: (v) => (v >= T.low ? rgbArr(interpolateYlOrRd(logScale(v))) : [...CLEAR, 160]),
  p90: (v) => (v >= T.low ? rgbArr(interpolateYlOrRd(logScale(v))) : [...CLEAR, 160]),
  pMod: (p) => (p >= 0.05 ? rgbArr(interpolatePuRd(probScale(p))) : [...CLEAR, 160]),
  pHigh: (p) => (p >= 0.05 ? rgbArr(interpolatePuRd(probScale(p))) : [...CLEAR, 160]),
};
function drawLegend() {
  const mode = $('colourBy').value;
  const show = mode !== 'risk';
  $('ramp').hidden = $('rampLabels').hidden = !show;
  if (!show) return;
  const prob = mode === 'pMod' || mode === 'pHigh';
  const stops = (prob ? [0.15, 0.4, 0.6, 0.8, 1].map((t) => interpolatePuRd(t)) : [0.18, 0.4, 0.6, 0.8, 1].map((t) => interpolateYlOrRd(t)));
  $('ramp').style.background = `linear-gradient(90deg, rgb(${CLEAR}) 0 12%, ${stops.join(',')})`;
  $('rampLabels').innerHTML = prob ? '<span>&lt;5%</span><span>50%</span><span>100%</span>'
    : `<span>clear</span><span>${T.low}</span><span>${T.moderate}</span><span>${T.high} ${UNIT}</span>`;
}

const fmtTime = (t, opts = {}) => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', ...opts });
const rel = (t, now) => {
  const h = Math.round((t - now) / H);
  if (h === 0) return 'now';
  const a = Math.abs(h), s = a >= 48 ? `${Math.round(a / 24)} days` : `${a} h`;
  return h > 0 ? `in ${s}` : `${s} ago`;
};
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// ----------------------------------------------------------------- map
const map = new MLMap({ container: 'map', style: CONFIG.map.style, center: CONFIG.map.center, zoom: CONFIG.map.zoom, attributionControl: { compact: true } });
map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true });
map.addControl(geolocate, 'top-right'); // its own button is hidden by CSS; our ◎ triggers it
await map.once('load');
const labelLayerId = CONFIG.map.labelLayerId ?? map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
const overlay = new MapLibreOverlay({
  interleaved: true, layers: [],
  // hover tooltips only where there is a mouse; touch screens get tap-to-open info cards
  getTooltip: ({ object, layer }) => (TOUCH.matches ? null : tooltip(object, layer?.id)),
});
map.addControl(overlay);

// --------------------------------------------------------------- state
const state = {
  river: null, coords: null, model: null, f: 0, live: true, playing: null,
  overflows: [], sightings: [], clubs: [], spot: null, favs: loadFavourites(),
  dataAt: 0, tideSource: '', problems: [], spotHours: null, spotKey: '',
};
const radius = () => Number($('radius').value);

// --------------------------------------------------------------- river
async function loadRiverCoords() {
  if (CONFIG.river.geojsonUrl) {
    try {
      const gj = await fetchJson(centrelineUrl); // bundled from Website/shared/river/data
      const g = gj.type === 'FeatureCollection' ? gj.features[0].geometry : gj.type === 'Feature' ? gj.geometry : gj;
      return g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates;
    } catch (e) { console.warn('Centreline GeoJSON unavailable, using waypoints', e); }
  }
  return THAMES_WAYPOINTS.map((w) => w.c);
}
state.coords = await loadRiverCoords();
state.river = buildRiver(state.coords, CONFIG.river.sampleSpacingKm);
setRiverSnap((p) => snapToRiver(state.river, p));
const segments = state.river.samples.slice(0, -1).map((s, i) => ({ i, path: [s.pos, state.river.samples[i + 1].pos], chainage: s.chainage }));
const placeLabels = THAMES_WAYPOINTS.filter((_, i) => i % 3 === 0);
const nearestPlace = (pos) => THAMES_WAYPOINTS.reduce((a, w) => (distKm(w.c, pos) < distKm(a.c, pos) ? w : a)).name;

// ----------------------------------------------------- model in a worker
const worker = new Worker(new URL('../../../shared/river/model/worker.js', import.meta.url), { type: 'module' });
let jobId = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data.snap);
};
const runInWorker = (inputs) => new Promise((resolve, reject) => {
  const id = ++jobId;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, coords: state.coords, waypoints: THAMES_WAYPOINTS, inputs });
});

// -------------------------------------------------------- data refresh
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('status').classList.add('busy');
  try {
    // One request to the Rain To Spill backend: overflows (Thames Water), EA flows, rain
    // forecast (Open-Meteo), tides (EasyTide), spill propensity (spill_event history) and the
    // team's per-overflow rainfall thresholds (analysis.service), which set each spill chance.
    $('status').textContent = 'Fetching live data…';
    const inp = await fetchJson(CONFIG.api.base + CONFIG.api.inputs, { timeoutMs: CONFIG.api.inputsTimeoutMs });
    const now = Date.now(); // model frames follow this browser's clock; data age = inp.now
    $('status').textContent = `Updating forecast (${CONFIG.uncertainty.members + 1} model runs)…`;
    const snap = await runInWorker({ now, overflows: inp.overflows, gauges: inp.gauges, highWaters: inp.highWaters, rain: inp.rain, propensity: inp.propensity, thresholds: inp.thresholds });
    Object.assign(state, { model: new ModelView(snap), overflows: inp.overflows, rain: inp.rain, tide: inp.highWaters, dataAt: inp.now,
      tideSource: inp.highWaters.source, problems: inp.problems ?? [], gaugeCount: inp.gauges.length, spotKey: '' });
    const m = state.model;
    Object.assign($('time'), { min: 0, max: m.F - 1 });
    if (state.live) state.f = m.frameAt(Date.now());
    $('time').value = state.f;
    updateStatus();
    renderSpot();
    renderFavs();
    render();
  } catch (e) {
    $('status').textContent = `Could not reach the Rain To Spill backend (${CONFIG.api.base}): ${e.message}`;
    console.error(e);
  } finally {
    refreshing = false;
    $('status').classList.remove('busy');
  }
}

function updateStatus() {
  const m = state.model;
  if (!m) return;
  // team top bar: "Live, updated HH:MM"
  const lu = document.getElementById('last-updated');
  if (lu) lu.textContent = `Live, updated ${new Date(state.dataAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}`;
  const o = state.overflows, n = (s) => o.filter((x) => x.status === s).length;
  const today = state.sightings.filter((s) => s.observedAt > Date.now() - 24 * H).length;
  // one short line; the rest is in About
  $('status').innerHTML = `<b>${n('discharging')}</b> spilling now · <b>${today}</b> sightings today · updated ${ago(state.dataAt)}` +
    (state.problems.length ? `<br><b>Unavailable: ${state.problems.join(', ')}</b>` : '');
  const ci = clubsInfo();
  $('aboutData').innerHTML = `Data updated ${ago(state.dataAt)} · ${n('offline')} overflow monitors offline · tide times: ${esc(state.tideSource)} · ` +
    `${m.M + 1} model runs in ${m.runMs < 1000 ? `${m.runMs} ms` : `${(m.runMs / 1000).toFixed(1)} s`} · ` +
    (ci?.count ? `${ci.count} river clubs in search${ci.generated ? ` (list built ${new Date(ci.generated).toLocaleDateString('en-GB')})` : ''}` : 'club list not built yet (run npm run river:clubs in Website/backend)');
}

// ----------------------------------------------------------- live clock
function setLive(on) {
  state.live = on;
  $('liveBadge').hidden = !on;
  $('nowBtn').disabled = on;
  if (on && state.model) { state.f = state.model.frameAt(Date.now()); $('time').value = state.f; render(); }
}
function tick() {
  const m = state.model;
  if (!m) return;
  if (state.live) {
    const f = m.frameAt(Date.now());
    if (f !== state.f) { state.f = f; $('time').value = f; render(); } else updateTimeLabel();
  }
  updateStatus();
  renderSpot();   // "right now" status follows the clock
  renderFavs();
  if (Date.now() - state.dataAt > CONFIG.refresh.dischargeMinutes * 60e3) refresh();
}
setInterval(tick, CONFIG.live.tickSeconds * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - state.dataAt > CONFIG.refresh.staleOnFocusMinutes * 60e3) refresh();
  tick();
});
function updateTimeLabel() {
  const t = state.model.frameTime(state.f);
  $('timeLabel').textContent = state.live ? `${fmtTime(Date.now())} — now` : `${fmtTime(t, { day: 'numeric', month: 'short' })} (${rel(t, Date.now())})`;
}

// ------------------------------------------------------------ rendering
function segmentValues() {
  const m = state.model, mode = $('colourBy').value, S = m.S, off = state.f * S, fc = $('showForecast').checked;
  if (mode === 'risk') return Array.from({ length: S }, (_, i) => riskOf(m.at(state.f, i)));
  const out = new Float32Array(S);
  if (mode === 'central') for (let i = 0; i < S; i++) out[i] = m.central.obs[off + i] + (fc ? m.central.fcst[off + i] : 0);
  else for (let i = 0; i < S; i++) out[i] = m.summary[mode][off + i];
  return out;
}

/** One line saying which rain rule sets an overflow's forecast spill chance (see CONFIG.forecast.thresholds). */
function triggerText(g) {
  if (g?.source === 'team') {
    return `Rain trigger from ${g.spills} past spills: from ${fmt2(g.minMm)} mm, typically ${fmt2(g.avgMm)} mm in ${g.windowH} h`;
  }
  return `Rain trigger: general rule (${CONFIG.forecast.r50mm} mm in ${CONFIG.forecast.accumHours} h); too few past spills with rain records`;
}
const CLUB_MIN_ZOOM = 11; // [PARAM] clubs appear on the map from this zoom (search finds them at any zoom)
function render() {
  const m = state.model;
  if (!m) return;
  updateTimeLabel();
  const mode = $('colourBy').value;
  const vals = segmentValues();
  const t = m.frameTime(state.f);
  const colour = mode === 'risk' ? (r) => RISK_RGB[r] : COLOUR[mode];
  const widthOf = mode === 'risk' ? (r) => (r === 'high' ? 9 : r === 'moderate' ? 7 : 4)
    : mode === 'central' || mode === 'p90' ? (v) => 4 + Math.min(8, v * 8) : (p) => 4 + p * 8;
  const siteColour = (s) => {
    if (s.status === 'offline') return [201, 208, 213, 235]; // pale with a dark ring (see getLineColor); key: "Monitor offline"
    if (s.status === 'discharging' && t <= m.now + H) return [192, 38, 45, 255];
    if (s.past48h && t <= m.now + 6 * H) return [230, 138, 0, 230];
    const p = (s.forecast ?? []).find((x) => Math.abs(x.t - t) < 0.6 * H)?.p ?? 0;
    if (t > m.now && p >= 0.15) return [123, 79, 214, 80 + p * 175];
    return [90, 110, 120, 140]; // key: "Not spilling"
  };
  const visibleSites = $('showQuiet').checked ? m.sites : m.sites.filter((s) => s.status !== 'not_discharging' || s.past48h || s.pSpill7d > 0.1);
  const sightingsNow = $('showSightings').checked
    ? state.sightings.filter((s) => s.observedAt <= Math.max(t, Date.now()) && s.observedAt >= t - CONFIG.sightings.showDays * 24 * H) : [];
  const spotPath = state.spot
    ? [{ path: state.river.samples.filter((s) => Math.abs(s.chainage - state.spot.chainage) <= radius()).map((s) => s.pos) }] : [];
  const trig = [state.f, mode, m.now, $('showForecast').checked];
  const zoom = map.getZoom();

  overlay.setProps({
    layers: [
      new PathLayer({ id: 'spot-stretch', beforeId: labelLayerId, data: spotPath, getPath: (d) => d.path, getColor: [15, 107, 143, 90],
        getWidth: 20, widthUnits: 'pixels', capRounded: true, jointRounded: true }),
      new PathLayer({ id: 'river-impact', beforeId: labelLayerId, data: segments, getPath: (d) => d.path,
        getColor: (d) => colour(vals[d.i]), getWidth: (d) => widthOf(vals[d.i]), widthUnits: 'pixels', capRounded: true, pickable: true,
        updateTriggers: { getColor: trig, getWidth: trig } }),
      new ScatterplotLayer({ id: 'clubs', data: state.clubs, visible: zoom >= CLUB_MIN_ZOOM, getPosition: (d) => d.position,
        getFillColor: [255, 255, 255, 230], getLineColor: [60, 80, 90, 220], stroked: true, lineWidthMinPixels: 1.5,
        getRadius: 4, radiusUnits: 'pixels', pickable: true }),
      new ScatterplotLayer({ id: 'overflows', data: visibleSites, getPosition: (d) => d.position, getFillColor: siteColour,
        getRadius: (d) => (d.status === 'discharging' ? 7 : 4.5), radiusUnits: 'pixels', stroked: true,
        getLineColor: (d) => (d.status === 'offline' ? [90, 110, 120, 255] : [255, 255, 255, 220]),
        lineWidthMinPixels: 1.5, pickable: true, updateTriggers: { getFillColor: [state.f, m.now] } }),
      new ScatterplotLayer({ id: 'sightings', data: sightingsNow, getPosition: (d) => d.position,
        getFillColor: (d) => [122, 75, 30, 255 - Math.min(180, ((Date.now() - d.observedAt) / H) * 1.2)],
        getRadius: (d) => 5 + d.severity * 2, radiusUnits: 'pixels', stroked: true, getLineColor: [255, 214, 102], lineWidthMinPixels: 2, pickable: true }),
      // saved spots are always on the map as labelled pins
      new ScatterplotLayer({ id: 'favs', data: state.favs, getPosition: (d) => d.position, getFillColor: [255, 255, 255],
        getLineColor: [15, 107, 143], stroked: true, lineWidthMinPixels: 3, getRadius: 7, radiusUnits: 'pixels', pickable: true }),
      new TextLayer({ id: 'fav-names', data: state.favs, getPosition: (d) => d.position, getText: (d) => `☆ ${d.name}`, getSize: 13,
        getColor: [15, 107, 143], getPixelOffset: [0, 18], fontFamily: 'system-ui, sans-serif', fontWeight: 700, characterSet: 'auto',
        outlineWidth: 3, outlineColor: [255, 255, 255], fontSettings: { sdf: true } }),
      new ScatterplotLayer({ id: 'spot', data: state.spot ? [state.spot] : [], getPosition: (d) => d.position, getFillColor: [15, 107, 143],
        getLineColor: [255, 255, 255], stroked: true, lineWidthMinPixels: 2, getRadius: 8, radiusUnits: 'pixels' }),
      new TextLayer({ id: 'places', data: placeLabels, getPosition: (d) => d.c, getText: (d) => d.name, getSize: 11, getColor: [40, 60, 70, 200],
        getPixelOffset: [0, -12], fontFamily: 'system-ui, sans-serif', visible: zoom < 10 }),
    ],
  });
}
map.on('zoomend', render);

// Same content for desktop hover tooltips and tap-to-open info cards
function describe(o, layerId) {
  const m = state.model;
  if (layerId === 'river-impact') {
    const r = m.at(state.f, o.i), info = riskInfo(riskOf(r));
    return `<b>${info.icon} ${info.label}</b> · ${fmtTime(r.t)}<br>${Math.round(o.chainage)} km from the source${o.chainage >= m.tidalLimitKm ? ' (tidal)' : ''}<br>` +
      `<span style="opacity:.75">Central ${fmt2(r.central)} ${UNIT} · likely ${fmt2(r.p10)}–${fmt2(r.p90)} · chance of moderate+ ${pct(r.pMod)}, high ${pct(r.pHigh)}</span>`;
  }
  if (layerId === 'overflows') {
    return `<b>${esc(o.name)}</b><br>Storm overflow · ${esc(o.receivingWater || '—')} (permit ${esc(o.id)})<br>Status: <b>${o.status.replace('_', ' ')}</b><br>` +
      (o.start ? `Last start: ${fmtTime(o.start)}<br>` : '') + (o.stop ? `Last stop: ${fmtTime(o.stop)}<br>` : '') +
      `Chance of a new spill: <b>${pct(o.pSpill24h)}</b> in 24 h · <b>${pct(o.pSpill7d)}</b> in 7 days<br>` +
      `<span style="opacity:.75">${triggerText(o.trigger)}</span>`;
  }
  if (layerId === 'sightings') {
    return `<b>Public sighting</b> · ${CONFIG.sightings.severities[o.severity - 1]}<br>${o.types.map(esc).join(', ')}<br>` +
      `Seen ${fmtTime(o.observedAt)} (${ago(o.observedAt)}) near ${esc(o.place)}` + (o.note ? `<br><i>"${esc(o.note)}"</i>` : '') +
      '<br><span style="opacity:.7">Unverified report</span>';
  }
  if (layerId === 'clubs') return `<b>${esc(o.name)}</b><br>${esc(o.categoryLabel)} · ${esc(o.place)}`;
  if (layerId === 'favs') return `<b>☆ ${esc(o.name)}</b> (saved spot)`;
  return null;
}
function tooltip(o, layerId) {
  if (!o || !state.model) return null;
  const html = describe(o, layerId);
  return html && { html: html + (layerId === 'clubs' || layerId === 'favs' ? '<br><span style="opacity:.7">Click for this stretch</span>' : '') };
}

// ------------------------------------------------------------ info card
let infoAction = null;
function openInfo(html, action = null) {
  $('infoBody').innerHTML = `<div id="infoTitle">${html}</div>` + (action ? `<p style="margin-top:8px"><button id="infoAct">${esc(action.label)}</button></p>` : '');
  infoAction = action;
  $('infoCard').hidden = false;
}
const closeInfo = () => { $('infoCard').hidden = true; infoAction = null; };
$('infoClose').addEventListener('click', closeInfo);
$('infoBody').addEventListener('click', (e) => { if (e.target.id === 'infoAct' && infoAction) { const a = infoAction; closeInfo(); a.run(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeInfo(); closeSaved(); } });
/** Short messages (e.g. "too far from the river") reuse the info card. */
const notice = (text) => openInfo(esc(text));

// =================================================== YOUR SPOT (priority)
function setSpot(position, source, opts = {}) {
  let sn = snapToRiver(state.river, position);
  // A searched town/neighbourhood/postcode opens the nearest stretch: move the spot onto the river
  // (up to CONFIG.spots.searchSnapKm away). Clubs and taps keep their exact position.
  if (['place', 'postcode'].includes(source) && sn.offKm > 0.2 && sn.offKm <= CONFIG.spots.searchSnapKm) {
    opts.snappedFromKm = sn.offKm;
    position = sn.pos;
    sn = snapToRiver(state.river, position);
  }
  const max = Math.max(CONFIG.alerts.maxOffRiverKm, 3);
  if (sn.offKm > max) {
    notice(`That spot is ${sn.offKm.toFixed(1)} km from the Thames — choose somewhere within ${max} km of the river.`);
    return false;
  }
  // Stretch length: a saved spot or link brings its own; otherwise the user's own choice if they
  // have made one; otherwise the default for how the spot was chosen (CONFIG.spots).
  if (opts.radius) $('radius').value = String(opts.radius);
  else if (!state.radiusChosen) $('radius').value = String(source === 'click' ? CONFIG.spots.clickRadiusKm : CONFIG.spots.defaultRadiusKm);
  const place = nearestPlace(position);
  state.spot = { position, source, chainage: sn.chainage, offKm: sn.offKm, place, name: opts.name ?? null };
  state.spotKey = '';
  closeInfo();
  $('emptyState').hidden = true;
  $('statusCard').hidden = false;
  $('shareBlock').hidden = false;
  $('saveRow').hidden = true;
  updateButtons();
  render();
  renderSpot();
  if (opts.snappedFromKm) notice(`Showing the stretch of the Thames nearest ${opts.name ?? 'that place'} (${opts.snappedFromKm.toFixed(1)} km away).`);
  if (opts.fly) map.flyTo({ center: position, zoom: Math.max(map.getZoom(), source === 'click' ? CONFIG.spots.clickZoom : CONFIG.spots.flyZoom) });
  if (PHONE.matches && $('panel').dataset.snap === 'peek' && source !== 'link' && source !== 'favourite-auto') snapSheet('half');
  return true;
}

function spotHours() {
  const m = state.model, s = state.spot;
  const key = `${m.now}|${s.chainage}|${radius()}`;
  if (state.spotKey !== key) { state.spotHours = stretchHours(m, s.chainage, radius()); state.spotKey = key; }
  return state.spotHours;
}
const spotTitle = () => state.spot.name ?? `Near ${state.spot.place}`;

let lastAnnounced = '';
function renderSpot() {
  const m = state.model, s = state.spot;
  if (!s) return;
  const title = spotTitle();
  $('spotName').textContent = `${title} · ± ${radius()} km`;
  $('reportSpot').textContent = `Your report will be placed at: ${title}.`;
  $('alertSpot').textContent = `Updates for: ${title}, ± ${radius()} km of river.`;
  if (!m) { $('statusLabel').textContent = 'Loading…'; return; }

  const hours = spotHours();
  const fNow = m.frameAt(Date.now());
  const now = hours[fNow];
  const info = riskInfo(now.risk);
  $('statusCard').dataset.risk = now.risk;
  // only touch the live region when the status changes, so screen readers announce changes, not every tick
  if (lastAnnounced !== `${title}|${now.risk}`) {
    lastAnnounced = `${title}|${now.risk}`;
    $('statusLabel').innerHTML = `<span class="risk-icon" aria-hidden="true">${info.icon}</span> ${info.label}`;
  }
  $('statusSure').textContent = `${CONFIG.risk.certaintyLabel}: ${now.confidence.word}`;
  $('riskMeaning').innerHTML = `${esc(CONFIG.risk.meaning)} <a href="method.html#traffic-light" target="_blank" rel="noopener">How it's worked out</a>`;
  $('advice').textContent = info.advice;

  // map status card (desktop): the answer stays visible while you pan the map
  const ms = $('mapStatus');
  ms.hidden = false;
  ms.dataset.risk = now.risk;
  ms.innerHTML = `<span>${info.icon} Now: ${info.label}</span><span class="n">${esc(title)} · ± ${radius()} km</span>`;

  // Where on the stretch is the worst point? (the stretch takes its riskiest point's status)
  const offsetKm = now.bin * m.sp - s.chainage;
  $('wherePoint').textContent = now.risk !== 'low' && Math.abs(offsetKm) >= 0.75
    ? `Worst point: about ${Math.round(Math.abs(offsetKm))} km ${offsetKm > 0 ? 'downstream' : 'upstream'} of your spot.`
    : '';
  const nx = nextChange(hours, Date.now(), 48);
  // The panel only speaks up when the light is about to change (the 24-hour strip and 7-day
  // chips already show "no change"). The share image and embed card have no strip, so they
  // keep the full sentence (state.nextLine).
  $('nextLine').textContent = nx ? `${nx.rising ? '▲' : '▼'} ${riskInfo(nx.to).short} from about ${fmtTime(nx.t)}` : '';
  state.nextLine = nx
    ? `${nx.rising ? '▲ Rising' : '▼ Easing'} to ${riskInfo(nx.to).label.toLowerCase()} around ${fmtTime(nx.t)}.`
    : `No change expected in the next 48 hours.`;

  const days = stretchDays(hours, Date.now());
  state.spotDays = days;
  state.spotNow = now;
  $('week').innerHTML = weekHtml(days);
  const day = next24({ model: m, hours, rain: state.rain, tide: state.tide, river: state.river, chainageKm: s.chainage });
  state.spotDay = day;
  $('strip').innerHTML = stripHtml(day);
  $('daySummary').innerHTML = daySummaryHtml(day);
  if (PHONE.matches && sheet.dataset.snap === 'half' && !sheet.classList.contains('dragging')) setSheetHeight(SNAP.half());

  $('hereText').innerHTML = `Now: central ${fmt2(now.central)} ${UNIT}, likely ${fmt2(now.p10)}–${fmt2(now.p90)} ${UNIT}; ` +
    `chance of moderate or worse ${pct(now.pMod)}, high ${pct(now.pHigh)}. ${Math.round(s.chainage)} km from the source` +
    `${s.chainage >= m.tidalLimitKm ? ', tidal river' : ''}.`;
  drawChart(hours);

  const warn = s.offKm < 2 && now.risk === 'high';
  $('alert').hidden = !warn || PHONE.matches; // on phones the sheet's peek already shows it
  if (warn) $('alert').textContent = `${info.icon} ${info.label} at ${title} right now. ${info.advice}`;
  if (EMBED) renderEmbed(now, days);
}
function weekHtml(days) {
  return days.map((d) => {
    const i = riskInfo(d.risk);
    const detail = d.risk === 'low' ? 'no sewage expected' : `${i.short.toLowerCase()} for about ${d.hoursAtRisk} h, worst around ${fmtTime(d.worst.t, { weekday: undefined })}`;
    return `<li class="day" data-risk="${d.risk}" title="${d.day} ${d.date}: ${i.label} — ${detail}">
      <span class="d">${d.day}</span><span class="i" aria-hidden="true">${i.icon}</span><span class="l">${i.short}</span>
      <span class="visually-hidden">${d.day} ${d.date}: ${i.label}, ${detail}.</span></li>`;
  }).join('');
}

// ---------------------------------------------------- next 24 hours strip
const hm = (t) => {
  const s = new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  return day(t) === day(Date.now()) ? s : `${s} ${new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short' })}`;
};
const toHour = (t) => Math.round(t / H) * H; // frame times are not on the hour; summaries read better rounded
const hh = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const RAIN_WORD = { dry: 'dry', light: 'light rain', moderate: 'moderate rain', heavy: 'heavy rain' };
function stripHtml(day) {
  const span = day.to - day.from, x = (t) => ((t - day.from) / span) * 100;
  const R = CONFIG.context.rain;
  const risk = day.hours.map((h) => `<i data-risk="${h.risk}" title="${hh(h.t)}: ${riskInfo(h.risk).label}"></i>`).join('');
  const rain = day.hours[0].rain === null ? '<span class="na">No rain forecast for this stretch</span>'
    : day.hours.map((h) => `<i data-c="${h.rainClass}" style="--v:${h.rainClass === 'dry' ? 0 : Math.max(0.18, Math.min(1, Math.sqrt(h.rain / R.heavy)))}" title="${hh(h.t)}: ${RAIN_WORD[h.rainClass]}${h.rainClass === 'dry' ? '' : `, ${h.rain.toFixed(1)} mm/h`}"></i>`).join('');
  const td = day.tide;
  let tide;
  if (!td.tidal) tide = '<span class="na">Not tidal here (above Teddington Lock)</span>';
  else if (td.unknown) tide = '<span class="na">Tide times unavailable</span>';
  else {
    const pts = td.line.filter((p) => p.level !== null).map((p) => `${(x(p.t) * 2.4).toFixed(1)},${(34 - p.level * 28).toFixed(1)}`).join(' ');
    tide = `<svg viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>` +
      td.events.map((e) => `<span class="tl ${e.type}" style="left:${Math.min(80, Math.max(0, x(e.t) - 6))}%">${e.type === 'high' ? '▲' : '▼'} ${hh(e.t)}</span>`).join('');
  }
  // no data: the row shows one line of text instead of the chart (keeps rows from overlapping)
  const noRain = day.hours[0].rain === null, noTide = !td.tidal || td.unknown;
  const allDry = !noRain && day.hours.every((h) => h.rainClass === 'dry'); // an empty row would look broken
  const tickH = CONFIG.context.tickHours;
  const ticks = day.hours.filter((_, i) => i % tickH === 0)
    .map((h, k) => `<span style="left:${x(h.t)}%">${k === 0 ? 'Now' : hh(toHour(h.t)).slice(0, 2)}</span>`).join('');
  return `<div class="srow"><span class="lab">Sewage</span><div class="cells">${risk}</div></div>
    <div class="srow"><span class="lab">Rain</span><div class="cells rain${noRain || allDry ? ' nodata' : ''}">${allDry ? '<span class="na">No rain expected</span>' : rain}</div></div>
    <div class="srow"><span class="lab">Tide</span><div class="tide${noTide ? ' nodata' : ''}">${tide}</div></div>
    <div class="srow axis"><span class="lab"></span><div class="ticks" aria-hidden="true">${ticks}</div></div>
    ${(noRain || allDry) && noTide ? '' : `<p class="strip-key" aria-hidden="true">${noRain || allDry ? '' : 'Rain <i class="rk light"></i>light <i class="rk moderate"></i>moderate <i class="rk heavy"></i>heavy'}${noRain || allDry || noTide ? '' : ' · '}${noTide ? '' : 'Tide ▲ high ▼ low'}</p>`}`;
}
function daySummaryHtml(day) {
  const runs = riskRuns(day.hours);
  const sew = runs.length === 1 ? `${riskInfo(runs[0].risk).label} for the next 24 hours.`
    : runs.map((r, i) => (i === 0 ? `${riskInfo(r.risk).label} until ${hm(toHour(r.to))}`
      : i === runs.length - 1 ? `then ${riskInfo(r.risk).short.toLowerCase()}` : `then ${riskInfo(r.risk).short.toLowerCase()} until ${hm(toHour(r.to))}`)).join(', ') + '.';
  const r = day.rain;
  const rain = !r ? 'Rain forecast unavailable for this stretch.'
    : !r.wetHours ? 'Dry — no rain forecast near this stretch.'
    : `${cap(RAIN_WORD[r.peakClass])} at times, mainly ${hm(toHour(r.firstWet))}–${hm(toHour(r.lastWet))}; heaviest around ${hm(toHour(r.peakT))} (${r.peak.toFixed(1)} mm/h). About ${Math.round(r.total)} mm in total.` +
      (r.total >= CONFIG.context.wetDayMm ? ' Rain like this can set off overflows within a few hours.' : '');
  const t = day.tide;
  const lb = (type) => t.events.filter((e) => e.type === type).map((e) => hm(e.t)).join(', ') || 'none';
  const tide = !t.tidal ? 'Not tidal here: above Teddington Lock the river only flows downstream.'
    : t.unknown ? 'Tide times unavailable right now.'
    : `${t.rising ? 'Rising now — water is flowing upstream, so sewage from overflows downstream can reach you.' : 'Falling now — water is flowing downstream, towards the sea.'} High ${lb('high')} · low ${lb('low')}${t.approx ? ' (approx.)' : ''}.`;
  return `<li><span class="ic" aria-hidden="true">${riskInfo(runs[0].risk).icon}</span><span><b>Sewage:</b> ${esc(sew)}</span></li>
    <li><span class="ic" aria-hidden="true">☂</span><span><b>Rain:</b> ${esc(rain)}</span></li>
    <li><span class="ic" aria-hidden="true">≈</span><span><b>Tide:</b> ${esc(tide)}</span></li>`;
}

let chart = null;
function drawChart(hours) {
  if (!$('details').open) return; // only when the user opens Details
  chart ??= echarts.init($('chart'), null, { renderer: 'canvas' });
  chart.setOption({
    animation: false,
    grid: { left: 40, right: 36, top: 24, bottom: 22 },
    legend: { top: 0, textStyle: { fontSize: 10 }, itemHeight: 8, data: ['Central', 'Chance moderate+'] },
    tooltip: { trigger: 'axis', formatter: (ps) => { const r = hours[ps[0].dataIndex]; return `${fmtTime(r.t, { day: 'numeric', month: 'short' })}<br>${riskInfo(r.risk).label}<br>Central ${fmt2(r.central)} ${UNIT}<br>Likely ${fmt2(r.p10)}–${fmt2(r.p90)}<br>Chance moderate+ ${pct(r.pMod)}`; } },
    xAxis: { type: 'time', axisLabel: { fontSize: 10, formatter: { day: '{ee}', hour: '{HH}:{mm}' } } },
    yAxis: [{ type: 'value', name: UNIT, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.3 } } },
      { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
    series: [
      { name: 'p10', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, data: hours.map((r) => [r.t, r.p10]), silent: true },
      { name: 'band', type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(192,38,45,0.18)' }, data: hours.map((r) => [r.t, Math.max(0, r.p90 - r.p10)]), silent: true },
      { name: 'Central', type: 'line', symbol: 'none', color: '#c0262d', lineStyle: { width: 2 }, data: hours.map((r) => [r.t, r.central]),
        markLine: { symbol: 'none', silent: true, label: { formatter: 'now', fontSize: 10 }, lineStyle: { color: '#5b6b77', type: 'dashed' }, data: [{ xAxis: Date.now() }] } },
      { name: 'Chance moderate+', type: 'bar', yAxisIndex: 1, barWidth: 2, color: 'rgba(123,79,214,0.45)', data: hours.map((r) => [r.t, Math.round(r.pMod * 100)]) },
    ],
  }, true);
}
$('details').addEventListener('toggle', () => { if ($('details').open && state.spot && state.model) { drawChart(spotHours()); chart?.resize(); } });
$('radius').addEventListener('change', () => { state.radiusChosen = true; state.spotKey = ''; render(); renderSpot(); });

// ---------------------------------------------- spot search (on the map)
const KIND_ICON = { favourite: '☆', club: '⚑', place: '⌖', postcode: '✉', coordinates: '⌖', error: 'ⓘ', loading: '…' };
let searchTimer = null, searchSeq = 0, suggestions = [], active = -1;
function showSuggestions(list) {
  suggestions = list; active = -1;
  const ul = $('suggest');
  let lastGroup = null, html = '';
  list.forEach((s, i) => {
    if (s.group !== lastGroup) { html += `<li class="grp" role="presentation">${esc(s.group)}</li>`; lastGroup = s.group; }
    html += `<li role="option" id="sg${i}" data-i="${i}" aria-selected="false" class="opt${s.position ? '' : ' disabled'}">
      <span class="k" aria-hidden="true">${KIND_ICON[s.kind] ?? '⌖'}</span><span class="t">${esc(s.label)}</span>${s.sub ? `<span class="s">${esc(s.sub)}</span>` : ''}</li>`;
  });
  ul.innerHTML = html;
  ul.hidden = !list.length;
  $('spotSearch').setAttribute('aria-expanded', String(!!list.length));
  $('spotSearch').removeAttribute('aria-activedescendant');
}
function pickSuggestion(i) {
  const s = suggestions[i];
  if (!s?.position) return;
  showSuggestions([]);
  $('spotSearch').value = s.label;
  $('spotSearch').blur(); // closes the phone keyboard
  const name = s.kind === 'favourite' ? s.fav.name : ['place', 'club', 'postcode'].includes(s.kind) ? s.label : null;
  setSpot(s.position, s.kind, { name, radius: s.fav?.radius, fly: true });
}
// Local matches (saved spots, clubs.json, riverside places, postcodes) show at once; the online
// gazetteers (OS Open Names + OpenStreetMap/Photon) are asked after a short pause and merged in.
let remoteCtl = null, remoteTimer = null;
async function runSearch(q) {
  const seq = ++searchSeq;
  remoteCtl?.abort(); clearTimeout(remoteTimer);
  const local = await searchSpots(q, state.favs);
  if (seq !== searchSeq) return; // ignore slow results for older keystrokes
  const wantRemote = q.trim().length >= CONFIG.spots.remoteMinChars && (CONFIG.spots.placesUrl || CONFIG.spots.photonUrl)
    && !local.some((l) => l.kind === 'postcode' || l.kind === 'coordinates');
  showSuggestions(wantRemote ? [...local, { group: local.length ? 'More places' : 'Places', label: 'Searching places and clubs…', position: null, kind: 'loading' }] : local);
  if (!wantRemote) return;
  remoteTimer = setTimeout(async () => {
    remoteCtl = new AbortController();
    try {
      const remote = await searchRemote(q, remoteCtl.signal);
      if (seq !== searchSeq) return;
      const merged = mergeSuggestions(local, remote);
      showSuggestions(merged.length ? merged
        : [{ group: 'Places', label: `No place or club called “${q.trim()}” near the Thames — try a nearby town, bridge or postcode`, position: null, kind: 'error' }]);
    } catch (e) { if (e.name !== 'AbortError' && seq === searchSeq) showSuggestions(local); }
  }, CONFIG.spots.remoteDebounceMs);
}
$('spotSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  // [PARAM] 120 ms debounce for local matches; postcode lookups wait 300 ms
  searchTimer = setTimeout(() => runSearch(q), /\d/.test(q) ? 300 : 120);
});
$('spotSearch').addEventListener('focus', () => { closeSaved(); if ($('spotSearch').value.trim()) runSearch($('spotSearch').value); });
$('spotSearch').addEventListener('keydown', (e) => {
  if (!suggestions.length) return;
  const opts = [...$('suggest').querySelectorAll('.opt')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    opts.forEach((li, i) => { li.classList.toggle('active', i === active); li.setAttribute('aria-selected', String(i === active)); });
    opts[active]?.scrollIntoView({ block: 'nearest' });
    $('spotSearch').setAttribute('aria-activedescendant', `sg${active}`);
  } else if (e.key === 'Enter') { e.preventDefault(); pickSuggestion(active >= 0 ? active : suggestions.findIndex((s) => s.position)); }
  else if (e.key === 'Escape') showSuggestions([]);
});
// pointerdown (not click) so the choice lands before the input's blur hides the list
$('suggest').addEventListener('pointerdown', (e) => { const li = e.target.closest('.opt'); if (li) { e.preventDefault(); pickSuggestion(Number(li.dataset.i)); } });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#searchBox')) showSuggestions([]); });

// -------------------------------------------------------- locate me
let locateAsked = false;
$('locateBtn').addEventListener('click', () => { closeSaved(); locateAsked = true; geolocate.trigger(); });
geolocate.on('geolocate', (e) => {
  const p = [e.coords.longitude, e.coords.latitude];
  // [ASSUMPTION] Follow the GPS only when the user asked (◎) or the current spot came from GPS;
  // never replace a club/place/saved spot the user chose while tracking runs in the background.
  if (locateAsked || (state.spot?.source === 'gps' && distKm(state.spot.position, p) > 0.1)) {
    const fly = locateAsked;
    locateAsked = false;
    setSpot(p, 'gps', { name: 'My location', fly });
  }
});
geolocate.on('error', (e) => notice(`Location unavailable (${e.message}). Search for your club or place, or tap the river instead.`));

// -------------------------------------------------------- map taps
map.on('click', (e) => {
  if (!state.model) return;
  closeSaved();
  const hit = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: TOUCH.matches ? 12 : 6, layerIds: ['favs', 'clubs', 'sightings', 'overflows'] });
  const id = hit?.layer?.id;
  if (id === 'favs') { openFav(hit.object); return; }
  if (id === 'clubs') {
    const c = hit.object;
    openInfo(describe(c, 'clubs') + (c.website ? `<br><a href="${esc(c.website)}" target="_blank" rel="noopener">Club website ↗</a>` : ''),
      EMBED ? null : { label: 'Use as my spot', run: () => setSpot(c.position, 'club', { name: c.name }) });
    return;
  }
  if (id === 'sightings' || id === 'overflows') { openInfo(describe(hit.object, id)); return; }
  if (EMBED) return; // the embedded map is for looking; the spot is set by the club
  setSpot([e.lngLat.lng, e.lngLat.lat], 'click', { fly: true });
});

// ------------------------------------------------------- saved spots
function renderFavs() {
  const m = state.model;
  $('favEmpty').hidden = !!state.favs.length;
  $('favList').innerHTML = state.favs.map((f) => {
    let risk = null;
    if (m) { const sn = snapToRiver(state.river, f.position); risk = stretchAt(m, sn.chainage, f.radius ?? 3, m.frameAt(Date.now())).risk; }
    const i = risk ? riskInfo(risk) : null;
    return `<li data-risk="${risk ?? ''}" role="none"><button class="fav-open" role="menuitem" data-id="${f.id}">
        <span class="key ${risk ?? ''}" aria-hidden="true">${i?.icon ?? '…'}</span>
        <span class="fav-name">${esc(f.name)}</span><span class="fav-status">${i ? i.short : ''}</span></button>
        <button class="fav-del" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">✕</button></li>`;
  }).join('');
  $('savedBtn').textContent = state.favs.length ? '★' : '☆';
}
function openSaved(withSave = false) {
  showSuggestions([]);
  closeInfo();
  renderFavs();
  $('savedMenu').hidden = false;
  $('savedBtn').setAttribute('aria-expanded', 'true');
  $('saveRow').hidden = !withSave;
  if (withSave) {
    $('saveName').value = state.spot.name && state.spot.name !== 'My location' ? state.spot.name : state.spot.place;
    $('saveName').focus(); $('saveName').select();
  } else $('savedMenu').querySelector('.fav-open')?.focus();
}
function closeSaved() {
  if ($('savedMenu').hidden) return;
  $('savedMenu').hidden = true;
  $('savedBtn').setAttribute('aria-expanded', 'false');
}
function openFav(f, source = 'favourite') { closeSaved(); setSpot(f.position, source, { name: f.name, radius: f.radius, fly: true }); }
$('savedBtn').addEventListener('click', () => ($('savedMenu').hidden ? openSaved(false) : closeSaved()));
$('saveSpot').addEventListener('click', () => { if (state.spot) openSaved(true); });
$('favList').addEventListener('click', (e) => {
  const open = e.target.closest('.fav-open'), del = e.target.closest('.fav-del');
  if (open) openFav(state.favs.find((f) => f.id === open.dataset.id));
  if (del) { state.favs = removeFavourite(state.favs, del.dataset.id); renderFavs(); render(); }
});
const confirmSave = () => {
  const name = $('saveName').value.trim().slice(0, 40) || state.spot.place;
  const { list, saved } = addFavourite(state.favs, { name, position: state.spot.position, radius: radius() });
  state.favs = list;
  state.spot.name = name;
  $('saveRow').hidden = true;
  closeSaved();
  notice(saved ? `Saved "${name}". It's pinned on the map and under ★ (on this device only).` : 'Could not save: this browser is blocking storage.');
  renderFavs(); renderSpot(); render();
};
$('saveConfirm').addEventListener('click', confirmSave);
$('saveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSave(); });
$('mapStatus').addEventListener('click', () => { setPanelClosed(false); selectTab('status'); $('statusCard').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('statusLabel').focus?.(); });

// ------------------------------------------------------- share / export
const spotLabel = () => state.spot.name ?? `near ${state.spot.place}`;
const fileBase = () => `thames-outlook-${spotLabel().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
$('shareBtn').addEventListener('click', async () => {
  if (!state.model) return;
  const s = { ...state.spot, name: spotLabel() };
  const url = spotUrl(s, radius());
  const png = await outlookCard(s, radius(), state.spotNow, state.spotDays, state.nextLine);
  const r = await shareOutlook({ url, text: shareText(s, radius(), state.spotNow, state.spotDays), png });
  if (r === 'failed') showLinkForCopy(url);
  else $('shareMsg').textContent = r === 'copied' ? 'Outlook and link copied — paste it anywhere.' : r === 'shared' ? 'Shared.' : '';
});
// Clipboard can be refused (unfocused page, in-app browsers): fall back to a selectable field.
function showLinkForCopy(text, target = $('shareMsg'), label = 'Copy this link') {
  target.innerHTML = `${label}: <input class="copy-field" readonly value="${esc(text)}" aria-label="${esc(label)}">`;
  const f = target.querySelector('input');
  f.focus(); f.select();
}
$('copyBtn').addEventListener('click', async () => {
  const url = spotUrl({ ...state.spot, name: spotLabel() }, radius());
  try {
    await navigator.clipboard.writeText(url);
    $('shareMsg').textContent = 'Link copied. It opens the map on this stretch.';
  } catch { showLinkForCopy(url); }
});
$('pngBtn').addEventListener('click', async () => {
  if (!state.model) return;
  download(`${fileBase()}.png`, await outlookCard({ ...state.spot, name: spotLabel() }, radius(), state.spotNow, state.spotDays, state.nextLine));
  $('shareMsg').textContent = 'Image downloaded.';
});
$('csvBtn').addEventListener('click', () => {
  if (!state.model) return;
  const hours = spotHours().filter((h) => h.t >= Date.now() - 30 * 60e3);
  download(`${fileBase()}.csv`, outlookCsv({ ...state.spot, name: spotLabel() }, radius(), hours), 'text/csv');
  $('shareMsg').textContent = 'Hour-by-hour CSV downloaded (opens in Excel or Sheets).';
});

// ------------------------------------------------- embed code generator
function embedUrl(style) {
  const u = new URL(spotUrl({ ...state.spot, name: $('embedName').value.trim().slice(0, 40) || spotLabel() }, radius()));
  u.searchParams.set('embed', style);
  return u.toString();
}
function updateEmbedCode() {
  const style = document.querySelector('input[name="embedStyle"]:checked').value;
  const name = $('embedName').value.trim() || spotLabel();
  const url = embedUrl(style);
  const h = CONFIG.embed.heights[style];
  $('embedCode').value = `<iframe src="${esc(url)}" title="Thames sewage status – ${esc(name)}" width="100%" height="${h}" ` +
    `style="border:0;${style === 'card' ? 'max-width:480px;' : ''}" loading="lazy"></iframe>`;
  $('embedPreview').href = url;
}
$('embedBtn').addEventListener('click', () => {
  if (!state.spot) return;
  $('embedName').value = state.spot.name && state.spot.name !== 'My location' ? state.spot.name : `Thames at ${state.spot.place}`;
  $('embedMsg').textContent = '';
  updateEmbedCode();
  $('embedDlg').showModal();
});
$('embedDlg').addEventListener('input', updateEmbedCode);
$('embedCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('embedCode').value); $('embedMsg').textContent = 'Code copied — paste it into an HTML/Embed block on your site.'; }
  catch { $('embedCode').focus(); $('embedCode').select(); $('embedMsg').textContent = 'Press Ctrl+C (or ⌘C) to copy the selected code.'; }
});

// ------------------------------------------------------------ embed view
function renderEmbed(now, days) {
  const card = $('embedCard');
  const info = riskInfo(now.risk);
  card.hidden = false;
  card.dataset.risk = now.risk;
  const full = new URL(spotUrl({ ...state.spot, name: spotLabel() }, radius()));
  card.innerHTML = `
    <h3 class="sec-h">Right now <span class="sec-sub">· Sewage risk</span></h3>
    <div class="status-top" data-risk="${now.risk}">
      <div class="light" aria-hidden="true"><span class="lamp high"></span><span class="lamp moderate"></span><span class="lamp low"></span></div>
      <div><p class="spot-name">${esc(spotTitle())} · ± ${radius()} km</p>
        <p class="status-label" data-risk="${now.risk}"><span class="risk-icon" aria-hidden="true">${info.icon}</span> ${info.label}</p>
        <p class="small">${esc(CONFIG.risk.certaintyLabel)}: ${esc(now.confidence.word)}</p></div>
    </div>
    <p class="advice">${esc(info.advice)}</p>
    <p class="risk-meaning">${esc(CONFIG.risk.meaning)}</p>
    <h3 class="sec-h">Next 24 hours <span class="sec-sub">· Sewage risk each hour</span></h3>
    <div class="strip">${stripHtml(state.spotDay)}</div>
    <ul class="day-sum">${daySummaryHtml(state.spotDay)}</ul>
    <h3 class="sec-h">Next 7 days <span class="sec-sub">· Highest sewage risk each day</span></h3>
    <ol class="week" aria-label="Today and the next 7 days">${weekHtml(days)}</ol>
    <p class="small next">${esc(state.nextLine)}</p>
    <p><a href="${esc(full)}" target="_blank" rel="noopener"><b>Open full 7-day forecast ↗</b></a></p>
    <div class="embed-foot"><span>Model estimate, not a water test · updated ${ago(state.dataAt)}</span>
      <a href="${esc(new URL('method.html#live-map', location.href))}" target="_blank" rel="noopener">How it works</a></div>`;
  document.documentElement.style.setProperty('--embed-card-h', `${card.offsetHeight + 16}px`);
  if (EMBED === 'map') map.resize();
}

// ------------------------------------------------------ citizen sightings
async function loadSightings() {
  try {
    const gj = await fetchJson(`${CONFIG.sightings.apiBase}/sightings?days=${CONFIG.sightings.showDays}`, { timeoutMs: 8000 });
    state.sightings = gj.features.map((f) => ({ ...f.properties, position: f.geometry.coordinates }));
    render();
  } catch { /* alert server not running: sightings just don't show */ }
}
CONFIG.sightings.types.forEach((t, i) => $('sightTypes').insertAdjacentHTML('beforeend', `<label><input type="checkbox" value="${esc(t)}" id="st${i}"> ${esc(t)}</label>`));
CONFIG.sightings.severities.forEach((s, i) => $('sightSeverity').insertAdjacentHTML('beforeend', `<label><input type="radio" name="sev" value="${i + 1}" ${i === 1 ? 'checked' : ''}> ${esc(s)}</label>`));
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
$('sightTime').value = $('sightTime').max = localNow();
$('eaLink').href = CONFIG.sightings.officialReportUrl;
$('eaPhone').textContent = CONFIG.sightings.officialPhone;
$('eaPhone').href = `tel:${CONFIG.sightings.officialPhone.replace(/\s/g, '')}`;

// reCAPTCHA v3: loaded only when the Report tab is opened (fewer third-party cookies for everyone else)
const SITE_KEY = CONFIG.sightings.recaptchaSiteKey;
let captchaReady = null;
function loadCaptcha() {
  if (!SITE_KEY) return Promise.resolve(null);
  captchaReady ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}`, async: true });
    s.onload = () => window.grecaptcha.ready(() => resolve(window.grecaptcha));
    s.onerror = () => { captchaReady = null; reject(new Error('reCAPTCHA failed to load')); };
    document.head.append(s);
  });
  return captchaReady;
}

$('sightBtn').addEventListener('click', async () => {
  const msg = $('sightMsg');
  const types = [...$('sightTypes').querySelectorAll('input:checked')].map((x) => x.value);
  if (!types.length) { msg.className = 'small err'; msg.textContent = 'Tick at least one thing you saw.'; return; }
  msg.className = 'small'; msg.textContent = 'Sending…';
  $('sightBtn').disabled = true;
  try {
    // Token is requested at submit time: tokens expire after two minutes.
    const g = await loadCaptcha();
    const captcha = g ? await g.execute(SITE_KEY, { action: CONFIG.sightings.recaptchaAction }) : null;
    const res = await fetch(`${CONFIG.sightings.apiBase}/sightings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lon: state.spot.position[0], lat: state.spot.position[1], types,
        severity: Number(document.querySelector('input[name="sev"]:checked').value),
        observedAt: new Date($('sightTime').value).toISOString(), note: $('sightNote').value, captcha }),
    });
    const json = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    msg.className = `small ${res.ok ? 'ok' : 'err'}`;
    msg.textContent = res.ok ? 'Thanks — your sighting is now on the map for other river users.' : json.error;
    if (res.ok) { $('sightNote').value = ''; $('sightTypes').querySelectorAll('input').forEach((x) => (x.checked = false)); loadSightings(); }
  } catch (e) {
    msg.className = 'small err'; msg.textContent = e.message.includes('reCAPTCHA') ? 'Spam check could not load — check your connection or content blocker.' : 'Report server unreachable. Is it running?';
  } finally { updateButtons(); }
});

// ------------------------------------------------------- WhatsApp sign-up
CONFIG.activities.forEach((a) => $('activity').add(new Option(a, a)));
function updateButtons() {
  $('alertBtn').disabled = !($('alertConsent').checked && state.spot && $('alertPhone').value.trim());
  $('sightBtn').disabled = !state.spot;
  $('saveSpot').disabled = !state.spot;
  $('reportSpot').hidden = $('alertSpot').hidden = false;
  if (!state.spot) {
    $('reportSpot').textContent = 'Choose your spot first: search above the map, press ◎, or tap the river.';
    $('alertSpot').textContent = 'Choose your spot first: search above the map, press ◎, or tap the river.';
  }
}
['alertConsent', 'alertPhone'].forEach((id) => $(id).addEventListener('input', updateButtons));
$('alertBtn').addEventListener('click', async () => {
  const msg = $('alertMsg');
  msg.className = 'small'; msg.textContent = 'Sending…';
  $('alertBtn').disabled = true;
  try {
    const res = await fetch(`${CONFIG.alerts.apiBase}/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: $('alertPhone').value, lon: state.spot.position[0], lat: state.spot.position[1], radiusKm: radius(),
        threshold: $('alertLevel').value, activity: $('activity').value, name: state.spot.name, consent: $('alertConsent').checked }),
    });
    const json = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    msg.className = `small ${res.ok ? 'ok' : 'err'}`;
    msg.textContent = res.ok ? json.message + (json.dryRun ? ' (test mode: nothing was actually sent)' : '') : json.error;
  } catch {
    msg.className = 'small err'; msg.textContent = 'Alert server unreachable. Is it running?';
  } finally { updateButtons(); }
});

// ------------------------------------------------------------------ tabs
const TABS = ['status', 'report', 'alerts'];
function selectTab(name, focus = false) {
  for (const t of TABS) {
    const on = t === name;
    $(`t-${t}`).setAttribute('aria-selected', String(on));
    $(`t-${t}`).tabIndex = on ? 0 : -1;
    $(`tab-${t}`).hidden = !on;
  }
  if (focus) $(`t-${name}`).focus();
  if (name === 'report') { $('captchaNote').hidden = !SITE_KEY; loadCaptcha().catch(() => {}); }
  if (PHONE.matches && name !== 'status' && $('panel').dataset.snap !== 'full') snapSheet('full'); // forms need the room
}
TABS.forEach((t) => $(`t-${t}`).addEventListener('click', () => selectTab(t)));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = TABS.findIndex((t) => $(`t-${t}`).getAttribute('aria-selected') === 'true');
  const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (k) { e.preventDefault(); selectTab(TABS[(i + k + TABS.length) % TABS.length], true); }
  if (e.key === 'Home') { e.preventDefault(); selectTab(TABS[0], true); }
  if (e.key === 'End') { e.preventDefault(); selectTab(TABS[TABS.length - 1], true); }
});
$('aboutBtn').addEventListener('click', () => { updateStatus(); $('about').showModal(); });

// ------------------------------------------- phone bottom sheet (≤ 700px)
// [PARAM] three positions. Peek: the traffic light only. Half: light + time slider + week. Full: everything.
const SNAP = {
  peek: () => 156, // "Right now" heading + traffic light
  // half: measured so it ends just below the time slider (light + next 24 h + slider), within 40–78 % of the screen
  half: () => {
    const tb = document.querySelector('.time-block');
    const want = $('statusCard').hidden || !tb ? viewH() * 0.5
      : tb.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top + document.querySelector('.panel-body').scrollTop + 10;
    return Math.min(Math.max(viewH() * 0.4, want), viewH() * 0.78);
  },
  full: () => viewH() - 76, // leaves the search bar visible
};
const sheet = $('panel');
let sheetH = 0;
function setSheetHeight(h, animate = true) {
  sheetH = Math.max(SNAP.peek(), Math.min(SNAP.full(), h));
  sheet.classList.toggle('dragging', !animate);
  document.documentElement.style.setProperty('--sheet-h', `${sheetH}px`);
}
function snapSheet(name) {
  if (!PHONE.matches) return;
  sheet.dataset.snap = name;
  document.body.dataset.sheet = name;
  if (name !== 'full') document.querySelector('.panel-body').scrollTop = 0;
  setSheetHeight(SNAP[name]());
  $('sheetHandle').setAttribute('aria-label', name === 'full' ? 'Show less' : 'Show more');
  setMapPadding();
}
function nearestSnap(h) {
  return Object.entries(SNAP).reduce((a, [k, f]) => (Math.abs(f() - h) < Math.abs(SNAP[a]() - h) ? k : a), 'peek');
}
{
  // drag the handle or header; a tap cycles peek → half → full → peek
  let startY = null, startH = 0, moved = false;
  const grab = (e) => {
    if (!PHONE.matches || e.target.closest('button:not(#sheetHandle), select, input')) return;
    startY = e.clientY; startH = sheetH; moved = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (startY === null) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) moved = true;
    if (moved) setSheetHeight(startH + dy, false);
  };
  const drop = () => {
    if (startY === null) return;
    startY = null;
    const cur = sheet.dataset.snap;
    snapSheet(moved ? nearestSnap(sheetH) : cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'peek');
  };
  for (const el of [$('sheetHandle'), document.querySelector('.panel-head')]) {
    el.addEventListener('pointerdown', grab);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  }
  // in peek, a tap anywhere on the visible status opens half
  document.querySelector('.panel-body').addEventListener('click', (e) => {
    if (PHONE.matches && sheet.dataset.snap === 'peek' && !e.target.closest('button, a, input, select')) snapSheet('half');
  });
  $('sheetHandle').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const cur = sheet.dataset.snap;
    snapSheet(cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'peek');
  });
}
// Keep the map centred in the part you can see (beside the panel / above the sheet)
function setMapPadding() {
  if (EMBED) { map.setPadding({ left: 0, bottom: 0, top: 0, right: 0 }); return; }
  if (PHONE.matches) map.setPadding({ left: 0, top: 60, right: 0, bottom: Math.min(sheetH, viewH() * 0.55) });
  else map.setPadding({ left: document.body.classList.contains('panel-closed') ? 0 : sheet.offsetWidth + 24, top: 60, right: 0, bottom: 0 });
}
function applyLayout() {
  if (PHONE.matches) { document.body.classList.remove('panel-closed'); $('panelOpen').hidden = true; }
  if (PHONE.matches) snapSheet(sheet.dataset.snap || 'peek');
  else { document.documentElement.style.removeProperty('--sheet-h'); sheet.classList.remove('dragging'); }
  setMapPadding();
}
PHONE.addEventListener('change', applyLayout);
addEventListener('resize', () => { if (PHONE.matches) setSheetHeight(SNAP[sheet.dataset.snap]()); setMapPadding(); map.resize(); });

// ------------------------------------------------ hide / show the panel (wide screens)
// [PARAM] remembered per browser; phones use the bottom sheet instead
const PANEL_KEY = 'thames-spill-map:panel-closed';
function setPanelClosed(closed, focus = false) {
  if (PHONE.matches) closed = false;
  document.body.classList.toggle('panel-closed', closed);
  $('panelOpen').hidden = !closed;
  try { localStorage.setItem(PANEL_KEY, closed ? '1' : '0'); } catch { /* storage blocked: fine */ }
  setMapPadding();
  map.resize();
  if (focus) (closed ? $('panelOpen') : $('panelClose')).focus();
}
$('panelClose').addEventListener('click', () => setPanelClosed(true, true));
$('panelOpen').addEventListener('click', () => setPanelClosed(false, true));
{
  let saved = false;
  try { saved = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* ignore */ }
  if (saved && !EMBED) setPanelClosed(true);
}

// -------------------------------------------------------------- controls
$('time').addEventListener('input', (e) => { setLive(false); state.f = Number(e.target.value); render(); });
$('nowBtn').addEventListener('click', () => setLive(true));
$('play').addEventListener('click', () => {
  if (state.playing) { clearInterval(state.playing); state.playing = null; $('play').textContent = '▶ Play'; return; }
  setLive(false);
  $('play').textContent = '❚❚ Pause';
  state.playing = setInterval(() => {
    const s = $('time');
    state.f = state.f >= Number(s.max) ? Number(s.min) : state.f + 1;
    s.value = state.f;
    render();
  }, 150);
});
$('colourBy').addEventListener('change', () => { drawLegend(); render(); });
['showForecast', 'showQuiet', 'showSightings'].forEach((id) => $(id).addEventListener('change', render));
$('london').addEventListener('click', () => map.flyTo(CONFIG.map.londonView));
if (!PHONE.matches && !EMBED) $('mapKey').open = true;
if (PHONE.matches) $('spotSearch').placeholder = 'Club, place or postcode';

// ----------------------------------------------------------------- start
applyLayout();
drawLegend();
setLive(true);
updateButtons();
renderFavs();
// The key lists "River club" only when there are clubs to show (clubs.json has been built).
loadClubs().then(() => { state.clubs = getClubs(); $('keyClub').hidden = !state.clubs.length; render(); updateStatus(); });

// Shared links / alert links / embeds: ?lon=&lat=&r=&name= open the map on that stretch.
{
  const lon = Number(Q.get('lon')), lat = Number(Q.get('lat'));
  if (Q.has('lon') && Number.isFinite(lon) && Number.isFinite(lat)) {
    map.jumpTo({ center: [lon, lat], zoom: EMBED ? 12.5 : 12 });
    const r = Number(Q.get('r'));
    setSpot([lon, lat], 'link', { name: Q.get('name')?.slice(0, 40) || null, radius: [1, 3, 5, 10].includes(r) ? r : null });
  } else if (EMBED) {
    $('embedCard').hidden = false;
    $('embedCard').innerHTML = `<p><b>${esc(CONFIG.brand.name)}</b></p>` + '<p class="small">This embed needs a spot. Open the map, choose your spot and use “Embed on your club\'s website” to get the code.</p>';
  } else if (state.favs.length) {
    openFav(state.favs[0], 'favourite-auto'); // returning users see their first saved spot straight away
  }
}

loadSightings();
setInterval(loadSightings, CONFIG.sightings.refreshMinutes * 60e3);
await refresh();
