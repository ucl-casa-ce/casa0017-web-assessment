// Fills the "How the Live map forecast works" section of method.html with live values from
// CONFIG, so the documentation always matches the settings the map and alert server are using.
// (Styles: method-live.css, loaded by src/pages/method-live.js.)
import { CONFIG } from '../../../shared/river/config.js';

const get = (path) => path.split('.').reduce((o, k) => o?.[k], CONFIG);

document.querySelectorAll('[data-c]').forEach((el) => { el.textContent = String(get(el.dataset.c)); });

// ---- levels table
const T = CONFIG.impact.thresholds, U = CONFIG.impact.unit;
const examples = {
  clear: 'No recent or forecast spill reaching this stretch, or what remains is mostly died off.',
  low: 'Traces: e.g. a short spill tens of km upstream, or the tail of one from a day or more ago.',
  moderate: 'e.g. (before die-off) a 1-hour spill spread over ~7 km, or a 6-hour spill spread over ~40 km.',
  high: 'e.g. (before die-off) a 1-hour spill concentrated in under ~2 km, or a 6-hour spill within ~10 km — sewage likely close by.',
};
const rows = [
  ['clear', `below ${T.low}`, '#4696c8'],
  ['low', `${T.low} – ${T.moderate}`, '#fed976'],
  ['moderate', `${T.moderate} – ${T.high}`, '#fd8d3c'],
  ['high', `${T.high} or more`, '#bd0026'],
];
document.getElementById('levelRows').innerHTML = rows.map(([l, r, c]) =>
  `<tr><td><span class="sw" style="background:${c}"></span><b>${l[0].toUpperCase() + l.slice(1)}</b></td><td>${r} ${U}</td><td>${examples[l]}</td></tr>`).join('');

// ---- uncertainty table
const u = CONFIG.uncertainty;
const ln = (s) => `×/÷ ${Math.exp(s).toFixed(2)} (1 SD, log-normal)`;
const unc = [
  ['Spill strength of each overflow (EDM has no volumes)', ln(u.volumeSigma)],
  ['River speed', ln(u.velocitySigma)],
  ['Die-off time T90', `${CONFIG.decay.t90Hours} h ${ln(u.t90Sigma)}`],
  ['Spreading (dispersion)', ln(u.dispersionSigma)],
  ['Tidal excursion', `± ${Math.round(u.excursionSd * 100)}% (1 SD, normal)`],
  ['Net seaward drift', ln(u.netDriftSigma)],
  ['How long a current spill keeps going', `${CONFIG.thamesWater.assumedOngoingHours} h ${ln(u.ongoingSigma)}`],
  ['Rain forecast', `${ln(u.rainSigmaDay0)} today, widening by ${u.rainSigmaPerDay} per day ahead`],
  ['Tide timing', `± ${u.phaseSdHours.admiralty} h with ADMIRALTY predictions, ± ${u.phaseSdHours.ea} h from EA observations, ± ${u.phaseSdHours.fallback} h otherwise`],
  ['Whether each forecast spill happens', 'drawn per overflow from its chance p'],
];
document.getElementById('uncRows').innerHTML = unc.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
document.getElementById('pStep').textContent = `${Math.round(100 / u.members)}%`;

// ---- every parameter, grouped by section
const skip = new Set(['map', 'endpoints', 'activities']);
const fmt = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ') : String(v));
document.getElementById('paramTables').innerHTML = Object.entries(CONFIG)
  .filter(([k]) => !skip.has(k))
  .map(([section, obj]) => `<details><summary><code>${section}</code></summary><table><tbody>${
    Object.entries(obj).map(([k, v]) => `<tr><td><code>${k}</code></td><td>${fmt(v)}</td></tr>`).join('')}</tbody></table></details>`)
  .join('');

// ---- traffic-light table (rules + advice straight from CONFIG.risk)
const R = CONFIG.risk, P = Math.round(R.probability * 100);
const when = {
  high: `The central estimate is ${T.high} ${U} or more, <b>or</b> at least ${P}% of runs reach high.`,
  moderate: `The central estimate is ${T.moderate} ${U} or more, <b>or</b> at least ${P}% of runs reach moderate or worse.`,
  low: 'Neither of the above.',
};
document.getElementById('lightRows').innerHTML = ['high', 'moderate', 'low'].map((k) => {
  const L = R.levels[k];
  return `<tr><td><span class="lightchip" style="background:${L.colour};color:${L.text}">${L.icon} ${L.label}</span></td><td>${when[k]}</td><td>${L.advice}</td></tr>`;
}).join('');
document.getElementById('confHigh').textContent = `${Math.round(R.confidence.high * 100)}%`;
document.getElementById('confMed').textContent = `${Math.round(R.confidence.medium * 100)}%`;
