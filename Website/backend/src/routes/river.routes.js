import { Router } from 'express';
import { getInputs, getStatus, listSightings, createSighting, hideSighting, subscribe, health } from '../controllers/river.controller.js';
import { verifyWebhook, receiveWebhook } from '../controllers/whatsapp.controller.js';
import { strictLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/inputs', getInputs);
router.get('/status', strictLimiter, getStatus);
router.get('/sightings', listSightings);
router.post('/sightings', strictLimiter, createSighting);
router.delete('/sightings/:id', hideSighting);
router.post('/subscribe', strictLimiter, subscribe);
router.get('/health', health);
router.get('/whatsapp/webhook', verifyWebhook);
router.post('/whatsapp/webhook', receiveWebhook);

export default router;
