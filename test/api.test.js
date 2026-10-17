import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-test-"));
process.env.DATA_DIR = tmp;
process.env.SESSION_SECRET = "test-secret";

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");

let server;
let base;
let cookie = "";
const db = openDb(path.join(tmp, "test.db"));

async function api(method, url, body, { auth = false } = {}) {
  const headers = { "content-type": "application/json" };
  // Public bookings need privacy consent; tests opt out explicitly with consent: false.
  if (method === "POST" && url === "/api/appointments" && body && typeof body === "object" && body.consent === undefined) body = { ...body, consent: true };
  if (auth) Object.assign(headers, { cookie, "x-requested-with": "fetch" });
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
}

/** A future date that is open (not Sunday-only quirks) and its first slot. */
function futureSlot(offset = 3) {
  const date = addDays(clinicNow().date, offset);
  return { date, time: slotsForDate(date)[0] };
}

before(async () => {
  seedAdmin(db, { email: "admin@test.local", password: "correct-horse-battery" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("lists slots and days for a clinic", async () => {
  const { date } = futureSlot();
  const slots = await api("GET", `/api/slots?clinic=del&date=${date}`);
  assert.equal(slots.status, 200);
  assert.ok(slots.body.slots.length > 0);
  assert.ok(slots.body.slots.every((s) => s.available));
  const days = await api("GET", "/api/days?clinic=del");
  assert.equal(days.body.days.length, 21);
  const bad = await api("GET", `/api/slots?clinic=nowhere&date=${date}`);
  assert.equal(bad.status, 400);
});

test("books, prevents double booking, and lets the patient manage it", async () => {
  const slot = futureSlot(4);
  const booking = { name: "Asha Rao", phone: "98450 12345", clinic: "del", ...slot, reason: "Pain when sitting" };
  const created = await api("POST", "/api/appointments", booking);
  assert.equal(created.status, 201);
  const { ref } = created.body.appointment;
  assert.match(ref, /^TBA-\d{4}-\d{4}$/);
  assert.ok(created.body.whatsappUrl.startsWith("https://wa.me/"));

  const dup = await api("POST", "/api/appointments", { ...booking, name: "Someone Else", phone: "9000000000" });
  assert.equal(dup.status, 409);

  const taken = await api("GET", `/api/slots?clinic=del&date=${slot.date}`);
  assert.equal(taken.body.slots.find((s) => s.time === slot.time).available, false);

  const wrongPhone = await api("POST", "/api/manage/lookup", { ref, phone: "9999999999" });
  assert.equal(wrongPhone.status, 404);
  const lookup = await api("POST", "/api/manage/lookup", { ref: ref.toLowerCase(), phone: "+91 98450-12345" });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.appointment.canChange, true);

  const next = futureSlot(5);
  const moved = await api("POST", "/api/manage/reschedule", { ref, phone: "9845012345", date: next.date, time: next.time });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.appointment.date, next.date);

  const cancelled = await api("POST", "/api/manage/cancel", { ref, phone: "9845012345" });
  assert.equal(cancelled.body.appointment.status, "cancelled");
  const free = await api("GET", `/api/slots?clinic=del&date=${next.date}`);
  assert.equal(free.body.slots.find((s) => s.time === next.time).available, true);
});

test("rejects invalid bookings", async () => {
  const slot = futureSlot();
  assert.equal((await api("POST", "/api/appointments", { name: "A", phone: "98450", clinic: "del", ...slot })).status, 400);
  assert.equal((await api("POST", "/api/appointments", { name: "Valid Name", phone: "9845011111", clinic: "del", date: slot.date, time: "03:00" })).status, 409);
  const past = addDays(clinicNow().date, -1);
  assert.equal((await api("POST", "/api/appointments", { name: "Valid Name", phone: "9845011111", clinic: "del", date: past, time: slotsForDate(past)[0] })).status, 409);
  assert.equal((await api("POST", "/api/appointments", { name: "Bot", phone: "9845011111", clinic: "del", ...slot, website: "spam" })).status, 400);
});

test("admin API requires sign-in and the fetch header", async () => {
  assert.equal((await api("GET", "/api/admin/dashboard")).status, 401);
  assert.equal((await api("POST", "/api/admin/login", { email: "admin@test.local", password: "wrong-password" })).status, 401);
  const ok = await api("POST", "/api/admin/login", { email: "admin@test.local", password: "correct-horse-battery" });
  assert.equal(ok.status, 200);
  const noHeader = await fetch(`${base}/api/admin/followups`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  assert.equal(noHeader.status, 403);
  const dash = await api("GET", "/api/admin/dashboard", null, { auth: true });
  assert.equal(dash.status, 200);
  assert.ok("stats" in dash.body);
});

test("completing a visit schedules a follow-up that the patient can answer", async () => {
  const slot = futureSlot(6);
  const created = await api("POST", "/api/admin/appointments", { name: "Ravi Kumar", phone: "9811122233", clinic: "del", ...slot }, { auth: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.appointment.status, "confirmed");
  assert.ok(created.body.appointment.links.confirm.includes("wa.me/919811122233"));

  const done = await api("PATCH", `/api/admin/appointments/${created.body.appointment.id}`, {
    status: "completed", notes: "IM session 1", followup: { type: "checkin" },
  }, { auth: true });
  assert.equal(done.status, 200);
  const token = new URL(done.body.followup.checkinUrl).searchParams.get("t");
  assert.ok(token);

  const info = await api("GET", `/api/checkin/${token}`);
  assert.equal(info.body.firstName, "Ravi");
  assert.equal((await api("POST", `/api/checkin/${token}`, { painScore: 11, trend: "better" })).status, 400);
  const answered = await api("POST", `/api/checkin/${token}`, { painScore: 3, trend: "better", sittingMinutes: 45 });
  assert.equal(answered.status, 201);
  assert.equal((await api("POST", `/api/checkin/${token}`, { painScore: 3, trend: "better" })).status, 409);

  const patient = await api("GET", `/api/admin/patients/${created.body.appointment.patient_id}`, null, { auth: true });
  assert.equal(patient.body.checkins.length, 1);
  assert.equal(patient.body.followups[0].status, "done");
});

test("blocked dates close booking for that clinic", async () => {
  const slot = futureSlot(8);
  const block = await api("POST", "/api/admin/blocked", { clinic: "del", date: slot.date, reason: "Holiday" }, { auth: true });
  assert.equal(block.status, 201);
  const slots = await api("GET", `/api/slots?clinic=del&date=${slot.date}`);
  assert.equal(slots.body.closed, true);
  const attempt = await api("POST", "/api/appointments", { name: "Neha Singh", phone: "9811100000", clinic: "del", ...slot });
  assert.equal(attempt.status, 409);
  const otherClinic = await api("GET", `/api/slots?clinic=online&date=${slot.date}`);
  assert.equal(otherClinic.body.closed, false);
});

test("CSV export neutralises formula injection", async () => {
  const slot = futureSlot(9);
  await api("POST", "/api/appointments", { name: "=HYPERLINK(1)", phone: "9811155555", clinic: "online", ...slot });
  const csv = await api("GET", "/api/admin/export/appointments.csv", null, { auth: true });
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes(`"'=HYPERLINK(1)"`));
});

test("patient stories: submit, moderate, publish", async () => {
  const { seedStories } = await import("../server/services.js");
  seedStories(db);
  const before = await api("GET", "/api/stories?limit=60");
  const seeded = before.body.total;
  assert.ok(seeded >= 9);

  assert.equal((await api("POST", "/api/stories", { name: "Meera Iyer", rating: 5, body: "Too short", consent: true })).status, 400);
  assert.equal((await api("POST", "/api/stories", { name: "Meera Iyer", rating: 5, body: "x".repeat(40) })).status, 400);
  const booked = await api("POST", "/api/appointments", { name: "Meera Iyer", phone: "9811155555", clinic: "online", date: futureSlot(13).date, time: slotsForDate(futureSlot(13).date)[3], consent: true });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const visit = booked.body.appointment;
  const story0 = { name: "Meera Iyer", city: "Pune", rating: 5, title: "Back at my desk", body: "After two years of pain I can sit through a full workday again. Thank you!", consent: true };
  assert.equal((await api("POST", "/api/stories", story0)).status, 400, "patient ID and appointment number are required");
  assert.equal((await api("POST", "/api/stories", { ...story0, patientCode: visit.patientCode, apptNo: "TBA-0000-9999" })).status, 400, "they must belong together");
  const ok = await api("POST", "/api/stories", { ...story0, patientCode: visit.patientCode.toLowerCase(), apptNo: visit.apptNo });
  assert.equal(ok.status, 201);
  assert.ok(db.prepare("SELECT 1 FROM stories WHERE name = 'Meera Iyer' AND appointment_id IS NOT NULL").get(), "story is linked to the visit");
  assert.equal((await api("GET", "/api/stories?limit=60")).body.total, seeded, "pending stories stay hidden");

  const pending = await api("GET", "/api/admin/stories?status=pending", null, { auth: true });
  const story = pending.body.stories.find((s) => s.name === "Meera Iyer");
  assert.ok(story);
  await api("PATCH", `/api/admin/stories/${story.id}`, { status: "approved", featured: true }, { auth: true });
  const after = await api("GET", "/api/stories?limit=1");
  assert.equal(after.body.total, seeded + 1);
  assert.equal(after.body.stories[0].name, "Meera I.", "featured first, surname shortened");
});

test("instagram highlights accept only instagram post/reel links", async () => {
  assert.equal((await api("POST", "/api/admin/media", { url: "https://evil.example.com/reel/abc123/" }, { auth: true })).status, 400);
  assert.equal((await api("POST", "/api/admin/media", { url: "javascript:alert(1)" }, { auth: true })).status, 400);
  const added = await api("POST", "/api/admin/media", { url: "https://instagram.com/reel/Cx12345abc/?igsh=xyz", caption: "What is IM?" }, { auth: true });
  assert.equal(added.status, 201);
  assert.equal((await api("POST", "/api/admin/media", { url: "https://www.instagram.com/reel/Cx12345abc/" }, { auth: true })).status, 409);
  const pub = await api("GET", "/api/media");
  assert.equal(pub.body.media[0].url, "https://www.instagram.com/reel/Cx12345abc/");
  assert.equal(pub.body.media[0].kind, "reel");
});

test("demo sign-in does not exist outside demo mode", async () => {
  assert.equal((await api("POST", "/api/admin/demo-login")).status, 404);
  assert.equal((await api("GET", "/api/config")).body.demo, null);
});

test("clinic status and fee changes are recorded with time and author; closed clinics can't be booked", async () => {
  const cfg = await api("GET", "/api/config");
  const status = Object.fromEntries(cfg.body.clinics.map((c) => [c.id, c.status]));
  assert.deepEqual(status, { blr: "closed", del: "open", online: "open", lko: "soon" });
  assert.ok(cfg.body.policyUpdatedAt);
  assert.equal((await api("GET", "/api/days?clinic=blr")).body.days.length, 0);
  const slot = futureSlot(15);
  assert.equal((await api("POST", "/api/appointments", { name: "Test Patient", phone: "9811177777", clinic: "blr", ...slot, consent: true })).status, 409);

  const saved = await api("PUT", "/api/admin/settings/policy", { fees: { del: 900 }, followup: { fee: 500, windowDays: 7 }, clinics: { lko: "open" } }, { auth: true });
  assert.equal(saved.status, 200);
  const latest = saved.body.history[0];
  assert.ok(latest.changes.includes("Fee New Delhi: ₹800 → ₹900"));
  assert.ok(latest.changes.includes("Lucknow clinic: opening soon → open"));
  assert.ok(latest.by && !Number.isNaN(Date.parse(latest.changedAt)));
  assert.ok(saved.body.history.at(-1).changes.includes("Initial fees and rules"), "the original rules are kept too");
  assert.equal((await api("PUT", "/api/admin/settings/policy", { clinics: { del: "closed", online: "closed", lko: "closed" } }, { auth: true })).status, 400, "something must stay open");
  await api("PUT", "/api/admin/settings/policy", { fees: { del: 800 }, clinics: { lko: "soon" } }, { auth: true });
});
