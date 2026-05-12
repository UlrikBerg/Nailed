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
  cancellation_lead_hours    SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  booking_window_days        SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  min_booking_lead_hours     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  booking_buffer_min         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
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
-- service_categories
-- Owner-defined groups for the salon's services (e.g. "Vipper", "Negler").
-- Used by the public salon page to render services grouped by category.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  position    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salon (salon_id, position),
  CONSTRAINT fk_svccat_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- services
-- A salon offers one or more services.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id        BIGINT UNSIGNED NOT NULL,
  category_id     BIGINT UNSIGNED DEFAULT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT DEFAULT NULL,
  duration_min    SMALLINT UNSIGNED NOT NULL,
  price_nok       INT UNSIGNED NOT NULL,
  is_popular      TINYINT(1) NOT NULL DEFAULT 0,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salon (salon_id, active),
  KEY idx_category (category_id),
  CONSTRAINT fk_services_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
  CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL
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
-- salon_hours
-- Opening hours per weekday. Weekday uses ISO 8601: 1=Monday … 7=Sunday.
-- A row with is_closed=1 means the salon is closed that day.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_hours (
  salon_id    BIGINT UNSIGNED NOT NULL,
  weekday     TINYINT UNSIGNED NOT NULL,
  is_closed   TINYINT(1) NOT NULL DEFAULT 0,
  open_at     TIME DEFAULT NULL,
  close_at    TIME DEFAULT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (salon_id, weekday),
  CONSTRAINT fk_hours_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
  CONSTRAINT chk_hours_weekday CHECK (weekday BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salon_amenities
-- Pre-defined feature codes the salon advertises (bio_gel, wifi, parking, ...).
-- The frontend owns the icon + label mapping; backend just stores the code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salon_amenities (
  salon_id   BIGINT UNSIGNED NOT NULL,
  amenity    VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (salon_id, amenity),
  CONSTRAINT fk_amenities_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- team_members
-- Stylists/staff at a salon. user_id is optional — set when a member is also
-- a registered nailed user (so they can log in with their own account later).
-- Names are not unique; a row is identified by id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id    BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED DEFAULT NULL,
  name        VARCHAR(255) NOT NULL,
  role        VARCHAR(255) DEFAULT NULL,
  bio         TEXT DEFAULT NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  position    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salon (salon_id, position),
  CONSTRAINT fk_team_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE,
  CONSTRAINT fk_team_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- service_team_members
-- A service is offered by zero or more team members. Empty link means "anyone".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_team_members (
  service_id      BIGINT UNSIGNED NOT NULL,
  team_member_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (service_id, team_member_id),
  KEY idx_member (team_member_id),
  CONSTRAINT fk_stm_service FOREIGN KEY (service_id)     REFERENCES services(id)     ON DELETE CASCADE,
  CONSTRAINT fk_stm_member  FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE CASCADE
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

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS cancellation_lead_hours    SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS booking_window_days        SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS min_booking_lead_hours     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_buffer_min         SMALLINT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS image_key VARCHAR(255) DEFAULT NULL;

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS email                  VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS phone                  VARCHAR(32)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notify_email_bookings  TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_sms_bookings    TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS category_id BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_popular  TINYINT(1) NOT NULL DEFAULT 0;

-- Salon-owner-facing notification toggles. These are persisted now; actual
-- mail/SMS delivery will be wired up in a later phase. The UI must surface
-- this clearly to the owner ("kommer").
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS notify_email_new_booking   TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_email_cancellation  TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_email_daily_summary TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notify_sms_new_booking     TINYINT(1) NOT NULL DEFAULT 0;

-- Free-text confirmation message rendered to the customer on /confirmation.html
-- (e.g. parking directions, where the entrance is, what to bring).
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS booking_confirmation_text VARCHAR(1000) DEFAULT NULL;

-- Daily lunch break. Both fields are either set or both NULL; the panel and
-- the zod schema enforce this. Slots inside the window are blocked client-side
-- via /availability and rejected server-side in POST /bookings.
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS lunch_break_start TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lunch_break_end   TIME DEFAULT NULL;

-- Owner can dismiss the onboarding checklist on /salong-panel.html. Once set
-- to 1 the card never re-renders even if the underlying state changes.
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS onboarding_skipped TINYINT(1) NOT NULL DEFAULT 0;

-- Subscription / billing skeleton (V1 launch: 149 kr/mnd flat, 30 dagers
-- gratis prøveperiode, ingen bindingstid). Faktisk Stripe/Vipps-betaling
-- legges til senere — disse kolonnene gir oss state-maskinen vi trenger
-- for å vise riktig UI og fakturere fra-dato.
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS subscription_status ENUM('trial','active','past_due','cancelled','none')
    NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_price_nok INT NOT NULL DEFAULT 149,
  ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_started_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscription_cancelled_at DATETIME DEFAULT NULL;

-- Slot-intervall: hvor ofte timer kan starte (15/30/60 min). Salongen velger
-- selv i Innstillinger. Default 60 (matcher gammel oppførsel).
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS slot_interval_min TINYINT NOT NULL DEFAULT 60;

-- Suspendering: grunn satt av admin når status flippes til 'suspended'.
-- Brukes i e-postvarselet OG vises som banner i salong-panelet.
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS suspended_at DATETIME DEFAULT NULL;

-- -----------------------------------------------------------------------------
-- page_views
-- Lett oppe-log av sidevisninger for admin-rapporter. visitor_id er en
-- random UUID i klient-cookie (nailed.visitor) — gir oss «unike besøkende»
-- uten å lagre IP/PII direkte.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_views (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id  VARCHAR(64) NOT NULL,
  user_id     BIGINT UNSIGNED DEFAULT NULL,
  path        VARCHAR(255) NOT NULL,
  referrer    VARCHAR(255) DEFAULT NULL,
  user_agent  VARCHAR(255) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visitor_time (visitor_id, created_at),
  KEY idx_time (created_at),
  KEY idx_path_time (path, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Org-nr (norsk 9-siffer organisasjonsnummer). Vises på offentlig
-- salongprofil + brukes til fakturering når abonnementet aktiveres.
ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS org_number VARCHAR(20) DEFAULT NULL;

-- Per-date closures (vacation, holidays, …). One row per closed date.
CREATE TABLE IF NOT EXISTS salon_closures (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id    BIGINT UNSIGNED NOT NULL,
  closed_date DATE NOT NULL,
  reason      VARCHAR(255) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_salon_date (salon_id, closed_date),
  KEY idx_salon (salon_id, closed_date),
  CONSTRAINT fk_closure_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviews: owner reply (added after the table was created). Both columns are
-- nullable; populated only when the salon owner replies to a review.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS owner_reply    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS owner_reply_at DATETIME DEFAULT NULL;

-- Reviews: author edit marker. NULL until the author edits the review; then
-- holds the timestamp of the most recent edit (shown as "(redigert ...)" on
-- public listings and the customer panel).
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS edited_at DATETIME DEFAULT NULL;

-- Add the FK on services.category_id only once. INFORMATION_SCHEMA check keeps
-- this idempotent (MySQL has no ADD CONSTRAINT IF NOT EXISTS).
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'services'
     AND CONSTRAINT_NAME = 'fk_services_category'
);
SET @fk_sql := IF(@fk_exists = 0,
  'ALTER TABLE services ADD CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Per-stylist booking: link each booking to the team member who'll perform it.
-- NULL = legacy "salon-wide" row (kept compatible with old data). When set,
-- conflict-checks scope to that stylist so two stylists can take separate
-- bookings at the same hour. ON DELETE SET NULL preserves the booking row if
-- the team member is later removed (the booking just becomes "salon-wide").
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS team_member_id BIGINT UNSIGNED DEFAULT NULL;

-- Index on bookings.team_member_id for the per-stylist overlap lookup.
SET @bk_ix_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND COLUMN_NAME = 'team_member_id'
     AND SEQ_IN_INDEX = 1
);
SET @bk_ix_sql := IF(@bk_ix_exists = 0,
  'ALTER TABLE bookings ADD INDEX idx_team_member (team_member_id, start_at)',
  'SELECT 1');
PREPARE stmt FROM @bk_ix_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK on bookings.team_member_id (idempotent via INFORMATION_SCHEMA gate).
SET @bk_fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND CONSTRAINT_NAME = 'fk_bookings_team_member'
);
SET @bk_fk_sql := IF(@bk_fk_exists = 0,
  'ALTER TABLE bookings ADD CONSTRAINT fk_bookings_team_member FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @bk_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index on services.category_id (idempotent). The FK auto-creates one if
-- missing, so we only add an explicit idx_category when no index covers
-- the column yet.
SET @ix_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'services'
     AND COLUMN_NAME = 'category_id'
     AND SEQ_IN_INDEX = 1
);
SET @ix_sql := IF(@ix_exists = 0,
  'ALTER TABLE services ADD INDEX idx_category (category_id)',
  'SELECT 1');
PREPARE stmt FROM @ix_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Recurring bookings — a series is a parent + N-1 children sharing a series_id.
-- series_id = the id of the first (parent) booking row in the series. Position
-- is 1..N (1 = parent). series_total is the count at creation time and is
-- informational; cancelling a child doesn't decrement it. series_interval_weeks
-- preserves the cadence for display in the customer panel.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS series_id              BIGINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS series_position        SMALLINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS series_total           SMALLINT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS series_interval_weeks  TINYINT UNSIGNED DEFAULT NULL;

-- Index on (series_id, series_position) for the per-series lookup. Idempotent
-- via INFORMATION_SCHEMA gate (MySQL has no ADD INDEX IF NOT EXISTS).
SET @bk_series_ix_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND INDEX_NAME = 'idx_series'
);
SET @bk_series_ix_sql := IF(@bk_series_ix_exists = 0,
  'ALTER TABLE bookings ADD INDEX idx_series (series_id, series_position)',
  'SELECT 1');
PREPARE stmt FROM @bk_series_ix_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Owner-side manual bookings (walk-ins, phone bookings). When the salon owner
-- books on behalf of someone, customer_user_id may be NULL (a "guest" booking)
-- and the guest's contact info lives in guest_name + guest_phone instead. To
-- allow NULL on a column that already has a FK we drop the existing FK, relax
-- the column, and re-add the FK — all idempotent.
--
-- 1) Add the guest columns.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS guest_name  VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(32)  DEFAULT NULL;

-- 2) Drop the existing FK on customer_user_id if the column is still NOT NULL.
--    The rewrite only runs the first time; subsequent runs are no-ops.
SET @bk_cust_notnull := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND COLUMN_NAME = 'customer_user_id'
);
SET @bk_cust_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND CONSTRAINT_NAME = 'fk_bookings_customer'
);
SET @drop_fk_sql := IF(@bk_cust_notnull = 'NO' AND @bk_cust_fk > 0,
  'ALTER TABLE bookings DROP FOREIGN KEY fk_bookings_customer',
  'SELECT 1');
