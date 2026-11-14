import { Router } from 'express';
import { getOverallStatus } from '../controllers/status.controller.js';

const router = Router();

router.get('/', getOverallStatus);

export default router;