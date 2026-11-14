/**
 * Environment Agency Flood Monitoring API Service
 *
 * Handles tidal and rainfall data from the EA Flood Monitoring API
 * for stations relevant to London sewage monitoring.
 *
 * @module services/eaFlood
 */

import axios from 'axios';
import config from '../config/env.js';
import { pool } from '../db/db.js';

/** @typedef {import('../types').TidalReading} TidalReading */
/** @typedef {import('../types').TidalStatusResponse} TidalStatusResponse */
/** @typedef {import('../types').TidalPhase} TidalPhase */
/** @typedef {import('../types').DispersionState} DispersionState */
/** @typedef {import('../types').RainfallReading} RainfallReading */
/** @typedef {import('../types').RainfallStatusResponse} RainfallStatusResponse */

const client = axios.create({
  baseURL: config.apis.eaFloodBaseUrl,
  timeout: config.apis.timeoutMs
});

const STATIONS = Object.freeze({
  SILVERTOWN_MEASURE: '0001-level-tidal_level-i-15_min-mAOD',
  SILVERTOWN_ID: '0001',
  LEA_BRIDGE_ID: '7375',
  WALTHAMSTOW_RAIN_ID: '5380TH'
});

/**
 * Convert ISO date string to MySQL datetime format
 * @param {string} isoString - ISO date string
 * @returns {string} MySQL datetime string
 */
const toMysqlDateTime = (isoString) =>
  new Date(isoString).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Compute tidal metrics from water levels
 * @param {number} currentLevel - Current water level in mAOD
 * @param {number} previousLevel - Previous water level (15 min ago) in mAOD
 * @param {number|null} [upstreamStage] - Upstream stage level in meters
 * @returns {{ delta15Min: number, hydraulicGradient: number|null, tidalPhase: TidalPhase, dispersionState: DispersionState }}
 */
const computeTidalMetrics = (currentLevel, previousLevel, upstreamStage = null) => {
  const delta15Min = Number((currentLevel - previousLevel).toFixed(3));
  const hydraulicGradient =
    upstreamStage !== null ? Number((upstreamStage - currentLevel).toFixed(3)) : null;
  const isFloodTide = delta15Min > 0;
  const isTideLocked = hydraulicGradient !== null && hydraulicGradient <= 0;

  return {
    delta15Min,
    hydraulicGradient,
    tidalPhase: isFloodTide ? 'FLOOD' : 'EBB',
    dispersionState: isFloodTide || isTideLocked ? 'TIDALLY_TRAPPED' : 'FLUSHED'
  };
};

/**
 * Fetch current tidal status from Silvertown station
 *
 * @returns {Promise<TidalStatusResponse>} Tidal status with readings and metrics
 */
export async function fetchTidalStatus() {
  try {
    const [tidalRes, upstreamRes] = await Promise.all([
      client.get(`/id/measures/${STATIONS.SILVERTOWN_MEASURE}/readings`, {
        params: { _sorted: '', _limit: 12 }
      }),
      client.get(`/id/stations/${STATIONS.LEA_BRIDGE_ID}/readings`, {
        params: { _sorted: '', _limit: 2 }
      })
    ]);

    const tidalReadings = tidalRes.data?.items || [];
    const upstreamReadings = upstreamRes.data?.items || [];

    if (tidalReadings.length < 2) {
      throw new Error('Insufficient tidal readings returned from EA API');
    }

    // TODO: Re-enable caching once we confirm database schema matches API data
    // await cacheTidalReadings(STATIONS.SILVERTOWN_ID, tidalReadings);

    const current = tidalReadings[0];
    const previous = tidalReadings[1];
    const upstreamStage = upstreamReadings[0]?.value ?? null;
    const metrics = computeTidalMetrics(current.value, previous.value, upstreamStage);

    return {
      source: 'live',
      stationId: STATIONS.SILVERTOWN_ID,
      timestamp: current.dateTime,
      currentLevelMAOD: current.value,
      previousLevelMAOD: previous.value,
      upstreamLeaBridgeStageM: upstreamStage,
      ...metrics,
      series: tidalReadings.map((r) => ({
        timestamp: r.dateTime,
        levelMAOD: r.value
      }))
    };
  } catch (error) {
    const cached = await getCachedTidalStatus(STATIONS.SILVERTOWN_ID);
    return {
      source: 'cache_fallback',
      error: error.message,
      ...cached
    };
  }
}

