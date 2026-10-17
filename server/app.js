import fs from "node:fs";
import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { hashPassword } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { hiddenPosts, syncPosts } from "./blog.js";

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
  "frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.instagram.com https://maps.google.com https://www.google.com https://td.doubleclick.net https://www.googletagmanager.com",
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

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "SAMEORIGIN",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    if (config.isProd) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // Razorpay signs the exact raw bytes of the webhook, so it must not be JSON-parsed first.
  app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "1mb" }));
  app.use(express.json({ limit: "50kb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use("/api/admin", adminRoutes(db));
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

  // Articles the admin has switched off are not served.
  syncPosts(db);
  app.get(/^\/blog\/([a-z0-9-]+)(\.html)?$/, (req, res, next) => {
    if (!hiddenPosts(db).some((p) => p.slug === req.params[0])) return next();
    res.status(404).set("X-Robots-Tag", "noindex").sendFile(path.join(config.publicDir, "404.html"));
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
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? "Something went wrong. Please try again." : err.message });
  });

  app.use((req, res) => res.status(404).sendFile(path.join(config.publicDir, "404.html")));
  return app;
}
