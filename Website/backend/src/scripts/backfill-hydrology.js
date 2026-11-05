/**
 * Backfill historical flow and groundwater readings from EA API
 *
 * Run with: node src/scripts/backfill-hydrology.js [--flow] [--groundwater] [--all]
 *           [--days N] [--concurrency N]
 *
 * The EA API returns up to ~30 days of readings per request.
 * This script fetches historical data for all stored stations.
 */

import { pool } from '../db/db.js';
import {
  getStoredFlowStations,
  getStoredGroundwaterStations,
  fetchFlowReadings,
  fetchGroundwaterReadings,
  storeFlowReadings,
  storeGroundwaterReadings
} from '../services/hydrology.service.js';

// Parse args
const args = process.argv.slice(2);
const hasTypeFlag = args.includes('--flow') || args.includes('--groundwater') || args.includes('--all');
const backfillFlow = args.includes('--flow') || args.includes('--all') || !hasTypeFlag;
const backfillGW = args.includes('--groundwater') || args.includes('--all') || !hasTypeFlag;

const daysIdx = args.indexOf('--days');
const concurrencyIdx = args.indexOf('--concurrency');
const DAYS_BACK = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 30;
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 3;

const DELAY_MS = 300; // Respect EA rate limits

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process stations in concurrent batches
 */
async function processStations(stations, fetchFn, storeFn, type) {
  const startTime = Date.now();
  let totalReadings = 0;
  let processed = 0;
  let errors = 0;

  // Calculate since date
  const since = new Date();
  since.setDate(since.getDate() - DAYS_BACK);

  console.log(`\nFetching ${type} readings since ${since.toISOString().split('T')[0]}...`);
  console.log(`Processing ${stations.length} stations with concurrency ${CONCURRENCY}\n`);

  for (let i = 0; i < stations.length; i += CONCURRENCY) {
    const batch = stations.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (station) => {
        const readings = await fetchFn(station.stationId, { since, limit: 10000 });
        if (readings.length > 0) {
          const stored = await storeFn(readings);
          return { stationId: station.stationId, label: station.label, count: stored };
        }
        return { stationId: station.stationId, label: station.label, count: 0 };
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled') {
        totalReadings += result.value.count;
        if (result.value.count > 0 && (processed <= 5 || processed % 10 === 0)) {
          console.log(`  ✓ ${result.value.label}: ${result.value.count} readings`);
        }
      } else {
        errors++;
        if (errors <= 5) {
          console.error(`  ✗ Error: ${result.reason.message}`);
        }
      }
    }

    // Progress
    const pct = Math.round(processed / stations.length * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  Progress: ${processed}/${stations.length} (${pct}%) | ${totalReadings} readings | ${elapsed}s`);

    await sleep(DELAY_MS);
  }

  console.log(`\n\n${type} backfill complete:`);
  console.log(`  Stations processed: ${processed}`);
  console.log(`  Total readings stored: ${totalReadings}`);
  console.log(`  Errors: ${errors}`);

  return totalReadings;
}

async function main() {
  const startTime = Date.now();
  console.log('[Backfill Hydrology] Starting...\n');
  console.log(`  Days to fetch: ${DAYS_BACK}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);

  // FLOW STATIONS
  if (backfillFlow) {
    console.log('\n=== Flow Readings ===');

    const flowStations = await getStoredFlowStations();
    if (flowStations.length === 0) {
      console.log('No flow stations in database. Run discover-hydrology.js first.');
    } else {
      await processStations(
        flowStations,
        fetchFlowReadings,
        storeFlowReadings,
        'Flow'
      );
    }
  }

  // GROUNDWATER STATIONS
  if (backfillGW) {
    console.log('\n=== Groundwater Readings ===');

    const gwStations = await getStoredGroundwaterStations();
    if (gwStations.length === 0) {
      console.log('No groundwater stations in database. Run discover-hydrology.js first.');
    } else {
      await processStations(
        gwStations,
        fetchGroundwaterReadings,
        storeGroundwaterReadings,
        'Groundwater'
      );
    }
  }

  // SUMMARY
  console.log('\n=== Database Status ===\n');

  const [[{ flowCount }]] = await pool.query('SELECT COUNT(*) as flowCount FROM flow_reading');
  const [[{ gwCount }]] = await pool.query('SELECT COUNT(*) as gwCount FROM groundwater_reading');

  const [[flowRange]] = await pool.query('SELECT MIN(ts) as min_ts, MAX(ts) as max_ts FROM flow_reading');
  const [[gwRange]] = await pool.query('SELECT MIN(ts) as min_ts, MAX(ts) as max_ts FROM groundwater_reading');

  console.log('Total readings in database:');
  console.log(`  Flow: ${flowCount} (${flowRange.min_ts?.toISOString()?.split('T')[0] || 'N/A'} to ${flowRange.max_ts?.toISOString()?.split('T')[0] || 'N/A'})`);
  console.log(`  Groundwater: ${gwCount} (${gwRange.min_ts?.toISOString()?.split('T')[0] || 'N/A'} to ${gwRange.max_ts?.toISOString()?.split('T')[0] || 'N/A'})`);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal time: ${totalTime}s`);

  await pool.end();
  console.log('\n[Backfill Hydrology] Done.');
}

main().catch((err) => {
  console.error('[Backfill Hydrology] Error:', err);
  process.exit(1);
});
