/**
 * Thames Water API Service
 *
 * Handles all interactions with the Thames Water Open Data API v2 for
 * sewage discharge monitoring in London rivers.
 *
 * @module services/thamesWater
 */

import axios from 'axios';
import config from '../config/env.js';
import { pool } from '../db/db.js';
import {
  osgbToLatLng,
  toMysqlDateTime,
  getTimePeriods,
  pairAlertsToEvents,
  calculateDischargeSummary
} from '../utils/index.js';

/** @typedef {import('../types').ThamesWaterQueryParams} ThamesWaterQueryParams */
/** @typedef {import('../types').Outfall} Outfall */
/** @typedef {import('../types').DischargeStatusResponse} DischargeStatusResponse */
/** @typedef {import('../types').DischargeAlert} DischargeAlert */
/** @typedef {import('../types').DischargeAlertsResponse} DischargeAlertsResponse */
/** @typedef {import('../types').SpillEvent} SpillEvent */
/** @typedef {import('../types').SpillHistoryResponse} SpillHistoryResponse */
/** @typedef {import('../types').LondonSpillSummaryResponse} LondonSpillSummaryResponse */

const client = axios.create({
  baseURL: config.apis.thamesWaterBaseUrl,
  timeout: config.apis.timeoutMs
});

const TARGET_RIVERS = ['lee', 'lea', 'bow creek', 'thames'];

// Whole words only, so "lee" does not match Fleet Brook or "lea" River Leach
const TARGET_RIVER_PATTERN = new RegExp(`\\b(${TARGET_RIVERS.join('|')})\\b`, 'i');

/**
 * Thames Water API v2 query parameters
 *
 * The v2 API uses direct parameter names, not the col_1/operand_1/value_1 format
 * used by the older v1 API.
 *
 * @see https://api.thameswater.co.uk/opendata/v2
 *
 * Supported parameters:
 * - limit: Max records per request (default 1000, max 1000)
 * - offset: Pagination offset
 * - permitNumber: Filter by permit number (exact match)
 * - locationName: Filter by location name
 */
const API_DEFAULTS = {
  limit: 1000,
  offset: 0
};

/**
 * Build query parameters for Thames Water API v2
 *
 * @param {ThamesWaterQueryParams} options - Query options
 * @returns {ThamesWaterQueryParams} Query parameters object
 */
function buildQueryParams(options = {}) {
  const params = {
    limit: Math.min(options.limit || API_DEFAULTS.limit, 1000),
    offset: options.offset || API_DEFAULTS.offset
  };

  // v2 API uses direct parameter names
  if (options.permitNumber) {
    params.permitNumber = options.permitNumber;
  }

  if (options.locationName) {
    params.locationName = options.locationName;
  }

  return params;
}

/**
 * Check if watercourse is a target London river
 * @param {string} watercourse - Watercourse name
 * @returns {boolean} True if watercourse is a London target river
 */
const isTargetRiver = (watercourse = '') => TARGET_RIVER_PATTERN.test(watercourse ?? '');

/**
 * Normalize raw API outfall item to standard Outfall format
 * @param {Object} item - Raw API response item
 * @returns {Outfall} Normalized outfall object
 */
const normalizeOutfall = (item) => {
  const easting = Number(item.x);
  const northing = Number(item.y);
  const { lat, lng } = osgbToLatLng(easting, northing);

  return {
    permitNumber: item.permitNumber,
    locationName: item.locationName,
    receivingWaterCourse: item.receivingWaterCourse,
    easting,
    northing,
    lat,
    lng,
    alertStatus: item.alertStatus,
    isDischarging:
      item.alertStatus === 'Discharging' ||
      item.alertStatus === '1' ||
      item.alertStatus === 1,
    alertPast48Hours: item.alertPast48Hours === true || item.alertPast48Hours === 'true',
    mostRecentStart: item.mostRecentDischargeAlertStart || null,
    mostRecentStop: item.mostRecentDischargeAlertStop || null
  };
};

