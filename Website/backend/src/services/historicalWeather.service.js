/**
 * Historical Weather Service
 *
 * Fetches historical precipitation data from Open-Meteo Archive API
 * for enriching spill events with 24h rainfall totals.
 *
 * @module services/historicalWeather
 * @see https://open-meteo.com/en/docs/historical-weather-api
 */

import axios from 'axios';

/** @typedef {import('../types').HistoricalRainfallResult} HistoricalRainfallResult */

const client = axios.create({
  baseURL: 'https://archive-api.open-meteo.com/v1',
  timeout: 30000
});

/**
 * Format date as YYYY-MM-DD for Open-Meteo API
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Fetch historical hourly precipitation for a location and date range
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array<{ time: string, precipitation: number }>>}
 */
export async function fetchHistoricalPrecipitation(lat, lng, startDate, endDate) {
  const { data } = await client.get('/archive', {
    params: {
      latitude: lat,
      longitude: lng,
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      hourly: 'precipitation',
      timezone: 'UTC'
    }
  });

  if (!data.hourly || !data.hourly.time || !data.hourly.precipitation) {
    return [];
  }

  return data.hourly.time.map((time, i) => ({
    time,
    precipitation: data.hourly.precipitation[i] || 0
  }));
}

/**
 * Calculate rainfall total for a specified number of hours before a timestamp
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Date} beforeTime - Calculate rainfall before this time
 * @param {number} [hours=24] - Number of hours to look back
 * @returns {Promise<HistoricalRainfallResult>}
 */
export async function calculateHistoricalRainfall(lat, lng, beforeTime, hours = 24) {
  const endTime = new Date(beforeTime);
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

  // Open-Meteo needs date range that covers our window
  // Add buffer day to ensure we get all needed hours
  const startDate = new Date(startTime);
  startDate.setDate(startDate.getDate() - 1);

  const readings = await fetchHistoricalPrecipitation(lat, lng, startDate, endTime);

  // Filter to specified window before the target time
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();

  let total = 0;
  let count = 0;

  for (const reading of readings) {
    const readingTime = new Date(reading.time).getTime();
    if (readingTime >= startMs && readingTime < endMs) {
      total += reading.precipitation;
      count++;
    }
  }

  return {
    totalMm: Math.round(total * 100) / 100,
    hoursOfData: count,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString()
  };
}

/**
 * Calculate 24-hour rainfall total before a specific timestamp
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Date} beforeTime - Calculate rainfall in 24h before this time
 * @returns {Promise<HistoricalRainfallResult>}
 */
export async function calculate24hHistoricalRainfall(lat, lng, beforeTime) {
  return calculateHistoricalRainfall(lat, lng, beforeTime, 24);
}

/**
 * Calculate multi-period rainfall totals (24h, 48h, 72h) in a single API call
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {Date} beforeTime - Calculate rainfall before this time
 * @returns {Promise<{ rain24h: number, rain48h: number, rain72h: number, hoursOfData: number }>}
 */
export async function calculateMultiPeriodRainfall(lat, lng, beforeTime) {
  const endTime = new Date(beforeTime);
  const startTime72h = new Date(endTime.getTime() - 72 * 60 * 60 * 1000);

  // Fetch 72h of data (covers all periods)
  const startDate = new Date(startTime72h);
  startDate.setDate(startDate.getDate() - 1);

  const readings = await fetchHistoricalPrecipitation(lat, lng, startDate, endTime);

  const endMs = endTime.getTime();
  const start24hMs = endMs - 24 * 60 * 60 * 1000;
  const start48hMs = endMs - 48 * 60 * 60 * 1000;
  const start72hMs = endMs - 72 * 60 * 60 * 1000;

  let rain24h = 0;
  let rain48h = 0;
  let rain72h = 0;
  let count = 0;

  for (const reading of readings) {
    const readingTime = new Date(reading.time).getTime();
    if (readingTime >= start72hMs && readingTime < endMs) {
      rain72h += reading.precipitation;
      count++;
      if (readingTime >= start48hMs) {
        rain48h += reading.precipitation;
      }
      if (readingTime >= start24hMs) {
        rain24h += reading.precipitation;
      }
    }
  }

  return {
    rain24h: Math.round(rain24h * 100) / 100,
    rain48h: Math.round(rain48h * 100) / 100,
    rain72h: Math.round(rain72h * 100) / 100,
    hoursOfData: count
  };
}

/**
 * Batch fetch 24h rainfall for multiple events
 * Groups by date and location to minimize API calls
 *
 * @param {Array<{ lat: number, lng: number, time: Date }>} events
 * @returns {Promise<Map<string, number>>} Map of ISO timestamp to rainfall mm
 */
export async function batchCalculate24hRainfall(events) {
  const results = new Map();

  // Group events by approximate location (round to 2 decimal places)
  const byLocation = new Map();

  for (const event of events) {
    const locKey = `${event.lat.toFixed(2)},${event.lng.toFixed(2)}`;
    if (!byLocation.has(locKey)) {
      byLocation.set(locKey, {
        lat: event.lat,
        lng: event.lng,
        events: []
      });
    }
    byLocation.get(locKey).events.push(event);
  }

  // Process each location
  for (const [locKey, locData] of byLocation) {
    // Find date range needed for this location
    const times = locData.events.map(e => new Date(e.time).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // Fetch data for entire range (with 24h buffer at start)
    const startDate = new Date(minTime - 25 * 60 * 60 * 1000);
    const endDate = new Date(maxTime);

    try {
      const readings = await fetchHistoricalPrecipitation(
        locData.lat,
        locData.lng,
        startDate,
        endDate
      );

      // Calculate 24h total for each event
      for (const event of locData.events) {
        const eventTime = new Date(event.time).getTime();
        const windowStart = eventTime - 24 * 60 * 60 * 1000;

        let total = 0;
        for (const reading of readings) {
          const readingTime = new Date(reading.time).getTime();
          if (readingTime >= windowStart && readingTime < eventTime) {
            total += reading.precipitation;
          }
        }

        results.set(event.time.toISOString(), Math.round(total * 100) / 100);
      }
    } catch (err) {
      console.error(`[HistoricalWeather] Error for ${locKey}:`, err.message);
    }
  }

  return results;
}
