import { getSpillEvents } from '../services/events.service.js';

export async function listEvents(req, res, next) {
  try {
    const { outfall, limit } = req.query;
    const data = await getSpillEvents({ permitNumber: outfall, limit: limit || 500 });
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
}