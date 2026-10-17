import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp, seedAdmin } from "./app.js";
import { seedStories, getAppointment, releaseExpiredHolds } from "./services.js";
import { runReminderJob } from "./notify.js";
import { clinicNow, addDays } from "./time.js";

const db = openDb();
seedStories(db);
if (seedAdmin(db)) console.log(`Created admin account for ${config.adminEmail}`);
if (!db.prepare("SELECT COUNT(*) n FROM admins").get().n) {
  console.warn("No admin account yet. Run `npm run admin:create` or set ADMIN_EMAIL and ADMIN_PASSWORD.");
}

const server = createApp(db).listen(config.port, () => {
  console.log(`Tailbone Treatment running on http://localhost:${config.port}`);
});

// Background jobs: release unpaid slot holds, and send tomorrow's reminders automatically
// when the WhatsApp Cloud API is configured. Runs every 10 minutes; each reminder is sent once.
const jobs = setInterval(async () => {
  try {
    releaseExpiredHolds(db);
    const { minutes, date } = clinicNow();
    if (minutes >= 9 * 60 && minutes < 21 * 60) await runReminderJob(db, getAppointment, addDays(date, 1));
  } catch (err) {
    console.error("Background job failed:", err.message);
  }
}, 10 * 60_000);
jobs.unref();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
