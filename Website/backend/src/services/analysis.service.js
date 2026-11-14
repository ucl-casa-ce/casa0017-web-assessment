/**
 * Analysis Service
 *
 * Provides aggregated statistics for research questions:
 * - Q1: What triggers a discharge? (rainfall thresholds)
 * - Q2: Where does it go? (tidal phase by river)
 */

import { pool } from '../db/db.js';

/**
 * Get tidal phase statistics by river
 */
export async function getTidalStatsByRiver(options = {}) {
  const { rivers = null, minEvents = 10 } = options;

  let whereSql = '';
  const params = [];

  if (rivers && rivers.length > 0) {
    whereSql = 'WHERE o.receiving_watercourse REGEXP ?';
    params.push(rivers.join('|'));
  }

  params.push(minEvents);

  const [rows] = await pool.query(`
    SELECT
      o.receiving_watercourse AS river,
      COUNT(s.id) AS totalEvents,
      SUM(CASE WHEN UPPER(s.tidal_phase_at_start) = 'FLOOD' THEN 1 ELSE 0 END) AS floodCount,
      SUM(CASE WHEN UPPER(s.tidal_phase_at_start) = 'EBB' THEN 1 ELSE 0 END) AS ebbCount,
      ROUND(100.0 * SUM(CASE WHEN UPPER(s.tidal_phase_at_start) = 'FLOOD' THEN 1 ELSE 0 END) / COUNT(s.id), 1) AS floodPct,
      ROUND(100.0 * SUM(CASE WHEN UPPER(s.tidal_phase_at_start) = 'EBB' THEN 1 ELSE 0 END) / COUNT(s.id), 1) AS ebbPct
    FROM spill_event s
    JOIN outfalls o ON s.outfall_id = o.permit_number
    ${whereSql}
    GROUP BY o.receiving_watercourse
    HAVING COUNT(s.id) >= ?
    ORDER BY totalEvents DESC
  `, params);

  return rows;
}

/**
 * Get rainfall threshold statistics
 */
export async function getRainfallThresholds(options = {}) {
  const { river = null, maxThreshold = null, limit = 100 } = options;

  const conditions = ['s.rain_24h_mm IS NOT NULL'];
  const params = [];

  if (river) {
    conditions.push('o.receiving_watercourse REGEXP ?');
    params.push(river);
  }

  const havingConditions = [];
  if (maxThreshold !== null) {
    havingConditions.push('minRain24h <= ?');
    params.push(maxThreshold);
  }

  params.push(limit);

  const [rows] = await pool.query(`
    SELECT
      o.permit_number AS permitNumber,
      o.location_name AS locationName,
      o.receiving_watercourse AS river,
      o.lat,
      o.lng,
      COUNT(s.id) AS spillCount,
      ROUND(MIN(s.rain_24h_mm), 2) AS minRain24h,
      ROUND(AVG(s.rain_24h_mm), 2) AS avgRain24h,
      ROUND(MAX(s.rain_24h_mm), 2) AS maxRain24h,
      ROUND(MIN(s.rain_48h_mm), 2) AS minRain48h,
      ROUND(AVG(s.rain_48h_mm), 2) AS avgRain48h,
      ROUND(MIN(s.rain_72h_mm), 2) AS minRain72h,
      ROUND(AVG(s.rain_72h_mm), 2) AS avgRain72h
    FROM spill_event s
    JOIN outfalls o ON s.outfall_id = o.permit_number
    WHERE ${conditions.join(' AND ')}
    GROUP BY o.permit_number, o.location_name, o.receiving_watercourse, o.lat, o.lng
    ${havingConditions.length > 0 ? 'HAVING ' + havingConditions.join(' AND ') : ''}
    ORDER BY minRain24h ASC
    LIMIT ?
  `, params);

  return rows;
}

/**
 * Get antecedent wetness analysis
 */
