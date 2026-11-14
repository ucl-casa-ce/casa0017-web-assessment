/**
 * Calculates the great-circle distance between two points on Earth using the Haversine formula.
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {number} Distance in kilometers
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;

  const R = 6371; // Earth radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

/**
 * Finds the nearest point from an array of coordinate objects.
 * @param {number} lat - Reference latitude
 * @param {number} lon - Reference longitude
 * @param {Array<{lat: number, lon: number, [key: string]: any}>} points - Array of points to check
 * @returns {{point: Object, distanceKm: number}|null} The nearest point object with distance property, or null
 */
export const findNearest = (lat, lon, points) => {
  if (!points || points.length === 0) {
    return null;
  }

  let nearest = null;
  let minDistance = Infinity;

  for (const point of points) {
    const pLat = point.lat ?? point.latitude;
    const pLon = point.lon ?? point.lng ?? point.longitude;

    if (pLat === undefined || pLon === undefined) {
      continue;
    }

    const distanceKm = calculateDistance(lat, lon, Number(pLat), Number(pLon));

    if (distanceKm < minDistance) {
      minDistance = distanceKm;
      nearest = {
        ...point,
        distanceKm: Number(distanceKm.toFixed(3))
      };
    }
  }

  return nearest;
};