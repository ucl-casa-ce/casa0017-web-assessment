/**
 * Coordinate conversion utilities for British National Grid (OSGB36) to WGS84.
 *
 * Algorithm based on Ordnance Survey guidance:
 * - "A guide to coordinate systems in Great Britain" (Ordnance Survey, 2020)
 *   https://www.ordnancesurvey.co.uk/documents/resources/guide-coordinate-systems-great-britain.pdf
 *
 * Helmert transformation parameters from:
 * - Ordnance Survey OSTN15/OSGM15 transformations
 *   https://www.ordnancesurvey.co.uk/business-government/tools-support/os-net/for-developers
 *
 * Implementation reference:
 * - Movable Type Scripts by Chris Veness (MIT License)
 *   https://www.movable-type.co.uk/scripts/latlong-os-gridref.html
 *
 * @module utils/coordinate
 */

/** @typedef {import('../types').Coordinates} Coordinates */

/**
 * Convert British National Grid (OSGB36) easting/northing to WGS84 lat/lng.
 * Uses Helmert 7-parameter transformation via iterative approach.
 *
 * @param {number} easting - OSGB36 easting in metres
 * @param {number} northing - OSGB36 northing in metres
 * @returns {Coordinates} WGS84 coordinates (lat/lng may be null if invalid input)
 */
export function osgbToLatLng(easting, northing) {
  if (!easting || !northing || isNaN(easting) || isNaN(northing)) {
    return { lat: null, lng: null };
  }

  // Airy 1830 ellipsoid (OSGB36)
  const a = 6377563.396; // Semi-major axis
  const b = 6356256.909; // Semi-minor axis
  const F0 = 0.9996012717; // Scale factor on central meridian
  const lat0 = (49 * Math.PI) / 180; // Latitude of true origin (49°N)
  const lon0 = (-2 * Math.PI) / 180; // Longitude of true origin (2°W)
  const N0 = -100000; // Northing of true origin
  const E0 = 400000; // Easting of true origin
  const e2 = 1 - (b * b) / (a * a); // Eccentricity squared
  const n = (a - b) / (a + b);

  let lat = lat0;
  let M = 0;

  // Iteratively compute latitude using Newton-Raphson
  do {
    lat = (northing - N0 - M) / (a * F0) + lat;
    const Ma =
      (1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * (lat - lat0);
    const Mb =
      (3 * n + 3 * n * n + (21 / 8) * n * n * n) *
      Math.sin(lat - lat0) *
      Math.cos(lat + lat0);
    const Mc =
      ((15 / 8) * n * n + (15 / 8) * n * n * n) *
      Math.sin(2 * (lat - lat0)) *
      Math.cos(2 * (lat + lat0));
    const Md =
      (35 / 24) * n * n * n * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(northing - N0 - M) >= 0.00001);

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat);
  const tan2 = tanLat * tanLat;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const secLat = 1 / cosLat;
  const nu3 = nu * nu * nu;
  const nu5 = nu3 * nu * nu;
  const nu7 = nu5 * nu * nu;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const dE = easting - E0;
  const dE2 = dE * dE;
  const dE3 = dE2 * dE;
  const dE4 = dE2 * dE2;
  const dE5 = dE3 * dE2;
  const dE6 = dE3 * dE3;
  const dE7 = dE4 * dE3;

  const latRad = lat - VII * dE2 + VIII * dE4 - IX * dE6;
  const lonRad = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  // Convert OSGB36 to WGS84 using Helmert transformation
  const osgbLat = latRad;
  const osgbLon = lonRad;
  const h = 0; // Height above ellipsoid (assumed 0 for simplicity)

  // Convert to Cartesian coordinates
  const sinOsgbLat = Math.sin(osgbLat);
  const cosOsgbLat = Math.cos(osgbLat);
  const sinOsgbLon = Math.sin(osgbLon);
  const cosOsgbLon = Math.cos(osgbLon);
  const nuH = a / Math.sqrt(1 - e2 * sinOsgbLat * sinOsgbLat);
  const x1 = (nuH + h) * cosOsgbLat * cosOsgbLon;
  const y1 = (nuH + h) * cosOsgbLat * sinOsgbLon;
  const z1 = ((1 - e2) * nuH + h) * sinOsgbLat;

  // Helmert transformation parameters (OSGB36 to WGS84)
  // Source: Ordnance Survey
  const tx = 446.448; // X translation (metres)
  const ty = -125.157; // Y translation (metres)
  const tz = 542.06; // Z translation (metres)
  const s = -20.4894 / 1e6; // Scale factor (ppm)
  const rx = (0.1502 / 3600) * (Math.PI / 180); // X rotation (radians)
  const ry = (0.247 / 3600) * (Math.PI / 180); // Y rotation (radians)
  const rz = (0.8421 / 3600) * (Math.PI / 180); // Z rotation (radians)

  const x2 = tx + (1 + s) * x1 + -rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 + -rx * z1;
  const z2 = tz + -ry * x1 + rx * y1 + (1 + s) * z1;

  // WGS84 ellipsoid parameters
  const aWgs = 6378137;
  const bWgs = 6356752.3142;
  const e2Wgs = 1 - (bWgs * bWgs) / (aWgs * aWgs);

  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let wgsLat = Math.atan2(z2, p * (1 - e2Wgs));
  let prevLat;

  // Iteratively compute WGS84 latitude
  do {
    prevLat = wgsLat;
    const nuWgs = aWgs / Math.sqrt(1 - e2Wgs * Math.sin(wgsLat) * Math.sin(wgsLat));
    wgsLat = Math.atan2(z2 + e2Wgs * nuWgs * Math.sin(wgsLat), p);
  } while (Math.abs(wgsLat - prevLat) > 1e-12);

  const wgsLon = Math.atan2(y2, x2);

  return {
    lat: Number(((wgsLat * 180) / Math.PI).toFixed(6)),
    lng: Number(((wgsLon * 180) / Math.PI).toFixed(6))
  };
}
