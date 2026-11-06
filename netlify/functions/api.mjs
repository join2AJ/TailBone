// Phase 1 on Netlify + Supabase (free): the website's live content and the clinic dashboard (/dashboard).
//
// Public:   GET /api/site-content · GET /api/media · GET /api/launch
// Dashboard (signed in, two-step sign-in required for anything that changes data):
//   POST /api/studio/login · /mfa/enroll · /mfa/verify · /logout · GET /me · GET /login-state
//   GET /website · PUT /website/:area · POST /website/history/:id/restore · POST /upload
//   GET|PUT /launch · POST /launch/publish   (super admin)
//   GET|POST /staff · PATCH|DELETE /staff/:email   (super admin)
//
// Sign-in uses Supabase Auth; the tokens live in HttpOnly cookies, never in page scripts. Every read and write goes to
// Supabase with the signed-in person's own token, so Supabase's row-level security decides what they may do (staff
// only, two-step sign-in, launch and staff for the super admin). The checks here are for clear messages.
import { CLEAN, AREA_LABELS, ContentError, publicView } from "../../shared/content-rules.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://haamtawpukjtmfcyafkr.supabase.co").replace(/\/$/, "");
// The publishable key is meant to be public (it only allows what the security rules allow).
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_bybPX6PmvjA8Gyfw9SEgnw_mRxRVjVJ";
const AREAS = ["announcement", "hours", "contact", "faq", "press", "videos"];
const LAUNCH_FEATURES = ["booking", "accounts", "referrals", "home_visits", "story_form", "stories"];
const COOKIE_PATH = "/api/studio";

export const config = { path: "/api/*" };

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status, error) => json({ error }, status);

// ---- Supabase calls ----
async function sb(path, { method = "GET", token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token || SUPABASE_KEY}`, ...(body && !raw ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const sbError = (r, fallback) => {
  const msg = r.data?.msg || r.data?.message || r.data?.error_description || r.data?.error || fallback;
  if (r.status === 401 || r.status === 403 || /row-level security|permission denied/i.test(String(msg))) return new ContentError(403, "You don't have permission for this. Sign in again with your two-step code, or ask the super admin.");
  return new ContentError(r.status >= 500 ? 502 : 400, String(msg).slice(0, 200));
};

// ---- Session cookies ----
const cookieOf = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.slice(1).join("=") || "";
const setCookies = (session) => [
  `tb_at=${session.access_token}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(60, session.expires_in || 3600)}`,
  `tb_rt=${session.refresh_token}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 7}`,
];
const clearCookies = () => [`tb_at=; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, `tb_rt=; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`];
const claims = (token) => { try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return {}; } };
const withCookies = (res, cookies) => { for (const c of cookies) res.headers.append("set-cookie", c); return res; };

