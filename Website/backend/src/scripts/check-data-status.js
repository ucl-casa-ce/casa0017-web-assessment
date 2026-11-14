/**
 * Check database data status for gap analysis
 */

import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection({
    host: 'gateway01.us-west-2.prod.aws.tidbcloud.com',
    port: 4000,
    user: '26ki3WAdLdUjqmn.root',
    password: 'AMeGkg1R9Bv470Gh',
    database: 'casa0017_sewage',
    ssl: { rejectUnauthorized: true }
  });

  console.log('=== DATABASE STATUS ===\n');

  // Table row counts
  const tables = ['outfalls', 'spill_event', 'rain_gauge', 'outfall_gauge', 'rain_reading', 'tidal_reading'];
  for (const t of tables) {
    try {
      const [[{ count }]] = await conn.query('SELECT COUNT(*) as count FROM ??', [t]);
      console.log(`${t}: ${count} rows`);
    } catch (e) {
      console.log(`${t}: TABLE NOT FOUND`);
    }
  }

  console.log('\n=== SPILL EVENT ENRICHMENT STATUS ===\n');

  // Check how many spill events have enrichment data
  const [[enriched]] = await conn.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN rain_24h_mm IS NOT NULL THEN 1 ELSE 0 END) as has_rainfall,
      SUM(CASE WHEN tidal_phase_at_start IS NOT NULL THEN 1 ELSE 0 END) as has_tidal
    FROM spill_event
  `);
  console.log('Total spill events:', enriched.total);
  console.log('With rainfall data:', enriched.has_rainfall, `(${Math.round(enriched.has_rainfall / enriched.total * 100)}%)`);
  console.log('With tidal phase:', enriched.has_tidal, `(${Math.round(enriched.has_tidal / enriched.total * 100)}%)`);

  console.log('\n=== OUTFALL-GAUGE PAIRING STATUS ===\n');

  // Check outfall-gauge pairings
  const [[pairing]] = await conn.query(`
    SELECT
      COUNT(DISTINCT o.permit_number) as total_outfalls,
      COUNT(DISTINCT og.outfall_id) as paired_outfalls
    FROM outfalls o
    LEFT JOIN outfall_gauge og ON o.permit_number = og.outfall_id
  `);
  console.log('Total outfalls:', pairing.total_outfalls);
  console.log('Paired with gauge:', pairing.paired_outfalls);

  console.log('\n=== DATE RANGE OF DATA ===\n');

  // Spill event date range
  const [[dateRange]] = await conn.query(`
    SELECT MIN(start_ts) as earliest, MAX(start_ts) as latest FROM spill_event
  `);
  console.log('Spill events:', dateRange.earliest, 'to', dateRange.latest);

  // Rain reading date range
  const [[rainRange]] = await conn.query(`
    SELECT MIN(ts) as earliest, MAX(ts) as latest FROM rain_reading
  `);
  console.log('Rain readings:', rainRange.earliest || 'NONE', 'to', rainRange.latest || 'NONE');

  // Tidal reading date range
  const [[tidalRange]] = await conn.query(`
    SELECT MIN(ts) as earliest, MAX(ts) as latest FROM tidal_reading
  `);
  console.log('Tidal readings:', tidalRange.earliest || 'NONE', 'to', tidalRange.latest || 'NONE');

  console.log('\n=== LONDON OUTFALLS BREAKDOWN ===\n');

  // London outfalls by watercourse
  const [watercourses] = await conn.query(`
    SELECT receiving_watercourse, COUNT(*) as count
    FROM outfalls
    WHERE receiving_watercourse IS NOT NULL
    GROUP BY receiving_watercourse
    ORDER BY count DESC
    LIMIT 10
  `);
  console.log('Outfalls by watercourse:');
  watercourses.forEach(w => console.log(`  ${w.receiving_watercourse}: ${w.count}`));

  console.log('\n=== SAMPLE SPILL EVENTS (London outfalls) ===\n');

  // Sample spill events with enrichment
  const [samples] = await conn.query(`
    SELECT
      se.outfall_id,
      o.location_name,
      se.start_ts,
      se.end_ts,
      se.rain_24h_mm,
      se.tidal_phase_at_start
    FROM spill_event se
    JOIN outfalls o ON se.outfall_id = o.permit_number
    WHERE o.receiving_watercourse LIKE '%Thames%' OR o.receiving_watercourse LIKE '%Lee%'
    ORDER BY se.start_ts DESC
    LIMIT 5
  `);
  console.log('Recent London spill events:');
  samples.forEach(s => {
    console.log(`  ${s.location_name}`);
    console.log(`    Start: ${s.start_ts}, Rain: ${s.rain_24h_mm ?? 'N/A'}, Tide: ${s.tidal_phase_at_start ?? 'N/A'}`);
  });

  await conn.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
