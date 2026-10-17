import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-demo-"));
Object.assign(process.env, {
  DATA_DIR: tmp,
  SESSION_SECRET: "test-secret",
  DEMO_MODE: "true",
  // Present on purpose: demo mode must ignore them.
  RAZORPAY_KEY_ID: "rzp_live_should_be_ignored",
  RAZORPAY_KEY_SECRET: "secret",
  WHATSAPP_TOKEN: "token",
  WHATSAPP_PHONE_NUMBER_ID: "123",
});

const { config } = await import("../server/config.js");
const { openDb } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { seedDemo, DEMO_PATIENT } = await import("../server/demo.js");
const { paymentsEnabled } = await import("../server/payments.js");
const { whatsappApiEnabled } = await import("../server/notify.js");

const db = openDb();
let server;
let base;
let cookie = "";
async function api(method, url, body, { auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) Object.assign(headers, { cookie, "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.includes("tb_session=")) cookie = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  seedDemo(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("demo uses its own database and never sends real payments or messages", () => {
  assert.ok(config.dbFile.endsWith("demo.db"));
  assert.equal(paymentsEnabled(), false);
  assert.equal(whatsappApiEnabled(), false);
});

test("one-click doctor sign-in shows a populated dashboard", async () => {
  const cfg = await api("GET", "/api/config");
  assert.deepEqual(cfg.body.demo.patient, { ref: DEMO_PATIENT.ref, phone: DEMO_PATIENT.phone });
  assert.equal((await api("POST", "/api/admin/demo-login")).status, 200);
  const me = await api("GET", "/api/admin/me", null, { auth: true });
  assert.equal(me.body.demo, true);
  const dash = await api("GET", "/api/admin/dashboard", null, { auth: true });
  assert.ok(dash.body.schedule.length >= 2, "today's visits");
  assert.ok(dash.body.alerts.length >= 1, "pain alert");
  assert.ok(dash.body.stats.followupsDue >= 1);
  assert.ok(dash.body.stats.storiesPending >= 1);
});

test("security actions are disabled in the demo", async () => {
  await api("POST", "/api/admin/demo-login");
  for (const [m, u] of [["POST", "/api/admin/password"], ["POST", "/api/admin/2fa/setup"], ["POST", "/api/admin/sessions/revoke"], ["POST", "/api/admin/backups"], ["GET", "/api/admin/backups"]]) {
    assert.equal((await api(m, u, m === "GET" ? null : {}, { auth: true })).status, 403, `${m} ${u}`);
  }
  assert.equal((await api("POST", "/api/admin/login", { email: "demo@tailbonetreatment.com", password: "anything" })).status, 401, "no password sign-in for the demo account");
});

test("one-click patient view finds the sample booking", async () => {
  const res = await api("POST", "/api/manage/lookup", DEMO_PATIENT);
  assert.equal(res.status, 200);
  assert.equal(res.body.appointment.name, "Asha Verma");
  assert.equal(res.body.appointment.canChange, true);
});

test("demo data resets cleanly", async () => {
  await api("POST", "/api/manage/cancel", DEMO_PATIENT);
  seedDemo(db);
  const res = await api("POST", "/api/manage/lookup", DEMO_PATIENT);
  assert.equal(res.body.appointment.status, "confirmed");
});
