import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp, seedAdmin } from "./app.js";
import { seedStories, getAppointment, releaseExpiredHolds, syncAwaitingPayments } from "./services.js";
import { runReminderJob, runSoonReminders, runCheckinJob } from "./notify.js";
import { isOn } from "./features.js";
import { clinicNow, addDays } from "./time.js";
import { createBackup, listBackups } from "./backup.js";
import { runRetention, processDueRequests } from "./privacy.js";
import path from "node:path";
import { seedDemo } from "./demo.js";
import { retryPendingSyncs } from "./gcal.js";

if (config.isProd && !config.demo && !process.env.ENCRYPTION_KEY) {
  console.error("ENCRYPTION_KEY is not set. Patient notes are encrypted with it: generate one (see README), keep a copy safe, then restart.");
  process.exit(1);
}
const db = openDb();
if (config.demo) {
  seedDemo(db);
  console.log("DEMO MODE: sample data loaded into demo.db (resets every 24 h). No real payments or messages are sent.");
}
seedStories(db);
if (config.isProd && !config.siteUrl) console.warn("SITE_URL is not set: links in patient messages will point to https://tailbone.netlify.app. Set SITE_URL to the website's address.");
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
    await syncAwaitingPayments(db); // a payment whose confirmation went missing is recorded before its hold is released
    releaseExpiredHolds(db);
    processDueRequests(db); // data requests nobody handled within 3 days
    await retryPendingSyncs(db, { getAppointment });
    if (config.demo && Date.now() - demoSeededAt > 24 * 3600_000) {
      seedDemo(db);
      demoSeededAt = Date.now();
    }
    const { minutes, date } = clinicNow();
    // Automatic WhatsApp messages (only when the WhatsApp Cloud API is connected, and only to patients who agreed):
    // tomorrow's reminders from 10 AM, same-day reminders about 2 hours before, and follow-up check-ins from 10 AM to 7 PM.
    if (minutes >= 10 * 60 && minutes < 21 * 60) await runReminderJob(db, getAppointment, addDays(date, 1));
    await runSoonReminders(db, getAppointment, { date, minutes });
    if (minutes >= 10 * 60 && minutes < 19 * 60) await runCheckinJob(db, { today: date, base: config.siteUrl || "https://tailbone.netlify.app", checkinsOn: isOn(db, "followup_checkins") });
    // Once a day (after 2 AM IST): encrypted backup, then retention clean-up.
    const dataDir = path.dirname(config.dbFile);
    const last = listBackups(dataDir)[0];
    if (minutes >= 120 && (!last || Date.now() - Date.parse(last.at) > 20 * 3600_000)) {
      // Separate steps: a failed backup (e.g. disk full) must not stop the retention clean-up, or the other way round.
      try { createBackup(db, dataDir); } catch (err) { console.error("Backup failed:", err.message); }
      const { erased } = runRetention(db);
      if (erased) console.log(`Retention: erased ${erased} inactive patient record(s).`);
    }
  } catch (err) {
    console.error("Background job failed:", err.message);
  }
}, 10 * 60_000);
jobs.unref();
// Bookings waiting for payment are checked with Razorpay every 2 minutes, so a patient who paid but closed the page
// (or whose bank app reloaded it) is confirmed quickly even if Razorpay's notification is late or not set up.
const payments = setInterval(() => { syncAwaitingPayments(db).catch((err) => console.error("Payment check failed:", err.message)); }, 2 * 60_000);
payments.unref();
if (!process.env.ENCRYPTION_KEY && config.isProd) console.warn("WARNING: ENCRYPTION_KEY is not set. A key file in the data folder is being used; set ENCRYPTION_KEY and keep a copy safe.");

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
