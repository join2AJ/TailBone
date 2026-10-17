// Usage: npm run backup:restore -- <backup.db.enc> <output.db>
// Decrypts a backup with ENCRYPTION_KEY (or data/.encryption-key). Stop the server, then replace
// the DB file (DB_FILE or data/tailbone.db) with the output and start again. See docs/compliance/04.
import fs from "node:fs";
import { decryptBuffer } from "../server/crypto.js";
import { DatabaseSync } from "node:sqlite";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: npm run backup:restore -- <backup.db.enc> <output.db>");
  process.exit(1);
}
if (fs.existsSync(output)) {
  console.error(`Refusing to overwrite ${output}. Choose a new file name.`);
  process.exit(1);
}
fs.writeFileSync(output, decryptBuffer(fs.readFileSync(input)), { mode: 0o600 });
const db = new DatabaseSync(output);
const check = db.prepare("PRAGMA integrity_check").get();
const counts = ["patients", "appointments", "followups"].map((t) => `${t}: ${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`);
db.close();
console.log(`Restored to ${output} · integrity ${Object.values(check)[0]} · ${counts.join(", ")}`);
