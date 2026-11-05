/**
 * Database initialization script
 * Run with: npm run db:init
 */
import { pool } from './db.js';

const TABLES = [
  // Outfalls table - sewage discharge points
  `CREATE TABLE IF NOT EXISTS outfalls (
    permit_number VARCHAR(50) PRIMARY KEY,
    location_name VARCHAR(255) NOT NULL,
    receiving_watercourse VARCHAR(100) NOT NULL,
    easting DECIMAL(10,2),
    northing DECIMAL(10,2),
    lat DECIMAL(10,6),
    lng DECIMAL(10,6),
    is_discharging TINYINT(1) DEFAULT 0,
    most_recent_start DATETIME,
    most_recent_stop DATETIME,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_watercourse (receiving_watercourse),
    INDEX idx_discharging (is_discharging)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Rain readings from EA gauges
  `CREATE TABLE IF NOT EXISTS rain_reading (
    gauge_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    mm DECIMAL(6,2) NOT NULL,
    PRIMARY KEY (gauge_id, ts),
    INDEX idx_ts (ts)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Tidal readings from EA stations
  `CREATE TABLE IF NOT EXISTS tidal_reading (
    station_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    level_maod DECIMAL(6,3) NOT NULL,
    PRIMARY KEY (station_id, ts),
    INDEX idx_ts (ts)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Spill events - detected discharge events with context
  `CREATE TABLE IF NOT EXISTS spill_event (
    id INT AUTO_INCREMENT PRIMARY KEY,
    outfall_id VARCHAR(50) NOT NULL,
    start_ts DATETIME NOT NULL,
    end_ts DATETIME,
    rain_24h_mm DECIMAL(6,2),
    rain_48h_mm DECIMAL(6,2),
    rain_72h_mm DECIMAL(6,2),
    tidal_phase_at_start VARCHAR(20),
    is_tidally_trapped TINYINT(1) DEFAULT 0,
    INDEX idx_outfall_start (outfall_id, start_ts),
    INDEX idx_start (start_ts),
    FOREIGN KEY (outfall_id) REFERENCES outfalls(permit_number) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Rain gauge stations from EA
  `CREATE TABLE IF NOT EXISTS rain_gauge (
    station_id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(255),
    lat DECIMAL(10,6),
    lng DECIMAL(10,6),
    easting DECIMAL(10,2),
    northing DECIMAL(10,2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_location (lat, lng)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Outfall to gauge pairing
  `CREATE TABLE IF NOT EXISTS outfall_gauge (
    outfall_id VARCHAR(50) NOT NULL,
    gauge_id VARCHAR(50) NOT NULL,
    distance_km DECIMAL(6,2),
    PRIMARY KEY (outfall_id, gauge_id),
    FOREIGN KEY (outfall_id) REFERENCES outfalls(permit_number) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // River flow monitoring stations from EA
  `CREATE TABLE IF NOT EXISTS flow_station (
    station_id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(255),
    river_name VARCHAR(100),
    catchment_name VARCHAR(100),
    lat DECIMAL(10,6),
    lng DECIMAL(10,6),
    easting DECIMAL(10,2),
    northing DECIMAL(10,2),
    date_opened DATE,
    status VARCHAR(20),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_river (river_name),
    INDEX idx_location (lat, lng)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // River flow readings (m³/s)
  `CREATE TABLE IF NOT EXISTS flow_reading (
    station_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    flow_cumecs DECIMAL(10,4) NOT NULL,
    PRIMARY KEY (station_id, ts),
    INDEX idx_ts (ts)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Groundwater monitoring stations from EA
  `CREATE TABLE IF NOT EXISTS groundwater_station (
    station_id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(255),
    catchment_name VARCHAR(100),
    lat DECIMAL(10,6),
    lng DECIMAL(10,6),
    easting DECIMAL(10,2),
    northing DECIMAL(10,2),
    date_opened DATE,
    status VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_location (lat, lng)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Groundwater level readings (mAOD)
  `CREATE TABLE IF NOT EXISTS groundwater_reading (
    station_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    level_maod DECIMAL(8,3) NOT NULL,
    PRIMARY KEY (station_id, ts),
    INDEX idx_ts (ts)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function initDatabase() {
  console.log('[DB:INIT] Starting database initialization...\n');

  for (const sql of TABLES) {
    const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
    try {
      await pool.query(sql);
      console.log(`[DB:INIT] ✓ Table "${tableName}" ready`);
    } catch (err) {
      console.error(`[DB:INIT] ✗ Failed to create "${tableName}":`, err.message);
    }
  }

  console.log('\n[DB:INIT] Database initialization complete');
  process.exit(0);
}

initDatabase().catch((err) => {
  console.error('[DB:INIT] Fatal error:', err);
  process.exit(1);
});
