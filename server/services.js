import crypto from "node:crypto";
import { config, CLINICS, BOOKING } from "./config.js";
import { tx, patientCode, nextApptNo } from "./db.js";
import { clinicNow, slotsForDate, isBookableTime, addDays, isDate, isTime } from "./time.js";
import { encrypt, decryptFields } from "./crypto.js";
import { getPolicy, priceFor, refundQuote, isClinicOpen, policySnapshot } from "./policy.js";
import { paymentsEnabled, refundPayment, rupees } from "./payments.js";
import { notify } from "./notify.js";
import { isOn } from "./features.js";
import { syncAppointment, isBusy } from "./gcal.js";
import { syncRewards } from "./referrals.js";

/** Mirror an appointment to Google Calendar in the background (no-op unless configured). */
export const calendarSync = (db, id) => { syncAppointment(db, id, { getAppointment }).catch(() => {}); };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Validation helpers ----------

/** Normalise to digits with country code; 10-digit numbers are assumed Indian. */
export function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function cleanText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

export function validEmail(value) {
  const v = cleanText(value, 200);
  if (!v) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, "Please enter a valid email address.");
  return v;
}

export function requireClinic(clinic) {
  if (!CLINICS[clinic]) throw new HttpError(400, "Please choose a valid clinic.");
  return clinic;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRef() {
  const bytes = crypto.randomBytes(6);
  return `TB-${[...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

export const makeToken = () => crypto.randomBytes(18).toString("base64url");

// ---------- Availability ----------

export function isBlocked(db, clinic, date) {
  return !!db.prepare("SELECT 1 FROM blocked_dates WHERE date = ? AND clinic IN ('all', ?)").get(date, clinic);
}

/** Free slots held by online bookings that were never paid for. */
export function releaseExpiredHolds(db) {
  const expired = db.prepare(
    "SELECT id FROM appointments WHERE status = 'pending' AND payment_status = 'awaiting' AND hold_until IS NOT NULL AND hold_until < datetime('now')",
  ).all();
  for (const { id } of expired) {
    db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'system', updated_at = datetime('now') WHERE id = ?").run(id);
    logEvent(db, id, "system", "", "hold_expired", "Payment not completed in time; slot released.");
  }
  return expired.length;
}

export function availableSlots(db, clinic, date, now = new Date(), { skipRelease = false } = {}) {
  requireClinic(clinic);
  if (!isDate(date)) throw new HttpError(400, "Invalid date.");
  if (!skipRelease) releaseExpiredHolds(db);
  if (isBlocked(db, clinic, date)) return { date, clinic, closed: true, slots: [] };
  const taken = new Set(
    db.prepare("SELECT time FROM appointments WHERE clinic = ? AND date = ? AND status IN ('pending','confirmed')")
      .all(clinic, date).map((r) => r.time),
  );
  const all = slotsForDate(date);
  return {
    date,
    clinic,
    closed: all.length === 0,
    slots: all.map((time) => ({ time, available: !taken.has(time) && !isBusy(date, time) && isBookableTime(date, time, now) })),
  };
}

/** Next N dates with at least one free slot, used for the date strip. */
export function availableDays(db, clinic, days = 14, now = new Date()) {
  releaseExpiredHolds(db);
  const start = clinicNow(now).date;
  const out = [];
  for (let i = 0; i <= BOOKING.windowDays && out.length < days; i++) {
    const date = addDays(start, i);
    const { slots } = availableSlots(db, clinic, date, now, { skipRelease: true });
    out.push({ date, free: slots.filter((s) => s.available).length });
  }
  return out;
}

// ---------- Audit trail ----------

// Status and payment changes that can earn or withdraw a referral reward (see referrals.js).
const REWARD_ACTIONS = new Set(["booked", "confirmed", "completed", "pending", "cancelled", "no_show", "paid", "hold_expired"]);

export function logEvent(db, appointmentId, actor, actorName, action, detail = "") {
  db.prepare("INSERT INTO appointment_events (appointment_id, actor, actor_name, action, detail) VALUES (?, ?, ?, ?, ?)")
    .run(appointmentId, actor, actorName || "", action, cleanText(detail, 500));
  if (REWARD_ACTIONS.has(action)) syncRewards(db, appointmentId);
}

export function appointmentEvents(db, appointmentId) {
  return db.prepare("SELECT * FROM appointment_events WHERE appointment_id = ? ORDER BY id").all(appointmentId);
}

// ---------- Patients & appointments ----------

const APPT_SECRET_FIELDS = ["reason", "notes"];
const APPT_SELECT = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email, p.patient_code
  FROM appointments a JOIN patients p ON p.id = a.patient_id`;

/** Decrypt the sensitive fields of an appointment row read with APPT_SELECT. */
export const readAppt = (row) => decryptFields(row, APPT_SECRET_FIELDS);
export { APPT_SELECT };

/**
 * Find the patient by phone, or create them. Only the clinic (`update: true`) may change an existing patient's name or email:
 * a website booking proves nothing about who owns the phone number, so it must never overwrite a real patient's details.
 */
export function upsertPatient(db, { name, phone, email }, { update = false } = {}) {
  const existing = db.prepare("SELECT * FROM patients WHERE phone = ?").get(phone);
  if (existing) {
    if (update) db.prepare("UPDATE patients SET name = ?, email = COALESCE(NULLIF(?, ''), email) WHERE id = ?").run(name, email || "", existing.id);
    else if (!existing.email && email) db.prepare("UPDATE patients SET email = ? WHERE id = ?").run(email, existing.id);
    return existing.id;
  }
  const id = Number(db.prepare("INSERT INTO patients (name, phone, email) VALUES (?, ?, ?)").run(name, phone, email || null).lastInsertRowid);
  db.prepare("UPDATE patients SET patient_code = ? WHERE id = ?").run(patientCode(id), id);
  return id;
}

export function parseBooking(body, { allowAnyTime = false } = {}) {
  const name = cleanText(body.name, 120);
  if (name.length < 2) throw new HttpError(400, "Please enter your full name.");
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Please enter a valid phone number.");
  const clinic = requireClinic(body.clinic);
  if (!isDate(body.date) || !isTime(body.time)) throw new HttpError(400, "Please choose a date and time.");
  if (!allowAnyTime && !isBookableTime(body.date, body.time)) throw new HttpError(409, "That time is no longer available. Please pick another slot.");
  return {
    name,
    phone,
    email: validEmail(body.email),
    clinic,
    date: body.date,
    time: body.time,
    reason: cleanText(body.reason, 1000),
    prefersFemale: body.prefersFemale ? 1 : 0,
  };
}

/**
 * Create a booking. Website bookings that must be paid online are held for `holdMinutes`
 * (payment_status = 'awaiting'); if payment doesn't arrive the slot is released automatically.
 */
export function createAppointment(db, data, { source = "web", status = "pending", actorName = "" } = {}) {
  if (source === "web" && isBlocked(db, data.clinic, data.date)) throw new HttpError(409, "The clinic is closed on that day. Please choose another date.");
  releaseExpiredHolds(db);
  const policy = getPolicy(db);
  if (source === "web" && !isClinicOpen(policy, data.clinic)) {
    throw new HttpError(409, `The ${CLINICS[data.clinic].short} clinic is not taking bookings. Please choose another clinic or an online consultation.`);
  }
  try {
    const created = tx(db, () => {
      const patientId = upsertPatient(db, data, { update: source !== "web" });
      // Guard against the same patient stacking several future bookings from the website.
      if (source === "web") {
        const active = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status IN ('pending','confirmed') AND date >= ?")
          .get(patientId, clinicNow().date).n;
        if (active >= 3) throw new HttpError(409, "You already have several upcoming bookings. Please manage them from 'My appointments' or call us.");
      }
      const price = priceFor(db, policy, { clinic: data.clinic, patientId, date: data.date });
      const payOnline = source === "web" && paymentsEnabled() && policy.payments.mode === "online" && isOn(db, "online_payments") && price.fee > 0;
      const split = payOnline && policy.commission.enabled && policy.commission.doctorAccountId ? price.platformFee : 0;
      const paymentStatus = payOnline ? "awaiting" : price.fee > 0 ? "pay_at_clinic" : "unpaid";
      const holdUntil = payOnline ? new Date(Date.now() + policy.holdMinutes * 60_000).toISOString().replace("T", " ").slice(0, 19) : null;
      const ref = makeRef();
      const id = Number(db.prepare(
        `INSERT INTO appointments (ref, appt_no, patient_id, clinic, date, time, status, reason, source, prefers_female,
           visit_type, fee, platform_fee, payment_status, hold_until, policy_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ref, nextApptNo(db), patientId, data.clinic, data.date, data.time, status, encrypt(data.reason), source, data.prefersFemale,
        price.visitType, price.fee, split, paymentStatus, holdUntil, policySnapshot(policy)).lastInsertRowid);
      logEvent(db, id, source === "web" ? "patient" : "clinic", source === "web" ? data.name : actorName, "booked",
        `${CLINICS[data.clinic].short}, ${data.date} ${data.time}${price.visitType === "followup" ? " (follow-up rate)" : ""}`);
      return getAppointment(db, id);
    });
    if (created.payment_status !== "awaiting") calendarSync(db, created.id);
    return created;
  } catch (err) {
    if (String(err.message).includes("UNIQUE") && String(err.message).includes("appointments")) {
      throw new HttpError(409, "Sorry, that slot was just taken. Please pick another time.");
    }
    throw err;
  }
}

export function getAppointment(db, id) {
  return readAppt(db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id));
}

export function findAppointmentForPatient(db, ref, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized || !ref) return null;
  // The appointment number (TBA-2610-0007) is the patient's reference; older TB-XXXXXX codes still work.
  // Accept it however it's typed: "tba 2610 0007", "TBA26100007", "tb-demo42".
  const compact = String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const key = /^TBA\d{8,}$/.test(compact) ? `TBA-${compact.slice(3, 7)}-${compact.slice(7)}`
    : /^TB[A-Z0-9]{6}$/.test(compact) ? `TB-${compact.slice(2)}` : cleanText(ref, 20).toUpperCase();
  return readAppt(db.prepare(`${APPT_SELECT} WHERE (a.appt_no = ? OR a.ref = ?) AND p.phone = ?`).get(key, key, normalized));
}

/**
 * Whether a booking proves the person looking it up owns the patient record: the clinic made or confirmed it (and so has been
 * in touch with that phone number), or the visit took place. A brand-new website booking only proves someone knew the phone number,
 * so it may show that one booking but not the patient's other appointments or their data.
 */
export function isVerifiedBooking(db, appt) {
  if (appt.status === "completed" || appt.source !== "web") return true;
  return !!db.prepare("SELECT 1 FROM appointment_events WHERE appointment_id = ? AND actor = 'clinic' AND action IN ('confirmed','completed')").get(appt.id);
}

export function rescheduleAppointment(db, appt, date, time, { allowAnyTime = false, actor = "patient", actorName = "" } = {}) {
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, "Please choose a date and time.");
  if (!allowAnyTime && (!isBookableTime(date, time) || isBlocked(db, appt.clinic, date))) {
    throw new HttpError(409, "That time is not available. Please pick another slot.");
  }
  try {
    db.prepare(
      `UPDATE appointments SET date = ?, time = ?, reschedule_count = reschedule_count + ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(date, time, actor === "patient" ? 1 : 0, appt.id);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Sorry, that slot is taken. Please pick another time.");
    throw err;
  }
  logEvent(db, appt.id, actor, actorName, "rescheduled", `${appt.date} ${appt.time} → ${date} ${time}`);
  calendarSync(db, appt.id);
  return getAppointment(db, appt.id);
}

/**
 * Issue a refund through the gateway (or record a manual one for pay-at-clinic bookings).
 * Never throws for gateway failures: the failure is recorded so the clinic can retry.
 */
export async function issueRefund(db, appt, amount, { reason = "", actor = "clinic", actorName = "" } = {}) {
  const refundable = Math.max(0, appt.amount_paid - appt.amount_refunded);
  const value = Math.min(Math.max(0, Math.round(amount)), refundable);
  if (!value) return null;
  const refundId = Number(db.prepare("INSERT INTO refunds (appointment_id, amount, reason) VALUES (?, ?, ?)").run(appt.id, value, cleanText(reason, 250)).lastInsertRowid);
  const settle = (status, providerId = null, error = "") => {
    db.prepare("UPDATE refunds SET status = ?, provider_refund_id = ?, error = ? WHERE id = ?").run(status, providerId, cleanText(error, 300), refundId);
    if (status !== "failed") {
      db.prepare(
        `UPDATE appointments SET amount_refunded = amount_refunded + ?,
           payment_status = CASE WHEN amount_refunded + ? >= amount_paid THEN 'refunded' ELSE 'partially_refunded' END,
           updated_at = datetime('now') WHERE id = ?`,
      ).run(value, value, appt.id);
    }
    logEvent(db, appt.id, actor, actorName, status === "failed" ? "refund_failed" : "refunded", `${rupees(value)}${error ? ` · ${error}` : ""}`);
    return { id: refundId, amount: value, status, error };
  };
  if (!appt.payment_id || !paymentsEnabled()) return settle("manual");
  try {
    const r = await refundPayment(appt.payment_id, value, { reason, split: appt.platform_fee > 0 });
    return settle("processed", r.id);
  } catch (err) {
    return settle("failed", null, err.message);
  }
}

/**
 * Cancel an appointment applying the refund policy, log it and notify the other side.
 * Clinic cancellations refund in full; patient cancellations follow the time-based tiers.
 */
export async function cancelAppointment(db, appt, { actor, actorName = "", reason = "", noShow = false, base } = {}) {
  if (!["pending", "confirmed"].includes(appt.status) && !(noShow && appt.status !== "cancelled")) {
    throw new HttpError(409, "This appointment is already closed.");
  }
  const policy = getPolicy(db);
  const quote = refundQuote(appt, policy, { actor, noShow });
  db.prepare("UPDATE appointments SET status = ?, cancelled_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(noShow ? "no_show" : "cancelled", noShow ? null : actor, appt.id);
  logEvent(db, appt.id, actor, actorName, noShow ? "no_show" : "cancelled", [reason && `Reason: ${reason}`, quote.refundable ? quote.rule : ""].filter(Boolean).join(" · "));
  const refund = quote.amount ? await issueRefund(db, appt, quote.amount, { reason: noShow ? "no-show" : `cancelled by ${actor}`, actor, actorName }) : null;
  const updated = getAppointment(db, appt.id);
  calendarSync(db, appt.id);
  notify(db, noShow ? "no_show" : "cancelled", updated, { base, actor, reason, refund: refund && { amount: refund.amount, percent: quote.percent } });
  return { appointment: updated, quote, refund };
}

/** Mark an online payment as captured (from Checkout callback or webhook). Idempotent. */
export async function markPaid(db, appt, { paymentId, amount, base }) {
  if (appt.payment_status === "paid" || appt.payment_status.includes("refunded")) return { appointment: appt, already: true };
  const paid = amount ?? appt.fee;
  if (appt.status === "cancelled" && appt.cancelled_by === "system") {
    // Payment arrived after the hold expired. Re-take the slot if still free, otherwise refund in full.
    try {
      db.prepare("UPDATE appointments SET status = 'pending', cancelled_by = NULL WHERE id = ?").run(appt.id);
    } catch {
      db.prepare("UPDATE appointments SET payment_id = ?, amount_paid = ?, payment_status = 'paid' WHERE id = ?").run(paymentId, paid, appt.id);
      logEvent(db, appt.id, "system", "", "paid_late", "Payment received after the slot was released; refunding in full.");
      await issueRefund(db, getAppointment(db, appt.id), paid, { reason: "slot no longer available", actor: "system" });
      throw new HttpError(409, "Your payment arrived after the slot was released and someone else booked it. A full refund has been issued. Please choose another time.");
    }
  }
  if (["cancelled", "no_show"].includes(appt.status) && appt.cancelled_by !== "system") {
    // The booking was cancelled (by the patient or the clinic) before the payment arrived: record it, then refund it in full.
    db.prepare("UPDATE appointments SET payment_id = ?, amount_paid = ?, payment_status = 'paid', hold_until = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(paymentId, paid, appt.id);
    logEvent(db, appt.id, "system", "", "paid_late", "Payment received after the booking was cancelled; refunding in full.");
    await issueRefund(db, getAppointment(db, appt.id), paid, { reason: "booking already cancelled", actor: "system" });
    throw new HttpError(409, "This booking was cancelled before your payment arrived, so we have refunded it in full. Please book again if you'd like a new appointment.");
  }
  db.prepare(
    `UPDATE appointments SET payment_id = ?, amount_paid = ?, payment_status = 'paid', hold_until = NULL,
       status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
  ).run(paymentId, paid, appt.id);
  logEvent(db, appt.id, "patient", appt.patient_name, "paid", `${rupees(paid)} · ${paymentId}`);
  ensureReceiptNo(db, appt.id);
  calendarSync(db, appt.id);
  const updated = getAppointment(db, appt.id);
  notify(db, "booked", updated, { base });
  return { appointment: updated };
}

// ---------- Payment receipts ----------
// A receipt (not a tax invoice) for every fee paid, online or at the clinic. Numbers run per month in clinic time
// (TBR-2610-0001…) and are given once, when the payment is recorded, so a receipt never changes number.

export function ensureReceiptNo(db, appointmentId) {
  const row = db.prepare("SELECT receipt_no, amount_paid FROM appointments WHERE id = ?").get(appointmentId);
  if (!row || row.receipt_no || !(row.amount_paid > 0)) return row?.receipt_no || null;
  const ist = new Date(Date.now() + 330 * 60_000);
  const prefix = `TBR-${String(ist.getUTCFullYear()).slice(2)}${String(ist.getUTCMonth() + 1).padStart(2, "0")}-`;
  const last = db.prepare("SELECT receipt_no FROM appointments WHERE receipt_no LIKE ? ORDER BY receipt_no DESC LIMIT 1").get(`${prefix}%`);
  const no = `${prefix}${String(last ? Number(last.receipt_no.slice(prefix.length)) + 1 : 1).padStart(4, "0")}`;
  db.prepare("UPDATE appointments SET receipt_no = ? WHERE id = ? AND receipt_no IS NULL").run(no, appointmentId);
  return db.prepare("SELECT receipt_no FROM appointments WHERE id = ?").get(appointmentId).receipt_no;
}

/** Everything printed on a payment receipt. Null when nothing has been paid. */
export function receiptFor(db, appt) {
  if (!appt || !(appt.amount_paid > 0)) return null;
  const receiptNo = ensureReceiptNo(db, appt.id);
  const paidAt = db.prepare("SELECT created_at FROM appointment_events WHERE appointment_id = ? AND action IN ('paid','paid_late') ORDER BY id LIMIT 1").get(appt.id)?.created_at
    || appt.updated_at || appt.created_at;
  const method = String(appt.payment_id || "").startsWith("clinic-")
    ? `${{ upi: "UPI", cash: "Cash", card: "Card" }[appt.payment_id.slice(7)] || "Paid"} at the clinic`
    : "Online (Razorpay)";
  const clinic = CLINICS[appt.clinic];
  const service = `${appt.visit_type === "followup" ? "Follow-up consultation" : "Consultation"}${appt.clinic === "online" ? " (online video)" : `, ${clinic.short}`}`;
  return {
    receiptNo,
    issuedAt: paidAt,
    issuer: { name: "Tailbone Treatment Clinic", practitioner: "Dr Rajveer Singh", address: CLINICS.del.address, phone: "+91 98866 88323", email: "contact@tailbonetreatment.com" },
    patient: { name: appt.patient_name, code: appt.patient_code },
    appointment: { no: appt.appt_no || appt.ref, date: appt.date, time: appt.time, when: `${prettyDate(appt.date)}, ${prettyTime(appt.time)}`, clinic: clinic.name, status: appt.status },
    service,
    fee: appt.fee,
    paid: appt.amount_paid,
    method,
    paymentId: String(appt.payment_id || "").startsWith("clinic-") ? "" : appt.payment_id || "",
    refunds: db.prepare("SELECT amount, status, created_at FROM refunds WHERE appointment_id = ? AND status != 'failed' ORDER BY id").all(appt.id),
    refunded: appt.amount_refunded,
    net: appt.amount_paid - appt.amount_refunded,
  };
}

// ---------- Follow-ups ----------

export const FOLLOWUP_TYPES = ["checkin", "call", "visit", "whatsapp"];

export function createFollowup(db, { patientId, appointmentId = null, dueDate, type = "checkin", notes = "" }) {
  if (!isDate(dueDate)) throw new HttpError(400, "Invalid follow-up date.");
  if (!FOLLOWUP_TYPES.includes(type)) throw new HttpError(400, "Invalid follow-up type.");
  const id = db.prepare("INSERT INTO followups (patient_id, appointment_id, due_date, type, notes, token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(patientId, appointmentId, dueDate, type, encrypt(cleanText(notes, 1000)), makeToken()).lastInsertRowid;
  return db.prepare("SELECT * FROM followups WHERE id = ?").get(Number(id));
}

export const defaultFollowupDate = () => addDays(clinicNow().date, BOOKING.defaultFollowupDays);

// ---------- Message templates (WhatsApp click-to-send) ----------

const prettyDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const prettyTime = (time) => { const [h, m] = time.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export { prettyDate, prettyTime };

export function siteUrl(req) {
  // Never build patient links from the request's Host header in production: it is set by the caller and could
  // turn the clinic's own WhatsApp messages into phishing links. Set SITE_URL; the public site is the fallback.
  if (config.siteUrl) return config.siteUrl;
  return config.isProd ? "https://tailbone.netlify.app" : `${req.protocol}://${req.get("host")}`;
}

export function waLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function messages(appt, base, videoUrl = "") {
  const first = appt.patient_name.split(" ")[0];
  const when = `${prettyDate(appt.date)} at ${prettyTime(appt.time)}`;
  const where = CLINICS[appt.clinic];
  const no = appt.appt_no || appt.ref; // the appointment number is the patient's reference
  const manage = `${base}/manage.html?ref=${no}`;
  const online = appt.clinic === "online";
  const joinHow = `Join the video call from My appointments (the button appears 15 minutes before): ${manage}`;
  return {
    confirm: `Hi ${first}, your appointment at Tailbone Treatment Clinic is confirmed for ${when} (${where.short}).\n${online ? joinHow : where.address}\nAppointment no.: ${no}${online ? "" : `\nManage or reschedule: ${manage}`}`,
    reminder: `Hi ${first}, a reminder of your appointment tomorrow, ${when}, ${online ? `online. ${joinHow}` : `at our ${where.short} clinic.`} Appointment no.: ${no}. Reply here if you need to reschedule.`,
    cancelled: `Hi ${first}, your appointment on ${when} (appointment no. ${no}) has been cancelled. To book a new time, visit ${base}/book or reply to this message.`,
    video: online ? `Hi ${first}, here is the link for your online consultation with Dr Rajveer Singh on ${when}: ${videoUrl || manage}\nPlease join from a quiet, well-lit place. You can also join from My appointments: ${manage}` : "",
  };
}

export function checkinMessage(patientName, token, base) {
  const first = patientName.split(" ")[0];
  return `Hi ${first}, it's Dr Rajveer Singh's team from Tailbone Treatment Clinic. How is your tailbone feeling? Please take 30 seconds to tell us: ${base}/checkin.html?t=${token}`;
}

// ---------- Stories & Instagram media ----------

/** Accepts instagram.com post/reel links and returns a canonical URL, or null. */
export function normalizeInstagramUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (u.protocol !== "https:" || !/^(www\.)?instagram\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})\/?$/);
  if (!m) return null;
  const kind = m[1] === "p" ? "post" : "reel";
  return { url: `https://www.instagram.com/${kind === "post" ? "p" : "reel"}/${m[2]}/`, kind };
}

/** First name + last initial, so published stories don't expose full names. */
export function displayName(name) {
  const parts = cleanText(name, 120).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Patient";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const SEED_STORIES = [
  ["Sneha", "", "My problem is finally sorted", "My problem is finally sorted. I'm so grateful to Dr Rajveer for his care."],
  ["Naresh", "Bengaluru", "The person I'd send you to", "If you have sacrum, coccyx or tailbone pain in Bengaluru, he's the person I'd send you to."],
  ["Ishwinder Pal Singh", "", "Our whole family is thankful", "Few people in India or the Middle East practise Internal Manipulation. Our whole family is thankful we found him."],
  ["Sudarshan", "", "Quick and respectful", "He replies to calls, texts and email. The procedure was quick and neither painful nor embarrassing."],
  ["Anshuman", "", "One visit was enough", "One visit was all it took to sort out my problem."],
  ["Suman", "", "90–95% better in two months", "About 70% better by day ten of following his advice, and 90–95% after two months."],
  ["Rasheeda", "", "Completely at ease", "The female doctor trained under Dr Rajveer made me feel completely at ease."],
  ["Fatima", "", "I got my life back", "This pain can really wear you down. His diagnosis and treatment plan gave me my life back."],
  ["Sachin", "", "Excellent guidance", "He clearly understands coccyx injuries and their complications. His guidance was excellent."],
];

/** Seed the existing website testimonials once, so the stories section is never empty. */
export function seedStories(db) {
  // Seed once. A flag (not "table is empty") so stories the clinic deletes don't come back on restart.
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'stories_seeded'").get()) return;
  db.prepare("INSERT INTO settings (key, value) VALUES ('stories_seeded', 'true')").run();
  if (db.prepare("SELECT COUNT(*) n FROM stories").get().n > 0) return;
  const insert = db.prepare("INSERT INTO stories (name, city, title, body, status, featured, source, published_at) VALUES (?, ?, ?, ?, 'approved', ?, 'seed', datetime('now'))");
  SEED_STORIES.forEach(([name, city, title, body], i) => insert.run(name, city, title, body, i < 6 ? 1 : 0));
}
