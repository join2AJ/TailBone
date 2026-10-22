// One command for every generated file: `npm run build`.
// Pages from content/site.html, the shared footer on standalone pages, the blog, the sitemap,
// and the plain-text summaries for AI assistants (llms.txt).
import fs from "node:fs";
import path from "node:path";
import { root, SITE, siteFooter, siteHeader, versionHtml } from "./partials.js";
import { buildPages } from "./build-pages.js";
import { build as buildBlog, page as blogPage } from "./build-blog.js";
import { writeRobots, writeLlms } from "./build-ai.js";
import { buildPress } from "./build-press.js";

const STANDALONE = ["manage.html", "policies.html", "privacy.html", "stories.html", "press.html", "refer.html", "partner.html", "home-visit.html"];
// Pages outside the template that get the shared header (menu) and the nav link to mark as current.
const HEADERS = { "manage.html": "/manage.html", "policies.html": null, "privacy.html": null, "stories.html": null, "checkin.html": null, "refer.html": null, "partner.html": null, "home-visit.html": null };

export function syncFooters() {
  for (const [f, active] of Object.entries(HEADERS)) {
    const file = path.join(root, "public", f);
    if (!fs.existsSync(file)) continue;
    let html = fs.readFileSync(file, "utf8").replace(/<header class="(?:header|mini-header)[^"]*"[^>]*>[\s\S]*?<\/header>/, siteHeader(active))
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITE}/${f}">`);
    // The menu button and theme toggle need the shared header script.
    if (!html.includes("site-nav.js")) html = html.replace("</body>", '  <script src="/assets/js/site-nav.js" defer></script>\n</body>');
    fs.writeFileSync(file, html);
  }
  const footer = siteFooter();
  for (const f of STANDALONE) {
    const file = path.join(root, "public", f);
    if (!fs.existsSync(file)) continue;
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/<footer class="footer">[\s\S]*?<\/footer>/, footer));
  }
}

// lastmod is given only where we know the real date (articles). The build date isn't when a page changed, and search
// engines ignore lastmod that is always "today"; it would also make every build differ.
/** "Page not found", with the site's menu, a search box and the most useful next steps. Not indexed. */
export function write404() {
  const body = `      <div class="narrow center notfound">
        <span class="eyebrow">Page not found</span>
        <h1>We couldn't find that page</h1>
        <p class="muted">The link may be old or mistyped. These may help:</p>
        <form class="blog-search notfound__search" role="search" action="/blog/" method="get">
          <label for="nfQ" class="visually-hidden">Search articles</label>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="nfQ" name="q" placeholder="Search articles, e.g. sitting, pregnancy">
          <button type="submit" class="visually-hidden">Search</button>
        </form>
        <ul class="research-links notfound__links">
          <li><a href="/book">Book an appointment<span>New Delhi or online</span></a></li>
          <li><a href="/coccydynia">About tailbone pain<span>Causes, symptoms, research</span></a></li>
          <li><a href="/faq">Questions and answers<span>Fees, visits, what to expect</span></a></li>
          <li><a href="/manage.html">My appointments<span>Change or cancel a booking</span></a></li>
        </ul>
        <p class="small muted">Or call or WhatsApp us on <a href="tel:+919886688323">+91&nbsp;98866&nbsp;88323</a>.</p>
      </div>`;
  const html = blogPage({ title: "Page not found | Tailbone Treatment", description: "This page could not be found.", canonical: SITE, jsonLd: {}, body, blogActive: false })
    .replace(/\s*<link rel="canonical"[^>]*>/, '\n  <meta name="robots" content="noindex">')
    .replace(/\s*<script type="application\/ld\+json">\{\}<\/script>/, "")
    .replace(/\s*<meta property="og:[^>]*>/g, "").replace(/\s*<meta name="twitter:card"[^>]*>/, "");
  fs.writeFileSync(path.join(root, "public/404.html"), html);
}

export function writeSitemap(pages, posts, today = null) {
  const row = (loc, lastmod, freq, prio) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${freq}</changefreq><priority>${prio}</priority></url>`;
  const rows = [
    ...pages.map((p) => row(`${SITE}${p.slug}`, today, p.slug === "/" ? "weekly" : "monthly", p.slug === "/" ? "1.0" : ["/coccydynia", "/treatment", "/book"].includes(p.slug) ? "0.9" : "0.8")),
    row(`${SITE}/blog/`, posts[0]?.meta.date || today, "weekly", "0.7"),
    ...posts.map(({ meta }) => row(`${SITE}/blog/${meta.slug}.html`, meta.updated || meta.date, "yearly", "0.6")),
    ...(fs.existsSync(path.join(root, "public/press.html")) ? [row(`${SITE}/press.html`, today, "monthly", "0.6")] : []),
    row(`${SITE}/stories.html`, today, "weekly", "0.6"),
    row(`${SITE}/home-visit.html`, today, "monthly", "0.5"),
    row(`${SITE}/refer.html`, today, "monthly", "0.4"),
    row(`${SITE}/policies.html`, today, "yearly", "0.3"),
    row(`${SITE}/privacy.html`, today, "yearly", "0.3"),
  ];
  fs.writeFileSync(path.join(root, "public/sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by npm run build. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`);
}

/** Permanent redirects from the old WordPress addresses (content/redirects.json), in Netlify's _redirects format. */
export function writeRedirects() {
  const map = JSON.parse(fs.readFileSync(path.join(root, "content/redirects.json"), "utf8"));
  // Netlify matches with or without a trailing slash, so one rule per path; skip any that would point to itself.
  const bare = (p) => p.replace(/\/$/, "").replace(/\.html$/, "") || "/";
  const lines = Object.entries(map)
    .map(([from, to]) => [from.endsWith("/*") ? from : bare(from), to])
    .filter(([from, to]) => from !== "/" && from !== bare(to.split("#")[0]))
    .map(([from, to]) => `${from} ${to} 301`);
  fs.writeFileSync(path.join(root, "public/_redirects"), `# Old tailbonetreatment.com addresses → new pages. Generated by npm run build.
${lines.join("\n")}
`);
}

/** Adds ?v=<content hash> to our own stylesheets and scripts in every page (see versionHtml in partials.js). */
export function versionAssets() {
  const hashes = new Map();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".html") ? [path.join(dir, e.name)] : []);
  for (const file of walk(path.join(root, "public"))) {
    const html = fs.readFileSync(file, "utf8");
    const out = versionHtml(html, path.join(root, "public"), hashes);
    if (out !== html) fs.writeFileSync(file, out);
  }
}

export function buildSite() {
  const pages = buildPages();
  buildPress();
  writeRedirects();
  syncFooters();
  const posts = buildBlog();
  writeSitemap(pages, posts);
  write404();
  writeRobots();
  writeLlms(pages, posts);
  versionAssets();
  return { pages, posts };
}

const { pages, posts } = buildSite();
console.log(`Built ${pages.length} pages and ${posts.length} article(s).`);
