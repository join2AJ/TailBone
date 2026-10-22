import crypto from "node:crypto";
import { encrypt, decrypt, decryptFields } from "./crypto.js";
import { calendarSync } from "./services.js";

// DPDP Act 2023 (India) and GDPR: consent records, rights requests, export, erasure and retention.
// The privacy notice shown to patients is versioned so each consent can be tied to the exact text agreed to.

export const NOTICE_VERSION = "2026-10-22";
export const CONSENT_PURPOSES = {
  care: "Use my details to book, provide and follow up my treatment",
  whatsapp_updates: "Send appointment updates, reminders and follow-up check-ins on WhatsApp",
  story_publication: "Publish my story with my first name and last initial",
};

const RETENTION_YEARS = () => Math.max(1, Number(process.env.RETENTION_YEARS) || 3);
const REQUEST_DAYS = 30; // GDPR: one month. DPDP Rules: respond within the period the clinic publishes (we use 30 days).

export function recordConsent(db, patientId, purposes, source = "web") {
  const insert = db.prepare("INSERT INTO consents (patient_id, purpose, notice_version, source) VALUES (?, ?, ?, ?)");
  for (const p of purposes) {
    if (!CONSENT_PURPOSES[p]) continue;
    const active = db.prepare("SELECT 1 FROM consents WHERE patient_id = ? AND purpose = ? AND notice_version = ? AND withdrawn_at IS NULL").get(patientId, p, NOTICE_VERSION);
    if (!active) insert.run(patientId, p, NOTICE_VERSION, source);
  }
}

export function withdrawConsent(db, patientId, purpose) {
  db.prepare("UPDATE consents SET withdrawn_at = datetime('now') WHERE patient_id = ? AND (? IS NULL OR purpose = ?) AND withdrawn_at IS NULL")
    .run(patientId, purpose ?? null, purpose ?? null);
}

export const hasConsent = (db, patientId, purpose) =>
  !!db.prepare("SELECT 1 FROM consents WHERE patient_id = ? AND purpose = ? AND withdrawn_at IS NULL").get(patientId, purpose);

/** Everything held about a patient, decrypted, for an access / portability request (GDPR Art. 15 & 20, DPDP s.11). */
export function exportPatientData(db, patientId) {
  const patient = db.prepare(
    `SELECT id, name, phone, email, notes, created_at, anonymised_at, gender, birth_year, occupation_group, occupation, city,
       sitting_hours, pain_since, heard_from, referred_by FROM patients WHERE id = ?`,
  ).get(patientId);
  if (!patient) return null;
  const referrer = patient.referred_by ? db.prepare("SELECT code, name FROM partners WHERE id = ?").get(patient.referred_by) : null;
  delete patient.referred_by;
  const ownPartner = db.prepare("SELECT id, code, status, payout_details, created_at FROM partners WHERE patient_id = ?").get(patientId);
  return {
    exportedAt: new Date().toISOString(),
    controller: "Tailbone Treatment Clinic, +91 98866 88323, contact@tailbonetreatment.com",
    noticeVersion: NOTICE_VERSION,
    patient: decryptFields(patient, ["notes"]),
    appointments: db.prepare(
      `SELECT ref, clinic, date, time, status, visit_type, reason, notes, fee, payment_status, amount_paid, amount_refunded, created_at
       FROM appointments WHERE patient_id = ? ORDER BY date`,
    ).all(patientId).map((a) => decryptFields(a, ["reason", "notes"])),
    followups: db.prepare("SELECT due_date, type, status, notes, completed_at FROM followups WHERE patient_id = ? ORDER BY due_date").all(patientId)
      .map((f) => ({ ...f, notes: decrypt(f.notes) })),
    checkins: db.prepare("SELECT pain_score, sitting_minutes, trend, notes, created_at FROM checkins WHERE patient_id = ? ORDER BY created_at").all(patientId)
      .map((c) => decryptFields(c, ["notes"])),
    consents: db.prepare("SELECT purpose, notice_version, source, given_at, withdrawn_at FROM consents WHERE patient_id = ? ORDER BY id").all(patientId),
    messages: db.prepare("SELECT event, channel, status, body, created_at FROM notifications WHERE audience = 'patient' AND recipient = ? ORDER BY id").all(patient.phone)
      .map((n) => ({ ...n, body: decrypt(n.body) })),
    stories: db.prepare("SELECT title, body, status, created_at FROM stories WHERE phone = ?").all(patient.phone),
    // The files themselves are downloaded one by one from My appointments; this lists them.
    documents: db.prepare("SELECT title, kind, mime, size, uploaded_by, shared, created_at FROM documents WHERE patient_id = ? AND (shared = 1 OR uploaded_by = 'patient') ORDER BY id").all(patientId),
    referredBy: referrer,
    yourReferralId: ownPartner ? {
      code: ownPartner.code, status: ownPartner.status, payTo: decrypt(ownPartner.payout_details), createdAt: ownPartner.created_at,
      rewards: db.prepare("SELECT kind, amount, status, created_at FROM referral_rewards WHERE partner_id = ? ORDER BY id").all(ownPartner.id),
      payouts: db.prepare("SELECT amount, method, reference, paid_at FROM partner_payouts WHERE partner_id = ? ORDER BY id").all(ownPartner.id),
    } : null,
    homeVisitRequests: db.prepare("SELECT ref, city, date_from, date_to, status, details, created_at FROM home_visits WHERE phone = ? ORDER BY id").all(patient.phone)
      .map((v) => decryptFields(v, ["details"])),
  };
}

