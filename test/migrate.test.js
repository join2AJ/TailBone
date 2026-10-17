import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailbone-mig-"));
Object.assign(process.env, { DATA_DIR: tmp, SESSION_SECRET: "test-secret" });
const { openDb } = await import("../server/db.js");

test("databases created before the Lucknow clinic accept Lucknow bookings after upgrade", () => {
  const file = path.join(tmp, "old.db");
  // Recreate the old CHECK constraint, as in a database made by an earlier release.
  let db = openDb(file);
  db.exec("PRAGMA writable_schema = ON");
  db.prepare("UPDATE sqlite_master SET sql = replace(sql, '''lko'',', '') WHERE name IN ('appointments','blocked_dates')").run();
  const v = db.prepare("PRAGMA schema_version").get().schema_version;
  db.exec(`PRAGMA schema_version = ${v + 1}; PRAGMA writable_schema = OFF`);
  db.close();
  db = openDb(file);
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'appointments'").get().sql.includes("'lko'"), "constraint widened");
  db.prepare("INSERT INTO patients (name, phone) VALUES ('A B', '919800000001')").run();
  db.prepare("INSERT INTO appointments (ref, patient_id, clinic, date, time) VALUES ('TB-L1', 1, 'lko', '2030-01-02', '10:00')").run();
  db.prepare("INSERT INTO blocked_dates (clinic, date) VALUES ('lko', '2030-01-03')").run();
  assert.throws(() => db.prepare("INSERT INTO appointments (ref, patient_id, clinic, date, time) VALUES ('TB-X1', 1, 'xyz', '2030-01-02', '11:00')").run(), /CHECK/);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
