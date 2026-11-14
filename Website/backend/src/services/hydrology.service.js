/**
 * EA Hydrology Service
 *
 * Discovers and fetches data from Environment Agency flow and groundwater stations
 * for analyzing river discharge rates and groundwater levels during spill events.
 *
 * @module services/hydrology
 * @see https://environment.data.gov.uk/flood-monitoring/doc/reference
 */

import axios from 'axios';
import config from '../config/env.js';
import { pool } from '../db/db.js';

const client = axios.create({
  baseURL: config.apis.eaFloodBaseUrl,
  timeout: config.apis.timeoutMs
});

const LONDON_CENTER = {
  lat: 51.509865,
  lng: -0.118092,
  distanceKm: 40 // Larger radius for hydrology stations (fewer than rain gauges)
};

/**
 * Haversine formula to calculate distance between two coordinates
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
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

// ============================================================================
// FLOW STATIONS
// ============================================================================

/**
 * Discover river flow monitoring stations within a radius
 *
 * @param {Object} [options] - Search options
 * @param {number} [options.lat] - Center latitude
 * @param {number} [options.lng] - Center longitude
 * @param {number} [options.distanceKm] - Search radius in km
 * @returns {Promise<Array>} Array of flow stations
 */
export async function discoverFlowStations(options = {}) {
  const lat = options.lat || LONDON_CENTER.lat;
  const lng = options.lng || LONDON_CENTER.lng;
  const dist = options.distanceKm || LONDON_CENTER.distanceKm;

  try {
    const { data } = await client.get('/id/stations', {
      params: {
        parameter: 'flow',
        lat,
        long: lng,
        dist
      }
    });

    const items = data?.items || [];

    return items.map((station) => {
      // Extract status from URL like ".../statusActive" -> "Active"
      let status = station.status?.label || station.status || null;
      if (typeof status === 'string' && status.includes('/')) {
        status = status.split('/').pop().replace('status', '');
      }
      return {
        stationId: station.stationReference || station['@id']?.split('/').pop(),
        label: station.label || 'Flow station',
        riverName: station.riverName || null,
        catchmentName: station.catchmentName || null,
        lat: station.lat,
        lng: station.long,
        easting: station.easting,
        northing: station.northing,
        dateOpened: station.dateOpened || null,
        status
      };
    });
  } catch (error) {
    console.error('[Hydrology] Failed to discover flow stations:', error.message);
    return [];
  }
}

/**
 * Store flow stations in database
 */
export async function storeFlowStations(stations) {
  if (stations.length === 0) return 0;

  const values = stations.map((s) => [
    s.stationId,
    s.label,
    s.riverName,
    s.catchmentName,
    s.lat,
    s.lng,
    s.easting || null,
    s.northing || null,
    s.dateOpened || null,
    s.status
  ]);

  const sql = `
    INSERT INTO flow_station (station_id, label, river_name, catchment_name, lat, lng, easting, northing, date_opened, status)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      river_name = VALUES(river_name),
      catchment_name = VALUES(catchment_name),
      lat = VALUES(lat),
      lng = VALUES(lng),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [values]);
  return values.length;
}

/**
 * Fetch flow readings for a station
 *
 * @param {string} stationId - Station reference
 * @param {Object} [options] - Fetch options
 * @param {Date} [options.since] - Fetch readings since this date
 * @param {number} [options.limit] - Max readings
 * @returns {Promise<Array>} Flow readings
 */
export async function fetchFlowReadings(stationId, options = {}) {
  try {
    const params = {
      _sorted: '',
      _limit: options.limit || 500
    };

    if (options.since) {
      params.since = options.since.toISOString();
    }

    const { data } = await client.get(`/id/stations/${stationId}/readings`, { params });

    const items = data?.items || [];

    return items
      .filter(r => r.value != null)
      .map((reading) => ({
        stationId,
        timestamp: reading.dateTime,
        flowCumecs: Number(reading.value)
      }));
  } catch (error) {
    console.error(`[Hydrology] Failed to fetch flow readings for ${stationId}:`, error.message);
    return [];
  }
}

/**
 * Store flow readings in database
 */
export async function storeFlowReadings(readings) {
  if (readings.length === 0) return 0;

  const values = readings.map((r) => [
    r.stationId,
    new Date(r.timestamp),
    r.flowCumecs
  ]);

  const sql = `
    INSERT IGNORE INTO flow_reading (station_id, ts, flow_cumecs)
    VALUES ?
  `;

  const [result] = await pool.query(sql, [values]);
  return result.affectedRows;
}

// ============================================================================
// GROUNDWATER STATIONS
// ============================================================================

/**
 * Discover groundwater monitoring stations within a radius
 */
export async function discoverGroundwaterStations(options = {}) {
  const lat = options.lat || LONDON_CENTER.lat;
  const lng = options.lng || LONDON_CENTER.lng;
  const dist = options.distanceKm || LONDON_CENTER.distanceKm;

  try {
    // Groundwater stations have qualifier=Groundwater
    const { data } = await client.get('/id/stations', {
      params: {
        qualifier: 'Groundwater',
        lat,
        long: lng,
        dist
      }
    });

    const items = data?.items || [];

    return items.map((station) => {
      let status = station.status?.label || station.status || null;
      if (typeof status === 'string' && status.includes('/')) {
        status = status.split('/').pop().replace('status', '');
      }
      return {
        stationId: station.stationReference || station['@id']?.split('/').pop(),
        label: station.label || 'Groundwater station',
        catchmentName: station.catchmentName || null,
        lat: station.lat,
        lng: station.long,
        easting: station.easting,
        northing: station.northing,
        dateOpened: station.dateOpened || null,
        status
      };
    });
  } catch (error) {
    console.error('[Hydrology] Failed to discover groundwater stations:', error.message);
    return [];
  }
}

/**
 * Store groundwater stations in database
 */
export async function storeGroundwaterStations(stations) {
  if (stations.length === 0) return 0;

  const values = stations.map((s) => [
    s.stationId,
    s.label,
    s.catchmentName,
    s.lat,
    s.lng,
    s.easting || null,
    s.northing || null,
    s.dateOpened || null,
    s.status
  ]);

  const sql = `
    INSERT INTO groundwater_station (station_id, label, catchment_name, lat, lng, easting, northing, date_opened, status)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      catchment_name = VALUES(catchment_name),
      lat = VALUES(lat),
      lng = VALUES(lng),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [values]);
  return values.length;
}

