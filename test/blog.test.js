import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseFrontMatter, markdown, loadPosts } from "../scripts/build-blog.js";

test("blog markdown escapes HTML and only allows safe links", () => {
  const html = markdown("Hi <script>x</script> **bold** [ok](https://nhs.uk) [bad](javascript:alert(1))\n\n- a\n- b\n\n1. one");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.equal(markdown("the *and* part, 2*3*4"), "<p>the <em>and</em> part, 2*3*4</p>");
  assert.ok(html.includes('<a href="https://nhs.uk" target="_blank" rel="noopener">ok</a>'));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("<ul><li>a</li><li>b</li></ul>") && html.includes("<ol><li>one</li></ol>"));
});

test("front matter is required and slugs are safe", () => {
  assert.throws(() => parseFrontMatter("no front matter"));
  assert.throws(() => parseFrontMatter("---\ntitle: a\nslug: ../x\ndate: 2026-01-01\nsummary: s\n---\n"));
});

test("every article is built into public/blog", () => {
  const posts = loadPosts();
  assert.ok(posts.length >= 4);
  for (const p of posts) assert.ok(fs.existsSync(`public/blog/${p.meta.slug}.html`), `run npm run build:blog (${p.meta.slug})`);
  assert.ok(fs.existsSync("public/blog/index.html"));
});

test("shared footer and animations are up to date (run npm run build)", async () => {
  const { siteFooter, injectAnims } = await import("../scripts/partials.js");
  const footer = siteFooter();
  for (const f of ["manage.html", "policies.html", "privacy.html", "stories.html", "blog/index.html"]) {
    assert.ok(fs.readFileSync(`public/${f}`, "utf8").includes(footer), `${f} footer is stale`);
  }
  const index = fs.readFileSync("content/site.html", "utf8");
  assert.equal(injectAnims(index), index, "template animations are stale");
  assert.ok(index.includes('data-anim="sitting"') && index.includes('data-anim="visit-steps"'));
});

