/**
 * Threshold Service
 *
 * Calculates rainfall thresholds that trigger spills at each outfall
 * based on historical spill event data.
 *
 * @module services/threshold
 */

import { pool } from '../db/db.js';

/** @typedef {import('../types').OutfallThreshold} OutfallThreshold */

/**
 * Get rainfall thresholds for outfalls based on historical spill data
 *
 * @param {number|null} [maxRainMm] - Filter to outfalls that spill at or below this rainfall
 * @returns {Promise<OutfallThreshold[]>} Outfalls with threshold statistics
 */
export async function getOutfallThresholds(maxRainMm = null) {
  const params = [];
  let havingSql = '';

  if (maxRainMm !== null && !Number.isNaN(Number(maxRainMm))) {
    havingSql = 'HAVING minRain24hMm <= ?';
    params.push(Number(maxRainMm));
  }

  const [rows] = await pool.query(
    `SELECT
       o.permit_number AS permitNumber,
       o.location_name AS locationName,
       o.receiving_watercourse AS receivingWaterCourse,
       o.lat,
       o.lng,
       MIN(se.rain_24h_mm) AS minRain24hMm,
       ROUND(AVG(se.rain_24h_mm), 2) AS avgRain24hMm,
       COUNT(se.id) AS spillCount
     FROM outfalls o
     JOIN spill_event se ON o.permit_number = se.outfall_id
     WHERE se.rain_24h_mm IS NOT NULL
     GROUP BY o.permit_number, o.location_name, o.receiving_watercourse, o.lat, o.lng
     ${havingSql}
     ORDER BY minRain24hMm ASC`,
    params
  );

  return rows;
}