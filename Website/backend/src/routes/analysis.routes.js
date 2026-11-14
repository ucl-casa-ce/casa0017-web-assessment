/**
 * Analysis Routes
 */

import { Router } from 'express';
import {
  getTidalStats,
  getThresholds,
  getAntecedent,
  getSummary,
  getScatter
} from '../controllers/analysis.controller.js';

const router = Router();

router.get('/tidal', getTidalStats);
router.get('/thresholds', getThresholds);
router.get('/antecedent', getAntecedent);
router.get('/summary', getSummary);
router.get('/scatter', getScatter);

export default router;
