-- TikoSorted PostgreSQL schema (corrected version of your dbdiagram design)
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

CREATE TYPE user_role AS ENUM ('manager','coordinator','finance','logistics','production','marketing','hospitality','compliance','gate_staff');
CREATE TYPE event_stage AS ENUM ('draft','published','on_sale','sold_out','ongoing','completed','cancelled');
CREATE TYPE ticket_type AS ENUM ('regular','vip','vvip');
CREATE TYPE ticket_status AS ENUM ('held','paid','verified','used');
CREATE TYPE booking_status AS ENUM ('held','paid','expired','cancelled');
CREATE TYPE cost_class AS ENUM ('marketing','sound_equipment','artist','on_ground');

CREATE TABLE mgt_users (
  user_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      VARCHAR(120) NOT NULL,
  staff_id  VARCHAR(40) UNIQUE NOT NULL,
  email     VARCHAR(160) UNIQUE NOT NULL,
  role      user_role NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mgt_auth (
  auth_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES mgt_users(user_id) ON DELETE CASCADE,
  password_hash   VARCHAR(100) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  last_login      TIMESTAMPTZ,
  device_metadata JSONB,
  token_id        UUID,
  expires_at      TIMESTAMPTZ
);

CREATE TABLE events (
  event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(160) NOT NULL,
  approver_id UUID REFERENCES mgt_users(user_id),
  location    VARCHAR(200) NOT NULL,
  event_date  TIMESTAMPTZ NOT NULL,
  event_stage event_stage NOT NULL DEFAULT 'draft',
  is_cancelled BOOLEAN NOT NULL DEFAULT false
);

-- Replaces no_vip/no_regular/no_vvip + 3 price columns on events (normalization)
CREATE TABLE ticket_tiers (
  tier_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  type      ticket_type NOT NULL,
  price     NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  total     INT NOT NULL CHECK (total >= 0),
  available INT NOT NULL CHECK (available >= 0 AND available <= total), -- DB itself refuses overselling
  UNIQUE (event_id, type)
);

CREATE TABLE bookings (
  booking_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(100) UNIQUE NOT NULL,
  event_id        UUID NOT NULL REFERENCES events(event_id),
  tier_id         UUID NOT NULL REFERENCES ticket_tiers(tier_id),
  no_of_tickets   INT NOT NULL CHECK (no_of_tickets > 0),
  amount          NUMERIC(10,2) NOT NULL,
  booker_phone    VARCHAR(20),   -- PII: nulled by cleanup job
  booker_email    VARCHAR(160),  -- PII: nulled by cleanup job
  status          booking_status NOT NULL DEFAULT 'held',
  hold_expires_at TIMESTAMPTZ,
  booked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  payment_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(booking_id),
  method        VARCHAR(10) NOT NULL CHECK (method IN ('mpesa','card')),
  provider_ref  VARCHAR(100) UNIQUE,  -- M-Pesa CheckoutRequestID / receipt: blocks duplicate callbacks
  amount        NUMERIC(10,2) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per seat (your design had a single ticket_id on a booking of many tickets)
CREATE TABLE tickets (
  ticket_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES events(event_id),
  tier_id    UUID NOT NULL REFERENCES ticket_tiers(tier_id),
  status     ticket_status NOT NULL DEFAULT 'held',
  qr_payload TEXT UNIQUE,
  used_at    TIMESTAMPTZ
);
CREATE INDEX idx_tickets_event_status ON tickets(event_id, status);

CREATE TABLE offline_sync_logs (
  sync_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL REFERENCES tickets(ticket_id),
  scanner_device_id VARCHAR(80) NOT NULL,
  scanned_at        TIMESTAMPTZ NOT NULL,
  is_reconciled     BOOLEAN NOT NULL DEFAULT false,
  conflict          BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE artists (
  artist_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL,
  email              VARCHAR(160) NOT NULL,
  preference         JSONB,
  verification_token VARCHAR(100),
  verification_sent  BOOLEAN NOT NULL DEFAULT false,
  is_verified        BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (event_id, email)
);

CREATE TABLE entourage (
  entourage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id    UUID NOT NULL REFERENCES artists(artist_id) ON DELETE CASCADE,
  name         VARCHAR(120) NOT NULL,
  email        VARCHAR(160),
  is_verified  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE costs (
  cost_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  name           VARCHAR(160) NOT NULL,
  classification cost_class NOT NULL,
  cost_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0)
);

CREATE TABLE tasks (          -- "Track tasks" requirement had no table
  task_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  assigned_to UUID REFERENCES mgt_users(user_id),
  deadline    TIMESTAMPTZ,
  status      VARCHAR(12) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done'))
);

CREATE TABLE audit_logs (
  log_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL REFERENCES mgt_users(user_id),
  action        VARCHAR(80) NOT NULL,
  resource      VARCHAR(80) NOT NULL,
  log_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  log_metadata  JSONB
);
