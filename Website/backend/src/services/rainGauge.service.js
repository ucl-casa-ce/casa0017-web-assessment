/**
 * EA Rain Gauge Service
 *
 * Discovers and fetches data from Environment Agency rain gauge stations
 * in the London area for pairing with sewage outfalls.
 *
 * @module services/rainGauge
 * @see https://environment.data.gov.uk/flood-monitoring/doc/rainfall
 */

import axios from 'axios';
import config from '../config/env.js';
import { pool } from '../db/db.js';

/** @typedef {import('../types').RainGauge} RainGauge */
/** @typedef {import('../types').RainfallReading} RainfallReading */

const client = axios.create({
  baseURL: config.apis.eaFloodBaseUrl,
  timeout: config.apis.timeoutMs
});

/**
 * Default search parameters for London area gauges
 */
const LONDON_CENTER = {
  lat: 51.509865,
  lng: -0.118092,
  distanceKm: 25
};

/**
 * Discover all rain gauge stations within a radius of a point
 *
 * @param {Object} [options] - Search options
 * @param {number} [options.lat] - Center latitude (default: London)
 * @param {number} [options.lng] - Center longitude (default: London)
 * @param {number} [options.distanceKm] - Search radius in km (default: 25)
 * @returns {Promise<RainGauge[]>} Array of rain gauge stations
 */
export async function discoverRainGauges(options = {}) {
  const lat = options.lat || LONDON_CENTER.lat;
  const lng = options.lng || LONDON_CENTER.lng;
  const dist = options.distanceKm || LONDON_CENTER.distanceKm;

  try {
    const { data } = await client.get('/id/stations', {
      params: {
        parameter: 'rainfall',
        lat,
        long: lng,
        dist
      }
    });

    const items = data?.items || [];

    return items.map((station) => ({
      stationId: station.stationReference || station['@id']?.split('/').pop(),
      label: station.label || 'Rainfall station',
      lat: station.lat,
      lng: station.long,
      easting: station.easting,
      northing: station.northing,
      riverName: station.riverName || null,
      catchmentName: station.catchmentName || null,
      dateOpened: station.dateOpened || null
    }));
  } catch (error) {
    console.error('[RainGauge] Failed to discover gauges:', error.message);
    return [];
  }
}

/**
 * Fetch rainfall readings for a specific gauge
 *
 * @param {string} stationId - EA station reference
 * @param {number} [limit=96] - Max readings (96 = 24 hours at 15-min intervals)
 * @returns {Promise<RainfallReading[]>} Array of rainfall readings
 */
export async function fetchGaugeReadings(stationId, limit = 96) {
  try {
    const { data } = await client.get(`/id/stations/${stationId}/readings`, {
      params: {
        parameter: 'rainfall',
        _sorted: '',
        _limit: limit
      }
    });

    const items = data?.items || [];

    return items.map((reading) => ({
      gaugeId: stationId,
      timestamp: reading.dateTime,
      mm: Number(reading.value || 0)
    }));
  } catch (error) {
    console.error(`[RainGauge] Failed to fetch readings for ${stationId}:`, error.message);
    return [];
  }
}

/**
 * Calculate total rainfall over a time period
 *
 * @param {string} stationId - EA station reference
 * @param {Date} startTime - Period start
 * @param {Date} endTime - Period end
 * @returns {Promise<number>} Total rainfall in mm
 */
export async function calculateRainfallForPeriod(stationId, startTime, endTime) {
  // Calculate how many 15-min intervals we need
  const durationMs = endTime.getTime() - startTime.getTime();
  const intervals = Math.ceil(durationMs / (15 * 60 * 1000));
  const limit = Math.min(intervals + 10, 1000); // Add buffer

  const readings = await fetchGaugeReadings(stationId, limit);

  // Filter to readings within our time window
  const filtered = readings.filter((r) => {
    const ts = new Date(r.timestamp).getTime();
    return ts >= startTime.getTime() && ts <= endTime.getTime();
  });

  return filtered.reduce((sum, r) => sum + r.mm, 0);
}

/**
 * Calculate 24-hour rainfall before a given timestamp
 *
 * @param {string} stationId - EA station reference
 * @param {Date} beforeTime - End of 24h window
 * @returns {Promise<number>} Total 24h rainfall in mm
 */
export async function calculate24hRainfall(stationId, beforeTime) {
  const endTime = new Date(beforeTime);
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

  return calculateRainfallForPeriod(stationId, startTime, endTime);
}

/**
 * Store discovered gauges in database
 *
 * @param {RainGauge[]} gauges - Gauges to store
 * @returns {Promise<number>} Number of gauges stored
 */
export async function storeGauges(gauges) {
  if (gauges.length === 0) return 0;

  const values = gauges.map((g) => [
    g.stationId,
    g.label,
    g.lat,
    g.lng,
    g.easting || null,
    g.northing || null
  ]);

  const sql = `
    INSERT INTO rain_gauge (station_id, label, lat, lng, easting, northing)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      lat = VALUES(lat),
      lng = VALUES(lng),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [values]);
  return values.length;
}

/**
 * Get all stored rain gauges from database
 *
 * @returns {Promise<RainGauge[]>} Stored gauges
 */
export async function getStoredGauges() {
  const [rows] = await pool.query(`
    SELECT
      station_id AS stationId,
      label,
      lat,
      lng,
      easting,
      northing
    FROM rain_gauge
    ORDER BY station_id
  `);
  return rows;
}

/**
 * Haversine formula to calculate distance between two coordinates
 *
 * @param {number} lat1 - First latitude
 * @param {number} lng1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lng2 - Second longitude
 * @returns {number} Distance in kilometers
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the nearest rain gauge to a given location
 *
 * @param {number} lat - Target latitude
 * @param {number} lng - Target longitude
 * @param {RainGauge[]} [gauges] - Gauges to search (fetches from DB if not provided)
 * @returns {Promise<{ gauge: RainGauge, distanceKm: number } | null>}
 */
export async function findNearestGauge(lat, lng, gauges = null) {
  const allGauges = gauges || (await getStoredGauges());

  if (allGauges.length === 0) return null;

  let nearest = null;
  let minDistance = Infinity;

  for (const gauge of allGauges) {
    if (gauge.lat == null || gauge.lng == null) continue;

    const distance = haversineDistance(lat, lng, gauge.lat, gauge.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = gauge;
    }
  }

  if (!nearest) return null;

  return {
    gauge: nearest,
    distanceKm: Math.round(minDistance * 100) / 100
  };
}
