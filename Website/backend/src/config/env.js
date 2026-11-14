import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(import.meta.dirname, '../../.env')
});

const REQUIRED_ENV_VARS = ['DB_HOST', 'DB_USER', 'DB_NAME'];

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    ssl: process.env.DB_SSL === 'true'
  },
  apis: {
    thamesWaterBaseUrl:
      process.env.THAMES_WATER_BASE_URL || 'https://api.thameswater.co.uk/opendata/v2',
    eaFloodBaseUrl:
      process.env.EA_FLOOD_BASE_URL || 'https://environment.data.gov.uk/flood-monitoring',
    timeoutMs: Number(process.env.API_TIMEOUT_MS) || 8000
  },
  cron: {
    enabled: process.env.CRON_ENABLED !== 'false',
    schedule: process.env.CRON_SCHEDULE || '*/15 * * * *'
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
  }
});

export default config;
