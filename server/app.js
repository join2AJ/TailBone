import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { hashPassword } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";

/** Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if there are none yet. */
export function seedAdmin(db, { email = config.adminEmail, password = config.adminPassword, name = "Clinic Admin" } = {}) {
  const count = db.prepare("SELECT COUNT(*) n FROM admins").get().n;
  if (count > 0 || !email || !password) return false;
  db.prepare("INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)").run(email, name, hashPassword(password));
  return true;
}

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  if (config.isProd) app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "SAMEORIGIN",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });

  app.use(express.json({ limit: "50kb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use("/api/admin", adminRoutes(db));
  app.use("/api", publicRoutes(db));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  app.use(express.static(config.publicDir, { extensions: ["html"], maxAge: config.isProd ? "1h" : 0 }));
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
