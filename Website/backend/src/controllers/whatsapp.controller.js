/**
 * WhatsApp webhook: GET verification + POST replies (YES / STOP / STATUS / location pin).
 * Needs the raw request body for the X-Hub-Signature-256 check (app.js keeps req.rawBody).
 */

import RIVER from '../config/river.js';
import { CONFIG } from '../../../shared/river/config.js';
import { distKm } from '../../../shared/river/model/river.js';
import { riskInfo } from '../../../shared/river/model/risk.js';
import { sendText, validSignature, extractMessages } from '../services/whatsapp.service.js';
import { latest, snap, nearestPlace, stretchReport, stretchName, forecastLink, fmtTime } from '../services/riverModel.service.js';
import { subscribers, sightings, claimMessage } from '../db/queries/river.queries.js';

const HELP = `${CONFIG.brand.name} alerts: reply STATUS for your stretch, send a location pin to move your alert area, or STOP to unsubscribe.`;

async function statusText(s) {
  if (!latest.model) return 'The forecast is still loading — try STATUS again in a minute.';
  const A = RIVER.alerts;
  const r = stretchReport(latest.model, s);
  const info = riskInfo(r.now.risk);
  const recent = (await sightings.since(Date.now() - A.sightingHours * 3600e3))
    .filter((x) => distKm([x.lon, x.lat], [s.lon, s.lat]) <= A.sightingRadiusKm).length;
  return `${info.emoji} ${info.label.toUpperCase()} now — ${stretchName(s)}\n` +
    `${info.advice}\n` +
    (r.next ? `${r.next.rising ? 'Rising' : 'Easing'} to ${riskInfo(r.next.to).label.toLowerCase()} around ${fmtTime(r.next.t)}.\n` : 'No change expected in the next 48 hours.\n') +
    (r.source && r.now.risk !== 'low' ? `Mainly from ${r.source}.\n` : '') +
    `7 days: ${r.week}\n` +
    `${CONFIG.risk.certaintyLabel}: ${r.now.confidence.word}. Public sightings nearby (24 h): ${recent}.\n` +
    `Full forecast: ${forecastLink(s)}\nHow it works: ${RIVER.publicMapUrl}/method.html#live-map`;
}

export function verifyWebhook(req, res) {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === RIVER.whatsapp.verifyToken;
  return ok ? res.type('text/plain').send(req.query['hub.challenge']) : res.sendStatus(403);
}

export async function receiveWebhook(req, res) {
  if (!req.rawBody || !validSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  const fresh = [];
  for (const m of extractMessages(req.body ?? {})) if (m.wamid && (await claimMessage(m.wamid))) fresh.push(m);
  res.sendStatus(200); // acknowledge fast; Meta retries otherwise
  for (const m of fresh) handleReply(m).catch((e) => console.error('[WhatsApp] reply failed:', e.message));
}

export async function handleReply({ from, text, location }) {
  const s = await subscribers.get(from);
  const word = text.toUpperCase();
  if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)\b/.test(word)) {
    await subscribers.remove(from);
    return sendText(from, `Unsubscribed — your number and alert area have been deleted. Thanks for using the ${CONFIG.brand.name}.`);
  }
  if (!s) return sendText(from, `You're not signed up. Register your stretch of river at ${RIVER.publicMapUrl}`);
  if (/^(YES|START|CONFIRM|Y)\b/.test(word)) {
    if (s.status === 'pending') {
      await subscribers.activate(from);
      if (latest.model) await subscribers.setStatus(from, stretchReport(latest.model, s).now.risk, false);
    }
    const mode = { low: 'every change, plus early warnings', moderate: 'every change', high: 'changes to or from HIGH risk' }[s.threshold];
    return sendText(from, `Confirmed ✅ You'll get updates for ${stretchName(s)}: ${mode}.\n\n${await statusText(s)}\n\n${HELP}`);
  }
  if (s.status !== 'active') return sendText(from, 'Reply YES to confirm your alerts, or STOP to cancel.');
  if (location?.latitude) {
    const pos = [Number(location.longitude), Number(location.latitude)];
    const sn = snap(pos);
    if (sn.offKm > RIVER.alerts.maxOffRiverKm) return sendText(from, `That spot is ${sn.offKm.toFixed(1)} km from the Thames — alert area unchanged.`);
    await subscribers.upsertPending({ phone: from, lon: pos[0], lat: pos[1], chainage: sn.chainage, place: nearestPlace(pos), name: null, radiusKm: s.radius_km, threshold: s.threshold, activity: s.activity });
    await subscribers.activate(from);
    const moved = await subscribers.get(from);
    if (latest.model) await subscribers.setStatus(from, stretchReport(latest.model, moved).now.risk, false);
    return sendText(from, `Alert area moved to near ${nearestPlace(pos)}.\n\n${await statusText(moved)}`);
  }
  if (/^STATUS\b/.test(word)) return sendText(from, await statusText(s));
  return sendText(from, HELP);
}
