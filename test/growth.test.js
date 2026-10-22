// Referral partners and rewards, patient profiles, "Doctor at your place", dashboard articles and their media.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-growth-"));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, "growth.db");
process.env.SESSION_SECRET = "test-secret";
process.env.LOGIN_RATE_MAX = "100";

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate } = await import("../server/time.js");
const { cleanProfile } = await import("../server/profile.js");
const { sniffMedia } = await import("../server/articles.js");
const { normalizeCode } = await import("../server/referrals.js");

const db = openDb(process.env.DB_FILE);
let server;
let base;
const jar = { admin: "", partner: "" };

async function api(method, url, body, { as } = {}) {
  const headers = { "content-type": "application/json", "x-requested-with": "fetch" };
  if (as) headers.cookie = jar[as];
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc && /tb_session=/.test(sc)) jar.admin = sc.split(";")[0];
  if (sc && /tb_partner=/.test(sc)) jar.partner = sc.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
}
let slotNo = 0;
const nextSlot = () => { const date = addDays(clinicNow().date, 5 + Math.floor(slotNo / 6)); return { date, time: slotsForDate(date)[slotNo++ % 6] }; };
const book = (name, phone, extra = {}) => api("POST", "/api/appointments", { name, phone, clinic: "del", ...nextSlot(), consent: true, ...extra });
const apptId = (no) => db.prepare("SELECT id FROM appointments WHERE appt_no = ?").get(no).id;
const setStatus = (no, status) => api("PATCH", `/api/admin/appointments/${apptId(no)}`, { status, silent: true }, { as: "admin" });
const rewards = (partnerId) => db.prepare("SELECT kind, amount, status FROM referral_rewards WHERE partner_id = ? ORDER BY id").all(partnerId).map((r) => ({ ...r }));

