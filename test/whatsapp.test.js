// Automatic WhatsApp messages: reminders, check-ins, Hindi texts, delivery receipts and STOP replies.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-wa-"));
Object.assign(process.env, {
  DATA_DIR: tmp, SESSION_SECRET: "test-secret",
  WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_VERIFY_TOKEN: "verify-me",
});

const { openDb } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { setSenders, runReminderJob, runSoonReminders, runCheckinJob, compose, saveWhatsappSettings } = await import("../server/notify.js");
const { getAppointment, createFollowup } = await import("../server/services.js");

const sent = [];
let seq = 0;
setSenders({ whatsapp: async (to, text, lang) => { sent.push({ to, text, lang }); return `wamid.${++seq}`; }, email: async () => {} });

const db = openDb(path.join(tmp, "wa.db"));
let server;
let base;
before(async () => {
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const book = async (phone, { offset = 1, i = 0, lang = "en", whatsapp = true } = {}) => {
  const date = addDays(clinicNow().date, offset);
  const res = await fetch(`${base}/api/appointments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Meena Sharma", phone, clinic: "del", date, time: slotsForDate(date)[i], consent: true, whatsappConsent: whatsapp, lang }),
  });
  const body = await res.json();
  return db.prepare("SELECT id FROM appointments WHERE appt_no = ?").get(body.appointment.apptNo).id;
};

test("a booking from the Hindi site gets Hindi messages, sent with the Hindi template", async () => {
  sent.length = 0;
  await book("9800000001", { lang: "hi", i: 1 });
  await new Promise((r) => setTimeout(r, 50));
  const msg = sent.find((m) => m.to === "919800000001");
  assert.equal(msg.lang, "hi");
  assert.match(msg.text, /नमस्ते Meena/);
  const row = db.prepare("SELECT provider_id, delivery FROM notifications WHERE recipient = '919800000001' AND audience = 'patient'").get();
  assert.match(row.provider_id, /^wamid\./);
  assert.equal(row.delivery, "sent");
});

test("day-before reminders go once, only to patients who agreed, and can be switched off", async () => {
  const yes = await book("9800000002", { offset: 1, i: 2 });
  await book("9800000003", { offset: 1, i: 3, whatsapp: false });
  sent.length = 0;
  saveWhatsappSettings(db, { dayBefore: false });
  assert.equal(await runReminderJob(db, getAppointment, addDays(clinicNow().date, 1)), 0);
  saveWhatsappSettings(db, { dayBefore: true });
  await runReminderJob(db, getAppointment, addDays(clinicNow().date, 1));
  assert.ok(sent.some((m) => m.to === "919800000002" && /reminder/.test(m.text)));
  assert.ok(!sent.some((m) => m.to === "919800000003"), "no consent, no automatic message");
  const again = await runReminderJob(db, getAppointment, addDays(clinicNow().date, 1));
  assert.equal(again, 0, "each reminder is sent once");
  assert.ok(yes);
});

test("same-day reminder about two hours before, not for bookings made in the last 3 hours", async () => {
  const today = clinicNow().date;
  const id = await book("9800000004", { offset: 1, i: 4 });
  // Move it to today, two hours from a pretend "now" of 10:00, and make the booking old.
  db.prepare("UPDATE appointments SET date = ?, time = '12:00', created_at = datetime('now','-1 day') WHERE id = ?").run(today, id);
  sent.length = 0;
  assert.equal(await runSoonReminders(db, getAppointment, { date: today, minutes: 10 * 60 }), 1);
  assert.match(sent[0].text, /see you today at 12:00 PM/);
  assert.equal(await runSoonReminders(db, getAppointment, { date: today, minutes: 10 * 60 + 10 }), 0, "once only");
  const fresh = await book("9800000005", { offset: 1, i: 5 });
  db.prepare("UPDATE appointments SET date = ?, time = '12:30' WHERE id = ?").run(today, fresh);
  assert.equal(await runSoonReminders(db, getAppointment, { date: today, minutes: 10 * 60 }), 0, "just booked: no reminder");
});

test("follow-up check-in links are sent automatically on their due day, once", async () => {
  const id = await book("9800000006", { offset: 1, i: 6 });
  const a = getAppointment(db, id);
  createFollowup(db, { patientId: a.patient_id, appointmentId: id, dueDate: clinicNow().date, type: "checkin" });
  sent.length = 0;
  assert.equal(await runCheckinJob(db, { today: clinicNow().date, base: "https://example.org", checkinsOn: true }), 1);
  assert.match(sent[0].text, /https:\/\/example\.org\/checkin\.html\?t=/);
  assert.equal(await runCheckinJob(db, { today: clinicNow().date, base: "https://example.org", checkinsOn: true }), 0);
});

test("WhatsApp webhook: verified with the app secret; delivery receipts update the outbox; STOP turns messages off", async () => {
  const verify = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.equal(await verify.text(), "42");
  const id = await book("9800000007", { offset: 2, i: 0 });
  await new Promise((r) => setTimeout(r, 50));
  const wamid = db.prepare("SELECT provider_id FROM notifications WHERE recipient = '919800000007' AND audience = 'patient'").get().provider_id;
  const post = (payload, secret = "app-secret") => {
    const raw = JSON.stringify(payload);
    return fetch(`${base}/api/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw });
  };
  const change = (value) => ({ entry: [{ changes: [{ value }] }] });
  assert.equal((await post(change({ statuses: [{ id: wamid, status: "read" }] }), "wrong")).status, 401);
  assert.equal((await post(change({ statuses: [{ id: wamid, status: "delivered" }] }))).status, 200);
  await post(change({ statuses: [{ id: wamid, status: "read" }] }));
  await post(change({ statuses: [{ id: wamid, status: "delivered" }] })); // late and out of order: ignored
  assert.equal(db.prepare("SELECT delivery FROM notifications WHERE provider_id = ?").get(wamid).delivery, "read");

  await post(change({ messages: [{ from: "919800000007", type: "text", text: { body: "STOP" } }] }));
  const pid = getAppointment(db, id).patient_id;
  assert.ok(db.prepare("SELECT withdrawn_at FROM consents WHERE patient_id = ? AND purpose = 'whatsapp_updates'").get(pid).withdrawn_at);
  await post(change({ messages: [{ from: "919800000007", type: "text", text: { body: "Can I come at 5?" } }] }));
  const inbox = db.prepare("SELECT event FROM notifications WHERE audience = 'doctor' AND event LIKE 'whatsapp_%' ORDER BY id").all().map((r) => r.event);
  assert.deepEqual(inbox, ["whatsapp_stop", "whatsapp_reply"]);
});

test("Hindi texts exist for every patient message", () => {
  const a = { patient_name: "Asha Verma", patient_lang: "hi", appt_no: "TBA-2610-0001", clinic: "online", date: "2026-11-02", time: "10:30", status: "confirmed", payment_status: "paid", amount_paid: 80000, fee: 80000, patient_phone: "919999900001" };
  for (const ev of ["booked", "confirmed", "rescheduled", "cancelled", "no_show", "refunded", "reminder", "reminder_soon", "checkin"]) {
    const t = compose(ev, a, "https://x.org", { from: "earlier", amount: 50000, link: "https://x.org/c" }).patient;
    assert.match(t, /[ऀ-ॿ]/, `${ev} is in Hindi`);
  }
});
