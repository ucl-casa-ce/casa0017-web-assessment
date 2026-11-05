-- TiDB-compatible schema for casa0017_sewage

CREATE TABLE IF NOT EXISTS `outfalls` (
  `permit_number` varchar(50) NOT NULL,
  `location_name` varchar(255) NOT NULL,
  `receiving_watercourse` varchar(100) NOT NULL,
  `easting` decimal(10,2) DEFAULT NULL,
  `northing` decimal(10,2) DEFAULT NULL,
  `lat` decimal(10,6) DEFAULT NULL,
  `lng` decimal(10,6) DEFAULT NULL,
  `is_discharging` tinyint(1) DEFAULT 0,
  `most_recent_start` datetime DEFAULT NULL,
  `most_recent_stop` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`permit_number`)
);

CREATE TABLE IF NOT EXISTS `outfall_gauge` (
  `outfall_id` varchar(50) NOT NULL,
  `gauge_id` varchar(50) NOT NULL,
  `distance_km` decimal(6,2) DEFAULT NULL,
  PRIMARY KEY (`outfall_id`,`gauge_id`),
  CONSTRAINT `fk_gauge_outfall` FOREIGN KEY (`outfall_id`) REFERENCES `outfalls` (`permit_number`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `rain_reading` (
  `gauge_id` varchar(50) NOT NULL,
  `ts` datetime NOT NULL,
  `mm` decimal(6,2) NOT NULL,
  PRIMARY KEY (`gauge_id`,`ts`)
);

CREATE TABLE IF NOT EXISTS `spill_event` (
  `id` int NOT NULL AUTO_INCREMENT,
  `outfall_id` varchar(50) NOT NULL,
  `start_ts` datetime NOT NULL,
  `end_ts` datetime DEFAULT NULL,
  `rain_24h_mm` decimal(6,2) DEFAULT NULL,
  `tidal_phase_at_start` varchar(20) DEFAULT NULL,
  `is_tidally_trapped` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_outfall_start` (`outfall_id`,`start_ts`),
  CONSTRAINT `fk_spill_outfall` FOREIGN KEY (`outfall_id`) REFERENCES `outfalls` (`permit_number`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `tidal_reading` (
  `station_id` varchar(50) NOT NULL,
  `ts` datetime NOT NULL,
  `level_maod` decimal(6,3) NOT NULL,
  PRIMARY KEY (`station_id`,`ts`)
);
