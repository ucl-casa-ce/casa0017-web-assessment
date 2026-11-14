/**
 * Pair outfalls with nearest rain gauges
 *
 * Run with: node src/scripts/pair-outfalls.js
 *
 * Prerequisites:
 * - Run discover-gauges.js first to populate rain_gauge table
 * - Outfalls must exist in the outfalls table (fetch via API first)
 */

import { pool } from '../db/db.js';
import { getStoredGauges, findNearestGauge } from '../services/rainGauge.service.js';

async function main() {
  console.log('[Pair Outfalls] Starting outfall-gauge pairing...\n');

  // Get all outfalls with coordinates
  const [outfalls] = await pool.query(`
    SELECT permit_number, location_name, lat, lng
    FROM outfalls
    WHERE lat IS NOT NULL AND lng IS NOT NULL
  `);

  console.log(`[Pair Outfalls] Found ${outfalls.length} outfalls with coordinates\n`);

  if (outfalls.length === 0) {
    console.log('[Pair Outfalls] No outfalls found. Fetch discharge status first to populate outfalls table.');
    process.exit(0);
  }

  // Get all gauges once
  const gauges = await getStoredGauges();

  if (gauges.length === 0) {
    console.log('[Pair Outfalls] No rain gauges found. Run discover-gauges.js first.');
    process.exit(1);
  }

  console.log(`[Pair Outfalls] Using ${gauges.length} rain gauges for pairing\n`);

  // Pair each outfall with nearest gauge
  const pairings = [];

  for (const outfall of outfalls) {
    const result = await findNearestGauge(outfall.lat, outfall.lng, gauges);

    if (result) {
      pairings.push({
        outfallId: outfall.permit_number,
        locationName: outfall.location_name,
        gaugeId: result.gauge.stationId,
        gaugeLabel: result.gauge.label,
        distanceKm: result.distanceKm
      });
    }
  }

  console.log(`[Pair Outfalls] Created ${pairings.length} pairings:\n`);

  // Display pairings
  for (const p of pairings) {
    console.log(`  ${p.locationName}`);
    console.log(`    -> ${p.gaugeId} (${p.distanceKm} km)\n`);
  }

  // Store pairings in database
  console.log('[Pair Outfalls] Storing pairings in database...');

  const values = pairings.map((p) => [p.outfallId, p.gaugeId, p.distanceKm]);

  if (values.length > 0) {
    await pool.query(`
      INSERT INTO outfall_gauge (outfall_id, gauge_id, distance_km)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        distance_km = VALUES(distance_km)
    `, [values]);
  }

  console.log(`[Pair Outfalls] ✓ Stored ${pairings.length} pairings\n`);

  // Summary statistics
  const distances = pairings.map((p) => p.distanceKm);
  const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const maxDist = Math.max(...distances);
  const minDist = Math.min(...distances);

  console.log('Distance statistics:');
  console.log(`  Min: ${minDist.toFixed(2)} km`);
  console.log(`  Max: ${maxDist.toFixed(2)} km`);
  console.log(`  Avg: ${avgDist.toFixed(2)} km\n`);

  await pool.end();
  console.log('[Pair Outfalls] Done.');
}

main().catch((err) => {
  console.error('[Pair Outfalls] Error:', err);
  process.exit(1);
});
