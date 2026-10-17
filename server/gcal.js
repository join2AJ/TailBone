import crypto from "node:crypto";
import { config, CLINICS } from "./config.js";

// Google Calendar integration (service account, no extra dependencies).
//  - Every appointment is mirrored as an event in the doctor's calendar (created, moved, removed).
//  - The doctor's busy times (his own events) block those slots on the website.
// Setup (see DEPLOY.md): create a Google Cloud service account, share the doctor's calendar with its
// email ("Make changes to events"), then set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and
// GOOGLE_CALENDAR_ID. Events carry no phone numbers or health details, because calendars are often shared.

const env = (k) => process.env[k] || "";
export const gcalEnabled = () => env("DEMO_MODE") !== "true"
  && !!(env("GOOGLE_SERVICE_ACCOUNT_EMAIL") && env("GOOGLE_PRIVATE_KEY") && env("GOOGLE_CALENDAR_ID"));

// ---------- HTTP (swappable for tests) ----------
let token = { value: "", exp: 0 };
async function accessToken() {
  if (token.value && token.exp > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const key = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"); // env vars often store the PEM with literal \n
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return token.value;
}

let http = async (method, path, body) => {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204 || res.status === 410) return null; // deleted / already gone
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${data.error?.message || "request failed"}`);
  return data;
};
export function setGcalClient(fn) { http = fn; }

const calPath = () => `/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}`;

// ---------- Events ----------
const endTime = (time, minutes = 30) => {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const shortName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0];
};

export function eventFor(a, base = config.siteUrl) {
  const where = CLINICS[a.clinic];
  const mode = a.clinic === "online" ? "ONLINE video" : `IN CLINIC ${where.short}`;
  return {
    summary: `${a.status === "pending" ? "(Pending) " : ""}${mode} · ${a.appt_no} · ${a.patient_code} · ${shortName(a.patient_name)}`,
    location: a.clinic === "online" ? "Online (video call)" : where.address,
    description: [
      `Appointment no.: ${a.appt_no}`,
      `Patient ID: ${a.patient_code}`,
      `Type: ${a.clinic === "online" ? "Online video consultation" : `In person at the ${where.name}`}`,
      `${a.visit_type === "followup" ? "Follow-up" : "New"} visit · status: ${a.status}`,
      base ? `Open in dashboard: ${base}/admin#/appointments` : "",
    ].filter(Boolean).join("\n"),
    start: { dateTime: `${a.date}T${a.time}:00`, timeZone: config.timezone },
    end: { dateTime: `${a.date}T${endTime(a.time)}:00`, timeZone: config.timezone },
    colorId: a.status === "pending" ? "5" : "10", // yellow pending, green confirmed
    extendedProperties: { private: { tailboneAppointment: String(a.id) } },
    reminders: { useDefault: true },
  };
}

/**
 * Bring the calendar in line with one appointment. Never throws: the outcome is stored on the
 * appointment (gcal_status) so the dashboard can show it and the background job can retry.
 */
export async function syncAppointment(db, id, { getAppointment }) {
  if (!gcalEnabled()) return null;
  const a = getAppointment(db, id);
  if (!a) return null;
  const active = ["pending", "confirmed", "completed"].includes(a.status) && a.payment_status !== "awaiting";
  try {
    if (!active) {
      if (a.gcal_event_id) await http("DELETE", `${calPath()}/events/${encodeURIComponent(a.gcal_event_id)}`);
      db.prepare("UPDATE appointments SET gcal_event_id = NULL, gcal_status = 'synced' WHERE id = ?").run(id);
      return "removed";
    }
    if (a.gcal_event_id) {
      await http("PATCH", `${calPath()}/events/${encodeURIComponent(a.gcal_event_id)}`, eventFor(a));
      db.prepare("UPDATE appointments SET gcal_status = 'synced' WHERE id = ?").run(id);
      return "updated";
    }
    const ev = await http("POST", `${calPath()}/events`, eventFor(a));
    db.prepare("UPDATE appointments SET gcal_event_id = ?, gcal_status = 'synced' WHERE id = ?").run(ev.id, id);
    return "created";
  } catch (err) {
    db.prepare("UPDATE appointments SET gcal_status = ? WHERE id = ?").run(String(err.message).slice(0, 200), id);
    return "error";
  }
}

