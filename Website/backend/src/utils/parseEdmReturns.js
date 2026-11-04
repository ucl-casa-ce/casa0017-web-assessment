import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

/**
 * Reads and parses an EA EDM CSV returns file, filtering for Lea / Bow Creek watercourses.
 * @param {string} filePath - Path to the downloaded EA CSV file
 * @returns {Promise<Array<Object>>} Filtered and transformed array of outfall spill records
 */
export const parseEdmReturns = async (filePath) => {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');

    // Parse CSV records using csv-parse/sync
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    // Transform and filter for Lea / Bow Creek catchments
    const transformed = records
      .map((row) => {
        // Handle common variations in EA column header naming conventions
        const receivingWater = row.ReceivingWaterCourse || row['Receiving Water Course'] || '';
        const permitNumber = row.PermitNumber || row['Permit Number'] || row.PermitReference || '';
        const outfallName = row.LocationName || row['Location Name'] || row.SiteName || '';
        const easting = row.Easting || row.X || null;
        const northing = row.Northing || row.Y || null;

        return {
          outfallId: permitNumber,
          name: outfallName,
          permitNumber: permitNumber,
          easting: easting ? Number(easting) : null,
          northing: northing ? Number(northing) : null,
          receivingWater: receivingWater,
          startTs: row.MostRecentDischargeAlertStart || row.StartDate || row.EventStart || null,
          endTs: row.MostRecentDischargeAlertStop || row.EndDate || row.EventStop || null
        };
      })
      .filter((item) => {
        const water = (item.receivingWater || '').toLowerCase();
        // Filter specifically for River Lea, Lee, or Bow Creek
        return water.includes('lea') || water.includes('lee') || water.includes('bow');
      });

    return transformed;
  } catch (error) {
    throw new Error(`Failed to parse EDM returns CSV: ${error.message}`);
  }
};

/**
 * Validates an outfall record for mandatory fields and data integrity.
 * @param {Object} outfall - Outfall object to validate
 * @returns {{isValid: boolean, errors: Array<string>}} Validation result and list of error messages
 */
export const validateOutfallData = (outfall) => {
  const errors = [];

  if (!outfall) {
    return { isValid: false, errors: ['Outfall object is null or undefined'] };
  }

  if (!outfall.name || typeof outfall.name !== 'string' || outfall.name.trim() === '') {
    errors.push('Missing or invalid outfall name');
  }

  if (!outfall.permitNumber && !outfall.outfallId) {
    errors.push('Missing permit number or outfall ID');
  }

  const hasGrid = (outfall.easting && outfall.northing) || (outfall.lat && outfall.lng);
  if (!hasGrid) {
    errors.push('Missing geographic coordinates (Easting/Northing or Lat/Lng required)');
  }

  if (!outfall.receivingWater || typeof outfall.receivingWater !== 'string') {
    errors.push('Missing receiving watercourse description');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};