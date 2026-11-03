import { getAllOutfalls, getOutfallByPermit } from '../services/outfalls.service.js';
import { fetchSpillHistory, fetchLondonSpillSummary } from '../services/thamesWater.service.js';

export async function listOutfalls(req, res, next) {
  try {
    const { river } = req.query;
    const data = await getAllOutfalls(river);
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
}

export async function getSingleOutfall(req, res, next) {
  try {
    const data = await getOutfallByPermit(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Outfall not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getOutfallSpillHistory(req, res, next) {
  try {
    const data = await fetchSpillHistory(req.params.id);
    if (data.source === 'error') {
      return res.status(500).json({ success: false, error: data.error });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getLondonSpillSummary(req, res, next) {
  try {
    const data = await fetchLondonSpillSummary();
    if (data.source === 'error') {
      return res.status(500).json({ success: false, error: data.error });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}