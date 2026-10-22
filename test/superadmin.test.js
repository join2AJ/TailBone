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
  const booking = { name: "Lata Shah", phone: "9811100022", clinic: "del", ...slot(5), consent: true };
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
  db.prepare("INSERT INTO appointment_events (appointment_id, actor, action) SELECT id, 'clinic', 'confirmed' FROM appointments WHERE appt_no = ?").run(ok.body.appointment.ref);
  assert.equal((await api(null, "POST", "/api/manage/privacy", { ref: ok.body.appointment.ref, phone: booking.phone, type: "access" })).status, 201);

  await api("super", "PUT", "/api/admin/superadmin/features", { online_booking: true, patient_self_service: true, stories: true, instagram: true, followup_checkins: true });
  assert.equal((await api(null, "POST", "/api/manage/cancel", { ref: ok.body.appointment.ref, phone: booking.phone })).status, 200);
});

test("the admin can hide a blog article by its number, and the site stops showing it", async () => {
  const { body } = await api("super", "GET", "/api/admin/blog");
  assert.ok(body.posts.length >= 20);
  const post = body.posts.find((p) => p.slug === "history-of-coccydynia");
  assert.ok(Number.isInteger(post.id) && post.enabled);
  assert.equal((await fetch(`${base}/blog/${post.slug}.html`)).status, 200);

  assert.equal((await api("staff", "PATCH", `/api/admin/blog/${post.id}`, { enabled: false })).status, 403, "needs the blog permission");
  assert.equal((await api("super", "PATCH", "/api/admin/blog/99999", { enabled: false })).status, 404);
  assert.equal((await api("super", "PATCH", `/api/admin/blog/${post.id}`, { enabled: false })).status, 200);
  assert.deepEqual((await api(null, "GET", "/api/blog/hidden")).body.hidden, [{ id: post.id, slug: post.slug }]);
  for (const url of [`/blog/${post.slug}.html`, `/blog/${post.slug}`]) assert.equal((await fetch(base + url)).status, 404, url);
  const after = (await api("super", "GET", "/api/admin/blog")).body.posts.find((p) => p.id === post.id);
  assert.equal(after.enabled, false);
  assert.equal(after.changedBy, "owner@test.local");
  assert.ok(db.prepare("SELECT 1 FROM security_log WHERE action = 'blog_post_hidden'").get());

  assert.equal((await api("super", "PATCH", `/api/admin/blog/${post.id}`, { enabled: true })).status, 200);
  assert.deepEqual((await api(null, "GET", "/api/blog/hidden")).body.hidden, []);
  assert.equal((await fetch(`${base}/blog/${post.slug}.html`)).status, 200);
});

test("permission rules can't be dodged with capital letters or a trailing slash", async () => {
  // "staff" only has the appointments and patients sections.
  for (const [method, url] of [["GET", "/api/admin/SUPERADMIN"], ["GET", "/api/admin/Security/Log"], ["GET", "/api/admin/BACKUPS"],
    ["GET", "/api/admin/Export/appointments.csv"], ["GET", "/api/admin/PRIVACY/requests"], ["POST", "/api/admin/appointments/1/refund/"],
    ["PUT", "/api/admin/settings/policy/"], ["PATCH", "/api/admin/SUPERADMIN/users/1"]]) {
    const res = await api("staff", method, url, method === "GET" ? undefined : { role: "superadmin", amount: 1 });
    assert.ok([403, 404].includes(res.status), `${method} ${url} → ${res.status}`);
  }
});

