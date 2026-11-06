// Website content the clinic edits in the dashboard ("Website" section, phase 1): YouTube videos, the announcement bar,
// opening hours, contact details, FAQ and newspaper clippings. Each area is one JSON document in site_content; every save
// keeps the previous version in site_content_history so it can be restored. The static pages keep their built-in text
// as a fallback; /api/site-content tells the browser what to show instead (public/assets/js/site-content.js).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, HOURS } from "./config.js";
import { HttpError, cleanText } from "./services.js";
import { clinicNow } from "./time.js";

export const PAGES = { home: "Home", treatment: "Treatment", doctor: "Doctor" };
const DEFAULT_HOURS = JSON.parse(JSON.stringify(HOURS));
const DEFAULT_CONTACT = { phone: "+91 98866 88323", whatsapp: "919886688323", email: "contact@tailbonetreatment.com" };
const HISTORY_KEEP = 30;

const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const httpsUrl = (v, max = 500) => {
  const s = cleanText(v, max);
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s; // a page on this site
  try { const u = new URL(s); return u.protocol === "https:" ? u.href : null; } catch { return null; }
};

/** The 11-character id of a YouTube video from any of its usual links (watch, youtu.be, shorts, embed, live). */
export function youtubeId(input) {
  const s = cleanText(input, 300);
  if (/^[\w-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let idPart = null;
  if (host === "youtu.be") idPart = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    idPart = u.searchParams.get("v") || (/^\/(shorts|embed|live)\/([^/?#]+)/.exec(u.pathname) || [])[2];
  }
  return idPart && /^[\w-]{11}$/.test(idPart) ? idPart : null;
}

// ---- Validation: each area turns dashboard input into a clean document, or explains what's wrong ----
const CLEAN = {
  announcement(v) {
    const a = {
      enabled: v?.enabled === true,
      text: cleanText(v?.text, 200),
      textHi: cleanText(v?.textHi, 200),
      linkText: cleanText(v?.linkText, 40),
      link: httpsUrl(v?.link),
      start: isDate(v?.start) ? v.start : "",
      end: isDate(v?.end) ? v.end : "",
      tone: ["info", "warning", "success"].includes(v?.tone) ? v.tone : "info",
    };
    if (a.link === null) throw new HttpError(400, "The link must start with https:// or be a page on this site, such as /book.");
    if (a.enabled && !a.text) throw new HttpError(400, "Write the announcement before switching it on.");
    if (a.start && a.end && a.end < a.start) throw new HttpError(400, "The end date is before the start date.");
    if (a.link && !a.linkText) a.linkText = "Find out more";
    return a;
  },
  hours(v) {
    const out = {};
    for (let d = 0; d < 7; d++) {
      const day = v?.[d];
      if (day === null || day === false || day?.closed) { out[d] = null; continue; }
      const [open, close] = Array.isArray(day) ? day : [day?.open, day?.close];
      if (!isTime(open) || !isTime(close)) throw new HttpError(400, "Give opening and closing times as HH:MM, or mark the day closed.");
      if (close <= open) throw new HttpError(400, "Closing time must be after opening time.");
      out[d] = [open, close];
    }
    if (!Object.values(out).some(Boolean)) throw new HttpError(400, "At least one day must be open.");
    return out;
  },
  contact(v) {
    const digits = (s) => String(s ?? "").replace(/\D/g, "");
    const phone = cleanText(v?.phone, 30);
    const whatsapp = digits(v?.whatsapp);
    const email = cleanText(v?.email, 120).toLowerCase();
    if (digits(phone).length < 10) throw new HttpError(400, "Enter the phone number with its country code, e.g. +91 98866 88323.");
    if (whatsapp.length < 11 || whatsapp.length > 15) throw new HttpError(400, "Enter the WhatsApp number with its country code and no spaces, e.g. 919886688323.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    return { phone, whatsapp, email };
  },
  faq(v) {
    if (!Array.isArray(v)) throw new HttpError(400, "Invalid FAQ list.");
    if (v.length > 40) throw new HttpError(400, "Up to 40 questions can be shown.");
    return v.map((x) => {
      const q = cleanText(x?.q, 200);
      const a = cleanText(x?.a, 2000);
      if (!q || !a) throw new HttpError(400, "Every question needs an answer (and the other way round).");
      return { q, a, visible: x?.visible !== false };
    });
  },
  press(v) {
    if (!Array.isArray(v)) throw new HttpError(400, "Invalid list of clippings.");
    if (v.length > 60) throw new HttpError(400, "Up to 60 clippings can be shown.");
    return v.map((x, i) => {
      const image = httpsUrl(x?.image);
      const publication = cleanText(x?.publication, 80);
      if (!publication) throw new HttpError(400, "Every clipping needs the newspaper's name.");
      if (!image) throw new HttpError(400, `Add a photo of the clipping for ${publication}.`);
      const thumb = httpsUrl(x?.thumb) || image;
      const slug = cleanText(x?.slug, 120).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")
        || `clipping-${i + 1}-${publication.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 120);
      const n = (k, d) => (Number.isInteger(x?.[k]) && x[k] > 0 && x[k] < 10000 ? x[k] : d);
      return {
        slug, publication, title: cleanText(x?.title, 160), language: cleanText(x?.language, 40),
        date: isDate(x?.date) ? x.date : "", image, thumb,
        width: n("width", 800), height: n("height", 1000), thumbWidth: n("thumbWidth", n("width", 800)), thumbHeight: n("thumbHeight", n("height", 1000)),
        visible: x?.visible !== false,
      };
    });
  },
  youtube(v) {
    if (!Array.isArray(v)) throw new HttpError(400, "Invalid list of videos.");
    if (v.length > 30) throw new HttpError(400, "Up to 30 videos can be added.");
    const seen = new Set();
    return v.map((x) => {
      const id = youtubeId(x?.id || x?.url);
      if (!id) throw new HttpError(400, "Paste a YouTube link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/…");
      if (seen.has(id)) throw new HttpError(409, "That video is already in the list.");
      seen.add(id);
      const pages = [...new Set((Array.isArray(x?.pages) ? x.pages : []).filter((p) => Object.hasOwn(PAGES, p)))];
      if (!pages.length) throw new HttpError(400, "Choose at least one page for each video.");
      return { id, title: cleanText(x?.title, 120), pages, visible: x?.visible !== false, short: !!x?.short || /\/shorts\//.test(String(x?.url || "")) };
    });
  },
};
export const AREAS = Object.keys(CLEAN);
export const AREA_LABELS = { announcement: "Announcement bar", hours: "Opening hours", contact: "Contact details", faq: "FAQ", press: "Newspaper clippings", youtube: "YouTube videos" };

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
  try {
    const html = fs.readFileSync(path.join(config.publicDir, "faq.html"), "utf8");
    const plain = (x) => x.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ").trim();
    return [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ q: plain(m[1]), a: plain(m[2]), visible: true }));
  } catch { return []; }
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

/** What the public pages need. Only areas the clinic has changed are sent; the pages keep their built-in content otherwise. */
export function publicView(db, { instagram = [] } = {}) {
  const today = clinicNow().date;
  const a = getArea(db, "announcement");
  const live = a?.enabled && a.text && (!a.start || a.start <= today) && (!a.end || a.end >= today);
  const out = {
    announcement: live ? { text: a.text, textHi: a.textHi, link: a.link, linkText: a.linkText, tone: a.tone, id: crypto.createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 10) } : null,
    hours: getArea(db, "hours"),
    contact: getArea(db, "contact"),
    faq: getArea(db, "faq")?.filter((x) => x.visible).map(({ q, a: ans }) => ({ q, a: ans })) ?? null,
    press: getArea(db, "press")?.filter((x) => x.visible) ?? null,
    videos: {},
  };
  const yt = (getArea(db, "youtube") || []).filter((v) => v.visible);
  for (const p of Object.keys(PAGES)) {
    out.videos[p] = [
      ...yt.filter((v) => v.pages.includes(p)).map((v) => ({ type: "youtube", id: v.id, title: v.title, short: v.short })),
      // The Treatment page has its own Instagram section, so its Instagram posts aren't repeated here.
      ...instagram.filter((m) => p !== "treatment" && m.pages.split(",").includes(p)).map((m) => ({ type: "instagram", url: m.url, kind: m.kind, title: m.caption })),
    ];
  }
  return out;
}
