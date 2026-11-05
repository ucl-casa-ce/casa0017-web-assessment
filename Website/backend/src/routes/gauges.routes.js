import { Router } from 'express';
import {
  listGauges,
  discoverGauges,
  getGaugeReadings,
  getNearestGauge,
  get24hRainfall
} from '../controllers/gauges.controller.js';

const router = Router();

// GET /api/gauges - List all stored rain gauges
router.get('/', listGauges);

// GET /api/gauges/discover - Discover gauges from EA API
router.get('/discover', discoverGauges);

// GET /api/gauges/nearest - Find nearest gauge to location
router.get('/nearest', getNearestGauge);

// GET /api/gauges/:gaugeId/readings - Get readings for a gauge
router.get('/:gaugeId/readings', getGaugeReadings);

// GET /api/gauges/:gaugeId/rain24h - Get 24h rainfall
router.get('/:gaugeId/rain24h', get24hRainfall);

export default router;
