/**
 * Google reCAPTCHA v3 verification for public sighting reports.
 * No RECAPTCHA_SECRET = check skipped (local development only; logged once).
 */
import RIVER from '../config/river.js';

if (!RIVER.recaptcha.secret) console.warn('[reCAPTCHA] RECAPTCHA_SECRET not set — sighting spam check is OFF (local testing only).');

export async function verifyCaptcha(token) {
  const R = RIVER.recaptcha;
  if (!R.secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' };
  try {
    const res = await fetch(R.verifyUrl, { method: 'POST', body: new URLSearchParams({ secret: R.secret, response: token }) });
    const j = await res.json();
    if (!j.success) return { ok: false, reason: (j['error-codes'] ?? []).join(',') || 'failed' };
    if (j.action !== R.action) return { ok: false, reason: `action ${j.action}` };
    if (R.hostnames.length && !R.hostnames.includes(j.hostname)) return { ok: false, reason: `hostname ${j.hostname}` };
    if (!(j.score >= R.minScore)) return { ok: false, reason: `score ${j.score}` };
    return { ok: true, score: j.score };
  } catch (e) {
    return { ok: false, reason: `verify unavailable: ${e.message}` };
  }
}