/**
 * Fetch current discharge status from Thames Water API
 *
 * @param {ThamesWaterQueryParams & { filterLondon?: boolean }} [options] - Query options
 * @returns {Promise<DischargeStatusResponse>} Discharge status response
 */
export async function fetchDischargeStatus(options = {}) {
  // Handle null/undefined options
  if (options === null || options === undefined) {
    options = {};
  }

  const filterLondon = options.filterLondon !== false;

  try {
    const params = buildQueryParams(options);
    const { data } = await client.get('/discharge/status', { params });
    const rawList = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

    const outfalls = rawList
      .filter((item) => !filterLondon || isTargetRiver(item.receivingWaterCourse))
      .map(normalizeOutfall);

    // options.cache === false: read-only (used by the river live map, which asks for every watercourse
    // and must not add non-London outfalls to the outfalls table)
    if (outfalls.length > 0 && options.cache !== false) {
      await cacheOutfallStatus(outfalls);
    }

    try {
      await syncHistoryOutfallStatus(rawList);
    } catch (err) {
      console.error('[ThamesWater] Could not update history outfall status:', err.message);
    }

    return {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      count: outfalls.length,
      totalFromApi: rawList.length,
      params,
      items: outfalls
    };
  } catch (error) {
    const cached = await getCachedOutfallStatus();
    return {
      source: 'cache_fallback',
      fetchedAt: new Date().toISOString(),
      error: error.message,
      count: cached.length,
      items: cached
    };
  }
}

/**
 * Fetch discharge alerts from Thames Water API
 *
 * @param {ThamesWaterQueryParams & { filterLondon?: boolean } | string | null} [options] - Query options or permit number string
 * @returns {Promise<DischargeAlertsResponse>} Discharge alerts response
 */
export async function fetchDischargeAlerts(options = {}) {
  // Support legacy call signature: fetchDischargeAlerts(permitNumber) or fetchDischargeAlerts(null)
  if (options === null || options === undefined) {
    options = {};
  } else if (typeof options === 'string') {
    options = { permitNumber: options };
  }

  const filterLondon = options.filterLondon !== false;

  try {
    const params = buildQueryParams(options);
    const { data } = await client.get('/discharge/alerts', { params });
    const rawList = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

    const alerts = rawList
      .filter((item) => !filterLondon || isTargetRiver(item.receivingWaterCourse))
      .map((item) => ({
        permitNumber: item.permitNumber,
        locationName: item.locationName,
        receivingWaterCourse: item.receivingWaterCourse,
        alertType: item.alertType,
        eventTime: item.datetime,
        easting: Number(item.x),
        northing: Number(item.y)
      }));

    return {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      count: alerts.length,
      totalFromApi: rawList.length,
      params,
      items: alerts
    };
  } catch (error) {
    const cached = await getCachedAlerts(options.permitNumber);
    return {
      source: 'cache_fallback',
      fetchedAt: new Date().toISOString(),
      error: error.message,
      count: cached.length,
      items: cached
    };
  }
}

/**
 * Cache outfall status to database
 * @param {Outfall[]} outfalls - Outfalls to cache
 * @returns {Promise<void>}
 */
