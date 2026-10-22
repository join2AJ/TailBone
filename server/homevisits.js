// "Doctor at your place": a family, company, hospital or group asks Dr Rajveer to come and treat patients in their city.
// The person asking pays the treatment fees plus travel both ways, meals and stay. Requests must start at least 7 days ahead
// so the clinic can plan; the clinic then discusses dates and costs with them and marks the request scheduled or declined.
import crypto from "node:crypto";
import { HttpError, cleanText, normalizePhone, validEmail } from "./services.js";
import { encrypt, decrypt } from "./crypto.js";
import { clinicNow, addDays, isDate } from "./time.js";

export const HOME_VISIT_MIN_DAYS = 7;
export const HOME_VISIT_STATUS = {
  new: "New", discussing: "Discussing", scheduled: "Scheduled", done: "Done", declined: "Declined", cancelled: "Cancelled",
};

export function createHomeVisit(db, body) {
  const name = cleanText(body.name, 120);
  if (name.length < 2) throw new HttpError(400, "Please enter your name.");
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Please enter a valid phone number.");
  const city = cleanText(body.city, 80);
  if (city.length < 2) throw new HttpError(400, "Please tell us the city.");
  const earliest = addDays(clinicNow().date, HOME_VISIT_MIN_DAYS);
  if (!isDate(body.dateFrom) || !isDate(body.dateTo)) throw new HttpError(400, "Please choose the dates you'd like.");
  if (body.dateFrom < earliest) throw new HttpError(400, `Please request at least ${HOME_VISIT_MIN_DAYS} days ahead (from ${earliest}), so the doctor can plan travel and clinic days.`);
  if (body.dateTo < body.dateFrom) throw new HttpError(400, "The last date must be on or after the first date.");
  if (body.dateTo > addDays(clinicNow().date, 365)) throw new HttpError(400, "Please choose dates within the next 12 months.");
  const patients = Math.round(Number(body.patients) || 1);
  if (patients < 1 || patients > 200) throw new HttpError(400, "Please enter the number of patients (1 to 200).");
  if (body.agree !== true) throw new HttpError(400, "Please confirm you'll cover the fees, travel, meals and stay.");
  const ref = `HV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  db.prepare(
    `INSERT INTO home_visits (ref, name, phone, email, organisation, city, details, patients, date_from, date_to, agreed_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(ref, name, phone, validEmail(body.email) || null, cleanText(body.organisation, 120), city, encrypt(cleanText(body.details, 2000)), patients, body.dateFrom, body.dateTo);
  return { ref, earliest };
}

export function listHomeVisits(db, status = "") {
  const rows = status && HOME_VISIT_STATUS[status]
    ? db.prepare("SELECT * FROM home_visits WHERE status = ? ORDER BY date_from").all(status)
    : db.prepare("SELECT * FROM home_visits ORDER BY CASE WHEN status IN ('new','discussing','scheduled') THEN 0 ELSE 1 END, date_from").all();
  return rows.map((v) => ({ ...v, details: decrypt(v.details), clinic_notes: decrypt(v.clinic_notes), statusLabel: HOME_VISIT_STATUS[v.status] }));
}

export function updateHomeVisit(db, id, body) {
  const v = db.prepare("SELECT * FROM home_visits WHERE id = ?").get(id);
  if (!v) throw new HttpError(404, "Request not found.");
  const status = body.status === undefined ? v.status : body.status;
  if (!HOME_VISIT_STATUS[status]) throw new HttpError(400, "Invalid status.");
  const notes = body.notes === undefined ? v.clinic_notes : encrypt(cleanText(body.notes, 4000));
  db.prepare("UPDATE home_visits SET status = ?, clinic_notes = ?, updated_at = datetime('now') WHERE id = ?").run(status, notes, id);
  return listHomeVisits(db).find((x) => x.id === id);
}
