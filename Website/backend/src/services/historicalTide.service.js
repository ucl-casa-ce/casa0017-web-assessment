/**
 * Historical Tidal Phase Service
 *
 * Calculates tidal phase (FLOOD/EBB) for historical dates using
 * astronomical tide calculations based on lunar cycles.
 *
 * Thames tides are semi-diurnal (two high tides per day) with
 * a period of approximately 12 hours 25 minutes.
 *
 * @module services/historicalTide
 */

/**
 * Average tidal period in milliseconds (12h 25m 14s)
 * This is the M2 tidal constituent - the principal lunar semidiurnal tide
 */
const TIDAL_PERIOD_MS = (12 * 60 + 25) * 60 * 1000 + 14 * 1000;

/**
 * Reference high tide at North Woolwich (London)
 * This is a known high tide time used as an anchor for calculations
 * High tide at 2024-01-01T00:00:00Z (approximate)
 */
const REFERENCE_HIGH_TIDE = new Date('2024-01-01T00:12:00Z');

/**
 * Calculate the tidal phase at a given time
 *
 * Uses astronomical calculation based on the semi-diurnal tidal cycle.
 * The tide goes through a complete cycle (high -> low -> high) in ~12h 25m.
 *
 * @param {Date} time - Time to calculate phase for
 * @returns {'FLOOD' | 'EBB'} Tidal phase
 */
export function calculateTidalPhase(time) {
  const targetTime = new Date(time).getTime();
  const refTime = REFERENCE_HIGH_TIDE.getTime();

  // Calculate where we are in the tidal cycle
  // Position 0 = high tide, 0.5 = low tide, 1 = high tide again
  const elapsed = targetTime - refTime;
  const cyclePosition = ((elapsed % TIDAL_PERIOD_MS) + TIDAL_PERIOD_MS) % TIDAL_PERIOD_MS;
  const phaseRatio = cyclePosition / TIDAL_PERIOD_MS;

  // 0.0 - 0.5: tide is falling (EBB) - from high to low
  // 0.5 - 1.0: tide is rising (FLOOD) - from low to high
  return phaseRatio < 0.5 ? 'EBB' : 'FLOOD';
}

/**
 * Calculate approximate high and low tide times around a given time
 *
 * @param {Date} time - Reference time
 * @returns {{ previousHigh: Date, previousLow: Date, nextHigh: Date, nextLow: Date }}
 */
export function calculateTideTimes(time) {
  const targetTime = new Date(time).getTime();
  const refTime = REFERENCE_HIGH_TIDE.getTime();

  // Find the nearest high tide
  const elapsed = targetTime - refTime;
  const cyclesSinceRef = elapsed / TIDAL_PERIOD_MS;
  const completeCycles = Math.floor(cyclesSinceRef);

  const previousHighTime = refTime + completeCycles * TIDAL_PERIOD_MS;
  const previousLowTime = previousHighTime + TIDAL_PERIOD_MS / 2;
  const nextHighTime = previousHighTime + TIDAL_PERIOD_MS;
  const nextLowTime = previousLowTime + TIDAL_PERIOD_MS;

  // Adjust if target is before the "previous" events
  let prevHigh = previousHighTime;
  let prevLow = previousLowTime;
  let nextHigh = nextHighTime;
  let nextLow = nextLowTime;

  if (prevLow > targetTime) {
    // We're between previous high and previous low
    prevLow = previousLowTime - TIDAL_PERIOD_MS;
    nextLow = previousLowTime;
  }

  return {
    previousHigh: new Date(prevHigh > targetTime ? prevHigh - TIDAL_PERIOD_MS : prevHigh),
    previousLow: new Date(prevLow),
    nextHigh: new Date(prevHigh > targetTime ? prevHigh : nextHigh),
    nextLow: new Date(prevLow > targetTime ? prevLow : nextLow)
  };
}

/**
 * Get tidal phase with confidence indicator
 *
 * Astronomical calculations are approximate. Actual tides are affected by:
 * - Spring/neap cycle (moon phase)
 * - Weather (storm surges)
 * - River flow
 *
 * @param {Date} time - Time to check
 * @returns {{ phase: 'FLOOD' | 'EBB', confidence: 'high' | 'medium', tideTimes: Object }}
 */
export function getTidalPhaseWithConfidence(time) {
  const phase = calculateTidalPhase(time);
  const tideTimes = calculateTideTimes(time);

  // Confidence is higher when we're clearly in mid-phase
  // Lower near the transitions (slack water)
  const targetTime = new Date(time).getTime();
  const refTime = REFERENCE_HIGH_TIDE.getTime();
  const elapsed = targetTime - refTime;
  const cyclePosition = ((elapsed % TIDAL_PERIOD_MS) + TIDAL_PERIOD_MS) % TIDAL_PERIOD_MS;
  const phaseRatio = cyclePosition / TIDAL_PERIOD_MS;

  // Near 0, 0.5, or 1 = transition (slack water) = lower confidence
  const distanceFromTransition = Math.min(
    phaseRatio,
    Math.abs(phaseRatio - 0.5),
    1 - phaseRatio
  );

  // If within 10% of transition, medium confidence
  const confidence = distanceFromTransition < 0.1 ? 'medium' : 'high';

  return {
    phase,
    confidence,
    tideTimes: {
      previousHigh: tideTimes.previousHigh.toISOString(),
      previousLow: tideTimes.previousLow.toISOString(),
      nextHigh: tideTimes.nextHigh.toISOString(),
      nextLow: tideTimes.nextLow.toISOString()
    }
  };
}

/**
 * Batch calculate tidal phases for multiple times
 *
 * @param {Date[]} times - Array of times
 * @returns {Map<string, 'FLOOD' | 'EBB'>} Map of ISO timestamp to phase
 */
export function batchCalculateTidalPhase(times) {
  const results = new Map();

  for (const time of times) {
    const phase = calculateTidalPhase(time);
    results.set(new Date(time).toISOString(), phase);
  }

  return results;
}
