import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { hashPassword, rateLimit } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { partnerRoutes } from "./routes/partners.js";
import { hiddenPosts, syncPosts } from "./blog.js";
import { renderArticle, renderArt, getMedia, readMedia } from "./articles.js";
import { versionHtml } from "../scripts/partials.js";

/** Create the first account (the super admin) from ADMIN_EMAIL / ADMIN_PASSWORD if there are none yet. */
export function seedAdmin(db, { email = config.adminEmail, password = config.adminPassword, name = "Super Admin" } = {}) {
  const count = db.prepare("SELECT COUNT(*) n FROM admins").get().n;
  if (count > 0 || !email || !password) return false;
  db.prepare("INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')").run(email, name, hashPassword(password));
  return true;
}

// Only our own scripts plus Razorpay Checkout and the Google tag (loaded only after cookie consent) may run;
// inline scripts are blocked entirely.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.instagram.com https://www.youtube-nocookie.com https://player.vimeo.com https://maps.google.com https://www.google.com https://td.doubleclick.net https://www.googletagmanager.com",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.g.doubleclick.net https://www.google.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  // Proxies in front of the app: 1 = the host's load balancer; 2 = Netlify proxy + host (see render.yaml).
  // Needed so rate limits and the security log see the visitor's real IP.
  if (config.isProd) app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
  // With PROXY_SECRET set, the extra Netlify hop is trusted only for requests that carry the secret header Netlify adds
  // (netlify.toml). Anyone calling the server directly could otherwise fake X-Forwarded-For and dodge the rate limits.
  const proxySecret = process.env.PROXY_SECRET ? Buffer.from(process.env.PROXY_SECRET) : null;
  if (config.isProd && proxySecret) {
    app.use((req, res, next) => {
      const given = Buffer.from(req.get("x-proxy-secret") || "");
      const viaNetlify = given.length === proxySecret.length && crypto.timingSafeEqual(given, proxySecret);
      const chain = (req.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const hops = viaNetlify ? 2 : 1;
      const ip = chain.length >= hops ? chain[chain.length - hops] : req.socket.remoteAddress;
      Object.defineProperty(req, "ip", { value: ip, configurable: true });
      next();
    });
  }

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "SAMEORIGIN",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    if (config.isProd) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // Razorpay signs the exact raw bytes of the webhook, so it must not be JSON-parsed first.
  app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "1mb" }));
  app.use("/api/admin/articles", express.json({ limit: "300kb" })); // article text can be long
  app.use(express.json({ limit: "50kb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use("/api/admin", adminRoutes(db));
  app.use("/api/partners", partnerRoutes(db));
  app.use("/api", publicRoutes(db));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  // Old tailbonetreatment.com (WordPress) addresses → new pages, so links and search rankings carry over.
  const redirectsFile = path.join(config.publicDir, "..", "content", "redirects.json");
  const OLD = fs.existsSync(redirectsFile) ? JSON.parse(fs.readFileSync(redirectsFile, "utf8")) : {};
  const bare = (p) => p.replace(/\/$/, "") || "/";
  const exact = new Map(Object.entries(OLD).filter(([k]) => !k.endsWith("*")).map(([k, v]) => [bare(k), v]));
  const prefixes = Object.entries(OLD).filter(([k]) => k.endsWith("*")).map(([k, v]) => [k.slice(0, -1), v]);
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path === "/") return next();
    const to = exact.get(bare(req.path)) || prefixes.find(([p]) => req.path.startsWith(p))?.[1];
    if (to && bare(to.split("#")[0]) !== bare(req.path)) return res.redirect(301, to);
    next();
  });

  // Articles written in the dashboard, their pictures and uploaded media (see articles.js).
  app.get(/^\/blog\/a\/([a-z0-9-]+)\.svg$/, (req, res, next) => {
    const svg = renderArt(db, req.params[0]);
    if (!svg) return next();
    res.set({ "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }).send(svg);
  });
  app.get(/^\/blog\/a\/([a-z0-9-]+)\/?$/, (req, res, next) => {
    const html = renderArticle(db, req.params[0]);
    if (!html) return next();
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }).send(versionHtml(html, config.publicDir));
  });
  const mediaLimit = rateLimit({ windowMs: 15 * 60_000, max: 600 });
  app.get(/^\/media\/blog\/([a-f0-9]{24})$/, mediaLimit, (req, res, next) => {
    const m = getMedia(db, req.params[0]);
    if (!m) return next();
    res.set({ "Content-Type": m.mime, "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    // Range requests let audio and video players seek without downloading the whole file. Each answer is at most 2 MB;
    // players simply ask for the next part.
    const CHUNK = 2 * 1024 * 1024;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get("range") || "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, m.size - Number(range[2]));
      const end = Math.min(range[1] && range[2] ? Number(range[2]) : m.size - 1, start + CHUNK - 1, m.size - 1);
      if (start >= m.size || start > end) return res.status(416).set("Content-Range", `bytes */${m.size}`).end();
      return res.status(206).set("Content-Range", `bytes ${start}-${end}/${m.size}`).send(readMedia(db, m.id, start, end - start + 1));
    }
    res.send(readMedia(db, m.id, 0, m.size));
  });

  // Articles the admin has switched off are not served.
  syncPosts(db);
  app.get(/^\/blog\/([a-z0-9-]+)(\.html)?$/, (req, res, next) => {
    if (!hiddenPosts(db).some((p) => p.slug === req.params[0])) return next();
    res.status(404).set("X-Robots-Tag", "noindex").sendFile(path.join(config.publicDir, "404.html"));
  });

  // Compress text files (pages, CSS, JS, SVG, JSON): about 4x smaller over slow mobile connections.
  // Compressed copies are kept in memory and rebuilt when the file changes.
  const gzCache = new Map();
  const COMPRESSIBLE = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml" };
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!/\bgzip\b/.test(req.get("accept-encoding") || "")) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith("/")) rel += "index.html";
    else if (!path.extname(rel) && fs.existsSync(path.join(config.publicDir, `${rel}.html`))) rel += ".html";
    const type = COMPRESSIBLE[path.extname(rel)];
    const file = path.join(config.publicDir, rel);
    if (!type || !file.startsWith(config.publicDir + path.sep)) return next();
    let stat;
    try { stat = fs.statSync(file); } catch { return next(); }
    if (!stat.isFile() || stat.size < 1024) return next();
    const key = `${file}:${stat.mtimeMs}:${stat.size}`;
    let body = gzCache.get(file)?.key === key ? gzCache.get(file).body : null;
    if (!body) { body = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); gzCache.set(file, { key, body }); }
    const etag = `W/"gz-${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.set({ "Content-Type": `${type}; charset=utf-8`, "Content-Encoding": "gzip", Vary: "Accept-Encoding", ETag: etag });
    res.set("Cache-Control", type === "text/html" || !config.isProd ? "no-cache" : "public, max-age=3600");
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.set("Content-Length", String(body.length));
    res.end(req.method === "HEAD" ? undefined : body);
  });

  // Each short page is its own pre-built file (/coccydynia → coccydynia.html, via `extensions` below).
  const noCache = (res) => res.set("Cache-Control", "no-cache");
  app.use(express.static(config.publicDir, {
    extensions: ["html"],
    maxAge: config.isProd ? "1h" : 0,
    // Pages are re-checked each visit so updates show at once; assets keep the 1-hour cache.
    setHeaders: (res, file) => { if (file.endsWith(".html")) noCache(res); },
  }));
  app.get("/admin", (req, res) => res.sendFile(path.join(config.publicDir, "admin", "index.html")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: `That is too large. The limit here is ${Math.round(err.limit / 1024 / 1024) >= 1 ? `${Math.round(err.limit / 1024 / 1024)} MB` : `${Math.round(err.limit / 1024)} KB`}.` });
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Something went wrong. Please try again." : err.message });
  });

  app.use((req, res) => res.status(404).sendFile(path.join(config.publicDir, "404.html")));
  return app;
}
