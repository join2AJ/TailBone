import { Router } from "express";
import { CLINICS, HOURS, BOOKING, config } from "../config.js";
import { rateLimit } from "../auth.js";
import { clinicNow } from "../time.js";
import { encrypt } from "../crypto.js";
import { getPolicy, policySummary, refundQuote, rescheduleCheck, isClinicOpen, policyUpdatedAt } from "../policy.js";
import { paymentsEnabled, publicKeyId, createOrder, verifyCheckoutSignature, verifyWebhookSignature, rupees, isDemoPayments, demoPay } from "../payments.js";
import { notify } from "../notify.js";
import { DEMO_PATIENT, DEMO_PARTNER } from "../demo.js";
import { getFeatures, isOn } from "../features.js";
import { hiddenPosts } from "../blog.js";
import { addDocument, listDocuments, getDocument, readFile, sendFile, MAX_BYTES, PATIENT_KINDS } from "../documents.js";
import express from "express";
import { videoForPatient } from "../video.js";
import { cleanProfile, saveProfile, cleanAttribution } from "../profile.js";
import { decrypt } from "../crypto.js";
import { linkReferral, syncRewards, findActivePartner, patientPartner, partnerTotals, getReferralSettings } from "../referrals.js";
import { profileView, PROFILE_OPTIONS } from "../profile.js";
import { createHomeVisit, HOME_VISIT_MIN_DAYS } from "../homevisits.js";
import { publicArticles } from "../articles.js";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { ensureBusy, isBusy, googleCalendarLink, calendarFeed } from "../gcal.js";
import { addDays } from "../time.js";
import {
  recordConsent, withdrawConsent, exportPatientData, createDataRequest, processDueRequests, patientRequests,
  NOTICE_VERSION, CONSENT_PURPOSES, SELF_SERVICE_TYPES, PROMISE_DAYS,
} from "../privacy.js";
import {
  HttpError, availableSlots, availableDays, parseBooking, createAppointment, findAppointmentForPatient, getAppointment, isVerifiedBooking, receiptFor,
  rescheduleAppointment, cancelAppointment, markPaid, logEvent, readAppt, APPT_SELECT, syncPayment, confirmPayment, refundFailed,
  cleanText, requireClinic, siteUrl, waLink, prettyDate, prettyTime, normalizePhone, displayName,
} from "../services.js";

