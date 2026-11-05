/**
 * UKHO EasyTide Forecast Service
 *
 * Fetches tide predictions from the UK Hydrographic Office EasyTide API.
 * Provides 7-day forecasts for Thames tidal stations.
 *
 * @module services/tideForecast
 * @see https://easytide.admiralty.co.uk
 */

import axios from 'axios';

/** @typedef {import('../types').TideForecastResponse} TideForecastResponse */
/** @typedef {import('../types').TidalEvent} TidalEvent */
/** @typedef {import('../types').TideStation} TideStation */

const EASYTIDE_BASE_URL = 'https://easytide.admiralty.co.uk';

const client = axios.create({
  baseURL: EASYTIDE_BASE_URL,
  timeout: 10000
});

/**
 * Thames tidal stations available from EasyTide
 */
export const THAMES_STATIONS = Object.freeze({
  NORTH_WOOLWICH: '0112',
  LONDON_BRIDGE: '0113',
  CHELSEA_BRIDGE: '0113A',
  ALBERT_BRIDGE: '0114',
  HAMMERSMITH_BRIDGE: '0115',
  KEW_BRIDGE: '0115A',
  RICHMOND_LOCK: '0116'
});

/**
 * Default station for tide forecasts (North Woolwich - near Silvertown/Thames Barrier)
 */
const DEFAULT_STATION = THAMES_STATIONS.NORTH_WOOLWICH;

/**
 * Fetch all available tide stations from EasyTide
 *
 * @returns {Promise<TideStation[]>} Array of tide stations
 */
export async function fetchTideStations() {
  try {
    const { data } = await client.get('/Home/GetStations');

    // Response is GeoJSON FeatureCollection
    const features = data?.features || [];

    return features.map((feature) => ({
      stationId: feature.properties?.Id || feature.id,
      name: feature.properties?.Name || 'Unknown',
      country: feature.properties?.Country || 'Unknown',
      lat: feature.geometry?.coordinates?.[1] || null,
      lng: feature.geometry?.coordinates?.[0] || null
    }));
  } catch (error) {
    console.error('[TideForecast] Failed to fetch stations:', error.message);
    return [];
  }
}

/**
 * Fetch tide predictions for a specific station
 *
 * @param {string} [stationId] - EasyTide station ID (defaults to North Woolwich)
 * @returns {Promise<TideForecastResponse>} Tide forecast data
 */
export async function fetchTideForecast(stationId = DEFAULT_STATION) {
  try {
    const { data } = await client.get('/Home/GetPredictionData', {
      params: { stationId }
    });

    // Parse tidal events (high/low tides)
    const tidalEvents = (data?.tidalEventList || []).map((event) => ({
      type: event.eventType === 0 ? 'HIGH' : 'LOW',
      dateTime: event.dateTime,
      height: event.height,
      isApproximateTime: event.isApproximateTime || false,
      isApproximateHeight: event.isApproximateHeight || false
    }));

    // Parse height occurrences (30-min interval heights)
    const heightSeries = (data?.tidalHeightOccurrenceList || []).map((h) => ({
      dateTime: h.dateTime,
      height: h.height
    }));

    // Parse lunar phases
    const lunarPhases = (data?.lunarPhaseList || []).map((phase) => ({
      type: phase.lunarPhaseType,
      dateTime: phase.dateTime
    }));

    return {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      stationId,
      tidalEvents,
      heightSeries,
      lunarPhases,
      disclaimer: data?.footerNote || null
    };
  } catch (error) {
    console.error('[TideForecast] Failed to fetch forecast:', error.message);
    return {
      source: 'error',
      fetchedAt: new Date().toISOString(),
      stationId,
      error: error.message,
      tidalEvents: [],
      heightSeries: [],
      lunarPhases: []
    };
  }
}

/**
 * Get the next high and low tide times
 *
 * @param {string} [stationId] - EasyTide station ID
 * @returns {Promise<{ nextHigh: TidalEvent | null, nextLow: TidalEvent | null }>}
 */
export async function getNextTides(stationId = DEFAULT_STATION) {
  const forecast = await fetchTideForecast(stationId);

  if (forecast.source === 'error' || forecast.tidalEvents.length === 0) {
    return { nextHigh: null, nextLow: null };
  }

  const now = new Date();
  const futureEvents = forecast.tidalEvents.filter(
    (e) => new Date(e.dateTime) > now
  );

  const nextHigh = futureEvents.find((e) => e.type === 'HIGH') || null;
  const nextLow = futureEvents.find((e) => e.type === 'LOW') || null;

  return { nextHigh, nextLow };
}

/**
 * Determine tidal phase at a specific time based on forecast
 *
 * @param {Date} time - Time to check
 * @param {string} [stationId] - EasyTide station ID
 * @returns {Promise<'FLOOD' | 'EBB' | 'UNKNOWN'>} Tidal phase
 */
export async function getTidalPhaseAt(time, stationId = DEFAULT_STATION) {
  const forecast = await fetchTideForecast(stationId);

  if (forecast.source === 'error' || forecast.tidalEvents.length < 2) {
    return 'UNKNOWN';
  }

  const targetTime = new Date(time).getTime();

  // Find the two events surrounding this time
  const events = forecast.tidalEvents
    .map((e) => ({ ...e, timestamp: new Date(e.dateTime).getTime() }))
    .sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];

    if (targetTime >= current.timestamp && targetTime < next.timestamp) {
      // Between current and next event
      // If current is LOW and next is HIGH, tide is flooding
      // If current is HIGH and next is LOW, tide is ebbing
      return current.type === 'LOW' ? 'FLOOD' : 'EBB';
    }
  }

  return 'UNKNOWN';
}
