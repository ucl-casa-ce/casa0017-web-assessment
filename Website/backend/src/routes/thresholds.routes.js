import { Router } from 'express';
import { listThresholds } from '../controllers/thresholds.controller.js';

const router = Router();

router.get('/', listThresholds);

export default router;