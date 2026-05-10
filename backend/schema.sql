-- =============================================================================
-- Nailed — database schema (MySQL 8.0+)
-- =============================================================================
-- Idempotent: safe to run multiple times. Uses CREATE TABLE IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- users
-- One row per human. Auth identities (Google/Vipps) are linked separately.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email                    VARCHAR(255) NOT NULL,
  name                     VARCHAR(255) NOT NULL,
  phone                    VARCHAR(32) DEFAULT NULL,
  birth_year               SMALLINT UNSIGNED DEFAULT NULL,
  address_line             VARCHAR(255) DEFAULT NULL,
  postal_code              VARCHAR(16) DEFAULT NULL,
  city                     VARCHAR(128) DEFAULT NULL,
  role                     ENUM('user','salon_owner','admin') NOT NULL DEFAULT 'user',
  notify_email_bookings    TINYINT(1) NOT NULL DEFAULT 1,
  notify_email_reminders   TINYINT(1) NOT NULL DEFAULT 1,
  notify_sms_reminders     TINYINT(1) NOT NULL DEFAULT 0,
  notify_marketing         TINYINT(1) NOT NULL DEFAULT 0,
  suspended_at             DATETIME DEFAULT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- auth_identities
-- A user can have multiple linked identities (Google + Vipps). The pair
-- (provider, subject) is globally unique.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_identities (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  provider        ENUM('google','vipps') NOT NULL,
  subject         VARCHAR(255) NOT NULL,
  email_at_link   VARCHAR(255) DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_provider_subject (provider, subject),
  KEY idx_user (user_id),
  CONSTRAINT fk_auth_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions (refresh tokens)
-- Opaque refresh-token storage. token_hash = sha256(token).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  token_hash      CHAR(64) NOT NULL,
  user_agent      VARCHAR(512) DEFAULT NULL,
  ip              VARCHAR(64) DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME NOT NULL,
  revoked_at      DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_token_hash (token_hash),
  KEY idx_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- oauth_states
-- Short-lived state + PKCE verifier for OIDC flows. Cleaned up by /callback.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  state           CHAR(64) NOT NULL,
  provider        ENUM('google','vipps') NOT NULL,
  code_verifier   VARCHAR(128) NOT NULL,
  redirect_after  VARCHAR(512) DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME NOT NULL,
  PRIMARY KEY (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salons
-- Created when a salon application is approved. Owner = the applying user.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salons (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id   BIGINT UNSIGNED NOT NULL,
  slug            VARCHAR(128) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  bio             TEXT DEFAULT NULL,
  city            VARCHAR(128) NOT NULL,
  address_line    VARCHAR(255) DEFAULT NULL,
  postal_code     VARCHAR(16) DEFAULT NULL,
  lat             DECIMAL(9,6) DEFAULT NULL,
  lng             DECIMAL(9,6) DEFAULT NULL,
  instagram_url   VARCHAR(512) DEFAULT NULL,
  tiktok_url      VARCHAR(512) DEFAULT NULL,
  facebook_url    VARCHAR(512) DEFAULT NULL,
  website_url     VARCHAR(512) DEFAULT NULL,
  cover_image_key VARCHAR(255) DEFAULT NULL,
  public_phone_visible TINYINT(1) NOT NULL DEFAULT 0,
  accepts_new_bookings TINYINT(1) NOT NULL DEFAULT 1,
  status          ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_slug (slug),
  KEY idx_owner (owner_user_id),
  KEY idx_city (city),
  CONSTRAINT fk_salons_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salon_applications
-- A user applies to become a salon owner. Admin reviews and approves/rejects.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_applications (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  applicant_user_id BIGINT UNSIGNED NOT NULL,
  salon_name        VARCHAR(255) NOT NULL,
  city              VARCHAR(128) NOT NULL,
  address_line      VARCHAR(255) DEFAULT NULL,
  postal_code       VARCHAR(16) DEFAULT NULL,
  instagram_url     VARCHAR(512) DEFAULT NULL,
  tiktok_url        VARCHAR(512) DEFAULT NULL,
  facebook_url      VARCHAR(512) DEFAULT NULL,
  website_url       VARCHAR(512) DEFAULT NULL,
  application_text  TEXT NOT NULL,
  status            ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  reviewer_user_id  BIGINT UNSIGNED DEFAULT NULL,
  reviewer_notes    TEXT DEFAULT NULL,
  decided_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_applicant (applicant_user_id),
  KEY idx_status (status, created_at),
  CONSTRAINT fk_app_applicant FOREIGN KEY (applicant_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_reviewer  FOREIGN KEY (reviewer_user_id)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- services
-- A salon offers one or more services.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id        BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT DEFAULT NULL,
  duration_min    SMALLINT UNSIGNED NOT NULL,
  price_nok       INT UNSIGNED NOT NULL,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salon (salon_id, active),
  CONSTRAINT fk_services_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- bookings
-- A customer books a service at a salon. Status flows pending -> confirmed
-- -> completed | cancelled | no_show.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_user_id    BIGINT UNSIGNED NOT NULL,
  salon_id            BIGINT UNSIGNED NOT NULL,
  service_id          BIGINT UNSIGNED NOT NULL,
  start_at            DATETIME NOT NULL,
  end_at              DATETIME NOT NULL,
  price_nok           INT UNSIGNED NOT NULL,
  status              ENUM('pending','confirmed','completed','cancelled','no_show') NOT NULL DEFAULT 'pending',
  customer_note       TEXT DEFAULT NULL,
  cancelled_at        DATETIME DEFAULT NULL,
  cancelled_by_role   ENUM('customer','salon','admin') DEFAULT NULL,
  completed_at        DATETIME DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer (customer_user_id, start_at),
  KEY idx_salon (salon_id, start_at),
  KEY idx_status (status, start_at),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_salon    FOREIGN KEY (salon_id)         REFERENCES salons(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_service  FOREIGN KEY (service_id)       REFERENCES services(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- favorites
-- A user marks a salon as a favorite.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  user_id     BIGINT UNSIGNED NOT NULL,
  salon_id    BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, salon_id),
  KEY idx_salon (salon_id),
  CONSTRAINT fk_favorites_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_favorites_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- reviews
-- One review per booking. Customer rates the salon after completion.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id        BIGINT UNSIGNED NOT NULL,
  customer_user_id  BIGINT UNSIGNED NOT NULL,
  salon_id          BIGINT UNSIGNED NOT NULL,
  rating            TINYINT UNSIGNED NOT NULL,
  body              TEXT DEFAULT NULL,
  hidden_at         DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_booking (booking_id),
  KEY idx_salon (salon_id, created_at),
  CONSTRAINT fk_reviews_booking  FOREIGN KEY (booking_id)       REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_user_id) REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_reviews_salon    FOREIGN KEY (salon_id)         REFERENCES salons(id)   ON DELETE CASCADE,
  CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salon_images
-- Gallery images for a salon. cover_image_key on salons points at one of these
-- (kept on salons too for fast public-page render without an extra join).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_images (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id    BIGINT UNSIGNED NOT NULL,
  image_key   VARCHAR(255) NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  width       SMALLINT UNSIGNED DEFAULT NULL,
  height      SMALLINT UNSIGNED DEFAULT NULL,
  bytes       INT UNSIGNED DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salon (salon_id, position),
  CONSTRAINT fk_salon_images_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- audit_log
-- Append-only record of admin actions and sensitive state transitions.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED DEFAULT NULL,
  action        VARCHAR(64) NOT NULL,
  entity_type   VARCHAR(64) NOT NULL,
  entity_id     BIGINT UNSIGNED DEFAULT NULL,
  meta_json     JSON DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_entity (entity_type, entity_id),
  KEY idx_actor (actor_user_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Idempotent in-place migrations
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS requires MySQL 8.0.29+. Hostinger
-- Cloud runs 8.0.x; Hostinger MariaDB does not (avoid MariaDB).
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_email_bookings  TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_email_reminders TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_sms_reminders   TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notify_marketing       TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS public_phone_visible  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepts_new_bookings  TINYINT(1) NOT NULL DEFAULT 1;
