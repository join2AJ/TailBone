// Builds the static blog from content/blog/*.md into public/blog/.
// Run with `npm run build:blog` after adding or editing an article, then commit the output.
// Articles are Markdown with a small front-matter block (id, title, slug, date, summary, tags, readMinutes).
// `id` is the article's permanent number (its primary key in the database, used when the admin hides an article):
// give a new article the next unused number and never reuse or change one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { animFigure, siteFooter, siteHeader, SITE } from "./partials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "content/blog");
const OUT = path.join(root, "public/blog");
const WA = "https://wa.me/919886688323?text=Hi%20Dr%20Rajveer%2C%20got%20your%20details%20from%20your%20website.%20I%20would%20like%20to%20book%20an%20appointment.";

// Tags an article may use, so the same topic is always spelled the same way (and filters on /blog/ stay tidy).
export const TAGS = [
  "Causes", "Symptoms", "Diagnosis", "Treatment", "Self-care", "Sitting", "Pregnancy", "Women's health", "Injury",
  "Work and lifestyle", "Chronic pain", "Mental health", "Red flags", "Related conditions", "Anatomy", "Research", "History", "Your visit",
];

// Article pictures: the cover photo if the article has one, otherwise an illustration in the colour and icon of its
// main topic (the first tag other than "Research"). Written to public/blog/art/ by the build.
const TAG_ART = {
  Causes: ["#c2410c", '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'],
  Symptoms: ["#be123c", '<path d="M2 12h4l3-7 4 14 3-7h6"/>'],
  Diagnosis: ["#4338ca", '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'],
  Treatment: ["#15803d", '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>'],
  "Self-care": ["#0f766e", '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>'],
  Sitting: ["#0e7490", '<path d="M7 3v9h10V3M5 12h14l-1 4H6zM8 16v5M16 16v5"/>'],
  Pregnancy: ["#b5477a", '<circle cx="9" cy="6" r="3"/><path d="M4 21c0-5 2-9 5-9s4 2 4 4"/><circle cx="16" cy="15" r="3"/>'],
  "Women's health": ["#9333ea", '<circle cx="12" cy="9" r="5"/><path d="M12 14v8M9 19h6"/>'],
  Injury: ["#b91c1c", '<path d="M4 15 15 4a3 3 0 0 1 4 4L8 19a3 3 0 0 1-4-4z"/><path d="m10 10 4 4"/>'],
  "Work and lifestyle": ["#0369a1", '<path d="M4 5h16v11H4zM2 19h20"/>'],
  "Chronic pain": ["#a16207", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  "Mental health": ["#6d28d9", '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 3 5h2zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-3 5h-2z"/>'],
  "Red flags": ["#b91c1c", '<path d="M12 3 22 21H2z"/><path d="M12 10v5M12 18v.01"/>'],
  "Related conditions": ["#0e7490", '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8 7l7.5 1M7 8l2 8M16 10l-4.5 6"/>'],
  Anatomy: ["#1d4ed8", '<path d="M10 2h4v3h-4zM9 7h6v3H9zM9.5 12h5v3h-5zM10.5 17h3L12 22z"/>'],
  Research: ["#1e6091", '<path d="M4 20V11M10 20V4M16 20v-7M2 20h20"/>'],
  History: ["#92400e", '<path d="M6 3h12M6 21h12M7 3c0 5 10 7 10 9s-10 4-10 9M17 3c0 5-10 7-10 9s10 4 10 9"/>'],
  "Your visit": ["#047857", '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>'],
};
// Articles whose topic deserves its own picture rather than their tag's.
const SLUG_ART = {
  "coccydynia-facts-and-figures": ["#1e6091", '<path d="M4 20V11M10 20V4M16 20v-7M2 20h20"/>'],
  "body-weight-and-tailbone-pain": ["#0f766e", '<path d="M5 6h14l-2 14H7z"/><path d="M9 6a3 3 0 0 1 6 0M12 11v3"/>'],
  "two-wheeler-riding-and-tailbone-pain": ["#c2410c", '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h5l4.5 7.5M9 9 7.5 6H5M14 9l1.5-3H18"/>'],
  "amusement-park-rides-and-tailbone-injury": ["#db2777", '<path d="M2 20c3-12 6-12 8-6s5 6 7-2 4-6 5-4"/><path d="M2 20h20"/>'],
  "kegel-exercises-and-tailbone-pain": ["#9333ea", '<circle cx="12" cy="12" r="3"/><path d="M3 12h4M21 12h-4M12 3v4M12 21v-4M5 5l3 3M19 19l-3-3M19 5l-3 3M5 19l3-3"/>'],
  "tailbone-bone-setting-risks": ["#b91c1c", '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 3 13.5V11a1.5 1.5 0 0 1 3 0v3"/>'],
  "coccydynia-treatment-ladder": ["#15803d", '<path d="M3 21h4v-4h4v-4h4V9h4V5h2"/>'],
  "tailbone-subluxation-inward-or-outward": ["#1d4ed8", '<path d="M10 2h4v3h-4zM9 7h6v3H9zM9.5 12h5v3h-5z"/><path d="M12 17c0 2-1 3-3 4M15 19l3 1"/>'],
  "coccyx-shapes-and-movement": ["#4338ca", '<path d="M10 2h4v3h-4zM9 7h6v3H9zM9.5 12h5v3h-5zM10.5 17h3L12 22z"/>'],
};
const mainTag = (meta) => meta.tags.find((t) => t !== "Research" && TAG_ART[t]) || meta.tags[0] || "Treatment";

export function artSvg(meta) {
  const [color, icon] = SLUG_ART[meta.slug] || TAG_ART[mainTag(meta)] || TAG_ART.Treatment;
  const seed = [...meta.slug].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 7);
  const dots = Array.from({ length: 9 }, (_, i) => `<circle cx="${420 + (i % 3) * 46 + (seed % 17)}" cy="${70 + Math.floor(i / 3) * 46 + (seed % 11)}" r="${4 + ((seed + i) % 4)}" fill="#fff" opacity=".${2 + ((seed + i) % 3)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" width="600" height="340" role="img" aria-label="">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".72"/></linearGradient></defs>
  <rect width="600" height="340" fill="url(#g)"/>
  <circle cx="${510 + (seed % 40)}" cy="${290 - (seed % 30)}" r="150" fill="#fff" opacity=".08"/>
  <circle cx="${60 + (seed % 50)}" cy="${30 + (seed % 25)}" r="90" fill="#fff" opacity=".06"/>
  ${dots}
  <path d="M150 300c40-60 40-120 10-200" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round" opacity=".35"/>
  <circle cx="200" cy="170" r="92" fill="#fff" opacity=".95"/>
  <g transform="translate(140 110) scale(5)" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
</svg>
`;
}

/**
 * The picture shown for an article on cards: { src, width, height }. Always the topic illustration, so cards look
 * consistent (the old site's cover photos are banners with text baked in, which cropping cuts off); covers still
 * appear at the top of their articles.
 */
// Articles written in the dashboard (meta.path set) live under /blog/a/ and their picture comes from the server.
export const postArt = (meta) => ({ src: meta.cover || (meta.path ? `${meta.path}.svg` : `/blog/art/${meta.slug}.svg`), width: 600, height: 340 });
const postPath = (meta) => meta.path || `/blog/${meta.slug}.html`;

/** A small linked card (picture + title), used for "Keep reading" and the Tailbone pain page's "Go deeper". */
export function miniCard(meta) {
  const art = postArt(meta);
  return `<li><a class="mini-card" href="${esc(postPath(meta))}"><img src="${esc(art.src)}" alt="" width="${art.width}" height="${art.height}" loading="lazy" decoding="async"><span class="mini-card__body"><small>${esc(mainTag(meta))}</small><strong>${esc(meta.title)}</strong></span></a></li>`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Missing front matter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  meta.tags = (meta.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  for (const t of meta.tags) if (!TAGS.includes(t)) throw new Error(`Unknown tag "${t}" (allowed: ${TAGS.join(", ")})`);
  if (!/^[1-9]\d*$/.test(meta.id || "")) throw new Error(`Front matter needs "id" (a whole number, unique to this article)`);
  meta.id = Number(meta.id);
  meta.readMinutes = Number(meta.readMinutes) || 3;
  for (const k of ["title", "slug", "date", "summary"]) if (!meta[k]) throw new Error(`Front matter needs "${k}"`);
  if (!/^[a-z0-9-]+$/.test(meta.slug)) throw new Error(`Bad slug "${meta.slug}"`);
  return { meta, body: src.replace(/\r\n/g, "\n").slice(m[0].length) };
}

// Inline Markdown: escape first, then **bold**, *italic* and [links](url). Only http(s), root-relative and mailto links are allowed.
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
      const url = href.replace(/&amp;/g, "&");
      if (!/^(https?:\/\/|\/|mailto:)/.test(url)) return label;
      const ext = /^https?:\/\//.test(url) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${esc(url)}"${ext}>${label}</a>`;
    });
}

