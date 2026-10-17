import fs from "node:fs";
import path from "node:path";
import { encryptBuffer } from "./crypto.js";

// ISO 22301 / NIST CSF RC.RP: daily encrypted, point-in-time backups of the whole database.
// Files: <DATA_DIR>/backups/tailbone-YYYY-MM-DDTHH-MM.db.enc (AES-256-GCM with ENCRYPTION_KEY).
// Copy them off the server regularly (dashboard → Settings → Download latest backup).

export const backupDir = (dataDir) => path.join(dataDir, "backups");

export function createBackup(db, dataDir, { keep = 14 } = {}) {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, "-");
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // consistent snapshot while the app keeps running
  try {
    const out = path.join(dir, `tailbone-${stamp}.db.enc`);
    fs.writeFileSync(out, encryptBuffer(fs.readFileSync(tmp)), { mode: 0o600 });
    prune(dir, keep);
    return out;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function listBackups(dataDir) {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^tailbone-.*\.db\.enc$/.test(f))
    .map((f) => ({ file: f, path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter((f) => /^tailbone-.*\.db\.enc$/.test(f)).sort().reverse();
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
}
