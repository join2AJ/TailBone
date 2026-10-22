// Referral partners' own pages: sign up, log in, and see their referral ID, the patients they referred (initials only),
// what they've earned and what has been paid. Separate from the clinic dashboard's sign-in (different cookie and secret).
import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { rateLimit, hashPassword, verifyPassword } from "../auth.js";
import { encrypt } from "../crypto.js";
import { isOn } from "../features.js";
import { HttpError, cleanText, normalizePhone, validEmail, siteUrl } from "../services.js";
import { PARTNER_KINDS, getReferralSettings, newPartnerCode, partnerTotals, partnerReferrals } from "../referrals.js";
import { rupees } from "../payments.js";

const COOKIE = "tb_partner";
const HOURS = 12;
const sign = (data) => crypto.createHmac("sha256", `partner:${config.sessionSecret}`).update(data).digest("base64url");
const DUMMY_HASH = hashPassword("timing-equaliser-not-a-real-password");

function setCookie(res, partner) {
  const payload = Buffer.from(JSON.stringify({ pid: partner.id, sv: partner.session_version, exp: Date.now() + HOURS * 3600_000 })).toString("base64url");
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "strict", secure: config.isProd, maxAge: HOURS * 3600_000, path: "/" });
}

function readCookie(req) {
  const raw = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, sig] = decodeURIComponent(raw).split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export function partnerRoutes(db) {
  const r = Router({ caseSensitive: true, strict: true });
  const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many sign-ups from here. Please try again later or WhatsApp us." });
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, message: "Too many attempts. Please try again in 15 minutes." });

  r.use((req, res, next) => {
    if (!isOn(db, "referrals")) return res.status(404).json({ error: "The referral programme is not open at the moment." });
    // Cross-site form posts can't reach these routes (the pages send this header with fetch).
    if (req.method !== "GET" && req.get("x-requested-with") !== "fetch") return res.status(403).json({ error: "Missing request header." });
    next();
  });

  const current = (req) => {
    const s = readCookie(req);
    const p = s && db.prepare("SELECT * FROM partners WHERE id = ?").get(s.pid);
    return p && p.session_version === s.sv && p.status !== "suspended" ? p : null;
  };

  r.get("/info", (req, res) => {
    const s = getReferralSettings(db);
    res.json({ kinds: PARTNER_KINDS, firstBooking: rupees(s.firstBooking), treatment: rupees(s.treatment), months: s.months });
  });

  r.post("/signup", signupLimit, (req, res) => {
    if (req.body.website) throw new HttpError(400, "Invalid submission.");
    const b = req.body;
    if (!PARTNER_KINDS[b.kind] || b.kind === "patient") throw new HttpError(400, "Please choose who you are.");
    const name = cleanText(b.name, 120);
    if (name.length < 2) throw new HttpError(400, "Please enter your name or your organisation's name.");
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, "Please enter a valid mobile number. You'll log in with it.");
    const password = String(b.password || "");
    if (password.length < 8) throw new HttpError(400, "Please choose a password of at least 8 characters.");
    if (b.agree !== true) throw new HttpError(400, "Please agree to the partner terms.");
    try {
      db.prepare(`INSERT INTO partners (code, kind, name, contact_name, phone, email, city, payout_details, password_hash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .run(newPartnerCode(db), b.kind, name, cleanText(b.contactName, 120), phone, validEmail(b.email) || null, cleanText(b.city, 60),
          encrypt(cleanText(b.payoutDetails, 300)), hashPassword(password));
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "This mobile number is already registered. Please log in instead.");
      throw err;
    }
    db.prepare("INSERT INTO notifications (audience, event, channel, body, status) VALUES ('doctor', 'partner_signup', 'dashboard', ?, 'sent')")
      .run(encrypt(`New referral partner sign-up: ${name} (${PARTNER_KINDS[b.kind]}). Approve it in Referrals.`));
    const partner = db.prepare("SELECT * FROM partners WHERE phone = ?").get(phone);
    setCookie(res, partner);
    res.status(201).json({ ok: true });
  });

  r.post("/login", loginLimit, (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const p = phone && db.prepare("SELECT * FROM partners WHERE phone = ?").get(phone);
    const fail = () => { throw new HttpError(401, "That mobile number and password don't match."); };
    if (!p || !p.password_hash) { verifyPassword(String(req.body.password || ""), DUMMY_HASH); fail(); }
    if (p.locked_until && p.locked_until > new Date().toISOString()) throw new HttpError(429, "Too many wrong passwords. Please try again in 15 minutes, or ask the clinic to reset it.");
    if (!verifyPassword(String(req.body.password || ""), p.password_hash)) {
      const n = p.failed_logins + 1;
      db.prepare("UPDATE partners SET failed_logins = ?, locked_until = ? WHERE id = ?").run(n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null, p.id);
      fail();
    }
    if (p.status === "suspended") throw new HttpError(403, "This partner account is paused. Please contact the clinic.");
    db.prepare("UPDATE partners SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(p.id);
    setCookie(res, p);
    res.json({ ok: true });
  });

  r.post("/logout", (req, res) => { res.clearCookie(COOKIE, { path: "/" }); res.json({ ok: true }); });

  r.get("/me", (req, res) => {
    const p = current(req);
    if (!p) throw new HttpError(401, "Please log in.");
    const s = getReferralSettings(db);
    const active = p.status === "active";
    const link = `${siteUrl(req)}/book?ref=${p.code}`;
    const totals = active ? partnerTotals(db, p.id) : null;
    res.json({
      partner: { name: p.name, kind: PARTNER_KINDS[p.kind], status: p.status, code: active ? p.code : null, contactName: p.contact_name, city: p.city },
      rules: { firstBooking: rupees(s.firstBooking), treatment: rupees(s.treatment), months: s.months },
      link: active ? link : null,
      shareText: active ? `For tailbone (coccyx) pain I recommend Dr Rajveer Singh, a specialist who treats it without surgery (New Delhi and online). Book with my referral code ${p.code}: ${link}` : null,
      totals: totals && { ...totals, dueText: rupees(totals.due), paidText: rupees(totals.paid) },
      referrals: active ? partnerReferrals(db, p.id).map((x) => ({ ...x, earnedText: rupees(x.earned) })) : [],
      payouts: active ? db.prepare("SELECT amount, method, reference, paid_at FROM partner_payouts WHERE partner_id = ? ORDER BY id DESC LIMIT 60").all(p.id).map((x) => ({ ...x, amountText: rupees(x.amount) })) : [],
    });
  });

  r.post("/password", (req, res) => {
    const p = current(req);
    if (!p) throw new HttpError(401, "Please log in.");
    if (!verifyPassword(String(req.body.current || ""), p.password_hash || DUMMY_HASH)) throw new HttpError(400, "Your current password is incorrect.");
    if (String(req.body.next || "").length < 8) throw new HttpError(400, "The new password must be at least 8 characters.");
    db.prepare("UPDATE partners SET password_hash = ?, session_version = session_version + 1 WHERE id = ?").run(hashPassword(String(req.body.next)), p.id);
    setCookie(res, db.prepare("SELECT * FROM partners WHERE id = ?").get(p.id));
    res.json({ ok: true });
  });

  return r;
}
