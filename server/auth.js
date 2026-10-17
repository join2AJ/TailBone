import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE = "tb_session";

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

export function createSessionCookie(res, adminId) {
  const payload = Buffer.from(JSON.stringify({ aid: adminId, exp: Date.now() + config.sessionHours * 3600_000 })).toString("base64url");
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd,
    maxAge: config.sessionHours * 3600_000,
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
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** Express middleware: require a signed-in admin. Also blocks cross-site state changes. */
export function requireAdmin(db) {
  const findAdmin = db.prepare("SELECT id, email, name FROM admins WHERE id = ?");
  return (req, res, next) => {
    const session = readSession(req);
    const admin = session && findAdmin.get(session.aid);
    if (!admin) return res.status(401).json({ error: "Please sign in." });
    if (req.method !== "GET" && req.get("x-requested-with") !== "fetch") {
      return res.status(403).json({ error: "Missing request header." });
    }
    req.admin = admin;
    next();
  };
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
