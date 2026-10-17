import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-cal-"));
Object.assign(process.env, {
  DATA_DIR: tmp, DB_FILE: path.join(tmp, "c.db"), SESSION_SECRET: "test-secret",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "sync@project.iam.gserviceaccount.com", GOOGLE_PRIVATE_KEY: "unused-in-tests", GOOGLE_CALENDAR_ID: "doctor@example.com",
});

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { setGcalClient, clearBusyCache } = await import("../server/gcal.js");

// Simulated Google Calendar
const events = new Map();
let busy = [];
let seq = 0;
setGcalClient(async (method, url, body) => {
  if (url === "/freeBusy") return { calendars: { "doctor@example.com": { busy } } };
  const m = url.match(/\/events(?:\/(.+))?$/);
  if (method === "POST") { const id = `ev${++seq}`; events.set(id, body); return { id }; }
  if (method === "PATCH") { events.set(decodeURIComponent(m[1]), body); return { id: m[1] }; }
  if (method === "DELETE") { events.delete(decodeURIComponent(m[1])); return null; }
  throw new Error("unexpected");
});

const db = openDb(process.env.DB_FILE);
let server, base, cookie = "";
const call = async (method, url, body, auth = false) => {
  const headers = { "content-type": "application/json" };
  if (auth) Object.assign(headers, { cookie, "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.includes("tb_session=")) cookie = sc.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
};
const settle = () => new Promise((r) => setTimeout(r, 60));
const slot = (o, i = 0) => { const date = addDays(clinicNow().date, o); return { date, time: slotsForDate(date)[i] }; };

before(async () => {
  seedAdmin(db, { email: "owner@test.local", password: "owner-password-1" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call("POST", "/api/admin/login", { email: "owner@test.local", password: "owner-password-1" });
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let booked;
test("booking gets a patient ID, appointment number, QR code and a calendar event", async () => {
  const res = await call("POST", "/api/appointments", { name: "Ritu Malhotra", phone: "9822000001", clinic: "del", ...slot(5, 2), consent: true });
  assert.equal(res.status, 201);
  booked = res.body.appointment;
  assert.match(booked.patientCode, /^TBP-\d{5}$/);
  assert.match(booked.apptNo, /^TBA-\d{4}-\d{4}$/);
  assert.ok(booked.qrSvg.startsWith("<svg"));
  assert.ok(booked.googleCalendarUrl.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE"));
  await settle();
  const [ev] = [...events.values()];
  assert.ok(ev.summary.includes(booked.apptNo) && ev.summary.includes("Ritu M."), ev.summary);
  assert.ok(!JSON.stringify(ev).includes("9822000001"), "no phone numbers in calendar events");

  // A second booking by the same patient keeps the patient ID and gets the next appointment number.
  const again = await call("POST", "/api/appointments", { name: "Ritu Malhotra", phone: "9822000001", clinic: "del", ...slot(6, 2), consent: true });
  assert.equal(again.body.appointment.patientCode, booked.patientCode);
  assert.equal(Number(again.body.appointment.apptNo.slice(-4)), Number(booked.apptNo.slice(-4)) + 1);
});

test("reschedule moves the event; cancelling removes it", async () => {
  const before = events.size;
  const creds = { ref: booked.ref, phone: "9822000001" };
  assert.equal((await call("POST", "/api/manage/reschedule", { ...creds, ...slot(7, 1) })).status, 200);
  await settle();
  assert.equal(events.size, before, "updated, not duplicated");
  assert.ok([...events.values()].some((e) => e.start.dateTime.startsWith(slot(7).date)));
  await call("POST", "/api/manage/cancel", creds);
  await settle();
  assert.equal(events.size, before - 1);
});

test("the doctor's own busy time blocks that slot on the website", async () => {
  const s = slot(9, 0);
  busy = [{ start: `${s.date}T${s.time}:00+05:30`, end: `${s.date}T${s.time.slice(0, 2)}:30:00+05:30` }];
  clearBusyCache();
  const slots = await call("GET", `/api/slots?clinic=blr&date=${s.date}`);
  assert.equal(slots.body.slots[0].available, false);
  assert.equal(slots.body.slots[1].available, true);
  const res = await call("POST", "/api/appointments", { name: "Busy Test", phone: "9822000002", clinic: "blr", ...s, consent: true });
  assert.equal(res.status, 409);
  busy = [];
});

test("subscription feed works only with the secret link", async () => {
  const { body } = await call("GET", "/api/admin/calendar", null, true);
  assert.equal(body.googleSync, true);
  const feed = await call("GET", new URL(body.feedUrl).pathname);
  assert.equal(feed.status, 200);
  assert.ok(feed.body.startsWith("BEGIN:VCALENDAR") && feed.body.includes("BEGIN:VEVENT"));
  assert.ok(!feed.body.includes("9822000001"));
  assert.equal((await call("GET", "/api/calendar/wrong-token.ics")).status, 404);
  await call("POST", "/api/admin/calendar/rotate", {}, true);
  assert.equal((await call("GET", new URL(body.feedUrl).pathname)).status, 404, "old link stops working after rotation");
});

test("admin search finds appointment numbers and patient IDs", async () => {
  const byNo = await call("GET", `/api/admin/appointments?q=${booked.apptNo}`, null, true);
  assert.equal(byNo.body.appointments.length, 1);
  const byPid = await call("GET", `/api/admin/patients?q=${booked.patientCode}`, null, true);
  assert.equal(byPid.body.patients.length, 1);
});
