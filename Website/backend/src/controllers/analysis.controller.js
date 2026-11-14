/**
 * Analysis Controller
 */

import {
  getTidalStatsByRiver,
  getRainfallThresholds,
  getAntecedentAnalysis,
  getSummaryStats,
  getScatterData
} from '../services/analysis.service.js';

export async function getTidalStats(req, res, next) {
  try {
    const { rivers, minEvents } = req.query;
    const stats = await getTidalStatsByRiver({
      rivers: rivers ? rivers.split(',') : null,
      minEvents: minEvents ? parseInt(minEvents, 10) : 10
    });
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
}

export async function getThresholds(req, res, next) {
  try {
    const { river, maxThreshold, limit } = req.query;
    const thresholds = await getRainfallThresholds({
      river: river || null,
      maxThreshold: maxThreshold ? parseFloat(maxThreshold) : null,
      limit: limit ? parseInt(limit, 10) : 100
    });
    res.json({ data: thresholds });
  } catch (err) {
    next(err);
  }
}

export async function getAntecedent(req, res, next) {
  try {
    const { river } = req.query;
    const analysis = await getAntecedentAnalysis({ river: river || null });
    res.json({ data: analysis });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req, res, next) {
  try {
    const summary = await getSummaryStats();
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
}

export async function getScatter(req, res, next) {
  try {
    const { river, bbox, limit } = req.query;

    let box = null;
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = String(bbox).split(',').map(Number);
      const valid = [minLng, minLat, maxLng, maxLat].every(Number.isFinite)
        && minLng < maxLng && minLat < maxLat;
      if (!valid) {
        return res.status(400).json({
          success: false,
          error: 'bbox must be minLng,minLat,maxLng,maxLat'
        });
      }
      box = { minLng, minLat, maxLng, maxLat };
    }

    const data = await getScatterData({
      river: river || null,
      bbox: box,
      limit: limit ? parseInt(limit, 10) : 1000
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}
