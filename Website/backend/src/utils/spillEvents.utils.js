/**
 * Spill event processing utilities.
 *
 * Logic adapted from POOPy (Python library for water company discharge data):
 * https://github.com/AlexLipp/POOPy
 *
 * The event pairing algorithm matches Start/Stop alerts to calculate
 * discharge durations, following the Thames Water EDM alert format.
 *
 * @module utils/spillEvents
 */

/** @typedef {import('../types').SpillEvent} SpillEvent */
/** @typedef {import('../types').DischargeSummary} DischargeSummary */

/**
 * Raw alert from Thames Water API
 * @typedef {Object} RawAlert
 * @property {string} permitNumber - Outfall permit number
 * @property {string} [locationName] - Location name
 * @property {string} alertType - "Start", "Stop", "Offline Start", "Offline Stop"
 * @property {string} datetime - ISO datetime of alert
 */

/**
 * Pair Start/Stop alerts to create spill events with calculated durations.
 *
 * Alerts are processed in reverse chronological order. Each "Stop" alert
 * waits for a matching "Start" alert to form a complete event. A "Start"
 * without a preceding "Stop" is considered an ongoing event.
 *
 * @param {RawAlert[]} alerts - Raw alert objects from Thames Water API
 * @returns {SpillEvent[]} Paired events with durations
 */
export function pairAlertsToEvents(alerts) {
  // Sort alerts by datetime descending (newest first)
  const sorted = [...alerts].sort(
    (a, b) => new Date(b.datetime) - new Date(a.datetime)
  );

  const events = [];
  const pending = {}; // Track pending "Stop" events waiting for their "Start"

  for (const alert of sorted) {
    const key = alert.permitNumber;
    const alertType = alert.alertType?.toLowerCase() || '';
    const datetime = new Date(alert.datetime);

    if (alertType === 'stop' || alertType === 'offline stop') {
      // Found a stop event, wait for its matching start
      pending[key] = {
        stopTime: datetime,
        type: alertType.includes('offline') ? 'offline' : 'discharge'
      };
    } else if (alertType === 'start' || alertType === 'offline start') {
      const startTime = datetime;
      const type = alertType.includes('offline') ? 'offline' : 'discharge';

      if (pending[key] && pending[key].type === type) {
        // Found matching start for a pending stop
        const stopTime = pending[key].stopTime;
        const durationMs = stopTime - startTime;
        const durationMinutes = Math.round(durationMs / 60000);

        events.push({
          permitNumber: alert.permitNumber,
          locationName: alert.locationName,
          type,
          startTime: startTime.toISOString(),
          stopTime: stopTime.toISOString(),
          durationMinutes,
          ongoing: false
        });
        delete pending[key];
      } else {
        // Start with no matching stop = ongoing event
        events.push({
          permitNumber: alert.permitNumber,
          locationName: alert.locationName,
          type,
          startTime: startTime.toISOString(),
          stopTime: null,
          durationMinutes: Math.round((Date.now() - startTime) / 60000),
          ongoing: true
        });
      }
    }
  }

  return events;
}

/**
 * Calculate total discharge duration statistics for a set of events.
 *
 * @param {SpillEvent[]} events - Paired events from pairAlertsToEvents()
 * @param {Date|null} [since] - Only count events at or after this date
 * @returns {DischargeSummary} Duration statistics
 */
export function calculateDischargeSummary(events, since = null) {
  const dischargeEvents = events.filter((e) => e.type === 'discharge');
  const sinceDate = since ? new Date(since) : null;

  let totalMinutes = 0;
  let eventCount = 0;

  for (const event of dischargeEvents) {
    const startTime = new Date(event.startTime);

    if (sinceDate && startTime < sinceDate) {
      // Event started before our window
      if (event.stopTime) {
        const stopTime = new Date(event.stopTime);
        if (stopTime > sinceDate) {
          // Partial overlap - count from sinceDate to stopTime
          totalMinutes += Math.round((stopTime - sinceDate) / 60000);
          eventCount++;
        }
      } else {
        // Ongoing event that started before window
        totalMinutes += Math.round((Date.now() - sinceDate) / 60000);
        eventCount++;
      }
    } else if (!sinceDate || startTime >= sinceDate) {
      totalMinutes += event.durationMinutes;
      eventCount++;
    }
  }

  return {
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    eventCount
  };
}
