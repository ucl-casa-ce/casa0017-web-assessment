/**
 * Spill Events Service
 *
 * Retrieves spill event records from database with live API fallback.
 *
 * @module services/events
 */

import { pool } from '../db/db.js';
import { fetchDischargeAlerts } from './thamesWater.service.js';

/** @typedef {import('../types').SpillEventRecord} SpillEventRecord */
/** @typedef {import('../types').DischargeAlert} DischargeAlert */

/**
 * Get spill events from database with live API fallback
 *
 * @param {Object} [options] - Query options
 * @param {string|null} [options.permitNumber] - Filter by permit number
 * @param {number} [options.limit=500] - Max events to return
 * @returns {Promise<SpillEventRecord[] | DischargeAlert[]>} Spill events or live alerts
 */
export async function getSpillEvents({ permitNumber = null, limit = 500 } = {}) {
  const params = [];
  let whereSql = '';

  if (permitNumber) {
    whereSql = 'WHERE se.outfall_id = ?';
    params.push(permitNumber);
  }

  params.push(Number(limit));

  const [rows] = await pool.query(
    `SELECT
       se.id,
       se.outfall_id AS permitNumber,
       o.location_name AS locationName,
       se.start_ts AS startTime,
       se.end_ts AS stopTime,
       ROUND(TIMESTAMPDIFF(MINUTE, se.start_ts, COALESCE(se.end_ts, UTC_TIMESTAMP())) / 60, 2) AS durationHours,
       se.rain_24h_mm AS rain24hMm,
       se.tidal_phase_at_start AS tidalPhaseAtStart,
       se.is_tidally_trapped AS isTidallyTrapped
     FROM spill_event se
     LEFT JOIN outfalls o ON se.outfall_id = o.permit_number
     ${whereSql}
     ORDER BY se.start_ts DESC
     LIMIT ?`,
    params
  );

  if (rows.length === 0) {
    const liveAlerts = await fetchDischargeAlerts(permitNumber);
    return liveAlerts.items || [];
  }

  return rows;
}