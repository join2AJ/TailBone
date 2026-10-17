import { Router } from "express";
import { CLINICS } from "../config.js";
import { requireAdmin, verifyPassword, hashPassword, createSessionCookie, clearSessionCookie, rateLimit } from "../auth.js";
import { clinicNow, addDays, isDate } from "../time.js";
import {
  HttpError, parseBooking, createAppointment, getAppointment, rescheduleAppointment, createFollowup,
  defaultFollowupDate, cleanText, normalizePhone, validEmail, siteUrl, waLink, messages, checkinMessage, FOLLOWUP_TYPES,
  normalizeInstagramUrl,
} from "../services.js";

const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id.");
  return n;
};

export function adminRoutes(db) {
  const r = Router();
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, message: "Too many sign-in attempts. Try again in 15 minutes." });

  // ---------- Auth ----------
  r.post("/login", loginLimit, (req, res) => {
    const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(cleanText(req.body.email, 200));
    if (!admin || !verifyPassword(String(req.body.password || ""), admin.password_hash)) {
      throw new HttpError(401, "Incorrect email or password.");
    }
    createSessionCookie(res, admin.id);
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  r.post("/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.use(requireAdmin(db));

  r.get("/me", (req, res) => res.json({ admin: req.admin, clinics: Object.values(CLINICS), today: clinicNow().date }));

  r.post("/password", (req, res) => {
    const row = db.prepare("SELECT password_hash FROM admins WHERE id = ?").get(req.admin.id);
    if (!verifyPassword(String(req.body.current || ""), row.password_hash)) throw new HttpError(400, "Current password is incorrect.");
    const next = String(req.body.next || "");
    if (next.length < 10) throw new HttpError(400, "New password must be at least 10 characters.");
    db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(hashPassword(next), req.admin.id);
    res.json({ ok: true });
  });

  // ---------- Helpers ----------
  const withLinks = (a, req) => {
    if (!a) return a;
    const base = siteUrl(req);
    const m = messages(a, base);
    return {
      ...a,
      links: {
        confirm: waLink(a.patient_phone, m.confirm),
        reminder: waLink(a.patient_phone, m.reminder),
        cancelled: waLink(a.patient_phone, m.cancelled),
        chat: `https://wa.me/${a.patient_phone}`,
      },
    };
  };
  const followupView = (f, req) => ({
    ...f,
    checkinUrl: `${siteUrl(req)}/checkin.html?t=${f.token}`,
    whatsappUrl: waLink(f.patient_phone, checkinMessage(f.patient_name, f.token, siteUrl(req))),
  });

  // ---------- Dashboard ----------
  r.get("/dashboard", (req, res) => {
    const today = clinicNow().date;
    const weekAgo = addDays(today, -7);
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const stats = {
      today: one("SELECT COUNT(*) n FROM appointments WHERE date = ? AND status IN ('pending','confirmed','completed')", today),
      pending: one("SELECT COUNT(*) n FROM appointments WHERE status = 'pending' AND date >= ?", today),
      upcoming7: one("SELECT COUNT(*) n FROM appointments WHERE date BETWEEN ? AND ? AND status IN ('pending','confirmed')", today, addDays(today, 7)),
      storiesPending: one("SELECT COUNT(*) n FROM stories WHERE status = 'pending'"),
      followupsDue: one("SELECT COUNT(*) n FROM followups WHERE status = 'pending' AND due_date <= ?", today),
      overdue: one("SELECT COUNT(*) n FROM followups WHERE status = 'pending' AND due_date < ?", today),
      newPatients30: one("SELECT COUNT(*) n FROM patients WHERE created_at >= datetime('now','-30 days')"),
      completed30: one("SELECT COUNT(*) n FROM appointments WHERE status = 'completed' AND date >= ?", addDays(today, -30)),
      avgPain7: db.prepare("SELECT ROUND(AVG(pain_score),1) n FROM checkins WHERE created_at >= datetime('now','-7 days')").get().n,
    };
    const schedule = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date = ? AND a.status != 'cancelled' ORDER BY a.time`,
    ).all(today).map((a) => withLinks(a, req));
    const tomorrow = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date = ? AND a.status IN ('pending','confirmed') ORDER BY a.time`,
    ).all(addDays(today, 1)).map((a) => withLinks(a, req));
    const due = db.prepare(
      `SELECT f.*, p.name patient_name, p.phone patient_phone FROM followups f JOIN patients p ON p.id = f.patient_id
       WHERE f.status = 'pending' AND f.due_date <= ? ORDER BY f.due_date LIMIT 20`,
    ).all(today).map((f) => followupView(f, req));
    const alerts = db.prepare(
      `SELECT c.*, p.name patient_name, p.id patient_id FROM checkins c JOIN patients p ON p.id = c.patient_id
       WHERE c.created_at >= ? AND (c.trend = 'worse' OR c.pain_score >= 7) ORDER BY c.created_at DESC LIMIT 10`,
    ).all(weekAgo);
    const trend = db.prepare(
      `SELECT date, COUNT(*) n FROM appointments WHERE date BETWEEN ? AND ? AND status != 'cancelled' GROUP BY date ORDER BY date`,
    ).all(addDays(today, -13), today);
    res.json({ today, stats, schedule, tomorrow, due, alerts, trend });
  });

  // ---------- Appointments ----------
  r.get("/appointments", (req, res) => {
    const where = [];
    const params = [];
    const { from, to, status, clinic, q } = req.query;
    if (isDate(from)) { where.push("a.date >= ?"); params.push(from); }
    if (isDate(to)) { where.push("a.date <= ?"); params.push(to); }
    if (STATUSES.includes(status)) { where.push("a.status = ?"); params.push(status); }
    if (CLINICS[clinic]) { where.push("a.clinic = ?"); params.push(clinic); }
    if (q) {
      const term = `%${cleanText(q, 80)}%`;
      where.push("(p.name LIKE ? OR p.phone LIKE ? OR a.ref LIKE ?)");
      params.push(term, term, term);
    }
    const order = req.query.order === "desc" ? "DESC" : "ASC";
    const rows = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email FROM appointments a JOIN patients p ON p.id = a.patient_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.date ${order}, a.time ${order} LIMIT 500`,
    ).all(...params);
    res.json({ appointments: rows.map((a) => withLinks(a, req)) });
  });

  r.post("/appointments", (req, res) => {
    const data = parseBooking(req.body, { allowAnyTime: true });
    const appt = createAppointment(db, data, { source: "admin", status: req.body.status === "pending" ? "pending" : "confirmed" });
    res.status(201).json({ appointment: withLinks(appt, req) });
  });

  r.get("/appointments/:id", (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    res.json({ appointment: withLinks(appt, req) });
  });

  r.patch("/appointments/:id", (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    let updated = appt;
    if (req.body.date || req.body.time) {
      updated = rescheduleAppointment(db, appt, req.body.date || appt.date, req.body.time || appt.time, { allowAnyTime: true });
    }
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) throw new HttpError(400, "Invalid status.");
      try {
        db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.status, appt.id);
      } catch (err) {
        if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Another active booking already holds that slot.");
        throw err;
      }
    }
    if (req.body.notes !== undefined) {
      db.prepare("UPDATE appointments SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(cleanText(req.body.notes, 4000), appt.id);
    }
    updated = getAppointment(db, appt.id);

    // Completing a visit can schedule the follow-up in the same step.
    let followup = null;
    if (req.body.status === "completed" && req.body.followup) {
      const f = req.body.followup;
      followup = createFollowup(db, {
        patientId: appt.patient_id,
        appointmentId: appt.id,
        dueDate: f.dueDate || defaultFollowupDate(),
        type: f.type || "checkin",
        notes: f.notes,
      });
      followup = followupView({ ...followup, patient_name: appt.patient_name, patient_phone: appt.patient_phone }, req);
    }
    res.json({ appointment: withLinks(updated, req), followup });
  });

  // ---------- Follow-ups ----------
  r.get("/followups", (req, res) => {
    const today = clinicNow().date;
    const view = req.query.view || "due";
    const filters = {
      overdue: ["f.status = 'pending' AND f.due_date < ?", [today], "f.due_date ASC"],
      due: ["f.status = 'pending' AND f.due_date <= ?", [today], "f.due_date ASC"],
      upcoming: ["f.status = 'pending' AND f.due_date > ?", [today], "f.due_date ASC"],
      done: ["f.status IN ('done','skipped')", [], "COALESCE(f.completed_at, f.due_date) DESC"],
    };
    const [where, params, order] = filters[view] || filters.due;
    const rows = db.prepare(
      `SELECT f.*, p.name patient_name, p.phone patient_phone,
         (SELECT pain_score FROM checkins c WHERE c.followup_id = f.id) AS pain_score,
         (SELECT trend FROM checkins c WHERE c.followup_id = f.id) AS trend
       FROM followups f JOIN patients p ON p.id = f.patient_id WHERE ${where} ORDER BY ${order} LIMIT 300`,
    ).all(...params);
    res.json({ followups: rows.map((f) => followupView(f, req)) });
  });

  r.post("/followups", (req, res) => {
    const patientId = id(req.body.patientId);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId);
    if (!patient) throw new HttpError(404, "Patient not found.");
    const f = createFollowup(db, {
      patientId,
      appointmentId: req.body.appointmentId ? id(req.body.appointmentId) : null,
      dueDate: req.body.dueDate || defaultFollowupDate(),
      type: req.body.type || "checkin",
      notes: req.body.notes,
    });
    res.status(201).json({ followup: followupView({ ...f, patient_name: patient.name, patient_phone: patient.phone }, req) });
  });

  r.patch("/followups/:id", (req, res) => {
    const fid = id(req.params.id);
    const f = db.prepare("SELECT * FROM followups WHERE id = ?").get(fid);
    if (!f) throw new HttpError(404, "Follow-up not found.");
    if (req.body.status !== undefined) {
      if (!["pending", "done", "skipped"].includes(req.body.status)) throw new HttpError(400, "Invalid status.");
      db.prepare("UPDATE followups SET status = ?, completed_at = CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END WHERE id = ?")
        .run(req.body.status, req.body.status, fid);
    }
    if (req.body.dueDate !== undefined) {
      if (!isDate(req.body.dueDate)) throw new HttpError(400, "Invalid date.");
      db.prepare("UPDATE followups SET due_date = ? WHERE id = ?").run(req.body.dueDate, fid);
    }
    if (req.body.type !== undefined) {
      if (!FOLLOWUP_TYPES.includes(req.body.type)) throw new HttpError(400, "Invalid type.");
      db.prepare("UPDATE followups SET type = ? WHERE id = ?").run(req.body.type, fid);
    }
    if (req.body.notes !== undefined) db.prepare("UPDATE followups SET notes = ? WHERE id = ?").run(cleanText(req.body.notes, 1000), fid);
    res.json({ ok: true });
  });

  r.delete("/followups/:id", (req, res) => {
    db.prepare("DELETE FROM followups WHERE id = ?").run(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Patients ----------
  r.get("/patients", (req, res) => {
    const term = `%${cleanText(req.query.q, 80)}%`;
    const rows = db.prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS visits,
         (SELECT MAX(date) FROM appointments a WHERE a.patient_id = p.id AND a.status != 'cancelled') AS last_date,
         (SELECT pain_score FROM checkins c WHERE c.patient_id = p.id ORDER BY c.created_at DESC LIMIT 1) AS last_pain
       FROM patients p WHERE p.name LIKE ? OR p.phone LIKE ? OR IFNULL(p.email,'') LIKE ?
       ORDER BY p.created_at DESC LIMIT 300`,
    ).all(term, term, term);
    res.json({ patients: rows });
  });

  r.get("/patients/:id", (req, res) => {
    const pid = id(req.params.id);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(pid);
    if (!patient) throw new HttpError(404, "Patient not found.");
    const appointments = db.prepare("SELECT a.*, ? patient_name, ? patient_phone FROM appointments a WHERE patient_id = ? ORDER BY date DESC, time DESC")
      .all(patient.name, patient.phone, pid).map((a) => withLinks(a, req));
    const followups = db.prepare("SELECT f.*, ? patient_name, ? patient_phone FROM followups f WHERE patient_id = ? ORDER BY due_date DESC")
      .all(patient.name, patient.phone, pid).map((f) => followupView(f, req));
    const checkins = db.prepare("SELECT * FROM checkins WHERE patient_id = ? ORDER BY created_at ASC").all(pid);
    const first = patient.name.split(" ")[0];
    const storyInvite = waLink(patient.phone, `Hi ${first}, we're so glad you're feeling better! Would you share a few words about your experience to help others with tailbone pain? It takes 2 minutes: ${siteUrl(req)}/stories.html#share`);
    res.json({ patient, appointments, followups, checkins, storyInvite });
  });

  r.patch("/patients/:id", (req, res) => {
    const pid = id(req.params.id);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(pid);
    if (!patient) throw new HttpError(404, "Patient not found.");
    const name = req.body.name !== undefined ? cleanText(req.body.name, 120) : patient.name;
    if (name.length < 2) throw new HttpError(400, "Name is too short.");
    const phone = req.body.phone !== undefined ? normalizePhone(req.body.phone) : patient.phone;
    if (!phone) throw new HttpError(400, "Invalid phone number.");
    const email = req.body.email !== undefined ? validEmail(req.body.email) || null : patient.email;
    const notes = req.body.notes !== undefined ? cleanText(req.body.notes, 8000) : patient.notes;
    try {
      db.prepare("UPDATE patients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?").run(name, phone, email, notes, pid);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Another patient already uses that phone number.");
      throw err;
    }
    res.json({ patient: db.prepare("SELECT * FROM patients WHERE id = ?").get(pid) });
  });

  // ---------- Stories ----------
  r.get("/stories", (req, res) => {
    const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    res.json({ stories: db.prepare("SELECT * FROM stories WHERE status = ? ORDER BY featured DESC, created_at DESC LIMIT 300").all(status) });
  });

  r.post("/stories", (req, res) => {
    const name = cleanText(req.body.name, 80);
    const body = cleanText(req.body.body, 2000);
    if (name.length < 2 || body.length < 10) throw new HttpError(400, "Name and story are required.");
    const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
    db.prepare("INSERT INTO stories (name, city, rating, title, body, duration, status, source, published_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', 'admin', datetime('now'))")
      .run(name, cleanText(req.body.city, 60), rating, cleanText(req.body.title, 100), body, cleanText(req.body.duration, 60));
    res.status(201).json({ ok: true });
  });

  r.patch("/stories/:id", (req, res) => {
    const sid = id(req.params.id);
    const story = db.prepare("SELECT * FROM stories WHERE id = ?").get(sid);
    if (!story) throw new HttpError(404, "Story not found.");
    const next = {
      status: ["pending", "approved", "rejected"].includes(req.body.status) ? req.body.status : story.status,
      featured: req.body.featured !== undefined ? (req.body.featured ? 1 : 0) : story.featured,
      title: req.body.title !== undefined ? cleanText(req.body.title, 100) : story.title,
      body: req.body.body !== undefined ? cleanText(req.body.body, 2000) : story.body,
      city: req.body.city !== undefined ? cleanText(req.body.city, 60) : story.city,
    };
    if (next.body.length < 10) throw new HttpError(400, "Story text is too short.");
    db.prepare(
      `UPDATE stories SET status = ?, featured = ?, title = ?, body = ?, city = ?,
         published_at = CASE WHEN ? = 'approved' THEN COALESCE(published_at, datetime('now')) ELSE published_at END
       WHERE id = ?`,
    ).run(next.status, next.featured, next.title, next.body, next.city, next.status, sid);
    res.json({ ok: true });
  });

  r.delete("/stories/:id", (req, res) => {
    db.prepare("DELETE FROM stories WHERE id = ?").run(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Instagram highlights ----------
  r.get("/media", (req, res) => {
    res.json({ media: db.prepare("SELECT * FROM media ORDER BY sort, id DESC").all() });
  });

  r.post("/media", (req, res) => {
    const ig = normalizeInstagramUrl(req.body.url);
    if (!ig) throw new HttpError(400, "Paste a link to an Instagram post or reel, e.g. https://www.instagram.com/reel/ABC123/");
    const sort = db.prepare("SELECT COALESCE(MIN(sort), 0) - 1 n FROM media").get().n;
    try {
      db.prepare("INSERT INTO media (url, kind, caption, sort) VALUES (?, ?, ?, ?)").run(ig.url, ig.kind, cleanText(req.body.caption, 140), sort);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "That post is already in the list.");
      throw err;
    }
    res.status(201).json({ ok: true });
  });

  r.patch("/media/:id", (req, res) => {
    const mid = id(req.params.id);
    if (req.body.visible !== undefined) db.prepare("UPDATE media SET visible = ? WHERE id = ?").run(req.body.visible ? 1 : 0, mid);
    if (req.body.caption !== undefined) db.prepare("UPDATE media SET caption = ? WHERE id = ?").run(cleanText(req.body.caption, 140), mid);
    if (req.body.move === "up" || req.body.move === "down") {
      const rows = db.prepare("SELECT id FROM media ORDER BY sort, id DESC").all().map((r0) => r0.id);
      const i = rows.indexOf(mid);
      const j = req.body.move === "up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < rows.length) {
        [rows[i], rows[j]] = [rows[j], rows[i]];
        const upd = db.prepare("UPDATE media SET sort = ? WHERE id = ?");
        rows.forEach((rid, k) => upd.run(k, rid));
      }
    }
    res.json({ ok: true });
  });

  r.delete("/media/:id", (req, res) => {
    db.prepare("DELETE FROM media WHERE id = ?").run(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Blocked dates ----------
  r.get("/blocked", (req, res) => {
    res.json({ blocked: db.prepare("SELECT * FROM blocked_dates WHERE date >= ? ORDER BY date").all(clinicNow().date) });
  });

  r.post("/blocked", (req, res) => {
    const clinic = req.body.clinic === "all" || CLINICS[req.body.clinic] ? req.body.clinic : null;
    if (!clinic || !isDate(req.body.date)) throw new HttpError(400, "Choose a clinic and date.");
    db.prepare("INSERT OR REPLACE INTO blocked_dates (clinic, date, reason) VALUES (?, ?, ?)").run(clinic, req.body.date, cleanText(req.body.reason, 200));
    const clashes = db.prepare(
      `SELECT COUNT(*) n FROM appointments WHERE date = ? AND status IN ('pending','confirmed') ${clinic === "all" ? "" : "AND clinic = ?"}`,
    ).get(...(clinic === "all" ? [req.body.date] : [req.body.date, clinic])).n;
    res.status(201).json({ ok: true, clashes });
  });

  r.delete("/blocked/:id", (req, res) => {
    db.prepare("DELETE FROM blocked_dates WHERE id = ?").run(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Export ----------
  r.get("/export/appointments.csv", (req, res) => {
    const rows = db.prepare(
      `SELECT a.ref, a.date, a.time, a.clinic, a.status, p.name, p.phone, IFNULL(p.email,'') email, a.reason, a.notes, a.source, a.created_at
       FROM appointments a JOIN patients p ON p.id = a.patient_id ORDER BY a.date DESC, a.time DESC`,
    ).all();
    // Prefix risky leading characters so spreadsheet apps don't evaluate them as formulas.
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ["ref", "date", "time", "clinic", "status", "name", "phone", "email", "reason", "notes", "source", "created_at"];
    const csv = [header.join(","), ...rows.map((r0) => header.map((h) => cell(r0[h])).join(","))].join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="appointments-${clinicNow().date}.csv"`);
    res.send(`﻿${csv}`);
  });

  return r;
}

