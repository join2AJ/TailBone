// Referral programme. Partners (people, patients, hospitals, consultants, NGOs, insurers…) get a referral ID such as REF-K7Q4M.
// A new patient who books with it is linked to that partner for good. The partner earns a fixed amount when that first
// booking is confirmed by the clinic (or paid), and a fixed amount for every treatment visit the patient completes within
// the reward period. Amounts and the period are clinic settings. Rewards are paid by hand once a month and recorded here.
import crypto from "node:crypto";
import { HttpError, cleanText } from "./services.js";
import { isOn } from "./features.js";

export const PARTNER_KINDS = {
  individual: "Individual", patient: "Patient", hospital: "Hospital / clinic", consultant: "Doctor / consultant",
  ngo: "NGO", insurer: "Health insurance company", other: "Other organisation",
};

// The programme itself is switched on and off in the Control panel (feature "referrals").
export const REFERRAL_DEFAULTS = {
  firstBooking: 5_000,     // paise: ₹50 when a referred patient's first booking is confirmed
  treatment: 100_000,      // paise: ₹1,000 for every treatment visit the referred patient completes
  months: 12,              // treatment rewards for visits within this many months of the referral
};

export function getReferralSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'referral'").get();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return { ...REFERRAL_DEFAULTS, ...saved };
}

