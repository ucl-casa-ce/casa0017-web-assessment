// Pure helpers shared by the browser model, the backend loaders and the alerts job.
// No dependencies, no network: safe to import from Vite and from Node.

import { CONFIG } from '../config.js';

const rainKey = ([lon, lat], dp) => `${lat.toFixed(dp)},${lon.toFixed(dp)}`;
export { rainKey };
/** Hourly rain series for an overflow position: { times:[ms], rain:[mm] } or undefined. */
export const rainFor = (rain, pos) => rain?.byKey?.[rainKey(pos, rain.dp)];

/** Site names normalised for joining live data to historical records. */
export const normaliseSiteName = (s) =>
  String(s).toLowerCase().replace(/\b(stw|wwtw|sto|cso|storm|overflow|sps|tanks?)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Parse a timestamp; offset-less strings are read as Europe/London clock time unless assumeUtc. */
export function parseTime(s, assumeUtc = false) {
  if (!s) return null;
  if (typeof s === 'number') return s;
  if (s instanceof Date) return s.getTime();
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return Date.parse(s);
  if (assumeUtc) return Date.parse(s + 'Z');
  const guess = Date.parse(s + 'Z');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const londonAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return guess - (londonAsUtc - guess);
}

export { CONFIG };