/** Width and height of a JPEG or PNG in public/ (so images reserve their space and the page doesn't jump). */
export function imageSize(webPath) {
  try {
    const b = fs.readFileSync(path.join(root, "public", webPath));
    if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch { /* missing or unreadable: no size */ }
  return null;
}

/**
 * A video or audio player. Videos: YouTube, Vimeo or an Instagram reel (embedded), or a file uploaded in the dashboard
 * (/media/blog/…). Audio: an uploaded file. Anything else becomes a plain link, so an article never embeds an unknown site.
 */
export function mediaFigure(kind, url, caption = "") {
  const cap = caption ? `<figcaption>${inline(caption)}</figcaption>` : "";
  const own = /^\/media\/blog\/[a-f0-9]{24}$/.test(url);
  if (kind === "audio") {
    return own ? `<figure class="post-media post-media--audio"><audio controls preload="none" src="${esc(url)}"></audio>${cap}</figure>`
      : `<p><a href="${esc(url)}" target="_blank" rel="noopener">Listen: ${esc(caption || url)}</a></p>`;
  }
  if (own) return `<figure class="post-media"><video controls preload="metadata" playsinline src="${esc(url)}"></video>${cap}</figure>`;
  let m;
  let src = "";
  if ((m = /^https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/|embed\/)([\w-]{6,20})/.exec(url) || /^https:\/\/youtu\.be\/([\w-]{6,20})/.exec(url))) src = `https://www.youtube-nocookie.com/embed/${m[1]}`;
  else if ((m = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{5,12})/.exec(url))) src = `https://player.vimeo.com/video/${m[1]}`;
  else if ((m = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels)\/([\w-]{5,40})/.exec(url))) src = `https://www.instagram.com/reel/${m[1]}/embed`;
  if (!src) return /^https?:\/\//.test(url) ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Watch: ${esc(caption || url)}</a></p>` : "";
  const tall = src.includes("instagram.com");
  return `<figure class="post-media${tall ? " post-media--tall" : ""}"><div class="post-media__frame"><iframe src="${esc(src)}" title="${esc(caption || "Video")}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${cap}</figure>`;
}

