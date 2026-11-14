import { Router } from 'express';
import {
  listOutfalls,
  getSingleOutfall,
  getOutfallSpillHistory,
  getLondonSpillSummary,
  getOutfallsAsGeoJSON
} from '../controllers/outfalls.controller.js';

const router = Router();

router.get('/', listOutfalls);
router.get('/geojson', getOutfallsAsGeoJSON);
router.get('/summary', getLondonSpillSummary);
router.get('/:id', getSingleOutfall);
router.get('/:id/history', getOutfallSpillHistory);

export default router;