/**
 * Fetch rainfall status from a rain gauge station
 *
 * @param {string} [stationId] - EA rain gauge station ID (defaults to Walthamstow)
 * @param {number} [limit=96] - Max readings to fetch (96 = 24 hours at 15 min intervals)
 * @returns {Promise<RainfallStatusResponse>} Rainfall status with readings
 */
export async function fetchRainfallStatus(stationId = STATIONS.WALTHAMSTOW_RAIN_ID, limit = 96) {
  try {
    const { data } = await client.get(`/id/stations/${stationId}/readings`, {
      params: { parameter: 'rainfall', _sorted: '', _limit: limit }
    });

    const readings = (data?.items || []).map((item) => ({
      gaugeId: stationId,
      timestamp: item.dateTime,
      mm: Number(item.value || 0)
    }));

    // TODO: Re-enable caching once we confirm database schema matches API data
    // if (readings.length > 0) {
    //   await cacheRainfallReadings(readings);
    // }

    const total24hMm = Number(
      readings.slice(0, 96).reduce((sum, r) => sum + r.mm, 0).toFixed(2)
    );

    return {
      source: 'live',
      gaugeId: stationId,
      total24hMm,
      currentRateMmHr: readings[0] ? Number((readings[0].mm * 4).toFixed(2)) : 0,
      count: readings.length,
      readings
    };
  } catch (error) {
    const cached = await getCachedRainfallReadings(stationId, limit);
    const total24hMm = Number(
      cached.slice(0, 96).reduce((sum, r) => sum + Number(r.mm || 0), 0).toFixed(2)
    );

    return {
      source: 'cache_fallback',
      error: error.message,
      gaugeId: stationId,
      total24hMm,
      currentRateMmHr: cached[0] ? Number((cached[0].mm * 4).toFixed(2)) : 0,
      count: cached.length,
      readings: cached
    };
  }
}

/**
 * Cache tidal readings to database
 * @param {string} stationId - Station ID
 * @param {Array<{ dateTime: string, value: number }>} readings - Raw readings from API
 * @returns {Promise<void>}
 */
async function cacheTidalReadings(stationId, readings) {
  const values = readings.map((r) => [
    stationId,
    toMysqlDateTime(r.dateTime),
    r.value
  ]);

  await pool.query(
    'INSERT IGNORE INTO tidal_reading (station_id, ts, level_maod) VALUES ?',
    [values]
  );
}

/**
 * Get cached tidal status from database
 * @param {string} stationId - Station ID
 * @returns {Promise<Partial<TidalStatusResponse>>} Cached tidal data
 */
async function getCachedTidalStatus(stationId) {
  const [rows] = await pool.query(
    `SELECT ts AS timestamp, level_maod AS levelMAOD
     FROM tidal_reading
     WHERE station_id = ?
     ORDER BY ts DESC
     LIMIT 12`,
    [stationId]
  );

  if (rows.length < 2) {
    return { stationId, series: [] };
  }

  const metrics = computeTidalMetrics(rows[0].levelMAOD, rows[1].levelMAOD);

  return {
    stationId,
    timestamp: rows[0].timestamp,
    currentLevelMAOD: rows[0].levelMAOD,
    previousLevelMAOD: rows[1].levelMAOD,
    upstreamLeaBridgeStageM: null,
    ...metrics,
    series: rows
  };
}

/**
 * Cache rainfall readings to database
 * @param {RainfallReading[]} readings - Readings to cache
 * @returns {Promise<void>}
 */
async function cacheRainfallReadings(readings) {
  const values = readings.map((r) => [
    r.gaugeId,
    toMysqlDateTime(r.timestamp),
    r.mm
  ]);

  await pool.query(
    'INSERT IGNORE INTO rain_reading (gauge_id, ts, mm) VALUES ?',
    [values]
  );
}

/**
 * Get cached rainfall readings from database
 * @param {string} gaugeId - Gauge station ID
 * @param {number} limit - Max readings to return
 * @returns {Promise<RainfallReading[]>} Cached readings
 */
async function getCachedRainfallReadings(gaugeId, limit) {
  const [rows] = await pool.query(
    `SELECT gauge_id AS gaugeId, ts AS timestamp, mm
     FROM rain_reading
     WHERE gauge_id = ?
     ORDER BY ts DESC
     LIMIT ?`,
    [gaugeId, Number(limit)]
  );
  return rows;
}