test("a fee paid at the clinic can be recorded, and appears in the payments CSV", async () => {
  const booked = await api(null, "POST", "/api/appointments", { name: "Kiran Rao", phone: "9811100077", clinic: "del", ...slot(6, 3), consent: true });
  assert.equal(booked.status, 201);
  const appt = db.prepare("SELECT id, fee, payment_status, appt_no FROM appointments WHERE appt_no = ?").get(booked.body.appointment.ref);
  assert.equal(appt.payment_status, "pay_at_clinic");
  assert.equal((await api("super", "POST", `/api/admin/appointments/${appt.id}/received`, { method: "gold" })).status, 400);
  assert.equal((await api("super", "POST", `/api/admin/appointments/${appt.id}/received`, { method: "upi" })).status, 200);
  const after = db.prepare("SELECT payment_status, amount_paid, payment_id FROM appointments WHERE id = ?").get(appt.id);
  assert.deepEqual({ ...after }, { payment_status: "paid", amount_paid: appt.fee, payment_id: "clinic-upi" });
  assert.equal((await api("super", "POST", `/api/admin/appointments/${appt.id}/received`, { method: "cash" })).status, 409, "can't be recorded twice");
  const date = db.prepare("SELECT date FROM appointments WHERE id = ?").get(appt.id).date;
  const res = await fetch(`${base}/api/admin/payments/export.csv?from=${date}&to=${date}`, { headers: { cookie: jar.super, "x-requested-with": "fetch" } });
  const csv = await res.text();
  assert.equal(res.status, 200);
  assert.ok(csv.includes(appt.appt_no) && csv.includes("At the clinic: UPI"));
  const dash = (await api("super", "GET", "/api/admin/dashboard")).body.stats;
  assert.ok("collectedMonth" in dash && "toCollectToday" in dash);
});