/**
 * Fetch groundwater readings for a station
 */
export async function fetchGroundwaterReadings(stationId, options = {}) {
  try {
    const params = {
      _sorted: '',
      _limit: options.limit || 500
    };

    if (options.since) {
      params.since = options.since.toISOString();
    }

    const { data } = await client.get(`/id/stations/${stationId}/readings`, { params });

    const items = data?.items || [];

    return items
      .filter(r => r.value != null)
      .map((reading) => ({
        stationId,
        timestamp: reading.dateTime,
        levelMaod: Number(reading.value)
      }));
  } catch (error) {
    console.error(`[Hydrology] Failed to fetch groundwater readings for ${stationId}:`, error.message);
    return [];
  }
}

/**
 * Store groundwater readings in database
 */
export async function storeGroundwaterReadings(readings) {
  if (readings.length === 0) return 0;

  const values = readings.map((r) => [
    r.stationId,
    new Date(r.timestamp),
    r.levelMaod
  ]);

  const sql = `
    INSERT IGNORE INTO groundwater_reading (station_id, ts, level_maod)
    VALUES ?
  `;

  const [result] = await pool.query(sql, [values]);
  return result.affectedRows;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get stored flow stations from database
 */
export async function getStoredFlowStations() {
  const [rows] = await pool.query(`
    SELECT
      station_id AS stationId,
      label,
      river_name AS riverName,
      catchment_name AS catchmentName,
      lat,
      lng
    FROM flow_station
    ORDER BY river_name, label
  `);
  return rows;
}

/**
 * Get stored groundwater stations from database
 */
export async function getStoredGroundwaterStations() {
  const [rows] = await pool.query(`
    SELECT
      station_id AS stationId,
      label,
      catchment_name AS catchmentName,
      lat,
      lng
    FROM groundwater_station
    ORDER BY label
  `);
  return rows;
}

/**
 * Find nearest flow station to a location
 */
export async function findNearestFlowStation(lat, lng, stations = null) {
  const allStations = stations || (await getStoredFlowStations());
  if (allStations.length === 0) return null;

  let nearest = null;
  let minDistance = Infinity;

  for (const station of allStations) {
    if (station.lat == null || station.lng == null) continue;
    const distance = haversineDistance(lat, lng, station.lat, station.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = station;
    }
  }

  return nearest ? { station: nearest, distanceKm: Math.round(minDistance * 100) / 100 } : null;
}

/**
 * Find nearest groundwater station to a location
 */
export async function findNearestGroundwaterStation(lat, lng, stations = null) {
  const allStations = stations || (await getStoredGroundwaterStations());
  if (allStations.length === 0) return null;

  let nearest = null;
  let minDistance = Infinity;

  for (const station of allStations) {
    if (station.lat == null || station.lng == null) continue;
    const distance = haversineDistance(lat, lng, station.lat, station.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = station;
    }
  }

  return nearest ? { station: nearest, distanceKm: Math.round(minDistance * 100) / 100 } : null;
}