PREPARE stmt FROM @drop_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Relax customer_user_id to NULLable (only when it's still NOT NULL).
SET @relax_sql := IF(@bk_cust_notnull = 'NO',
  'ALTER TABLE bookings MODIFY customer_user_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE stmt FROM @relax_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Re-add the FK if it's missing (covers fresh installs from the legacy
--    CREATE TABLE above AND the just-dropped case).
SET @cust_fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'bookings'
     AND CONSTRAINT_NAME = 'fk_bookings_customer'
);
SET @add_fk_sql := IF(@cust_fk_exists = 0,
  'ALTER TABLE bookings ADD CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @add_fk_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- customer_notes
-- Salon-owner-private notes about a specific customer (allergies, preferences,
-- arrival habits, …). One row per (salon_id, customer_user_id) — the note
-- follows the customer across all of their bookings at that salon. The note is
-- only ever readable by the owner of the salon (or an admin); customers never
-- see it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_notes (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  salon_id         BIGINT UNSIGNED NOT NULL,
  customer_user_id BIGINT UNSIGNED NOT NULL,
  body             TEXT NOT NULL,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_salon_customer (salon_id, customer_user_id),
  KEY idx_salon (salon_id),
  CONSTRAINT fk_note_salon    FOREIGN KEY (salon_id)         REFERENCES salons(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_customer FOREIGN KEY (customer_user_id) REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- waitlist_entries
-- A customer subscribes to a slot that's currently taken. When the slot frees
-- up (booking cancelled or no_show), the matching entry flips to 'ready' and
-- the customer can 1-click rebook from /kunde-panel.html. Email delivery isn't
-- wired yet — this only records intent and surfaces it in the panel.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  salon_id        BIGINT UNSIGNED NOT NULL,
  service_id      BIGINT UNSIGNED NOT NULL,
  team_member_id  BIGINT UNSIGNED DEFAULT NULL,
  desired_start   DATETIME NOT NULL,
  status          ENUM('waiting','ready','claimed','expired') NOT NULL DEFAULT 'waiting',
  notified_at     DATETIME DEFAULT NULL,
  claimed_booking_id BIGINT UNSIGNED DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id, status),
  KEY idx_salon_slot (salon_id, desired_start, status),
  CONSTRAINT fk_wl_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_wl_salon   FOREIGN KEY (salon_id)   REFERENCES salons(id)   ON DELETE CASCADE,
  CONSTRAINT fk_wl_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_wl_team    FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE SET NULL,
  CONSTRAINT fk_wl_claimed FOREIGN KEY (claimed_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- review_reports
-- Logged-in users (other than the review author and the salon owner) can flag
-- a review as inappropriate. Admin works the queue from /admin (#tab-anmeldelser)
-- and resolves each report by dismissing it or hiding the underlying review.
-- UNIQUE (reporter_user_id, review_id) prevents the same user reporting the
-- same review twice.
-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- notification_log
-- Append-only audit + dedup of every email/SMS send attempt. `kind` namespaces
-- the notification type (e.g. 'booking_created.customer', 'booking_reminder.customer').
-- Used as the dedup index for reminders: before firing 'booking_reminder.*' we
-- check for an existing 'sent' row on the same (booking_id, kind).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id   BIGINT UNSIGNED DEFAULT NULL,
  user_id      BIGINT UNSIGNED DEFAULT NULL,
  channel      ENUM('email','sms') NOT NULL,
  kind         VARCHAR(64) NOT NULL,
  recipient    VARCHAR(255) NOT NULL,
  provider_id  VARCHAR(128) DEFAULT NULL,
  status       ENUM('sent','failed','skipped') NOT NULL,
  error        TEXT DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_kind (booking_id, kind),
  KEY idx_user (user_id),
  CONSTRAINT fk_nl_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  CONSTRAINT fk_nl_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS review_reports (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id    BIGINT UNSIGNED NOT NULL,
  reporter_user_id BIGINT UNSIGNED NOT NULL,
  reason       ENUM('spam','offensive','fake','off_topic','other') NOT NULL,
  details      TEXT DEFAULT NULL,
  status       ENUM('pending','dismissed','actioned') NOT NULL DEFAULT 'pending',
  resolved_at  DATETIME DEFAULT NULL,
  resolved_by_user_id BIGINT UNSIGNED DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reporter_review (reporter_user_id, review_id),
  KEY idx_status (status, created_at),
  CONSTRAINT fk_rr_review   FOREIGN KEY (review_id)        REFERENCES reviews(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_reporter FOREIGN KEY (reporter_user_id) REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_rr_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- chat_threads
-- En tråd per (kunde × salong). Opprettes når kunden gjør sin første booking
-- mot salongen. Begge parter kan sende meldinger så lenge tråden eksisterer.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_threads (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_user_id   BIGINT UNSIGNED NOT NULL,
  salon_id           BIGINT UNSIGNED NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at    DATETIME DEFAULT NULL,
  customer_last_read DATETIME DEFAULT NULL,
  salon_last_read    DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_thread (customer_user_id, salon_id),
  KEY idx_salon (salon_id, last_message_at),
  CONSTRAINT fk_ct_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_salon    FOREIGN KEY (salon_id)         REFERENCES salons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- chat_messages
-- Append-only. sender_role redundant for raske queries — settes basert på om
-- sender er kunden i tråden eller salon-eier.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id       BIGINT UNSIGNED NOT NULL,
  sender_user_id  BIGINT UNSIGNED NOT NULL,
  sender_role     ENUM('customer','salon') NOT NULL,
  body            TEXT NOT NULL,
  sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_thread (thread_id, sent_at),
  CONSTRAINT fk_cm_thread FOREIGN KEY (thread_id)      REFERENCES chat_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