/** Public, unauthenticated API used by the website, patient portal and check-in page. */
export function publicRoutes(db) {
  const r = Router({ caseSensitive: true, strict: true });
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
      // A booking with a fee still to pay (e.g. booked by phone, or "pay at the clinic") can be paid online from My appointments.
      canPay: open && a.fee > 0 && ["pay_at_clinic", "unpaid"].includes(a.payment_status) && canPayOnline(),
      canChange: open && a.payment_status !== "awaiting" && isOn(db, "patient_self_service"),
      selfService: isOn(db, "patient_self_service"),
      cancelQuote: open && a.amount_paid ? refundQuote(a, policy) : null,
      reschedule: open ? rescheduleCheck(a, policy) : { allowed: false },
      manageUrl: `${siteUrl(req)}/manage.html?ref=${no}`,
      // Online consultations: the Join button. The link itself is given only from 15 minutes before a confirmed,
      // paid-or-pay-later booking's own slot, so it never reveals anything about other patients.
      video: videoForPatient(db, a),
      apptNo: a.appt_no,
      patientCode: a.patient_code,
      googleCalendarUrl: open ? googleCalendarLink(a, siteUrl(req)) : null,
    };
  };
  const canPayOnline = () => paymentsEnabled() && isOn(db, "online_payments");
  /** What the browser needs to open the payment window for an order. */
  const checkout = (appt, order) => ({
    keyId: publicKeyId(),
    orderId: order.id,
    amount: appt.fee,
    currency: "INR",
    name: "Tailbone Treatment Clinic",
    description: `${appt.visit_type === "followup" ? "Follow-up" : "Consultation"} · ${CLINICS[appt.clinic].short} · ${appt.appt_no}`,
    prefill: { name: appt.patient_name, contact: `+${appt.patient_phone}`, email: appt.patient_email || "" },
    holdMinutes: getPolicy(db).holdMinutes,
    // The payment window closes when the slot hold runs out (bookings paid at the time of booking only).
    expiresAt: appt.payment_status === "awaiting" && appt.hold_until ? `${appt.hold_until.replace(" ", "T")}Z` : null,
    demo: isDemoPayments(),
  });
  // Razorpay's "receipt" is limited to 40 characters and notes to 256 characters each.
  const newOrder = (appt) => {
    const policy = getPolicy(db);
    return createOrder({
      amount: appt.fee,
      receipt: String(appt.appt_no || appt.ref).slice(0, 40),
      notes: { appointment: appt.appt_no || appt.ref, clinic: appt.clinic, date: appt.date, time: appt.time },
      doctorAccountId: appt.platform_fee > 0 ? policy.commission.doctorAccountId : "",
      doctorShare: appt.fee - appt.platform_fee,
    });
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
      demo: config.demo ? { patient: { ref: DEMO_PATIENT.ref, phone: DEMO_PATIENT.phone }, partner: DEMO_PARTNER } : null,
      features: getFeatures(db),
    });
  });

  // The booking form shows who referred the patient when a referral code is entered (organisation or first name only).
  r.get("/referral/:code", lookupLimit, (req, res) => {
    const p = findActivePartner(db, req.params.code);
    if (!p) throw new HttpError(404, "We don't recognise that referral code. Please check it, or leave it blank.");
    res.json({ code: p.code, name: p.kind === "patient" || p.kind === "individual" ? p.name.split(/\s+/)[0] : p.name });
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
    const profile = cleanProfile(req.body.profile || {});
    await ensureBusy(data.date);
    if (isBusy(data.date, data.time)) throw new HttpError(409, "Sorry, the doctor isn't available at that time. Please pick another slot.");
    const appt = createAppointment(db, data, { source: "web" });
    recordConsent(db, appt.patient_id, ["care", ...(req.body.whatsappConsent ? ["whatsapp_updates"] : [])], "web");
    // Optional details and where the visitor came from. A website booking only fills blanks (it can't prove who owns the phone).
    saveProfile(db, appt.patient_id, profile);
    const attr = cleanAttribution(req.body.attribution || {});
    db.prepare("UPDATE appointments SET utm_source = ?, utm_medium = ?, utm_campaign = ?, ad_click = ?, landing_page = ? WHERE id = ?")
      .run(attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.ad_click, attr.landing_page, appt.id);
    if (linkReferral(db, appt.id, req.body.referralCode)) syncRewards(db, appt.id);
    const base = siteUrl(req);

    if (appt.payment_status === "awaiting") {
      let order;
      try {
        order = await newOrder(appt);
      } catch (err) {
        // Release the slot so the patient can try again.
        db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'system' WHERE id = ?").run(appt.id);
        logEvent(db, appt.id, "system", "", "payment_error", err.message);
        throw new HttpError(502, "Online payment is temporarily unavailable. Please try again in a minute or WhatsApp us to book.");
      }
      db.prepare("UPDATE appointments SET payment_order_id = ? WHERE id = ?").run(order.id, appt.id);
      return res.status(201).json({ appointment: await withQr(view(appt, req)), payment: checkout(appt, order) });
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
    // The signature proves Checkout succeeded; Razorpay itself confirms the amount, and captures it if needed.
    const { appointment } = await confirmPayment(db, readAppt(row), cleanText(paymentId, 64), { base: siteUrl(req) });
    res.json({ appointment: await withQr(view(appointment, req)) });
  });

  // After a page reload or an app switch (UPI) during payment: ask whether the order has been paid yet.
  r.post("/payments/status", lookupLimit, async (req, res) => {
    const row = db.prepare(`${APPT_SELECT} WHERE a.payment_order_id = ?`).get(cleanText(req.body.orderId, 64));
    if (!row) throw new HttpError(404, "Booking not found for this payment.");
    let appt = readAppt(row);
    if (appt.payment_status === "awaiting" || appt.payment_status === "pay_at_clinic") {
      await syncPayment(db, appt, { base: siteUrl(req) }).catch(() => {});
      appt = getAppointment(db, appt.id);
    }
    const paid = appt.amount_paid > 0;
    res.json({ paid, status: appt.status, appointment: paid ? await withQr(view(appt, req)) : null });
  });

  // Server-to-server confirmation from Razorpay (covers closed tabs and dropped connections). Errors other than
  // "already handled / not ours" return 500, so Razorpay tries again later.
  r.post("/payments/webhook", async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyWebhookSignature(raw, req.get("x-razorpay-signature"))) return res.status(400).json({ error: "Invalid signature." });
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid JSON." }); }
    db.prepare("INSERT INTO settings (key, value) VALUES ('razorpay_last_webhook', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: new Date().toISOString(), event: String(event.event || "").slice(0, 40) }));
    const ignore = (err) => { if (!(err instanceof HttpError) || err.status >= 500) throw err; };
    const payment = event?.payload?.payment?.entity;
    if (["payment.captured", "payment.authorized", "order.paid"].includes(event.event) && payment?.order_id) {
      // Normally the booking holding this order; failing that, the booking named in the order's notes.
      let row = db.prepare(`${APPT_SELECT} WHERE a.payment_order_id = ?`).get(payment.order_id);
      const noted = payment.notes?.appointment || event?.payload?.order?.entity?.notes?.appointment;
      if (!row && noted) row = db.prepare(`${APPT_SELECT} WHERE a.appt_no = ? AND a.amount_paid = 0`).get(String(noted).slice(0, 20));
      if (row) {
        const appt = readAppt(row);
        if (appt.payment_order_id !== payment.order_id) db.prepare("UPDATE appointments SET payment_order_id = ? WHERE id = ?").run(payment.order_id, appt.id);
        const entity = { status: event.event === "payment.authorized" ? "authorized" : "captured", currency: "INR", ...payment };
        await confirmPayment(db, { ...appt, payment_order_id: payment.order_id }, entity).catch(ignore);
      }
    }
    const refund = event?.payload?.refund?.entity;
    if (event.event === "refund.processed" && refund?.id) {
      const known = db.prepare("UPDATE refunds SET status = 'processed' WHERE provider_refund_id = ?").run(refund.id).changes;
      // A refund made directly in the Razorpay dashboard: record it against its booking too.
      const row = !known && refund.payment_id && db.prepare("SELECT * FROM appointments WHERE payment_id = ?").get(refund.payment_id);
      if (row) {
        db.prepare("INSERT INTO refunds (appointment_id, amount, reason, provider_refund_id, status) VALUES (?, ?, 'Refunded in the Razorpay dashboard', ?, 'processed')").run(row.id, refund.amount, refund.id);
        db.prepare(`UPDATE appointments SET amount_refunded = MIN(amount_paid, amount_refunded + ?),
            payment_status = CASE WHEN amount_refunded + ? >= amount_paid THEN 'refunded' ELSE 'partially_refunded' END, updated_at = datetime('now') WHERE id = ?`)
          .run(refund.amount, refund.amount, row.id);
        logEvent(db, row.id, "system", "", "refunded", `${rupees(refund.amount)} (made in the Razorpay dashboard)`);
      }
    }
    if (event.event === "refund.failed" && refund?.id) refundFailed(db, refund.id);
    res.json({ ok: true });
  });

  // Patient self-service: lookup needs both the booking reference and phone number.
  // Wrong guesses are also counted per phone number, so appointment numbers can't be worked through for one patient
  // even from many addresses.
  const misses = new Map(); // phone -> { n, since }
  const findOwn = (req, creds = req.body) => {
    const phone = normalizePhone(creds.phone) || "";
    const m = misses.get(phone);
    if (m && Date.now() - m.since > 24 * 3600_000) misses.delete(phone);
    if ((misses.get(phone)?.n || 0) >= 10) throw new HttpError(429, "Too many attempts for this phone number. Please call or WhatsApp the clinic on +91 98866 88323.");
    const appt = findAppointmentForPatient(db, creds.ref, creds.phone);
    if (!appt) {
      if (phone) misses.set(phone, { n: (misses.get(phone)?.n || 0) + 1, since: misses.get(phone)?.since || Date.now() });
      if (misses.size > 10_000) misses.clear();
      throw new HttpError(404, "We couldn't find a booking with that reference and phone number.");
    }
    return appt;
  };
  const requireVerified = (appt) => {
    if (!isVerifiedBooking(db, appt)) {
      throw new HttpError(403, "For your security, data requests open once the clinic has confirmed this booking with you, or after your visit. Please call or WhatsApp us if you need help sooner.");
    }
  };
  const privacyView = (appt) => ({ ...patientRequests(db, appt.patient_id), verified: isVerifiedBooking(db, appt) });
  // Documents are shown only for a booking that proves who is asking (see isVerifiedBooking).
  const documentsView = (appt) => {
    const verified = isVerifiedBooking(db, appt);
    const on = isOn(db, "patient_documents");
    return {
      enabled: on,
      verified,
      canUpload: on && verified && isOn(db, "patient_uploads"),
      list: on && verified ? listDocuments(db, appt.patient_id, { forPatient: true })
        .map(({ id, kind, kindLabel, title, mime, size, uploaded_by: by, created_at: at }) => ({ id, kind, kindLabel, title, mime, size, by, at })) : [],
    };
  };

  r.post("/manage/lookup", lookupLimit, async (req, res) => {
    const found = findOwn(req);
    // A payment started earlier whose confirmation never arrived (tab closed, webhook missed): ask Razorpay.
    if (found.payment_order_id && ["awaiting", "pay_at_clinic", "unpaid"].includes(found.payment_status)) {
      await syncPayment(db, found, { base: siteUrl(req) }).catch(() => {});
    }
    // Requests the clinic hasn't handled within the automatic period are completed now ("on next login").
    if (processDueRequests(db, new Date(), found.patient_id)) {
      const again = findAppointmentForPatient(db, req.body.ref, req.body.phone);
      if (!again) throw new HttpError(404, "Your details have been updated or erased as you asked, so this booking can no longer be found with that phone number.");
    }
    const appt = findAppointmentForPatient(db, req.body.ref, req.body.phone);
    // The patient's other bookings are shown only when this booking proves who is asking (see isVerifiedBooking).
    const upcoming = !isVerifiedBooking(db, appt) ? [] : db.prepare(`${APPT_SELECT} WHERE a.patient_id = ? AND a.id != ? AND a.status IN ('pending','confirmed') AND a.date >= ? ORDER BY a.date, a.time`)
      .all(appt.patient_id, appt.id, clinicNow().date).map((a) => view(readAppt(a), req));
    res.json({ appointment: await withQr(view(appt, req)), others: upcoming, policy: policySummary(getPolicy(db)), privacy: privacyView(appt), documents: documentsView(appt), home: homeView(appt, req) });
  });

  // The patient's personal home in My appointments: a greeting, their progress and visits, profile, who referred them
  // and their own referral code. Beyond the greeting, only for a booking that proves who is asking (see isVerifiedBooking).
  function homeView(appt, req) {
    const first = appt.patient_name.split(" ")[0];
    const verified = isVerifiedBooking(db, appt);
    if (!verified) return { firstName: first, verified: false };
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(appt.patient_id);
    const visits = db.prepare("SELECT COUNT(*) n FROM appointments WHERE patient_id = ? AND status = 'completed'").get(patient.id).n;
    const checkins = db.prepare("SELECT pain_score, trend, created_at FROM checkins WHERE patient_id = ? ORDER BY created_at").all(patient.id);
    const lastVisit = db.prepare("SELECT date FROM appointments WHERE patient_id = ? AND status = 'completed' ORDER BY date DESC LIMIT 1").get(patient.id)?.date || null;
    const nextFollowup = db.prepare("SELECT due_date, type FROM followups WHERE patient_id = ? AND status = 'pending' ORDER BY due_date LIMIT 1").get(patient.id) || null;
    const referrer = patient.referred_by ? db.prepare("SELECT name, kind FROM partners WHERE id = ?").get(patient.referred_by) : null;
    const own = isOn(db, "referrals") ? db.prepare("SELECT * FROM partners WHERE patient_id = ?").get(patient.id) : null;
    const s = getReferralSettings(db);
    return {
      firstName: first,
      verified: true,
      patientCode: patient.patient_code,
      since: patient.created_at,
      visits,
      lastVisit,
      nextFollowup,
      pain: checkins.map((c) => ({ score: c.pain_score, trend: c.trend, at: c.created_at })),
      profile: profileView(patient),
      profileOptions: PROFILE_OPTIONS,
      referredBy: referrer ? (["patient", "individual"].includes(referrer.kind) ? referrer.name.split(/\s+/)[0] : referrer.name) : null,
      referral: isOn(db, "referrals") ? {
        code: own?.status === "active" ? own.code : null,
        link: own?.status === "active" ? `${siteUrl(req)}/book?ref=${own.code}` : null,
        totals: own ? partnerTotals(db, own.id) : null,
        payTo: own ? decrypt(own.payout_details) : "",
        rules: { firstBooking: rupees(s.firstBooking), treatment: rupees(s.treatment), months: s.months },
      } : null,
    };
  }

  // A verified patient may update their own profile details (age, city, work…).
  r.post("/manage/profile", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    requireVerified(appt);
    const prof = cleanProfile(req.body.profile || {});
    const keys = ["gender", "occupation_group", "occupation", "city", "sitting_hours", "pain_since", "heard_from"];
    for (const k of keys) if (req.body.profile && k in req.body.profile && !(k in prof)) prof[k] = null;
    if (req.body.profile && (req.body.profile.age === "" || req.body.profile.age === null)) prof.birth_year = null;
    saveProfile(db, appt.patient_id, prof, { overwrite: true });
    res.json({ home: homeView(appt, req) });
  });

  // "Refer a friend": the patient's own referral ID, created the first time they ask.
  r.post("/manage/referral", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    requireVerified(appt);
    if (!isOn(db, "referrals")) throw new HttpError(404, "The referral programme is not open at the moment.");
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(appt.patient_id);
    const partner = patientPartner(db, patient);
    if (partner.status !== "active") throw new HttpError(403, "Your referral ID is paused. Please contact the clinic.");
    const payTo = req.body.payoutDetails === undefined ? null : cleanText(req.body.payoutDetails, 300);
    if (payTo !== null && payTo !== decrypt(partner.payout_details)) {
      db.prepare("UPDATE partners SET payout_details = ? WHERE id = ?").run(encrypt(payTo), partner.id);
      // Where rewards are paid is money: the clinic sees every change before paying.
      db.prepare("INSERT INTO security_log (actor, action, target, ip) VALUES ('patient', 'payout_details_changed', ?, ?)")
        .run(`partner #${partner.id} (${partner.code})`, String(req.ip || "").replace(/^::ffff:/, ""));
      db.prepare("INSERT INTO notifications (appointment_id, audience, event, channel, body, status) VALUES (?, 'doctor', 'payout_changed', 'dashboard', ?, 'sent')")
        .run(appt.id, encrypt(`${appt.patient_name} (${partner.code}) changed where their referral rewards are paid to: ${payTo || "(removed)"}. Check with them before the next payment if this looks unexpected.`));
    }
    res.json({ home: homeView(appt, req), payoutDetails: decrypt(db.prepare("SELECT payout_details FROM partners WHERE id = ?").get(partner.id).payout_details) });
  });

  // Pay an outstanding fee online from My appointments. Paying is not a privacy risk, so it doesn't need a verified booking.
  r.post("/manage/pay", lookupLimit, async (req, res) => {
    let appt = findOwn(req);
    // A payment started earlier may have gone through (UPI can take a minute): check before asking again.
    if (appt.payment_order_id && await syncPayment(db, appt).catch(() => "unpaid") === "paid") appt = getAppointment(db, appt.id);
    if (!view(appt, req).canPay) throw new HttpError(409, "There's nothing to pay online for this booking.");
    // Reuse the booking's order, so a payment that completes late on an earlier try is still matched to it.
    let order = appt.payment_order_id ? { id: appt.payment_order_id } : null;
    if (!order) {
      try { order = await newOrder(appt); } catch { throw new HttpError(502, "Online payment is temporarily unavailable. Please try again in a minute, or pay at the clinic."); }
      db.prepare("UPDATE appointments SET payment_order_id = ? WHERE id = ?").run(order.id, appt.id);
    }
    logEvent(db, appt.id, "patient", appt.patient_name, "payment_started", `Online payment of ${rupees(appt.fee)} started from My appointments`);
    res.json({ payment: checkout(appt, order) });
  });

  // Demo only: the pretend payment window's "Pay" button. Returns what Razorpay Checkout would, for /payments/verify.
  r.post("/payments/demo-pay", lookupLimit, (req, res) => {
    if (!isDemoPayments()) throw new HttpError(404, "Not found.");
    res.json(demoPay(cleanText(req.body.orderId, 64), ["upi", "card", "netbanking"].includes(req.body.method) ? req.body.method : "upi"));
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
    requireVerified(appt);
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
    requireVerified(appt);
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
    // Linked to the booking, so the notice is redacted too if the patient's data is later erased.
    db.prepare("INSERT INTO notifications (appointment_id, audience, event, channel, body, status) VALUES (?, 'doctor', 'privacy_request', 'dashboard', ?, 'sent')")
      .run(appt.id, encrypt(`Data request ${ref} (${label}) from ${appt.patient_name} ${appt.patient_code || ""}. Completes automatically in 3 days unless you act.`));
    res.status(201).json({ ref, due, privacy: privacyView(appt) });
  });

  // Payment receipt for this booking (the patient's own; shows only what My appointments already shows).
  r.post("/manage/receipt", lookupLimit, (req, res) => {
    const receipt = receiptFor(db, findOwn(req));
    if (!receipt) throw new HttpError(404, "There's no payment on this booking yet. Fees paid at the clinic appear here once the clinic records them.");
    res.json({ receipt });
  });

  r.post("/manage/documents/:id/download", lookupLimit, (req, res) => {
    const appt = findOwn(req);
    requireVerified(appt);
    if (!isOn(db, "patient_documents")) throw new HttpError(404, "Document not found.");
    const doc = getDocument(db, Number(req.params.id) || 0);
    if (!doc || doc.patient_id !== appt.patient_id || !(doc.shared || doc.uploaded_by === "patient")) throw new HttpError(404, "Document not found.");
    db.prepare("INSERT INTO security_log (actor, action, target, ip) VALUES ('patient', 'document_downloaded', ?, ?)")
      .run(`#${doc.id} by patient #${appt.patient_id}`, String(req.ip || "").replace(/^::ffff:/, ""));
    sendFile(res, readFile(db, doc.id));
  });

  // Upload: the file is the body; the booking details travel in headers so they never appear in logs or URLs.
  const uploadLimit = rateLimit({ windowMs: 60 * 60_000, max: 10, message: "Too many uploads. Please try again later or WhatsApp us." });
  r.post("/manage/documents", uploadLimit, express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), (req, res) => {
    const appt = findOwn(req, { ref: req.get("x-ref"), phone: req.get("x-phone") });
    requireVerified(appt);
    if (!isOn(db, "patient_documents") || !isOn(db, "patient_uploads")) throw new HttpError(403, "Uploading documents isn't available. Please bring them to your visit or WhatsApp us.");
    const kind = PATIENT_KINDS.includes(req.query.kind) ? req.query.kind : "report";
    if (config.demo && req.body?.length > 2 * 1024 * 1024) throw new HttpError(413, "In the demo, files up to 2 MB can be added.");
    const doc = addDocument(db, {
      patientId: appt.patient_id, appointmentId: appt.id, kind, title: req.query.title, data: req.body, uploadedBy: "patient", uploaderName: appt.patient_name,
    });
    db.prepare("INSERT INTO notifications (appointment_id, audience, event, channel, body, status) VALUES (?, 'doctor', 'document_uploaded', 'dashboard', ?, 'sent')")
      .run(appt.id, encrypt(`${appt.patient_name} ${appt.patient_code || ""} added a document: ${doc.title}.`));
    res.status(201).json({ documents: documentsView(appt) });
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

  // Blog articles the clinic has switched off; the static pages hide them (see assets/js/blog.js).
  r.get("/blog/hidden", (req, res) => res.json({ hidden: hiddenPosts(db) }));

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

  // ---------- Doctor at your place ----------
  const homeVisitLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many requests. Please WhatsApp us on +91 98866 88323." });
  r.post("/home-visits", homeVisitLimit, (req, res) => {
    if (!isOn(db, "home_visits")) throw new HttpError(403, "Home visits aren't available at the moment. Please WhatsApp us.");
    if (req.body.website) throw new HttpError(400, "Invalid submission.");
    if (req.body.consent !== true) throw new HttpError(400, "Please agree to the privacy notice so we can contact you.");
    const { ref } = createHomeVisit(db, req.body);
    db.prepare("INSERT INTO notifications (audience, event, channel, body, status) VALUES ('doctor', 'home_visit', 'dashboard', ?, 'sent')")
      .run(encrypt(`Doctor at your place: request ${ref} from ${cleanText(req.body.name, 120)} for ${cleanText(req.body.city, 80)}, ${req.body.dateFrom} to ${req.body.dateTo}.`));
    res.status(201).json({ ref, whatsappUrl: waLink(config.whatsappNumber, `Hi Dr Rajveer, I've sent a request (${ref}) for you to visit ${cleanText(req.body.city, 80)}.`) });
  });
  r.get("/home-visits/rules", (req, res) => res.json({ minDays: HOME_VISIT_MIN_DAYS, earliest: addDays(clinicNow().date, HOME_VISIT_MIN_DAYS), enabled: isOn(db, "home_visits") }));

  // Articles written in the dashboard, for the /blog/ list (the static list has the others).
  r.get("/blog/articles", (req, res) => res.json({ articles: publicArticles(db) }));

  // ---------- Instagram highlights ----------
  r.get("/media", (req, res) => {
    if (!isOn(db, "instagram")) return res.json({ media: [] });
    res.json({ media: db.prepare("SELECT id, url, kind, caption FROM media WHERE visible = 1 ORDER BY sort, id DESC LIMIT 12").all() });
  });

  return r;
}
