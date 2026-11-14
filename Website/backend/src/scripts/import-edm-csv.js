/**
 * Import historical EDM data from Defra CSV/XLSX files
 *
 * Run with: node src/scripts/import-edm-csv.js <path-to-file>
 *
 * Download Thames Water EDM data from:
 * https://environment.data.gov.uk/dataset/e9677ac1-fd32-4ceb-88a0-2735be5f27c7
 *
 * Supports both CSV and XLSX formats.
 *
 * Expected columns:
 * - Water Company Name
 * - Site Name (Permit Number)
 * - Site Name
 * - Activity Reference
 * - Receiving Water
 * - Event Start
 * - Event End
 * - Duration (hrs)
 * - Reporting % (optional)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { pool } from '../db/db.js';

// Target London rivers
const TARGET_RIVERS = ['lee', 'lea', 'bow', 'thames', 'channelsea', 'regent'];

function isLondonRiver(receivingWater) {
  if (!receivingWater) return false;
  const lower = receivingWater.toLowerCase();
  return TARGET_RIVERS.some((river) => lower.includes(river));
}

function parseDateTime(dateStr) {
  if (!dateStr) return null;
  // Handle various date formats
  // "2024-01-15 14:30:00" or "15/01/2024 14:30"
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Read file as records (supports CSV and XLSX)
 * @param {string} filePath - Path to file
 * @returns {Object[]} Array of record objects
 */
function readFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
  }

  // Try to detect if "CSV" is actually XLSX (common issue with Defra files)
  const buffer = fs.readFileSync(filePath);
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    // PK header = ZIP/XLSX format
    const workbook = XLSX.read(buffer);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
  }

  // Regular CSV
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

async function importFile(filePath) {
  console.log(`[EDM Import] Reading ${filePath}...\n`);

  const records = readFile(filePath);

  console.log(`[EDM Import] Found ${records.length} total records\n`);

  // Get London outfalls from database for name matching
  const [londonOutfalls] = await pool.query(
    'SELECT permit_number, location_name FROM outfalls WHERE receiving_watercourse IS NOT NULL'
  );
  console.log(`[EDM Import] ${londonOutfalls.length} London outfalls in database\n`);

  // Build location name lookup (normalize names for matching)
  const normalizeLocation = (name) => {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/\s+(ps|cso|stw|wwtw|pumping station|sewage treatment works)$/i, '')
      .replace(/[^a-z0-9]/g, '');
  };

  const outfallByNormalizedName = new Map();
  for (const o of londonOutfalls) {
    const normalized = normalizeLocation(o.location_name);
    if (normalized) {
      outfallByNormalizedName.set(normalized, o.permit_number);
    }
  }

  // Parse records - handle multiple column name formats
  const events = records.map((r) => {
    const twlId = r['Unique ID'] ||
                  r['Site Name (Permit Number)'] ||
                  r['Permit Number'] ||
                  r['Asset ID'];
    const locationName = r['Site Name'] ||
                        r['Site Name (EA Consents Database)'] ||
                        r['Site Name (EA Consent Database)'] ||
                        r['Location Name'] ||
                        r['Asset Name'];
    const receivingWater = r['Receiving Water'] || r['Receiving Watercourse'] || null;

    const startTime = parseDateTime(
      r['Discharge Strat (GMT)'] ||  // 2024 format (typo)
      r['Discharge Start (GMT)'] ||
      r['Event Start'] ||
      r['Start Date Time']
    );
    const endTime = parseDateTime(
      r['Discharge Stop (GMT)'] ||
      r['Event End'] ||
      r['End Date Time']
    );

    // Try to match to EA permit number by location name
    const normalizedName = normalizeLocation(locationName);
    const matchedPermit = outfallByNormalizedName.get(normalizedName);

    return {
      twlId,
      permitNumber: matchedPermit || twlId,  // Use matched EA permit or fall back to TWL ID
      locationName,
      receivingWater,
      startTime,
      endTime,
      matched: !!matchedPermit
    };
  }).filter((e) => e.twlId && e.startTime);

  console.log(`[EDM Import] ${events.length} valid events parsed\n`);

  // Count matched vs unmatched
  const matched = events.filter((e) => e.matched);
  const unmatched = events.filter((e) => !e.matched);
  console.log(`[EDM Import] ${matched.length} events matched to London outfalls\n`);
  console.log(`[EDM Import] ${unmatched.length} events unmatched (will use TWL ID)\n`);

  // Import all events - we'll use TWL IDs for unmatched ones
  const filteredEvents = events;

  console.log(`[EDM Import] ${filteredEvents.length} events to import\n`);

  // First ensure outfalls exist
  const uniqueOutfalls = new Map();
  for (const e of filteredEvents) {
    if (!uniqueOutfalls.has(e.permitNumber)) {
      uniqueOutfalls.set(e.permitNumber, {
        permitNumber: e.permitNumber,
        locationName: e.locationName,
        receivingWater: e.receivingWater
      });
    }
  }

  console.log(`[EDM Import] ${uniqueOutfalls.size} unique outfalls\n`);

  // Insert outfalls (or update)
  const outfallValues = Array.from(uniqueOutfalls.values()).map((o) => [
    o.permitNumber,
    o.locationName || 'Unknown',
    o.receivingWater || 'Unknown'
  ]);

  if (outfallValues.length > 0) {
    await pool.query(`
      INSERT INTO outfalls (permit_number, location_name, receiving_watercourse)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        location_name = VALUES(location_name)
    `, [outfallValues]);
    console.log(`[EDM Import] ✓ Upserted ${outfallValues.length} outfalls\n`);
  }

  // Insert spill events in batches
  const BATCH_SIZE = 500;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < filteredEvents.length; i += BATCH_SIZE) {
    const batch = filteredEvents.slice(i, i + BATCH_SIZE);
    const values = batch.map((e) => [
      e.permitNumber,
      e.startTime,
      e.endTime
    ]);

    try {
      await pool.query(`
        INSERT IGNORE INTO spill_event (outfall_id, start_ts, end_ts)
        VALUES ?
      `, [values]);
      inserted += batch.length;
    } catch (err) {
      console.error(`[EDM Import] Batch error:`, err.message);
      skipped += batch.length;
    }

    // Progress indicator
    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= filteredEvents.length) {
      console.log(`[EDM Import] Progress: ${Math.min(i + BATCH_SIZE, filteredEvents.length)}/${filteredEvents.length}`);
    }
  }

  console.log(`\n[EDM Import] ✓ Inserted ${inserted} events (${skipped} skipped/duplicates)\n`);

  // Summary
  const [countResult] = await pool.query('SELECT COUNT(*) AS count FROM spill_event');
  console.log(`[EDM Import] Total spill_event records: ${countResult[0].count}\n`);
}

async function main() {
  const csvPath = process.argv[2];

  if (!csvPath) {
    console.log('Usage: node src/scripts/import-edm-csv.js <path-to-csv>');
    console.log('\nDownload Thames Water EDM data from:');
    console.log('https://environment.data.gov.uk/dataset/e9677ac1-fd32-4ceb-88a0-2735be5f27c7');
    process.exit(1);
  }

  const fullPath = path.resolve(csvPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  await importFile(fullPath);
  await pool.end();
  console.log('[EDM Import] Done.');
}

main().catch((err) => {
  console.error('[EDM Import] Error:', err);
  process.exit(1);
});