/**
 * Erase personal data (GDPR Art. 17, DPDP s.12). Identity, contact details and clinical text are removed.
 * Booking references, dates and amounts are kept, de-identified, because tax law requires
 * financial records to be retained (Income-tax / GST: typically 6–8 years).
 */
export function erasePatient(db, patientId, { force = false } = {}) {
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId);
  if (!patient) throw Object.assign(new Error("Patient not found."), { status: 404 });
  if (patient.anonymised_at) return { already: true };
  const upcoming = db.prepare("SELECT COUNT(*) n FROM appointments WHERE patient_id = ? AND status IN ('pending','confirmed') AND date >= date('now')").get(patientId).n;
  if (upcoming && !force) throw Object.assign(new Error("Cancel the patient's upcoming appointments before erasing their data."), { status: 409 });
  const placeholder = `erased-${patientId}-${crypto.randomBytes(3).toString("hex")}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE patients SET name = 'Erased patient', phone = ?, email = NULL, notes = '', anonymised_at = datetime('now'),
      gender = NULL, birth_year = NULL, occupation_group = NULL, occupation = NULL, city = NULL, sitting_hours = NULL, pain_since = NULL, heard_from = NULL
      WHERE id = ?`).run(placeholder, patientId);
    // Their own referral ID stops; amounts already paid stay on record (de-identified) for the accounts.
    db.prepare("UPDATE partners SET name = 'Erased patient', email = NULL, phone = NULL, payout_details = '', notes = '', status = 'suspended' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE home_visits SET name = 'Erased', phone = ?, email = NULL, details = '', clinic_notes = '' WHERE phone = ?").run(placeholder, patient.phone);
    db.prepare("UPDATE appointments SET reason = '', notes = '' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE checkins SET notes = '' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE followups SET notes = '' WHERE patient_id = ?").run(patientId);
    // Messages to the patient, and dashboard/email notices about them (which name them and show their phone).
    db.prepare(`UPDATE notifications SET body = ?, recipient = '' WHERE recipient = ?
      OR appointment_id IN (SELECT id FROM appointments WHERE patient_id = ?)`).run(encrypt("[erased]"), patient.phone, patientId);
    db.prepare("UPDATE data_requests SET name = 'Erased patient', phone = NULL, email = NULL, details = ?, changes = NULL WHERE patient_id = ? OR phone = ?")
      .run(encrypt(""), patientId, patient.phone);
    db.prepare("UPDATE appointment_events SET actor_name = '', detail = '' WHERE actor = 'patient' AND appointment_id IN (SELECT id FROM appointments WHERE patient_id = ?)").run(patientId);
    db.prepare("DELETE FROM stories WHERE patient_id = ? OR phone = ?").run(patientId, patient.phone);
    db.prepare("DELETE FROM documents WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE consents SET withdrawn_at = COALESCE(withdrawn_at, datetime('now')) WHERE patient_id = ?").run(patientId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  // Calendar entries carry the patient's name: update or remove them too.
  for (const { id } of db.prepare("SELECT id FROM appointments WHERE patient_id = ? AND gcal_event_id IS NOT NULL").all(patientId)) calendarSync(db, id);
  return { erased: true };
}

/**
 * Storage limitation (GDPR Art. 5(1)(e), DPDP s.8(7)): erase patients with no activity for RETENTION_YEARS,
 * trim old message texts, and keep security logs for at least one year (DPDP Rules) but not forever.
 */
export function runRetention(db, now = new Date()) {
  const years = RETENTION_YEARS();
  const stale = db.prepare(
    `SELECT p.id FROM patients p
     WHERE p.anonymised_at IS NULL
       AND COALESCE((SELECT MAX(date) FROM appointments a WHERE a.patient_id = p.id), date(p.created_at)) < date(?, ?)
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.status IN ('pending','confirmed') AND a.date >= date(?))`,
  ).all(now.toISOString().slice(0, 10), `-${years} years`, now.toISOString().slice(0, 10));
  for (const { id } of stale) erasePatient(db, id, { force: true });
  db.prepare("UPDATE notifications SET body = ? WHERE created_at < datetime(?, '-1 year') AND body != ?").run(encrypt("[expired]"), now.toISOString(), encrypt("[expired]"));
  db.prepare("DELETE FROM security_log WHERE created_at < datetime(?, '-2 years')").run(now.toISOString());
  return { erased: stale.length, years };
}

