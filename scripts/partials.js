// Shared page parts. content/site.html (the page template) holds the master header and footer; the animated explainers live in content/animations.
// `npm run build` copies both into the other pages so there is one source for each.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Public address used in canonical links, sitemaps and structured data. Set SITE_URL=https://tailbonetreatment.com
// when the domain points to this site, then run `npm run build` again.
export const SITE = (process.env.SITE_URL || "https://tailbone.netlify.app").replace(/\/$/, "");

// caption: describes the animation for everyone (also read by screen readers); still: second shown when motion is reduced.
export const ANIMS = {
  sitting: { caption: "Why sitting hurts: leaning back loads the coccyx; leaning slightly forward moves your weight onto the sitting bones.", still: 6 },
  cushion: { caption: "On a flat seat the tailbone takes pressure; a cut-out cushion lets it float free.", still: 6 },
  pregnancy: { caption: "How childbirth can push the coccyx backwards, and how hands-on treatment helps it move normally again.", still: 5 },
  "red-flags": { caption: "When to use self-care, when to book a specialist, and when to see a doctor urgently.", still: 7 },
  "coccyx-types": { caption: "The four coccyx shapes described by Postacchini and Massobrio (1983), seen from the side. Types II–IV are more common in people with tailbone pain.", still: 9 },
  "bmi-pelvis": { caption: "How body weight changes the way the pelvis tilts when you sit, and what that does to the coccyx (after Maigne et al., 2000).", still: 4 },
  "women-5x": { caption: "Women develop coccydynia about five times as often as men (Lirette et al., 2014; Garg and Ahuja, 2020).", still: 7 },
  "study-groups": { caption: "Tailbone pain in specific groups that were studied. These are not population rates. Sources: Deniz 2014, Fatima 2025, Sanobar 2024, Neville 2022.", still: 5 },
  "pelvic-floor": { caption: "Pelvic-floor findings in women with pelvic pain, with and without coccydynia (Neville et al., 2022, n = 127).", still: 5 },
  "treatment-ladder": { caption: "Coccydynia is treated step by step. About 9 in 10 people improve with the first, non-surgical steps (Lirette 2014; MSD Manual).", still: 8 },
  "history-timeline": { caption: "Milestones in understanding tailbone pain, from the 16th century to today.", still: 7 },
  subluxation: { caption: "A displaced (subluxed) coccyx can shift inward, into the pelvis, or outward. The direction decides the treatment, so it is checked first.", still: 10.5 },
  "bike-vibration": { caption: "On a two-wheeler, each bump is passed up through the seat to the base of the spine.", still: 0.5 },
  "visit-steps": { caption: "Your visit in four steps: listen and assess, pinpoint the cause, hands-on treatment, recover and prevent.", still: 9 },
};

export function animFigure(name) {
  const a = ANIMS[name];
  if (!a) throw new Error(`Unknown animation "${name}"`);
  const svg = fs.readFileSync(path.join(root, "content/animations", `${name}.svg`), "utf8").trim();
  return `<figure class="anim" data-anim="${name}" data-still="${a.still}">
${svg}
<figcaption>${a.caption}</figcaption>
</figure>`;
}

export function siteFooter() {
  const html = fs.readFileSync(path.join(root, "content/site.html"), "utf8");
  const m = /<footer class="footer">[\s\S]*?<\/footer>/.exec(html);
  if (!m) throw new Error("No footer in content/site.html");
  return m[0];
}

/** The main header and menu from content/site.html, with `active` (a nav href such as "/blog/") marked as the current page. */
export function siteHeader(active) {
  const html = fs.readFileSync(path.join(root, "content/site.html"), "utf8");
  const m = /<header class="header" id="header">[\s\S]*?<\/header>/.exec(html);
  if (!m) throw new Error("No header in content/site.html");
  let header = m[0].replace(/\n\s*<div class="progress" id="progress"><\/div>/, "");
  // The English/Hindi switch leads to the Hindi home page, once the Hindi pages exist.
  if (!fs.existsSync(path.join(root, "content/hi.enabled"))) header = header.replace(/\n\s*<a class="lang-switch"[^>]*>[^<]*<\/a>/, "");
  if (active) {
    header = header.replace(new RegExp(`<a href="${active.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"( class="([^"]*)")?>`), (all, _c, cls = "") =>
      `<a href="${active}" class="${[cls, "is-active"].filter(Boolean).join(" ")}" aria-current="page">`);
  }
  return header;
}

// Fill <!-- anim:name --> … <!-- /anim --> blocks.
export const injectAnims = (html) => html.replace(/<!-- anim:([\w-]+) -->[\s\S]*?<!-- \/anim -->/g, (_, name) => `<!-- anim:${name} -->\n${animFigure(name)}\n<!-- /anim -->`);

/**
 * Adds ?v=<content hash> to our own stylesheet and script links, so a browser never pairs a new page with an old cached
 * stylesheet (which made new sections look broken until the cache expired). Used by the build and by pages the server renders.
 */
export function versionHtml(html, publicDir = path.join(root, "public"), cache = new Map()) {
  const hash = (url) => {
    if (!cache.has(url)) {
      const file = path.join(publicDir, url);
      cache.set(url, fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 10) : null);
    }
    return cache.get(url);
  };
  // Relative links (standalone pages at the site root) resolve from the root too.
  return html.replace(/((?:href|src)=")(\/?(?:assets|admin)\/[^"?#]+\.(?:css|js))(?:\?v=\w*)?"/g, (m, attr, url) => {
    const h = hash(url.replace(/^\//, ""));
    return h ? `${attr}${url}?v=${h}"` : m;
  });
}
