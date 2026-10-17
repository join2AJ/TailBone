// Shared page parts. content/site.html (the page template) holds the master footer; the animated explainers live in content/animations.
// `npm run build` copies both into the other pages so there is one source for each.
import fs from "node:fs";
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

// Fill <!-- anim:name --> … <!-- /anim --> blocks.
export const injectAnims = (html) => html.replace(/<!-- anim:([\w-]+) -->[\s\S]*?<!-- \/anim -->/g, (_, name) => `<!-- anim:${name} -->\n${animFigure(name)}\n<!-- /anim -->`);
