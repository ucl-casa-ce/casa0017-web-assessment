import app from './app.js';
import config from './config/env.js';
import { testConnection } from './db/db.js';
import { initIngestionCron } from './jobs/startIngestion.js';
import http from 'node:http';
import { initSocket } from './sockets/socket.js';
import { ensureRiverTables } from './db/initRiver.js';
import { initRiverAlertsCron } from './jobs/riverAlerts.js';

async function startServer() {
  try {
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Database ping failed');
    }
    console.log('Database connection pool established successfully.');

    // Live map (river users): river_* tables + model run / WhatsApp updates (RIVER_ALERTS_ENABLED)
    await ensureRiverTables();
    initRiverAlertsCron();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    if (config.cron.enabled) {
      initIngestionCron();
    } else {
      console.log('[JOBS] Ingestion cron disabled (CRON_ENABLED=false)');
    }

    httpServer.listen(config.port, () => {
      console.log('Server and WebSockets listening...')
    })

    // app.listen(config.port, () => {
    //   console.log(`Server listening on port ${config.port} in [${config.nodeEnv}] mode.`);
    // });


  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();