export function markdown(md) {
  const out = [];
  const usedIds = new Set();
  const lines = md.split("\n");
  let para = [];
  let list = null; // { tag, items }
  let table = null; // rows of cells; a line "Table: caption" right after a table becomes its caption
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const flushTable = (caption = "") => {
    if (!table) return;
    const [head, , ...rows] = table;
    const label = caption || cells(head).join(", ");
    out.push(`<div class="table-wrap" role="region" aria-label="${esc(label)}" tabindex="0"><table>${caption ? `<caption>${inline(caption)}</caption>` : ""}`
      + `<thead><tr>${cells(head).map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((r) => `<tr>${cells(r).map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`);
    table = null;
  };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^\|.*\|$/.test(line.trim())) { flushPara(); flushList(); (table ||= []).push(line); continue; }
    if (table) { if ((m = /^Table:\s*(.+)$/.exec(line.trim()))) { flushTable(m[1]); continue; } flushTable(); }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^::anim\s+([\w-]+)$/.exec(line.trim()))) { flushPara(); flushList(); out.push(animFigure(m[1])); continue; }
    if ((m = /^::(video|audio)\s+(\S+)(?:\s+"([^"]*)")?$/.exec(line.trim()))) { flushPara(); flushList(); out.push(mediaFigure(m[1], m[2], m[3] || "")); continue; }
    if ((m = /^!\[([^\]]*)\]\((\/[^)\s]+)(?:\s+"(\d+)x(\d+)")?\)$/.exec(line.trim()))) {
      flushPara(); flushList();
      const size = m[3] ? ` width="${m[3]}" height="${m[4]}"` : "";
      out.push(`<figure class="post-figure"><img src="${esc(m[2])}" alt="${esc(m[1])}"${size} loading="lazy" decoding="async"></figure>`);
      continue;
    }
    if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      const level = m[1].length;
      let id = "s-" + m[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      for (let n = 2; usedIds.has(id); n++) id = id.replace(/-\d+$/, "") + `-${n}`;
      usedIds.add(id);
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
    } else if ((m = /^[-*]\s+(.*)$/.exec(line)) || (m = /^\d+\.\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = /^\d/.test(line) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[1]);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara(); flushList();
      out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
    } else if (list && /^\s+/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  flushTable();
  return out.join("\n");
}

const prettyDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function page({ title, description, canonical, type = "website", jsonLd, body, image = `${SITE}/assets/img/og-image.jpg`, blogActive = true }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#0b3d2e">
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="icon" href="/assets/img/logo.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/sora-latin.woff2" as="font" type="font/woff2" crossorigin>
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Tailbone Treatment Clinic: sit down again without the pain. New Delhi and online.">
  <meta property="og:site_name" content="Tailbone Treatment Clinic">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/assets/css/fonts.css">
  <link rel="stylesheet" href="/assets/css/styles.css">
  <script src="/assets/js/theme.js"></script>
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  ${siteHeader(blogActive ? "/blog/" : null)}

  <main id="main" class="section blog">
    <div class="container">
${body}
    </div>
  </main>

  ${siteFooter()}

  <nav class="mbar" aria-label="Quick actions">
    <a href="tel:+919886688323">📞&nbsp;Call</a>
    <a href="${WA}" target="_blank" rel="noopener">💬 WhatsApp</a>
    <a href="/book" class="mbar__primary">Book</a>
  </nav>

  <script src="/assets/js/site-nav.js" defer></script>
  <script src="/assets/js/anim.js" defer></script>
  <script src="/assets/js/consent.js" defer></script>
  <script src="/assets/js/blog.js" defer></script>
</body>
</html>
`;
}

const tagUrl = (t) => `/blog/?tag=${encodeURIComponent(t)}`;
const tagsHtml = (tags, link = false) => (tags.length
  ? `<ul class="post-tags">${tags.map((t) => `<li>${link ? `<a href="${esc(tagUrl(t))}">${esc(t)}</a>` : esc(t)}</li>`).join("")}</ul>` : "");

/** The other articles sharing the most tags with this one (newest first on ties). */
function related(post, others, n = 3) {
  const shared = (o) => o.meta.tags.filter((t) => post.meta.tags.includes(t)).length;
  return [...others].sort((a, b) => shared(b) - shared(a) || b.meta.date.localeCompare(a.meta.date)).slice(0, n);
}

/** Plain text of an article for the search box (no Markdown, figures or reference list). */
const plainText = (body) => body
  .replace(/^## Sources[\s\S]*$/m, "").replace(/^::anim .*$/gm, "").replace(/^Table:\s*/gm, "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*#>|`_]+/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim();
const metaLine = (m) => `<time datetime="${m.date}">${prettyDate(m.date)}</time> · ${m.readMinutes} min read`;

const publisher = { "@type": "MedicalClinic", name: "Tailbone Treatment Clinic", url: `${SITE}/`, logo: `${SITE}/assets/img/icon-512.png` };

export function articlePage(post, others) {
  const { meta } = post;
  const url = `${SITE}${postPath(meta)}`;
  // "On this page" list for longer articles (the article's own section headings).
  const heads = [...post.html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].filter((h) => !/^(Key points|Sources)$/.test(h[2]));
  const toc = heads.length >= 4 ? `<nav class="post-toc" aria-labelledby="toc-${meta.id}">
          <h2 class="post-toc__title" id="toc-${meta.id}">On this page</h2>
          <ol>${heads.map((h) => `<li><a href="#${h[1]}">${h[2]}</a></li>`).join("")}</ol>
        </nav>` : "";
  const shareText = encodeURIComponent(`${meta.title} ${url}`);
  const share = `<div class="post-share" role="group" aria-label="Share this article">
          <a class="post-share__btn post-share__wa" href="https://wa.me/?text=${shareText}" target="_blank" rel="noopener">Share on WhatsApp</a>
          <button type="button" class="post-share__btn" data-share="${esc(url)}" data-title="${esc(meta.title)}">Copy link</button>
        </div>`;
  const cover = meta.image ? imageSize(meta.image) : null;
  const more = related(post, others, 3).map((o) => miniCard(o.meta)).join("");
  const body = `      <article class="post narrow" data-post-id="${meta.id}">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog/">Blog</a></nav>
        ${tagsHtml(meta.tags, true)}
        <h1>${esc(meta.title)}</h1>
        <p class="post-lede">${esc(meta.summary)}</p>
        <p class="post-meta muted small">By ${esc(meta.author || "Tailbone Treatment Clinic")} · ${metaLine(meta)}${meta.originalUrl ? " · first published on tailbonetreatment.com" : ""}</p>
        ${share}
        ${meta.image ? `<figure class="post-cover"><img src="${esc(meta.image)}" alt=""${cover ? ` width="${cover.width}" height="${cover.height}"` : ""} fetchpriority="high" decoding="async"></figure>` : ""}
        ${toc}
        <div class="post-body">
${post.html}
        </div>
        <aside class="post-note" aria-label="Medical disclaimer">
          <strong>Please note:</strong> this article is general information, not a diagnosis or a substitute for a consultation. If you have any of the <a href="/blog/tailbone-pain-red-flags.html">red-flag symptoms</a>, see a doctor promptly.
        </aside>
        <div class="post-cta">
          <div>
            <h2>Still sore when you sit?</h2>
            <p>Dr Rajveer Singh treats tailbone pain without surgery, in New Delhi and online.</p>
          </div>
          <div class="post-cta__actions">
            <a href="/book" class="btn btn--primary">Book appointment</a>
            <a href="${WA}" class="btn btn--wa" target="_blank" rel="noopener">WhatsApp us</a>
          </div>
        </div>
      </article>
      ${more ? `<section class="post-related narrow" aria-labelledby="moreTitle">
        <h2 class="subhead" id="moreTitle">Keep reading</h2>
        <ul class="mini-grid">${more}</ul>
      </section>` : ""}`;
  return page({
    title: `${meta.title} | Tailbone Treatment`.length <= 70 ? `${meta.title} | Tailbone Treatment` : meta.title,
    description: meta.summary,
    canonical: url,
    type: "article",
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "Article",
      headline: meta.title,
      description: meta.summary,
      datePublished: meta.date,
      dateModified: meta.updated || meta.date,
      mainEntityOfPage: url,
      image: meta.image ? `${SITE}${meta.image}` : `${SITE}/assets/img/og-image.jpg`,
      author: meta.author ? { "@type": "Person", name: meta.author, ...(meta.author.includes("Rajveer") ? { "@id": `${SITE}/doctor#rajveer-singh`, url: `${SITE}/doctor` } : {}) }
        : { "@type": "Organization", name: "Tailbone Treatment Clinic", url: `${SITE}/` },
      publisher,
      keywords: meta.tags.join(", "),
      about: { "@type": "MedicalCondition", name: "Coccydynia", alternateName: ["Tailbone pain", "Coccyx pain"], "@id": `${SITE}/coccydynia#condition` },
      ...(post.sources.length ? { citation: post.sources } : {}),
    }, {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog/` },
        { "@type": "ListItem", position: 3, name: meta.title, item: url },
      ],
    }],
    body,
    image: meta.image ? `${SITE}${meta.image}` : undefined,
  });
}

function indexPage(posts) {
  const cards = posts.map(({ meta }) => {
    const art = postArt(meta);
    return `        <li class="post-card" data-post-id="${meta.id}" data-tags="${esc(meta.tags.join("|"))}">
          <img class="post-card__img" src="${esc(art.src)}" alt="" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">
          <div class="post-card__body">
            ${tagsHtml(meta.tags.slice(0, 2))}
            <h2><a href="${esc(postPath(meta))}">${esc(meta.title)}</a></h2>
            <p class="muted small">${metaLine(meta)}</p>
          </div>
        </li>`;
  }).join("\n");
  const body = `      <div class="section__head">
        <span class="eyebrow">Blog</span>
        <h1>Tailbone pain, explained</h1>
        <p class="muted">Practical advice on coccydynia from our clinic: sitting, pregnancy, warning signs and what treatment involves. Checked against trusted sources such as the NHS and Cleveland Clinic.</p>
      </div>
      <form class="blog-search" id="blogSearch" role="search" action="/blog/" method="get">
        <label for="blogQ" class="visually-hidden">Search articles</label>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="blogQ" name="q" placeholder="Search articles, e.g. pregnancy, sitting, cushion" autocomplete="off" enterkeyhint="search">
        <button type="submit" class="visually-hidden">Search</button>
      </form>
      <div class="blog-tags" role="group" aria-label="Filter by topic">
        <button type="button" class="chip is-active" data-tag="" aria-pressed="true">All</button>
${tagsInUse(posts).map((t) => `        <button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("\n")}
      </div>
      <p class="muted small blog-count" id="blogCount" role="status" aria-live="polite">${posts.length} articles</p>
      <ul class="post-grid" id="postGrid">
${cards}
      </ul>
      <div class="empty blog-empty" id="blogEmpty" hidden>
        <p><strong>No articles match your search.</strong></p>
        <p class="muted">Try a different word, or <button type="button" class="linkish" id="blogReset">show all articles</button>. You can also ask Dr Rajveer directly on <a href="${WA}" target="_blank" rel="noopener">WhatsApp</a>.</p>
      </div>`;
  return page({
    title: "Blog | Tailbone Treatment Clinic",
    description: "Practical, trustworthy articles on tailbone (coccyx) pain: sitting, pregnancy, red flags and treatment.",
    canonical: `${SITE}/blog/`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: "Tailbone Treatment Blog",
      url: `${SITE}/blog/`,
      publisher,
      blogPost: posts.map(({ meta }) => ({ "@type": "BlogPosting", headline: meta.title, url: `${SITE}/blog/${meta.slug}.html`, datePublished: meta.date })),
    },
    body,
  });
}

/** Tags used by at least one article, in the order of TAGS. */
const tagsInUse = (posts) => TAGS.filter((t) => posts.some((p) => p.meta.tags.includes(t)));

export function loadPosts(dir = SRC) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    // Links listed under "## Sources" are also published as the article's citations (structured data).
    const srcBlock = (/^## Sources\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(body) || [, ""])[1];
    const sources = [...srcBlock.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((x) => x[1]);
    return { meta, body, sources, html: markdown(body).replace(/^/gm, "          ") };
  }).sort((a, b) => b.meta.date.localeCompare(a.meta.date) || b.meta.id - a.meta.id);
}

/** Article numbers must be unique: they are the primary key the admin's show/hide switch is stored against. */
export function checkIds(posts) {
  const seen = new Map();
  for (const p of posts) {
    // 1001 and up are kept for articles written in the dashboard.
    if (p.meta.id > 1000) throw new Error(`Article "${p.meta.slug}" has id ${p.meta.id}: file articles use 1 to 1000 (1001+ are dashboard articles)`);
    if (seen.has(p.meta.id)) throw new Error(`Article id ${p.meta.id} is used by both "${seen.get(p.meta.id)}" and "${p.meta.slug}"`);
    seen.set(p.meta.id, p.meta.slug);
  }
  return posts;
}

export function build() {
  const posts = checkIds(loadPosts());
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, "art"), { recursive: true });
  for (const p of posts) {
    fs.writeFileSync(path.join(OUT, `${p.meta.slug}.html`), articlePage(p, posts.filter((o) => o !== p)));
    fs.writeFileSync(path.join(OUT, "art", `${p.meta.slug}.svg`), artSvg(p.meta));
  }
  fs.writeFileSync(path.join(OUT, "index.html"), indexPage(posts));
  // Search index for the blog's search box; the server also reads it to list articles in the dashboard.
  fs.writeFileSync(path.join(OUT, "search.json"), JSON.stringify(posts.map(({ meta, body }) => ({
    id: meta.id, slug: meta.slug, title: meta.title, summary: meta.summary, tags: meta.tags, date: meta.date, text: plainText(body),
  }))));

  return posts;
}
