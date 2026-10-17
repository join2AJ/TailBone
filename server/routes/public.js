import { Router } from "express";
import { CLINICS, HOURS, BOOKING, config } from "../config.js";
import { rateLimit } from "../auth.js";
import { clinicNow } from "../time.js";
import {
  HttpError, availableSlots, availableDays, parseBooking, createAppointment, findAppointmentForPatient,
  rescheduleAppointment, cleanText, requireClinic, siteUrl, waLink, prettyDate, prettyTime, normalizePhone, displayName,
} from "../services.js";

/** Public, unauthenticated API used by the website, patient portal and check-in page. */
export function publicRoutes(db) {
  const r = Router();
  const bookingLimit = rateLimit({ windowMs: 60 * 60_000, max: 20, message: "Too many booking attempts. Please call us instead." });
  const lookupLimit = rateLimit({ windowMs: 15 * 60_000, max: 30 });

  const view = (a, req) => ({
    ref: a.ref,
    name: a.patient_name,
    clinic: a.clinic,
    clinicName: CLINICS[a.clinic].name,
    address: CLINICS[a.clinic].address,
    date: a.date,
    time: a.time,
    when: `${prettyDate(a.date)}, ${prettyTime(a.time)}`,
    status: a.status,
    reason: a.reason,
    canChange: ["pending", "confirmed"].includes(a.status) && a.date >= clinicNow().date,
    manageUrl: `${siteUrl(req)}/manage.html?ref=${a.ref}`,
  });

  r.get("/config", (req, res) => {
    res.json({ clinics: Object.values(CLINICS), hours: HOURS, booking: BOOKING, whatsapp: config.whatsappNumber, today: clinicNow().date });
  });

  r.get("/days", (req, res) => {
    res.json({ days: availableDays(db, requireClinic(req.query.clinic), 21) });
  });

  r.get("/slots", (req, res) => {
    res.json(availableSlots(db, req.query.clinic, req.query.date));
  });

  r.post("/appointments", bookingLimit, (req, res) => {
    if (req.body.website) throw new HttpError(400, "Invalid submission."); // honeypot field
    const data = parseBooking(req.body);
    const appt = createAppointment(db, data, { source: "web" });
    const text = `Hello Dr Rajveer Singh, I just booked appointment ${appt.ref} for ${prettyDate(appt.date)} at ${prettyTime(appt.time)} (${CLINICS[appt.clinic].short}).`;
    res.status(201).json({ appointment: view(appt, req), whatsappUrl: waLink(config.whatsappNumber, text) });
  });

  // Patient self-service: lookup needs both the booking reference and phone number.
  r.post("/manage/lookup", lookupLimit, (req, res) => {
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    if (!appt) throw new HttpError(404, "We couldn't find a booking with that reference and phone number.");
    const upcoming = db.prepare(
      `SELECT * FROM appointments WHERE patient_id = ? AND id != ? AND status IN ('pending','confirmed') AND date >= ? ORDER BY date, time`,
    ).all(appt.patient_id, appt.id, clinicNow().date).map((a) => view({ ...a, patient_name: appt.patient_name }, req));
    res.json({ appointment: view(appt, req), others: upcoming });
  });

  r.post("/manage/cancel", lookupLimit, (req, res) => {
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    if (!appt) throw new HttpError(404, "Booking not found.");
    if (!view(appt, req).canChange) throw new HttpError(409, "This appointment can no longer be cancelled online. Please call us.");
    db.prepare("UPDATE appointments SET status = 'cancelled', notes = notes || ?, updated_at = datetime('now') WHERE id = ?")
      .run(`${appt.notes ? "\n" : ""}Cancelled by patient online${req.body.reason ? `: ${cleanText(req.body.reason, 300)}` : ""}`, appt.id);
    res.json({ appointment: view(findAppointmentForPatient(db, appt.ref, appt.patient_phone), req) });
  });

  r.post("/manage/reschedule", lookupLimit, (req, res) => {
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    if (!appt) throw new HttpError(404, "Booking not found.");
    if (!view(appt, req).canChange) throw new HttpError(409, "This appointment can no longer be changed online. Please call us.");
    const updated = rescheduleAppointment(db, appt, req.body.date, req.body.time);
    res.json({ appointment: view(updated, req) });
  });

  // Follow-up check-ins: the token in the link is the credential.
  const findFollowup = (token) => db.prepare(
    `SELECT f.*, p.name AS patient_name FROM followups f JOIN patients p ON p.id = f.patient_id WHERE f.token = ?`,
  ).get(cleanText(token, 64));

  r.get("/checkin/:token", lookupLimit, (req, res) => {
    const fu = findFollowup(req.params.token);
    if (!fu) throw new HttpError(404, "This check-in link is not valid.");
    res.json({ firstName: fu.patient_name.split(" ")[0], dueDate: fu.due_date, done: fu.status !== "pending" });
  });

  r.post("/checkin/:token", lookupLimit, (req, res) => {
    const fu = findFollowup(req.params.token);
    if (!fu) throw new HttpError(404, "This check-in link is not valid.");
    if (fu.status !== "pending") throw new HttpError(409, "Thanks, we've already received this check-in.");
    const pain = Number(req.body.painScore);
    if (!Number.isInteger(pain) || pain < 0 || pain > 10) throw new HttpError(400, "Please choose a pain score from 0 to 10.");
    const trend = ["better", "same", "worse"].includes(req.body.trend) ? req.body.trend : null;
    if (!trend) throw new HttpError(400, "Please tell us whether you feel better, the same or worse.");
    const sitting = req.body.sittingMinutes === "" || req.body.sittingMinutes == null ? null : Math.max(0, Math.min(600, Math.round(Number(req.body.sittingMinutes)) || 0));
    db.prepare("INSERT INTO checkins (followup_id, patient_id, pain_score, sitting_minutes, trend, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(fu.id, fu.patient_id, pain, sitting, trend, cleanText(req.body.notes, 1000));
    db.prepare("UPDATE followups SET status = 'done', completed_at = datetime('now') WHERE id = ?").run(fu.id);
    res.status(201).json({ ok: true, needsAttention: trend === "worse" || pain >= 7 });
  });

  // ---------- Patient stories ----------
  const storyLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Thanks! You've already shared a story recently." });

  r.get("/stories", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 60);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = db.prepare(
      `SELECT id, name, city, rating, title, body, duration, featured, published_at FROM stories
       WHERE status = 'approved' ORDER BY featured DESC, published_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset);
    const total = db.prepare("SELECT COUNT(*) n, ROUND(AVG(rating),1) avg FROM stories WHERE status = 'approved'").get();
    res.json({
      stories: rows.map((s) => ({ ...s, name: displayName(s.name), featured: !!s.featured })),
      total: total.n,
      average: total.avg,
    });
  });

  r.post("/stories", storyLimit, (req, res) => {
    if (req.body.website) throw new HttpError(400, "Invalid submission.");
    const name = cleanText(req.body.name, 80);
    const body = cleanText(req.body.body, 2000);
    const rating = Number(req.body.rating);
    if (name.length < 2) throw new HttpError(400, "Please tell us your name.");
    if (body.length < 30) throw new HttpError(400, "Please write at least a couple of sentences about your experience.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Please choose a rating.");
    if (!req.body.consent) throw new HttpError(400, "Please confirm we may publish your story.");
    db.prepare("INSERT INTO stories (name, city, rating, title, body, duration, phone) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(name, cleanText(req.body.city, 60), rating, cleanText(req.body.title, 100), body, cleanText(req.body.duration, 60), normalizePhone(req.body.phone));
    res.status(201).json({ ok: true });
  });

  // ---------- Instagram highlights ----------
  r.get("/media", (req, res) => {
    res.json({ media: db.prepare("SELECT id, url, kind, caption FROM media WHERE visible = 1 ORDER BY sort, id DESC LIMIT 12").all() });
  });

  return r;
}
