// Blog articles in the dashboard. The articles themselves are static pages built from content/blog/*.md;
// public/blog/search.json (written by the build) lists them, and blog_posts records which ones the admin has hidden.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/** Articles in the current build, newest first: [{ id, slug, title, summary, tags, date }]. */
export function builtPosts(file = path.join(config.publicDir, "blog", "search.json")) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).map(({ text, ...p }) => p);
  } catch {
    return [];
  }
}

/** Add new articles to the table and keep slugs and titles current. Show/hide choices are never touched. */
export function syncPosts(db, posts = builtPosts()) {
  const freeSlug = db.prepare("UPDATE blog_posts SET slug = '#' || id WHERE slug = ? AND id != ?");
  const upsert = db.prepare(`INSERT INTO blog_posts (id, slug, title) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title`);
  for (const p of posts) { freeSlug.run(p.slug, p.id); upsert.run(p.id, p.slug, p.title); }
  return posts;
}

/** Every article with its show/hide state, for the dashboard. */
export function listPosts(db) {
  const posts = syncPosts(db);
  const rows = new Map(db.prepare("SELECT * FROM blog_posts").all().map((r) => [r.id, r]));
  return posts.map((p) => {
    const r = rows.get(p.id) || {};
    return { ...p, enabled: r.enabled !== 0, changedAt: r.changed_at || null, changedBy: r.changed_by || null };
  });
}

/** Articles hidden from the public site: [{ id, slug }]. */
export const hiddenPosts = (db) => db.prepare("SELECT id, slug FROM blog_posts WHERE enabled = 0 ORDER BY id").all();

export function setEnabled(db, id, enabled, by) {
  syncPosts(db);
  const r = db.prepare("UPDATE blog_posts SET enabled = ?, changed_at = datetime('now'), changed_by = ? WHERE id = ?").run(enabled ? 1 : 0, by, id);
  return r.changes > 0;
}