before(async () => {
  seedAdmin(db, { email: "admin@test.local", password: "correct-horse-battery" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api("POST", "/api/admin/login", { email: "admin@test.local", password: "correct-horse-battery" })).status, 200);
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("a referred new patient earns the partner ₹50 when confirmed and ₹1,000 per completed visit; cancelling withdraws it", async () => {
  const { body: { partner } } = await api("POST", "/api/admin/referrals/partners", { kind: "hospital", name: "City Ortho", phone: "9811100001" }, { as: "admin" });
  assert.match(partner.code, /^REF-[A-Z2-9]{5}$/);
  assert.equal(normalizeCode(` ref ${partner.code.slice(4).toLowerCase()} `), partner.code);

  const first = await book("Ravi Kumar", "9822200001", { referralCode: partner.code.toLowerCase() });
  assert.equal(first.status, 201);
  assert.deepEqual(rewards(partner.id), [], "nothing is earned for an unconfirmed booking");
  await setStatus(first.body.appointment.apptNo, "confirmed");
  assert.deepEqual(rewards(partner.id), [{ kind: "first_booking", amount: 5000, status: "earned" }]);
  await setStatus(first.body.appointment.apptNo, "completed");
  assert.deepEqual(rewards(partner.id).map((r) => `${r.kind}:${r.amount}`), ["first_booking:5000", "treatment:100000"]);

  // A second visit by the same patient earns another treatment reward, even without the code; cancelling it withdraws it.
  const second = await book("Ravi Kumar", "9822200001");
  await setStatus(second.body.appointment.apptNo, "confirmed");
  await setStatus(second.body.appointment.apptNo, "completed");
  assert.equal(rewards(partner.id).filter((r) => r.status === "earned").length, 3);
  const third = await book("Ravi Kumar", "9822200001");
  await setStatus(third.body.appointment.apptNo, "confirmed");
  await setStatus(third.body.appointment.apptNo, "cancelled");
  assert.equal(rewards(partner.id).filter((r) => r.status === "earned").length, 3, "a cancelled visit earns nothing");

  // Paying the partner marks everything paid; there is then nothing more to pay.
  const pay = await api("POST", `/api/admin/referrals/partners/${partner.id}/payout`, { method: "UPI", reference: "UTR1" }, { as: "admin" });
  assert.equal(pay.body.payout.amount, 205000);
  assert.ok(rewards(partner.id).every((r) => r.status === "paid"));
  assert.equal((await api("POST", `/api/admin/referrals/partners/${partner.id}/payout`, {}, { as: "admin" })).status, 409);
});

test("referral codes only count for new patients, never for yourself, and not when the programme is off", async () => {
  const { body: { partner } } = await api("POST", "/api/admin/referrals/partners", { kind: "individual", name: "Meena", phone: "9811100002" }, { as: "admin" });
  // Already treated before: the code is ignored.
  const old = await book("Old Patient", "9822200002");
  await setStatus(old.body.appointment.apptNo, "confirmed");
  const again = await book("Old Patient", "9822200002", { referralCode: partner.code });
  await setStatus(again.body.appointment.apptNo, "confirmed");
  assert.deepEqual(rewards(partner.id), []);
  assert.equal(db.prepare("SELECT referred_by FROM patients WHERE phone = '919822200002'").get().referred_by, null);
  // The partner booking for themselves.
  const self = await book("Meena", "9811100002", { referralCode: partner.code });
  await setStatus(self.body.appointment.apptNo, "confirmed");
  assert.deepEqual(rewards(partner.id), []);
  // Unknown codes are reported to the booking form.
  assert.equal((await api("GET", "/api/referral/REF-ZZZZZ")).status, 404);
  assert.equal((await api("GET", `/api/referral/${partner.code}`)).body.name, "Meena");
  // Programme switched off in the Control panel.
  db.prepare("INSERT INTO settings (key, value) VALUES ('features', '{\"referrals\":false}') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const off = await book("New Person", "9822200003", { referralCode: partner.code });
  assert.equal(db.prepare("SELECT referral_partner_id FROM appointments WHERE appt_no = ?").get(off.body.appointment.apptNo).referral_partner_id, null);
  assert.equal((await api("GET", "/api/partners/info")).status, 404);
  db.prepare("DELETE FROM settings WHERE key = 'features'").run();
});

test("partners sign up (waiting for approval), log in with their mobile, and see initials only", async () => {
  const signup = await api("POST", "/api/partners/signup", { kind: "ngo", name: "Saathi Trust", phone: "9811100003", password: "partner-pass", agree: true });
  assert.equal(signup.status, 201);
  let me = await api("GET", "/api/partners/me", null, { as: "partner" });
  assert.equal(me.body.partner.status, "pending");
  assert.equal(me.body.partner.code, null, "no referral ID before approval");
  const p = db.prepare("SELECT id, code FROM partners WHERE phone = '919811100003'").get();
  await api("PATCH", `/api/admin/referrals/partners/${p.id}`, { status: "active" }, { as: "admin" });
  const b = await book("Sunita Devi Rao", "9822200004", { referralCode: p.code });
  await setStatus(b.body.appointment.apptNo, "confirmed");
  jar.partner = "";
  assert.equal((await api("POST", "/api/partners/login", { phone: "9811100003", password: "wrong-password" })).status, 401);
  assert.equal((await api("POST", "/api/partners/login", { phone: "+91 98111 00003", password: "partner-pass" })).status, 200);
  me = await api("GET", "/api/partners/me", null, { as: "partner" });
  assert.equal(me.body.partner.code, p.code);
  assert.deepEqual(me.body.referrals.map((r) => r.initials), ["S. D. R."]);
  assert.ok(!JSON.stringify(me.body).includes("Sunita") && !JSON.stringify(me.body).includes("9822200004"), "no names or phone numbers");
  // The partner cookie is not a clinic sign-in.
  assert.equal((await api("GET", "/api/admin/referrals", null, { as: "partner" })).status, 401);
  // Cross-site posts are refused.
  const res = await fetch(`${base}/api/partners/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 403);
});

test("profile details: website bookings fill blanks only; the clinic can correct them; insights count totals", async () => {
  assert.deepEqual(cleanProfile({ gender: "female", age: "34", city: "  new   delhi ", heard_from: "made-up", occupation_group: "office" }).city, "New Delhi");
  assert.throws(() => cleanProfile({ age: "300" }));
  assert.equal(cleanProfile({ heard_from: "made-up" }).heard_from, undefined);
  await book("Asha Profile", "9822200005", { profile: { gender: "female", age: "34", city: "gurugram" }, attribution: { source: "google", medium: "cpc", campaign: "delhi", gclid: 1, landing: "/coccydynia" } });
  // Someone else booking with the same phone can't change it.
  await book("Asha Profile", "9822200005", { profile: { gender: "male", city: "Mumbai" } });
  const p = db.prepare("SELECT id, gender, city, birth_year FROM patients WHERE phone = '919822200005'").get();
  assert.deepEqual([p.gender, p.city], ["female", "Gurugram"]);
  await api("PATCH", `/api/admin/patients/${p.id}`, { profile: { city: "Noida", gender: "" } }, { as: "admin" });
  const q = db.prepare("SELECT gender, city, birth_year FROM patients WHERE id = ?").get(p.id);
  assert.deepEqual([q.gender, q.city, q.birth_year], [null, "Noida", p.birth_year]);
  const ins = await api("GET", "/api/admin/insights", null, { as: "admin" });
  assert.ok(ins.body.channels.some((c) => c.label === "Google Ads" && c.bookings >= 1));
  assert.ok(ins.body.campaigns.some((c) => c.campaign === "delhi"));
  assert.ok(!JSON.stringify(ins.body).includes("Asha"), "insights carry no names");
});

test("Doctor at your place: requests must start at least 7 days ahead and agree to cover the costs", async () => {
  const req = { name: "Anil Gupta", phone: "9822200006", city: "Jaipur", patients: 2, agree: true, consent: true };
  const soon = await api("POST", "/api/home-visits", { ...req, dateFrom: addDays(clinicNow().date, 3), dateTo: addDays(clinicNow().date, 4) });
  assert.equal(soon.status, 400);
  assert.match(soon.body.error, /7 days/);
  assert.equal((await api("POST", "/api/home-visits", { ...req, agree: false, dateFrom: addDays(clinicNow().date, 8), dateTo: addDays(clinicNow().date, 9) })).status, 400);
  const ok = await api("POST", "/api/home-visits", { ...req, dateFrom: addDays(clinicNow().date, 8), dateTo: addDays(clinicNow().date, 9) });
  assert.equal(ok.status, 201);
  const list = await api("GET", "/api/admin/home-visits", null, { as: "admin" });
  assert.equal(list.body.requests[0].ref, ok.body.ref);
  const upd = await api("PATCH", `/api/admin/home-visits/${list.body.requests[0].id}`, { status: "scheduled", notes: "Flights booked" }, { as: "admin" });
  assert.equal(upd.body.request.status, "scheduled");
});

test("dashboard articles are numbered from 1001, are public only once published, and embed only known video sites", async () => {
  const body = `Intro paragraph about sitting.\n\n## Watch\n\n::video https://www.youtube.com/watch?v=dQw4w9WgXcQ "A short demo"\n\n::video https://evil.example.com/x.mp4\n\n${"More text. ".repeat(40)}`;
  const created = await api("POST", "/api/admin/articles", { title: "Sitting tips from the clinic", summary: "Three habits.", tags: ["Sitting", "Bogus"], body }, { as: "admin" });
  assert.equal(created.status, 201);
  const a = created.body.article;
  assert.ok(a.id >= 1001);
  assert.deepEqual(a.tags, ["Sitting"], "only known topics");
  assert.equal((await api("GET", `/blog/a/${a.slug}`)).status, 404, "drafts are not public");
  await api("POST", `/api/admin/articles/${a.id}/publish`, { publish: true }, { as: "admin" });
  const page = await api("GET", `/blog/a/${a.slug}`);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"));
  assert.ok(!page.body.includes("<iframe src=\"https://evil.example.com"), "unknown sites become plain links");
  assert.match(page.body, /styles\.css\?v=\w+/, "fresh styles");
  assert.ok((await api("GET", "/api/blog/articles")).body.articles.some((x) => x.id === a.id));
  // Switched off with the same Shown switch as file articles.
  await api("PATCH", `/api/admin/blog/${a.id}`, { enabled: false }, { as: "admin" });
  assert.equal((await api("GET", `/blog/a/${a.slug}`)).status, 404);
});

test("article media: only real pictures, audio and video are accepted, and served with range support", async () => {
  assert.equal(sniffMedia(Buffer.from("<script>alert(1)</script>xxxx")), null);
  assert.equal(sniffMedia(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), "image/png");
  assert.equal(sniffMedia(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)])), "audio/mpeg");
  const fake = await fetch(`${base}/api/admin/articles/media?name=x.mp3`, { method: "POST", headers: { cookie: jar.admin, "x-requested-with": "fetch", "content-type": "audio/mpeg" }, body: "<html>not audio</html>" });
  assert.equal(fake.status, 415);
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1000, 1)]);
  const up = await fetch(`${base}/api/admin/articles/media?name=talk.mp3`, { method: "POST", headers: { cookie: jar.admin, "x-requested-with": "fetch", "content-type": "audio/mpeg" }, body: mp3 });
  const { media } = await up.json();
  const part = await fetch(`${base}${media.url}`, { headers: { range: "bytes=0-9" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-type"), "audio/mpeg");
  assert.equal((await part.arrayBuffer()).byteLength, 10);
});

test("a patient gets their own referral ID in My appointments once their booking is verified", async () => {
  const b = await book("Kiran Patel", "9822200007");
  const creds = { ref: b.body.appointment.ref, phone: "9822200007" };
  assert.equal((await api("POST", "/api/manage/referral", creds)).status, 403, "not before the clinic confirms");
  await setStatus(b.body.appointment.apptNo, "confirmed");
  const r = await api("POST", "/api/manage/referral", { ...creds, payoutDetails: "kiran@upi" });
  assert.equal(r.status, 200);
  assert.match(r.body.home.referral.code, /^REF-/);
  assert.equal(r.body.home.referral.payTo, "kiran@upi");
  const look = await api("POST", "/api/manage/lookup", creds);
  assert.equal(look.body.home.firstName, "Kiran");
  assert.equal(look.body.home.referral.code, r.body.home.referral.code);
});
