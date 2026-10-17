import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE = "tb_session";
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 30;   // ISO 27001 A.8.5 / NIST PR.AA
export const LOCKOUT = { attempts: 5, minutes: 15 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sign = (data) => crypto.createHmac("sha256", config.sessionSecret).update(data).digest("base64url");

/**
 * Session cookie: signed payload with an absolute expiry (12 h), an idle timeout (30 min, refreshed on
 * activity) and the admin's session_version, so a password change signs out every other device.
 */
export function createSessionCookie(res, admin, { exp } = {}) {
  const now = Date.now();
  const data = { aid: admin.id, sv: admin.session_version ?? 1, exp: exp ?? now + config.sessionHours * 3600_000, last: now };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd,
    maxAge: Math.max(0, data.exp - now),
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function readSession(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Date.now();
    if (data.exp <= now) return null;
    if (!data.last || now - data.last > IDLE_MINUTES * 60_000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Express middleware: require a signed-in admin. Also blocks cross-site state changes. */
export function requireAdmin(db) {
  const findAdmin = db.prepare("SELECT id, email, name, session_version, totp_enabled, role, permissions, disabled FROM admins WHERE id = ?");
  return (req, res, next) => {
    const session = readSession(req);
    const admin = session && findAdmin.get(session.aid);
    if (!admin || admin.disabled || admin.session_version !== session.sv) {
      if (session) clearSessionCookie(res);
      return res.status(401).json({ error: "Your session has ended. Please sign in again." });
    }
    // Sliding idle timeout: refresh the cookie at most once a minute.
    if (Date.now() - session.last > 60_000) createSessionCookie(res, admin, { exp: session.exp });
    if (req.method !== "GET" && req.get("x-requested-with") !== "fetch") {
      return res.status(403).json({ error: "Missing request header." });
    }
    req.admin = admin;
    next();
  };
}

// ---------- TOTP two-factor authentication (RFC 6238, works with Google/Microsoft Authenticator) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(str) {
  let bits = "";
  for (const c of str.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error("Invalid base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, time = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret, code, time = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = totpCode(secret, time + w * 30_000);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c));
  });
}

export const totpUri = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`Tailbone Clinic:${email}`)}?secret=${secret}&issuer=${encodeURIComponent("Tailbone Clinic")}&digits=6&period=30`;

// ---------- Security log ----------
export function securityLog(db, req, action, target = "", admin = req?.admin) {
  const ip = String(req?.ip || "").replace(/^::ffff:/, "");
  db.prepare("INSERT INTO security_log (admin_id, actor, action, target, ip) VALUES (?, ?, ?, ?, ?)")
    .run(admin?.id ?? null, admin?.email || "", action, String(target).slice(0, 200), ip);
}

/** Tiny fixed-window rate limiter keyed by IP. */
export function rateLimit({ windowMs, max, message = "Too many requests, please try again later." }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
    } else if (++entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
