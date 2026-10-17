import { Router } from "express";
import { CLINICS, HOURS, BOOKING, config } from "../config.js";
import { rateLimit } from "../auth.js";
import { clinicNow } from "../time.js";
import { encrypt } from "../crypto.js";
import { getPolicy, policySummary, refundQuote, rescheduleCheck, isClinicOpen, policyUpdatedAt } from "../policy.js";
import { paymentsEnabled, publicKeyId, createOrder, verifyCheckoutSignature, verifyWebhookSignature, rupees } from "../payments.js";
import { notify } from "../notify.js";
import { DEMO_PATIENT } from "../demo.js";
import { getFeatures, isOn } from "../features.js";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { ensureBusy, isBusy, googleCalendarLink, calendarFeed } from "../gcal.js";
import { addDays } from "../time.js";
import {
  recordConsent, withdrawConsent, exportPatientData, createDataRequest, processDueRequests, patientRequests,
  NOTICE_VERSION, CONSENT_PURPOSES, SELF_SERVICE_TYPES, PROMISE_DAYS,
} from "../privacy.js";
import {
  HttpError, availableSlots, availableDays, parseBooking, createAppointment, findAppointmentForPatient, getAppointment,
  rescheduleAppointment, cancelAppointment, markPaid, logEvent, readAppt, APPT_SELECT,
  cleanText, requireClinic, siteUrl, waLink, prettyDate, prettyTime, normalizePhone, displayName,
} from "../services.js";

