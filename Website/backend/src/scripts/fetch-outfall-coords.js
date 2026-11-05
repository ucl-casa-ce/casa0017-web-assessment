/**
 * Fetch missing outfall coordinates from EA Consented Discharges API
 *
 * Run with: node src/scripts/fetch-outfall-coords.js [--limit N]
 *
 * This script:
 * 1. Finds outfalls missing lat/lng coordinates
 * 2. Queries EA ArcGIS API by location name
 * 3. Updates outfalls table with found coordinates
 */

import axios from 'axios';
import { pool } from '../db/db.js';

// Parse command line args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 1000;

// EA Consented Discharges ArcGIS Feature Service
const EA_API_URL = 'https://services3.arcgis.com/Bb8lfThdhugyc4G3/ArcGIS/rest/services/Consented_Discharges_2019/FeatureServer/0/query';

// Rate limiting
const DELAY_MS = 100;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize location name for matching
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(/\s+(PS|CSO|STW|WWTW|SPS|PUMPING STATION|SEWAGE TREATMENT WORKS|WASTEWATER TREATMENT WORKS)$/i, '')
    .replace(/[^A-Z0-9\s]/g, '')
    .trim();
}

/**
 * Query EA API for outfall by location name
 */
async function queryEAByName(locationName) {
  // Try exact match first, then fuzzy
  const normalized = normalizeName(locationName);
  const searchTerms = [
    locationName,  // Exact
    normalized,    // Normalized
    normalized.split(' ')[0]  // First word only (fallback)
  ];

  for (const term of searchTerms) {
    if (!term || term.length < 3) continue;

    const params = new URLSearchParams({
      where: `DISCHARGE_SITE_NAME LIKE '%${term}%'`,
      outFields: 'PERMIT_NUMBER,DISCHARGE_SITE_NAME,LAT,LONG,RECEIVING_WATER,OUTLET_TYPE_DESCRIPTION',
      returnGeometry: 'false',
      f: 'json'
    });

    try {
      const response = await axios.get(`${EA_API_URL}?${params.toString()}`, {
        timeout: 10000
      });

      if (response.data.features && response.data.features.length > 0) {
        // Find best match - prefer sewage-related outlets
        const features = response.data.features;

        // Sort by relevance: exact name match > sewage type > first result
        const sorted = features.sort((a, b) => {
          const aName = normalizeName(a.attributes.DISCHARGE_SITE_NAME);
          const bName = normalizeName(b.attributes.DISCHARGE_SITE_NAME);
          const target = normalized;

          // Exact match wins
          if (aName === target && bName !== target) return -1;
          if (bName === target && aName !== target) return 1;

          // Sewage-related outlets preferred
          const aSewage = /sewage|storm|cso|overflow/i.test(a.attributes.OUTLET_TYPE_DESCRIPTION || '');
          const bSewage = /sewage|storm|cso|overflow/i.test(b.attributes.OUTLET_TYPE_DESCRIPTION || '');
          if (aSewage && !bSewage) return -1;
          if (bSewage && !aSewage) return 1;

          return 0;
        });

        const best = sorted[0].attributes;
        if (best.LAT && best.LONG) {
          return {
            lat: best.LAT,
            lng: best.LONG,
            eaPermit: best.PERMIT_NUMBER,
            matchedName: best.DISCHARGE_SITE_NAME
          };
        }
      }
    } catch (err) {
      // Continue to next search term
    }
  }

  return null;
}

async function main() {
  console.log('[Fetch Coords] Starting...\n');
  console.log(`  Limit: ${LIMIT} outfalls`);
  console.log(`  Source: EA Consented Discharges ArcGIS API\n`);

  // Get outfalls missing coordinates
  const [outfalls] = await pool.query(`
    SELECT permit_number, location_name
    FROM outfalls
    WHERE (lat IS NULL OR lng IS NULL)
      AND location_name IS NOT NULL
      AND location_name != ''
    LIMIT ?
  `, [LIMIT]);

  console.log(`[Fetch Coords] Found ${outfalls.length} outfalls missing coordinates\n`);

  if (outfalls.length === 0) {
    console.log('[Fetch Coords] No outfalls need coordinates.');
    await pool.end();
    return;
  }

  let found = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < outfalls.length; i++) {
    const outfall = outfalls[i];

    try {
      const result = await queryEAByName(outfall.location_name);

      if (result) {
        await pool.query(
          `UPDATE outfalls SET lat = ?, lng = ? WHERE permit_number = ?`,
          [result.lat, result.lng, outfall.permit_number]
        );
        found++;

        // Log matches
        if (found <= 10 || found % 50 === 0) {
          console.log(`  ✓ ${outfall.location_name}`);
          console.log(`      → ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)} (${result.matchedName})`);
        }
      } else {
        notFound++;
        if (notFound <= 5) {
          console.log(`  ✗ Not found: ${outfall.location_name}`);
        }
      }
    } catch (err) {
      errors++;
      if (errors <= 3) {
        console.error(`  Error for ${outfall.permit_number}: ${err.message}`);
      }
    }

    // Progress update
    if ((i + 1) % 100 === 0 || i + 1 === outfalls.length) {
      const pct = Math.round((i + 1) / outfalls.length * 100);
      console.log(`\n[Fetch Coords] Progress: ${i + 1}/${outfalls.length} (${pct}%)`);
      console.log(`  Found: ${found}, Not found: ${notFound}, Errors: ${errors}\n`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n[Fetch Coords] Complete!');
  console.log(`  Coordinates found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);

  // Show updated stats
  const [[{ withCoords }]] = await pool.query(
    'SELECT COUNT(*) as withCoords FROM outfalls WHERE lat IS NOT NULL AND lng IS NOT NULL'
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM outfalls');
  console.log(`\n  Outfalls with coordinates: ${withCoords}/${total}`);

  // Show how many events can now be enriched
  const [[{ enrichable }]] = await pool.query(`
    SELECT COUNT(*) as enrichable
    FROM spill_event se
    JOIN outfalls o ON se.outfall_id = o.permit_number
    WHERE o.lat IS NOT NULL AND o.lng IS NOT NULL
      AND se.rain_24h_mm IS NULL
  `);
  console.log(`  Events now enrichable with rainfall: ${enrichable}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('[Fetch Coords] Fatal error:', err);
  process.exit(1);
});
