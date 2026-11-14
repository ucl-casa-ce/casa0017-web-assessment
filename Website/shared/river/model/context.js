// "Next 24 hours" context for a spot: hourly sewage risk, rain strength and
// the tide, in plain language. Pure functions (no DOM) so the alert server
// could reuse them. Settings: CONFIG.context.
//
// [ASSUMPTIONS]
// - Rain: the Open-Meteo hourly forecast averaged over weather cells near the
//   spot (cells exist where overflows are, see loadRainForecast). Rain falling
//   upstream matters too; the model accounts for that, this line is context.
// - Tide: ADMIRALTY high/low waters at London Bridge, shifted by PLA average
//   time differences. Without ADMIRALTY data, high waters are extrapolated
//   every 12.42 h and low water is put halfway between (marked "approx.").
// - The tide line between events is a half-cosine; real Thames tides rise
//   faster than they fall, so read times off the labels, not the curve.

import { CONFIG } from '../config.js';
import { snapToRiver, distKm } from './river.js';

const H = 3600e3;
const C = () => CONFIG.context;

// ------------------------------------------------------------------ rain
/** 'dry' | 'light' | 'moderate' | 'heavy' for a rate in mm/h */
export function rainClass(mm) {
  const r = C().rain;
  if (!(mm >= r.trace)) return 'dry';
  if (mm < r.moderate) return 'light';
  if (mm < r.heavy) return 'moderate';
  return 'heavy';
}
export const RAIN_RANK = { dry: 0, light: 1, moderate: 2, heavy: 3 };

/** Hourly mm for the hours `times` (ms) near `pos`, or null when no forecast covers it. */
export function rainNear(rain, pos, times) {
  if (!rain?.byKey) return null;
  const cells = Object.entries(rain.byKey).map(([k, v]) => {
    const [lat, lon] = k.split(',').map(Number);
    return { d: distKm([lon, lat], pos), v };
  });
  let use = cells.filter((x) => x.d <= C().rainRadiusKm);
  if (!use.length) {
    const near = cells.sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > C().rainFallbackKm) return null;
    use = [near];
  }
  return times.map((t) => {
    let sum = 0, n = 0;
    for (const { v } of use) {
      const i = Math.round((t - v.times[0]) / H);
      if (i >= 0 && i < v.rain.length) { sum += v.rain[i]; n++; }
    }
    return n ? sum / n : 0;
  });
}

// ------------------------------------------------------------------ tide
/** Minutes to add to London Bridge times at this chainage (interpolated PLA differences). */
export function tideOffsetAt(river, chainageKm) {
  const pts = C().tideOffsets.map((p) => ({ ...p, km: snapToRiver(river, p.c).chainage })).sort((a, b) => a.km - b.km);
  if (chainageKm <= pts[0].km) return { hw: pts[0].hw, lw: pts[0].lw, approx: chainageKm < pts[0].km - 0.5, ref: pts[0].name };
  const last = pts[pts.length - 1];
  if (chainageKm >= last.km) return { hw: last.hw, lw: last.lw, approx: chainageKm > last.km + 0.5, ref: last.name };
  const j = pts.findIndex((p) => p.km >= chainageKm);
  const a = pts[j - 1], b = pts[j], f = (chainageKm - a.km) / (b.km - a.km);
  return { hw: a.hw + f * (b.hw - a.hw), lw: a.lw + f * (b.lw - a.lw), approx: false, ref: f < 0.5 ? a.name : b.name };
}

/** High/low waters at London Bridge covering [from, to]: real ADMIRALTY events, else extrapolated. */
export function tideEventsLB(tide, from, to) {
  if (tide?.events?.length) return { events: tide.events.filter((e) => e.t >= from - 8 * H && e.t <= to + 8 * H), approx: false };
  const P = CONFIG.tide.periodHours * H;
  const hw0 = tide?.times?.length ? tide.times[tide.times.length - 1] : null;
  if (!Number.isFinite(hw0) || tide?.quality === 'fallback') return { events: [], approx: true };
  const events = [];
  let k = Math.floor((from - 8 * H - hw0) / P);
  for (let t = hw0 + k * P; t <= to + 8 * H; t = hw0 + ++k * P) {
    events.push({ type: 'high', t, h: NaN }, { type: 'low', t: t + P / 2, h: NaN });
  }
  return { events, approx: true };
}