/** The signed-in session: refreshed when the access token has expired. */
async function session(req) {
  let token = cookieOf(req, "tb_at");
  const refresh = cookieOf(req, "tb_rt");
  let cookies = [];
  if ((!token || (claims(token).exp || 0) * 1000 < Date.now() + 30_000) && refresh) {
    const r = await sb("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refresh } });
    if (r.ok) { token = r.data.access_token; cookies = setCookies(r.data); } else token = "";
  }
  if (!token) throw new ContentError(401, "Please sign in.");
  const c = claims(token);
  return { token, cookies, email: String(c.email || "").toLowerCase(), aal: c.aal || "aal1" };
}
const needAal2 = (s) => { if (s.aal !== "aal2") throw new ContentError(401, "Enter the code from your authenticator app to continue."); };

async function staffRow(s) {
  const r = await sb(`/rest/v1/staff?select=email,name,role,disabled&email=eq.${encodeURIComponent(s.email)}`, { token: s.token });
  return r.ok && Array.isArray(r.data) ? r.data[0] : null;
}
async function audit(s, action, target = "") {
  await sb("/rest/v1/audit_log", { method: "POST", token: s.token, body: { actor: s.email, action, target: String(target).slice(0, 300) }, headers: { prefer: "return=minimal" } }).catch(() => {});
}
async function readAreas(token = SUPABASE_KEY) {
  const r = await sb("/rest/v1/site_content?select=key,value,updated_at,updated_by", { token });
  if (!r.ok) throw sbError(r, "Couldn't read the website content.");
  return r.data;
}
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

// ---- Routes ----
export async function handle(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;
  try {
    // Public content for the website (site-content.js, the Treatment page's Instagram section, the build).
    if (path === "/api/site-content" && method === "GET") {
      const rows = await readAreas();
      const areas = Object.fromEntries(rows.filter((r) => AREAS.includes(r.key)).map((r) => [r.key, r.value]));
      return json(publicView(areas, { today: istToday(), announcementId: (a) => `${a.text.length}-${a.start}-${a.end}-${a.text.slice(0, 16)}` }), 200, { "cache-control": "public, max-age=60" });
    }
    if (path === "/api/media" && method === "GET") {
      const row = (await readAreas()).find((r) => r.key === "videos");
      const media = (row?.value || []).filter((v) => v.type === "instagram" && v.visible !== false && v.pages.includes("treatment")).slice(0, 12)
        .map((v) => ({ url: v.url, kind: v.kind, caption: v.title }));
      return json({ media }, 200, { "cache-control": "public, max-age=60" });
    }
    if (path === "/api/launch" && method === "GET") {
      const row = (await readAreas()).find((r) => r.key === "launch");
      if (!row) return fail(404, "No launch settings saved; the website uses content/launch.json.");
      return json({ hidden: row.value.hidden || [], hiddenArticles: row.value.hiddenArticles || [] });
    }

    if (!path.startsWith("/api/studio/")) return fail(404, "Not found.");
    const route = path.slice("/api/studio".length);
    if (method !== "GET" && req.headers.get("x-requested-with") !== "fetch") return fail(400, "Bad request.");

    // ---- Sign-in ----
    if (route === "/login" && method === "POST") {
      const { email, password } = await req.json().catch(() => ({}));
      const r = await sb("/auth/v1/token?grant_type=password", { method: "POST", body: { email: String(email || "").trim().toLowerCase(), password: String(password || "") } });
      if (!r.ok) return fail(401, "Email or password is not right.");
      const user = await sb("/auth/v1/user", { token: r.data.access_token });
      const verified = (user.data?.factors || []).find((f) => f.factor_type === "totp" && f.status === "verified");
      return withCookies(json({ step: verified ? "mfa" : "enroll", factorId: verified?.id || null }), setCookies(r.data));
    }
    if (route === "/logout" && method === "POST") {
      const token = cookieOf(req, "tb_at");
      if (token) await sb("/auth/v1/logout", { method: "POST", token }).catch(() => {});
      return withCookies(json({ ok: true }), clearCookies());
    }

    const s = await session(req);
    const reply = (body, status) => withCookies(json(body, status), s.cookies);

    if (route === "/mfa/enroll" && method === "POST") {
      const user = await sb("/auth/v1/user", { token: s.token });
      if ((user.data?.factors || []).some((f) => f.factor_type === "totp" && f.status === "verified")) return reply({ error: "Two-step sign-in is already set up. Enter the code from your app." }, 409);
      for (const f of (user.data?.factors || []).filter((x) => x.status !== "verified")) await sb(`/auth/v1/factors/${f.id}`, { method: "DELETE", token: s.token });
      const r = await sb("/auth/v1/factors", { method: "POST", token: s.token, body: { factor_type: "totp", friendly_name: `Tailbone dashboard ${Date.now()}` } });
      if (!r.ok) throw sbError(r, "Couldn't start two-step sign-in.");
      return reply({ factorId: r.data.id, qr: r.data.totp?.qr_code, secret: r.data.totp?.secret });
    }
    if (route === "/mfa/verify" && method === "POST") {
      const { factorId, code } = await req.json().catch(() => ({}));
      if (!/^[\w-]{10,64}$/.test(String(factorId || "")) || !/^\d{6}$/.test(String(code || ""))) return reply({ error: "Enter the 6-digit code from your authenticator app." }, 400);
      // Supabase refuses a check whose challenge came from a different outgoing IP; serverless IPs can change between requests, so retry that case.
      let v;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ch = await sb(`/auth/v1/factors/${factorId}/challenge`, { method: "POST", token: s.token, body: {} });
        if (!ch.ok) throw sbError(ch, "Couldn't check the code.");
        v = await sb(`/auth/v1/factors/${factorId}/verify`, { method: "POST", token: s.token, body: { challenge_id: ch.data.id, code: String(code) } });
        if (v.data?.error_code !== "mfa_ip_address_mismatch") break;
      }
      if (!v.ok) return reply({ error: "That code isn't right or has expired. Try the newest code." }, 401);
      return withCookies(json({ ok: true }), setCookies(v.data));
    }

    // After a reload with only the password step done: which second step comes next.
    if (route === "/login-state" && method === "GET") {
      const user = await sb("/auth/v1/user", { token: s.token });
      if (!user.ok) return reply({ error: "Please sign in." }, 401);
      const verified = (user.data?.factors || []).find((f) => f.factor_type === "totp" && f.status === "verified");
      return reply({ step: s.aal === "aal2" ? "done" : verified ? "mfa" : "enroll", factorId: verified?.id || null });
    }

    // Everything below needs a staff account.
    const me = await staffRow(s);
    if (route === "/me" && method === "GET") {
      if (!me && s.aal === "aal2") return reply({ error: "This account isn't on the clinic's staff list. Ask the super admin." }, 403);
      return reply({ email: s.email, aal: s.aal, role: me?.role || null, name: me?.name || "" });
    }
    needAal2(s);
    if (!me || me.disabled) return reply({ error: "This account isn't on the clinic's staff list. Ask the super admin." }, 403);
    const superadmin = me.role === "superadmin";

    if (route === "/website" && method === "GET") {
      const rows = await readAreas(s.token);
      const h = await sb("/rest/v1/site_content_history?select=id,key,changed_at,changed_by,value&order=id.desc&limit=60", { token: s.token });
      return reply({
        areas: Object.fromEntries(rows.filter((r) => AREAS.includes(r.key)).map((r) => [r.key, r.value])),
        meta: Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updated_at, updatedBy: r.updated_by }])),
        history: (h.data || []).filter((x) => x.key !== "launch" || superadmin)
          .map((x) => ({ id: x.id, key: x.key, label: AREA_LABELS[x.key] || x.key, changedAt: x.changed_at, changedBy: x.changed_by, wasDefault: x.value === null })),
      });
    }
    let m;
    if ((m = /^\/website\/(\w+)$/.exec(route)) && method === "PUT") {
      const area = m[1];
      if (!AREAS.includes(area)) return reply({ error: "Unknown website section." }, 404);
      const { value } = await req.json().catch(() => ({}));
      const clean = CLEAN[area](value);
      const r = await sb("/rest/v1/site_content?on_conflict=key", { method: "POST", token: s.token, body: { key: area, value: clean }, headers: { prefer: "resolution=merge-duplicates,return=minimal" } });
      if (!r.ok) throw sbError(r, "Couldn't save.");
      await audit(s, "website_content_saved", AREA_LABELS[area]);
      return reply({ ok: true, value: clean });
    }
    if ((m = /^\/website\/history\/(\d+)\/restore$/.exec(route)) && method === "POST") {
      const h = await sb(`/rest/v1/site_content_history?select=key,value&id=eq.${m[1]}`, { token: s.token });
      const row = h.data?.[0];
      if (!row) return reply({ error: "That earlier version no longer exists." }, 404);
      if (row.key === "launch") return reply({ error: "Launch settings are changed in the Launch phase card." }, 400);
      if (row.value === null) {
        const d = await sb(`/rest/v1/site_content?key=eq.${row.key}`, { method: "DELETE", token: s.token, headers: { prefer: "return=minimal" } });
        if (!d.ok) throw sbError(d, "Couldn't restore.");
      } else {
        const r = await sb("/rest/v1/site_content?on_conflict=key", { method: "POST", token: s.token, body: { key: row.key, value: CLEAN[row.key](row.value) }, headers: { prefer: "resolution=merge-duplicates,return=minimal" } });
        if (!r.ok) throw sbError(r, "Couldn't restore.");
      }
      await audit(s, "website_content_restored", `${AREA_LABELS[row.key]} (version #${m[1]})`);
      return reply({ ok: true, key: row.key });
    }
    if (route === "/upload" && method === "POST") {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024) return reply({ error: "Photos up to 4 MB can be added." }, 413);
      const type = buf[0] === 0xff && buf[1] === 0xd8 ? ["image/jpeg", "jpg"]
        : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? ["image/png", "png"]
          : buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP" ? ["image/webp", "webp"] : null;
      if (!type) return reply({ error: "Please choose a JPG, PNG or WebP photo." }, 415);
      const name = `press/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${type[1]}`;
      const r = await sb(`/storage/v1/object/site-media/${name}`, { method: "POST", token: s.token, body: buf, raw: true, headers: { "content-type": type[0], "x-upsert": "false" } });
      if (!r.ok) throw sbError(r, "The photo couldn't be uploaded.");
      await audit(s, "website_photo_added", name);
      return reply({ media: { url: `${SUPABASE_URL}/storage/v1/object/public/site-media/${name}`, kind: "image" } }, 201);
    }

    // ---- Super admin ----
    if (/^\/(launch|staff)/.test(route) && !superadmin) return reply({ error: "Only the super admin can do this." }, 403);
    if (route === "/launch" && method === "GET") {
      const row = (await readAreas(s.token)).find((r) => r.key === "launch");
      return reply({ launch: row ? { ...row.value, saved: true, updatedAt: row.updated_at, updatedBy: row.updated_by } : null, publishConnected: Boolean(process.env.NETLIFY_BUILD_HOOK) });
    }
    if (route === "/launch" && method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const clean = CLEAN.launch(body, { features: LAUNCH_FEATURES, articleIds: (body.articleIds || []).map(Number).filter(Number.isInteger) });
      const r = await sb("/rest/v1/site_content?on_conflict=key", { method: "POST", token: s.token, body: { key: "launch", value: clean }, headers: { prefer: "resolution=merge-duplicates,return=minimal" } });
      if (!r.ok) throw sbError(r, "Couldn't save.");
      await audit(s, "launch_settings_saved", `hidden: ${clean.hidden.join(", ") || "none"}; articles hidden: ${clean.hiddenArticles.length}`);
      return reply({ ok: true, launch: clean });
    }
    if (route === "/launch/publish" && method === "POST") {
      const hook = process.env.NETLIFY_BUILD_HOOK || "";
      if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[\w-]+$/.test(hook)) return reply({ error: "Publishing isn't connected yet: add the Netlify build hook as NETLIFY_BUILD_HOOK in Netlify (see DEPLOY.md)." }, 409);
      const r = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return reply({ error: `Netlify didn't accept the request (${r.status}). Try again in a minute.` }, 502);
      await audit(s, "launch_published", "website rebuild requested");
      return reply({ ok: true });
    }
    if (route === "/staff" && method === "GET") {
      const r = await sb("/rest/v1/staff?select=email,name,role,disabled,created_at&order=role.desc,email", { token: s.token });
      const log = await sb("/rest/v1/audit_log?select=at,actor,action,target&order=id.desc&limit=50", { token: s.token });
      return reply({ staff: r.data || [], log: log.data || [] });
    }
    if (route === "/staff" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Enter a valid email address." }, 400);
      const role = b.role === "superadmin" ? "superadmin" : "doctor";
      const r = await sb("/rest/v1/staff", { method: "POST", token: s.token, body: { email, name: String(b.name || "").slice(0, 120), role, created_by: s.email }, headers: { prefer: "return=minimal" } });
      if (r.status === 409) return reply({ error: "That email is already on the staff list." }, 409);
      if (!r.ok) throw sbError(r, "Couldn't add.");
      await audit(s, "staff_added", `${email} (${role})`);
      return reply({ ok: true }, 201);
    }
    if ((m = /^\/staff\/([^/]+)$/.exec(route)) && (method === "PATCH" || method === "DELETE")) {
      const email = decodeURIComponent(m[1]).toLowerCase();
      if (email === s.email) return reply({ error: "You can't change or remove your own account here." }, 400);
      const q = `/rest/v1/staff?email=eq.${encodeURIComponent(email)}`;
      let r;
      if (method === "DELETE") r = await sb(q, { method: "DELETE", token: s.token, headers: { prefer: "return=minimal" } });
      else {
        const b = await req.json().catch(() => ({}));
        const patch = {};
        if (typeof b.disabled === "boolean") patch.disabled = b.disabled;
        if (b.role === "doctor" || b.role === "superadmin") patch.role = b.role;
        r = await sb(q, { method: "PATCH", token: s.token, body: patch, headers: { prefer: "return=minimal" } });
      }
      if (!r.ok) throw sbError(r, "Couldn't change.");
      await audit(s, method === "DELETE" ? "staff_removed" : "staff_changed", email);
      return reply({ ok: true });
    }
    return reply({ error: "Not found." }, 404);
  } catch (err) {
    const status = err instanceof ContentError ? err.status : 500;
    if (status === 500) console.error(err);
    return fail(status, status === 500 ? "Something went wrong. Please try again." : err.message);
  }
}

export default handle;
