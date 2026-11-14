import cron from 'node-cron';
import RIVER from '../config/river.js';
import { getRiverInputs } from '../services/riverInputs.service.js';
import { runModel } from '../services/riverModel.service.js';
import { checkSubscribers } from '../services/riverAlerts.service.js';
import { subscribers, sightings, pruneMessages } from '../db/queries/river.queries.js';

/** Run the river model on fresh inputs, send WhatsApp updates, tidy old records. */
export async function runRiverAlerts() {
  try {
    const inputs = await getRiverInputs({ force: true });
    const model = runModel(inputs);
    const sent = await checkSubscribers(model);
    await subscribers.purgePending(RIVER.alerts.pendingExpiryHours * 3600e3);
    await sightings.purge(RIVER.sightings.retainDays * 86400e3);
    await pruneMessages();
    console.log(`[JOBS] River model ok: ${model.sites.length} overflows, ${sent} WhatsApp updates${inputs.problems.length ? `, gaps: ${inputs.problems.join(', ')}` : ''}${RIVER.dryRun ? ' (DRY_RUN)' : ''}`);
  } catch (err) {
    console.error('[JOBS] River model run failed:', err.message);
  }
}

export function initRiverAlertsCron() {
  if (!RIVER.alerts.enabled) return console.log('[JOBS] River alerts disabled (RIVER_ALERTS_ENABLED=false)');
  console.log(`[JOBS] River alerts schedule: ${RIVER.alerts.schedule}`);
  runRiverAlerts();
  cron.schedule(RIVER.alerts.schedule, runRiverAlerts);
}
