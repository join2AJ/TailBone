// Articles written in the dashboard. They share the blog's numbering (1001 and up, so they never clash with the article
// files, which use 1–1000), its look (scripts/build-blog.js renders both), its topics and its show/hide switch.
// They are served by the server at /blog/a/<slug> and added to the /blog/ list by blog.js.
import { markdown, articlePage, artSvg, TAGS } from "../scripts/build-blog.js";
import { builtPosts, syncPosts } from "./blog.js";
import { HttpError, cleanText } from "./services.js";
import { clinicNow } from "./time.js";

export const FIRST_DASHBOARD_ID = 1001;
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

// Files an article may carry, recognised by their first bytes (the name and declared type are not trusted).
const SIGNATURES = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"],
  ["audio/mpeg", (b) => b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  ["audio/wav", (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE"],
  ["audio/ogg", (b) => b.toString("ascii", 0, 4) === "OggS"],
  ["video/webm", (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
  // MP4 / M4A: an "ftyp" box at byte 4. Audio-only brands are served as audio.
  ["mp4", (b) => b.toString("ascii", 4, 8) === "ftyp"],
];

export function sniffMedia(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const hit = SIGNATURES.find(([, test]) => test(buf));
  if (!hit) return null;
  if (hit[0] === "mp4") return /^M4A|^M4B/.test(buf.toString("ascii", 8, 12)) ? "audio/mp4" : "video/mp4";
  return hit[0];
}

export function addMedia(db, name, data) {
  if (!data?.length) throw new HttpError(400, "Please choose a file.");
  if (data.length > MEDIA_MAX_BYTES) throw new HttpError(413, "Files up to 25 MB can be added. For longer videos, upload to YouTube and paste the link.");
  const mime = sniffMedia(data);
  if (!mime) throw new HttpError(415, "Please add a JPG, PNG or WebP picture, an MP3, M4A, WAV or OGG recording, or an MP4 or WebM video.");
  const id = Number(db.prepare("INSERT INTO blog_media (name, mime, size, data) VALUES (?, ?, ?, ?)").run(cleanText(name, 120) || "file", mime, data.length, data).lastInsertRowid);
  return { id, mime, size: data.length, url: `/media/blog/${id}`, kind: mime.split("/")[0] };
}

export const getMedia = (db, id) => db.prepare("SELECT * FROM blog_media WHERE id = ?").get(id);

const slugify = (title) => title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "article";

function cleanArticle(input) {
  const title = cleanText(input.title, 140);
  if (title.length < 8) throw new HttpError(400, "Please give the article a title (at least 8 characters).");
  const summary = cleanText(input.summary, 300);
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).filter((t) => TAGS.includes(t)))].slice(0, 4);
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 60_000);
  const cover = input.coverMediaId ? Number(input.coverMediaId) : null;
  return { title, summary, tags, body, cover: Number.isInteger(cover) && cover > 0 ? cover : null, author: cleanText(input.author, 80) || "Dr Rajveer Singh" };
}

const readMinutes = (body) => Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));

