import cron from 'node-cron';
import config from '../config/env.js';
import { fetchDischargeStatus } from '../services/thamesWater.service.js';
import { fetchTidalStatus, fetchRainfallStatus } from '../services/eaFlood.service.js';
import { emitIngestionUpdate } from '../sockets/socket.js';

export function initIngestionCron() {
  console.log(`[JOBS] Initializing ingestion cron job with schedule: ${config.cron.schedule}`);

  const runIngestion = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[JOBS] Starting scheduled data ingestion at ${timestamp}`);

    try {
      const [discharge, tidal, rainfall] = await Promise.all([
        fetchDischargeStatus(),
        fetchTidalStatus(),
        fetchRainfallStatus()
      ]);

      const emitted = emitIngestionUpdate({ discharge, tidal, rainfall });

      console.log(`[JOBS] Ingestion complete. Discharge source: [${discharge.source}], Tidal source: [${tidal.source}], Rainfall source: [${rainfall.source}], Socket emitted: [${emitted}]`);
    } catch (error) {
      console.error('[JOBS] Error during scheduled data ingestion:', error.message);
    }
  };

  console.log('[JOBS] Forcing initial ingestion run...');
  runIngestion();

  // schedule all subsequent runs
  cron.schedule(config.cron.schedule, runIngestion);
}

if (process.argv[1].endsWith('startIngestion.js')) {
    initIngestionCron();
}