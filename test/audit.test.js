// Regression tests for issues found in the pre-launch audit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-audit-"));
Object.assign(process.env, {
  DATA_DIR: tmp, DB_FILE: path.join(tmp, "a.db"), SESSION_SECRET: "test-secret",
  WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", // automatic WhatsApp "on" (sender is stubbed below)
});

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { setSenders } = await import("../server/notify.js");
const { seedStories } = await import("../server/services.js");

const sent = [];
setSenders({ whatsapp: async (to, text) => { sent.push({ to, text }); }, email: async () => {} });

const db = openDb(process.env.DB_FILE);
let server;
let base;
before(async () => {
  seedAdmin(db, { email: "owner@test.local", password: "owner-password-1" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (url, body) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const slot = (o, i = 0) => { const date = addDays(clinicNow().date, o); return { date, time: slotsForDate(date)[i] }; };
const settle = () => new Promise((r) => setTimeout(r, 50));

test("automatic WhatsApp only reaches patients who agreed to it", async () => {
  await post("/api/appointments", { name: "Yes Please", phone: "9811000001", clinic: "blr", ...slot(4, 0), consent: true, whatsappConsent: true });
  await post("/api/appointments", { name: "No Thanks", phone: "9811000002", clinic: "blr", ...slot(4, 1), consent: true, whatsappConsent: false });
  await settle();
  assert.deepEqual(sent.map((m) => m.to), ["919811000001"]);
  const queued = db.prepare("SELECT status, error FROM notifications WHERE audience = 'patient' AND recipient = '919811000002'").get();
  assert.equal(queued.status, "manual");
  assert.match(queued.error, /hasn't agreed/);
});

test("deleted stories don't come back after a restart", () => {
  seedStories(db);
  const n = db.prepare("SELECT COUNT(*) n FROM stories").get().n;
  assert.ok(n > 0);
  db.exec("DELETE FROM stories");
  seedStories(db); // what server start-up runs
  assert.equal(db.prepare("SELECT COUNT(*) n FROM stories").get().n, 0);
});

test("pages are revalidated on each visit so updates show at once", async () => {
  for (const p of ["/", "/book", "/privacy.html"]) {
    const res = await fetch(base + p);
    assert.equal(res.headers.get("cache-control"), "no-cache", p);
  }
});

test("unknown and known emails take similar time to reject", async () => {
  const time = async (email) => { const t = performance.now(); await post("/api/admin/login", { email, password: "wrong-password-123" }); return performance.now() - t; };
  await time("owner@test.local"); // warm up
  const known = await time("owner@test.local");
  const unknown = await time("nobody@test.local");
  assert.ok(unknown > known * 0.4, `unknown ${unknown.toFixed(1)}ms vs known ${known.toFixed(1)}ms`);
});