async function cacheOutfallStatus(outfalls) {
  const values = outfalls.map((o) => [
    o.permitNumber,
    o.locationName,
    o.receivingWaterCourse,
    o.easting,
    o.northing,
    o.lat,
    o.lng,
    o.isDischarging ? 1 : 0,
    toMysqlDateTime(o.mostRecentStart),
    toMysqlDateTime(o.mostRecentStop)
  ]);

  const sql = `
    INSERT INTO outfalls (
      permit_number, location_name, receiving_watercourse,
      easting, northing, lat, lng, is_discharging,
      most_recent_start, most_recent_stop
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      lat = VALUES(lat),
      lng = VALUES(lng),
      is_discharging = VALUES(is_discharging),
      most_recent_start = VALUES(most_recent_start),
      most_recent_stop = VALUES(most_recent_stop),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.query(sql, [values]);
}

/**
 * Copy the live status to outfalls imported from EDM history. Those rows are
 * stored under Thames Water's uniqueId (e.g. TWL00002), not the permit number,
 * so cacheOutfallStatus never reaches them. Only rows that already exist are
 * touched, and only their status fields.
 * @param {Object[]} items - Raw items from the discharge status feed
 * @returns {Promise<void>}
 */
async function syncHistoryOutfallStatus(items) {
  const byUniqueId = new Map(
    items.filter((item) => item.uniqueId).map((item) => [item.uniqueId, normalizeOutfall(item)])
  );
  if (byUniqueId.size === 0) {
    return;
  }

  const [rows] = await pool.query(
    'SELECT permit_number, location_name, receiving_watercourse FROM outfalls WHERE permit_number IN (?)',
    [[...byUniqueId.keys()]]
  );
  if (rows.length === 0) {
    return;
  }

  const values = rows.map((row) => {
    const live = byUniqueId.get(row.permit_number);
    return [
      row.permit_number,
      row.location_name,
      row.receiving_watercourse,
      live.isDischarging ? 1 : 0,
      toMysqlDateTime(live.mostRecentStart),
      toMysqlDateTime(live.mostRecentStop)
    ];
  });

  await pool.query(
    `
    INSERT INTO outfalls (
      permit_number, location_name, receiving_watercourse,
      is_discharging, most_recent_start, most_recent_stop
    ) VALUES ?
    ON DUPLICATE KEY UPDATE
      is_discharging = VALUES(is_discharging),
      most_recent_start = VALUES(most_recent_start),
      most_recent_stop = VALUES(most_recent_stop),
      updated_at = CURRENT_TIMESTAMP
  `,
    [values]
  );
}

/**
 * Get cached outfall status from database
 * @returns {Promise<Outfall[]>} Cached outfalls
 */
async function getCachedOutfallStatus() {
  const [rows] = await pool.query(`
    SELECT
      permit_number AS permitNumber,
      location_name AS locationName,
      receiving_watercourse AS receivingWaterCourse,
      easting,
      northing,
      lat,
      lng,
      is_discharging AS isDischarging,
      most_recent_start AS mostRecentStart,
      most_recent_stop AS mostRecentStop,
      updated_at AS cachedAt
    FROM outfalls
    ORDER BY location_name ASC
  `);
  return rows;
}

/**
 * Get cached alerts from database
 * @param {string} [permitNumber] - Optional permit number filter
 * @returns {Promise<Array<{ permitNumber: string, startTime: string, stopTime: string | null }>>}
 */
async function getCachedAlerts(permitNumber) {
  const sql = permitNumber
    ? `SELECT outfall_id AS permitNumber, start_ts AS startTime, end_ts AS stopTime
       FROM spill_event WHERE outfall_id = ? ORDER BY start_ts DESC LIMIT 200`
    : `SELECT outfall_id AS permitNumber, start_ts AS startTime, end_ts AS stopTime
       FROM spill_event ORDER BY start_ts DESC LIMIT 200`;

  const [rows] = await pool.query(sql, permitNumber ? [permitNumber] : []);
  return rows;
}

/**
 * Fetch all historical alerts for an outfall with pagination
 *
 * Note: The v2 API doesn't support filtering alerts by permitNumber directly.
 * We fetch all alerts and filter client-side for the specific outfall.
 *
 * @param {string} permitNumber - Permit number to fetch alerts for
 * @param {{ limit?: number }} [options] - Additional query options
 * @returns {Promise<Object[]>} All raw alerts for the outfall
 */
async function fetchAllAlertsForOutfall(permitNumber, options = {}) {
  const allAlerts = [];
  const limit = options.limit || 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const params = buildQueryParams({ limit, offset });
    const { data } = await client.get('/discharge/alerts', { params });

    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
      hasMore = false;
    } else {
      // Filter to specific permit client-side
      const filtered = items.filter((item) => item.permitNumber === permitNumber);
      allAlerts.push(...filtered);
      offset += limit;

      // Stop if we got less than limit (no more pages)
      if (items.length < limit) {
        hasMore = false;
      }
    }
  }

  return allAlerts;
}

/**
 * Get spill history and duration statistics for an outfall
 *
 * @param {string} permitNumber - Permit number to fetch history for
 * @returns {Promise<SpillHistoryResponse>} Spill history with summary statistics
 */
export async function fetchSpillHistory(permitNumber) {
  try {
    const alerts = await fetchAllAlertsForOutfall(permitNumber);
    const events = pairAlertsToEvents(alerts);
    const periods = getTimePeriods();

    return {
      source: 'live',
      fetchedAt: periods.now.toISOString(),
      permitNumber,
      summary: {
        last48Hours: calculateDischargeSummary(events, periods.last48h),
        last7Days: calculateDischargeSummary(events, periods.last7d),
        last30Days: calculateDischargeSummary(events, periods.last30d),
        last6Months: calculateDischargeSummary(events, periods.last6m),
        last12Months: calculateDischargeSummary(events, periods.last12m),
        yearToDate: calculateDischargeSummary(events, periods.startOfYear),
        allTime: calculateDischargeSummary(events)
      },
      events: events.slice(0, 100) // Return last 100 events
    };
  } catch (error) {
    return {
      source: 'error',
      fetchedAt: new Date().toISOString(),
      permitNumber,
      error: error.message,
      summary: null,
      events: []
    };
  }
}

/**
 * Get aggregated spill statistics for all London outfalls
 *
 * @returns {Promise<LondonSpillSummaryResponse>} Summary of all London outfall spills
 */
export async function fetchLondonSpillSummary() {
  try {
    // First get current status to get list of London outfalls
    const status = await fetchDischargeStatus();
    const outfalls = status.items;

    const now = new Date();
    const last30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Fetch alerts for all outfalls (this will use the filtered London list)
    const { data } = await client.get('/discharge/alerts');
    const rawList = Array.isArray(data?.items) ? data.items : [];

    // Filter to London rivers
    const londonAlerts = rawList.filter((item) =>
      isTargetRiver(item.receivingWaterCourse)
    );

    const events = pairAlertsToEvents(londonAlerts);

    // Group events by outfall
    const byOutfall = {};
    for (const event of events) {
      if (!byOutfall[event.permitNumber]) {
        byOutfall[event.permitNumber] = [];
      }
      byOutfall[event.permitNumber].push(event);
    }

    // Calculate summary per outfall
    const outfallSummaries = outfalls.map((outfall) => {
      const outfallEvents = byOutfall[outfall.permitNumber] || [];
      const summary = calculateDischargeSummary(outfallEvents, last30d);

      return {
        permitNumber: outfall.permitNumber,
        locationName: outfall.locationName,
        receivingWaterCourse: outfall.receivingWaterCourse,
        lat: outfall.lat,
        lng: outfall.lng,
        isCurrentlyDischarging: outfall.isDischarging,
        alertPast48Hours: outfall.alertPast48Hours,
        last30Days: summary
      };
    });

    // Sort by total discharge time (worst offenders first)
    outfallSummaries.sort((a, b) => b.last30Days.totalMinutes - a.last30Days.totalMinutes);

    const totalDischargeMinutes = outfallSummaries.reduce(
      (sum, o) => sum + o.last30Days.totalMinutes, 0
    );

    return {
      source: 'live',
      fetchedAt: now.toISOString(),
      period: 'last30Days',
      totalOutfalls: outfalls.length,
      currentlyDischarging: outfalls.filter((o) => o.isDischarging).length,
      recentlyDischarged: outfalls.filter((o) => o.alertPast48Hours).length,
      totalDischargeMinutes,
      totalDischargeHours: Math.round((totalDischargeMinutes / 60) * 100) / 100,
      outfalls: outfallSummaries
    };
  } catch (error) {
    return {
      source: 'error',
      fetchedAt: new Date().toISOString(),
      error: error.message,
      outfalls: []
    };
  }
}