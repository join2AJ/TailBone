// Launch phases: which features and articles the public website leaves out for now. The defaults are in
// content/launch.json; the super admin can change them in the Control panel. The website is static, so a change takes
// effect when Netlify rebuilds it: "Publish" calls the Netlify build hook (NETLIFY_BUILD_HOOK), and the build reads the
// saved settings from /api/launch (scripts/build-site.js, LAUNCH_URL).
import fs from "node:fs";
import { HttpError } from "./services.js";
import { loadPosts } from "../scripts/build-blog.js";

const FILE = new URL("../content/launch.json", import.meta.url);

export const LAUNCH_FEATURES = {
  booking: "Online booking form (when hidden, the Book page shows Call, WhatsApp and Email)",
  accounts: "My appointments and the follow-up check-in page",
  referrals: "Refer a patient and the partner log-in",
  home_visits: "Request form for treatment at your place (the Clinics tab and FAQ still mention it, with Call and WhatsApp)",
  story_form: "The \"Share your story\" form (stories stay readable)",
};

function fileDefaults() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { hidden: d.hidden || [], hiddenArticles: d.hiddenArticles || [] };
  } catch { return { hidden: [], hiddenArticles: [] }; }
}

export function getLaunch(db) {
  const row = db.prepare("SELECT value, updated_at, updated_by FROM site_content WHERE key = 'launch'").get();
  if (!row) return { ...fileDefaults(), saved: false };
  try { return { ...JSON.parse(row.value), saved: true, updatedAt: row.updated_at, updatedBy: row.updated_by }; } catch { return { ...fileDefaults(), saved: false }; }
}

/** Every article written as a file, with whether the launch settings hold it back. */
export function launchArticles(db) {
  const hidden = new Set(getLaunch(db).hiddenArticles);
  return loadPosts().map(({ meta }) => ({ id: meta.id, slug: meta.slug, title: meta.title, tags: meta.tags, hidden: hidden.has(meta.id) }))
    .sort((a, b) => b.id - a.id);
}

export function saveLaunch(db, input, by) {
  const ids = new Set(loadPosts().map((p) => p.meta.id));
  const hidden = [...new Set((Array.isArray(input?.hidden) ? input.hidden : []).filter((k) => Object.hasOwn(LAUNCH_FEATURES, k)))];
  const hiddenArticles = [...new Set((Array.isArray(input?.hiddenArticles) ? input.hiddenArticles : []).map(Number).filter((n) => ids.has(n)))].sort((a, b) => a - b);
  if (hiddenArticles.length >= ids.size) throw new HttpError(400, "At least one article must stay on the website.");
  const value = { hidden, hiddenArticles };
  const before = db.prepare("SELECT value FROM site_content WHERE key = 'launch'").get();
  db.prepare("INSERT INTO site_content_history (key, value, changed_by) VALUES ('launch', ?, ?)").run(before ? before.value : "null", by);
  db.prepare(`INSERT INTO site_content (key, value, updated_at, updated_by) VALUES ('launch', ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(JSON.stringify(value), by);
  return value;
}

/** Asks Netlify to rebuild the website, which then reads these settings. */
export async function publishLaunch() {
  const hook = process.env.NETLIFY_BUILD_HOOK;
  if (!hook) throw new HttpError(409, "Publishing isn't connected yet: the developer needs to add the Netlify build hook (NETLIFY_BUILD_HOOK) to the server. Until then, send the developer this list.");
  if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[\w-]+$/.test(hook)) throw new HttpError(500, "NETLIFY_BUILD_HOOK doesn't look like a Netlify build hook address.");
  const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(502, `Netlify didn't accept the request (${res.status}). Try again in a minute.`);
}
