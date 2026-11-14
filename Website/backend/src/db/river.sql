-- Tables for the river-user features. Created automatically at start-up
-- (src/db/initRiver.js) so existing database volumes don't need re-seeding.
-- No IP addresses are stored anywhere.

CREATE TABLE IF NOT EXISTS river_subscriber (
  phone          VARCHAR(16)  NOT NULL,       -- E.164 digits, no '+'
  lon            DOUBLE       NOT NULL,
  lat            DOUBLE       NOT NULL,
  chainage_km    DOUBLE       NOT NULL,       -- position along the modelled Thames
  place          VARCHAR(100) NOT NULL,
  name           VARCHAR(40)  DEFAULT NULL,
  radius_km      DOUBLE       NOT NULL,
  threshold      ENUM('low','moderate','high') NOT NULL,
  activity       VARCHAR(40)  DEFAULT NULL,
  status         ENUM('pending','active') NOT NULL,
  created_at     BIGINT       NOT NULL,
  confirmed_at   BIGINT       DEFAULT NULL,
  last_alert_at  BIGINT       DEFAULT NULL,
  last_status    VARCHAR(10)  DEFAULT NULL,
  pending_status VARCHAR(10)  DEFAULT NULL,
  pending_since  BIGINT       DEFAULT NULL,
  warned_status  VARCHAR(10)  DEFAULT NULL,
  optin_sends    INT          NOT NULL DEFAULT 0,
  optin_day      CHAR(10)     DEFAULT NULL,
  PRIMARY KEY (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS river_sighting (
  id            INT          NOT NULL AUTO_INCREMENT,
  lon           DOUBLE       NOT NULL,
  lat           DOUBLE       NOT NULL,
  chainage_km   DOUBLE       DEFAULT NULL,
  off_river_km  DOUBLE       DEFAULT NULL,
  place         VARCHAR(100) DEFAULT NULL,
  types         JSON         NOT NULL,
  severity      TINYINT      NOT NULL,
  note          VARCHAR(280) DEFAULT NULL,
  observed_at   BIGINT       NOT NULL,
  created_at    BIGINT       NOT NULL,
  hidden        TINYINT(1)   NOT NULL DEFAULT 0,  -- set by a moderator; never deleted silently
  PRIMARY KEY (id),
  KEY idx_observed (observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS river_wa_message (
  wamid        VARCHAR(128) NOT NULL,         -- WhatsApp message id (webhook retries can repeat)
  received_at  BIGINT       NOT NULL,
  PRIMARY KEY (wamid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
