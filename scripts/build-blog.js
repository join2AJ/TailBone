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

export function markdown(md) {
  const out = [];
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
    if ((m = /^!\[([^\]]*)\]\((\/[^)\s]+)(?:\s+"(\d+)x(\d+)")?\)$/.exec(line.trim()))) {
      flushPara(); flushList();
      const size = m[3] ? ` width="${m[3]}" height="${m[4]}"` : "";
      out.push(`<figure class="post-figure"><img src="${esc(m[2])}" alt="${esc(m[1])}"${size} loading="lazy" decoding="async"></figure>`);
      continue;
    }
    if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      const level = m[1].length;
      const id = "s-" + m[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

export function page({ title, description, canonical, type = "website", jsonLd, body, image = `${SITE}/assets/img/og-image.png`, blogActive = true }) {
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

  <div class="mbar">
    <a href="tel:+919886688323">📞&nbsp;Call</a>
    <a href="${WA}" target="_blank" rel="noopener">💬 WhatsApp</a>
    <a href="/book" class="mbar__primary">Book</a>
  </div>

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

/** The two other articles sharing the most tags with this one (newest first on ties). */
function related(post, others) {
  const shared = (o) => o.meta.tags.filter((t) => post.meta.tags.includes(t)).length;
  return [...others].sort((a, b) => shared(b) - shared(a) || b.meta.date.localeCompare(a.meta.date)).slice(0, 2);
}

/** Plain text of an article for the search box (no Markdown, figures or reference list). */
const plainText = (body) => body
  .replace(/^## Sources[\s\S]*$/m, "").replace(/^::anim .*$/gm, "").replace(/^Table:\s*/gm, "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[*#>|`_]+/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ").trim();
const metaLine = (m) => `<time datetime="${m.date}">${prettyDate(m.date)}</time> · ${m.readMinutes} min read`;

const publisher = { "@type": "MedicalClinic", name: "Tailbone Treatment Clinic", url: `${SITE}/`, logo: `${SITE}/assets/img/logo.svg` };

function articlePage(post, others) {
  const { meta } = post;
  const url = `${SITE}/blog/${meta.slug}.html`;
  const more = related(post, others).map((o) => `<li><a href="/blog/${o.meta.slug}.html">${esc(o.meta.title)}</a></li>`).join("");
  const body = `      <article class="post narrow" data-post-id="${meta.id}">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog/">Blog</a></nav>
        ${tagsHtml(meta.tags, true)}
        <h1>${esc(meta.title)}</h1>
        <p class="post-lede">${esc(meta.summary)}</p>
        <p class="post-meta muted small">By ${esc(meta.author || "Tailbone Treatment Clinic")} · ${metaLine(meta)}${meta.originalUrl ? " · first published on tailbonetreatment.com" : ""}</p>
        ${meta.image ? `<figure class="post-cover"><img src="${esc(meta.image)}" alt="" loading="eager" decoding="async"></figure>` : ""}
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
        ${more ? `<h2 class="subhead">Keep reading</h2><ul class="post-more">${more}</ul>` : ""}
      </article>`;
  return page({
    title: `${meta.title} | Tailbone Treatment`.length <= 70 ? `${meta.title} | Tailbone Treatment` : meta.title,
    description: meta.summary,
    canonical: url,
    type: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: meta.title,
      description: meta.summary,
      datePublished: meta.date,
      dateModified: meta.updated || meta.date,
      mainEntityOfPage: url,
      image: meta.image ? `${SITE}${meta.image}` : `${SITE}/assets/img/og-image.png`,
      author: meta.author ? { "@type": "Person", name: meta.author, ...(meta.author.includes("Rajveer") ? { "@id": `${SITE}/doctor#rajveer-singh`, url: `${SITE}/doctor` } : {}) }
        : { "@type": "Organization", name: "Tailbone Treatment Clinic", url: `${SITE}/` },
      publisher,
      keywords: meta.tags.join(", "),
      about: { "@type": "MedicalCondition", name: "Coccydynia", alternateName: ["Tailbone pain", "Coccyx pain"], "@id": `${SITE}/coccydynia#condition` },
      ...(post.sources.length ? { citation: post.sources } : {}),
    },
    body,
    image: meta.image ? `${SITE}${meta.image}` : undefined,
  });
}

function indexPage(posts) {
  const cards = posts.map(({ meta }) => `        <li class="post-card" data-post-id="${meta.id}" data-tags="${esc(meta.tags.join("|"))}">
          ${tagsHtml(meta.tags)}
          <h2><a href="/blog/${meta.slug}.html">${esc(meta.title)}</a></h2>
          <p>${esc(meta.summary)}</p>
          <p class="muted small">${metaLine(meta)}</p>
        </li>`).join("\n");
  const body = `      <div class="section__head">
        <span class="eyebrow">Blog</span>
        <h1>Tailbone pain, explained</h1>
        <p class="muted">Practical advice on coccydynia from our clinic: sitting, pregnancy, warning signs and what treatment involves. Checked against trusted sources such as the NHS and Cleveland Clinic.</p>
      </div>
      <form class="blog-search" id="blogSearch" role="search" action="/blog/" method="get">
        <label for="blogQ" class="visually-hidden">Search articles</label>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="blogQ" name="q" placeholder="Search articles, e.g. pregnancy, sitting, cushion" autocomplete="off" enterkeyhint="search">
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
    if (seen.has(p.meta.id)) throw new Error(`Article id ${p.meta.id} is used by both "${seen.get(p.meta.id)}" and "${p.meta.slug}"`);
    seen.set(p.meta.id, p.meta.slug);
  }
  return posts;
}

export function build() {
  const posts = checkIds(loadPosts());
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const p of posts) fs.writeFileSync(path.join(OUT, `${p.meta.slug}.html`), articlePage(p, posts.filter((o) => o !== p)));
  fs.writeFileSync(path.join(OUT, "index.html"), indexPage(posts));
  // Search index for the blog's search box; the server also reads it to list articles in the dashboard.
  fs.writeFileSync(path.join(OUT, "search.json"), JSON.stringify(posts.map(({ meta, body }) => ({
    id: meta.id, slug: meta.slug, title: meta.title, summary: meta.summary, tags: meta.tags, date: meta.date, text: plainText(body),
  }))));

  return posts;
}
