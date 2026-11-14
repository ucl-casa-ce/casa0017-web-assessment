/**
 * River Alerts Service — WhatsApp status-change updates for subscribers' stretches.
 *
 * Modes (subscriber.threshold):
 *   'low'      every change + early warning when a rise is forecast within warnAheadHours
 *   'moderate' every change, no early warnings
 *   'high'     only when the stretch reaches or leaves HIGH risk
 * Rises are sent straight away; improvements must last downgradeHoldMinutes.
 * Overnight (quietHours) only rises to HIGH are sent.
 *
 * @module services/riverAlerts
 */

import RIVER from '../config/river.js';
import { subscribers } from '../db/queries/river.queries.js';
import { sendTemplate } from './whatsapp.service.js';
import { stretchReport, stretchName, forecastLink, fmtTime } from './riverModel.service.js';
import { riskInfo, riskRank } from '../../../shared/river/model/risk.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const label = (r) => riskInfo(r).label.toUpperCase();
const light = (r) => `${riskInfo(r).emoji} ${label(r)}`;

function inQuietHours(now = Date.now()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const { start, end } = RIVER.alerts.quietHours;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

function adviceFor(r, warning) {
  if (warning) return `If you're on the water then: ${riskInfo(r.rise.risk).advice}`;
  const nx = r.next ? ` ${r.next.rising ? 'Rising' : 'Easing'} to ${riskInfo(r.next.to).label.toLowerCase()} around ${fmtTime(r.next.t)}.` : '';
  return riskInfo(r.now.risk).advice + nx;
}
function sendStatus(s, r, headline, reason, warning = false) {
  return sendTemplate(s.phone, RIVER.whatsapp.templates.status, [
    stretchName(s), headline, reason, r.week, adviceFor(r, warning), forecastLink(s),
  ]);
}

export async function checkSubscribers(model) {
  const A = RIVER.alerts;
  let sent = 0;
  for (const s of await subscribers.active()) {
    try {
      const r = stretchReport(model, s);
      const cur = r.now.risk;
      const last = s.last_status ?? cur;
      const quiet = inQuietHours();
      const gapOk = !s.last_alert_at || Date.now() - s.last_alert_at >= A.minGapMinutes * 60e3;
      const relevant = s.threshold === 'high' ? (cur === 'high') !== (last === 'high') : cur !== last;

      if (cur === last) {
        if (s.pending_status) await subscribers.clearPending(s.phone);
      } else if (!relevant) {
        await subscribers.setStatus(s.phone, cur, false); // track silently
      } else if (riskRank(cur) > riskRank(last)) {
        if ((quiet || !gapOk) && cur !== 'high') continue;
        await sendStatus(s, r, `now ${light(cur)} (was ${label(last)})`, r.source ? `Mainly from ${r.source}.` : 'Sewage from overflows is likely to be reaching this stretch.');
        await subscribers.setStatus(s.phone, cur, true);
        if (s.warned_status && riskRank(cur) >= riskRank(s.warned_status)) await subscribers.setWarned(s.phone, null);
        sent++;
        continue;
      } else {
        if (s.pending_status !== cur) { await subscribers.setPending(s.phone, cur); continue; }
        if (Date.now() - s.pending_since < A.downgradeHoldMinutes * 60e3 || quiet || !gapOk) continue;
        await sendStatus(s, r, `now ${light(cur)} (was ${label(last)})`, cur === 'low'
          ? 'Sewage from recent spills is expected to have cleared or died off.'
          : 'Conditions are improving as recent spills clear.');
        await subscribers.setStatus(s.phone, cur, true);
        sent++;
        continue;
      }

      if (s.threshold === 'low' && r.rise && s.warned_status !== r.rise.risk && riskRank(r.rise.risk) > riskRank(cur)) {
        if ((quiet || !gapOk) && r.rise.risk !== 'high') continue;
        const chance = r.rise.risk === 'high' ? r.rise.pHigh : r.rise.pMod;
        await sendStatus(s, r, `${label(cur)} now, ${light(r.rise.risk)} expected around ${fmtTime(r.rise.t)} (${pct(chance)} chance)`,
          r.source ? `Mainly from ${r.source}.` : 'Rain is forecast to trigger overflows upstream.', true);
        await subscribers.setWarned(s.phone, r.rise.risk);
        sent++;
      } else if (s.warned_status && !r.rise) {
        await subscribers.setWarned(s.phone, null);
      }
    } catch (err) {
      console.error(`[RiverAlerts] update to …${s.phone.slice(-4)} failed:`, err.message);
    }
  }
  return sent;
}
