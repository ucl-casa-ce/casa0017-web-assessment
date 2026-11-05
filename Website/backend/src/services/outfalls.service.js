/**
 * Outfalls Service
 *
 * Retrieves outfall data from database with live API fallback.
 *
 * @module services/outfalls
 */

import { pool } from '../db/db.js';
import { fetchDischargeStatus } from './thamesWater.service.js';

/** @typedef {import('../types').Outfall} Outfall */
/** @typedef {import('../types').OutfallWithGauge} OutfallWithGauge */

/**
 * Get all outfalls from database with live API fallback
 *
 * @param {string|null} [river] - Filter by river/watercourse name
 * @returns {Promise<OutfallWithGauge[] | Outfall[]>} Outfalls with gauge info or live data
 */
export async function getAllOutfalls(river = null) {
  const params = [];
  let whereSql = '';

  if (river) {
    whereSql = 'WHERE o.receiving_watercourse LIKE ?';
    params.push(`%${river}%`);
  }

  const [rows] = await pool.query(
    `SELECT
       o.permit_number AS permitNumber,
       o.location_name AS locationName,
       o.receiving_watercourse AS receivingWaterCourse,
       o.easting,
       o.northing,
       o.lat,
       o.lng,
       o.is_discharging AS isDischarging,
       o.most_recent_start AS mostRecentStart,
       o.most_recent_stop AS mostRecentStop,
       og.gauge_id AS pairedGaugeId,
       og.distance_km AS gaugeDistanceKm
     FROM outfalls o
     LEFT JOIN outfall_gauge og ON o.permit_number = og.outfall_id
     ${whereSql}
     ORDER BY o.location_name ASC`,
    params
  );

  if (rows.length === 0) {
    const live = await fetchDischargeStatus();
    return live.items || [];
  }

  return rows;
}

/**
 * Get a single outfall by permit number
 *
 * @param {string} permitNumber - Permit number to look up
 * @returns {Promise<Outfall | null>} Outfall data or null if not found
 */
export async function getOutfallByPermit(permitNumber) {
  const [rows] = await pool.query(
    `SELECT
       permit_number AS permitNumber,
       location_name AS locationName,
       receiving_watercourse AS receivingWaterCourse,
       easting, northing, lat, lng,
       is_discharging AS isDischarging,
       most_recent_start AS mostRecentStart,
       most_recent_stop AS mostRecentStop
     FROM outfalls
     WHERE permit_number = ?`,
    [permitNumber]
  );
  return rows[0] || null;
}