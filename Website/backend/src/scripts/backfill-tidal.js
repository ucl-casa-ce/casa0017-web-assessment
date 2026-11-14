/**
 * Backfill tidal phase data for spill events
 *
 * Run with: node src/scripts/backfill-tidal.js [--limit N] [--batch N]
 *
 * This script:
 * 1. Finds spill events missing tidal_phase_at_start data
 * 2. Calculates tidal phase using astronomical calculation
 * 3. Updates spill_event records with phase and is_tidally_trapped flag
 */

import { pool } from '../db/db.js';
import { calculateTidalPhase } from '../services/historicalTide.service.js';

// Parse command line args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const batchIdx = args.indexOf('--batch');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10000;
const BATCH_SIZE = batchIdx !== -1 ? parseInt(args[batchIdx + 1], 10) : 1000;

async function main() {
  console.log('[Backfill Tidal] Starting...\n');
  console.log(`  Limit: ${LIMIT} events`);
  console.log(`  Batch size: ${BATCH_SIZE}\n`);

  // Get spill events missing tidal phase data
  const [events] = await pool.query(`
    SELECT id, start_ts
    FROM spill_event
    WHERE tidal_phase_at_start IS NULL
    ORDER BY start_ts DESC
    LIMIT ?
  `, [LIMIT]);

  console.log(`[Backfill Tidal] Found ${events.length} events to process\n`);

  if (events.length === 0) {
    console.log('[Backfill Tidal] No events need tidal phase data.');
    await pool.end();
    return;
  }

  let processed = 0;
  let floodCount = 0;
  let ebbCount = 0;

  // Process in batches for efficient DB updates
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);

    // Calculate phases for batch
    const updates = batch.map(event => {
      const phase = calculateTidalPhase(new Date(event.start_ts));
      const isTidallyTrapped = phase === 'FLOOD' ? 1 : 0;

      if (phase === 'FLOOD') floodCount++;
      else ebbCount++;

      return [phase, isTidallyTrapped, event.id];
    });

    // Batch update using CASE statement for efficiency
    const sql = `
      UPDATE spill_event
      SET
        tidal_phase_at_start = CASE id ${updates.map(() => 'WHEN ? THEN ?').join(' ')} END,
        is_tidally_trapped = CASE id ${updates.map(() => 'WHEN ? THEN ?').join(' ')} END
      WHERE id IN (${updates.map(() => '?').join(',')})
    `;

    // Build params: [id, phase, id, phase, ...] for first CASE, [id, trapped, ...] for second, [ids...] for WHERE
    const caseParams1 = updates.flatMap(([phase, , id]) => [id, phase]);
    const caseParams2 = updates.flatMap(([, trapped, id]) => [id, trapped]);
    const whereParams = updates.map(([, , id]) => id);

    await pool.query(sql, [...caseParams1, ...caseParams2, ...whereParams]);

    processed += batch.length;

    // Progress update
    const pct = Math.round((i + batch.length) / events.length * 100);
    console.log(`[Backfill Tidal] Progress: ${i + batch.length}/${events.length} (${pct}%)`);
  }

  console.log('\n[Backfill Tidal] Complete!');
  console.log(`  Total processed: ${processed}`);
  console.log(`  FLOOD (tidally trapped): ${floodCount} (${Math.round(floodCount/processed*100)}%)`);
  console.log(`  EBB (flushed): ${ebbCount} (${Math.round(ebbCount/processed*100)}%)`);

  // Show remaining count
  const [[{ remaining }]] = await pool.query(
    'SELECT COUNT(*) as remaining FROM spill_event WHERE tidal_phase_at_start IS NULL'
  );
  console.log(`  Still missing tidal phase: ${remaining}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('[Backfill Tidal] Fatal error:', err);
  process.exit(1);
});