/**
 * Tide for a spot: events shifted to the spot, a sampled level line (0 = low, 1 = high)
 * and the state at `now`. Returns { tidal:false } above the tidal limit.
 */
export function tideForSpot(tide, river, chainageKm, tidalLimitKm, from, to) {
  if (!(chainageKm >= tidalLimitKm - 0.5)) return { tidal: false };
  const off = tideOffsetAt(river, chainageKm);
  const lb = tideEventsLB(tide, from, to);
  if (!lb.events.length) return { tidal: true, unknown: true };
  const ev = lb.events.map((e) => ({ ...e, t: e.t + (e.type === 'high' ? off.hw : off.lw) * 60e3 })).sort((a, b) => a.t - b.t);
  const levelAt = (t) => {
    const j = ev.findIndex((e) => e.t > t);
    if (j <= 0) return null;
    const a = ev[j - 1], b = ev[j];
    const f = (t - a.t) / (b.t - a.t);
    const s = (1 - Math.cos(Math.PI * f)) / 2; // 0→1 half-cosine
    const la = a.type === 'high' ? 1 : 0, lb2 = b.type === 'high' ? 1 : 0;
    return la + (lb2 - la) * s;
  };
  const line = [];
  for (let t = from; t <= to; t += 15 * 60e3) line.push({ t, level: levelAt(t) });
  const next = ev.find((e) => e.t > from);
  return {
    tidal: true, approx: lb.approx || off.approx, ref: off.ref,
    events: ev.filter((e) => e.t >= from && e.t <= to),
    line, rising: next ? next.type === 'high' : null, next,
  };
}

// --------------------------------------------------------- 24-hour strip
/**
 * @param hours  stretchHours() output (one per model frame, with .t, .risk)
 * @returns { hours:[{t, risk, rain, rainClass}], rain:{…}|null, tide:{…}, from, to }
 */
export function next24({ model, hours, rain, tide, river, chainageKm, now = Date.now() }) {
  const n = C().hours;
  const f0 = model.frameAt(now);
  const slice = hours.slice(f0, f0 + n);
  const from = slice[0].t, to = from + n * H;
  const mm = rainNear(rain, posOf(river, chainageKm),slice.map((h) => h.t));
  const out = slice.map((h, i) => ({ t: h.t, risk: h.risk, rain: mm ? mm[i] : null, rainClass: mm ? rainClass(mm[i]) : null }));
  let rainSum = null;
  if (mm) {
    const total = mm.reduce((a, b) => a + b, 0);
    const peakI = mm.indexOf(Math.max(...mm));
    const wet = out.filter((h) => h.rainClass !== 'dry');
    rainSum = { total, peak: mm[peakI], peakT: out[peakI].t, peakClass: rainClass(mm[peakI]),
      firstWet: wet[0]?.t ?? null, lastWet: wet.length ? wet[wet.length - 1].t + H : null, wetHours: wet.length };
  }
  return { hours: out, rain: rainSum, tide: tideForSpot(tide, river, chainageKm, model.tidalLimitKm, from, to), from, to };
}
// The rain forecast is looked up at the river point nearest the spot's chainage.
function posOf(river, chainageKm) {
  const s = river.samples;
  let best = s[0];
  for (const p of s) if (Math.abs(p.chainage - chainageKm) < Math.abs(best.chainage - chainageKm)) best = p;
  return best.pos;
}

/** Plain-language risk runs: [{risk, from, to}] */
export function riskRuns(hours) {
  const runs = [];
  for (const h of hours) {
    const last = runs[runs.length - 1];
    if (last && last.risk === h.risk) last.to = h.t + H;
    else runs.push({ risk: h.risk, from: h.t, to: h.t + H });
  }
  return runs;
}
