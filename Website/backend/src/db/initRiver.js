import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pool } from './db.js';

/** Create the river_* tables if they don't exist (idempotent; safe on every start). */
export async function ensureRiverTables() {
  const sql = readFileSync(path.resolve(import.meta.dirname, 'river.sql'), 'utf8');
  const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await pool.query(s);
  console.log('[DB] river tables ready');
}
