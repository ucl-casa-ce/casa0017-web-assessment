import proj4 from 'proj4';

// Define British National Grid (OSGB36 / BNG)
proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs'
);

// Define standard WGS84 geographic coordinates
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

/**
 * Converts British National Grid (BNG) Easting and Northing to WGS84 Lat and Lng.
 * @param {number} easting - BNG Easting (e.g., 530000)
 * @param {number} northing - BNG Northing (e.g., 180000)
 * @returns {{lat: number, lng: number}|null} Object with lat and lng, or null if invalid.
 */
export function convertBngToWgs84(easting, northing) {
  if (!easting || !northing || Number.isNaN(Number(easting)) || Number.isNaN(Number(northing))) {
    return null;
  }

  // proj4 expects [easting, northing] and returns [longitude, latitude]
  const [lng, lat] = proj4('EPSG:27700', 'EPSG:4326', [Number(easting), Number(northing)]);

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}