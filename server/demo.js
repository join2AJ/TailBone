import crypto from "node:crypto";
import { encrypt } from "./crypto.js";
import { hashPassword } from "./auth.js";
import { clinicNow, addDays, slotsForDate } from "./time.js";
import { seedStories, makeToken } from "./services.js";
import { NOTICE_VERSION } from "./privacy.js";
import { patientCode, nextApptNo } from "./db.js";
import { config } from "./config.js";
import { addDocument } from "./documents.js";
import { saveVideoSettings } from "./video.js";
import { syncRewards } from "./referrals.js";

/** A one-page PDF of plain text lines (for the demo's sample documents). */
function samplePdf(lines) {
  const esc = (t) => t.replace(/[\\()]/g, "\\$&");
  const text = ["BT /F1 18 Tf 56 780 Td", `(${esc(lines[0])}) Tj`, "/F1 11 Tf 0 -30 Td", ...lines.slice(1).flatMap((l) => [`(${esc(l)}) Tj`, "0 -18 Td"]), "ET"].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Sample data for DEMO_MODE. All people are fictional; phone numbers use the unassigned 9999900xxx range.
export const DEMO_ADMIN = { email: "demo@tailbonetreatment.com", name: "Demo Doctor" };
export const DEMO_PATIENT = { ref: "TB-DEMO42", phone: "9999900001", name: "Asha Verma" };
export const DEMO_PARTNER = { phone: "9999900021", password: "demo-partner" };

const TABLES = ["referral_rewards", "partner_payouts", "partners", "home_visits", "blog_media", "documents", "notifications", "refunds", "appointment_events", "checkins", "followups", "consents", "data_requests",
  "appointments", "patients", "stories", "media", "blocked_dates", "settings", "security_log", "admins"];

/** Wipe the demo database and fill it with a realistic day at the clinic. */
export function seedDemo(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM blog_posts WHERE source = 'dashboard'");
    // Unusable random password: the demo admin can only sign in with the demo button.
    db.prepare("INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')")
      .run(DEMO_ADMIN.email, DEMO_ADMIN.name, hashPassword(crypto.randomBytes(24).toString("hex")));

    const today = clinicNow().date;
    const slot = (date, i) => { const s = slotsForDate(date); return s[Math.min(i, s.length - 1)]; };
    const patient = (name, phone, notes = "") => {
      const id = Number(db.prepare("INSERT INTO patients (name, phone, notes) VALUES (?, ?, ?)").run(name, `91${phone}`, encrypt(notes)).lastInsertRowid);
      db.prepare("UPDATE patients SET patient_code = ? WHERE id = ?").run(patientCode(id), id);
      return id;
    };
    const appt = (pid, ref, clinic, date, i, status, { reason = "", notes = "", paid = 0, platform = 0, refunded = 0, visit = "new", cancelledBy = null } = {}) => {
      const fee = visit === "followup" ? 50000 : 80000;
      const id = Number(db.prepare(
        `INSERT INTO appointments (ref, appt_no, patient_id, clinic, date, time, status, reason, notes, source, visit_type, fee, platform_fee,
           payment_status, payment_id, amount_paid, amount_refunded, cancelled_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ref, nextApptNo(db), pid, clinic, date, slot(date, i), status, encrypt(reason), encrypt(notes), visit, fee, platform,
        paid ? (refunded >= paid ? "refunded" : refunded ? "partially_refunded" : "paid") : "pay_at_clinic",
        paid ? `pay_demo_${ref.slice(3)}` : null, paid, refunded, cancelledBy).lastInsertRowid);
      db.prepare("INSERT INTO appointment_events (appointment_id, actor, actor_name, action, detail) VALUES (?, 'patient', ?, 'booked', ?)")
        .run(id, "", `${clinic}, ${date}`);
      if (["confirmed", "completed"].includes(status)) {
        db.prepare("INSERT INTO appointment_events (appointment_id, actor, actor_name, action) VALUES (?, 'clinic', 'Dr Rajveer Singh', ?)").run(id, status);
      }
      return id;
    };
    const consent = (pid, wa = true) => {
      const ins = db.prepare("INSERT INTO consents (patient_id, purpose, notice_version, source) VALUES (?, ?, ?, 'web')");
      ins.run(pid, "care", NOTICE_VERSION);
      if (wa) ins.run(pid, "whatsapp_updates", NOTICE_VERSION);
    };
    const followup = (pid, aid, due, status, type = "checkin", notes = "") => Number(db.prepare(
      "INSERT INTO followups (patient_id, appointment_id, due_date, type, status, notes, token, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(pid, aid, due, type, status, notes, makeToken(), status === "done" ? `${due} 10:00:00` : null).lastInsertRowid);
    const checkin = (pid, fid, pain, trend, daysAgo, notes = "", sitting = null) => db.prepare(
      "INSERT INTO checkins (followup_id, patient_id, pain_score, trend, sitting_minutes, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))",
    ).run(fid, pid, pain, trend, sitting, encrypt(notes), `-${daysAgo} days`);

    // 1. The demo patient: treated 3 weeks ago, improving, next visit in 3 days (so rescheduling can be tried).
    const asha = patient(DEMO_PATIENT.name, DEMO_PATIENT.phone, "Fall on stairs Jan 2026. MRI: no fracture. Desk job.");
    consent(asha);
    const ashaPast = appt(asha, "TB-DEMO17", "del", addDays(today, -21), 2, "completed", { reason: "Pain when sitting for over 20 minutes since a fall", notes: "IM session 1. Coccyx hypermobile. Advised wedge cushion.", paid: 80000, platform: 10000 });
    checkin(asha, null, 7, "same", 21, "Before treatment", 15);
    const f1 = followup(asha, ashaPast, addDays(today, -14), "done");
    checkin(asha, f1, 4, "better", 14, "Much easier to sit at work", 45);
    const f2 = followup(asha, ashaPast, addDays(today, -7), "done");
    checkin(asha, f2, 2, "better", 7, "", 90);
    // Her review is an online consultation, so the demo shows the Join call panel.
    appt(asha, DEMO_PATIENT.ref, "online", addDays(today, 3), 3, "confirmed", { reason: "Review visit", paid: 50000, platform: 10000, visit: "followup" });
    saveVideoSettings(db, { defaultUrl: "https://meet.google.com/" });
    addDocument(db, {
      patientId: asha, appointmentId: ashaPast, kind: "plan", title: "Exercise plan after first visit", uploadedBy: "clinic", uploaderName: "Dr Rajveer Singh", shared: true,
      data: samplePdf([
        "Exercise plan (sample document for the demo)", "Patient: Asha Verma (TBP-00001)", "",
        "1. Sit leaning slightly forward, on a wedge or cut-out cushion.", "2. Stand up and walk for 2 minutes every 30 minutes.",
        "3. Gentle pelvic floor relaxation: 5 slow breaths, twice a day.", "4. Knee-to-chest stretch: 3 x 20 seconds, morning and evening.",
        "", "Review visit as booked. Call or WhatsApp +91 98866 88323 with any questions.",
      ]),
    });

    // 2. Today's patients.
    const rohan = patient("Rohan Mehta", "9999900002");
    consent(rohan);
    appt(rohan, "TB-DEMO23", "del", today, 1, "confirmed", { reason: "Sharp pain standing up from a chair", paid: 80000 });
    const kavya = patient("Kavya Iyer", "9999900003");
    consent(kavya, false);
    appt(kavya, "TB-DEMO35", "online", today, 4, "pending", { reason: "Tailbone pain after childbirth, 4 months" });
    // Tomorrow's visits, for the reminders list.
    const vikram = patient("Vikram Sethi", "9999900011");
    consent(vikram);
    appt(vikram, "TB-DEMO51", "del", addDays(today, 1), 2, "confirmed", { reason: "Coccyx pain on long drives" });
    const meera = patient("Meera Nair", "9999900012");
    consent(meera);
    appt(meera, "TB-DEMO52", "online", addDays(today, 1), 5, "pending", { reason: "Pain when sitting after a fall" });

    // 3. Follow-up due today.
    const imran = patient("Imran Khan", "9999900004");
    consent(imran);
    const imranPast = appt(imran, "TB-DEMO48", "del", addDays(today, -14), 0, "completed", { notes: "IM session 1. Good response.", paid: 80000 });
    followup(imran, imranPast, today, "pending", "checkin", "Check sitting tolerance");

    // 4. Pain getting worse → alert, overdue follow-up call.
    const neha = patient("Neha Kapoor", "9999900005");
    consent(neha);
    const nehaPast = appt(neha, "TB-DEMO56", "del", addDays(today, -10), 1, "completed", { notes: "Stiff coccyx; discussed 2nd session.", paid: 80000 });
    const f3 = followup(neha, nehaPast, addDays(today, -3), "done");
    checkin(neha, f3, 8, "worse", 3, "Long drive to Mysore, pain flared up", 10);
    followup(neha, nehaPast, addDays(today, -1), "pending", "call", "Call about flare-up");

    // 5. Patient cancelled yesterday (refund per policy) → appears in the doctor's inbox.
    const sunita = patient("Sunita Rao", "9999900006");
    consent(sunita);
    const sunitaAppt = appt(sunita, "TB-DEMO61", "del", addDays(today, 3), 2, "cancelled", { paid: 80000, refunded: 80000, cancelledBy: "patient" });
    db.prepare("INSERT INTO refunds (appointment_id, amount, reason, status, provider_refund_id) VALUES (?, 80000, 'cancelled by patient', 'processed', 'rfnd_demo')").run(sunitaAppt);
    db.prepare("INSERT INTO appointment_events (appointment_id, actor, actor_name, action, detail) VALUES (?, 'patient', 'Sunita Rao', 'cancelled', 'Reason: travelling · Cancelled 24+ hours before: 100% refund.')").run(sunitaAppt);

    // 6. Inbox, outbox, stories, privacy request.
    const note = db.prepare("INSERT INTO notifications (appointment_id, audience, event, channel, recipient, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))");
    note.run(null, "doctor", "booked", "dashboard", "", encrypt("New booking TB-DEMO35: Kavya Iyer (+919999900003), today, Online. Fee ₹800, payable at the clinic."), "sent", "-2 hours");
    note.run(sunitaAppt, "doctor", "cancelled", "dashboard", "", encrypt("Cancelled by patient: TB-DEMO61 Sunita Rao (+919999900006). Refund ₹800 (100%) per policy. Reason: travelling"), "sent", "-1 day");
    note.run(null, "patient", "confirmed", "manual", "919999900002", encrypt(`Hi Rohan, your appointment TB-DEMO23 is confirmed for today at our New Delhi clinic. Manage: ${config.siteUrl || "https://tailbone.onrender.com"}/manage.html?ref=TB-DEMO23`), "manual", "-3 hours");

    seedStories(db);
    db.prepare("INSERT INTO stories (name, city, rating, title, body, duration, status, source) VALUES (?, ?, 5, ?, ?, ?, 'pending', 'web')")
      .run("Asha Verma", "Bengaluru", "Back at my desk all day", "After months of shifting in my chair, two sessions and a cushion later I can work a full day. The check-in messages kept me on track.", "8 months");

    db.prepare("INSERT INTO data_requests (ref, type, name, phone, details, patient_id, due_at) VALUES ('DR-DEMO0001', 'access', 'Imran Khan', '919999900004', ?, ?, ?)")
      .run(encrypt("Please send me a copy of my records."), imran, addDays(today, 25));

    // 7. Profiles, where bookings came from, referral partners, a home-visit request and a draft article.
    const year = Number(today.slice(0, 4));
    const prof = db.prepare("UPDATE patients SET gender = ?, birth_year = ?, city = ?, occupation_group = ?, occupation = ?, sitting_hours = ?, pain_since = ?, heard_from = ? WHERE id = ?");
    prof.run("female", year - 34, "Gurugram", "office", "Software engineer", "gt8", "6to12m", "google", asha);
    prof.run("male", year - 41, "New Delhi", "driver", "Taxi driver", "gt8", "1to6m", "doctor", rohan);
    prof.run("female", year - 29, "Noida", "homemaker", "", "2to5", "1to6m", "instagram", kavya);
    prof.run("male", year - 46, "Gurugram", "business", "Shop owner", "5to8", "gt1y", "google", vikram);
    prof.run("female", year - 38, "New Delhi", "office", "Bank officer", "5to8", "lt1m", "friend", meera);
    prof.run("male", year - 52, "Faridabad", "office", "Accountant", "gt8", "gt1y", "youtube", imran);
    prof.run("female", year - 31, "New Delhi", "healthcare", "Nurse", "2to5", "6to12m", "google", neha);
    const attr = db.prepare("UPDATE appointments SET ad_click = ?, utm_source = ?, utm_medium = ?, utm_campaign = ?, landing_page = ?, created_at = datetime('now', ?) WHERE ref = ?");
    attr.run(1, "google", "cpc", "tailbone-pain-delhi", "/coccydynia", "-5 days", "TB-DEMO17");
    attr.run(1, "google", "cpc", "coccyx-specialist", "/", "-2 days", "TB-DEMO51");
    attr.run(0, "instagram", "social", "reel-sitting-tips", "/treatment", "-1 days", "TB-DEMO35");
    attr.run(1, "google", "cpc", "tailbone-pain-delhi", "/coccydynia", "-12 days", "TB-DEMO56");

    const partner = db.prepare(`INSERT INTO partners (code, kind, name, contact_name, phone, email, city, payout_details, password_hash, patient_id, status, approved_at, approved_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now','-60 days') END, CASE WHEN ? = 'active' THEN 'Demo Doctor' END, datetime('now', ?))`);
    const hospital = Number(partner.run("REF-CITY7", "hospital", "City Ortho Hospital", "Dr P. Malhotra", `91${DEMO_PARTNER.phone}`, "ortho@example.com", "Gurugram",
      encrypt("cityortho@okicici"), hashPassword(DEMO_PARTNER.password), null, "active", "active", "active", "-60 days").lastInsertRowid);
    const ashaCode = Number(partner.run("REF-ASHA4", "patient", DEMO_PATIENT.name, "", null, null, "", encrypt("asha@okaxis"), null, asha, "active", "active", "active", "-14 days").lastInsertRowid);
    partner.run("REF-SAAT2", "ngo", "Saathi Women's Health Trust", "Ritu Bansal", "919999900022", null, "Lucknow", "", hashPassword(crypto.randomBytes(12).toString("hex")), null, "pending", "pending", "pending", "-1 days");
    // Rohan was referred by the hospital (first booking confirmed: reward earned). Pooja, last month, was paid for.
    db.prepare("UPDATE patients SET referred_by = ? WHERE id = ?").run(hospital, rohan);
    db.prepare("UPDATE appointments SET referral_partner_id = ? WHERE ref = 'TB-DEMO23'").run(hospital);
    const pooja = patient("Pooja Sharma", "9999900013");
    consent(pooja);
    prof.run("female", year - 27, "Gurugram", "office", "Designer", "gt8", "1to6m", "doctor", pooja);
    db.prepare("UPDATE patients SET referred_by = ? WHERE id = ?").run(hospital, pooja);
    const poojaVisit = appt(pooja, "TB-DEMO71", "del", addDays(today, -35), 2, "completed", { paid: 80000, notes: "Referred by City Ortho. IM session 1." });
    db.prepare("UPDATE appointments SET referral_partner_id = ?, created_at = datetime('now','-40 days') WHERE id = ?").run(hospital, poojaVisit);
    // Meera was referred by Asha (pending booking: nothing earned until it's confirmed).
    db.prepare("UPDATE patients SET referred_by = ? WHERE id = ?").run(ashaCode, meera);
    db.prepare("UPDATE appointments SET referral_partner_id = ? WHERE ref = 'TB-DEMO52'").run(ashaCode);
    for (const { id } of db.prepare("SELECT id FROM appointments WHERE referral_partner_id IS NOT NULL").all()) syncRewards(db, id);
    const payout = Number(db.prepare("INSERT INTO partner_payouts (partner_id, amount, method, reference, notes, paid_by, paid_at) VALUES (?, ?, 'UPI', 'UTR 4021 7781 0032', ?, 'Demo Doctor', datetime('now','-3 days'))")
      .run(hospital, 105000, `For ${addDays(today, -30).slice(0, 7)}`).lastInsertRowid);
    db.prepare("UPDATE referral_rewards SET status = 'paid', payout_id = ? WHERE patient_id = ?").run(payout, pooja);

    const hv = db.prepare(`INSERT INTO home_visits (ref, name, phone, email, organisation, city, details, patients, date_from, date_to, status, clinic_notes, agreed_terms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?))`);
    hv.run("HV-D3M01", "Anil Gupta", "919999900031", null, "", "Jaipur, India", encrypt("My mother (62) and my wife (35) both have tailbone pain. We live in Malviya Nagar; nearest airport Jaipur."), 2,
      addDays(today, 12), addDays(today, 13), "new", encrypt(""), "-6 hours");
    hv.run("HV-D3M02", "Farah Siddiqui", "919999900032", "hr@example.com", "Nimbus Software (HR)", "Pune, India", encrypt("Workplace health day for employees with back and tailbone pain; about 8 people want to be seen."), 8,
      addDays(today, 25), addDays(today, 26), "discussing", encrypt("Sent estimate: fees for 8 + flights + 1 night. Waiting for approval."), "-4 days");

    db.prepare(`INSERT INTO blog_posts (id, slug, title, source, status, summary, tags, body, author, enabled, updated_at, changed_at, changed_by)
      VALUES (1001, 'desk-habits-for-tailbone-pain', ?, 'dashboard', 'draft', ?, ?, ?, 'Dr Rajveer Singh', 1, datetime('now','-1 hours'), datetime('now','-1 hours'), 'Demo Doctor')`)
      .run("Five desk habits that ease tailbone pain", "Small changes at work that take pressure off a sore coccyx: how you sit, how often you stand, and what to sit on.",
        JSON.stringify(["Self-care", "Work and lifestyle"]),
        "A draft written in the dashboard, to show how articles work. Add pictures, a YouTube or Instagram video, or a voice recording with the buttons above.\n\n## 1. Lean slightly forward\n\nSitting upright or a little forward moves your weight from the tailbone onto your thigh bones.\n\n## 2. Stand up every 30 minutes\n\nSet a reminder. Two minutes of walking is enough.\n\n## 3. Use the right cushion\n\nFirm, with a cut-out at the back, thicker at the back than the front.\n\n> Tip: keep a cushion in the car too.");

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
