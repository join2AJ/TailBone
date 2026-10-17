import crypto from "node:crypto";
import { encrypt, decrypt, decryptFields } from "./crypto.js";

// DPDP Act 2023 (India) and GDPR: consent records, rights requests, export, erasure and retention.
// The privacy notice shown to patients is versioned so each consent can be tied to the exact text agreed to.

export const NOTICE_VERSION = "2026-10-17";
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
  const patient = db.prepare("SELECT id, name, phone, email, notes, created_at, anonymised_at FROM patients WHERE id = ?").get(patientId);
  if (!patient) return null;
  return {
    exportedAt: new Date().toISOString(),
    controller: "Tailbone Treatment Clinic, +91 98866 88323, contact@tailbonetreatment.com",
    noticeVersion: NOTICE_VERSION,
    patient: decryptFields(patient, ["notes"]),
    appointments: db.prepare(
      `SELECT ref, clinic, date, time, status, visit_type, reason, notes, fee, payment_status, amount_paid, amount_refunded, created_at
       FROM appointments WHERE patient_id = ? ORDER BY date`,
    ).all(patientId).map((a) => decryptFields(a, ["reason", "notes"])),
    followups: db.prepare("SELECT due_date, type, status, notes, completed_at FROM followups WHERE patient_id = ? ORDER BY due_date").all(patientId),
    checkins: db.prepare("SELECT pain_score, sitting_minutes, trend, notes, created_at FROM checkins WHERE patient_id = ? ORDER BY created_at").all(patientId)
      .map((c) => decryptFields(c, ["notes"])),
    consents: db.prepare("SELECT purpose, notice_version, source, given_at, withdrawn_at FROM consents WHERE patient_id = ? ORDER BY id").all(patientId),
    messages: db.prepare("SELECT event, channel, status, body, created_at FROM notifications WHERE audience = 'patient' AND recipient = ? ORDER BY id").all(patient.phone)
      .map((n) => ({ ...n, body: decrypt(n.body) })),
    stories: db.prepare("SELECT title, body, status, created_at FROM stories WHERE phone = ?").all(patient.phone),
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
    db.prepare("UPDATE patients SET name = 'Erased patient', phone = ?, email = NULL, notes = '', anonymised_at = datetime('now') WHERE id = ?").run(placeholder, patientId);
    db.prepare("UPDATE appointments SET reason = '', notes = '' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE checkins SET notes = '' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE followups SET notes = '' WHERE patient_id = ?").run(patientId);
    db.prepare("UPDATE notifications SET body = ?, recipient = '' WHERE recipient = ?").run(encrypt("[erased]"), patient.phone);
    db.prepare("UPDATE appointment_events SET actor_name = '', detail = '' WHERE actor = 'patient' AND appointment_id IN (SELECT id FROM appointments WHERE patient_id = ?)").run(patientId);
    db.prepare("UPDATE stories SET phone = NULL WHERE phone = ?").run(patient.phone);
    db.prepare("UPDATE consents SET withdrawn_at = COALESCE(withdrawn_at, datetime('now')) WHERE patient_id = ?").run(patientId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
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
export function createDataRequest(db, { type, name, phone, email, details, patientId }) {
  const ref = `DR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const due = new Date(Date.now() + REQUEST_DAYS * 86_400_000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO data_requests (ref, type, name, phone, email, details, patient_id, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(ref, type, name, phone || null, email || null, encrypt(details || ""), patientId ?? null, due);
  return { ref, due };
}

export const readDataRequest = (r) => r && { ...r, details: decrypt(r.details) };
