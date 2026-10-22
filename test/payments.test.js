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
const orders = new Map();
const paymentOverride = new Map(); // order id → fields that differ in Razorpay's record of the payment
const orderPayments = new Map(); // order id → payments Razorpay reports for it
setPaymentClient(async (method, url, body) => {
  calls.push({ method, url, body });
  if (url === "/orders") { const o = { id: `order_${calls.length}`, amount: body.amount }; orders.set(o.id, o); return o; }
  if (url.endsWith("/refund")) return { id: `rfnd_${calls.length}`, status: "processed" };
  // Payments the tests make are named pay_<order id> and are captured for the order's full amount.
  let m;
  if (method === "GET" && (m = /^\/payments\/pay_(order_\d+)$/.exec(url))) return { id: `pay_${m[1]}`, order_id: m[1], amount: orders.get(m[1])?.amount, currency: "INR", status: "captured", ...paymentOverride.get(m[1]) };
  if (method === "GET" && (m = /^\/orders\/(order_\d+)\/payments$/.exec(url))) return { items: orderPayments.get(m[1]) || [] };
  if (method === "POST" && (m = /^\/payments\/([\w]+)\/capture$/.exec(url))) return { id: m[1], status: "captured", amount: body.amount };
  throw new Error(`unexpected call ${method} ${url}`);
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
const book = (offset, i, extra = {}) => api("POST", "/api/appointments", { name: "Kavya Menon", phone: String(phoneSeq++), clinic: "del", ...slot(offset, i), reason: "Sharp pain when sitting", ...extra });

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
  const slots = await api("GET", `/api/slots?clinic=del&date=${slot(5).date}`);
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
  const payload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_hook", order_id: orderId, amount: 80000, currency: "INR", status: "captured" } } } });
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
  const appt = db.prepare("SELECT id FROM appointments WHERE appt_no = ?").get(created.body.appointment.ref);
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
  const appt = db.prepare("SELECT id FROM appointments WHERE appt_no = ?").get(ref);

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
  const again = await api("POST", "/api/appointments", { name: "Arjun Rao", phone, clinic: "del", ...slot(5, 3) });
  assert.equal(again.status, 201);
  assert.equal(again.body.appointment.visitType, "followup");
  assert.equal(again.body.payment.amount, 50000);
});