test("every short page is its own file with a unique title, canonical link, heading and structured data", async () => {
  const { PAGES, renderPage, TEMPLATE } = await import("../scripts/build-pages.js");
  const { injectAnims } = await import("../scripts/partials.js");
  const template = injectAnims(fs.readFileSync(TEMPLATE, "utf8"));
  const titles = new Set();
  for (const p of PAGES) {
    const html = fs.readFileSync(`public/${p.file}`, "utf8");
    assert.equal(html.replace(/"dateModified":"[^"]*"/, ""), renderPage(template, p).replace(/"dateModified":"[^"]*"/, ""), `${p.file} is stale: run npm run build`);
    const title = /<title>(.*?)<\/title>/.exec(html)[1];
    assert.ok(!titles.has(title), `duplicate title ${title}`); titles.add(title);
    assert.ok(html.includes(`<link rel="canonical" href="https://tailbone.netlify.app${p.slug}">`), p.file);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${p.file} has one h1`);
    for (const m of html.matchAll(/<section[^>]*data-page="([^"]*)"/g)) assert.ok(m[1].split(" ").includes(p.page), `${p.file} only has its own sections`);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
    assert.ok(ld["@graph"].some((g) => [].concat(g["@type"]).includes("MedicalClinic")));
  }
  const faq = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(fs.readFileSync("public/faq.html", "utf8"))[1]);
  assert.ok(faq["@graph"].find((g) => g.mainEntity).mainEntity.length >= 5, "FAQ questions in structured data");
});

test("AI assistants: robots.txt welcomes their crawlers, llms.txt summarises the clinic", () => {
  const robots = fs.readFileSync("public/robots.txt", "utf8");
  for (const bot of ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) assert.ok(robots.includes(`User-agent: ${bot}`), bot);
  assert.ok(robots.includes("Disallow: /admin") && robots.includes("Disallow: /api/") && robots.includes("Sitemap: "));
  const llms = fs.readFileSync("public/llms.txt", "utf8");
  assert.ok(llms.startsWith("# Tailbone Treatment Clinic\n\n> "));
  assert.ok(llms.includes("150A/09, Shanti Apartment") && llms.includes("/coccydynia") && llms.includes("/blog/"));
  const full = fs.readFileSync("public/llms-full.txt", "utf8");
  assert.ok(full.includes("Source: https://tailbone.netlify.app/faq") && !full.includes("<div"));
});

test("old WordPress addresses redirect permanently to the new pages", async () => {
  const { createApp } = await import("../server/app.js");
  const { openDb } = await import("../server/db.js");
  const srv = createApp(openDb(":memory:")).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p) => fetch(base + p, { redirect: "manual" });
  try {
    for (const [from, to] of [["/coccygodynia/", "/coccydynia"], ["/dr-rajveer-singh", "/doctor"], ["/appointment/", "/book"], ["/tag/coccydynia/", "/blog/"],
      ["/bruised-tailbone-requires-special-precautions-slow-to-heal/", "/blog/bruised-tailbone-requires-special-precautions-slow-to-heal.html"]]) {
      const r = await go(from);
      assert.equal(r.status, 301, from);
      assert.equal(r.headers.get("location"), to);
    }
    assert.equal((await go("/faq")).status, 200, "new pages are not redirected");
    assert.equal((await go("/coccydynia")).status, 200);
    assert.ok(fs.readFileSync("public/_redirects", "utf8").split("\n").every((l) => !/^\/faq\s/.test(l)), "no self-redirects for Netlify");
  } finally {
    srv.close();
  }
});

test("article tables, figures and citations", () => {
  const html = markdown("| A | B |\n|---|---|\n| x | <y> |\nTable: Cap\n\n::anim treatment-ladder");
  assert.ok(html.includes("<caption>Cap</caption>") && html.includes('<th scope="row">x</th><td>&lt;y&gt;</td>'));
  assert.ok(html.includes('data-anim="treatment-ladder"'));
  const posts = loadPosts();
  const internal = new Set(posts.map((p) => `/blog/${p.meta.slug}.html`));
  for (const p of posts) {
    for (const [, href] of p.body.matchAll(/\]\((\/blog\/[^)\s]+)\)/g)) assert.ok(internal.has(href), `${p.meta.slug} links to missing ${href}`);
    if (/^## Sources/m.test(p.body) && p.meta.tags?.includes("Research")) {
      const built = fs.readFileSync(`public/blog/${p.meta.slug}.html`, "utf8");
      assert.ok(built.includes('"citation"'), `${p.meta.slug} has no citations in its structured data`);
    }
  }
});

test("every article has a unique number and tags from the agreed list; the search index matches", async () => {
  const { TAGS, checkIds } = await import("../scripts/build-blog.js");
  const posts = loadPosts();
  checkIds(posts);
  assert.throws(() => checkIds([{ meta: { id: 1, slug: "a" } }, { meta: { id: 1, slug: "b" } }]), /used by both/);
  assert.throws(() => parseFrontMatter("---\ntitle: a\nslug: x\ndate: 2026-01-01\nsummary: s\n---\n"), /"id"/);
  assert.throws(() => parseFrontMatter("---\nid: 3\ntitle: a\nslug: x\ndate: 2026-01-01\nsummary: s\ntags: Nonsense\n---\n"), /Unknown tag/);
  for (const p of posts) {
    assert.ok(p.meta.tags.length >= 2, `${p.meta.slug} needs at least two tags`);
    for (const t of p.meta.tags) assert.ok(TAGS.includes(t));
  }
  const index = JSON.parse(fs.readFileSync("public/blog/search.json", "utf8"));
  assert.deepEqual(index.map((p) => p.id).sort((a, b) => a - b), posts.map((p) => p.meta.id).sort((a, b) => a - b), "run npm run build");
  assert.ok(index.every((p) => p.text.length > 200 && !p.text.includes("::anim")));
  const blogIndex = fs.readFileSync("public/blog/index.html", "utf8");
  assert.ok(blogIndex.includes('id="blogQ"') && blogIndex.includes('data-tag="Pregnancy"'));
});