/** A dashboard article in the shape scripts/build-blog.js renders. */
function toPost(row) {
  const tags = JSON.parse(row.tags || "[]");
  const meta = {
    id: row.id, slug: row.slug, title: row.title, summary: row.summary || row.title, tags,
    date: (row.published_at || row.updated_at || clinicNow().date).slice(0, 10), updated: row.updated_at ? row.updated_at.slice(0, 10) : undefined,
    readMinutes: readMinutes(row.body), author: row.author, path: `/blog/a/${row.slug}`,
    cover: row.cover_media_id ? `/media/blog/${row.cover_media_id}` : undefined,
    image: row.cover_media_id ? `/media/blog/${row.cover_media_id}` : undefined,
  };
  const srcBlock = (/^## Sources\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(row.body) || [, ""])[1];
  return { meta, body: row.body, sources: [...srcBlock.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((x) => x[1]), html: markdown(row.body).replace(/^/gm, "          ") };
}

export function listArticles(db) {
  return db.prepare("SELECT * FROM blog_posts WHERE source = 'dashboard' ORDER BY COALESCE(published_at, updated_at) DESC").all()
    .map((r) => ({ id: r.id, slug: r.slug, title: r.title, summary: r.summary, tags: JSON.parse(r.tags || "[]"), body: r.body, author: r.author,
      status: r.status, enabled: r.enabled !== 0, coverMediaId: r.cover_media_id, publishedAt: r.published_at, updatedAt: r.updated_at, url: `/blog/a/${r.slug}` }));
}

export function saveArticle(db, id, input, by) {
  const a = cleanArticle(input);
  syncPosts(db);
  const existing = id ? db.prepare("SELECT * FROM blog_posts WHERE id = ? AND source = 'dashboard'").get(id) : null;
  if (id && !existing) throw new HttpError(404, "Article not found.");
  // The address stays the same once published, so links people have shared keep working.
  let slug = existing?.status === "published" ? existing.slug : slugify(a.title);
  if (!existing || slug !== existing.slug) {
    for (let n = 2; db.prepare("SELECT 1 FROM blog_posts WHERE slug = ? AND id != ?").get(slug, existing?.id ?? 0) || builtPosts().some((p) => p.slug === slug); n++) {
      slug = `${slugify(a.title).slice(0, 66)}-${n}`;
    }
  }
  if (existing) {
    db.prepare("UPDATE blog_posts SET title = ?, slug = ?, summary = ?, tags = ?, body = ?, cover_media_id = ?, author = ?, updated_at = datetime('now'), changed_at = datetime('now'), changed_by = ? WHERE id = ?")
      .run(a.title, slug, a.summary, JSON.stringify(a.tags), a.body, a.cover, a.author, by, existing.id);
    return existing.id;
  }
  const next = Math.max(FIRST_DASHBOARD_ID - 1, db.prepare("SELECT IFNULL(MAX(id), 0) n FROM blog_posts").get().n) + 1;
  db.prepare(`INSERT INTO blog_posts (id, slug, title, source, status, summary, tags, body, cover_media_id, author, enabled, updated_at, changed_at, changed_by)
    VALUES (?, ?, ?, 'dashboard', 'draft', ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), ?)`)
    .run(next, slug, a.title, a.summary, JSON.stringify(a.tags), a.body, a.cover, a.author, by);
  return next;
}

export function publishArticle(db, id, publish, by) {
  const row = db.prepare("SELECT * FROM blog_posts WHERE id = ? AND source = 'dashboard'").get(id);
  if (!row) throw new HttpError(404, "Article not found.");
  if (publish && (!row.body.trim() || row.body.trim().length < 200)) throw new HttpError(400, "Please write at least a few paragraphs before publishing.");
  if (publish && !row.summary) throw new HttpError(400, "Please add a one-line summary before publishing (it shows in search results and on the blog list).");
  db.prepare("UPDATE blog_posts SET status = ?, published_at = COALESCE(published_at, CASE WHEN ? THEN datetime('now') END), changed_at = datetime('now'), changed_by = ? WHERE id = ?")
    .run(publish ? "published" : "draft", publish ? 1 : 0, by, id);
}

export function deleteArticle(db, id) {
  const r = db.prepare("DELETE FROM blog_posts WHERE id = ? AND source = 'dashboard'").run(id);
  if (!r.changes) throw new HttpError(404, "Article not found.");
}

/** Published, switched-on dashboard articles for the /blog/ list. */
export function publicArticles(db) {
  return db.prepare("SELECT * FROM blog_posts WHERE source = 'dashboard' AND status = 'published' AND enabled = 1 ORDER BY published_at DESC").all().map((r) => {
    const { meta } = toPost(r);
    return { id: meta.id, slug: meta.slug, title: meta.title, summary: meta.summary, tags: meta.tags, date: meta.date, readMinutes: meta.readMinutes, url: meta.path, art: meta.cover || `${meta.path}.svg` };
  });
}

/** The full page of a dashboard article, or null if it isn't published (or was switched off). `preview` renders drafts too. */
export function renderArticle(db, slug, { preview = false } = {}) {
  const row = db.prepare("SELECT * FROM blog_posts WHERE source = 'dashboard' AND slug = ?").get(slug);
  if (!row || (!preview && (row.status !== "published" || row.enabled === 0))) return null;
  const others = builtPosts().map((p) => ({ meta: { ...p, readMinutes: 3 } }));
  return articlePage(toPost(row), others);
}

export function renderArt(db, slug) {
  const row = db.prepare("SELECT slug, tags FROM blog_posts WHERE source = 'dashboard' AND slug = ?").get(slug);
  return row ? artSvg({ slug: row.slug, tags: JSON.parse(row.tags || "[]") }) : null;
}

/** Just the article body, for the editor's preview. */
export const previewBody = (body) => markdown(String(body || "").slice(0, 60_000));
