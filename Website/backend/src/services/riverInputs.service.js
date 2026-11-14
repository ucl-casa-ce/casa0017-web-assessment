/**
 * River Inputs Service
 *
 * Gathers everything the Thames sewage-spread model needs, using the services
 * this backend already has where possible, and returns it in the shape the
 * shared model (Website/shared/river/model/impact.js) expects:
 *
 *   { now, overflows, gauges, highWaters, rain, propensity, thresholds, problems }
 *
 * - Overflows: thamesWater.service fetchDischargeStatus() (all watercourses, paged)
 * - Flow:      EA flood-monitoring flow stations on the River Thames
 * - Rain:      Open-Meteo hourly forecast at each overflow's grid cell
 * - Tides:     tideForecast.service (ADMIRALTY EasyTide) at London Bridge,
 *              falling back to EA observed tidal levels
 * - Propensity: from the spill_event table (EDM history imported by this repo's scripts)
 * - Thresholds: analysis.service getRainfallThresholds() — the team's per-overflow
 *              rainfall thresholds, which set each overflow's forecast spill chance
 *
 * Results are cached for CACHE_MINUTES so many browsers share one set of upstream calls.
 *
 * @module services/riverInputs
 */

import axios from 'axios';
import config from '../config/env.js';
import { pool } from '../db/db.js';
import { fetchDischargeStatus } from './thamesWater.service.js';
import { fetchTideForecast } from './tideForecast.service.js';
import { getRainfallThresholds } from './analysis.service.js';
import { getOutfallThresholds } from './threshold.service.js';
import { CONFIG } from '../../../shared/river/config.js';
import { normaliseSiteName, parseTime, rainKey } from '../../../shared/river/data/util.js';
import { river } from './riverModel.service.js';
import { snapToRiver } from '../../../shared/river/model/river.js';

// [PARAM] how long one set of inputs is reused (Thames Water updates ~every 15 min)
const CACHE_MINUTES = Number(process.env.RIVER_INPUTS_CACHE_MINUTES) || 10;
const ea = axios.create({ baseURL: config.apis.eaFloodBaseUrl, timeout: 20000 });

// ------------------------------------------------------------- overflows
/**
 * All Thames Water overflows (every watercourse: tributary overflows reach the
 * Thames too; the model drops sites more than CONFIG.river.snapMaxKm away).
 * @returns {Promise<{ items: object[], source: string }>}
 */
export async function loadOverflows() {
  const items = [];
  let source = 'live';
  for (let offset = 0; offset < 20000; offset += 1000) {
    const page = await fetchDischargeStatus({ filterLondon: false, cache: false, limit: 1000, offset });
    source = page.source;
    items.push(...page.items);
    if (page.source !== 'live' || (page.totalFromApi ?? page.items.length) < 1000) break;
  }
  const utc = CONFIG.thamesWater.timesAreUtc;
  const overflows = items
    .filter((o) => Number.isFinite(Number(o.lng)) && Number.isFinite(Number(o.lat)) && Number(o.lat) !== 0)
    .map((o) => {
      const raw = String(o.alertStatus ?? '').toLowerCase();
      const status = raw.includes('offline') ? 'offline'
        : o.isDischarging || raw.startsWith('discharg') ? 'discharging'
        : 'not_discharging';
      return {
        id: o.permitNumber,
        name: o.locationName ?? 'Unnamed overflow',
        receivingWater: o.receivingWaterCourse ?? o.receivingWatercourse ?? '',
        position: [Number(o.lng), Number(o.lat)],
        status,
        start: parseTime(o.mostRecentStart, utc),
        stop: parseTime(o.mostRecentStop, utc),
        past48h: Boolean(o.alertPast48Hours),
        normName: normaliseSiteName(o.locationName ?? ''),
      };
    });
  return { items: overflows, source };
}

// -------------------------------------------------------------- EA flows
export async function loadThamesFlowGauges() {
  const [stations, readings] = await Promise.all([
    ea.get('/id/stations', { params: { parameter: 'flow', riverName: 'River Thames' } }),
    ea.get('/data/readings?latest&parameter=flow'),
  ]);
  const latest = new Map();
  for (const r of readings.data.items ?? []) {
    const ref = String(r.measure?.['@id'] ?? r.measure ?? '').split('/').pop().split('-')[0];
    const value = Array.isArray(r.value) ? Number(r.value[0]) : Number(r.value);
    if (ref && Number.isFinite(value)) latest.set(ref, { value, time: Date.parse(r.dateTime) });
  }
  return (stations.data.items ?? []).map((s) => {
    const lon = Number(Array.isArray(s.long) ? s.long[0] : s.long);
    const lat = Number(Array.isArray(s.lat) ? s.lat[0] : s.lat);
    const l = latest.get(s.stationReference);
    if (!l || !Number.isFinite(lon)) return null;
    return { ref: s.stationReference, label: s.label, position: [lon, lat], flow: l.value, time: l.time };
  }).filter(Boolean);
}

