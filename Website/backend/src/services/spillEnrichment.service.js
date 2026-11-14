/**
 * Spill Event Enrichment Service
 *
 * Enriches spill events with environmental context data:
 * - 24-hour rainfall at the time of spill
 * - Tidal phase (flood/ebb) at spill start
 * - Whether the spill is tidally trapped
 *
 * @module services/spillEnrichment
 */

import { pool } from '../db/db.js';
import { calculate24hRainfall } from './rainGauge.service.js';
import { getTidalPhaseAt } from './tideForecast.service.js';

/**
 * Get the paired rain gauge for an outfall
 *
 * @param {string} permitNumber - Outfall permit number
 * @returns {Promise<{ gaugeId: string, distanceKm: number } | null>}
 */
async function getPairedGauge(permitNumber) {
  const [rows] = await pool.query(
    `SELECT gauge_id AS gaugeId, distance_km AS distanceKm
     FROM outfall_gauge
     WHERE outfall_id = ?
     LIMIT 1`,
    [permitNumber]
  );
  return rows[0] || null;
}

/**
 * Enrich a single spill event with environmental data
 *
 * @param {Object} event - Spill event
 * @param {string} event.permitNumber - Outfall permit number
 * @param {string} event.startTime - ISO timestamp of spill start
 * @returns {Promise<Object>} Enriched event
 */
export async function enrichSpillEvent(event) {
  const enriched = { ...event };
  const startTime = new Date(event.startTime);

  // Get paired rain gauge
  const pairing = await getPairedGauge(event.permitNumber);

  if (pairing) {
    // Calculate 24h rainfall before spill
    const rainfall = await calculate24hRainfall(pairing.gaugeId, startTime);
    enriched.rain24hMm = Math.round(rainfall * 100) / 100;
    enriched.pairedGaugeId = pairing.gaugeId;
    enriched.gaugeDistanceKm = pairing.distanceKm;
  } else {
    enriched.rain24hMm = null;
    enriched.pairedGaugeId = null;
    enriched.gaugeDistanceKm = null;
  }

  // Get tidal phase at spill start
  try {
    const tidalPhase = await getTidalPhaseAt(startTime);
    enriched.tidalPhaseAtStart = tidalPhase;
    enriched.isTidallyTrapped = tidalPhase === 'FLOOD';
  } catch {
    enriched.tidalPhaseAtStart = 'UNKNOWN';
    enriched.isTidallyTrapped = null;
  }

  return enriched;
}

/**
 * Store enriched spill event data in database
 *
 * @param {Object} enrichedEvent - Enriched spill event
 * @returns {Promise<void>}
 */
export async function storeEnrichedSpillEvent(enrichedEvent) {
  const sql = `
    INSERT INTO spill_event (
      outfall_id, start_ts, end_ts, rain_24h_mm,
      tidal_phase_at_start, is_tidally_trapped
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      end_ts = VALUES(end_ts),
      rain_24h_mm = COALESCE(VALUES(rain_24h_mm), rain_24h_mm),
      tidal_phase_at_start = COALESCE(VALUES(tidal_phase_at_start), tidal_phase_at_start),
      is_tidally_trapped = COALESCE(VALUES(is_tidally_trapped), is_tidally_trapped)
  `;

  await pool.query(sql, [
    enrichedEvent.permitNumber,
    new Date(enrichedEvent.startTime),
    enrichedEvent.stopTime ? new Date(enrichedEvent.stopTime) : null,
    enrichedEvent.rain24hMm,
    enrichedEvent.tidalPhaseAtStart,
    enrichedEvent.isTidallyTrapped ? 1 : 0
  ]);
}

/**
 * Backfill rainfall data for existing spill events that are missing it
 *
 * @param {number} [limit=100] - Max events to process
 * @returns {Promise<number>} Number of events updated
 */
export async function backfillRainfallData(limit = 100) {
  // Find events missing rainfall data
  const [events] = await pool.query(`
    SELECT
      se.id,
      se.outfall_id AS permitNumber,
      se.start_ts AS startTime,
      og.gauge_id AS gaugeId
    FROM spill_event se
    JOIN outfall_gauge og ON se.outfall_id = og.outfall_id
    WHERE se.rain_24h_mm IS NULL
    LIMIT ?
  `, [limit]);

  let updated = 0;

  for (const event of events) {
    try {
      const rainfall = await calculate24hRainfall(
        event.gaugeId,
        new Date(event.startTime)
      );

      await pool.query(
        'UPDATE spill_event SET rain_24h_mm = ? WHERE id = ?',
        [Math.round(rainfall * 100) / 100, event.id]
      );

      updated++;
    } catch (err) {
      console.error(`[SpillEnrichment] Failed to backfill event ${event.id}:`, err.message);
    }
  }

  return updated;
}

/**
 * Backfill tidal phase data for existing spill events
 *
 * @param {number} [limit=100] - Max events to process
 * @returns {Promise<number>} Number of events updated
 */
export async function backfillTidalData(limit = 100) {
  // Find events missing tidal phase data
  const [events] = await pool.query(`
    SELECT id, start_ts AS startTime
    FROM spill_event
    WHERE tidal_phase_at_start IS NULL
    LIMIT ?
  `, [limit]);

  let updated = 0;

  for (const event of events) {
    try {
      const tidalPhase = await getTidalPhaseAt(new Date(event.startTime));

      if (tidalPhase !== 'UNKNOWN') {
        await pool.query(
          `UPDATE spill_event
           SET tidal_phase_at_start = ?, is_tidally_trapped = ?
           WHERE id = ?`,
          [tidalPhase, tidalPhase === 'FLOOD' ? 1 : 0, event.id]
        );
        updated++;
      }
    } catch (err) {
      console.error(`[SpillEnrichment] Failed to backfill tidal for event ${event.id}:`, err.message);
    }
  }

  return updated;
}