/** Retry appointments whose last sync failed, and upcoming ones never synced (e.g. booked before setup). */
export async function retryPendingSyncs(db, deps) {
  if (!gcalEnabled()) return 0;
  const rows = db.prepare(
    `SELECT id FROM appointments WHERE date >= date('now', '-1 day')
     AND ((gcal_status IS NOT NULL AND gcal_status != 'synced')
       OR (gcal_status IS NULL AND status IN ('pending','confirmed') AND payment_status != 'awaiting'))
     ORDER BY date LIMIT 50`,
  ).all();
  for (const { id } of rows) await syncAppointment(db, id, deps);
  return rows.length;
}

// ---------- Busy times (doctor's own events block website slots) ----------
const busyCache = new Map(); // date → { at, ranges: [[startMs, endMs]] }
const BUSY_TTL = 5 * 60_000;

/** Fetch busy ranges for a date span (inclusive) into the cache. Fails open: on error, nothing is blocked. */
export async function ensureBusy(fromDate, toDate = fromDate) {
  if (!gcalEnabled()) return;
  const missing = [];
  for (let d = fromDate; d <= toDate; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const c = busyCache.get(d);
    if (!c || Date.now() - c.at > BUSY_TTL) missing.push(d);
  }
  if (!missing.length) return;
  try {
    const data = await http("POST", "/freeBusy", {
      timeMin: `${missing[0]}T00:00:00+05:30`,
      timeMax: `${missing.at(-1)}T23:59:59+05:30`,
      timeZone: config.timezone,
      items: [{ id: env("GOOGLE_CALENDAR_ID") }],
    });
    const busy = data?.calendars?.[env("GOOGLE_CALENDAR_ID")]?.busy || [];
    const ranges = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]);
    for (const d of missing) busyCache.set(d, { at: Date.now(), ranges });
  } catch {
    // Fail open: if Google is unreachable, the website keeps offering slots (the DB still prevents double booking).
  }
}

/** True when the doctor's calendar has something else in this 30-minute slot. */
export function isBusy(date, time, minutes = 30) {
  const c = busyCache.get(date);
  if (!c) return false;
  const start = Date.parse(`${date}T${time}:00+05:30`);
  const end = start + minutes * 60_000;
  return c.ranges.some(([s, e]) => s < end && e > start);
}

export function clearBusyCache() { busyCache.clear(); }

// ---------- Subscription feed (no Google setup needed) ----------
const icsEscape = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
const utc = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** iCalendar feed of upcoming and recent appointments; the doctor subscribes to it in Google Calendar. */
export function calendarFeed(rows, base = config.siteUrl) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tailbone Treatment//Appointments//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:Tailbone clinic appointments", "X-WR-TIMEZONE:Asia/Kolkata", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const a of rows) {
    const ev = eventFor(a, base);
    lines.push("BEGIN:VEVENT", `UID:${a.appt_no}@tailbonetreatment.com`, `DTSTAMP:${stamp}`,
      `DTSTART:${utc(a.date, a.time)}`, `DTEND:${utc(a.date, endTime(a.time))}`,
      `SUMMARY:${icsEscape(ev.summary)}`, `LOCATION:${icsEscape(ev.location)}`, `DESCRIPTION:${icsEscape(ev.description)}`,
      `STATUS:${a.status === "pending" ? "TENTATIVE" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** "Add to Google Calendar" link for patients (opens Google Calendar with the details filled in). */
export function googleCalendarLink(a, base = config.siteUrl) {
  const where = CLINICS[a.clinic];
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `Tailbone Treatment: ${where.name}`,
    dates: `${utc(a.date, a.time)}/${utc(a.date, endTime(a.time))}`,
    details: `Appointment no. ${a.appt_no} · Patient ID ${a.patient_code}${base ? `\nManage: ${base}/manage.html?ref=${a.appt_no}` : ""}`,
    location: where.address,
    ctz: config.timezone,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
