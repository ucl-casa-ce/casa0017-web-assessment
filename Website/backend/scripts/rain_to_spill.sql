USE rain_to_spill;

CREATE TABLE IF NOT EXISTS tidal_reading (
    station_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    level_maod DECIMAL(6, 3) NOT NULL,
    PRIMARY KEY (station_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rain_reading (
    gauge_id VARCHAR(50) NOT NULL,
    ts DATETIME NOT NULL,
    mm DECIMAL(6, 2) NOT NULL,
    PRIMARY KEY (gauge_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outfalls (
    permit_number VARCHAR(50) PRIMARY KEY,
    location_name VARCHAR(255) NOT NULL,
    receiving_watercourse VARCHAR(100) NOT NULL,
    easting DECIMAL(10, 2),
    northing DECIMAL(10, 2),
    lat DECIMAL(10, 6),
    lng DECIMAL(10, 6),
    is_discharging TINYINT(1) DEFAULT 0,
    most_recent_start DATETIME NULL,
    most_recent_stop DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS spill_event (
    id INT AUTO_INCREMENT PRIMARY KEY,
    outfall_id VARCHAR(50) NOT NULL,
    start_ts DATETIME NOT NULL,
    end_ts DATETIME NULL,
    rain_24h_mm DECIMAL(6, 2) NULL,
    tidal_phase_at_start VARCHAR(20) NULL,
    is_tidally_trapped TINYINT(1) DEFAULT 0,
    INDEX idx_outfall_start (outfall_id, start_ts),
    CONSTRAINT fk_spill_outfall
        FOREIGN KEY (outfall_id) REFERENCES outfalls(permit_number)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outfall_gauge (
    outfall_id VARCHAR(50) NOT NULL,
    gauge_id VARCHAR(50) NOT NULL,
    distance_km DECIMAL(6, 2) NULL,
    PRIMARY KEY (outfall_id, gauge_id),
    CONSTRAINT fk_gauge_outfall
        FOREIGN KEY (outfall_id) REFERENCES outfalls(permit_number)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;