import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-comp-"));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, "comp.db");
process.env.SESSION_SECRET = "test-secret";
process.env.LOGIN_RATE_MAX = "100"; // this file signs in many times from one IP; lockout per account is still tested

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { totpCode } = await import("../server/auth.js");
const { runRetention } = await import("../server/privacy.js");
const { decryptBuffer } = await import("../server/crypto.js");

const db = openDb(process.env.DB_FILE);
let server;
let base;
let cookie = "";

async function api(method, url, body, { auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) Object.assign(headers, { cookie, "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.includes("tb_session=")) cookie = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
const slot = (offset, i = 0) => { const date = addDays(clinicNow().date, offset); return { date, time: slotsForDate(date)[i] }; };
const login = (extra = {}) => api("POST", "/api/admin/login", { email: "admin@test.local", password: "correct-horse-battery", ...extra });

before(async () => {
  seedAdmin(db, { email: "admin@test.local", password: "correct-horse-battery" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("booking requires consent and records it against the notice version", async () => {
  const body = { name: "Neha Gupta", phone: "9812300001", clinic: "blr", ...slot(4), reason: "Coccyx pain" };
  assert.equal((await api("POST", "/api/appointments", body)).status, 400);
  const ok = await api("POST", "/api/appointments", { ...body, consent: true, whatsappConsent: true });
  assert.equal(ok.status, 201);
  const rows = db.prepare("SELECT purpose, notice_version FROM consents ORDER BY purpose").all();
  assert.deepEqual(rows.map((r) => r.purpose), ["care", "whatsapp_updates"]);
  assert.match(rows[0].notice_version, /^\d{4}-\d{2}-\d{2}$/);

  // Patient withdraws WhatsApp consent and downloads their data.
  const creds = { ref: ok.body.appointment.ref, phone: "9812300001" };
  const c = await api("POST", "/api/manage/consent", { ...creds, whatsappUpdates: false });
  assert.deepEqual(c.body.consents, ["care"]);
  const exp = await api("POST", "/api/manage/export", creds);
  assert.equal(exp.status, 200);
  assert.equal(exp.body.patient.name, "Neha Gupta");
  assert.equal(exp.body.appointments[0].reason, "Coccyx pain", "export is decrypted for the patient");
});

test("account lockout after repeated wrong passwords", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login({ password: "wrong-password-x" })).status, 401);
  assert.equal((await login()).status, 423, "locked even with the right password");
  db.prepare("UPDATE admins SET locked_until = NULL, failed_logins = 0").run();
  assert.equal((await login()).status, 200);
  const log = db.prepare("SELECT action FROM security_log ORDER BY id").all().map((r) => r.action);
  assert.ok(log.includes("account_locked") && log.includes("login_blocked_locked") && log.includes("login"));
});

test("two-factor sign-in", async () => {
  await login();
  const setup = await api("POST", "/api/admin/2fa/setup", null, { auth: true });
  const secret = setup.body.secret.replace(/\s/g, "");
  assert.equal((await api("POST", "/api/admin/2fa/enable", { code: "000000" }, { auth: true })).status, 400);
  assert.equal((await api("POST", "/api/admin/2fa/enable", { code: totpCode(secret) }, { auth: true })).status, 200);
  cookie = "";
  const noCode = await login();
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.needCode, true);
  assert.equal((await login({ code: "123456" })).status, 401);
  assert.equal((await login({ code: totpCode(secret) })).status, 200);
  assert.ok(db.prepare("SELECT totp_secret FROM admins").get().totp_secret.startsWith("enc:v1:"), "2FA secret encrypted at rest");
  // Disable again for the remaining tests.
  await api("POST", "/api/admin/2fa/disable", { password: "correct-horse-battery", code: totpCode(secret) }, { auth: true });
});

test("password change signs out other sessions", async () => {
  await login();
  const other = cookie;
  await login();
  const res = await api("POST", "/api/admin/password", { current: "correct-horse-battery", next: "correct-horse-battery" }, { auth: true });
  assert.equal(res.status, 200);
  const stale = await fetch(`${base}/api/admin/me`, { headers: { cookie: other } });
  assert.equal(stale.status, 401);
  assert.equal((await api("GET", "/api/admin/me", null, { auth: true })).status, 200, "current session continues");
});

test("privacy request reaches the clinic; erasure removes identity but keeps finances", async () => {
  await login();
  const req = await api("POST", "/api/privacy/request", { type: "erasure", name: "Neha Gupta", phone: "9812300001", details: "Please delete my data" });
  assert.equal(req.status, 201);
  assert.match(req.body.ref, /^DR-/);
  const list = await api("GET", "/api/admin/privacy/requests", null, { auth: true });
  const r = list.body.requests[0];
  assert.equal(r.details, "Please delete my data");
  assert.ok(r.patient_id, "matched to the patient by phone");

  const { id: apptId } = db.prepare("SELECT id FROM appointments WHERE patient_id = ?").get(r.patient_id);
  assert.equal((await api("POST", `/api/admin/patients/${r.patient_id}/erase`, { confirm: "Neha Gupta" }, { auth: true })).status, 409, "upcoming visit must be cancelled first");
  await api("PATCH", `/api/admin/appointments/${apptId}`, { status: "cancelled", silent: true }, { auth: true });
  assert.equal((await api("POST", `/api/admin/patients/${r.patient_id}/erase`, { confirm: "wrong name" }, { auth: true })).status, 400);
  assert.equal((await api("POST", `/api/admin/patients/${r.patient_id}/erase`, { confirm: "neha gupta" }, { auth: true })).status, 200);

  const p = db.prepare("SELECT * FROM patients WHERE id = ?").get(r.patient_id);
  assert.equal(p.name, "Erased patient");
  assert.ok(p.phone.startsWith("erased-"));
  const a = db.prepare("SELECT ref, reason, fee FROM appointments WHERE id = ?").get(apptId);
  assert.equal(a.reason, "");
  assert.ok(a.ref && a.fee > 0, "booking ref and amounts retained");
  assert.ok(db.prepare("SELECT 1 FROM security_log WHERE action = 'patient_erased'").get());
});

test("retention erases long-inactive patients only", async () => {
  db.prepare("INSERT INTO patients (name, phone, created_at) VALUES ('Old Patient', '919800000001', '2019-01-01 10:00:00')").run();
  db.prepare("INSERT INTO patients (name, phone) VALUES ('Recent Patient', '919800000002')").run();
  const { erased } = runRetention(db);
  assert.equal(erased, 1);
  assert.equal(db.prepare("SELECT name FROM patients WHERE phone = '919800000002'").get().name, "Recent Patient");
  assert.ok(!db.prepare("SELECT 1 FROM patients WHERE name = 'Old Patient'").get());
});

test("encrypted backups can be created, downloaded and decrypted", async () => {
  await login();
  const made = await api("POST", "/api/admin/backups", null, { auth: true });
  assert.equal(made.status, 201);
  const res = await fetch(`${base}/api/admin/backups/${encodeURIComponent(made.body.file)}`, { headers: { cookie } });
  const enc = Buffer.from(await res.arrayBuffer());
  assert.equal(enc.subarray(0, 5).toString(), "TBBK1");
  assert.ok(!enc.includes(Buffer.from("SQLite format 3")), "backup is not readable without the key");
  const plain = decryptBuffer(enc);
  assert.equal(plain.subarray(0, 15).toString(), "SQLite format 3");
  assert.equal((await fetch(`${base}/api/admin/backups/..%2F..%2Fetc%2Fpasswd`, { headers: { cookie } })).status, 404);
});

test("no third-party font or script hosts in the security policy", async () => {
  const csp = (await fetch(`${base}/`)).headers.get("content-security-policy");
  assert.ok(!csp.includes("googleapis") && !csp.includes("gstatic"));
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(!html.includes("fonts.googleapis.com"));
  assert.ok(!/<script>(?!\s*$)/.test(html), "no inline scripts");
});
