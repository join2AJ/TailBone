import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp, seedAdmin } from "./app.js";
import { seedStories } from "./services.js";

const db = openDb();
seedStories(db);
if (seedAdmin(db)) console.log(`Created admin account for ${config.adminEmail}`);
if (!db.prepare("SELECT COUNT(*) n FROM admins").get().n) {
  console.warn("No admin account yet. Run `npm run admin:create` or set ADMIN_EMAIL and ADMIN_PASSWORD.");
}

const server = createApp(db).listen(config.port, () => {
  console.log(`Tailbone Treatment running on http://localhost:${config.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
