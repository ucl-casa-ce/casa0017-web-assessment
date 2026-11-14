/**
 * River controller — endpoints for the river-user Live map (frontend live.html).
 *
 *   GET    /api/river/inputs            model inputs bundle (cached)
 *   GET    /api/river/status?lon&lat&r  plain-language status for a stretch (server-side model)
 *   GET    /api/river/sightings?days=7  public sightings (GeoJSON)
 *   POST   /api/river/sightings         new sighting (reCAPTCHA v3)
 *   DELETE /api/river/sightings/:id     hide a sighting (x-admin-token)
 *   POST   /api/river/subscribe         WhatsApp sign-up → opt-in template (double opt-in)
 *   GET    /api/river/health            model/alerts status
 */

import RIVER from '../config/river.js';
import { CONFIG } from '../../../shared/river/config.js';
import { riskInfo } from '../../../shared/river/model/risk.js';
import { getRiverInputs } from '../services/riverInputs.service.js';
import { latest, runModel, snap, nearestPlace, stretchReport } from '../services/riverModel.service.js';
import { verifyCaptcha } from '../services/recaptcha.service.js';
import { sendTemplate } from '../services/whatsapp.service.js';
import { subscribers, sightings } from '../db/queries/river.queries.js';

// In-memory per-IP counters: IP addresses are never written to the database.
function perHour(max) {
  const hits = new Map();
  return (ip) => {
    const hour = Math.floor(Date.now() / 3600e3);
    const rec = hits.get(ip);
    const n = rec?.hour === hour ? rec.n + 1 : 1;
    hits.set(ip, { hour, n });
    return n > max;
  };
}
const subscribeLimited = perHour(RIVER.rateLimit.subscribePerIpPerHour);
const sightingLimited = perHour(RIVER.sightings.perIpPerHour);

/** UK-friendly → E.164 digits without '+', e.g. "07700 900123" → "447700900123". */
export function normalisePhone(input) {
  let p = String(input ?? '').replace(/[\s().-]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (/^07\d{9}$/.test(p)) p = '44' + p.slice(1); // [ASSUMPTION] bare 07… = UK mobile
  return /^\d{10,15}$/.test(p) ? p : null;
}

export async function getInputs(req, res, next) {
  try {
    const inputs = await getRiverInputs();
    res.set('Cache-Control', 'public, max-age=120');
    res.json(inputs);
  } catch (err) {
    err.status = 503;
    next(err);
  }
}

export async function getStatus(req, res, next) {
  try {
    const pos = [Number(req.query.lon), Number(req.query.lat)];
    const radius = Number(req.query.r) || 3;
    if (!pos.every(Number.isFinite)) return res.status(400).json({ success: false, error: 'lon and lat are required' });
    const sn = snap(pos);
    if (sn.offKm > RIVER.alerts.maxOffRiverKm) return res.status(400).json({ success: false, error: `That spot is ${sn.offKm.toFixed(1)} km from the Thames` });
    if (!latest.model || Date.now() - latest.at > 20 * 60e3) runModel(await getRiverInputs());
    const r = stretchReport(latest.model, { chainage_km: sn.chainage, radius_km: radius });
    const info = riskInfo(r.now.risk);
    res.json({
      success: true,
      data: {
        place: nearestPlace(pos), radiusKm: radius, modelAt: latest.at,
        now: { risk: r.now.risk, label: info.label, advice: info.advice, certainty: r.now.confidence.word },
        next: r.next ? { risk: r.next.to, rising: r.next.rising, at: r.next.t } : null,
        days: r.days.map((d) => ({ day: d.day, date: d.date, risk: d.risk })),
      },
    });
  } catch (err) { next(err); }
}

export async function listSightings(req, res, next) {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || CONFIG.sightings.showDays));
    const rows = await sightings.since(Date.now() - days * 86400e3);
    res.json({
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { id: r.id, place: r.place, chainageKm: r.chainage_km, types: r.types, severity: r.severity, note: r.note, observedAt: Number(r.observed_at), reportedAt: Number(r.created_at) },
      })),
    });
  } catch (err) { next(err); }
}