export async function getAntecedentAnalysis(options = {}) {
  const { river = null } = options;

  let whereSql = 'WHERE s.rain_24h_mm IS NOT NULL AND s.rain_48h_mm IS NOT NULL';
  const params = [];

  if (river) {
    whereSql += ' AND o.receiving_watercourse REGEXP ?';
    params.push(river);
  }

  const [rows] = await pool.query(`
    SELECT
      CASE
        WHEN s.rain_24h_mm < 2 THEN '0-2mm'
        WHEN s.rain_24h_mm < 5 THEN '2-5mm'
        WHEN s.rain_24h_mm < 10 THEN '5-10mm'
        WHEN s.rain_24h_mm < 20 THEN '10-20mm'
        ELSE '20mm+'
      END AS rain24hBin,
      COUNT(*) AS eventCount,
      ROUND(AVG(s.rain_24h_mm), 2) AS avgRain24h,
      ROUND(AVG(s.rain_48h_mm), 2) AS avgRain48h,
      ROUND(AVG(s.rain_72h_mm), 2) AS avgRain72h,
      ROUND(AVG(s.rain_48h_mm - s.rain_24h_mm), 2) AS avgPrior24h,
      ROUND(AVG(s.rain_72h_mm - s.rain_48h_mm), 2) AS avgPrior48to72h
    FROM spill_event s
    JOIN outfalls o ON s.outfall_id = o.permit_number
    ${whereSql}
    GROUP BY rain24hBin
    ORDER BY FIELD(rain24hBin, '0-2mm', '2-5mm', '5-10mm', '10-20mm', '20mm+')
  `, params);

  return rows;
}

/**
 * Get summary statistics for dashboard
 */
export async function getSummaryStats() {
  const [[totals]] = await pool.query(`
    SELECT
      COUNT(*) AS totalEvents,
      SUM(CASE WHEN rain_24h_mm IS NOT NULL THEN 1 ELSE 0 END) AS withRainfall,
      SUM(CASE WHEN tidal_phase_at_start IS NOT NULL THEN 1 ELSE 0 END) AS withTidal,
      COUNT(DISTINCT outfall_id) AS outfallCount
    FROM spill_event
  `);

  const [[dateRange]] = await pool.query(`
    SELECT MIN(start_ts) AS earliest, MAX(start_ts) AS latest FROM spill_event
  `);

  const [topRivers] = await pool.query(`
    SELECT o.receiving_watercourse AS river, COUNT(*) AS eventCount
    FROM spill_event s
    JOIN outfalls o ON s.outfall_id = o.permit_number
    GROUP BY o.receiving_watercourse
    ORDER BY eventCount DESC
    LIMIT 10
  `);

  return {
    totals: {
      events: totals.totalEvents,
      withRainfall: totals.withRainfall,
      withTidal: totals.withTidal,
      outfalls: totals.outfallCount,
      rainfallPct: Math.round(100 * totals.withRainfall / totals.totalEvents),
      tidalPct: Math.round(100 * totals.withTidal / totals.totalEvents)
    },
    dateRange: { earliest: dateRange.earliest, latest: dateRange.latest },
    topRivers
  };
}

/**
 * Get spill events as scatter data for visualization
 */
export async function getScatterData(options = {}) {
  const { river = null, bbox = null, limit = 1000 } = options;

  let whereSql = 'WHERE s.rain_24h_mm IS NOT NULL AND s.end_ts IS NOT NULL';
  const params = [];

  if (river) {
    whereSql += ' AND o.receiving_watercourse REGEXP ?';
    params.push(river);
  }

  if (bbox) {
    whereSql += ' AND o.lng BETWEEN ? AND ? AND o.lat BETWEEN ? AND ?';
    params.push(bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat);
  }

  params.push(limit);

  const [rows] = await pool.query(`
    SELECT
      s.outfall_id AS permitNumber,
      o.location_name AS locationName,
      o.receiving_watercourse AS river,
      s.rain_24h_mm AS rain24h,
      s.rain_48h_mm AS rain48h,
      s.tidal_phase_at_start AS tidalPhase,
      ROUND(TIMESTAMPDIFF(MINUTE, s.start_ts, s.end_ts) / 60, 2) AS durationHours,
      s.start_ts AS startTime
    FROM spill_event s
    JOIN outfalls o ON s.outfall_id = o.permit_number
    ${whereSql}
    ORDER BY s.start_ts DESC
    LIMIT ?
  `, params);

  return rows;
}
