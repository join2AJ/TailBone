import crypto from "node:crypto";
import { config, CLINICS, BOOKING } from "./config.js";
import { tx } from "./db.js";
import { clinicNow, slotsForDate, isBookableTime, addDays, isDate, isTime } from "./time.js";

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

export function availableSlots(db, clinic, date, now = new Date()) {
  requireClinic(clinic);
  if (!isDate(date)) throw new HttpError(400, "Invalid date.");
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
    slots: all.map((time) => ({ time, available: !taken.has(time) && isBookableTime(date, time, now) })),
  };
}

/** Next N dates with at least one free slot, used for the date strip. */
export function availableDays(db, clinic, days = 14, now = new Date()) {
  const start = clinicNow(now).date;
  const out = [];
  for (let i = 0; i <= BOOKING.windowDays && out.length < days; i++) {
    const date = addDays(start, i);
    const { slots } = availableSlots(db, clinic, date, now);
    out.push({ date, free: slots.filter((s) => s.available).length });
  }
  return out;
}

// ---------- Patients & appointments ----------

export function upsertPatient(db, { name, phone, email }) {
  const existing = db.prepare("SELECT * FROM patients WHERE phone = ?").get(phone);
  if (existing) {
    db.prepare("UPDATE patients SET name = ?, email = COALESCE(NULLIF(?, ''), email) WHERE id = ?").run(name, email || "", existing.id);
    return existing.id;
  }
  return Number(db.prepare("INSERT INTO patients (name, phone, email) VALUES (?, ?, ?)").run(name, phone, email || null).lastInsertRowid);
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

export function createAppointment(db, data, { source = "web", status = "pending" } = {}) {
  if (source === "web" && isBlocked(db, data.clinic, data.date)) throw new HttpError(409, "The clinic is closed on that day. Please choose another date.");
  try {
    return tx(db, () => {
      const patientId = upsertPatient(db, data);
      // Guard against the same patient stacking several future bookings from the website.
      if (source === "web") {
        const active = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status IN ('pending','confirmed') AND date >= ?")
          .get(patientId, clinicNow().date).n;
        if (active >= 3) throw new HttpError(409, "You already have several upcoming bookings. Please manage them from 'My appointments' or call us.");
      }
      const ref = makeRef();
      const id = db.prepare(
        `INSERT INTO appointments (ref, patient_id, clinic, date, time, status, reason, source, prefers_female)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ref, patientId, data.clinic, data.date, data.time, status, data.reason, source, data.prefersFemale).lastInsertRowid;
      return getAppointment(db, Number(id));
    });
  } catch (err) {
    if (String(err.message).includes("UNIQUE") && String(err.message).includes("appointments")) {
      throw new HttpError(409, "Sorry, that slot was just taken. Please pick another time.");
    }
    throw err;
  }
}

export function getAppointment(db, id) {
  return db.prepare(
    `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.email AS patient_email
     FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?`,
  ).get(id);
}

export function findAppointmentForPatient(db, ref, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized || !ref) return null;
  return db.prepare(
    `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
     FROM appointments a JOIN patients p ON p.id = a.patient_id
     WHERE a.ref = ? COLLATE NOCASE AND p.phone = ?`,
  ).get(cleanText(ref, 20).toUpperCase(), normalized);
}

export function rescheduleAppointment(db, appt, date, time, { allowAnyTime = false } = {}) {
  if (!isDate(date) || !isTime(time)) throw new HttpError(400, "Please choose a date and time.");
  if (!allowAnyTime && (!isBookableTime(date, time) || isBlocked(db, appt.clinic, date))) {
    throw new HttpError(409, "That time is not available. Please pick another slot.");
  }
  try {
    db.prepare("UPDATE appointments SET date = ?, time = ?, status = CASE WHEN status = 'confirmed' THEN 'pending' ELSE status END, updated_at = datetime('now') WHERE id = ?")
      .run(date, time, appt.id);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Sorry, that slot is taken. Please pick another time.");
    throw err;
  }
  return getAppointment(db, appt.id);
}

// ---------- Follow-ups ----------

export const FOLLOWUP_TYPES = ["checkin", "call", "visit", "whatsapp"];

export function createFollowup(db, { patientId, appointmentId = null, dueDate, type = "checkin", notes = "" }) {
  if (!isDate(dueDate)) throw new HttpError(400, "Invalid follow-up date.");
  if (!FOLLOWUP_TYPES.includes(type)) throw new HttpError(400, "Invalid follow-up type.");
  const id = db.prepare("INSERT INTO followups (patient_id, appointment_id, due_date, type, notes, token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(patientId, appointmentId, dueDate, type, cleanText(notes, 1000), makeToken()).lastInsertRowid;
  return db.prepare("SELECT * FROM followups WHERE id = ?").get(Number(id));
}

export const defaultFollowupDate = () => addDays(clinicNow().date, BOOKING.defaultFollowupDays);

// ---------- Message templates (WhatsApp click-to-send) ----------

const prettyDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const prettyTime = (time) => { const [h, m] = time.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export { prettyDate, prettyTime };

export function siteUrl(req) {
  return config.siteUrl || `${req.protocol}://${req.get("host")}`;
}

export function waLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function messages(appt, base) {
  const first = appt.patient_name.split(" ")[0];
  const when = `${prettyDate(appt.date)} at ${prettyTime(appt.time)}`;
  const where = CLINICS[appt.clinic];
  const manage = `${base}/manage.html?ref=${appt.ref}`;
  return {
    confirm: `Hi ${first}, your appointment at Tailbone Treatment Clinic is confirmed for ${when} (${where.short}).\n${where.address}\nRef: ${appt.ref}\nManage or reschedule: ${manage}`,
    reminder: `Hi ${first}, a reminder of your appointment tomorrow, ${when}, at our ${where.short} ${appt.clinic === "online" ? "consultation (we'll send the video link shortly)" : "clinic"}. Ref: ${appt.ref}. Reply here if you need to reschedule.`,
    cancelled: `Hi ${first}, your appointment on ${when} (Ref ${appt.ref}) has been cancelled. To book a new time, visit ${base}/#appointment or reply to this message.`,
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
  if (db.prepare("SELECT COUNT(*) n FROM stories").get().n > 0) return;
  const insert = db.prepare("INSERT INTO stories (name, city, title, body, status, featured, source, published_at) VALUES (?, ?, ?, ?, 'approved', ?, 'seed', datetime('now'))");
  SEED_STORIES.forEach(([name, city, title, body], i) => insert.run(name, city, title, body, i < 6 ? 1 : 0));
}