export async function createSighting(req, res, next) {
  try {
    if (sightingLimited(req.ip)) return res.status(429).json({ error: 'Too many reports from this connection — try again later.' });
    const S = RIVER.sightings;
    const { lon, lat, types, severity, note, observedAt, captcha } = req.body ?? {};
    const cap = await verifyCaptcha(captcha);
    if (!cap.ok) {
      console.warn('[River] sighting rejected by reCAPTCHA:', cap.reason);
      return res.status(403).json({ error: 'Our spam check could not confirm this report. Please try again in a moment.' });
    }
    const pos = [Number(lon), Number(lat)];
    if (!pos.every(Number.isFinite)) return res.status(400).json({ error: 'Choose where you saw it first.' });
    const sn = snap(pos);
    if (sn.offKm > S.maxOffRiverKm) return res.status(400).json({ error: `That spot is ${sn.offKm.toFixed(1)} km from the Thames (max ${S.maxOffRiverKm} km).` });
    const allowed = new Set(CONFIG.sightings.types);
    const t = Array.isArray(types) ? [...new Set(types)].filter((x) => allowed.has(x)) : [];
    if (!t.length) return res.status(400).json({ error: 'Tick at least one thing you saw.' });
    const sev = Number(severity);
    if (![1, 2, 3].includes(sev)) return res.status(400).json({ error: 'Choose how bad it was.' });
    const obs = observedAt ? Date.parse(observedAt) : Date.now();
    if (!Number.isFinite(obs) || obs > Date.now() + 10 * 60e3 || obs < Date.now() - S.maxAgeHours * 3600e3)
      return res.status(400).json({ error: `Time seen must be within the last ${S.maxAgeHours} hours.` });
    const clean = String(note ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, CONFIG.sightings.maxNote);
    const id = await sightings.add({ lon: pos[0], lat: pos[1], chainage: sn.chainage, offKm: sn.offKm, place: nearestPlace(pos), types: t, severity: sev, note: clean, observedAt: obs });
    res.status(201).json({ ok: true, id });
  } catch (err) { next(err); }
}

export async function hideSighting(req, res, next) {
  try {
    const tok = RIVER.sightings.adminToken;
    if (!tok || req.get('x-admin-token') !== tok) return res.sendStatus(403);
    res.json({ hidden: await sightings.hide(Number(req.params.id)) });
  } catch (err) { next(err); }
}

export async function subscribe(req, res, next) {
  try {
    const A = RIVER.alerts;
    if (subscribeLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts — try again later.' });
    const { phone, lon, lat, radiusKm, threshold, activity, consent, name } = req.body ?? {};
    const p = normalisePhone(phone);
    if (!consent) return res.status(400).json({ error: 'Consent is required.' });
    if (!p) return res.status(400).json({ error: 'Enter a mobile number in international format, e.g. +44 7700 900123.' });
    if (!['low', 'moderate', 'high'].includes(threshold)) return res.status(400).json({ error: 'Invalid alert level.' });
    const radius = Number(radiusKm);
    if (!A.radiusOptionsKm.includes(radius)) return res.status(400).json({ error: 'Invalid radius.' });
    const pos = [Number(lon), Number(lat)];
    if (!pos.every(Number.isFinite)) return res.status(400).json({ error: 'Choose a location first.' });
    const sn = snap(pos);
    if (sn.offKm > A.maxOffRiverKm) return res.status(400).json({ error: `That spot is ${sn.offKm.toFixed(1)} km from the Thames (max ${A.maxOffRiverKm} km).` });
    const place = nearestPlace(pos);
    if ((await subscribers.get(p))?.status === 'active') {
      return res.status(409).json({ error: 'This number is already subscribed. Send a location pin in WhatsApp to move your area, or STOP to cancel.' });
    }
    const cleanName = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || null : null;
    await subscribers.upsertPending({ phone: p, lon: pos[0], lat: pos[1], chainage: sn.chainage, place, name: cleanName, radiusKm: radius, threshold, activity: typeof activity === 'string' ? activity.slice(0, 40) : null });
    if ((await subscribers.countOptin(p)) > RIVER.rateLimit.optinPerPhonePerDay) {
      return res.status(429).json({ error: 'A confirmation was already sent to this number today. Check WhatsApp.' });
    }
    try {
      await sendTemplate(p, RIVER.whatsapp.templates.optin, [radius, cleanName || place]);
      res.json({ ok: true, message: `Check WhatsApp: reply YES to confirm updates for ${cleanName || place} (±${radius} km).`, dryRun: RIVER.dryRun });
    } catch (e) {
      console.error('[River] opt-in send failed:', e.message);
      res.status(502).json({ error: 'Could not send the WhatsApp confirmation. Is the number on WhatsApp?' });
    }
  } catch (err) { next(err); }
}

export async function health(req, res, next) {
  try {
    res.json({ modelAt: latest.at, dataGaps: latest.problems, activeSubscribers: await subscribers.countActive(), dryRun: RIVER.dryRun });
  } catch (err) { next(err); }
}
