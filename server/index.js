import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp, seedAdmin } from "./app.js";
import { seedStories, getAppointment, releaseExpiredHolds } from "./services.js";
import { runReminderJob } from "./notify.js";
import { clinicNow, addDays } from "./time.js";
import { createBackup, listBackups } from "./backup.js";
import { runRetention, processDueRequests } from "./privacy.js";
import path from "node:path";
import { seedDemo } from "./demo.js";
import { retryPendingSyncs } from "./gcal.js";

const db = openDb();
if (config.demo) {
  seedDemo(db);
  console.log("DEMO MODE: sample data loaded into demo.db (resets every 24 h). No real payments or messages are sent.");
}
seedStories(db);
if (seedAdmin(db)) console.log(`Created admin account for ${config.adminEmail}`);
if (!db.prepare("SELECT COUNT(*) n FROM admins").get().n) {
  console.warn("No admin account yet. Run `npm run admin:create` or set ADMIN_EMAIL and ADMIN_PASSWORD.");
}

const server = createApp(db).listen(config.port, () => {
  console.log(`Tailbone Treatment running on http://localhost:${config.port}`);
});

let demoSeededAt = Date.now();

// Background jobs: release unpaid slot holds, and send tomorrow's reminders automatically
// when the WhatsApp Cloud API is configured. Runs every 10 minutes; each reminder is sent once.
const jobs = setInterval(async () => {
  try {
    releaseExpiredHolds(db);
    processDueRequests(db); // data requests nobody handled within 3 days
    await retryPendingSyncs(db, { getAppointment });
    if (config.demo && Date.now() - demoSeededAt > 24 * 3600_000) {
      seedDemo(db);
      demoSeededAt = Date.now();
    }
    const { minutes, date } = clinicNow();
    if (minutes >= 9 * 60 && minutes < 21 * 60) await runReminderJob(db, getAppointment, addDays(date, 1));
    // Once a day (after 2 AM IST): encrypted backup, then retention clean-up.
    const dataDir = path.dirname(config.dbFile);
    const last = listBackups(dataDir)[0];
    if (minutes >= 120 && (!last || Date.now() - Date.parse(last.at) > 20 * 3600_000)) {
      createBackup(db, dataDir);
      const { erased } = runRetention(db);
      if (erased) console.log(`Retention: erased ${erased} inactive patient record(s).`);
    }
  } catch (err) {
    console.error("Background job failed:", err.message);
  }
}, 10 * 60_000);
jobs.unref();
if (!process.env.ENCRYPTION_KEY && config.isProd) console.warn("WARNING: ENCRYPTION_KEY is not set. A key file in the data folder is being used; set ENCRYPTION_KEY and keep a copy safe.");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
