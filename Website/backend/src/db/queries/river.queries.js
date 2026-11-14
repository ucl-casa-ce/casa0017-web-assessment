/**
 * River-user queries: WhatsApp subscribers, public sightings, processed webhook ids.
 */
import { pool } from '../db.js';

const q = async (sql, params = []) => (await pool.query(sql, params))[0];

export const subscribers = {
  get: async (phone) => (await q('SELECT * FROM river_subscriber WHERE phone = ?', [phone]))[0] ?? null,
  active: () => q("SELECT * FROM river_subscriber WHERE status = 'active'"),
  countActive: async () => (await q("SELECT COUNT(*) AS n FROM river_subscriber WHERE status = 'active'"))[0].n,
  upsertPending: (s) => q(
    `INSERT INTO river_subscriber (phone, lon, lat, chainage_km, place, name, radius_km, threshold, activity, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
     ON DUPLICATE KEY UPDATE lon=VALUES(lon), lat=VALUES(lat), chainage_km=VALUES(chainage_km), place=VALUES(place),
       name=VALUES(name), radius_km=VALUES(radius_km), threshold=VALUES(threshold), activity=VALUES(activity),
       last_status=NULL, pending_status=NULL, pending_since=NULL, warned_status=NULL`,
    [s.phone, s.lon, s.lat, s.chainage, s.place, s.name ?? null, s.radiusKm, s.threshold, s.activity ?? null, Date.now()]
  ),
  async countOptin(phone) {
    const day = new Date().toISOString().slice(0, 10);
    await q(`UPDATE river_subscriber SET optin_sends = IF(optin_day = ?, optin_sends + 1, 1), optin_day = ? WHERE phone = ?`, [day, day, phone]);
    return (await q('SELECT optin_sends FROM river_subscriber WHERE phone = ?', [phone]))[0]?.optin_sends ?? 0;
  },
  activate: (phone) => q("UPDATE river_subscriber SET status='active', confirmed_at=? WHERE phone=?", [Date.now(), phone]),
  /** Record the status the user now knows about (after a message, or silently). */
  setStatus: (phone, status, notified) => notified
    ? q('UPDATE river_subscriber SET last_status=?, pending_status=NULL, pending_since=NULL, last_alert_at=? WHERE phone=?', [status, Date.now(), phone])
    : q('UPDATE river_subscriber SET last_status=?, pending_status=NULL, pending_since=NULL WHERE phone=?', [status, phone]),
  setPending: (phone, status) => q('UPDATE river_subscriber SET pending_status=?, pending_since=? WHERE phone=?', [status, Date.now(), phone]),
  clearPending: (phone) => q('UPDATE river_subscriber SET pending_status=NULL, pending_since=NULL WHERE phone=?', [phone]),
  setWarned: (phone, status) => q('UPDATE river_subscriber SET warned_status=?, last_alert_at=COALESCE(?, last_alert_at) WHERE phone=?',
    [status, status ? Date.now() : null, phone]),
  remove: (phone) => q('DELETE FROM river_subscriber WHERE phone = ?', [phone]),
  purgePending: (olderThanMs) => q("DELETE FROM river_subscriber WHERE status='pending' AND created_at < ?", [Date.now() - olderThanMs]),
};

export const sightings = {
  async add(s) {
    const r = await q(`INSERT INTO river_sighting (lon, lat, chainage_km, off_river_km, place, types, severity, note, observed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.lon, s.lat, s.chainage, s.offKm, s.place, JSON.stringify(s.types), s.severity, s.note || null, s.observedAt, Date.now()]);
    return r.insertId;
  },
  since: async (t) => (await q('SELECT * FROM river_sighting WHERE hidden = 0 AND observed_at >= ? ORDER BY observed_at DESC', [t]))
    .map((r) => ({ ...r, types: typeof r.types === 'string' ? JSON.parse(r.types) : r.types })),
  hide: async (id) => (await q('UPDATE river_sighting SET hidden = 1 WHERE id = ?', [id])).affectedRows,
  purge: (olderThanMs) => q('DELETE FROM river_sighting WHERE observed_at < ?', [Date.now() - olderThanMs]),
};

/** True the first time a WhatsApp message id is seen. */
export async function claimMessage(wamid) {
  const r = await q('INSERT IGNORE INTO river_wa_message (wamid, received_at) VALUES (?, ?)', [wamid, Date.now()]);
  return r.affectedRows === 1;
}
export const pruneMessages = () => q('DELETE FROM river_wa_message WHERE received_at < ?', [Date.now() - 8 * 86400e3]);
