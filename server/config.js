import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader so the app runs without extra dependencies.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, ".session-secret");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(file, "utf8").trim();
}

// DEMO_MODE=true runs a public demo: separate database with sample data (reset daily), one-click
// demo logins, and no real payments or messages. Never point a demo at the real database.
const demo = process.env.DEMO_MODE === "true";

export const config = {
  demo,
  root: ROOT,
  publicDir: path.join(ROOT, "public"),
  port: Number(process.env.PORT) || 3000,
  isProd: process.env.NODE_ENV === "production",
  dbFile: demo ? path.join(dataDir, "demo.db") : process.env.DB_FILE || path.join(dataDir, "tailbone.db"),
  sessionSecret: loadSecret(),
  sessionHours: 12,
  siteUrl: (process.env.SITE_URL || "").replace(/\/$/, ""),
  whatsappNumber: process.env.WHATSAPP_NUMBER || "919886688323",
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  timezone: "Asia/Kolkata",
};

// Clinic catalogue and weekly hours (0 = Sunday). Times are clinic-local (IST).
export const CLINICS = {
  blr: { id: "blr", name: "Bengaluru clinic", short: "Bengaluru", address: "No. 213, 9th Cross, 2nd Phase, JP Nagar, Bengaluru (opp. Diwakar Hospital)" },
  del: { id: "del", name: "New Delhi clinic", short: "New Delhi", address: "150A/09, Shanti Apartment, Kishangarh, Vasant Kunj, New Delhi 110070" },
  online: { id: "online", name: "Online consultation", short: "Online", address: "Video call (link shared on WhatsApp)" },
  lko: { id: "lko", name: "Lucknow clinic", short: "Lucknow", address: "Opening soon in Lucknow" },
};
// Whether each clinic takes bookings (open / closed / soon) is a dashboard setting: see policy.js.

export const HOURS = {
  0: ["08:00", "15:00"],
  1: ["10:00", "17:00"],
  2: ["10:00", "17:00"],
  3: ["10:00", "17:00"],
  4: ["10:00", "17:00"],
  5: ["10:00", "17:00"],
  6: ["10:00", "15:00"],
};

export const BOOKING = {
  slotMinutes: 30,
  leadMinutes: 60, // earliest bookable slot is this far from now
  windowDays: 60, // how far ahead patients can book
  defaultFollowupDays: 14,
};
