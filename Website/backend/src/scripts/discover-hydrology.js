/**
 * Discover and store EA flow & groundwater stations for London area
 *
 * Run with: node src/scripts/discover-hydrology.js [--flow] [--groundwater] [--all]
 *
 * This discovers:
 * - River flow monitoring stations (discharge rates in m³/s)
 * - Groundwater level monitoring stations (water table depth)
 *
 * Both are useful for understanding why spills occur:
 * - High river flow = faster flushing of discharged sewage
 * - High groundwater = increased infiltration into sewers = more spills
 */

import { pool } from '../db/db.js';
import {
  discoverFlowStations,
  storeFlowStations,
  discoverGroundwaterStations,
  storeGroundwaterStations
} from '../services/hydrology.service.js';

const args = process.argv.slice(2);
const discoverFlow = args.includes('--flow') || args.includes('--all') || args.length === 0;
const discoverGW = args.includes('--groundwater') || args.includes('--all') || args.length === 0;

// Target rivers for the project
const TARGET_RIVERS = ['thames', 'lea', 'lee', 'bow'];

async function main() {
  console.log('[Discover Hydrology] Starting station discovery...\n');

  // FLOW STATIONS
  if (discoverFlow) {
    console.log('=== River Flow Stations ===\n');

    const flowStations = await discoverFlowStations({
      lat: 51.509865,
      lng: -0.118092,
      distanceKm: 50 // Larger radius - fewer flow stations than rain gauges
    });

    console.log(`Found ${flowStations.length} flow stations total`);

    // Filter to target rivers
    const targetFlowStations = flowStations.filter(s => {
      const river = (s.riverName || '').toLowerCase();
      return TARGET_RIVERS.some(t => river.includes(t));
    });

    console.log(`  - ${targetFlowStations.length} on target rivers (Thames/Lea/Lee/Bow)\n`);

    // Show all stations grouped by river
    const byRiver = new Map();
    for (const s of flowStations) {
      const river = s.riverName || 'Unknown';
      if (!byRiver.has(river)) byRiver.set(river, []);
      byRiver.get(river).push(s);
    }

    console.log('Flow stations by river:');
    for (const [river, stations] of [...byRiver.entries()].sort()) {
      const isTarget = TARGET_RIVERS.some(t => river.toLowerCase().includes(t));
      const marker = isTarget ? '* ' : '  ';
      console.log(`${marker}${river}: ${stations.length}`);
      if (isTarget || stations.length <= 3) {
        for (const s of stations) {
          console.log(`    - ${s.stationId}: ${s.label}`);
        }
      }
    }

    // Store all stations (useful for broader analysis)
    console.log('\nStoring flow stations in database...');
    const storedFlow = await storeFlowStations(flowStations);
    console.log(`  ✓ Stored ${storedFlow} flow stations\n`);
  }

  // GROUNDWATER STATIONS
  if (discoverGW) {
    console.log('=== Groundwater Stations ===\n');

    const gwStations = await discoverGroundwaterStations({
      lat: 51.509865,
      lng: -0.118092,
      distanceKm: 50
    });

    console.log(`Found ${gwStations.length} groundwater stations\n`);

    // Show stations
    console.log('Groundwater stations:');
    for (const s of gwStations.slice(0, 20)) {
      console.log(`  - ${s.stationId}: ${s.label} (${s.catchmentName || 'no catchment'})`);
    }
    if (gwStations.length > 20) {
      console.log(`  ... and ${gwStations.length - 20} more`);
    }

    // Store all stations
    console.log('\nStoring groundwater stations in database...');
    const storedGW = await storeGroundwaterStations(gwStations);
    console.log(`  ✓ Stored ${storedGW} groundwater stations\n`);
  }

  // SUMMARY
  console.log('=== Summary ===\n');

  const [[{ flowCount }]] = await pool.query('SELECT COUNT(*) as flowCount FROM flow_station');
  const [[{ gwCount }]] = await pool.query('SELECT COUNT(*) as gwCount FROM groundwater_station');

  console.log(`Total stations in database:`);
  console.log(`  - Flow stations: ${flowCount}`);
  console.log(`  - Groundwater stations: ${gwCount}\n`);

  console.log('Next steps:');
  console.log('  1. Run: node src/scripts/backfill-hydrology.js --flow');
  console.log('  2. Run: node src/scripts/backfill-hydrology.js --groundwater');
  console.log('  3. Pair stations to outfalls\n');

  await pool.end();
  console.log('[Discover Hydrology] Done.');
}

main().catch((err) => {
  console.error('[Discover Hydrology] Error:', err);
  process.exit(1);
});
