/**
 * Tide State Service
 *
 * Provides current tide state and simulated tidal trapping analysis.
 *
 * @module services/tideState
 */

import { fetchTidalStatus } from './eaFlood.service.js';

/** @typedef {import('../types').TidalStatusResponse} TidalStatusResponse */
/** @typedef {import('../types').SimulatedTideResponse} SimulatedTideResponse */

/**
 * Get current tide state from EA monitoring
 *
 * @returns {Promise<TidalStatusResponse>} Current tidal status
 */
export async function getCurrentTideState() {
  return fetchTidalStatus();
}

/**
 * Simulate tidal trapping at a given time offset
 *
 * Calculates estimated pollutant residence time based on tidal phase
 * at the specified time offset from current readings.
 *
 * @param {number} [offsetMinutes=0] - Minutes offset into historical readings
 * @returns {Promise<SimulatedTideResponse>} Simulated tide state with residence time
 */
export async function simulateTidalTrapping(offsetMinutes = 0) {
  const tide = await fetchTidalStatus();
  const series = tide.series || [];

  if (series.length < 2) {
    return { ...tide, simulatedResidenceHours: null };
  }

  const index = Math.min(
    Math.max(Math.floor(Math.abs(Number(offsetMinutes)) / 15), 0),
    series.length - 2
  );

  const selected = series[index];
  const prior = series[index + 1];
  const delta = Number((selected.levelMAOD - prior.levelMAOD).toFixed(3));
  const isFlood = delta > 0;

  const simulatedResidenceHours = isFlood
    ? Number((6.5 + Math.max(selected.levelMAOD, 0) * 0.8).toFixed(1))
    : Number((2.0 + Math.max(selected.levelMAOD, 0) * 0.3).toFixed(1));

  return {
    stationId: tide.stationId,
    selectedTimestamp: selected.timestamp,
    levelMAOD: selected.levelMAOD,
    delta15Min: delta,
    tidalPhase: isFlood ? 'FLOOD' : 'EBB',
    dispersionState: isFlood ? 'TIDALLY_TRAPPED' : 'FLUSHED',
    simulatedResidenceHours,
    series
  };
}