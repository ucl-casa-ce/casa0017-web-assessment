-- MySQL dump 10.13  Distrib 26.7.0, for Linux (x86_64)
--
-- Host: localhost    Database: rain_to_spill
-- ------------------------------------------------------
-- Server version	26.7.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '32b1e452-cc95-11f1-a06d-ca3907f6fac3:1-20';

--
-- Table structure for table `outfall_gauge`
--

DROP TABLE IF EXISTS `outfall_gauge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outfall_gauge` (
  `outfall_id` varchar(50) NOT NULL,
  `gauge_id` varchar(50) NOT NULL,
  `distance_km` decimal(6,2) DEFAULT NULL,
  PRIMARY KEY (`outfall_id`,`gauge_id`),
  CONSTRAINT `fk_gauge_outfall` FOREIGN KEY (`outfall_id`) REFERENCES `outfalls` (`permit_number`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outfall_gauge`
--

LOCK TABLES `outfall_gauge` WRITE;
/*!40000 ALTER TABLE `outfall_gauge` DISABLE KEYS */;
/*!40000 ALTER TABLE `outfall_gauge` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `outfalls`
--

DROP TABLE IF EXISTS `outfalls`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outfalls` (
  `permit_number` varchar(50) NOT NULL,
  `location_name` varchar(255) NOT NULL,
  `receiving_watercourse` varchar(100) NOT NULL,
  `easting` decimal(10,2) DEFAULT NULL,
  `northing` decimal(10,2) DEFAULT NULL,
  `lat` decimal(10,6) DEFAULT NULL,
  `lng` decimal(10,6) DEFAULT NULL,
  `is_discharging` tinyint(1) DEFAULT '0',
  `most_recent_start` datetime DEFAULT NULL,
  `most_recent_stop` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`permit_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `outfalls`
--

LOCK TABLES `outfalls` WRITE;
/*!40000 ALTER TABLE `outfalls` DISABLE KEYS */;
/*!40000 ALTER TABLE `outfalls` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `rain_reading`
--

DROP TABLE IF EXISTS `rain_reading`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rain_reading` (
  `gauge_id` varchar(50) NOT NULL,
  `ts` datetime NOT NULL,
  `mm` decimal(6,2) NOT NULL,
  PRIMARY KEY (`gauge_id`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rain_reading`
--

LOCK TABLES `rain_reading` WRITE;
/*!40000 ALTER TABLE `rain_reading` DISABLE KEYS */;
/*!40000 ALTER TABLE `rain_reading` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `spill_event`
--

DROP TABLE IF EXISTS `spill_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `spill_event` (
  `id` int NOT NULL AUTO_INCREMENT,
  `outfall_id` varchar(50) NOT NULL,
  `start_ts` datetime NOT NULL,
  `end_ts` datetime DEFAULT NULL,
  `rain_24h_mm` decimal(6,2) DEFAULT NULL,
  `tidal_phase_at_start` varchar(20) DEFAULT NULL,
  `is_tidally_trapped` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_outfall_start` (`outfall_id`,`start_ts`),
  CONSTRAINT `fk_spill_outfall` FOREIGN KEY (`outfall_id`) REFERENCES `outfalls` (`permit_number`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `spill_event`
--

LOCK TABLES `spill_event` WRITE;
/*!40000 ALTER TABLE `spill_event` DISABLE KEYS */;
/*!40000 ALTER TABLE `spill_event` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tidal_reading`
--

DROP TABLE IF EXISTS `tidal_reading`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tidal_reading` (
  `station_id` varchar(50) NOT NULL,
  `ts` datetime NOT NULL,
  `level_maod` decimal(6,3) NOT NULL,
  PRIMARY KEY (`station_id`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tidal_reading`
--

LOCK TABLES `tidal_reading` WRITE;
/*!40000 ALTER TABLE `tidal_reading` DISABLE KEYS */;
INSERT INTO `tidal_reading` VALUES ('0001','2026-10-20 12:30:00',-1.152),('0001','2026-10-20 12:45:00',-1.219),('0001','2026-10-20 13:00:00',-1.263),('0001','2026-10-20 13:15:00',-1.287),('0001','2026-10-20 13:30:00',-1.306),('0001','2026-10-20 13:45:00',-1.306),('0001','2026-10-20 14:00:00',-1.288),('0001','2026-10-20 14:15:00',-1.259),('0001','2026-10-20 14:30:00',-1.236),('0001','2026-10-20 14:45:00',-1.210),('0001','2026-10-20 15:00:00',-1.153),('0001','2026-10-20 15:15:00',-1.083),('0001','2026-10-20 15:30:00',-1.024),('0001','2026-10-22 11:45:00',1.109),('0001','2026-10-22 12:00:00',0.838),('0001','2026-10-22 12:15:00',0.584),('0001','2026-10-22 12:30:00',0.358),('0001','2026-10-22 12:45:00',0.113),('0001','2026-10-22 13:00:00',-0.117),('0001','2026-10-22 13:15:00',-0.330),('0001','2026-10-22 13:30:00',-0.522),('0001','2026-10-22 13:45:00',-0.734),('0001','2026-10-22 14:00:00',-0.919),('0001','2026-10-22 14:15:00',-1.082),('0001','2026-10-22 14:30:00',-1.226),('0001','2026-10-22 14:45:00',-1.340),('0001','2026-10-22 15:00:00',-1.444),('0001','2026-10-22 15:15:00',-1.516),('0001','2026-10-22 15:30:00',-1.558),('0001','2026-10-22 15:45:00',-1.607),('0001','2026-10-22 16:00:00',-1.649),('0001','2026-10-22 16:15:00',-1.669),('0001','2026-10-22 16:30:00',-1.673),('0001','2026-10-22 16:45:00',-1.644),('0001','2026-10-22 17:00:00',-1.615),('0001','2026-10-22 17:15:00',-1.573),('0001','2026-10-22 17:30:00',-1.502);
/*!40000 ALTER TABLE `tidal_reading` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-23  9:58:54
