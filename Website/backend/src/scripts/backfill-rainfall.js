/**
 * Backfill historical rainfall data for spill events (FAST VERSION)
 *
 * Run with: node src/scripts/backfill-rainfall.js [--limit N] [--concurrency N]
 *
 * Optimization strategy:
 * - Groups events by outfall (same location = same API response)
 * - Fetches one date range per outfall covering all events
 * - Processes multiple outfalls concurrently
 * - Batches database updates
 *
 * Speed comparison:
 * - Old: 1 API call per event, 200ms delay = ~2h for 38k events
 * - New: 1 API call per outfall, concurrent = ~5-10 min for 38k events
 */

import { pool } from '../db/db.js';
import { fetchHistoricalPrecipitation } from '../services/historicalWeather.service.js';

// Parse command line args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const concurrencyIdx = args.indexOf('--concurrency');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 100000;
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 3;

// Open-Meteo rate limit handling
let currentDelay = 500; // Start with 500ms, increase on rate limits
const MAX_DELAY = 5000;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff for rate limits
 */
async function fetchWithRetry(lat, lng, startDate, endDate, retries = 0) {
  try {
    const result = await fetchHistoricalPrecipitation(lat, lng, startDate, endDate);
    // Success - gradually reduce delay back to minimum
    if (currentDelay > 500) {
      currentDelay = Math.max(500, currentDelay - 100);
    }
    return result;
  } catch (err) {
    if (err.response?.status === 429 && retries < MAX_RETRIES) {
      // Increase global delay for all requests
      currentDelay = Math.min(MAX_DELAY, currentDelay + 500);
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retries);
      console.log(`\n  ⏳ Rate limited, waiting ${backoff / 1000}s (global delay now ${currentDelay}ms)...`);
      await sleep(backoff);
      return fetchWithRetry(lat, lng, startDate, endDate, retries + 1);
    }
    throw err;
  }
}

/**
 * Calculate rainfall totals for multiple events from a single precipitation dataset
 */
function calculateRainfallFromReadings(readings, events) {
  // Pre-parse all reading times once
  const parsedReadings = readings.map(r => ({
    time: new Date(r.time).getTime(),
    precipitation: r.precipitation
  }));

  const results = [];

  for (const event of events) {
    const endMs = new Date(event.start_ts).getTime();
    const start24hMs = endMs - 24 * 60 * 60 * 1000;
    const start48hMs = endMs - 48 * 60 * 60 * 1000;
    const start72hMs = endMs - 72 * 60 * 60 * 1000;

    let rain24h = 0;
    let rain48h = 0;
    let rain72h = 0;

    for (const reading of parsedReadings) {
      if (reading.time >= start72hMs && reading.time < endMs) {
        rain72h += reading.precipitation;
        if (reading.time >= start48hMs) {
          rain48h += reading.precipitation;
        }
        if (reading.time >= start24hMs) {
          rain24h += reading.precipitation;
        }
      }
    }

    results.push({
      id: event.id,
      rain24h: Math.round(rain24h * 100) / 100,
      rain48h: Math.round(rain48h * 100) / 100,
      rain72h: Math.round(rain72h * 100) / 100
    });
  }

  return results;
}

/**
 * Process a single outfall: fetch weather data and update all its events
 */
async function processOutfall(outfallId, lat, lng, events) {
  // Find date range needed (with 72h buffer at start)
  const timestamps = events.map(e => new Date(e.start_ts).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  const startDate = new Date(minTime - 73 * 60 * 60 * 1000); // 72h + 1h buffer
  const endDate = new Date(maxTime);

  // Fetch all precipitation data for this location in one call (with retry)
  const readings = await fetchWithRetry(lat, lng, startDate, endDate);

  if (readings.length === 0) {
    throw new Error('No precipitation data returned');
  }

  // Calculate rainfall for all events from this single dataset
  const results = calculateRainfallFromReadings(readings, events);

  // Batch update database
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const result of results) {
      await conn.query(
        `UPDATE spill_event SET rain_24h_mm = ?, rain_48h_mm = ?, rain_72h_mm = ? WHERE id = ?`,
        [result.rain24h, result.rain48h, result.rain72h, result.id]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return results.length;
}

async function main() {
  const startTime = Date.now();
  console.log('[Backfill Rainfall] Starting FAST backfill...\n');
  console.log(`  Event limit: ${LIMIT}`);
  console.log(`  Concurrency: ${CONCURRENCY} outfalls at once\n`);

  // Get all events missing rainfall, grouped by outfall
  const [events] = await pool.query(`
    SELECT
      se.id,
      se.outfall_id,
      se.start_ts,
      o.lat,
      o.lng,
      o.location_name
    FROM spill_event se
    JOIN outfalls o ON se.outfall_id = o.permit_number
    WHERE (se.rain_24h_mm IS NULL OR se.rain_48h_mm IS NULL OR se.rain_72h_mm IS NULL)
      AND o.lat IS NOT NULL
      AND o.lng IS NOT NULL
    ORDER BY se.outfall_id, se.start_ts
    LIMIT ?
  `, [LIMIT]);

  if (events.length === 0) {
    console.log('[Backfill Rainfall] No events need rainfall data.');
    await pool.end();
    return;
  }

  // Group events by outfall
  const outfallGroups = new Map();
  for (const event of events) {
    if (!outfallGroups.has(event.outfall_id)) {
      outfallGroups.set(event.outfall_id, {
        lat: event.lat,
        lng: event.lng,
        location_name: event.location_name,
        events: []
      });
    }
    outfallGroups.get(event.outfall_id).events.push(event);
  }

  console.log(`[Backfill Rainfall] Found ${events.length} events across ${outfallGroups.size} outfalls`);
  console.log(`  (Old method: ${events.length} API calls | New method: ${outfallGroups.size} API calls)\n`);

  let outfallsProcessed = 0;
  let eventsUpdated = 0;
  let errors = 0;

  const outfallEntries = [...outfallGroups.entries()];

  // Process outfalls in concurrent batches
  for (let i = 0; i < outfallEntries.length; i += CONCURRENCY) {
    const batch = outfallEntries.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(([outfallId, data]) =>
        processOutfall(outfallId, data.lat, data.lng, data.events)
          .then(count => ({ outfallId, count, location: data.location_name }))
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        outfallsProcessed++;
        eventsUpdated += result.value.count;

        // Log progress
        if (outfallsProcessed <= 3 || outfallsProcessed % 20 === 0) {
          console.log(`  ✓ ${result.value.location}: ${result.value.count} events`);
        }
      } else {
        errors++;
        if (errors <= 5) {
          console.error(`  ✗ Error: ${result.reason.message}`);
        }
      }
    }

    // Progress update every batch
    const pct = Math.round((i + batch.length) / outfallEntries.length * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  Progress: ${outfallsProcessed}/${outfallGroups.size} outfalls (${pct}%) | ${eventsUpdated} events | ${elapsed}s | delay: ${currentDelay}ms`);

    await sleep(currentDelay);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n[Backfill Rainfall] Complete!');
  console.log(`  Outfalls processed: ${outfallsProcessed}`);
  console.log(`  Events updated: ${eventsUpdated}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total time: ${totalTime}s`);
  console.log(`  Speed: ${(eventsUpdated / parseFloat(totalTime)).toFixed(1)} events/sec`);

  // Show remaining count
  const [[{ remaining }]] = await pool.query(
    'SELECT COUNT(*) as remaining FROM spill_event WHERE rain_24h_mm IS NULL'
  );
  console.log(`  Still missing rainfall: ${remaining}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('[Backfill Rainfall] Fatal error:', err);
  process.exit(1);
});
