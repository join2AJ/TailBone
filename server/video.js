// Online video consultations. The clinic keeps its usual video room (Google Meet, Zoom, WhatsApp video…) in Settings
// and can set a different link for one appointment. The patient gets a "Join call" button in My appointments from
// 15 minutes before the start until an hour after. The link is only handed out in that window, so a patient can't
// walk into the doctor's standing room during someone else's consultation (use a room where the host admits guests).
import { HttpError } from "./services.js";

export const JOIN_BEFORE_MIN = 15;
export const JOIN_AFTER_MIN = 60;

export function getVideoSettings(db) {
  try { return { defaultUrl: "", ...JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'video'").get()?.value || "{}") }; } catch { return { defaultUrl: "" }; }
}

/** A video link the clinic entered: https only, no spaces, sensible length. Empty clears it. */
export function cleanVideoUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpError(400, "Please paste the full video link, starting with https://"); }
  if (parsed.protocol !== "https:" || url.length > 300 || /\s/.test(url)) throw new HttpError(400, "Please paste the full video link, starting with https://");
  return parsed.href;
}

export function saveVideoSettings(db, { defaultUrl }) {
  const next = { defaultUrl: cleanVideoUrl(defaultUrl) };
  db.prepare("INSERT INTO settings (key, value) VALUES ('video', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

/** The link for this appointment: its own, or the clinic's usual room. */
export const videoUrlFor = (db, appt) => (appt.clinic === "online" ? appt.video_url || getVideoSettings(db).defaultUrl || "" : "");

/**
 * What the patient sees for an online appointment.
 * state: "early" (before the window), "open" (join now), "over", or "inactive" (cancelled, awaiting payment or confirmation).
 */
export function videoForPatient(db, appt, now = Date.now()) {
  if (appt.clinic !== "online") return null;
  const start = Date.parse(`${appt.date}T${appt.time}:00+05:30`); // appointment times are clinic time (IST)
  const opensAt = start - JOIN_BEFORE_MIN * 60_000;
  const closesAt = start + JOIN_AFTER_MIN * 60_000;
  const active = appt.status === "confirmed" && appt.payment_status !== "awaiting";
  const state = !active ? (appt.status === "pending" ? "pending" : "inactive") : now < opensAt ? "early" : now > closesAt ? "over" : "open";
  const url = videoUrlFor(db, appt);
  return {
    state,
    opensAt: new Date(opensAt).toISOString(),
    startsAt: new Date(start).toISOString(),
    closesAt: new Date(closesAt).toISOString(),
    hasLink: !!url,
    url: state === "open" ? url : "",
    joinBeforeMinutes: JOIN_BEFORE_MIN,
  };
}