export function saveReferralSettings(db, input = {}) {
  const cur = getReferralSettings(db);
  const money = (v, fallback) => {
    if (v === undefined) return fallback;
    const n = Math.round(Number(v) * 100);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, "Please enter an amount between ₹0 and ₹1,00,000.");
    return n;
  };
  const months = input.months === undefined ? cur.months : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new HttpError(400, "The reward period must be 1 to 60 months.");
  const next = {
    firstBooking: money(input.firstBookingRupees, cur.firstBooking),
    treatment: money(input.treatmentRupees, cur.treatment),
    months,
  };
  db.prepare("INSERT INTO settings (key, value) VALUES ('referral', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const isKind = (k) => typeof k === "string" && Object.hasOwn(PARTNER_KINDS, k);

export function newPartnerCode(db) {
  for (;;) {
    const code = `REF-${[...crypto.randomBytes(5)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
    if (!db.prepare("SELECT 1 FROM partners WHERE code = ?").get(code)) return code;
  }
}

/** Accepts the code however it's typed ("ref k7q4m", "REFK7Q4M"). */
export const normalizeCode = (input) => {
  const c = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (!c) return "";
  return c.startsWith("REF") ? `REF-${c.slice(3)}` : `REF-${c}`;
};

/** The active partner for a referral code, or null. */
export function findActivePartner(db, code) {
  const c = normalizeCode(code);
  if (!/^REF-[A-Z0-9]{4,8}$/.test(c)) return null;
  return db.prepare("SELECT * FROM partners WHERE code = ? AND status = 'active'").get(c) || null;
}

/**
 * Link a new booking to the partner whose code was entered. Only first-time patients count (someone already treated
 * wasn't brought by the referral), and nobody can refer themselves. Returns the partner id used, or null.
 */
export function linkReferral(db, appointmentId, code) {
  if (!code || !isOn(db, "referrals")) return null;
  const partner = findActivePartner(db, code);
  if (!partner) return null;
  const appt = db.prepare("SELECT id, patient_id FROM appointments WHERE id = ?").get(appointmentId);
  const patient = db.prepare("SELECT id, phone, referred_by FROM patients WHERE id = ?").get(appt.patient_id);
  if (partner.patient_id === patient.id || (partner.phone && partner.phone === patient.phone)) return null;
  // Only a patient record created by this very booking counts. Otherwise anyone who knew an existing (or about-to-visit)
  // patient's phone number could book with their own code and claim that patient's visits.
  const earlier = db.prepare("SELECT 1 FROM appointments WHERE patient_id = ? AND id != ?").get(patient.id, appt.id);
  if (earlier || patient.referred_by) return null;
  db.prepare("UPDATE patients SET referred_by = ? WHERE id = ? AND referred_by IS NULL").run(partner.id, patient.id);
  db.prepare("UPDATE appointments SET referral_partner_id = ? WHERE id = ?").run(partner.id, appt.id);
  return partner.id;
}

/**
 * Bring an appointment's rewards in line with its status. Called after every status or payment change, so it must be
 * idempotent: rewards are created once (UNIQUE appointment + kind), withdrawn if the visit is cancelled before payout,
 * and never touched once paid.
 */
export function syncRewards(db, appointmentId) {
  const a = db.prepare(
    `SELECT a.id, a.patient_id, a.status, a.payment_status, a.referral_partner_id, a.date, p.referred_by,
       (SELECT MIN(created_at) FROM appointments x WHERE x.patient_id = a.patient_id AND x.referral_partner_id IS NOT NULL) AS referred_at
     FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?`,
  ).get(appointmentId);
  if (!a) return;
  const settings = getReferralSettings(db);
  const add = (partnerId, kind, amount, note) => {
    if (!amount) return;
    db.prepare("INSERT OR IGNORE INTO referral_rewards (partner_id, patient_id, appointment_id, kind, amount, note) VALUES (?, ?, ?, ?, ?, ?)")
      .run(partnerId, a.patient_id, a.id, kind, amount, note);
    // A reward withdrawn automatically (visit cancelled or not completed, then reinstated) comes back; one the clinic
    // withdrew by hand, or another partner's, never does.
    db.prepare("UPDATE referral_rewards SET status = 'earned', note = ? WHERE appointment_id = ? AND kind = ? AND partner_id = ? AND status = 'void' AND note IN ('Visit cancelled', 'Visit not completed')")
      .run(note, a.id, kind, partnerId);
  };
  const live = ["confirmed", "completed"].includes(a.status) || ["paid", "partially_refunded"].includes(a.payment_status) && a.status === "pending";
  if (["cancelled", "no_show"].includes(a.status)) {
    db.prepare("UPDATE referral_rewards SET status = 'void', note = 'Visit cancelled' WHERE appointment_id = ? AND status = 'earned'").run(a.id);
    return;
  }
  if (!isOn(db, "referrals")) return;
  const partner = a.referred_by && db.prepare("SELECT id, status FROM partners WHERE id = ?").get(a.referred_by);
  if (!partner || partner.status !== "active") return;
  if (a.referral_partner_id === partner.id && live) add(partner.id, "first_booking", settings.firstBooking, "First booking");
  // A visit set back from completed (a slip of the finger) no longer earns its treatment reward.
  if (a.status !== "completed") {
    db.prepare("UPDATE referral_rewards SET status = 'void', note = 'Visit not completed' WHERE appointment_id = ? AND kind = 'treatment' AND status = 'earned'").run(a.id);
  }
  if (a.status === "completed") {
    const until = new Date(`${String(a.referred_at || "").replace(" ", "T")}Z`);
    until.setUTCMonth(until.getUTCMonth() + settings.months);
    if (!a.referred_at || a.date <= until.toISOString().slice(0, 10)) add(partner.id, "treatment", settings.treatment, "Treatment visit");
  }
}

/** Totals for one partner: earned (unpaid), paid, withdrawn, and how many patients they referred. */
export function partnerTotals(db, partnerId) {
  const sum = (status) => db.prepare("SELECT IFNULL(SUM(amount),0) n FROM referral_rewards WHERE partner_id = ? AND status = ?").get(partnerId, status).n;
  return {
    patients: db.prepare("SELECT COUNT(*) n FROM patients WHERE referred_by = ?").get(partnerId).n,
    visits: db.prepare("SELECT COUNT(*) n FROM referral_rewards WHERE partner_id = ? AND kind = 'treatment' AND status != 'void'").get(partnerId).n,
    due: sum("earned"),
    paid: sum("paid"),
  };
}

/**
 * What a partner may see about the patients they referred: initials, when, and how far they got. No names, phone numbers
 * or health details (patients agree to this much when they enter the code).
 */
export function partnerReferrals(db, partnerId) {
  return db.prepare(
    `SELECT p.id, p.name, p.anonymised_at,
       (SELECT MIN(a.created_at) FROM appointments a WHERE a.patient_id = p.id AND a.referral_partner_id = ?) AS referred_at,
       (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS visits,
       (SELECT IFNULL(SUM(amount),0) FROM referral_rewards r WHERE r.patient_id = p.id AND r.partner_id = ? AND r.status != 'void') AS earned
     FROM patients p WHERE p.referred_by = ? ORDER BY referred_at DESC LIMIT 500`,
  ).all(partnerId, partnerId, partnerId).map((p) => ({
    initials: p.anonymised_at ? "—" : p.name.split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(" ").slice(0, 8),
    referredAt: p.referred_at,
    stage: p.visits ? `${p.visits} visit${p.visits > 1 ? "s" : ""}` : "Booked",
    earned: p.earned,
  }));
}

/** Pay a partner everything earned so far (one manual payment, e.g. at the end of the month). */
export function recordPayout(db, partnerId, { method = "", reference = "", notes = "", by = "" } = {}) {
  const due = db.prepare("SELECT id, amount FROM referral_rewards WHERE partner_id = ? AND status = 'earned'").all(partnerId);
  const amount = due.reduce((t, r) => t + r.amount, 0);
  if (!amount) throw new HttpError(409, "Nothing is due to this partner.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const id = Number(db.prepare("INSERT INTO partner_payouts (partner_id, amount, method, reference, notes, paid_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(partnerId, amount, cleanText(method, 40), cleanText(reference, 80), cleanText(notes, 300), by).lastInsertRowid);
    const mark = db.prepare("UPDATE referral_rewards SET status = 'paid', payout_id = ? WHERE id = ? AND status = 'earned'");
    for (const r of due) mark.run(id, r.id);
    db.exec("COMMIT");
    return { id, amount, count: due.length };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** A patient's own referral ID (created the first time they ask for it). */
export function patientPartner(db, patient) {
  const existing = db.prepare("SELECT * FROM partners WHERE patient_id = ?").get(patient.id);
  if (existing) return existing;
  const id = Number(db.prepare("INSERT INTO partners (code, kind, name, phone, email, patient_id, status, approved_at, approved_by) VALUES (?, 'patient', ?, ?, ?, ?, 'active', datetime('now'), 'automatic (patient)')")
    .run(newPartnerCode(db), patient.name, null, patient.email || null, patient.id).lastInsertRowid);
  return db.prepare("SELECT * FROM partners WHERE id = ?").get(id);
}
