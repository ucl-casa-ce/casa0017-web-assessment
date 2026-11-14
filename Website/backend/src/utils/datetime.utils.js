/**
 * Date/time conversion utilities.
 *
 * @module utils/datetime
 */

/**
 * Time periods for filtering historical data
 * @typedef {Object} TimePeriods
 * @property {Date} now - Current timestamp
 * @property {Date} last48h - 48 hours ago
 * @property {Date} last7d - 7 days ago
 * @property {Date} last30d - 30 days ago
 * @property {Date} last6m - ~6 months ago (183 days)
 * @property {Date} last12m - ~12 months ago (365 days)
 * @property {Date} startOfYear - January 1st of current year
 */

/**
 * Convert an ISO 8601 date string to MySQL DATETIME format.
 *
 * @param {string|null} isoString - ISO 8601 date string (e.g., "2024-01-15T14:30:00Z")
 * @returns {string|null} MySQL DATETIME string (e.g., "2024-01-15 14:30:00") or null
 */
export function toMysqlDateTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get date objects for common time periods relative to now.
 *
 * @returns {TimePeriods} Object containing Date instances for various periods
 */
export function getTimePeriods() {
  const now = new Date();
  return {
    now,
    last48h: new Date(now - 48 * 60 * 60 * 1000),
    last7d: new Date(now - 7 * 24 * 60 * 60 * 1000),
    last30d: new Date(now - 30 * 24 * 60 * 60 * 1000),
    last6m: new Date(now - 183 * 24 * 60 * 60 * 1000),
    last12m: new Date(now - 365 * 24 * 60 * 60 * 1000),
    startOfYear: new Date(now.getFullYear(), 0, 1)
  };
}
