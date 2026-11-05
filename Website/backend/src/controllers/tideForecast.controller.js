/**
 * Tide Forecast Controller
 *
 * Handles HTTP requests for UKHO EasyTide tide predictions.
 *
 * @module controllers/tideForecast
 */

import {
  fetchTideForecast,
  fetchTideStations,
  getNextTides,
  THAMES_STATIONS
} from '../services/tideForecast.service.js';

/**
 * Get tide forecast for default station (North Woolwich)
 */
export async function getTideForecast(req, res, next) {
  try {
    const { stationId } = req.query;
    const data = await fetchTideForecast(stationId || THAMES_STATIONS.NORTH_WOOLWICH);

    if (data.source === 'error') {
      return res.status(500).json({ success: false, error: data.error });
    }

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * Get tide forecast for a specific station
 */
export async function getTideForecastByStation(req, res, next) {
  try {
    const { stationId } = req.params;
    const data = await fetchTideForecast(stationId);

    if (data.source === 'error') {
      return res.status(500).json({ success: false, error: data.error });
    }

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * Get next high and low tide times
 */
export async function getNextTidesTimes(req, res, next) {
  try {
    const { stationId } = req.query;
    const data = await getNextTides(stationId || THAMES_STATIONS.NORTH_WOOLWICH);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/**
 * List all available tide stations
 */
export async function listTideStations(req, res, next) {
  try {
    const stations = await fetchTideStations();

    // Optionally filter to Thames stations only
    const { thamesOnly } = req.query;
    const filtered = thamesOnly === 'true'
      ? stations.filter((s) =>
          Object.values(THAMES_STATIONS).includes(s.stationId)
        )
      : stations;

    res.json({
      success: true,
      count: filtered.length,
      thamesStations: THAMES_STATIONS,
      data: filtered
    });
  } catch (error) {
    next(error);
  }
}
