import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AES-256-GCM field encryption for sensitive free text (clinical notes, symptoms, check-in comments).
// Values are stored as "enc:v1:<iv>:<tag>:<ciphertext>" (base64url). Anything without the prefix is
// treated as legacy plaintext, so existing rows keep working and get encrypted on their next write.

const PREFIX = "enc:v1:";
const UNREADABLE = "[unreadable: encryption key changed]";
// Same folder as the database whatever directory the app is started from (config.js resolves DATA_DIR the same way).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let key = null;

function loadKey() {
  if (key) return key;
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters).");
    return key;
  }
  // Development and demo fallback: a key file next to the database. A real clinic must set ENCRYPTION_KEY (and keep a copy
  // safe): a key file lost with a server move would make every encrypted note unreadable.
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
    throw new Error("ENCRYPTION_KEY is not set. Generate one (see README) and keep a copy somewhere safe.");
  }
  const dir = path.resolve(ROOT, process.env.DATA_DIR || "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ".encryption-key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  return key;
}

export function encrypt(text) {
  if (text == null || text === "") return text ?? "";
  // Never save the "unreadable" placeholder over real data (it would destroy the original if the right key comes back).
  if (String(text).includes(UNREADABLE)) throw Object.assign(new Error("This record can't be read with the current encryption key, so it can't be saved. Check ENCRYPTION_KEY."), { status: 409 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

export function decrypt(value) {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value ?? "";
  const [ivB, tagB, ctB] = value.slice(PREFIX.length).split(":");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return UNREADABLE;
  }
}

/** Decrypt the named fields of a row (returns a new object). */
export function decryptFields(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) if (f in out) out[f] = decrypt(out[f]);
  return out;
}

/** Encrypt a whole file's bytes (used for backups): magic | iv | tag | ciphertext. */
export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from("TBBK1"), iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(buf) {
  if (buf.subarray(0, 5).toString() !== "TBBK1") throw new Error("Not a Tailbone backup file.");
  const iv = buf.subarray(5, 17);
  const tag = buf.subarray(17, 33);
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(33)), decipher.final()]);
}
