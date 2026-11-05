/**
 * Discover and store rain gauges for London area
 *
 * Run with: node src/scripts/discover-gauges.js
 */

import { discoverRainGauges, storeGauges } from '../services/rainGauge.service.js';
import { pool } from '../db/db.js';

async function main() {
  console.log('[Discover Gauges] Starting gauge discovery...\n');

  // Discover gauges within 25km of central London
  const gauges = await discoverRainGauges({
    lat: 51.509865,
    lng: -0.118092,
    distanceKm: 25
  });

  console.log(`[Discover Gauges] Found ${gauges.length} rain gauges\n`);

  if (gauges.length === 0) {
    console.log('[Discover Gauges] No gauges found. Exiting.');
    process.exit(0);
  }

  // Display found gauges
  console.log('Gauges found:');
  for (const gauge of gauges) {
    console.log(`  - ${gauge.stationId}: ${gauge.label} (${gauge.lat}, ${gauge.lng})`);
  }

  // Store in database
  console.log('\n[Discover Gauges] Storing gauges in database...');
  const stored = await storeGauges(gauges);
  console.log(`[Discover Gauges] ✓ Stored ${stored} gauges\n`);

  await pool.end();
  console.log('[Discover Gauges] Done.');
}

main().catch((err) => {
  console.error('[Discover Gauges] Error:', err);
  process.exit(1);
});
