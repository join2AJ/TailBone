// Records each animated explainer as an MP4 (1280×720 and 1080×1080) for YouTube, Instagram and Google Ads.
// Needs the site served locally (e.g. `npx serve public -l 8765` or `npm start`), Playwright and ffmpeg:
//   BASE=http://localhost:8765 node resources/videos/render-videos.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ANIMS, animFigure } from "../../scripts/partials.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8765";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const LOOPS = 2; // two loops gives 16–20 s videos (Google Ads needs at least 10 s)
const SIZES = { "16x9": [1280, 720], "1x1": [1080, 1080] };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const tmp = fs.mkdtempSync(path.join(here, ".rec-"));
for (const name of Object.keys(ANIMS)) {
  const svg = fs.readFileSync(path.join(here, "../../content/animations", `${name}.svg`), "utf8");
  const dur = Math.max(...[...svg.matchAll(/dur="(\d+)s"/g)].map((m) => Number(m[1])));
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir: tmp, size: { width: w, height: h } } });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html data-theme="light"><head><base href="${BASE}/">
      <link rel="stylesheet" href="assets/css/fonts.css"><link rel="stylesheet" href="assets/css/styles.css">
      <style>html,body{margin:0;height:100%;background:#f2f8f4}.stage{height:100%;display:grid;grid-template-rows:1fr auto;padding:${h > w * 0.8 ? 80 : 28}px 48px 28px;box-sizing:border-box}
      .stage .anim{margin:0;border:0;background:none;padding:0;min-height:0;height:100%}.stage figcaption{display:none}.stage svg{width:100%;height:100%}
      .brandbar{display:flex;justify-content:space-between;align-items:center;font:600 22px Inter,sans-serif;color:#0b3d2e}
      .brandbar strong{font-family:Sora,sans-serif;color:#15803d;font-size:26px}</style></head>
      <body><div class="stage">${animFigure(name)}<div class="brandbar"><strong>TAILBONE TREATMENT</strong><span>New Delhi · Online · +91 98866 88323</span></div></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.querySelector("svg").setCurrentTime(0));
    await page.waitForTimeout(dur * LOOPS * 1000);
    const video = page.video();
    await ctx.close();
    const src = await video.path();
    const out = path.join(here, `${name}-${label}.mp4`);
    // Trim the blank first frames, encode H.264 for every platform.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.3", "-i", src, "-t", String(dur * LOOPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", "-an", out]);
    console.log("wrote", path.basename(out));
  }
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