// ---------- Rights requests ----------
// Requests made from "My appointments" (identity already checked by appointment number + phone) go to the
// dashboard. Staff can complete them at any time; if nobody has acted after AUTO_DAYS they are completed
// automatically. Patients are told it takes up to PROMISE_DAYS.
export const AUTO_DAYS = 3;
export const PROMISE_DAYS = 7;
export const SELF_SERVICE_TYPES = ["access", "correction", "erasure"];
const DOWNLOAD_VALID_DAYS = 30;

export function createDataRequest(db, { type, name, phone, email, details, patientId, changes = null, selfService = false }) {
  const ref = `DR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const days = selfService ? PROMISE_DAYS : REQUEST_DAYS;
  const due = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const autoAt = selfService ? new Date(Date.now() + AUTO_DAYS * 86_400_000).toISOString() : null;
  db.prepare("INSERT INTO data_requests (ref, type, name, phone, email, details, patient_id, due_at, auto_at, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(ref, type, name, phone || null, email || null, encrypt(details || ""), patientId ?? null, due, autoAt, changes ? encrypt(JSON.stringify(changes)) : null);
  return { ref, due };
}

export const readDataRequest = (r) => r && {
  ...r,
  details: decrypt(r.details),
  changes: r.changes ? JSON.parse(decrypt(r.changes) || "null") : null,
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Carry out a request: corrections are applied, erasure removes the patient's personal data, and an
 * access request makes "Download my data" available on the patient's page.
 */
export function completeDataRequest(db, row, { by = "auto", resolution = "" } = {}) {
  const req = readDataRequest(row);
  if (!["open", "verifying"].includes(req.status)) return req;
  let done = resolution;
  if (req.patient_id && req.type === "correction" && req.changes) {
    const c = req.changes;
    if (c.phone) {
      const clash = db.prepare("SELECT 1 FROM patients WHERE phone = ? AND id != ?").get(c.phone, req.patient_id);
      if (clash) throw httpError(409, "Another patient record already uses that phone number. Please check with the patient.");
    }
    db.prepare("UPDATE patients SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?")
      .run(c.name || null, c.email || null, c.phone || null, req.patient_id);
    done ||= "Details corrected.";
  } else if (req.patient_id && req.type === "erasure") {
    erasePatient(db, req.patient_id); // refuses while appointments are still upcoming
    done ||= "Personal data erased.";
  } else if (req.type === "access") {
    done ||= "Data ready to download.";
  }
  db.prepare("UPDATE data_requests SET status = 'completed', completed_by = ?, resolution = ?, closed_at = datetime('now'), auto_at = NULL WHERE id = ?")
    .run(by, done || "Completed.", req.id);
  return { ...req, status: "completed" };
}

/** Complete requests whose automatic date has passed. Runs from the scheduler and on the patient's next visit. */
export function processDueRequests(db, now = new Date(), patientId = null) {
  const rows = db.prepare(
    `SELECT * FROM data_requests WHERE status IN ('open','verifying') AND auto_at IS NOT NULL AND auto_at <= ?
       AND (? IS NULL OR patient_id = ?)`,
  ).all(now.toISOString(), patientId, patientId);
  let done = 0;
  for (const row of rows) {
    try {
      completeDataRequest(db, row, { by: "auto" });
      done++;
    } catch (err) {
      // Needs a person (e.g. an upcoming appointment blocks erasure): stop auto-processing and say why.
      db.prepare("UPDATE data_requests SET auto_at = NULL, resolution = ? WHERE id = ?").run(`Needs staff: ${err.message}`, row.id);
    }
  }
  return done;
}

/** What the patient sees about their own requests on "My appointments". */
export function patientRequests(db, patientId) {
  const rows = db.prepare("SELECT ref, type, status, due_at, created_at, closed_at, resolution FROM data_requests WHERE patient_id = ? ORDER BY id DESC LIMIT 10").all(patientId);
  const downloadReady = !!db.prepare(
    `SELECT 1 FROM data_requests WHERE patient_id = ? AND type = 'access' AND status = 'completed' AND closed_at >= datetime('now', ?)`,
  ).get(patientId, `-${DOWNLOAD_VALID_DAYS} days`);
  return {
    downloadReady,
    requests: rows.map((r) => ({ ref: r.ref, type: r.type, status: r.status, due: r.due_at, createdAt: r.created_at, closedAt: r.closed_at })),
  };
}
