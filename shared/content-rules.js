// Rules for the website content the clinic edits (announcement bar, opening hours, contact details, FAQ, newspaper
// clippings, videos), shared by the Node server (server/site-content.js) and the Netlify function that phase 1 runs on
// (netlify/functions/api.mjs, with Supabase). Pure functions only: no database, no files.

export class ContentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const PAGES = { home: "Home", treatment: "Treatment", doctor: "Doctor" };
/** What the website shows before the clinic changes anything (keep in step with server/config.js HOURS). */
export const DEFAULT_HOURS = { 0: ["08:00", "15:00"], 1: ["10:00", "17:00"], 2: ["10:00", "17:00"], 3: ["10:00", "17:00"], 4: ["10:00", "17:00"], 5: ["10:00", "17:00"], 6: ["10:00", "15:00"] };
export const DEFAULT_CONTACT = { phone: "+91 98866 88323", whatsapp: "919886688323", email: "contact@tailbonetreatment.com" };
export const AREA_LABELS = { announcement: "Announcement bar", hours: "Opening hours", contact: "Contact details", faq: "FAQ", press: "Newspaper clippings", youtube: "YouTube videos", videos: "Videos", launch: "Launch phase" };

export const cleanText = (value, max = 500) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** A link the website may show: a page on this site ("/book") or an https address. null = not allowed. */
export function safeUrl(v, max = 500) {
  const s = cleanText(v, max);
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try { const u = new URL(s); return u.protocol === "https:" ? u.href : null; } catch { return null; }
}

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

/** An Instagram post or reel link in its standard form, or null. */
export function instagramUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (u.protocol !== "https:" || !/^(www\.)?instagram\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})\/?$/);
  if (!m) return null;
  const kind = m[1] === "p" ? "post" : "reel";
  return { url: `https://www.instagram.com/${kind === "post" ? "p" : "reel"}/${m[2]}/`, kind };
}

