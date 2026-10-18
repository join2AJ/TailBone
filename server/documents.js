// Patient documents: files the clinic shares with a patient (treatment and exercise plans, visit summaries, reports) and,
// when the clinic switches it on, earlier reports a patient uploads before a visit.
// Files are encrypted (AES-256-GCM with ENCRYPTION_KEY) and kept in the database, so they are in every backup and are
// removed with the patient's data. Only PDF, JPEG and PNG are accepted, recognised by their content, not their name.
import crypto from "node:crypto";
import { encryptBuffer, decryptBuffer } from "./crypto.js";
import { cleanText, HttpError } from "./services.js";

export const KINDS = {
  plan: "Treatment & exercise plan",
  summary: "Visit summary",
  report: "Report",
  other: "Other document",
};
export const PATIENT_KINDS = ["report", "other"];
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_PATIENT = 50;

/** The real type of a file from its first bytes (the name and the browser's claim are ignored). */
export function sniff(buf) {
  if (buf.length > 4 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  return null;
}

const COLUMNS = "id, patient_id, appointment_id, kind, title, mime, size, uploaded_by, uploader_name, shared, created_at";

export function addDocument(db, { patientId, appointmentId = null, kind, title, data, uploadedBy, uploaderName = "", shared = false }) {
  if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, "Please choose a file.");
  if (data.length > MAX_BYTES) throw new HttpError(413, "That file is larger than 10 MB. Please send a smaller copy (a photo or a PDF).");
  const type = sniff(data);
  if (!type) throw new HttpError(415, "Only PDF, JPG and PNG files can be added.");
  if (!KINDS[kind]) throw new HttpError(400, "Please choose what kind of document this is.");
  const count = db.prepare("SELECT COUNT(*) n FROM documents WHERE patient_id = ?").get(patientId).n;
  if (count >= MAX_PER_PATIENT) throw new HttpError(409, "This patient already has the maximum number of documents. Remove an old one first.");
  const name = cleanText(title, 120) || KINDS[kind];
  const id = Number(db.prepare(
    `INSERT INTO documents (patient_id, appointment_id, kind, title, mime, size, uploaded_by, uploader_name, shared, data, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(patientId, appointmentId, kind, name, type.mime, data.length, uploadedBy, cleanText(uploaderName, 120), shared ? 1 : 0,
    encryptBuffer(data), crypto.createHash("sha256").update(data).digest("hex")).lastInsertRowid);
  return getDocument(db, id);
}

export const getDocument = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM documents WHERE id = ?`).get(id);

/** Documents of a patient. For the patient: what the clinic has shared, plus what they uploaded themselves. */
export function listDocuments(db, patientId, { forPatient = false } = {}) {
  const where = forPatient ? "AND (shared = 1 OR uploaded_by = 'patient')" : "";
  return db.prepare(`SELECT ${COLUMNS} FROM documents WHERE patient_id = ? ${where} ORDER BY created_at DESC, id DESC`).all(patientId)
    .map((d) => ({ ...d, shared: !!d.shared, kindLabel: KINDS[d.kind] || d.kind }));
}

/** The decrypted file, with a safe download name. */
export function readFile(db, id) {
  const row = db.prepare("SELECT title, mime, data FROM documents WHERE id = ?").get(id);
  if (!row) return null;
  const ext = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }[row.mime] || "bin";
  const base = row.title.replace(/[^\w .-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document";
  return { data: decryptBuffer(Buffer.from(row.data)), mime: row.mime, filename: `${base}.${ext}` };
}

/** Send a document as a download (never shown inline, so a crafted file can't run in the site's pages). */
export function sendFile(res, file) {
  res.set({
    "Content-Type": file.mime,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  res.send(file.data);
}
