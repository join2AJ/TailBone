import { Router } from "express";
import { CLINICS } from "../config.js";
import {
  requireAdmin, verifyPassword, hashPassword, createSessionCookie, clearSessionCookie, rateLimit,
  LOCKOUT, newTotpSecret, verifyTotp, totpUri, securityLog,
} from "../auth.js";
import { config } from "../config.js";
import { exportPatientData, erasePatient, readDataRequest, recordConsent, completeDataRequest, NOTICE_VERSION } from "../privacy.js";
import { createBackup, listBackups } from "../backup.js";
import { DEMO_ADMIN } from "../demo.js";
import { FEATURES, PERMISSIONS, DEFAULT_PERMISSIONS, getFeatures, saveFeatures, permissionsOf, sanitizePermissions } from "../features.js";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { gcalEnabled } from "../gcal.js";
import path from "node:path";
import fs from "node:fs";
import { clinicNow, addDays, isDate } from "../time.js";
import { encrypt, decrypt } from "../crypto.js";
import { getPolicy, savePolicy, refundQuote, policySummary, policyHistory } from "../policy.js";
import { paymentsEnabled, rupees } from "../payments.js";
import { notify, readNotification, whatsappApiEnabled } from "../notify.js";
import { listPosts, setEnabled } from "../blog.js";
import {
  HttpError, parseBooking, createAppointment, getAppointment, rescheduleAppointment, createFollowup,
  defaultFollowupDate, cleanText, normalizePhone, validEmail, siteUrl, waLink, messages, checkinMessage, FOLLOWUP_TYPES,
  normalizeInstagramUrl, readAppt, cancelAppointment, issueRefund, logEvent, appointmentEvents, prettyDate, prettyTime,
  calendarSync,
} from "../services.js";

const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const DUMMY_HASH = hashPassword("timing-equaliser-not-a-real-password");
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id.");
  return n;
};

/** Lower-case path without trailing slashes, for permission checks (defence in depth alongside the strict router). */
const canonicalPath = (req) => req.path.toLowerCase().replace(/\/+$/, "") || "/";