test("the clinic can share documents with a patient, who downloads them from My appointments", async () => {
  const booked = await api(null, "POST", "/api/appointments", { name: "Pooja Jain", phone: "9811100088", clinic: "del", ...slot(7, 2), consent: true });
  const ref = booked.body.appointment.ref;
  const appt = db.prepare("SELECT id, patient_id FROM appointments WHERE appt_no = ?").get(ref);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const upload = (who, body, query, headers = {}) => fetch(`${base}/api/admin/patients/${appt.patient_id}/documents?${query}`, {
    method: "POST", body, headers: { "content-type": "application/pdf", cookie: jar[who], "x-requested-with": "fetch", ...headers },
  });
  assert.equal((await upload("super", Buffer.from("<script>alert(1)</script>"), "kind=plan")).status, 415, "only real PDF/JPG/PNG");
  assert.equal((await upload("super", pdf, "kind=nonsense")).status, 400);
  const shared = await (await upload("super", pdf, "kind=plan&title=Exercise%20plan&shared=1")).json();
  const privateDoc = await (await upload("super", pdf, "kind=summary&title=Internal%20note")).json();
  assert.ok(shared.document.id && shared.document.shared === 1);
  assert.equal(Buffer.from(db.prepare("SELECT data FROM documents WHERE id = ?").get(shared.document.id).data).subarray(0, 5).toString(), "TBBK1", "stored encrypted");

  const creds = { ref, phone: "9811100088" };
  // Until the clinic confirms the booking, nothing is shown.
  let look = await api(null, "POST", "/api/manage/lookup", creds);
  assert.deepEqual(look.body.documents.list, []);
  db.prepare("INSERT INTO appointment_events (appointment_id, actor, action) VALUES (?, 'clinic', 'confirmed')").run(appt.id);
  look = await api(null, "POST", "/api/manage/lookup", creds);
  assert.deepEqual(look.body.documents.list.map((d) => d.title), ["Exercise plan"], "only shared documents");
  assert.equal(look.body.documents.canUpload, false, "patient uploads are off by default");

  const dl = await fetch(`${base}/api/manage/documents/${shared.document.id}/download`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition"), /^attachment; filename="Exercise-plan\.pdf"$/);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(pdf), "decrypted file is identical");
  const hidden = await fetch(`${base}/api/manage/documents/${privateDoc.document.id}/download`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  assert.equal(hidden.status, 404, "unshared documents stay with the clinic");

  // Patient uploads only when the clinic switches them on.
  const patientUpload = () => fetch(`${base}/api/manage/documents?kind=report&title=Old%20X-ray%20report`, { method: "POST", body: pdf, headers: { "content-type": "application/pdf", "x-ref": ref, "x-phone": "9811100088" } });
  assert.equal((await patientUpload()).status, 403);
  await api("super", "PUT", "/api/admin/superadmin/features", { patient_uploads: true });
  const up = await patientUpload();
  assert.equal(up.status, 201);
  assert.equal((await up.json()).documents.list.length, 2);
  await api("super", "PUT", "/api/admin/superadmin/features", { patient_uploads: false });

  // Erasing the patient removes their documents.
  await api("super", "PATCH", `/api/admin/appointments/${appt.id}`, { status: "cancelled" });
  assert.equal((await api("super", "POST", `/api/admin/patients/${appt.patient_id}/erase`, { confirm: "Pooja Jain" })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM documents WHERE patient_id = ?").get(appt.patient_id).n, 0);
});

test("every paid booking gets a numbered receipt, for the patient and the clinic", async () => {
  const booked = await api(null, "POST", "/api/appointments", { name: "Sanjay Gupta", phone: "9811100099", clinic: "del", ...slot(8, 4), consent: true });
  const ref = booked.body.appointment.ref;
  const appt = db.prepare("SELECT id, fee FROM appointments WHERE appt_no = ?").get(ref);
  assert.equal((await api(null, "POST", "/api/manage/receipt", { ref, phone: "9811100099" })).status, 404, "nothing paid yet");
  await api("super", "POST", `/api/admin/appointments/${appt.id}/received`, { method: "cash" });
  const mine = await api(null, "POST", "/api/manage/receipt", { ref, phone: "9811100099" });
  assert.equal(mine.status, 200);
  const r = mine.body.receipt;
  assert.match(r.receiptNo, /^TBR-\d{4}-\d{4}$/);
  assert.equal(r.patient.name, "Sanjay Gupta");
  assert.equal(r.paid, appt.fee);
  assert.equal(r.method, "Cash at the clinic");
  assert.equal(r.paymentId, "", "internal clinic-cash marker isn't shown as a payment ID");
  const clinic = await api("super", "GET", `/api/admin/appointments/${appt.id}/receipt`);
  assert.equal(clinic.body.receipt.receiptNo, r.receiptNo, "the number never changes");
  assert.equal((await api(null, "POST", "/api/manage/receipt", { ref, phone: "9000000001" })).status, 404, "only with the right phone");
});

test("online consultations: Join call opens 15 minutes before, with the clinic's video room", async () => {
  const { videoForPatient } = await import("../server/video.js");
  assert.equal((await api("super", "PUT", "/api/admin/settings/video", { defaultUrl: "not a link" })).status, 400);
  assert.equal((await api("super", "PUT", "/api/admin/settings/video", { defaultUrl: "https://meet.google.com/abc-defg-hij" })).status, 200);
  const booked = await api(null, "POST", "/api/appointments", { name: "Farah Ali", phone: "9811100111", clinic: "online", ...slot(9, 1), consent: true });
  const ref = booked.body.appointment.ref;
  let a = db.prepare("SELECT * FROM appointments WHERE appt_no = ?").get(ref);
  const start = Date.parse(`${a.date}T${a.time}:00+05:30`);
  // Waiting for the clinic to confirm: no link.
  let look = await api(null, "POST", "/api/manage/lookup", { ref, phone: "9811100111" });
  assert.equal(look.body.appointment.video.state, "pending");
  assert.equal(look.body.appointment.video.url, "");
  await api("super", "PATCH", `/api/admin/appointments/${a.id}`, { status: "confirmed", silent: true });
  a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(a.id);
  look = await api(null, "POST", "/api/manage/lookup", { ref, phone: "9811100111" });
  assert.equal(look.body.appointment.video.state, "early");
  assert.equal(look.body.appointment.video.url, "", "the link isn't handed out early");
  assert.equal(videoForPatient(db, a, start - 20 * 60_000).state, "early");
  const open = videoForPatient(db, a, start - 10 * 60_000);
  assert.deepEqual([open.state, open.url], ["open", "https://meet.google.com/abc-defg-hij"]);
  assert.equal(videoForPatient(db, a, start + 61 * 60_000).state, "over");
  // A link for this appointment only, and the dashboard's Start call / send-on-WhatsApp links.
  assert.equal((await api("super", "PATCH", `/api/admin/appointments/${a.id}`, { videoUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await api("super", "PATCH", `/api/admin/appointments/${a.id}`, { videoUrl: "https://zoom.us/j/123456789" })).status, 200);
  const detail = (await api("super", "GET", `/api/admin/appointments/${a.id}`)).body.appointment;
  assert.equal(detail.links.video, "https://zoom.us/j/123456789");
  assert.match(decodeURIComponent(detail.links.sendVideo), /zoom\.us\/j\/123456789/);
  assert.equal(videoForPatient(db, db.prepare("SELECT * FROM appointments WHERE id = ?").get(a.id), start).url, "https://zoom.us/j/123456789");
  // In-clinic appointments have no video panel.
  assert.equal(videoForPatient(db, { ...a, clinic: "del" }), null);
});
