// Dashboard "Website" section (phase 1): videos, announcement bar, opening hours, contact details, FAQ, clippings, history.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-website-"));
process.env.DATA_DIR = tmp;
process.env.DB_FILE = path.join(tmp, "website.db");
process.env.SESSION_SECRET = "test-secret";
process.env.LOGIN_RATE_MAX = "100";

const { openDb } = await import("../server/db.js");
const { createApp, seedAdmin } = await import("../server/app.js");
const { clinicNow, addDays, slotsForDate, weekday } = await import("../server/time.js");
const { youtubeId } = await import("../server/site-content.js");
const { config } = await import("../server/config.js");

const db = openDb(process.env.DB_FILE);
let server;
let base;
const jar = {};

async function api(method, url, body, { as = "admin" } = {}) {
  const headers = { "content-type": "application/json", "x-requested-with": "fetch" };
  if (jar[as]) headers.cookie = jar[as];
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get("set-cookie");
  if (sc && /tb_session=/.test(sc)) jar[as] = sc.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() };
}
const site = async () => (await api("GET", "/api/site-content", undefined, { as: "nobody" })).body;
const put = (area, value, as) => api("PUT", `/api/admin/website/${area}`, { value }, { as });

before(async () => {
  seedAdmin(db, { email: "admin@test.local", password: "correct-horse-battery" });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api("POST", "/api/admin/login", { email: "admin@test.local", password: "correct-horse-battery" })).status, 200);
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("YouTube links of every usual shape are recognised; others are refused", () => {
  for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ?si=x", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"]) {
    assert.equal(youtubeId(url), "dQw4w9WgXcQ", url);
  }
  for (const bad of ["https://vimeo.com/123", "https://evil.example/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", ""]) assert.equal(youtubeId(bad), null, bad);
});

test("nothing is sent to the website until the clinic changes something; the dashboard starts from the built-in FAQ and clippings", async () => {
  const s = await site();
  assert.deepEqual([s.announcement, s.hours, s.contact, s.faq, s.press], [null, null, null, null, null]);
  assert.deepEqual(s.videos, { home: [], treatment: [], doctor: [] });
  const { body } = await api("GET", "/api/admin/website");
  assert.ok(body.faq.length >= 5 && body.faq.every((x) => x.q && x.a));
  assert.ok(body.faq.some((x) => /\[[^\]]+\]\(\/policies\.html\)/.test(x.a)), "links in answers are kept as [text](/address)");
  assert.ok(body.press.length >= 5 && body.press.every((p) => p.image && p.publication));
});

test("YouTube videos: add with pages, hide, and only visible ones reach the chosen pages", async () => {
  const bad = await put("youtube", [{ url: "https://vimeo.com/1", pages: ["home"] }]);
  assert.equal(bad.status, 400);
  assert.equal((await put("youtube", [{ url: "https://youtu.be/dQw4w9WgXcQ", pages: [] }])).status, 400, "needs a page");
  assert.equal((await put("youtube", [{ url: "https://youtu.be/dQw4w9WgXcQ", pages: ["home"] }, { url: "dQw4w9WgXcQ", pages: ["doctor"] }])).status, 409, "no duplicates");
  const ok = await put("youtube", [
    { url: "https://youtube.com/shorts/aaaaaaaaaaa", title: "<b>Sitting</b>", pages: ["home", "treatment", "nowhere"] },
    { url: "https://youtu.be/bbbbbbbbbbb", title: "Hidden one", pages: ["doctor"], visible: false },
  ]);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.value[0].pages, ["home", "treatment"], "unknown pages are dropped");
  const { videos } = await site();
  assert.deepEqual(videos.home, [{ type: "youtube", id: "aaaaaaaaaaa", title: "<b>Sitting</b>", short: true }]);
  assert.equal(videos.treatment.length, 1);
  assert.deepEqual(videos.doctor, [], "hidden videos stay off the website");
});

test("Instagram posts can be placed on Home and Doctor; the Treatment page's own section only lists its posts", async () => {
  assert.equal((await api("POST", "/api/admin/media", { url: "https://www.instagram.com/reel/ABC123xyz/" })).status, 201);
  const mid = db.prepare("SELECT id FROM media").get().id;
  assert.equal((await api("PATCH", `/api/admin/media/${mid}`, { pages: [] })).status, 400);
  await api("PATCH", `/api/admin/media/${mid}`, { pages: ["home", "doctor"] });
  const { videos } = await site();
  assert.equal(videos.home.at(-1).type, "instagram");
  assert.equal(videos.doctor[0].type, "instagram");
  assert.equal(videos.treatment.filter((v) => v.type === "instagram").length, 0);
  assert.equal((await api("GET", "/api/media", undefined, { as: "nobody" })).body.media.length, 0, "not on Treatment any more");
});

test("announcement bar: needs text, respects its dates, and only accepts safe links", async () => {
  const today = clinicNow().date;
  assert.equal((await put("announcement", { enabled: true, text: "" })).status, 400);
  assert.equal((await put("announcement", { enabled: true, text: "Hi", link: "javascript:alert(1)" })).status, 400);
  assert.equal((await put("announcement", { enabled: true, text: "Hi", start: today, end: addDays(today, -1) })).status, 400);
  await put("announcement", { enabled: true, text: "Closed on Friday", link: "/book", start: addDays(today, 1) });
  assert.equal((await site()).announcement, null, "not before its start date");
  await put("announcement", { enabled: true, text: "Closed on Friday", link: "/book", start: today, end: today, tone: "warning" });
  const a = (await site()).announcement;
  assert.equal(a.text, "Closed on Friday");
  assert.equal(a.linkText, "Find out more");
  assert.equal(a.tone, "warning");
  await put("announcement", { enabled: false, text: "Closed on Friday" });
  assert.equal((await site()).announcement, null, "switched off");
});