// ------------------------------------------------------- rain forecast
export async function loadRainForecast(points) {
  const dp = CONFIG.forecast.gridDp;
  const unique = [...new Set(points.map((p) => rainKey(p, dp)))];
  const byKey = {};
  const CHUNK = 200; // keep URLs a sane length
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK).map((k) => k.split(',').map(Number));
    const { data } = await axios.get(process.env.OPEN_METEO_URL || CONFIG.endpoints.openMeteo, {
      timeout: 30000,
      params: {
        latitude: chunk.map((c) => c[0]).join(','),
        longitude: chunk.map((c) => c[1]).join(','),
        hourly: CONFIG.forecast.rainVariable,
        past_days: 1,
        forecast_days: CONFIG.forecast.forecastDays,
        timezone: 'GMT',
        timeformat: 'unixtime',
      },
    });
    const list = Array.isArray(data) ? data : [data];
    list.forEach((res, j) => {
      byKey[unique[i + j]] = {
        times: res.hourly.time.map((t) => t * 1000),
        rain: res.hourly[CONFIG.forecast.rainVariable].map((v) => v ?? 0),
      };
    });
  }
  return { dp, byKey };
}

// ------------------------------------------------------------- tides
/**
 * High/low waters at London Bridge from the existing EasyTide service.
 * [ASSUMPTION] EasyTide dateTime values without an offset are UTC.
 */
export async function loadHighWaters() {
  const f = await fetchTideForecast(CONFIG.tide.easyTideStationId);
  const events = (f.tidalEvents ?? []).map((e) => ({
    type: e.type === 'HIGH' ? 'high' : 'low',
    t: parseTime(e.dateTime, true),
    h: Number(e.height),
  })).filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  const times = events.filter((e) => e.type === 'high').map((e) => e.t);
  if (times.length) return { source: 'ADMIRALTY EasyTide (London Bridge)', quality: 'admiralty', times, events };

  // Fallback: EA observed tidal level near London Bridge, local maxima over ~26 h
  try {
    const { lat, long, distKm } = CONFIG.tide.eaTidalSearch;
    const st = await ea.get('/id/stations', { params: { qualifier: 'Tidal Level', lat, long, dist: distKm } });
    const ref = st.data.items?.[0]?.stationReference;
    if (ref) {
      const since = new Date(Date.now() - 26 * 3600e3).toISOString();
      const r = await ea.get(`/id/stations/${ref}/readings?_sorted&parameter=level&since=${encodeURIComponent(since)}`);
      const series = (r.data.items ?? []).map((x) => [Date.parse(x.dateTime), Number(x.value)]).sort((a, b) => a[0] - b[0]);
      const hw = [];
      const W = 8; // ±2 h of 15-min readings
      for (let i = W; i < series.length - W; i++) {
        let isMax = true;
        for (let j = i - W; j <= i + W; j++) if (series[j][1] > series[i][1]) { isMax = false; break; }
        if (isMax && (!hw.length || series[i][0] - hw[hw.length - 1] > 4 * 3600e3)) hw.push(series[i][0]);
      }
      if (hw.length) return { source: `EA observed (${st.data.items[0].label}), extrapolated`, quality: 'ea', times: hw };
    }
  } catch (err) {
    console.warn('[RiverInputs] EA tidal level unavailable:', err.message);
  }
  const fb = CONFIG.tide.fallbackHighWaterUtc;
  return { source: fb ? 'config fallback' : 'unknown (phase assumed)', quality: 'fallback', times: fb ? [Date.parse(fb)] : [Date.now()] };
}

// -------------------------------------------------------- propensity
/**
 * Per-overflow spill propensity 0..1 = percentile rank of total spill hours in
 * the last PROPENSITY_DAYS of spill_event records.
 * [ASSUMPTION] EDM history rows use Thames Water's uniqueId (e.g. TWL00002) as
 * outfall_id, while the live list is keyed by permit number, so each value is
 * returned under the outfall's normalised name (filled in by the team's
 * backfill-outfall-details script) as well as its id; the model tries the name first.
 * Empty object when the table is empty or the database is unavailable.
 */
const PROPENSITY_DAYS = Number(process.env.RIVER_PROPENSITY_DAYS) || 365;
export async function loadPropensity() {
  try {
    const [rows] = await pool.query(
      `SELECT se.outfall_id AS id, MAX(o.location_name) AS name,
              SUM(TIMESTAMPDIFF(MINUTE, se.start_ts, COALESCE(se.end_ts, se.start_ts))) / 60 AS hours
         FROM spill_event se
         LEFT JOIN outfalls o ON o.permit_number = se.outfall_id
        WHERE se.start_ts >= NOW() - INTERVAL ? DAY
        GROUP BY se.outfall_id`,
      [PROPENSITY_DAYS]
    );
    if (!rows.length) return {};
    const sorted = rows.map((r) => Number(r.hours) || 0).sort((a, b) => a - b);
    const rank = (h) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= h) lo = m + 1; else hi = m; }
      return lo / sorted.length;
    };
    const out = {};
    for (const r of rows) {
      const q = Math.round(rank(Number(r.hours) || 0) * 1000) / 1000;
      out[r.id] = q;
      if (r.name) out[normaliseSiteName(r.name)] = q;
    }
    return out;
  } catch (err) {
    console.warn('[RiverInputs] propensity unavailable:', err.message);
    return {};
  }
}