test("unpaid holds expire and free the slot", async () => {
  const created = await book(12, 0);
  db.prepare("UPDATE appointments SET hold_until = datetime('now','-1 minute') WHERE appt_no = ?").run(created.body.appointment.ref);
  const slots = await api("GET", `/api/slots?clinic=del&date=${slot(12).date}`);
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
  assert.ok(csp.includes("script-src 'self' https://checkout.razorpay.com https://www.googletagmanager.com"));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "no inline scripts allowed");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("a booking keeps the cancellation and reschedule rules in force when it was made", async () => {
  const { refundQuote, rescheduleCheck, policySnapshot, DEFAULT_POLICY } = await import("../server/policy.js");
  const appt = { date: "2026-11-10", time: "10:00", amount_paid: 80000, amount_refunded: 0, reschedule_count: 0,
    policy_snapshot: policySnapshot(DEFAULT_POLICY) };
  const stricter = { ...DEFAULT_POLICY, cancellation: [{ hoursBefore: 0, refundPercent: 0 }], reschedule: { minHoursBefore: 48, maxTimes: 0 } };
  const now = new Date("2026-11-08T12:00:00+05:30"); // 46 hours before
  assert.equal(refundQuote(appt, stricter, { now }).percent, 100, "rules saved with the booking apply");
  assert.equal(rescheduleCheck(appt, stricter, now).allowed, true);
  assert.equal(refundQuote({ ...appt, policy_snapshot: null }, stricter, { now }).percent, 0, "older bookings without a snapshot use current rules");
});

test("Razorpay's own record decides: a short payment is refused, an authorised one is captured", async () => {
  const short = await book(8, 0);
  paymentOverride.set(short.body.payment.orderId, { amount: 100 });
  assert.equal((await payFor(short)).status, 400);
  const row = db.prepare("SELECT payment_status FROM appointments WHERE payment_order_id = ?").get(short.body.payment.orderId);
  assert.equal(row.payment_status, "awaiting");

  const auth = await book(8, 1);
  paymentOverride.set(auth.body.payment.orderId, { status: "authorized" });
  assert.equal((await payFor(auth)).status, 200);
  assert.ok(calls.some((c) => c.url === `/payments/pay_${auth.body.payment.orderId}/capture` && c.body.amount === 80000));
});

test("a payment whose confirmation went missing is found by checking Razorpay (page reload, background check)", async () => {
  const created = await book(8, 2);
  const { orderId } = created.body.payment;
  assert.equal((await api("POST", "/api/payments/status", { orderId })).body.paid, false);
  orderPayments.set(orderId, [{ id: `pay_${orderId}`, order_id: orderId, amount: 80000, currency: "INR", status: "captured" }]);
  const st = await api("POST", "/api/payments/status", { orderId });
  assert.equal(st.body.paid, true);
  assert.equal(st.body.appointment.status, "confirmed");
});

test("a fee to pay at the clinic can be paid online later from My appointments, reusing one order", async () => {
  const phone = "9711100001";
  const made = await api("POST", "/api/admin/appointments", { name: "Phone Booking", phone, clinic: "del", ...slot(9, 0) }, { auth: true });
  const ref = made.body.appointment.appt_no;
  const look = await api("POST", "/api/manage/lookup", { ref, phone });
  assert.equal(look.body.appointment.canPay, true);
  const first = await api("POST", "/api/manage/pay", { ref, phone });
  const again = await api("POST", "/api/manage/pay", { ref, phone });
  assert.equal(first.body.payment.orderId, again.body.payment.orderId, "the same order, so a late payment on the first try still counts");
  const orderId = first.body.payment.orderId;
  const pay = await api("POST", "/api/payments/verify", { orderId, paymentId: `pay_${orderId}`, signature: sign(orderId, `pay_${orderId}`) });
  assert.equal(pay.status, 200);
  assert.equal(pay.body.appointment.payment.status, "paid");
  assert.equal((await api("POST", "/api/manage/pay", { ref, phone })).status, 409);
  const outbox = await api("GET", "/api/admin/notifications?audience=patient", null, { auth: true });
  assert.equal(outbox.body.notifications.filter((n) => n.body.includes(ref)).length, 1, "no second booking confirmation for paying later");
});

test("a refund that fails at the bank is put back as paid so the clinic can retry", async () => {
  const created = await book(9, 1);
  await payFor(created);
  const appt = db.prepare("SELECT id FROM appointments WHERE payment_order_id = ?").get(created.body.payment.orderId);
  const r = await api("POST", `/api/admin/appointments/${appt.id}/refund`, { amount: 800, reason: "goodwill" }, { auth: true });
  assert.equal(r.status, 200);
  const refundRow = db.prepare("SELECT provider_refund_id, status FROM refunds WHERE appointment_id = ? ORDER BY id DESC").get(appt.id);
  assert.equal(db.prepare("SELECT payment_status FROM appointments WHERE id = ?").get(appt.id).payment_status, "refunded");
  const payload = JSON.stringify({ event: "refund.failed", payload: { refund: { entity: { id: refundRow.provider_refund_id, amount: 80000 } } } });
  const sig = crypto.createHmac("sha256", "whsec_test").update(payload).digest("hex");
  assert.equal((await api("POST", "/api/payments/webhook", payload, { headers: { "x-razorpay-signature": sig } })).status, 200);
  const after = db.prepare("SELECT payment_status, amount_refunded FROM appointments WHERE id = ?").get(appt.id);
  assert.deepEqual([after.payment_status, after.amount_refunded], ["paid", 0]);
});
