import { getCurrentTideState, simulateTidalTrapping } from '../services/tideState.service.js';

export async function getTideStatus(req, res, next) {
  try {
    const { offsetMinutes } = req.query;
    const data =
      offsetMinutes !== undefined
        ? await simulateTidalTrapping(offsetMinutes)
        : await getCurrentTideState();

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}