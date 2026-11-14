/**
 * Rain Gauge Controller
 *
 * Handles HTTP requests for EA rain gauge data.
 *
 * @module controllers/gauges
 */

import {
  discoverRainGauges,
  getStoredGauges,
  fetchGaugeReadings,
  findNearestGauge,
  calculate24hRainfall
} from '../services/rainGauge.service.js';

/**
 * List all stored rain gauges
 */
export async function listGauges(req, res, next) {
  try {
    const gauges = await getStoredGauges();
    res.json({
      success: true,
      count: gauges.length,
      data: gauges
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Discover rain gauges from EA API (does not store)
 */
export async function discoverGauges(req, res, next) {
  try {
    const { lat, lng, distance } = req.query;
    const gauges = await discoverRainGauges({
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      distanceKm: distance ? parseFloat(distance) : undefined
    });

    res.json({
      success: true,
      count: gauges.length,
      data: gauges
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get readings for a specific gauge
 */
export async function getGaugeReadings(req, res, next) {
  try {
    const { gaugeId } = req.params;
    const { limit } = req.query;

    const readings = await fetchGaugeReadings(
      gaugeId,
      limit ? parseInt(limit, 10) : 96
    );

    const total24h = readings.slice(0, 96).reduce((sum, r) => sum + r.mm, 0);

    res.json({
      success: true,
      gaugeId,
      total24hMm: Math.round(total24h * 100) / 100,
      count: readings.length,
      data: readings
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Find nearest gauge to a location
 */
export async function getNearestGauge(req, res, next) {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'lat and lng query parameters are required'
      });
    }

    const result = await findNearestGauge(parseFloat(lat), parseFloat(lng));

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No gauges found in database. Run discover-gauges script first.'
      });
    }

    res.json({
      success: true,
      data: {
        gauge: result.gauge,
        distanceKm: result.distanceKm
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Calculate 24h rainfall at a gauge before a given time
 */
export async function get24hRainfall(req, res, next) {
  try {
    const { gaugeId } = req.params;
    const { before } = req.query;

    const beforeTime = before ? new Date(before) : new Date();
    const rainfall = await calculate24hRainfall(gaugeId, beforeTime);

    res.json({
      success: true,
      gaugeId,
      beforeTime: beforeTime.toISOString(),
      rain24hMm: Math.round(rainfall * 100) / 100
    });
  } catch (error) {
    next(error);
  }
}