const pagesOf = (x) => {
  const pages = [...new Set((Array.isArray(x?.pages) ? x.pages : []).filter((p) => Object.hasOwn(PAGES, p)))];
  if (!pages.length) throw new ContentError(400, "Choose at least one page for each video.");
  return pages;
};
const youtubeItem = (x) => {
  const id = youtubeId(x?.id || x?.url);
  if (!id) throw new ContentError(400, "Paste a YouTube link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/…");
  return { type: "youtube", id, title: cleanText(x?.title, 120), pages: pagesOf(x), visible: x?.visible !== false, short: !!x?.short || /\/shorts\//.test(String(x?.url || "")) };
};

/** Each area: dashboard input → a clean document, or a ContentError that says what's wrong. */
export const CLEAN = {
  announcement(v) {
    const a = {
      enabled: v?.enabled === true,
      text: cleanText(v?.text, 200),
      textHi: cleanText(v?.textHi, 200),
      linkText: cleanText(v?.linkText, 40),
      link: safeUrl(v?.link),
      start: isDate(v?.start) ? v.start : "",
      end: isDate(v?.end) ? v.end : "",
      tone: ["info", "warning", "success"].includes(v?.tone) ? v.tone : "info",
    };
    if (a.link === null) throw new ContentError(400, "The link must start with https:// or be a page on this site, such as /book.");
    if (a.enabled && !a.text) throw new ContentError(400, "Write the announcement before switching it on.");
    if (a.start && a.end && a.end < a.start) throw new ContentError(400, "The end date is before the start date.");
    if (a.link && !a.linkText) a.linkText = "Find out more";
    return a;
  },
  hours(v) {
    const out = {};
    for (let d = 0; d < 7; d++) {
      const day = v?.[d];
      if (day === null || day === false || day?.closed) { out[d] = null; continue; }
      const [open, close] = Array.isArray(day) ? day : [day?.open, day?.close];
      if (!isTime(open) || !isTime(close)) throw new ContentError(400, "Give opening and closing times as HH:MM, or mark the day closed.");
      if (close <= open) throw new ContentError(400, "Closing time must be after opening time.");
      out[d] = [open, close];
    }
    if (!Object.values(out).some(Boolean)) throw new ContentError(400, "At least one day must be open.");
    return out;
  },
  contact(v) {
    const digits = (s) => String(s ?? "").replace(/\D/g, "");
    const phone = cleanText(v?.phone, 30);
    const whatsapp = digits(v?.whatsapp);
    const email = cleanText(v?.email, 120).toLowerCase();
    if (digits(phone).length < 10) throw new ContentError(400, "Enter the phone number with its country code, e.g. +91 98866 88323.");
    if (whatsapp.length < 11 || whatsapp.length > 15) throw new ContentError(400, "Enter the WhatsApp number with its country code and no spaces, e.g. 919886688323.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ContentError(400, "Enter a valid email address.");
    return { phone, whatsapp, email };
  },
  faq(v) {
    if (!Array.isArray(v)) throw new ContentError(400, "Invalid FAQ list.");
    if (v.length > 40) throw new ContentError(400, "Up to 40 questions can be shown.");
    return v.map((x) => {
      const q = cleanText(x?.q, 200);
      const a = cleanText(x?.a, 2000);
      if (!q || !a) throw new ContentError(400, "Every question needs an answer (and the other way round).");
      return { q, a, visible: x?.visible !== false };
    });
  },
  press(v) {
    if (!Array.isArray(v)) throw new ContentError(400, "Invalid list of clippings.");
    if (v.length > 60) throw new ContentError(400, "Up to 60 clippings can be shown.");
    return v.map((x, i) => {
      const image = safeUrl(x?.image);
      const publication = cleanText(x?.publication, 80);
      if (!publication) throw new ContentError(400, "Every clipping needs the newspaper's name.");
      if (!image) throw new ContentError(400, `Add a photo of the clipping for ${publication}.`);
      const thumb = safeUrl(x?.thumb) || image;
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
  /** YouTube only (the Node server keeps Instagram posts in their own table). */
  youtube(v) {
    if (!Array.isArray(v)) throw new ContentError(400, "Invalid list of videos.");
    if (v.length > 30) throw new ContentError(400, "Up to 30 videos can be added.");
    const seen = new Set();
    return v.map((x) => {
      const item = youtubeItem(x);
      if (seen.has(item.id)) throw new ContentError(409, "That video is already in the list.");
      seen.add(item.id);
      const { type, ...rest } = item;
      return rest;
    });
  },
  /** YouTube videos and Instagram posts together (phase 1 on Netlify + Supabase). */
  videos(v) {
    if (!Array.isArray(v)) throw new ContentError(400, "Invalid list of videos.");
    if (v.length > 40) throw new ContentError(400, "Up to 40 videos can be added.");
    const seen = new Set();
    return v.map((x) => {
      let item;
      if (x?.type === "instagram" || /instagram\.com/.test(String(x?.url || ""))) {
        const ig = instagramUrl(x?.url);
        if (!ig) throw new ContentError(400, "Paste a link to an Instagram post or reel, e.g. https://www.instagram.com/reel/ABC123/");
        item = { type: "instagram", url: ig.url, kind: ig.kind, title: cleanText(x?.title, 140), pages: pagesOf(x), visible: x?.visible !== false };
      } else item = youtubeItem(x);
      const key = item.id || item.url;
      if (seen.has(key)) throw new ContentError(409, "That video is already in the list.");
      seen.add(key);
      return item;
    });
  },
  /** Launch phase: features and articles the website leaves out for now (super admin only). */
  launch(v, { features = [], articleIds = [] } = {}) {
    const hidden = [...new Set((Array.isArray(v?.hidden) ? v.hidden : []).filter((k) => features.includes(k)))];
    const ids = new Set(articleIds);
    const hiddenArticles = [...new Set((Array.isArray(v?.hiddenArticles) ? v.hiddenArticles : []).map(Number).filter((n) => ids.has(n)))].sort((a, b) => a - b);
    if (ids.size && hiddenArticles.length >= ids.size) throw new ContentError(400, "At least one article must stay on the website.");
    return { hidden, hiddenArticles };
  },
};

/** What the public pages need. Only areas the clinic has changed are sent; the pages keep their built-in content otherwise. */
export function publicView(areas, { today, instagram = [], announcementId = (a) => `${a.text}|${a.start}|${a.end}` } = {}) {
  const a = areas.announcement;
  const live = a?.enabled && a.text && (!a.start || a.start <= today) && (!a.end || a.end >= today);
  const out = {
    announcement: live ? { text: a.text, textHi: a.textHi, link: a.link, linkText: a.linkText, tone: a.tone, id: announcementId(a) } : null,
    hours: areas.hours || null,
    contact: areas.contact || null,
    faq: areas.faq?.filter((x) => x.visible).map(({ q, a: ans }) => ({ q, a: ans })) ?? null,
    press: areas.press?.filter((x) => x.visible) ?? null,
    videos: {},
  };
  const all = areas.videos || [...(areas.youtube || []).map((v) => ({ type: "youtube", ...v })),
    ...instagram.map((m) => ({ type: "instagram", url: m.url, kind: m.kind, title: m.caption || m.title || "", pages: Array.isArray(m.pages) ? m.pages : String(m.pages || "treatment").split(","), visible: m.visible !== false }))];
  for (const p of Object.keys(PAGES)) {
    out.videos[p] = all.filter((v) => v.visible !== false && v.pages.includes(p))
      // The Treatment page has its own Instagram section, so its Instagram posts aren't repeated in Videos.
      .filter((v) => !(v.type === "instagram" && p === "treatment"))
      .map((v) => (v.type === "youtube" ? { type: "youtube", id: v.id, title: v.title, short: v.short } : { type: "instagram", url: v.url, kind: v.kind, title: v.title }));
  }
  return out;
}

/** The FAQ as the built FAQ page shows it (links kept as [text](/address)), to start the dashboard's editor from. */
export function faqFromHtml(html) {
  const plain = (x) => x.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)").replace(/<\/p>\s*<p[^>]*>/g, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ").trim();
  return [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ q: plain(m[1]), a: plain(m[2]), visible: true }));
}