/** Public, unauthenticated API used by the website, patient portal and check-in page. */
export function publicRoutes(db) {
  const r = Router();
  const bookingLimit = rateLimit({ windowMs: 60 * 60_000, max: 20, message: "Too many booking attempts. Please call us instead." });
  const lookupLimit = rateLimit({ windowMs: 15 * 60_000, max: 30 });

  // What a patient may see about their own booking. Never includes clinical notes.
  const view = (a, req) => {
    const policy = getPolicy(db);
    const open = ["pending", "confirmed"].includes(a.status) && a.date >= clinicNow().date;
    const no = a.appt_no || a.ref; // the appointment number is the patient's reference
    return {
      ref: no,
      name: a.patient_name,
      clinic: a.clinic,
      clinicName: CLINICS[a.clinic].name,
      address: CLINICS[a.clinic].address,
      date: a.date,
      time: a.time,
      when: `${prettyDate(a.date)}, ${prettyTime(a.time)}`,
      status: a.status,
      visitType: a.visit_type,
      fee: a.fee,
      feeText: a.fee ? rupees(a.fee) : "",
      payment: { status: a.payment_status, paid: a.amount_paid, refunded: a.amount_refunded },
      canChange: open && a.payment_status !== "awaiting" && isOn(db, "patient_self_service"),
      selfService: isOn(db, "patient_self_service"),
      cancelQuote: open && a.amount_paid ? refundQuote(a, policy) : null,
      reschedule: open ? rescheduleCheck(a, policy) : { allowed: false },
      manageUrl: `${siteUrl(req)}/manage.html?ref=${no}`,
      apptNo: a.appt_no,
      patientCode: a.patient_code,
      googleCalendarUrl: open ? googleCalendarLink(a, siteUrl(req)) : null,
    };
  };
  // QR code (SVG) that opens the patient's booking page; shown on confirmations and the appointment card.
  const withQr = async (v) => ({ ...v, qrSvg: await QRCode.toString(v.manageUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b3d2e", light: "#ffffff" } }) });

  r.get("/config", (req, res) => {
    const policy = getPolicy(db);
    res.json({
      clinics: Object.values(CLINICS).map((c) => ({ ...c, status: policy.clinics[c.id] || "closed" })),
      policyUpdatedAt: policyUpdatedAt(db),
      hours: HOURS,
      booking: BOOKING,
      whatsapp: config.whatsappNumber,
      today: clinicNow().date,
      fees: policy.fees,
      followup: policy.followup,
      payOnline: paymentsEnabled() && policy.payments.mode === "online" && isOn(db, "online_payments"),
      policy: policySummary(policy),
      privacy: { noticeVersion: NOTICE_VERSION, purposes: CONSENT_PURPOSES },
      demo: config.demo ? { patient: { ref: DEMO_PATIENT.ref, phone: DEMO_PATIENT.phone } } : null,
      features: getFeatures(db),
    });
  });

  r.get("/days", async (req, res) => {
    const clinic = requireClinic(req.query.clinic);
    if (!isClinicOpen(getPolicy(db), clinic)) return res.json({ days: [], clinicClosed: true });
    const today = clinicNow().date;
    await ensureBusy(today, addDays(today, BOOKING.windowDays));
    res.json({ days: availableDays(db, clinic, 21) });
  });

  r.get("/slots", async (req, res) => {
    if (CLINICS[req.query.clinic] && !isClinicOpen(getPolicy(db), req.query.clinic)) return res.json({ date: req.query.date, clinic: req.query.clinic, closed: true, slots: [] });
    if (typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) await ensureBusy(req.query.date);
    res.json(availableSlots(db, req.query.clinic, req.query.date));
  });

  r.post("/appointments", bookingLimit, async (req, res) => {
    if (req.body.website) throw new HttpError(400, "Invalid submission."); // honeypot field
    // DPDP s.6 / GDPR Art. 7 & 9: explicit, informed consent before processing health information.
    if (!isOn(db, "online_booking")) throw new HttpError(403, "Online booking is turned off. Please WhatsApp or call the clinic.");
    if (req.body.consent !== true) throw new HttpError(400, "Please agree to the privacy notice so we can book and treat you.");
    const data = parseBooking(req.body);
    await ensureBusy(data.date);
    if (isBusy(data.date, data.time)) throw new HttpError(409, "Sorry, the doctor isn't available at that time. Please pick another slot.");
    const appt = createAppointment(db, data, { source: "web" });
    recordConsent(db, appt.patient_id, ["care", ...(req.body.whatsappConsent ? ["whatsapp_updates"] : [])], "web");
    const base = siteUrl(req);

    if (appt.payment_status === "awaiting") {
      const policy = getPolicy(db);
      let order;
      try {
        order = await createOrder({
          amount: appt.fee,
          receipt: appt.ref,
          notes: { ref: appt.ref, clinic: appt.clinic, date: appt.date, time: appt.time },
          doctorAccountId: appt.platform_fee > 0 ? policy.commission.doctorAccountId : "",
          doctorShare: appt.fee - appt.platform_fee,
        });
      } catch (err) {
        // Release the slot so the patient can try again.
        db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'system' WHERE id = ?").run(appt.id);
        logEvent(db, appt.id, "system", "", "payment_error", err.message);
        throw new HttpError(502, "Online payment is temporarily unavailable. Please try again in a minute or WhatsApp us to book.");
      }
      db.prepare("UPDATE appointments SET payment_order_id = ? WHERE id = ?").run(order.id, appt.id);
      return res.status(201).json({
        appointment: await withQr(view(appt, req)),
        payment: {
          keyId: publicKeyId(),
          orderId: order.id,
          amount: appt.fee,
          currency: "INR",
          name: "Tailbone Treatment Clinic",
          description: `${appt.visit_type === "followup" ? "Follow-up" : "Consultation"} · ${CLINICS[appt.clinic].short} · ${appt.appt_no}`,
          prefill: { name: appt.patient_name, contact: `+${appt.patient_phone}`, email: appt.patient_email || "" },
          holdMinutes: policy.holdMinutes,
        },
      });
    }

    notify(db, "booked", appt, { base });
    const text = `Hi Dr Rajveer, got your details from your website. I have booked an appointment (no. ${appt.appt_no}) for ${prettyDate(appt.date)} at ${prettyTime(appt.time)}, ${CLINICS[appt.clinic].short}.`;
    res.status(201).json({ appointment: await withQr(view(appt, req)), whatsappUrl: waLink(config.whatsappNumber, text) });
  });

  // Checkout success callback from the browser. The signature proves the payment is genuine.
  r.post("/payments/verify", lookupLimit, async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    if (!paymentsEnabled() || !orderId || !paymentId || !signature) throw new HttpError(400, "Invalid payment confirmation.");
    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) throw new HttpError(400, "Payment could not be verified. If money was deducted it will be refunded automatically.");
    const row = db.prepare(`${APPT_SELECT} WHERE a.payment_order_id = ?`).get(cleanText(orderId, 64));
    if (!row) throw new HttpError(404, "Booking not found for this payment.");
    const { appointment } = await markPaid(db, readAppt(row), { paymentId: cleanText(paymentId, 64), base: siteUrl(req) });
    res.json({ appointment: await withQr(view(appointment, req)) });
  });

  // Server-to-server confirmation from Razorpay (covers closed tabs and dropped connections).
  r.post("/payments/webhook", async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyWebhookSignature(raw, req.get("x-razorpay-signature"))) return res.status(400).json({ error: "Invalid signature." });
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid JSON." }); }
    const payment = event?.payload?.payment?.entity;
    if ((event.event === "payment.captured" || event.event === "order.paid") && payment?.order_id) {
      const row = db.prepare(`${APPT_SELECT} WHERE a.payment_order_id = ?`).get(payment.order_id);
      if (row) await markPaid(db, readAppt(row), { paymentId: payment.id, amount: payment.amount }).catch(() => {});
    }
    const refund = event?.payload?.refund?.entity;
    if (event.event === "refund.processed" && refund?.id) {
      db.prepare("UPDATE refunds SET status = 'processed' WHERE provider_refund_id = ?").run(refund.id);
    }
    if (event.event === "refund.failed" && refund?.id) {
      db.prepare("UPDATE refunds SET status = 'failed', error = 'Refund failed at the bank; please retry from the dashboard.' WHERE provider_refund_id = ?").run(refund.id);
    }
    res.json({ ok: true });
  });

  // Patient self-service: lookup needs both the booking reference and phone number.
  const findOwn = (req) => {
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    if (!appt) throw new HttpError(404, "We couldn't find a booking with that reference and phone number.");
    return appt;
  };

  r.post("/manage/lookup", lookupLimit, async (req, res) => {
    const found = findOwn(req);
    // Requests the clinic hasn't handled within the automatic period are completed now ("on next login").
    if (processDueRequests(db, new Date(), found.patient_id)) {
      const again = findAppointmentForPatient(db, req.body.ref, req.body.phone);
      if (!again) throw new HttpError(404, "Your details have been updated or erased as you asked, so this booking can no longer be found with that phone number.");
    }
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    const upcoming = db.prepare(`${APPT_SELECT} WHERE a.patient_id = ? AND a.id != ? AND a.status IN ('pending','confirmed') AND a.date >= ? ORDER BY a.date, a.time`)
      .all(appt.patient_id, appt.id, clinicNow().date).map((a) => view(readAppt(a), req));
    res.json({ appointment: await withQr(view(appt, req)), others: upcoming, policy: policySummary(getPolicy(db)), privacy: patientRequests(db, appt.patient_id) });
  });

  r.post("/manage/cancel", lookupLimit, async (req, res) => {
    const appt = findOwn(req);
    if (!view(appt, req).canChange) throw new HttpError(409, "This appointment can no longer be cancelled online. Please call us.");
    const { appointment, quote, refund } = await cancelAppointment(db, appt, {
      actor: "patient", actorName: appt.patient_name, reason: cleanText(req.body.reason, 300), base: siteUrl(req),
    });
    res.json({ appointment: view(appointment, req), refund: refund && { amount: refund.amount, percent: quote.percent, status: refund.status } });
  });

  r.post("/manage/reschedule", lookupLimit, async (req, res) => {
    const appt = findOwn(req);
    if (typeof req.body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) {
      await ensureBusy(req.body.date);
      if (isBusy(req.body.date, req.body.time)) throw new HttpError(409, "Sorry, the doctor isn't available at that time. Please pick another slot.");
    }
    if (!view(appt, req).canChange) throw new HttpError(409, "This appointment can no longer be changed online. Please call us.");
    if (!isClinicOpen(getPolicy(db), appt.clinic)) throw new HttpError(409, "This clinic is no longer taking bookings. Please call or WhatsApp us to move your appointment.");
    const check = rescheduleCheck(appt, getPolicy(db));
    if (!check.allowed) throw new HttpError(409, check.reason);
    const from = `${prettyDate(appt.date)} at ${prettyTime(appt.time)}`;
    const updated = rescheduleAppointment(db, appt, req.body.date, req.body.time, { actor: "patient", actorName: appt.patient_name });
    notify(db, "rescheduled", updated, { base: siteUrl(req), actor: "patient", from });
    res.json({ appointment: view(updated, req) });
  });

  // ---------- Calendar subscription feed (secret link, for the doctor's Google/Apple/Outlook calendar) ----------
  r.get("/calendar/:token.ics", lookupLimit, (req, res) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'calendar_feed_token'").get();
    const given = Buffer.from(String(req.params.token));
    const expected = Buffer.from(row?.value || "");
    if (!row || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(404, "Not found.");
    const rows = db.prepare(`${APPT_SELECT} WHERE a.date >= date('now','-30 days') AND a.status IN ('pending','confirmed','completed') AND a.payment_status != 'awaiting' ORDER BY a.date, a.time LIMIT 2000`).all();
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Cache-Control", "private, max-age=300");
    res.send(calendarFeed(rows, siteUrl(req)));
  });

  // ---------- Privacy self-service (DPDP s.11–13, GDPR Art. 15–21) ----------
  r.post("/manage/export", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    if (!patientRequests(db, appt.patient_id).downloadReady) throw new HttpError(403, `Please request a copy of your data first. It will be ready within ${PROMISE_DAYS} days.`);
    const data = exportPatientData(db, appt.patient_id);
    db.prepare("INSERT INTO security_log (actor, action, target, ip) VALUES ('patient', 'patient_self_export', ?, ?)")
      .run(`patient #${appt.patient_id}`, String(req.ip || "").replace(/^::ffff:/, ""));
    res.set("Content-Disposition", `attachment; filename="my-data-${appt.ref}.json"`);
    res.json(data);
  });

  // Download / correct / delete from "My appointments": a request to the clinic, completed by staff or
  // automatically after a few days (see privacy.js).
  r.post("/manage/privacy", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    const type = req.body.type;
    if (!SELF_SERVICE_TYPES.includes(type)) throw new HttpError(400, "Please choose what you'd like us to do.");
    const pending = db.prepare("SELECT ref FROM data_requests WHERE patient_id = ? AND type = ? AND status IN ('open','verifying')").get(appt.patient_id, type);
    if (pending) throw new HttpError(409, `You already have a request in progress (${pending.ref}). It will be completed within ${PROMISE_DAYS} days.`);
    let changes = null;
    if (type === "correction") {
      const c = req.body.changes || {};
      changes = {};
      const name = cleanText(c.name, 120);
      if (name) { if (name.length < 2) throw new HttpError(400, "Please enter your full name."); changes.name = name; }
      if (c.email) { const email = cleanText(c.email, 200); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Please enter a valid email address."); changes.email = email; }
      if (c.phone) { const phone = normalizePhone(c.phone); if (!phone) throw new HttpError(400, "Please enter a valid phone number."); changes.phone = phone; }
      if (!Object.keys(changes).length) throw new HttpError(400, "Please enter the details you'd like corrected.");
    }
    const { ref, due } = createDataRequest(db, {
      type, name: appt.patient_name, phone: appt.patient_phone, email: appt.patient_email, patientId: appt.patient_id,
      details: cleanText(req.body.note, 1000), changes, selfService: true,
    });
    const label = { access: "copy of data", correction: "correction", erasure: "deletion" }[type];
    db.prepare("INSERT INTO notifications (audience, event, channel, body, status) VALUES ('doctor', 'privacy_request', 'dashboard', ?, 'sent')")
      .run(encrypt(`Data request ${ref} (${label}) from ${appt.patient_name} ${appt.patient_code || ""}. Completes automatically in 3 days unless you act.`));
    res.status(201).json({ ref, due, privacy: patientRequests(db, appt.patient_id) });
  });

  r.post("/manage/consent", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    if (req.body.whatsappUpdates === false) withdrawConsent(db, appt.patient_id, "whatsapp_updates");
    if (req.body.whatsappUpdates === true) recordConsent(db, appt.patient_id, ["whatsapp_updates"], "manage_page");
    const active = db.prepare("SELECT purpose FROM consents WHERE patient_id = ? AND withdrawn_at IS NULL").all(appt.patient_id).map((c) => c.purpose);
    res.json({ consents: [...new Set(active)] });
  });

  const requestLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many requests. Please email contact@tailbonetreatment.com." });
  r.post("/privacy/request", requestLimit, (req, res) => {
    if (req.body.website) throw new HttpError(400, "Invalid submission.");
    const types = ["access", "correction", "erasure", "withdraw_consent", "grievance"];
    if (!types.includes(req.body.type)) throw new HttpError(400, "Please choose what you'd like us to do.");
    const name = cleanText(req.body.name, 120);
    const phone = normalizePhone(req.body.phone);
    const email = cleanText(req.body.email, 200);
    if (name.length < 2) throw new HttpError(400, "Please enter your name.");
    if (!phone && !email) throw new HttpError(400, "Please give a phone number or email so we can verify and reply.");
    const patient = phone && db.prepare("SELECT id FROM patients WHERE phone = ?").get(phone);
    const { ref, due } = createDataRequest(db, { type: req.body.type, name, phone, email, details: cleanText(req.body.details, 2000), patientId: patient?.id });
    db.prepare("INSERT INTO notifications (audience, event, channel, body, status) VALUES ('doctor', 'privacy_request', 'dashboard', ?, 'sent')")
      .run(encrypt(`Privacy request ${ref} (${req.body.type.replace("_", " ")}) from ${name}. Respond by ${due}.`));
    res.status(201).json({ ref, due });
  });

  // Follow-up check-ins: the token in the link is the credential.
  const findFollowup = (token) => db.prepare(
    `SELECT f.*, p.name AS patient_name FROM followups f JOIN patients p ON p.id = f.patient_id WHERE f.token = ?`,
  ).get(cleanText(token, 64));

  r.get("/checkin/:token", lookupLimit, (req, res) => {
    if (!isOn(db, "followup_checkins")) throw new HttpError(404, "Online check-ins are turned off. Please WhatsApp the clinic.");
    const fu = findFollowup(req.params.token);
    if (!fu) throw new HttpError(404, "This check-in link is not valid.");
    res.json({ firstName: fu.patient_name.split(" ")[0], dueDate: fu.due_date, done: fu.status !== "pending" });
  });

  r.post("/checkin/:token", lookupLimit, (req, res) => {
    if (!isOn(db, "followup_checkins")) throw new HttpError(404, "Online check-ins are turned off. Please WhatsApp the clinic.");
    const fu = findFollowup(req.params.token);
    if (!fu) throw new HttpError(404, "This check-in link is not valid.");
    if (fu.status !== "pending") throw new HttpError(409, "Thanks, we've already received this check-in.");
    const pain = Number(req.body.painScore);
    if (!Number.isInteger(pain) || pain < 0 || pain > 10) throw new HttpError(400, "Please choose a pain score from 0 to 10.");
    const trend = ["better", "same", "worse"].includes(req.body.trend) ? req.body.trend : null;
    if (!trend) throw new HttpError(400, "Please tell us whether you feel better, the same or worse.");
    const sitting = req.body.sittingMinutes === "" || req.body.sittingMinutes == null ? null : Math.max(0, Math.min(600, Math.round(Number(req.body.sittingMinutes)) || 0));
    db.prepare("INSERT INTO checkins (followup_id, patient_id, pain_score, sitting_minutes, trend, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(fu.id, fu.patient_id, pain, sitting, trend, encrypt(cleanText(req.body.notes, 1000)));
    db.prepare("UPDATE followups SET status = 'done', completed_at = datetime('now') WHERE id = ?").run(fu.id);
    res.status(201).json({ ok: true, needsAttention: trend === "worse" || pain >= 7 });
  });

  // ---------- Patient stories ----------
  const storyLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Thanks! You've already shared a story recently." });

  r.get("/stories", (req, res) => {
    if (!isOn(db, "stories")) return res.json({ stories: [], total: 0, average: null, disabled: true });
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
    if (!isOn(db, "stories")) throw new HttpError(403, "Story sharing is currently turned off.");
    if (req.body.website) throw new HttpError(400, "Invalid submission.");
    const name = cleanText(req.body.name, 80);
    const body = cleanText(req.body.body, 2000);
    const rating = Number(req.body.rating);
    if (name.length < 2) throw new HttpError(400, "Please tell us your name.");
    if (body.length < 30) throw new HttpError(400, "Please write at least a couple of sentences about your experience.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Please choose a rating.");
    if (!req.body.consent) throw new HttpError(400, "Please confirm we may publish your story.");
    // Only real patients: the patient ID and appointment number must belong together.
    const visit = db.prepare(
      `SELECT a.id, a.patient_id, p.phone FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.appt_no = ? AND p.patient_code = ? AND p.anonymised_at IS NULL`,
    ).get(cleanText(req.body.apptNo, 20).toUpperCase(), cleanText(req.body.patientCode, 20).toUpperCase());
    if (!visit) throw new HttpError(400, "We couldn't match that patient ID and appointment number. You'll find both on your appointment confirmation or in 'My appointments'.");
    db.prepare("INSERT INTO stories (name, city, rating, title, body, duration, phone, patient_id, appointment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(name, cleanText(req.body.city, 60), rating, cleanText(req.body.title, 100), body, cleanText(req.body.duration, 60), visit.phone, visit.patient_id, visit.id);
    res.status(201).json({ ok: true });
  });

  // ---------- Instagram highlights ----------
  r.get("/media", (req, res) => {
    if (!isOn(db, "instagram")) return res.json({ media: [] });
    res.json({ media: db.prepare("SELECT id, url, kind, caption FROM media WHERE visible = 1 ORDER BY sort, id DESC LIMIT 12").all() });
  });

  return r;
}
