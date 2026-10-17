import { config, HOURS, BOOKING } from "./config.js";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.timezone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Current date (YYYY-MM-DD) and minutes-since-midnight in clinic time. */
export function clinicNow(now = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// A real calendar day: "2026-11-31" is rejected (Date would quietly roll it over to 1 December).
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** All slot start times for a date according to weekly opening hours. */
export function slotsForDate(date) {
  const [open, close] = HOURS[weekday(date)] || [];
  if (!open) return [];
  const out = [];
  for (let m = toMinutes(open); m + BOOKING.slotMinutes <= toMinutes(close); m += BOOKING.slotMinutes) out.push(fromMinutes(m));
  return out;
}

/** Whether a patient may book this date/time right now (ignores existing bookings). */
export function isBookableTime(date, time, now = new Date()) {
  const today = clinicNow(now);
  if (date < today.date || date > addDays(today.date, BOOKING.windowDays)) return false;
  if (!slotsForDate(date).includes(time)) return false;
  if (date === today.date && toMinutes(time) < today.minutes + BOOKING.leadMinutes) return false;
  return true;
}
