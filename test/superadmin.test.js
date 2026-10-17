import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-super-"));
Object.assign(process.env, { DATA_DIR: tmp, DB_FILE: path.join(tmp, "s.db"), SESSION_SECRET: "test-secret", LOGIN_RATE_MAX: "200" });

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");

const db = openDb(process.env.DB_FILE);
let server;
let base;
const jar = { super: "", staff: "" };

async function api(who, method, url, body) {
  const headers = { "content-type": "application/json" };
  if (who) Object.assign(headers, { cookie: jar[who], "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (who && sc && sc.includes("tb_session=")) jar[who] = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const signIn = (who, email, password) => api(who, "POST", "/api/admin/login", { email, password });
const slot = (offset, i = 0) => { const date = addDays(clinicNow().date, offset); return { date, time: slotsForDate(date)[i] }; };

before(async () => {
  seedAdmin(db, { email: "owner@test.local", password: "owner-password-1" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await signIn("super", "owner@test.local", "owner-password-1");
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let staffPassword;
let staffId;

test("the first account is the super admin and can add a limited admin", async () => {
  const me = await api("super", "GET", "/api/admin/me");
  assert.equal(me.body.admin.role, "superadmin");
  const created = await api("super", "POST", "/api/admin/superadmin/users", { name: "Front Desk", email: "desk@test.local", role: "admin", permissions: ["appointments", "patients"] });
  assert.equal(created.status, 201);
  staffPassword = created.body.temporaryPassword;
  assert.ok(staffPassword.length >= 10);
  assert.equal((await api("super", "POST", "/api/admin/superadmin/users", { name: "Dup", email: "desk@test.local" })).status, 409);
  staffId = (await api("super", "GET", "/api/admin/superadmin")).body.users.find((u) => u.email === "desk@test.local").id;
});

test("an admin only reaches the sections they were given", async () => {
  assert.equal((await signIn("staff", "desk@test.local", staffPassword)).status, 200);
  const me = await api("staff", "GET", "/api/admin/me");
  assert.deepEqual(me.body.admin.permissions.sort(), ["appointments", "patients"]);
  assert.equal((await api("staff", "GET", "/api/admin/appointments")).status, 200);
  assert.equal((await api("staff", "GET", "/api/admin/payments/summary")).status, 403);
  assert.equal((await api("staff", "GET", "/api/admin/privacy/requests")).status, 403);
  assert.equal((await api("staff", "GET", "/api/admin/export/appointments.csv")).status, 403);
  assert.equal((await api("staff", "GET", "/api/admin/superadmin")).status, 403);
  assert.equal((await api("staff", "GET", "/api/admin/security/log")).status, 403);
  assert.equal((await api("staff", "GET", "/api/admin/backups")).status, 403);
  assert.equal((await api("staff", "PUT", "/api/admin/superadmin/features", { stories: false })).status, 403);

  // Granting "settings" opens fees/holidays, but the commission stays super-admin only.
  await api("super", "PATCH", `/api/admin/superadmin/users/${staffId}`, { permissions: ["appointments", "patients", "settings"] });
  const pol = await api("staff", "GET", "/api/admin/settings/policy");
  assert.equal(pol.status, 200);
  assert.equal(pol.body.policy.commission, undefined, "commission hidden from admins");
  await api("staff", "PUT", "/api/admin/settings/policy", { fees: { blr: 950 }, commission: { enabled: true, type: "fixed", value: 500 } });
  const full = await api("super", "GET", "/api/admin/settings/policy");
  assert.equal(full.body.policy.fees.blr, 950);
  assert.equal(full.body.policy.commission.enabled, false, "admin can't switch the commission on");
});

test("there is always a super admin; disabled users are locked out at once", async () => {
  const ownerId = (await api("super", "GET", "/api/admin/me")).body.admin.id;
  assert.equal((await api("super", "PATCH", `/api/admin/superadmin/users/${ownerId}`, { role: "admin" })).status, 409);
  assert.equal((await api("super", "PATCH", `/api/admin/superadmin/users/${ownerId}`, { disabled: true })).status, 409);

  assert.equal((await api("super", "PATCH", `/api/admin/superadmin/users/${staffId}`, { disabled: true })).status, 200);
  assert.equal((await api("staff", "GET", "/api/admin/me")).status, 401, "existing session ends");
  assert.equal((await signIn("staff", "desk@test.local", staffPassword)).status, 403);

  const reset = await api("super", "PATCH", `/api/admin/superadmin/users/${staffId}`, { disabled: false, resetPassword: true });
  assert.equal((await signIn("staff", "desk@test.local", reset.body.temporaryPassword)).status, 200);
  const log = db.prepare("SELECT action FROM security_log").all().map((r) => r.action);
  assert.ok(log.includes("user_created") && log.includes("user_updated"));
});

test("feature switches are enforced on the public site", async () => {
  // Book one appointment while everything is on.
  const booking = { name: "Lata Shah", phone: "9811100022", clinic: "blr", ...slot(5), consent: true };
  const ok = await api(null, "POST", "/api/appointments", booking);
  assert.equal(ok.status, 201);

  const off = { online_booking: false, patient_self_service: false, stories: false, instagram: false, followup_checkins: false };
  assert.equal((await api("super", "PUT", "/api/admin/superadmin/features", off)).status, 200);
  const cfg = await api(null, "GET", "/api/config");
  assert.equal(cfg.body.features.online_booking, false);
  assert.equal(cfg.body.features.symptom_checker, true, "untouched switches stay on");

  assert.equal((await api(null, "POST", "/api/appointments", { ...booking, phone: "9811100033", ...slot(5, 2) })).status, 403);
  const look = await api(null, "POST", "/api/manage/lookup", { ref: ok.body.appointment.ref, phone: booking.phone });
  assert.equal(look.body.appointment.canChange, false);
  assert.equal((await api(null, "POST", "/api/manage/cancel", { ref: ok.body.appointment.ref, phone: booking.phone })).status, 409);
  assert.equal((await api(null, "GET", "/api/stories")).body.disabled, true);
  assert.equal((await api(null, "POST", "/api/stories", { name: "X Y", rating: 5, body: "x".repeat(40), consent: true })).status, 403);
  assert.deepEqual((await api(null, "GET", "/api/media")).body.media, []);
  assert.equal((await api(null, "GET", "/api/checkin/whatever")).status, 404);
  // Legal rights stay available whatever the switches say.
  assert.equal((await api(null, "POST", "/api/manage/export", { ref: ok.body.appointment.ref, phone: booking.phone })).status, 200);

  await api("super", "PUT", "/api/admin/superadmin/features", { online_booking: true, patient_self_service: true, stories: true, instagram: true, followup_checkins: true });
  assert.equal((await api(null, "POST", "/api/manage/cancel", { ref: ok.body.appointment.ref, phone: booking.phone })).status, 200);
});
