import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinic TEXT NOT NULL CHECK (clinic IN ('blr','del','online')),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web',
  prefers_female INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, time);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
-- One active booking per clinic slot; cancelled / finished ones free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
  ON appointments(clinic, date, time) WHERE status IN ('pending','confirmed');

CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checkin','call','visit','whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  notes TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fu_due ON followups(status, due_date);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  followup_id INTEGER REFERENCES followups(id) ON DELETE SET NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  pain_score INTEGER NOT NULL CHECK (pain_score BETWEEN 0 AND 10),
  sitting_minutes INTEGER,
  trend TEXT NOT NULL CHECK (trend IN ('better','same','worse')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  duration TEXT NOT NULL DEFAULT '',
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  featured INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_story_status ON stories(status, featured, published_at);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('reel','post')),
  caption TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY,
  clinic TEXT NOT NULL CHECK (clinic IN ('all','blr','del','online')),
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE (clinic, date)
);

-- Clinic-editable settings (fees, policies) stored as JSON values.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Audit trail: every change to an appointment, who made it and when.
CREATE TABLE IF NOT EXISTS appointment_events (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('patient','clinic','system')),
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_appt ON appointment_events(appointment_id, id);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,                 -- paise
  reason TEXT NOT NULL DEFAULT '',
  provider_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed','manual')),
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Outbox of messages to patients and the doctor, with delivery status.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  audience TEXT NOT NULL CHECK (audience IN ('patient','doctor')),
  event TEXT NOT NULL,
  channel TEXT NOT NULL,                   -- whatsapp_api | email | manual
  recipient TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','manual')),
  error TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif ON notifications(audience, read_at, id);

-- DPDP / GDPR: what each patient agreed to, against which version of the notice.
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,                 -- care | whatsapp_updates | story_publication
  notice_version TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  given_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_patient ON consents(patient_id, purpose);

-- Data-principal / data-subject requests (access, correction, erasure, withdrawal, grievance).
CREATE TABLE IF NOT EXISTS data_requests (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('access','correction','erasure','withdraw_consent','grievance')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  details TEXT NOT NULL DEFAULT '',      -- encrypted
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','verifying','completed','rejected')),
  resolution TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- Security log (ISO 27001 A.8.15 / NIST CSF DE.CM): sign-ins, exports, erasures, setting changes.
CREATE TABLE IF NOT EXISTS security_log (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seclog ON security_log(created_at);
`;

// Columns added after the first release. SQLite can't "ADD COLUMN IF NOT EXISTS", so check first.
const MIGRATIONS = {
  appointments: {
    visit_type: "TEXT NOT NULL DEFAULT 'new'",            // new | followup
    fee: "INTEGER NOT NULL DEFAULT 0",                     // paise, price at time of booking
    platform_fee: "INTEGER NOT NULL DEFAULT 0",            // paise kept by the platform
    payment_status: "TEXT NOT NULL DEFAULT 'unpaid'",      // unpaid | awaiting | paid | refunded | partially_refunded | pay_at_clinic
    payment_order_id: "TEXT",
    payment_id: "TEXT",
    amount_paid: "INTEGER NOT NULL DEFAULT 0",
    amount_refunded: "INTEGER NOT NULL DEFAULT 0",
    hold_until: "TEXT",                                    // unpaid online bookings release the slot after this
    reschedule_count: "INTEGER NOT NULL DEFAULT 0",
    cancelled_by: "TEXT",
  },
  admins: {
    totp_secret: "TEXT",                                   // encrypted base32 secret
    totp_enabled: "INTEGER NOT NULL DEFAULT 0",
    session_version: "INTEGER NOT NULL DEFAULT 1",         // bump to sign out everywhere
    failed_logins: "INTEGER NOT NULL DEFAULT 0",
    locked_until: "TEXT",
    last_login_at: "TEXT",
  },
  patients: {
    anonymised_at: "TEXT",
  },
};

export function openDb(file = config.dbFile) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) {
      if (!existing.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_appt_order ON appointments(payment_order_id)");
  return db;
}

/** Run fn inside a transaction, rolling back on error. */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
