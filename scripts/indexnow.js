// Tell Bing (which also feeds ChatGPT search and Copilot), Yandex and other IndexNow engines about every URL
// in the sitemap, so new or changed pages are picked up within hours. Run after a deploy:
//   npm run indexnow
// The key file public/d08126db38f9dfa862137a07fec72141.txt proves the site is ours. (Google doesn't use IndexNow; use Search Console.)
import fs from "node:fs";
import path from "node:path";
import { root, SITE } from "./partials.js";

const KEY = "d08126db38f9dfa862137a07fec72141";
const urls = [...fs.readFileSync(path.join(root, "public/sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URLs`);
if (!res.ok && res.status !== 202) process.exitCode = 1;
