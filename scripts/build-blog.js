// Builds the static blog from content/blog/*.md into public/blog/.
// Run with `npm run build:blog` after adding or editing an article, then commit the output.
// Articles are Markdown with a small front-matter block (title, slug, date, summary, tags, readMinutes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { animFigure, siteFooter, SITE } from "./partials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "content/blog");
const OUT = path.join(root, "public/blog");
const WA = "https://wa.me/919886688323?text=Hi%20Dr%20Rajveer%2C%20got%20your%20details%20from%20your%20website.%20I%20would%20like%20to%20book%20an%20appointment.";

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
  meta.readMinutes = Number(meta.readMinutes) || 3;
  for (const k of ["title", "slug", "date", "summary"]) if (!meta[k]) throw new Error(`Front matter needs "${k}"`);
  if (!/^[a-z0-9-]+$/.test(meta.slug)) throw new Error(`Bad slug "${meta.slug}"`);
  return { meta, body: src.replace(/\r\n/g, "\n").slice(m[0].length) };
}

// Inline Markdown: escape first, then **bold** and [links](url). Only http(s), root-relative and mailto links are allowed.
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
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
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
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
  <header class="header" id="header">
    <div class="container header__inner">
      <a href="/" class="brand" aria-label="Tailbone Treatment home">
        <img src="/assets/img/logo.svg" alt="" width="40" height="40">
        <span class="brand__text"><strong>TAILBONE</strong><small>TREATMENT.com</small></span>
      </a>
      <nav class="nav" id="nav" aria-label="Main">
        <a href="/coccydynia">Tailbone pain</a>
        <a href="/treatment">Treatment</a>
        <a href="/doctor">Doctor</a>
        ${blogActive ? '<a href="/blog/" class="is-active" aria-current="page">Blog</a>' : '<a href="/blog/">Blog</a>'}
        <a href="/locations">Clinics</a>
        <a href="/manage.html" class="nav__mobile-only">My appointments</a>
        <a href="/book" class="btn btn--primary nav__cta">Book appointment</a>
      </nav>
      <div class="header__actions">
        <button type="button" class="icon-btn" id="themeToggle" aria-label="Toggle dark mode" title="Toggle theme">
          <svg class="i-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="i-moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
        <button type="button" class="icon-btn burger" id="burger" aria-label="Open menu" aria-expanded="false" aria-controls="nav">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
  </header>

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
</body>
</html>
`;
}

const tagsHtml = (tags) => (tags.length ? `<ul class="post-tags">${tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "");
const metaLine = (m) => `<time datetime="${m.date}">${prettyDate(m.date)}</time> · ${m.readMinutes} min read`;

const publisher = { "@type": "MedicalClinic", name: "Tailbone Treatment Clinic", url: `${SITE}/`, logo: `${SITE}/assets/img/logo.svg` };

function articlePage(post, others) {
  const { meta } = post;
  const url = `${SITE}/blog/${meta.slug}.html`;
  const more = others.slice(0, 2).map((o) => `<li><a href="/blog/${o.meta.slug}.html">${esc(o.meta.title)}</a></li>`).join("");
  const body = `      <article class="post narrow">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog/">Blog</a></nav>
        ${tagsHtml(meta.tags)}
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
    },
    body,
    image: meta.image ? `${SITE}${meta.image}` : undefined,
  });
}

function indexPage(posts) {
  const cards = posts.map(({ meta }) => `        <li class="post-card">
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
      <ul class="post-grid">
${cards}
      </ul>`;
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

export function loadPosts(dir = SRC) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    return { meta, body, html: markdown(body).replace(/^/gm, "          ") };
  }).sort((a, b) => b.meta.date.localeCompare(a.meta.date));
}

export function build() {
  const posts = loadPosts();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const p of posts) fs.writeFileSync(path.join(OUT, `${p.meta.slug}.html`), articlePage(p, posts.filter((o) => o !== p)));
  fs.writeFileSync(path.join(OUT, "index.html"), indexPage(posts));

  return posts;
}
