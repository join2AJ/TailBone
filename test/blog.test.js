import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseFrontMatter, markdown, loadPosts } from "../scripts/build-blog.js";

test("blog markdown escapes HTML and only allows safe links", () => {
  const html = markdown("Hi <script>x</script> **bold** [ok](https://nhs.uk) [bad](javascript:alert(1))\n\n- a\n- b\n\n1. one");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<strong>bold</strong>"));
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
  const index = fs.readFileSync("public/index.html", "utf8");
  assert.equal(injectAnims(index), index, "homepage animations are stale");
  assert.ok(index.includes('data-anim="sitting"') && index.includes('data-anim="visit-steps"'));
});
