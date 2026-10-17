// Renders the Google Ads logo and image assets to PNG with headless Chromium.
// Usage: node resources/google-ads/source/render-images.mjs  (needs Playwright; see README)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");
const pw = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(pw);
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(here, "../../../public/assets/fonts", f)).toString("base64")}`;

const MARK = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="#16a34a" stroke-width="7"/><rect x="26" y="14" width="12" height="36" rx="2" fill="#16a34a"/><rect x="14" y="26" width="36" height="12" rx="2" fill="#16a34a"/></svg>`;
const SPINE = `<svg viewBox="0 0 200 360" class="spine"><defs><radialGradient id="p" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ef4444" stop-opacity=".9"/><stop offset="100%" stop-color="#ef4444" stop-opacity="0"/></radialGradient></defs>
<g class="v"><rect x="70" y="10" width="60" height="30" rx="10"/><rect x="68" y="48" width="64" height="32" rx="10"/><rect x="66" y="88" width="68" height="34" rx="11"/><rect x="64" y="130" width="72" height="34" rx="11"/><rect x="62" y="172" width="76" height="36" rx="12"/></g>
<path class="s" d="M58 218 Q100 210 142 218 L128 286 Q100 300 72 286 Z"/>
<circle cx="100" cy="320" r="40" fill="url(#p)"/><g class="c"><rect x="88" y="296" width="24" height="12" rx="5"/><rect x="91" y="311" width="18" height="10" rx="4"/><rect x="94" y="324" width="12" height="8" rx="3"/><rect x="96" y="335" width="8" height="6" rx="3"/></g></svg>`;

const css = `
@font-face { font-family: Sora; src: url(${font("sora-latin.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Inter; src: url(${font("inter-latin.woff2")}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { font-family: Inter, sans-serif; }
.art { position: relative; overflow: hidden; display: flex; color: #fff;
  background: radial-gradient(circle at 78% 30%, #1f7a4d 0, transparent 55%), linear-gradient(135deg, #0b3d2e, #0f5132); }
.spine .v rect, .spine .c rect { fill: rgba(255,255,255,.14); stroke: #86efac; stroke-width: 2.5; }
.spine .s { fill: rgba(255,255,255,.08); stroke: #86efac; stroke-width: 2.5; }
.spine .c rect { fill: #fecaca; stroke: #ef4444; }
h1 { font-family: Sora, sans-serif; font-weight: 700; letter-spacing: -.02em; line-height: 1.08; }
.brand { display: flex; align-items: center; gap: .5em; font-family: Sora; font-weight: 700; letter-spacing: .02em; }
.brand svg { width: 1.6em; height: 1.6em; background: #fff; border-radius: 50%; padding: .12em; }
.pill { display: inline-block; background: #16a34a; color: #fff; font-weight: 700; border-radius: 999px; }
.muted { color: #bbf7d0; }
`;

const ART = {
  // Landscape 1.91:1
  "image-landscape-1200x628-a": [1200, 628, `<div class="art" style="width:1200px;height:628px;padding:64px 72px;align-items:center;gap:40px">
    <div style="flex:1"><div class="brand" style="font-size:26px">${MARK}TAILBONE TREATMENT</div>
    <h1 style="font-size:66px;margin:36px 0 22px">Tailbone pain<br>when you sit?</h1>
    <p class="muted" style="font-size:28px">Non-surgical specialist care · New Delhi · Online · Lucknow soon</p></div>
    <div style="width:300px;height:520px">${SPINE.replace('class="spine"', 'class="spine" width="300" height="520"')}</div></div>`],
  "image-landscape-1200x628-b": [1200, 628, `<div class="art" style="width:1200px;height:628px;padding:64px 72px;flex-direction:column;justify-content:center">
    <div class="brand" style="font-size:26px">${MARK}TAILBONE TREATMENT</div>
    <h1 style="font-size:60px;margin:34px 0 20px;max-width:900px">An exclusive clinic for coccyx &amp; tailbone pain</h1>
    <p class="muted" style="font-size:28px">Dr Rajveer Singh · BPT · Fellowship in Orthopaedic Rehabilitation (Apollo Hospital, Chennai)</p></div>`],
  // Square 1:1
  "image-square-1200-a": [1200, 1200, `<div class="art" style="width:1200px;height:1200px;padding:90px;flex-direction:column;align-items:center;text-align:center">
    <div class="brand" style="font-size:34px">${MARK}TAILBONE TREATMENT</div>
    <div style="height:600px;margin:40px 0">${SPINE.replace('class="spine"', 'class="spine" width="340" height="600"')}</div>
    <h1 style="font-size:78px">Sit again without the pain</h1>
    <p class="muted" style="font-size:34px;margin-top:22px">New Delhi · Online · Lucknow soon</p></div>`],
  "image-square-1200-b": [1200, 1200, `<div class="art" style="width:1200px;height:1200px;padding:100px;flex-direction:column;justify-content:center">
    <div class="brand" style="font-size:34px">${MARK}TAILBONE TREATMENT</div>
    <h1 style="font-size:84px;margin:50px 0 44px">We treat</h1>
    <ul style="font-size:44px;line-height:1.65;padding-left:1.1em">
      <li>Tailbone pain (coccydynia)</li><li>Subluxed / dislocated coccyx</li><li>Post-injury tailbone pain</li>
      <li>Post-pregnancy tailbone pain</li><li>Sitting pain</li></ul>
    <p class="muted" style="font-size:34px;margin-top:50px">Non-surgical treatment · New Delhi · Online</p></div>`],
  // Portrait 4:5
  "image-portrait-960x1200": [960, 1200, `<div class="art" style="width:960px;height:1200px;padding:80px;flex-direction:column;align-items:center;text-align:center">
    <div class="brand" style="font-size:30px">${MARK}TAILBONE TREATMENT</div>
    <div style="height:560px;margin:50px 0">${SPINE.replace('class="spine"', 'class="spine" width="320" height="560"')}</div>
    <h1 style="font-size:70px">Coccyx pain?<br>Get it properly treated</h1>
    <p class="muted" style="font-size:30px;margin-top:24px">New Delhi · Online · Lucknow soon</p></div>`],
  // Logos
  "logo-square-1200": [1200, 1200, `<div style="width:1200px;height:1200px;background:#fff;display:grid;place-items:center"><div style="width:880px;height:880px">${MARK}</div></div>`],
  "logo-landscape-1200x300": [1200, 300, `<div style="width:1200px;height:300px;background:#fff;display:flex;align-items:center;justify-content:center;gap:40px">
    <div style="width:200px;height:200px">${MARK}</div>
    <div style="font-family:Sora;line-height:1"><div style="font-size:104px;font-weight:800;color:#15803d;letter-spacing:.02em">TAILBONE</div>
    <div style="font-size:44px;font-weight:700;color:#0b3d2e;letter-spacing:.32em;margin-top:8px">TREATMENT</div></div></div>`],
};

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, [w, h, html]] of Object.entries(ART)) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<!doctype html><style>${css}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, `${name}.png`) });
  await p.close();
  console.log("wrote", `${name}.png`);
}
await b.close();
