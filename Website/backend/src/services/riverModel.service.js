/**
 * River Model Service
 *
 * Runs the shared Thames sewage-spread model (Website/shared/river) on the
 * server for WhatsApp alerts and the /api/river/status read-out. The browser
 * runs the same code in a Web Worker for the interactive map.
 *
 * @module services/riverModel
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../../shared/river/config.js';
import { THAMES_WAYPOINTS } from '../../../shared/river/data/thamesCentreline.js';
import { buildRiver, snapToRiver, distKm } from '../../../shared/river/model/river.js';
import { ImpactModel } from '../../../shared/river/model/impact.js';
import { riskInfo, riskRank, stretchHours, stretchDays, nextChange } from '../../../shared/river/model/risk.js';
import RIVER from '../config/river.js';

const H = 3600e3;

function riverCoords() {
  try {
    const file = path.resolve(import.meta.dirname, '../../../shared/river/data', CONFIG.river.geojsonUrl);
    const gj = JSON.parse(readFileSync(file, 'utf8'));
    const g = gj.type === 'Feature' ? gj.geometry : gj.type === 'FeatureCollection' ? gj.features[0].geometry : gj;
    return g.type === 'MultiLineString' ? g.coordinates.flat() : g.coordinates;
  } catch {
    console.warn('[RiverModel] centreline GeoJSON not found, using approximate waypoints');
    return THAMES_WAYPOINTS.map((w) => w.c);
  }
}

export const river = buildRiver(riverCoords(), CONFIG.river.sampleSpacingKm);
export const snap = (pos) => snapToRiver(river, pos);
export const nearestPlace = (pos) => THAMES_WAYPOINTS.reduce((a, w) => (distKm(w.c, pos) < distKm(a.c, pos) ? w : a)).name;

export const latest = { model: null, at: 0, problems: [] };

/** Run the model on the given inputs (from riverInputs.service) and keep it for alerts/status. */
export function runModel(inputs) {
  const model = new ImpactModel(river, THAMES_WAYPOINTS).run({
    ...inputs,
    trackSourcesHours: RIVER.alerts.warnAheadHours, // remember which overflow drives each peak
  });
  Object.assign(latest, { model, at: inputs.now, problems: inputs.problems ?? [] });
  return model;
}

// ------------------------------------------------------------- read-outs
export const fmtTime = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Everything a message needs about a stretch (chainage_km, radius_km) from a model run. */
export function stretchReport(model, s) {
  const hours = stretchHours(model, s.chainage_km, s.radius_km);
  const fNow = model.frameAt(model.now);
  const now = hours[fNow];
  const days = stretchDays(hours, model.now);
  const soon = hours.slice(fNow + 1, model.frameAt(model.now + RIVER.alerts.warnAheadHours * H) + 1);
  const rise = soon.find((h) => riskRank(h.risk) > riskRank(now.risk)) ?? null;
  return {
    now, days, rise, hours,
    next: nextChange(hours, model.now, 48),
    source: topSource(model, (rise ?? now).t, (rise ?? now).bin),
    week: days.map((d) => `${d.day} ${riskInfo(d.risk).emoji}`).join(' '),
  };
}

function topSource(model, t, bin) {
  const list = model.sources?.get(model.frameAt(t));
  if (!list) return null;
  const score = new Map();
  for (const [si, b, load] of list) {
    const d = Math.abs(b - bin) * model.sp;
    if (d <= 10) score.set(si, (score.get(si) ?? 0) + load * Math.exp(-d / 3));
  }
  let best = -1, bestS = 0;
  for (const [si, v] of score) if (v > bestS) { best = si; bestS = v; }
  if (best < 0) return null;
  const site = model.sites[best];
  return `${site.name} overflow (${site.status === 'discharging' ? 'spilling now' : site.status === 'offline' ? 'monitor offline' : 'recent or forecast spill'})`;
}

export const stretchName = (s) => `${s.name || s.place} (±${s.radius_km} km)`;
export const forecastLink = (s) => `${RIVER.publicMapUrl}/live.html?lon=${Number(s.lon).toFixed(4)}&lat=${Number(s.lat).toFixed(4)}&r=${s.radius_km}` +
  (s.name ? `&name=${encodeURIComponent(s.name)}` : '');
