// Website content the clinic edits in the dashboard ("Website" section, phase 1): YouTube videos, the announcement bar,
// opening hours, contact details, FAQ and newspaper clippings. Each area is one JSON document in site_content; every save
// keeps the previous version in site_content_history so it can be restored. The static pages keep their built-in text
// as a fallback; /api/site-content tells the browser what to show instead (public/assets/js/site-content.js).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, HOURS } from "./config.js";
import { HttpError } from "./services.js";
import { CLEAN as RULES, PAGES as SHARED_PAGES, AREA_LABELS as SHARED_LABELS, publicView as sharedPublicView, faqFromHtml, youtubeId as sharedYoutubeId } from "../shared/content-rules.js";
import { clinicNow } from "./time.js";

export const PAGES = SHARED_PAGES;
const DEFAULT_HOURS = JSON.parse(JSON.stringify(HOURS));
const DEFAULT_CONTACT = { phone: "+91 98866 88323", whatsapp: "919886688323", email: "contact@tailbonetreatment.com" };
const HISTORY_KEEP = 30;
export const youtubeId = sharedYoutubeId;

// The areas this server stores (Instagram posts have their own table here, so videos are YouTube only).
const CLEAN = Object.fromEntries(["announcement", "hours", "contact", "faq", "press", "youtube"].map((k) => [k, RULES[k]]));
export const AREAS = Object.keys(CLEAN);
export const AREA_LABELS = SHARED_LABELS;

export function getArea(db, key) {
  const row = db.prepare("SELECT value FROM site_content WHERE key = ?").get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

/** Saves an area after validating it, keeping the old version in the history. Returns the clean value. */
export function saveArea(db, key, input, by) {
  if (!Object.hasOwn(CLEAN, key)) throw new HttpError(404, "Unknown website section.");
  const value = CLEAN[key](input);
  const before = db.prepare("SELECT value FROM site_content WHERE key = ?").get(key);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO site_content_history (key, value, changed_by) VALUES (?, ?, ?)").run(key, before ? before.value : "null", by);
    db.prepare(`INSERT INTO site_content (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(key, JSON.stringify(value), by);
    db.prepare(`DELETE FROM site_content_history WHERE key = ? AND id NOT IN
      (SELECT id FROM site_content_history WHERE key = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`).run(key, key);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  applyLive(db);
  return value;
}

/** Puts back the version saved before history entry `historyId` (the current one goes into the history in turn). */
export function restoreArea(db, historyId, by) {
  const h = db.prepare("SELECT key, value FROM site_content_history WHERE id = ?").get(historyId);
  if (!h) throw new HttpError(404, "That earlier version no longer exists.");
  const old = JSON.parse(h.value);
  if (old === null) { // there was no custom version: go back to the website's built-in content
    const cur = db.prepare("SELECT value FROM site_content WHERE key = ?").get(h.key);
    if (cur) db.prepare("INSERT INTO site_content_history (key, value, changed_by) VALUES (?, ?, ?)").run(h.key, cur.value, by);
    db.prepare("DELETE FROM site_content WHERE key = ?").run(h.key);
    applyLive(db);
    return { key: h.key, value: null };
  }
  return { key: h.key, value: saveArea(db, h.key, old, by) };
}

export function history(db, key) {
  return db.prepare("SELECT id, key, changed_at, changed_by, value FROM site_content_history WHERE (? IS NULL OR key = ?) ORDER BY id DESC LIMIT 60")
    .all(key ?? null, key ?? null).map((r) => ({ id: r.id, key: r.key, label: AREA_LABELS[r.key] || r.key, changedAt: r.changed_at, changedBy: r.changed_by, wasDefault: r.value === "null" }));
}

/** Opening hours and the WhatsApp number are also used by booking and messages, so saved values take effect at once. */
export function applyLive(db) {
  const hours = getArea(db, "hours");
  for (const d of Object.keys(DEFAULT_HOURS)) {
    if (hours && Object.hasOwn(hours, d)) { if (hours[d]) HOURS[d] = hours[d]; else delete HOURS[d]; } else HOURS[d] = DEFAULT_HOURS[d];
  }
  const contact = getArea(db, "contact");
  config.whatsappNumber = contact?.whatsapp || process.env.WHATSAPP_NUMBER || DEFAULT_CONTACT.whatsapp;
  config.clinicPhone = contact?.phone || DEFAULT_CONTACT.phone;
  config.clinicEmail = contact?.email || DEFAULT_CONTACT.email;
}

// The website's built-in FAQ and clippings, so the dashboard's forms start from what the site shows today.
// FAQ answers keep their links as [text](/address).
function builtInFaq() {
  try { return faqFromHtml(fs.readFileSync(path.join(config.publicDir, "faq.html"), "utf8")); } catch { return []; }
}
function builtInPress() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../content/press.json", import.meta.url), "utf8")).map((p) => ({ ...p, visible: true }));
  } catch { return []; }
}

/** Everything the dashboard shows, including defaults so the forms start filled in. */
export function adminView(db) {
  const meta = Object.fromEntries(db.prepare("SELECT key, updated_at, updated_by FROM site_content").all().map((r) => [r.key, { updatedAt: r.updated_at, updatedBy: r.updated_by }]));
  return {
    announcement: getArea(db, "announcement") || CLEAN.announcement({}),
    hours: getArea(db, "hours") || DEFAULT_HOURS,
    contact: getArea(db, "contact") || DEFAULT_CONTACT,
    faq: getArea(db, "faq") || builtInFaq(),
    press: getArea(db, "press") || builtInPress(),
    youtube: getArea(db, "youtube") || [],
    pages: PAGES, meta, history: history(db),
  };
}

/** What the public pages need (see shared/content-rules.js). */
export function publicView(db, { instagram = [] } = {}) {
  const areas = Object.fromEntries(["announcement", "hours", "contact", "faq", "press", "youtube"].map((k) => [k, getArea(db, k)]));
  return sharedPublicView(areas, {
    today: clinicNow().date, instagram,
    announcementId: (a) => crypto.createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 10),
  });
}