// -------------------------------------------------------- thresholds
/**
 * Per-overflow rainfall thresholds from the team's analysis: the lowest and
 * average 24-h rain (rain_24h_mm, nearest rain gauge) before each overflow's
 * recorded spills, and how many spills that is based on.
 *   { "<permit number>" and "<normalised site name>": { min, avg, n } }
 * Uses the same function as GET /api/analysis/rainfall-thresholds, so the map
 * follows any change the team makes to that analysis; falls back to the
 * /api/thresholds query if that one fails (e.g. no 48/72-h columns yet).
 * Keyed by name as well as id for the same reason as loadPropensity().
 * Empty object (every overflow uses the shared curve) when there is no data.
 * [PARAM] RIVER_THRESHOLDS_MAX: the most overflows read.
 */
const THRESHOLDS_MAX = Number(process.env.RIVER_THRESHOLDS_MAX) || 20000;
export async function loadThresholds() {
  let rows = [];
  try {
    rows = await getRainfallThresholds({ limit: THRESHOLDS_MAX });
  } catch (err) {
    console.warn('[RiverInputs] analysis thresholds unavailable, trying /thresholds query:', err.message);
    try {
      rows = (await getOutfallThresholds()).map((r) => ({ ...r, minRain24h: r.minRain24hMm, avgRain24h: r.avgRain24hMm }));
    } catch (err2) {
      console.warn('[RiverInputs] rainfall thresholds unavailable:', err2.message);
      return {};
    }
  }
  const out = {};
  for (const r of rows) {
    const t = { min: Number(r.minRain24h), avg: Number(r.avgRain24h), n: Number(r.spillCount) };
    if (!Number.isFinite(t.min) || !Number.isFinite(t.avg) || !(t.n > 0)) continue;
    out[r.permitNumber] = t;
    if (r.locationName) out[normaliseSiteName(r.locationName)] ??= t;
  }
  return out;
}

// ---------------------------------------------------------- bundle
let cache = null;
let inflight = null;
// [PARAM] how long one rain forecast is reused, and how old a copy may be used if Open-Meteo fails
const RAIN_CACHE_MINUTES = Number(process.env.RIVER_RAIN_CACHE_MINUTES) || 60;
const RAIN_STALE_HOURS = Number(process.env.RIVER_RAIN_STALE_HOURS) || 6;
let rainCache = null; // { at, value }

/** Everything the model needs, cached. `force` skips the cache (used by the alerts job). */
export async function getRiverInputs({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.now < CACHE_MINUTES * 60e3) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const now = Date.now();
    const problems = [];
    const [ovf, gauges, hw, prop, thr] = await Promise.allSettled([loadOverflows(), loadThamesFlowGauges(), loadHighWaters(), loadPropensity(), loadThresholds()]);
    if (ovf.status !== 'fulfilled' || !ovf.value.items.length) {
      throw new Error(`Thames Water EDM unavailable${ovf.reason ? `: ${ovf.reason.message}` : ''}`);
    }
    if (ovf.value.source !== 'live') problems.push('Thames Water EDM (using cached status)');
    if (gauges.status !== 'fulfilled') problems.push('EA flow');
    const overflows = ovf.value.items;
    // Rain forecast: kept for RAIN_CACHE_MINUTES (the forecast itself only changes hourly, and
    // Open-Meteo's free service allows under 10,000 calls a day, with each location counting).
    // If a fetch fails, the last good copy is used for up to RAIN_STALE_HOURS.
    let rain = null;
    if (rainCache && now - rainCache.at < RAIN_CACHE_MINUTES * 60e3) {
      rain = rainCache.value;
    } else {
      try {
        const near = overflows.filter((o) => snapToRiver(river, o.position).offKm <= CONFIG.river.snapMaxKm);
        rain = await loadRainForecast(near.map((o) => o.position));
        rainCache = { at: now, value: rain };
        console.log(`[RiverInputs] rain forecast fetched for ${Object.keys(rain.byKey).length} locations`);
      } catch (err) {
        console.warn('[RiverInputs] Open-Meteo unavailable:', err.response?.status ?? '', err.message);
        if (rainCache && now - rainCache.at < RAIN_STALE_HOURS * 3600e3) {
          rain = rainCache.value;
          problems.push(`rain forecast (using a copy from ${Math.round((now - rainCache.at) / 60e3)} min ago)`);
        } else {
          problems.push('rain forecast');
        }
      }
    }
    const tide = hw.status === 'fulfilled' ? hw.value : { source: 'unknown', quality: 'fallback', times: [now] };
    if (tide.quality !== 'admiralty') problems.push('tide predictions');
    cache = {
      now, overflows,
      gauges: gauges.status === 'fulfilled' ? gauges.value : [],
      highWaters: tide, rain,
      propensity: prop.status === 'fulfilled' ? prop.value : {},
      thresholds: thr.status === 'fulfilled' ? thr.value : {},
      problems,
    };
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}
