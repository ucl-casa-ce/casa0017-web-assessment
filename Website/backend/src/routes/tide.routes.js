import { Router } from 'express';
import { getTideStatus } from '../controllers/tide.controller.js';

const router = Router();

router.get('/', getTideStatus);

export default router;