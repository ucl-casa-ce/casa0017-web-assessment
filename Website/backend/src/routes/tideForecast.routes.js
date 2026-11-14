import { Router } from 'express';
import {
  getTideForecast,
  getTideForecastByStation,
  getNextTidesTimes,
  listTideStations
} from '../controllers/tideForecast.controller.js';

const router = Router();

// GET /api/tide/forecast - Get tide forecast (default: North Woolwich)
router.get('/', getTideForecast);

// GET /api/tide/forecast/next - Get next high/low tide times
router.get('/next', getNextTidesTimes);

// GET /api/tide/forecast/stations - List all tide stations
router.get('/stations', listTideStations);

// GET /api/tide/forecast/:stationId - Get forecast for specific station
router.get('/:stationId', getTideForecastByStation);

export default router;
