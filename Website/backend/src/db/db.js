import mysql from 'mysql2/promise';
import config from '../config/env.js';

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  timezone: 'Z',
  decimalNumbers: true,
  ssl: config.db.ssl ? { rejectUnauthorized: true } : false
});

async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('[DB] Connected to database');
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    return false;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

export { pool, testConnection };
