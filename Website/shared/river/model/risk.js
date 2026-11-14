// Traffic-light risk: the plain-language layer on top of the model.
// One source of truth used by the map, the "your spot" card, the share
// card / CSV and the WhatsApp alert server, so they never disagree.
// Explained for users on methodology.html#traffic-light.

import { CONFIG } from '../config.js';

export const RISKS = ['low', 'moderate', 'high'];
export const riskRank = (r) => RISKS.indexOf(r);
export const riskInfo = (r) => CONFIG.risk.levels[r];

/**
 * Risk for one model read-out { central, pMod, pHigh } (see ImpactModel.at).
 *   HIGH      central ≥ high threshold     OR chance of HIGH      ≥ CONFIG.risk.probability
 *   MODERATE  central ≥ moderate threshold OR chance of MODERATE+ ≥ CONFIG.risk.probability
 *   LOW       otherwise
 */
export function riskOf(r) {
  const T = CONFIG.impact.thresholds, P = CONFIG.risk.probability;
  if (r.central >= T.high || r.pHigh >= P) return 'high';
  if (r.central >= T.moderate || r.pMod >= P) return 'moderate';
  return 'low';
}

/**
 * "Certainty" for a non-specialist: the share of model runs that agree there IS
 * sewage (moderate or worse) when the light is amber/red, or that there is NOT
 * when it's green. [ASSUMPTION] "Is there sewage?" matters more to users than
 * whether it is exactly moderate or high, which runs often disagree on.
 */
export function confidenceOf(risk, r) {
  const p = risk === 'low' ? 1 - r.pMod : r.pMod;
  const C = CONFIG.risk.confidence;
  return { p, word: p >= C.high ? 'High' : p >= C.medium ? 'Medium' : 'Low' };
}

const binsFor = (model, chainageKm, radiusKm) => [
  Math.max(0, Math.floor((chainageKm - radiusKm) / model.sp)),
  Math.min(model.S - 1, Math.ceil((chainageKm + radiusKm) / model.sp)),
];

/**
 * Worst point on a stretch (chainage ± radius) at one frame.
 * [ASSUMPTION] A stretch is as risky as its riskiest point.
 */
export function stretchAt(model, chainageKm, radiusKm, f) {
  const [i0, i1] = binsFor(model, chainageKm, radiusKm);
  let worst = null;
  for (let i = i0; i <= i1; i++) {
    const r = model.at(f, i);
    r.risk = riskOf(r);
    r.bin = i;
    if (!worst || riskRank(r.risk) > riskRank(worst.risk) ||
      (r.risk === worst.risk && r.central > worst.central)) worst = r;
  }
  worst.confidence = confidenceOf(worst.risk, worst);
  return worst;
}

/** Hour-by-hour stretch status over the whole model window. */
export function stretchHours(model, chainageKm, radiusKm) {
  return Array.from({ length: model.F }, (_, f) => stretchAt(model, chainageKm, radiusKm, f));
}

/** Day-by-day worst status from `fromT` to the end of the forecast (UK days). */
export function stretchDays(hours, fromT) {
  const days = [];
  for (const h of hours) {
    if (h.t < fromT - 30 * 60e3) continue;
    const date = new Date(h.t);
    const key = date.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
    let d = days[days.length - 1];
    if (d?.key !== key) {
      d = {
        key, t: h.t,
        day: date.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short' }),
        date: date.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }),
        risk: 'low', worst: h, pMod: 0, pHigh: 0, hoursAtRisk: 0,
      };
      days.push(d);
    }
    if (riskRank(h.risk) > riskRank(d.risk) || (h.risk === d.risk && h.central > d.worst.central)) { d.risk = h.risk; d.worst = h; }
    d.pMod = Math.max(d.pMod, h.pMod);
    d.pHigh = Math.max(d.pHigh, h.pHigh);
    if (h.risk !== 'low') d.hoursAtRisk++;
  }
  return days;
}

/** Plain-English summary of what happens next, e.g. "Rising to Moderate risk around Sun 14:00". */
export function nextChange(hours, fromT, withinHours = 48) {
  const start = hours.findIndex((h) => h.t >= fromT - 30 * 60e3);
  if (start < 0) return null;
  const cur = hours[start].risk;
  for (let k = start + 1; k < hours.length && hours[k].t <= fromT + withinHours * 3600e3; k++) {
    if (hours[k].risk !== cur) return { from: cur, to: hours[k].risk, t: hours[k].t, rising: riskRank(hours[k].risk) > riskRank(cur) };
  }
  return null;
}