/** Send rows as a spreadsheet-safe CSV (Excel-friendly BOM; leading =+-@ are neutralised so cells are never run as formulas). */
function sendCsv(res, filename, header, rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [header.join(","), ...rows.map((r0) => header.map((h) => cell(r0[h])).join(","))].join("\r\n");
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\ufeff${csv}`);
}

export function adminRoutes(db) {
  // Case-sensitive and strict, so /SUPERADMIN or /refund/ can't reach a route while slipping past the permission rules below.
  const r = Router({ caseSensitive: true, strict: true });
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.LOGIN_RATE_MAX) || 10, message: "Too many sign-in attempts. Try again in 15 minutes." });

  // ---------- Auth ----------
  // Sign-in with per-account lockout and optional TOTP second factor.
  r.post("/login", loginLimit, (req, res) => {
    const email = cleanText(req.body.email, 200);
    const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(email);
    if (admin?.locked_until && admin.locked_until > new Date().toISOString()) {
      securityLog(db, req, "login_blocked_locked", email, null);
      throw new HttpError(423, `Too many failed attempts. The account is locked for up to ${LOCKOUT.minutes} minutes.`);
    }
    if (admin?.disabled) {
      securityLog(db, req, "login_blocked_disabled", email, null);
      throw new HttpError(403, "This account has been disabled. Contact the super admin.");
    }
    // Always run the (slow) password check, even for unknown emails, so response time doesn't reveal accounts.
    const passwordOk = verifyPassword(String(req.body.password || ""), admin?.password_hash || DUMMY_HASH) && !!admin;
    if (!passwordOk) {
      if (admin) {
        const fails = admin.failed_logins + 1;
        const lock = fails >= LOCKOUT.attempts ? new Date(Date.now() + LOCKOUT.minutes * 60_000).toISOString() : null;
        db.prepare("UPDATE admins SET failed_logins = ?, locked_until = ? WHERE id = ?").run(lock ? 0 : fails, lock, admin.id);
        securityLog(db, req, lock ? "account_locked" : "login_failed", email, null);
      } else {
        securityLog(db, req, "login_failed_unknown_user", email, null);
      }
      throw new HttpError(401, "Incorrect email or password.");
    }
    if (admin.totp_enabled) {
      if (!req.body.code) return res.status(401).json({ error: "Enter the 6-digit code from your authenticator app.", needCode: true });
      if (!verifyTotp(decrypt(admin.totp_secret), req.body.code)) {
        securityLog(db, req, "login_failed_2fa", email, admin);
        throw new HttpError(401, "That code didn't work. Check your phone's clock and try the newest code.");
      }
    }
    db.prepare("UPDATE admins SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").run(admin.id);
    createSessionCookie(res, admin);
    securityLog(db, req, "login", "", admin);
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  // One-click demo sign-in. Exists only when DEMO_MODE=true (separate sample database).
  r.post("/demo-login", loginLimit, (req, res) => {
    if (!config.demo) throw new HttpError(404, "Not found.");
    const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(DEMO_ADMIN.email);
    if (!admin) throw new HttpError(503, "Demo data is being reset. Try again in a minute.");
    createSessionCookie(res, admin);
    securityLog(db, req, "demo_login", "", admin);
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  });

  r.post("/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.use(requireAdmin(db));

  // In the demo, account-security actions are disabled so visitors can't lock each other out.
  const DEMO_BLOCKED = [/^\/password$/, /^\/2fa\//, /^\/sessions\/revoke$/, /^\/backups/];
  r.use((req, res, next) => {
    if (config.demo && DEMO_BLOCKED.some((rx) => rx.test(canonicalPath(req)))) return res.status(403).json({ error: "Disabled in the demo." });
    if (config.demo && canonicalPath(req).startsWith("/superadmin") && req.method !== "GET") return res.status(403).json({ error: "Viewing only in the demo: changes here would affect every demo visitor." });
    next();
  });

  // Section permissions. The super admin can do everything; other admins only what was granted.
  const RULES = [
    [/^\/superadmin/, "superadmin"], [/^\/backups/, "superadmin"], [/^\/security\/log/, "superadmin"],
    [/^\/appointments\/\d+\/refund$/, "payments"],
    [/^\/patients\/\d+\/(export|erase)$/, "privacy"],
    [/^\/appointments/, "appointments"], [/^\/followups/, "followups"], [/^\/patients/, "patients"],
    [/^\/notifications/, "inbox"], [/^\/stories/, "stories"], [/^\/media/, "instagram"], [/^\/blog/, "blog"],
    [/^\/payments/, "payments"], [/^\/privacy/, "privacy"],
    [/^\/settings\/policy$/, "settings", "PUT"], [/^\/blocked/, "settings"], [/^\/calendar/, "settings"],
    [/^\/export/, "export"],
  ];
  r.use((req, res, next) => {
    req.perms = permissionsOf(req.admin);
    const rule = RULES.find(([rx, , method]) => rx.test(canonicalPath(req)) && (!method || method === req.method));
    if (rule && !req.perms.includes(rule[1])) {
      return res.status(403).json({ error: rule[1] === "superadmin" ? "Only the super admin can do this." : "You don't have access to this section. Ask the super admin." });
    }
    next();
  });

  r.get("/me", (req, res) => res.json({
    demo: config.demo,
    admin: { id: req.admin.id, email: req.admin.email, name: req.admin.name, twoFactor: !!req.admin.totp_enabled, role: req.admin.role, permissions: req.perms },
    features: getFeatures(db),
    clinics: Object.values(CLINICS),
    today: clinicNow().date,
  }));

  r.post("/password", (req, res) => {
    const row = db.prepare("SELECT password_hash FROM admins WHERE id = ?").get(req.admin.id);
    if (!verifyPassword(String(req.body.current || ""), row.password_hash)) throw new HttpError(400, "Current password is incorrect.");
    const next = String(req.body.next || "");
    if (next.length < 10) throw new HttpError(400, "New password must be at least 10 characters.");
    // Changing the password signs out every other session.
    db.prepare("UPDATE admins SET password_hash = ?, session_version = session_version + 1 WHERE id = ?").run(hashPassword(next), req.admin.id);
    createSessionCookie(res, db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id));
    securityLog(db, req, "password_changed");
    res.json({ ok: true });
  });

  r.post("/sessions/revoke", (req, res) => {
    db.prepare("UPDATE admins SET session_version = session_version + 1 WHERE id = ?").run(req.admin.id);
    createSessionCookie(res, db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id));
    securityLog(db, req, "sessions_revoked");
    res.json({ ok: true });
  });

  // ---------- Two-factor authentication ----------
  r.post("/2fa/setup", (req, res) => {
    if (req.admin.totp_enabled) throw new HttpError(409, "Two-factor sign-in is already on.");
    const secret = newTotpSecret();
    db.prepare("UPDATE admins SET totp_secret = ? WHERE id = ?").run(encrypt(secret), req.admin.id);
    res.json({ secret: secret.match(/.{1,4}/g).join(" "), uri: totpUri(secret, req.admin.email) });
  });

  r.post("/2fa/enable", (req, res) => {
    const row = db.prepare("SELECT totp_secret FROM admins WHERE id = ?").get(req.admin.id);
    if (!row.totp_secret || !verifyTotp(decrypt(row.totp_secret), req.body.code)) throw new HttpError(400, "That code didn't match. Try the newest code from the app.");
    db.prepare("UPDATE admins SET totp_enabled = 1, session_version = session_version + 1 WHERE id = ?").run(req.admin.id);
    createSessionCookie(res, db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id));
    securityLog(db, req, "2fa_enabled");
    res.json({ ok: true });
  });

  r.post("/2fa/disable", (req, res) => {
    const row = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id);
    if (!verifyPassword(String(req.body.password || ""), row.password_hash) || !verifyTotp(decrypt(row.totp_secret), req.body.code)) {
      throw new HttpError(400, "Password or code is incorrect.");
    }
    db.prepare("UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(req.admin.id);
    securityLog(db, req, "2fa_disabled");
    res.json({ ok: true });
  });

  // ---------- Super admin: features and users ----------
  const userView = (a) => ({
    id: a.id, email: a.email, name: a.name, role: a.role, disabled: !!a.disabled, twoFactor: !!a.totp_enabled,
    lastLoginAt: a.last_login_at, createdAt: a.created_at, permissions: permissionsOf(a).filter((p) => p !== "superadmin"),
  });
  const activeSupers = () => db.prepare("SELECT COUNT(*) n FROM admins WHERE role = 'superadmin' AND disabled = 0").get().n;
  const tempPassword = () => crypto.randomBytes(9).toString("base64url");

  r.get("/superadmin", (req, res) => {
    res.json({
      features: getFeatures(db),
      featureInfo: FEATURES,
      permissionInfo: PERMISSIONS,
      defaultPermissions: DEFAULT_PERMISSIONS,
      users: db.prepare("SELECT * FROM admins ORDER BY role DESC, name").all().map(userView),
    });
  });

  r.put("/superadmin/features", (req, res) => {
    const before = getFeatures(db);
    const features = saveFeatures(db, req.body);
    const changed = Object.keys(features).filter((k) => features[k] !== before[k]).map((k) => `${k}=${features[k] ? "on" : "off"}`);
    if (changed.length) securityLog(db, req, "features_changed", changed.join(", "));
    res.json({ features });
  });

  r.post("/superadmin/users", (req, res) => {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const name = cleanText(req.body.name, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (name.length < 2) throw new HttpError(400, "Enter the person's name.");
    const role = req.body.role === "superadmin" ? "superadmin" : "admin";
    const perms = JSON.stringify(sanitizePermissions(req.body.permissions ?? DEFAULT_PERMISSIONS));
    const password = tempPassword();
    try {
      db.prepare("INSERT INTO admins (email, name, password_hash, role, permissions) VALUES (?, ?, ?, ?, ?)").run(email, name, hashPassword(password), role, perms);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "A user with that email already exists.");
      throw err;
    }
    securityLog(db, req, "user_created", `${email} (${role})`);
    res.status(201).json({ email, temporaryPassword: password });
  });

  r.patch("/superadmin/users/:id", (req, res) => {
    const uid = id(req.params.id);
    const user = db.prepare("SELECT * FROM admins WHERE id = ?").get(uid);
    if (!user) throw new HttpError(404, "User not found.");
    const isLastSuper = user.role === "superadmin" && !user.disabled && activeSupers() <= 1;
    const changes = [];
    if (req.body.role !== undefined && req.body.role !== user.role) {
      if (!["superadmin", "admin"].includes(req.body.role)) throw new HttpError(400, "Invalid role.");
      if (isLastSuper) throw new HttpError(409, "There must always be at least one super admin.");
      db.prepare("UPDATE admins SET role = ?, session_version = session_version + 1 WHERE id = ?").run(req.body.role, uid);
      changes.push(`role=${req.body.role}`);
    }
    if (req.body.permissions !== undefined) {
      db.prepare("UPDATE admins SET permissions = ? WHERE id = ?").run(JSON.stringify(sanitizePermissions(req.body.permissions)), uid);
      changes.push("permissions");
    }
    if (req.body.disabled !== undefined && !!req.body.disabled !== !!user.disabled) {
      if (req.body.disabled && uid === req.admin.id) throw new HttpError(409, "You can't disable your own account.");
      if (req.body.disabled && isLastSuper) throw new HttpError(409, "There must always be at least one super admin.");
      db.prepare("UPDATE admins SET disabled = ?, session_version = session_version + 1 WHERE id = ?").run(req.body.disabled ? 1 : 0, uid);
      changes.push(req.body.disabled ? "disabled" : "enabled");
    }
    let temporaryPassword = null;
    if (req.body.resetPassword) {
      temporaryPassword = tempPassword();
      db.prepare("UPDATE admins SET password_hash = ?, failed_logins = 0, locked_until = NULL, session_version = session_version + 1 WHERE id = ?").run(hashPassword(temporaryPassword), uid);
      changes.push("password reset");
    }
    if (req.body.reset2fa) {
      db.prepare("UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(uid);
      changes.push("2FA reset");
    }
    if (changes.length) securityLog(db, req, "user_updated", `${user.email}: ${changes.join(", ")}`);
    res.json({ user: userView(db.prepare("SELECT * FROM admins WHERE id = ?").get(uid)), temporaryPassword });
  });

  // ---------- Security log ----------
  r.get("/security/log", (req, res) => {
    res.json({ log: db.prepare("SELECT * FROM security_log ORDER BY id DESC LIMIT 300").all() });
  });

  // ---------- Privacy (DPDP / GDPR) ----------
  r.get("/privacy/requests", (req, res) => {
    const rows = db.prepare("SELECT * FROM data_requests ORDER BY (status IN ('open','verifying')) DESC, due_at ASC, id DESC LIMIT 300").all();
    res.json({ requests: rows.map(readDataRequest), noticeVersion: NOTICE_VERSION });
  });

  r.patch("/privacy/requests/:id", (req, res) => {
    const rid = id(req.params.id);
    const row = db.prepare("SELECT * FROM data_requests WHERE id = ?").get(rid);
    if (!row) throw new HttpError(404, "Request not found.");
    const status = ["open", "verifying", "completed", "rejected"].includes(req.body.status) ? req.body.status : row.status;
    const patientId = req.body.patientId ? id(req.body.patientId) : row.patient_id;
    // Completing a download / correction / deletion request carries it out (same as the automatic step).
    if (status === "completed" && ["access", "correction", "erasure"].includes(row.type) && patientId && ["open", "verifying"].includes(row.status)) {
      if (patientId !== row.patient_id) db.prepare("UPDATE data_requests SET patient_id = ? WHERE id = ?").run(patientId, rid);
      completeDataRequest(db, { ...row, patient_id: patientId }, { by: req.admin.name || req.admin.email, resolution: cleanText(req.body.resolution, 1000) });
      securityLog(db, req, "privacy_request_completed", row.ref);
      return res.json({ ok: true });
    }
    db.prepare(
      `UPDATE data_requests SET status = ?, resolution = ?, patient_id = ?,
         closed_at = CASE WHEN ? IN ('completed','rejected') THEN datetime('now') ELSE NULL END WHERE id = ?`,
    ).run(status, cleanText(req.body.resolution ?? row.resolution, 1000), patientId, status, rid);
    securityLog(db, req, `privacy_request_${status}`, row.ref);
    res.json({ ok: true });
  });

  r.get("/patients/:id/export", (req, res) => {
    const pid = id(req.params.id);
    const data = exportPatientData(db, pid);
    if (!data) throw new HttpError(404, "Patient not found.");
    securityLog(db, req, "patient_data_exported", `patient #${pid}`);
    res.set("Content-Disposition", `attachment; filename="patient-${pid}-data.json"`);
    res.json(data);
  });

  r.post("/patients/:id/erase", (req, res) => {
    const pid = id(req.params.id);
    const patient = db.prepare("SELECT name FROM patients WHERE id = ?").get(pid);
    if (!patient) throw new HttpError(404, "Patient not found.");
    if (cleanText(req.body.confirm, 120).toLowerCase() !== patient.name.toLowerCase()) throw new HttpError(400, "Type the patient's full name to confirm.");
    const result = erasePatient(db, pid);
    securityLog(db, req, "patient_erased", `patient #${pid}`);
    res.json(result);
  });

  // ---------- Backups ----------
  const dataDir = path.dirname(config.dbFile);
  r.get("/backups", (req, res) => {
    res.json({ backups: listBackups(dataDir).map(({ file, size, at }) => ({ file, size, at })) });
  });

  r.post("/backups", (req, res) => {
    const file = createBackup(db, dataDir);
    securityLog(db, req, "backup_created", path.basename(file));
    res.status(201).json({ file: path.basename(file) });
  });

  r.get("/backups/:file", (req, res) => {
    const match = listBackups(dataDir).find((b) => b.file === req.params.file);
    if (!match) throw new HttpError(404, "Backup not found.");
    securityLog(db, req, "backup_downloaded", match.file);
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${match.file}"`);
    fs.createReadStream(match.path).pipe(res);
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
      unread: one("SELECT COUNT(*) n FROM notifications WHERE audience = 'doctor' AND channel = 'dashboard' AND read_at IS NULL"),
      toSend: one("SELECT COUNT(*) n FROM notifications WHERE audience = 'patient' AND status IN ('manual','failed')"),
      collected30: one("SELECT COALESCE(SUM(amount_paid - amount_refunded), 0) n FROM appointments WHERE date BETWEEN ? AND ?", addDays(today, -30), today),
      collectedToday: one("SELECT COALESCE(SUM(amount_paid - amount_refunded), 0) n FROM appointments WHERE date = ?", today),
      collectedMonth: one("SELECT COALESCE(SUM(amount_paid - amount_refunded), 0) n FROM appointments WHERE date BETWEEN ? AND ?", `${today.slice(0, 8)}01`, today),
      // Fees still to collect at the clinic for today's visits.
      toCollectToday: one("SELECT COALESCE(SUM(fee), 0) n FROM appointments WHERE date = ? AND payment_status = 'pay_at_clinic' AND status IN ('pending','confirmed','completed')", today),
      toCollectCount: one("SELECT COUNT(*) n FROM appointments WHERE date = ? AND payment_status = 'pay_at_clinic' AND fee > 0 AND status IN ('pending','confirmed','completed')", today),
    };
    stats.collected30Text = rupees(stats.collected30);
    for (const k of ["collectedToday", "collectedMonth", "toCollectToday"]) stats[`${k}Text`] = rupees(stats[k]);
    const schedule = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email, p.patient_code FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date = ? AND a.status != 'cancelled' ORDER BY a.time`,
    ).all(today).map((a) => withLinks(readAppt(a), req));
    const tomorrow = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email, p.patient_code FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date = ? AND a.status IN ('pending','confirmed') ORDER BY a.time`,
    ).all(addDays(today, 1)).map((a) => withLinks(readAppt(a), req));
    const due = db.prepare(
      `SELECT f.*, p.name patient_name, p.phone patient_phone FROM followups f JOIN patients p ON p.id = f.patient_id
       WHERE f.status = 'pending' AND f.due_date <= ? ORDER BY f.due_date LIMIT 20`,
    ).all(today).map((f) => followupView(f, req));
    const alerts = db.prepare(
      `SELECT c.*, p.name patient_name, p.id patient_id FROM checkins c JOIN patients p ON p.id = c.patient_id
       WHERE c.created_at >= ? AND (c.trend = 'worse' OR c.pain_score >= 7) ORDER BY c.created_at DESC LIMIT 10`,
    ).all(weekAgo).map((c) => ({ ...c, notes: decrypt(c.notes) }));
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
      where.push("(p.name LIKE ? OR p.phone LIKE ? OR a.ref LIKE ? OR a.appt_no LIKE ? OR p.patient_code LIKE ?)");
      params.push(term, term, term, term, term);
    }
    const order = req.query.order === "desc" ? "DESC" : "ASC";
    const rows = db.prepare(
      `SELECT a.*, p.name patient_name, p.phone patient_phone, p.email patient_email, p.patient_code FROM appointments a JOIN patients p ON p.id = a.patient_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.date ${order}, a.time ${order} LIMIT 500`,
    ).all(...params);
    res.json({ appointments: rows.map((a) => withLinks(readAppt(a), req)) });
  });

  r.post("/appointments", (req, res) => {
    const data = parseBooking(req.body, { allowAnyTime: true });
    const appt = createAppointment(db, data, { source: "admin", status: req.body.status === "pending" ? "pending" : "confirmed", actorName: req.admin.name });
    recordConsent(db, appt.patient_id, ["care", ...(req.body.whatsappConsent ? ["whatsapp_updates"] : [])], "clinic_verbal");
    if (appt.status === "confirmed") notify(db, "confirmed", appt, { base: siteUrl(req) });
    res.status(201).json({ appointment: withLinks(appt, req) });
  });

  r.get("/appointments/:id", (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    const policy = getPolicy(db);
    res.json({
      appointment: withLinks(appt, req),
      events: appointmentEvents(db, appt.id),
      refunds: db.prepare("SELECT * FROM refunds WHERE appointment_id = ? ORDER BY id").all(appt.id),
      quotes: appt.amount_paid ? {
        clinic: refundQuote(appt, policy, { actor: "clinic" }),
        patient: refundQuote(appt, policy, { actor: "patient" }),
        noShow: refundQuote(appt, policy, { noShow: true }),
      } : null,
    });
  });

  // Every clinic-side change is logged and, where it affects the patient, sent to them automatically.
  r.patch("/appointments/:id", async (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    const base = siteUrl(req);
    const who = req.admin.name;
    const silent = !!req.body.silent; // e.g. fixing a typo in the time without messaging the patient

    if (req.body.notes !== undefined) {
      db.prepare("UPDATE appointments SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(encrypt(cleanText(req.body.notes, 4000)), appt.id);
    }

    if ((req.body.date && req.body.date !== appt.date) || (req.body.time && req.body.time !== appt.time)) {
      if (!["pending", "confirmed"].includes(appt.status)) throw new HttpError(409, "Only upcoming appointments can be moved.");
      const from = `${prettyDate(appt.date)} at ${prettyTime(appt.time)}`;
      const moved = rescheduleAppointment(db, appt, req.body.date || appt.date, req.body.time || appt.time, { allowAnyTime: true, actor: "clinic", actorName: who });
      if (!silent) notify(db, "rescheduled", moved, { base, actor: "clinic", from });
    }

    let refund = null;
    const status = req.body.status;
    if (status !== undefined && status !== appt.status) {
      if (!STATUSES.includes(status)) throw new HttpError(400, "Invalid status.");
      const current = getAppointment(db, appt.id);
      if (status === "cancelled" || status === "no_show") {
        ({ refund } = await cancelAppointment(db, current, { actor: "clinic", actorName: who, reason: cleanText(req.body.reason, 300), noShow: status === "no_show", base }));
      } else {
        try {
          db.prepare("UPDATE appointments SET status = ?, cancelled_by = NULL, updated_at = datetime('now') WHERE id = ?").run(status, appt.id);
        } catch (err) {
          if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Another active booking already holds that slot.");
          throw err;
        }
        logEvent(db, appt.id, "clinic", who, status);
        calendarSync(db, appt.id);
        if (status === "confirmed" && !silent) notify(db, "confirmed", getAppointment(db, appt.id), { base });
      }
    }
    const updated = getAppointment(db, appt.id);

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
    res.json({ appointment: withLinks(updated, req), followup, refund });
  });

  // Fee paid at the clinic (cash, UPI or card at the desk), so the payments report is complete.
  r.post("/appointments/:id/received", (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    const method = { cash: "Cash", upi: "UPI", card: "Card" }[req.body.method];
    if (!method) throw new HttpError(400, "Choose cash, UPI or card.");
    if (!appt.fee) throw new HttpError(400, "There is no fee on this appointment.");
    if (appt.payment_status !== "pay_at_clinic" && appt.payment_status !== "unpaid") throw new HttpError(409, "This fee is already settled online.");
    db.prepare("UPDATE appointments SET payment_status = 'paid', amount_paid = fee, payment_id = ? WHERE id = ? AND payment_status IN ('pay_at_clinic','unpaid')")
      .run(`clinic-${req.body.method}`, appt.id);
    logEvent(db, appt.id, "clinic", req.admin.name, "paid", `${rupees(appt.fee)} received at the clinic (${method})`);
    res.json({ appointment: withLinks(getAppointment(db, appt.id), req) });
  });

  // Manual or extra refund (e.g. goodwill, or completing a refund that failed at the bank).
  r.post("/appointments/:id/refund", async (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    const amount = Math.round(Number(req.body.amount) * 100);
    const refundable = appt.amount_paid - appt.amount_refunded;
    if (!(amount > 0) || amount > refundable) throw new HttpError(400, `Enter an amount between ₹1 and ${rupees(refundable)}.`);
    const refund = await issueRefund(db, appt, amount, { reason: cleanText(req.body.reason, 250) || "refund by clinic", actor: "clinic", actorName: req.admin.name });
    if (refund?.status !== "failed") notify(db, "refunded", getAppointment(db, appt.id), { base: siteUrl(req), amount: refund.amount });
    res.json({ refund, appointment: withLinks(getAppointment(db, appt.id), req) });
  });

  // ---------- Notifications ----------
  r.get("/notifications", (req, res) => {
    const audience = req.query.audience === "patient" ? "patient" : "doctor";
    const rows = audience === "doctor"
      ? db.prepare("SELECT n.*, a.ref FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id WHERE n.audience = 'doctor' AND n.channel = 'dashboard' ORDER BY n.id DESC LIMIT 100").all()
      : db.prepare("SELECT n.*, a.ref FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id WHERE n.audience = 'patient' ORDER BY (n.status IN ('manual','failed')) DESC, n.id DESC LIMIT 150").all();
    res.json({
      notifications: rows.map((n) => {
        const v = readNotification(n);
        return { ...v, sendUrl: audience === "patient" && v.recipient ? waLink(v.recipient, v.body) : null };
      }),
      automatic: whatsappApiEnabled(),
    });
  });

  r.post("/notifications/read-all", (req, res) => {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE audience = 'doctor' AND read_at IS NULL").run();
    res.json({ ok: true });
  });

  r.patch("/notifications/:id", (req, res) => {
    if (req.body.status === "sent") db.prepare("UPDATE notifications SET status = 'sent', error = '' WHERE id = ? AND audience = 'patient'").run(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Calendar ----------
  r.get("/calendar", (req, res) => {
    let row = db.prepare("SELECT value FROM settings WHERE key = 'calendar_feed_token'").get();
    if (!row) {
      const tokenValue = crypto.randomBytes(24).toString("base64url");
      db.prepare("INSERT INTO settings (key, value) VALUES ('calendar_feed_token', ?)").run(tokenValue);
      row = { value: tokenValue };
    }
    const failing = db.prepare("SELECT COUNT(*) n FROM appointments WHERE gcal_status IS NOT NULL AND gcal_status != 'synced' AND date >= date('now')").get().n;
    res.json({ feedUrl: `${siteUrl(req)}/api/calendar/${row.value}.ics`, googleSync: gcalEnabled(), failing });
  });

  r.post("/calendar/rotate", (req, res) => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('calendar_feed_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(crypto.randomBytes(24).toString("base64url"));
    securityLog(db, req, "calendar_feed_rotated");
    res.json({ ok: true });
  });

  r.get("/appointments/:id/qr.svg", async (req, res) => {
    const appt = getAppointment(db, id(req.params.id));
    if (!appt) throw new HttpError(404, "Appointment not found.");
    res.set("Content-Type", "image/svg+xml");
    res.send(await QRCode.toString(`${siteUrl(req)}/manage.html?ref=${appt.ref}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
  });

  // ---------- Fees & policies ----------
  r.get("/settings/policy", (req, res) => {
    const policy = getPolicy(db);
    if (req.admin.role !== "superadmin") delete policy.commission;
    res.json({ policy, summary: policySummary(getPolicy(db)), history: policyHistory(db), paymentsEnabled: paymentsEnabled(), whatsappApi: whatsappApiEnabled() });
  });

  r.put("/settings/policy", (req, res) => {
    const input = { ...req.body };
    if (req.admin.role !== "superadmin") delete input.commission; // only the super admin sets the platform fee
    const policy = savePolicy(db, input, req.admin);
    if (req.admin.role !== "superadmin") delete policy.commission;
    securityLog(db, req, "settings_changed", "fees & policies");
    res.json({ policy, summary: policySummary(policy), history: policyHistory(db) });
  });

  // ---------- Payments report ----------
  r.get("/payments/summary", (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : addDays(clinicNow().date, -30);
    const to = isDate(req.query.to) ? req.query.to : clinicNow().date;
    const t = db.prepare(
      `SELECT COUNT(*) bookings, COALESCE(SUM(amount_paid),0) collected, COALESCE(SUM(amount_refunded),0) refunded,
         COALESCE(SUM(CASE WHEN amount_paid > 0 THEN platform_fee * (amount_paid - amount_refunded) / amount_paid ELSE 0 END),0) platform
       FROM appointments WHERE amount_paid > 0 AND date BETWEEN ? AND ?`,
    ).get(from, to);
    const net = t.collected - t.refunded;
    const rows = db.prepare(
      `SELECT a.ref, a.date, a.time, a.clinic, a.status, a.payment_status, a.fee, a.amount_paid, a.amount_refunded, a.platform_fee, a.payment_id, p.name patient_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.amount_paid > 0 AND a.date BETWEEN ? AND ? ORDER BY a.date DESC, a.time DESC LIMIT 500`,
    ).all(from, to);
    res.json({
      from, to,
      totals: { bookings: t.bookings, collected: t.collected, refunded: t.refunded, net, platform: Math.round(t.platform), doctor: net - Math.round(t.platform) },
      rows,
    });
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
       FROM patients p WHERE p.name LIKE ? OR p.phone LIKE ? OR IFNULL(p.email,'') LIKE ? OR p.patient_code LIKE ?
       ORDER BY p.created_at DESC LIMIT 300`,
    ).all(term, term, term, term);
    res.json({ patients: rows });
  });

  r.get("/patients/:id", (req, res) => {
    const pid = id(req.params.id);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(pid);
    if (!patient) throw new HttpError(404, "Patient not found.");
    const appointments = db.prepare("SELECT a.*, ? patient_name, ? patient_phone FROM appointments a WHERE patient_id = ? ORDER BY date DESC, time DESC")
      .all(patient.name, patient.phone, pid).map((a) => withLinks(readAppt(a), req));
    const followups = db.prepare("SELECT f.*, ? patient_name, ? patient_phone FROM followups f WHERE patient_id = ? ORDER BY due_date DESC")
      .all(patient.name, patient.phone, pid).map((f) => followupView(f, req));
    securityLog(db, req, "patient_viewed", `patient #${pid}`);
    const checkins = db.prepare("SELECT * FROM checkins WHERE patient_id = ? ORDER BY created_at ASC").all(pid).map((c) => ({ ...c, notes: decrypt(c.notes) }));
    const consents = db.prepare("SELECT purpose, notice_version, source, given_at, withdrawn_at FROM consents WHERE patient_id = ? ORDER BY id").all(pid);
    patient.notes = decrypt(patient.notes);
    const first = patient.name.split(" ")[0];
    const storyInvite = waLink(patient.phone, `Hi ${first}, we're so glad you're feeling better! Would you share a few words about your experience to help others with tailbone pain? It takes 2 minutes: ${siteUrl(req)}/stories.html#share`);
    res.json({ patient, appointments, followups, checkins, consents, storyInvite });
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
    const notes = req.body.notes !== undefined ? encrypt(cleanText(req.body.notes, 8000)) : patient.notes;
    try {
      db.prepare("UPDATE patients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?").run(name, phone, email, notes, pid);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Another patient already uses that phone number.");
      throw err;
    }
    const saved = db.prepare("SELECT * FROM patients WHERE id = ?").get(pid);
    res.json({ patient: { ...saved, notes: decrypt(saved.notes) } });
  });

  // ---------- Stories ----------
  r.get("/stories", (req, res) => {
    const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    res.json({ stories: db.prepare(
      `SELECT s.*, p.patient_code, a.appt_no FROM stories s
       LEFT JOIN patients p ON p.id = s.patient_id LEFT JOIN appointments a ON a.id = s.appointment_id
       WHERE s.status = ? ORDER BY s.featured DESC, s.created_at DESC LIMIT 300`,
    ).all(status) });
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

  // ---------- Blog articles (show or hide) ----------
  r.get("/blog", (req, res) => res.json({ posts: listPosts(db) }));

  r.patch("/blog/:id", (req, res) => {
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "Say whether the article is shown (enabled: true or false)." });
    const pid = id(req.params.id);
    const post = listPosts(db).find((p) => p.id === pid);
    if (!post || !setEnabled(db, pid, req.body.enabled, req.admin.email)) return res.status(404).json({ error: "No article with that number." });
    securityLog(db, req, req.body.enabled ? "blog_post_shown" : "blog_post_hidden", `#${pid} ${post.slug}`);
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
  r.get("/payments/export.csv", (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : addDays(clinicNow().date, -30);
    const to = isDate(req.query.to) ? req.query.to : clinicNow().date;
    const rows = db.prepare(
      `SELECT a.appt_no, a.date, a.time, a.clinic, a.status, a.payment_status, p.patient_code, p.name, a.fee / 100.0 fee, a.amount_paid / 100.0 paid,
         a.amount_refunded / 100.0 refunded, (a.amount_paid - a.amount_refunded) / 100.0 net, a.platform_fee / 100.0 platform_fee, IFNULL(a.payment_id, '') payment_id
       FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.amount_paid > 0 AND a.date BETWEEN ? AND ? ORDER BY a.date, a.time`,
    ).all(from, to);
    const header = ["appt_no", "date", "time", "clinic", "status", "payment_status", "patient_code", "name", "fee", "paid", "refunded", "net", "platform_fee", "payment_id"];
    securityLog(db, req, "payments_csv_exported", `${from}..${to}, ${rows.length} rows`);
    sendCsv(res, `payments-${from}-to-${to}.csv`, header, rows);
  });

  r.get("/export/appointments.csv", (req, res) => {
    const rows = db.prepare(
      `SELECT a.ref, a.date, a.time, a.clinic, a.status, p.name, p.phone, IFNULL(p.email,'') email, a.reason, a.notes, a.source,
         a.fee / 100.0 fee, a.payment_status, a.amount_paid / 100.0 paid, a.amount_refunded / 100.0 refunded, a.created_at
       FROM appointments a JOIN patients p ON p.id = a.patient_id ORDER BY a.date DESC, a.time DESC`,
    ).all().map((r0) => ({ ...r0, reason: decrypt(r0.reason), notes: decrypt(r0.notes) }));
    const header = ["ref", "date", "time", "clinic", "status", "name", "phone", "email", "reason", "notes", "source", "fee", "payment_status", "paid", "refunded", "created_at"];
    securityLog(db, req, "appointments_csv_exported", `${rows.length} rows`);
    sendCsv(res, `appointments-${clinicNow().date}.csv`, header, rows);
  });

  return r;
}

