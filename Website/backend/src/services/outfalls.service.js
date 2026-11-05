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

/**
 * Get all outfalls as GeoJSON FeatureCollection
 */
export async function getOutfallsGeoJSON(options = {}) {
  const { river = null, activeOnly = false } = options;

  const conditions = ['o.lat IS NOT NULL', 'o.lng IS NOT NULL'];
  const params = [];

  if (river) {
    conditions.push('o.receiving_watercourse REGEXP ?');
    params.push(river);
  }

  if (activeOnly) {
    conditions.push('o.is_discharging = 1');
  }

  const [rows] = await pool.query(`
    SELECT
      o.permit_number,
      o.location_name,
      o.receiving_watercourse,
      o.lat,
      o.lng,
      o.is_discharging,
      o.most_recent_start,
      COUNT(s.id) AS spill_count,
      ROUND(MIN(s.rain_24h_mm), 2) AS min_rain_24h,
      ROUND(AVG(s.rain_24h_mm), 2) AS avg_rain_24h
    FROM outfalls o
    LEFT JOIN spill_event s ON o.permit_number = s.outfall_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY o.permit_number, o.location_name, o.receiving_watercourse,
             o.lat, o.lng, o.is_discharging, o.most_recent_start
    ORDER BY o.location_name
  `, params);

  const features = rows.map(row => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.lng, row.lat]
    },
    properties: {
      permitNumber: row.permit_number,
      locationName: row.location_name,
      river: row.receiving_watercourse,
      isDischarging: Boolean(row.is_discharging),
      mostRecentStart: row.most_recent_start,
      spillCount: row.spill_count,
      minRain24h: row.min_rain_24h,
      avgRain24h: row.avg_rain_24h
    }
  }));

  return { type: 'FeatureCollection', features };
}