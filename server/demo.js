import crypto from "node:crypto";
import { encrypt } from "./crypto.js";
import { hashPassword } from "./auth.js";
import { clinicNow, addDays, slotsForDate } from "./time.js";
import { seedStories, makeToken } from "./services.js";
import { NOTICE_VERSION } from "./privacy.js";

// Sample data for DEMO_MODE. All people are fictional; phone numbers use the unassigned 9999900xxx range.
export const DEMO_ADMIN = { email: "demo@tailbonetreatment.com", name: "Demo Doctor" };
export const DEMO_PATIENT = { ref: "TB-DEMO42", phone: "9999900001", name: "Asha Verma" };

const TABLES = ["notifications", "refunds", "appointment_events", "checkins", "followups", "consents", "data_requests",
  "appointments", "patients", "stories", "media", "blocked_dates", "settings", "security_log", "admins"];

/** Wipe the demo database and fill it with a realistic day at the clinic. */
export function seedDemo(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
    // Unusable random password: the demo admin can only sign in with the demo button.
    db.prepare("INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)")
      .run(DEMO_ADMIN.email, DEMO_ADMIN.name, hashPassword(crypto.randomBytes(24).toString("hex")));

    const today = clinicNow().date;
    const slot = (date, i) => { const s = slotsForDate(date); return s[Math.min(i, s.length - 1)]; };
    const patient = (name, phone, notes = "") => Number(db.prepare("INSERT INTO patients (name, phone, notes) VALUES (?, ?, ?)")
      .run(name, `91${phone}`, encrypt(notes)).lastInsertRowid);
    const appt = (pid, ref, clinic, date, i, status, { reason = "", notes = "", paid = 0, platform = 0, refunded = 0, visit = "new", cancelledBy = null } = {}) => {
      const fee = visit === "followup" ? 50000 : 80000;
      const id = Number(db.prepare(
        `INSERT INTO appointments (ref, patient_id, clinic, date, time, status, reason, notes, source, visit_type, fee, platform_fee,
           payment_status, payment_id, amount_paid, amount_refunded, cancelled_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ref, pid, clinic, date, slot(date, i), status, encrypt(reason), encrypt(notes), visit, fee, platform,
        paid ? (refunded >= paid ? "refunded" : refunded ? "partially_refunded" : "paid") : "pay_at_clinic",
        paid ? `pay_demo_${ref.slice(3)}` : null, paid, refunded, cancelledBy).lastInsertRowid);
      db.prepare("INSERT INTO appointment_events (appointment_id, actor, actor_name, action, detail) VALUES (?, 'patient', ?, 'booked', ?)")
        .run(id, "", `${clinic}, ${date}`);
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

    // 1. The demo patient: treated 3 weeks ago, improving, next visit tomorrow.
    const asha = patient(DEMO_PATIENT.name, DEMO_PATIENT.phone, "Fall on stairs Jan 2026. MRI: no fracture. Desk job.");
    consent(asha);
    const ashaPast = appt(asha, "TB-DEMO17", "blr", addDays(today, -21), 2, "completed", { reason: "Pain when sitting for over 20 minutes since a fall", notes: "IM session 1. Coccyx hypermobile. Advised wedge cushion.", paid: 80000, platform: 10000 });
    checkin(asha, null, 7, "same", 21, "Before treatment", 15);
    const f1 = followup(asha, ashaPast, addDays(today, -14), "done");
    checkin(asha, f1, 4, "better", 14, "Much easier to sit at work", 45);
    const f2 = followup(asha, ashaPast, addDays(today, -7), "done");
    checkin(asha, f2, 2, "better", 7, "", 90);
    appt(asha, DEMO_PATIENT.ref, "blr", addDays(today, 1), 3, "confirmed", { reason: "Review visit", paid: 50000, platform: 10000, visit: "followup" });

    // 2. Today's patients.
    const rohan = patient("Rohan Mehta", "9999900002");
    consent(rohan);
    appt(rohan, "TB-DEMO23", "del", today, 1, "confirmed", { reason: "Sharp pain standing up from a chair", paid: 80000 });
    const kavya = patient("Kavya Iyer", "9999900003");
    consent(kavya, false);
    appt(kavya, "TB-DEMO35", "online", today, 4, "pending", { reason: "Tailbone pain after childbirth, 4 months" });

    // 3. Follow-up due today.
    const imran = patient("Imran Khan", "9999900004");
    consent(imran);
    const imranPast = appt(imran, "TB-DEMO48", "del", addDays(today, -14), 0, "completed", { notes: "IM session 1. Good response.", paid: 80000 });
    followup(imran, imranPast, today, "pending", "checkin", "Check sitting tolerance");

    // 4. Pain getting worse → alert, overdue follow-up call.
    const neha = patient("Neha Kapoor", "9999900005");
    consent(neha);
    const nehaPast = appt(neha, "TB-DEMO56", "blr", addDays(today, -10), 1, "completed", { notes: "Stiff coccyx; discussed 2nd session.", paid: 80000 });
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
    note.run(null, "patient", "confirmed", "manual", "919999900002", encrypt("Hi Rohan, your appointment TB-DEMO23 is confirmed for today at our New Delhi clinic. Manage: /manage.html?ref=TB-DEMO23"), "manual", "-3 hours");

    seedStories(db);
    db.prepare("INSERT INTO stories (name, city, rating, title, body, duration, status, source) VALUES (?, ?, 5, ?, ?, ?, 'pending', 'web')")
      .run("Asha Verma", "Bengaluru", "Back at my desk all day", "After months of shifting in my chair, two sessions and a cushion later I can work a full day. The check-in messages kept me on track.", "8 months");

    db.prepare("INSERT INTO data_requests (ref, type, name, phone, details, patient_id, due_at) VALUES ('DR-DEMO0001', 'access', 'Imran Khan', '919999900004', ?, ?, ?)")
      .run(encrypt("Please send me a copy of my records."), imran, addDays(today, 25));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
