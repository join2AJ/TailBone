import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-pay-"));
Object.assign(process.env, {
  DATA_DIR: tmp,
  SESSION_SECRET: "test-secret",
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec_test",
});

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { setPaymentClient } = await import("../server/payments.js");
const { refundQuote, DEFAULT_POLICY, rescheduleCheck } = await import("../server/policy.js");

// Fake Razorpay: records every call.
const calls = [];
setPaymentClient(async (method, url, body) => {
  calls.push({ method, url, body });
  if (url === "/orders") return { id: `order_${calls.length}`, amount: body.amount };
  if (url.endsWith("/refund")) return { id: `rfnd_${calls.length}` };
  throw new Error("unexpected call");
});

const db = openDb(path.join(tmp, "pay.db"));
let server;
let base;
let cookie = "";

async function api(method, url, body, { auth = false, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  // Public bookings need privacy consent; tests opt out explicitly with consent: false.
  if (method === "POST" && url === "/api/appointments" && body && typeof body === "object" && body.consent === undefined) body = { ...body, consent: true };
  if (auth) Object.assign(h, { cookie, "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers: h, body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

const sign = (orderId, paymentId) => crypto.createHmac("sha256", "rzp_test_secret").update(`${orderId}|${paymentId}`).digest("hex");
const slot = (offset, i = 0) => { const date = addDays(clinicNow().date, offset); return { date, time: slotsForDate(date)[i] }; };
let phoneSeq = 9700000000;
const book = (offset, i, extra = {}) => api("POST", "/api/appointments", { name: "Kavya Menon", phone: String(phoneSeq++), clinic: "blr", ...slot(offset, i), reason: "Sharp pain when sitting", ...extra });

async function payFor(created) {
  const { orderId } = created.body.payment;
  const paymentId = `pay_${orderId}`;
  return api("POST", "/api/payments/verify", { orderId, paymentId, signature: sign(orderId, paymentId) });
}

before(async () => {
  seedAdmin(db, { email: "admin@test.local", password: "correct-horse-battery" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await api("POST", "/api/admin/login", { email: "admin@test.local", password: "correct-horse-battery" });
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("commission split: order carries the doctor's transfer, platform keeps its fee", async () => {
  const saved = await api("PUT", "/api/admin/settings/policy", {
    fees: { blr: 800, del: 800, online: 800 },
    commission: { enabled: true, type: "fixed", value: 100, doctorAccountId: "acc_TestDoctor01" },
  }, { auth: true });
  assert.equal(saved.status, 200);
  assert.equal((await api("PUT", "/api/admin/settings/policy", { commission: { enabled: true, doctorAccountId: "not-an-account" } }, { auth: true })).status, 400);

  const created = await book(5, 0);
  assert.equal(created.status, 201);
  assert.equal(created.body.payment.amount, 80000);
  const order = calls.find((c) => c.url === "/orders");
  assert.equal(order.body.amount, 80000);
  assert.deepEqual(order.body.transfers.map((t) => [t.account, t.amount]), [["acc_TestDoctor01", 70000]]);

  // Slot is held while the patient pays.
  const slots = await api("GET", `/api/slots?clinic=blr&date=${slot(5).date}`);
  assert.equal(slots.body.slots[0].available, false);
});

test("payment verification: bad signature rejected, good one confirms and notifies", async () => {
  const created = await book(5, 1);
  const { orderId } = created.body.payment;
  assert.equal((await api("POST", "/api/payments/verify", { orderId, paymentId: "pay_x", signature: "deadbeef" })).status, 400);
  const ok = await payFor(created);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.appointment.status, "confirmed");
  assert.equal(ok.body.appointment.payment.status, "paid");
  // Paying twice (e.g. webhook + browser) is harmless.
  assert.equal((await payFor(created)).status, 200);

  const inbox = await api("GET", "/api/admin/notifications?audience=doctor", null, { auth: true });
  assert.ok(inbox.body.notifications.some((n) => n.body.includes("New booking") && n.body.includes(created.body.appointment.ref)));
  const outbox = await api("GET", "/api/admin/notifications?audience=patient", null, { auth: true });
  const msg = outbox.body.notifications.find((n) => n.body.includes(created.body.appointment.ref));
  assert.equal(msg.status, "manual", "no WhatsApp API configured → one-tap manual send");
  assert.ok(msg.sendUrl.startsWith("https://wa.me/"));
});

test("webhook: signature checked against the raw body", async () => {
  const created = await book(6, 0);
  const { orderId } = created.body.payment;
  const payload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_hook", order_id: orderId, amount: 80000 } } } });
  assert.equal((await api("POST", "/api/payments/webhook", payload, { headers: { "x-razorpay-signature": "bad" } })).status, 400);
  const sig = crypto.createHmac("sha256", "whsec_test").update(payload).digest("hex");
  assert.equal((await api("POST", "/api/payments/webhook", payload, { headers: { "x-razorpay-signature": sig } })).status, 200);
  const look = await api("POST", "/api/manage/lookup", { ref: created.body.appointment.ref, phone: String(phoneSeq - 1) });
  assert.equal(look.body.appointment.payment.status, "paid");
});

test("patient cancels early: full refund with split reversal, doctor notified", async () => {
  const created = await book(7, 0);
  await payFor(created);
  const phone = String(phoneSeq - 1);
  const { ref } = created.body.appointment;
  const look = await api("POST", "/api/manage/lookup", { ref, phone });
  assert.equal(look.body.appointment.cancelQuote.percent, 100);

  const res = await api("POST", "/api/manage/cancel", { ref, phone, reason: "Feeling better" });
  assert.equal(res.status, 200);
  assert.equal(res.body.refund.amount, 80000);
  const refundCall = calls.findLast((c) => c.url.endsWith("/refund"));
  assert.equal(refundCall.body.amount, 80000);
  assert.equal(refundCall.body.reverse_all, 1, "doctor's transferred share is pulled back proportionally");
  assert.equal(res.body.appointment.payment.status, "refunded");

  const inbox = await api("GET", "/api/admin/notifications?audience=doctor", null, { auth: true });
  assert.ok(inbox.body.notifications.some((n) => n.body.startsWith("Cancelled by patient") && n.body.includes(ref) && n.body.includes("Feeling better")));
});

test("clinic cancels: patient always gets a full refund and a message", async () => {
  const created = await book(8, 0);
  await payFor(created);
  const appt = db.prepare("SELECT id FROM appointments WHERE ref = ?").get(created.body.appointment.ref);
  const res = await api("PATCH", `/api/admin/appointments/${appt.id}`, { status: "cancelled", reason: "Doctor travelling" }, { auth: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.refund.amount, 80000);
  const outbox = await api("GET", "/api/admin/notifications?audience=patient", null, { auth: true });
  assert.ok(outbox.body.notifications.some((n) => n.body.includes(created.body.appointment.ref) && n.body.includes("clinic had to cancel") && n.body.includes("Refund")));
  const detail = await api("GET", `/api/admin/appointments/${appt.id}`, null, { auth: true });
  assert.deepEqual(detail.body.events.map((e) => e.action), ["booked", "paid", "cancelled", "refunded"]);
});

test("clinic reschedule notifies the patient; patient reschedule notifies the doctor and respects limits", async () => {
  await api("PUT", "/api/admin/settings/policy", { reschedule: { minHoursBefore: 12, maxTimes: 1 } }, { auth: true });
  const created = await book(9, 0);
  await payFor(created);
  const phone = String(phoneSeq - 1);
  const { ref } = created.body.appointment;
  const appt = db.prepare("SELECT id FROM appointments WHERE ref = ?").get(ref);

  const moved = await api("PATCH", `/api/admin/appointments/${appt.id}`, { ...slot(9, 3) }, { auth: true });
  assert.equal(moved.status, 200);
  const outbox = await api("GET", "/api/admin/notifications?audience=patient", null, { auth: true });
  assert.ok(outbox.body.notifications.some((n) => n.body.includes(ref) && n.body.includes("clinic has moved")));

  assert.equal((await api("POST", "/api/manage/reschedule", { ref, phone, ...slot(10, 0) })).status, 200);
  const inbox = await api("GET", "/api/admin/notifications?audience=doctor", null, { auth: true });
  assert.ok(inbox.body.notifications.some((n) => n.body.startsWith("Rescheduled by patient") && n.body.includes(ref)));
  const second = await api("POST", "/api/manage/reschedule", { ref, phone, ...slot(10, 2) });
  assert.equal(second.status, 409, "only one online reschedule allowed");
});

test("refund tiers and reschedule window follow the policy", () => {
  const appt = { date: "2026-11-10", time: "10:00", amount_paid: 80000, amount_refunded: 0, reschedule_count: 0 };
  const at = (iso) => new Date(iso);
  assert.equal(refundQuote(appt, DEFAULT_POLICY, { now: at("2026-11-08T10:00:00+05:30") }).percent, 100);
  assert.equal(refundQuote(appt, DEFAULT_POLICY, { now: at("2026-11-09T20:00:00+05:30") }).percent, 50);
  assert.equal(refundQuote(appt, DEFAULT_POLICY, { now: at("2026-11-10T08:00:00+05:30") }).amount, 0);
  assert.equal(refundQuote(appt, DEFAULT_POLICY, { actor: "clinic", now: at("2026-11-10T09:59:00+05:30") }).amount, 80000);
  assert.equal(refundQuote(appt, DEFAULT_POLICY, { noShow: true }).amount, 0);
  assert.equal(rescheduleCheck(appt, DEFAULT_POLICY, at("2026-11-10T00:00:00+05:30")).allowed, false);
  assert.equal(rescheduleCheck(appt, DEFAULT_POLICY, at("2026-11-09T00:00:00+05:30")).allowed, true);
});

test("follow-up visits within the window get the follow-up rate", async () => {
  const phone = "9811234567";
  const first = await api("POST", "/api/admin/appointments", { name: "Arjun Rao", phone, clinic: "del", ...slot(0, 0) }, { auth: true });
  await api("PATCH", `/api/admin/appointments/${first.body.appointment.id}`, { status: "completed" }, { auth: true });
  const again = await api("POST", "/api/appointments", { name: "Arjun Rao", phone, clinic: "del", ...slot(11, 0) });
  assert.equal(again.status, 201);
  assert.equal(again.body.appointment.visitType, "followup");
  assert.equal(again.body.payment.amount, 50000);
});

test("unpaid holds expire and free the slot", async () => {
  const created = await book(12, 0);
  db.prepare("UPDATE appointments SET hold_until = datetime('now','-1 minute') WHERE ref = ?").run(created.body.appointment.ref);
  const slots = await api("GET", `/api/slots?clinic=blr&date=${slot(12).date}`);
  assert.equal(slots.body.slots[0].available, true);
});

test("sensitive notes are encrypted at rest", async () => {
  const row = db.prepare("SELECT reason FROM appointments WHERE reason != '' LIMIT 1").get();
  assert.ok(row.reason.startsWith("enc:v1:"));
  assert.ok(!row.reason.includes("Sharp pain"));
  const appt = db.prepare("SELECT id FROM appointments WHERE reason != '' LIMIT 1").get();
  const detail = await api("GET", `/api/admin/appointments/${appt.id}`, null, { auth: true });
  assert.equal(detail.body.appointment.reason, "Sharp pain when sitting");
});

test("security headers are set", async () => {
  const res = await fetch(`${base}/`);
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp.includes("script-src 'self' https://checkout.razorpay.com"));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "no inline scripts allowed");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});
