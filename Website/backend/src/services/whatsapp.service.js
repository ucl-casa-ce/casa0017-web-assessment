/**
 * WhatsApp Cloud API client: template + text sends, webhook signature check.
 * DRY_RUN (default without WHATSAPP_TOKEN) logs messages instead of sending.
 *
 * @module services/whatsapp
 */

import crypto from 'node:crypto';
import RIVER from '../config/river.js';

const W = RIVER.whatsapp;
const url = () => `https://graph.facebook.com/${W.graphVersion}/${W.phoneNumberId}/messages`;

async function post(body) {
  if (RIVER.dryRun) {
    console.log('[DRY_RUN] WhatsApp →', JSON.stringify(body));
    return { dryRun: true };
  }
  const res = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${W.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json; // json.messages[0].id is the wamid
}

/** Business-initiated message: must be an approved template. */
export function sendTemplate(to, name, params = []) {
  return post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name,
      language: { code: W.language },
      components: params.length
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).replace(/\s*\n\s*/g, ' ') })) }]
        : [],
    },
  });
}

/** Free-form text: only allowed inside the 24-h window opened by the user's message. */
export function sendText(to, body) {
  return post({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body } });
}

/** Verify X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(rawBody, appSecret). */
export function validSignature(rawBody, header) {
  if (!W.appSecret) return RIVER.dryRun; // allow unsigned only when testing locally
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', W.appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Pull user replies out of a webhook payload (text, template quick-reply, interactive reply). */
export function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      for (const m of change.value?.messages ?? []) {
        const text = m.text?.body ?? m.button?.payload ?? m.button?.text ??
          m.interactive?.button_reply?.title ?? m.interactive?.button_reply?.id ?? '';
        out.push({ wamid: m.id, from: m.from, text: String(text).trim(), location: m.location });
      }
    }
  }
  return out;
}
