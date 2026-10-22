// "In the news" page from content/press.json (newspaper coverage imported from the old site).
import fs from "node:fs";
import path from "node:path";
import { root, SITE } from "./partials.js";
import { page } from "./build-blog.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const prettyDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
// Readable headings for the clippings (the old post titles were "Tailbone Pain Article in … News Paper").
const heading = (p) => p.title
  .replace(/^Tailbone Pain Article in |^Tailbone Article in |^Article on Tailbone Treatment in /i, "")
  .replace(/ News Paper$| Paper$/i, "")
  .replace(/^Times of India$/, "The Times of India")
  .replace(/^Kanada$/, "Kannada newspaper")
  .replace(/^Hindustan Delhi \((English|Hindi)\)$/, "Hindustan, Delhi ($1 edition)");

// Independent pages that mention Dr Rajveer Singh (checked by hand; see docs/IMPROVEMENTS-AND-ROADMAP.md).
const MENTIONS = [
  { url: "https://www.coccyx.org/treatmen/docsindi.htm", title: "coccyx.org: list of doctors for tailbone pain in India", note: "Dr Rajveer Singh, physiotherapist (an older listing that still shows the Bengaluru address)" },
  { url: "https://coccyx.org/personal/2026/rahul.htm", title: "\"Severe pain in the tailbone\" (2026)", note: "A patient's account of treatment in Delhi" },
  { url: "https://www.coccyx.org/personal/2024/anon2402.htm", title: "\"Tailbone treatment by Dr Rajveer Singh\" (2024)", note: "Dynamic X-ray, then treatment in Delhi" },
  { url: "https://coccyx.org/personal/2022/akanksha.htm", title: "\"Big thanks to Dr Rajveer for coccyx pain recovery\" (2022)", note: "A patient's account" },
  { url: "https://coccyx.org/personal/2009/sachin.htm", title: "\"Treatment of coccyx injury by Dr. Rajveer Singh\" (2009)", note: "One of the earliest patient accounts, from Bengaluru" },
];

export function buildPress() {
  const items = JSON.parse(fs.readFileSync(path.join(root, "content/press.json"), "utf8"));
  const cards = items.map((p) => `        <li class="press-card" id="${esc(p.slug)}">
          <a href="${esc(p.image)}" class="press-card__img" data-full="${esc(p.image)}" data-w="${p.width}" data-h="${p.height}" data-caption="${esc(heading(p))}, ${prettyDate(p.date)}" aria-label="Open the full clipping: ${esc(heading(p))}">
            <img src="${esc(p.thumb || p.image)}" alt="Newspaper clipping: ${esc(p.title)}" width="${p.thumbWidth || p.width}" height="${p.thumbHeight || p.height}" loading="lazy" decoding="async">
          </a>
          <h2>${esc(heading(p))}</h2>
          <p class="muted small"><time datetime="${p.date}">${prettyDate(p.date)}</time>${p.language ? ` · ${esc(p.language)}` : ""}</p>
        </li>`).join("\n");
  const pubs = [...new Set(items.map((p) => p.publication).filter((x) => x !== "Newspaper"))];
  const body = `      <div class="section__head">
        <span class="eyebrow">In the news</span>
        <h1>Tailbone Treatment in the news</h1>
        <p class="muted">Dr Rajveer Singh's work on tailbone pain has been covered since 2013 by ${pubs.slice(0, -1).join(", ")} and ${pubs.at(-1)}. Tap a clipping to read it full size.</p>
      </div>
      <ul class="press-grid">
${cards}
      </ul>
      <section class="online-mentions" aria-labelledby="onlineTitle">
        <h2 class="subhead" id="onlineTitle">Also mentioned online</h2>
        <p class="muted">coccyx.org is an independent international website about tailbone pain, run by Jon Miles in the UK. It lists Dr Rajveer Singh among the specialists in India and publishes patients' own accounts of their treatment.</p>
        <ul class="research-links">
${MENTIONS.map((m) => `          <li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}<span>${esc(m.note)}</span></a></li>`).join("\n")}
        </ul>
      </section>`;
  const html = page({
    title: "In the News: Tailbone Treatment and Dr Rajveer Singh",
    description: `Newspaper coverage of Dr Rajveer Singh and tailbone (coccyx) pain treatment, in ${pubs.join(", ")}.`,
    canonical: `${SITE}/press.html`,
    blogActive: false,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Tailbone Treatment in the news",
      url: `${SITE}/press.html`,
      about: { "@id": `${SITE}/doctor#rajveer-singh` },
      hasPart: items.map((p) => ({
        "@type": "NewsArticle", headline: heading(p), datePublished: p.date, image: `${SITE}${p.image}`,
        publisher: { "@type": "Organization", name: p.publication }, about: { "@id": `${SITE}/doctor#rajveer-singh` },
        ...(p.language ? { inLanguage: p.language === "Hindi" ? "hi" : "kn" } : {}),
      })),
    },
    body,
  });
  fs.writeFileSync(path.join(root, "public/press.html"), html.replace("</body>", '  <script src="/assets/js/press.js" defer></script>\n</body>'));
  return items;
}