test("opening hours change the website and online booking at once; a closed day has no slots", async () => {
  let d = addDays(clinicNow().date, 3);
  const wd = weekday(d);
  const hours = { 0: ["08:00", "15:00"], 1: ["10:00", "17:00"], 2: ["10:00", "17:00"], 3: ["10:00", "17:00"], 4: ["10:00", "17:00"], 5: ["10:00", "17:00"], 6: ["10:00", "15:00"] };
  assert.equal((await put("hours", { ...hours, [wd]: ["17:00", "10:00"] })).status, 400);
  assert.equal((await put("hours", { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null })).status, 400);
  assert.equal((await put("hours", { ...hours, [wd]: ["11:00", "12:30"] })).status, 200);
  assert.deepEqual(slotsForDate(d), ["11:00", "11:30", "12:00"]);
  assert.deepEqual((await site()).hours[wd], ["11:00", "12:30"]);
  await put("hours", { ...hours, [wd]: null });
  assert.deepEqual(slotsForDate(d), [], "closed");
  await put("hours", hours);
  d = addDays(clinicNow().date, 10);
  assert.ok(slotsForDate(d).length > 0);
});

test("contact details are checked, and the WhatsApp number is used for messages at once", async () => {
  assert.equal((await put("contact", { phone: "123", whatsapp: "919811122233", email: "a@b.co" })).status, 400);
  assert.equal((await put("contact", { phone: "+91 98111 22233", whatsapp: "98111", email: "a@b.co" })).status, 400);
  assert.equal((await put("contact", { phone: "+91 98111 22233", whatsapp: "+91 98111 22233", email: "Front@Clinic.in" })).status, 200);
  assert.equal(config.whatsappNumber, "919811122233");
  assert.deepEqual((await site()).contact, { phone: "+91 98111 22233", whatsapp: "919811122233", email: "front@clinic.in" });
  assert.equal((await api("GET", "/api/config", undefined, { as: "nobody" })).body.whatsapp, "919811122233");
});

test("FAQ and clippings: hidden entries stay off the website; every question needs an answer", async () => {
  assert.equal((await put("faq", [{ q: "Question?", a: "" }])).status, 400);
  await put("faq", [{ q: "Is parking available?", a: "Yes, see [clinics](/locations)." }, { q: "Old question", a: "Old", visible: false }]);
  assert.deepEqual((await site()).faq, [{ q: "Is parking available?", a: "Yes, see [clinics](/locations)." }]);
  assert.equal((await put("press", [{ publication: "The Hindu" }])).status, 400, "needs a photo");
  assert.equal((await put("press", [{ publication: "The Hindu", image: "http://insecure.example/x.jpg" }])).status, 400);
  await put("press", [{ publication: "The Hindu", image: "/media/blog/abc", date: "2026-11-01" }, { publication: "Old paper", image: "/assets/img/x.jpg", visible: false }]);
  const press = (await site()).press;
  assert.equal(press.length, 1);
  assert.match(press[0].slug, /the-hindu/);
});

test("every change is kept in the history and can be restored, including back to the built-in content", async () => {
  await put("faq", [{ q: "Version two?", a: "Yes." }]);
  const { body } = await api("GET", "/api/admin/website");
  const faqHistory = body.history.filter((h) => h.key === "faq");
  assert.ok(faqHistory.length >= 2);
  assert.equal(faqHistory[0].changedBy, "admin@test.local");
  await api("POST", `/api/admin/website/history/${faqHistory[0].id}/restore`);
  assert.equal((await site()).faq[0].q, "Is parking available?");
  const first = faqHistory.at(-1); // before the very first save: the built-in FAQ
  assert.equal(first.wasDefault, true);
  await api("POST", `/api/admin/website/history/${first.id}/restore`);
  assert.equal((await site()).faq, null, "back to the website's own questions");
  assert.ok(db.prepare("SELECT COUNT(*) n FROM security_log WHERE action LIKE 'website_content_%'").get().n > 5, "changes are in the security log");
});

test("only staff given the Website section can change it; clipping uploads must be pictures", async () => {
  const { body } = await api("POST", "/api/admin/superadmin/users", { email: "desk@test.local", name: "Front desk", permissions: ["appointments"] });
  assert.equal((await api("POST", "/api/admin/login", { email: "desk@test.local", password: body.temporaryPassword }, { as: "desk" })).status, 200);
  assert.equal((await api("GET", "/api/admin/website", undefined, { as: "desk" })).status, 403);
  assert.equal((await put("announcement", { enabled: true, text: "Hacked" }, "desk")).status, 403);
  assert.equal((await api("PUT", "/api/admin/website/__proto__", { value: {} })).status, 404);
  const upload = (bytes, type) => fetch(`${base}/api/admin/website/upload?name=x`, { method: "POST", headers: { cookie: jar.admin, "content-type": type, "x-requested-with": "fetch" }, body: bytes });
  assert.equal((await upload(Buffer.from("not a picture at all"), "image/png")).status, 415);
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const ok = await upload(png, "image/png");
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).media.url, /^\/media\/blog\/[0-9a-f]{24}$/);
});

test("the public content is cacheable for a minute and has no private details", async () => {
  const res = await api("GET", "/api/site-content", undefined, { as: "nobody" });
  assert.match(res.headers.get("cache-control"), /public, max-age=60/);
  assert.ok(!JSON.stringify(res.body).includes("admin@test.local"));
});
