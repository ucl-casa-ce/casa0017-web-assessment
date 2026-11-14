import { getOutfallThresholds } from '../services/threshold.service.js';

export async function listThresholds(req, res, next) {
  try {
    const { maxRain } = req.query;
    const data = await getOutfallThresholds(maxRain);
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
}