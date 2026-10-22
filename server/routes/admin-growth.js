// Dashboard routes for growing the practice: Ads & insights, referral partners and payouts, "Doctor at your place"
// requests, and articles written in the dashboard. Mounted inside adminRoutes, after sign-in and permission checks.
import express from "express";
import { securityLog, hashPassword } from "../auth.js";
import { encrypt, decrypt } from "../crypto.js";
import { clinicNow, addDays, isDate } from "../time.js";
import { rupees } from "../payments.js";
import { HttpError, cleanText, normalizePhone, validEmail, waLink, siteUrl } from "../services.js";
import { insights } from "../profile.js";
import {
  PARTNER_KINDS, isKind, getReferralSettings, saveReferralSettings, newPartnerCode, partnerTotals, recordPayout, syncRewards,
} from "../referrals.js";
import { listHomeVisits, updateHomeVisit, HOME_VISIT_STATUS } from "../homevisits.js";
import {
  listArticles, saveArticle, publishArticle, deleteArticle, addMedia, previewBody, MEDIA_MAX_BYTES, renderArticle,
} from "../articles.js";
import { TAGS } from "../../scripts/build-blog.js";

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id.");
  return n;
};

export function growthRoutes(r, db, { sendCsv }) {
  // ---------- Ads & insights ----------
  r.get("/insights", (req, res) => {
    const today = clinicNow().date;
    const from = isDate(req.query.from) ? req.query.from : addDays(today, -89);
    const to = isDate(req.query.to) ? req.query.to : today;
    res.json(insights(db, { from, to }));
  });

  // ---------- Referral partners ----------
  const partnerRow = (p) => ({
    id: p.id, code: p.code, kind: p.kind, kindLabel: PARTNER_KINDS[p.kind], name: p.name, contactName: p.contact_name, phone: p.phone, email: p.email,
    city: p.city, status: p.status, hasLogin: !!p.password_hash, patientId: p.patient_id, createdAt: p.created_at, approvedAt: p.approved_at,
    ...partnerTotals(db, p.id),
  });

  r.get("/referrals", (req, res) => {
    const partners = db.prepare("SELECT * FROM partners ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, created_at DESC").all().map(partnerRow);
    const settings = getReferralSettings(db);
    const due = partners.filter((p) => p.due > 0);
    res.json({
      partners, kinds: PARTNER_KINDS, settings: { ...settings, firstBookingRupees: settings.firstBooking / 100, treatmentRupees: settings.treatment / 100 },
      totals: { due: due.reduce((t, p) => t + p.due, 0), partnersDue: due.length, paid: partners.reduce((t, p) => t + p.paid, 0) },
    });
  });

  r.put("/referrals/settings", (req, res) => {
    const s = saveReferralSettings(db, req.body);
    securityLog(db, req, "referral_settings_changed", `₹${s.firstBooking / 100} first booking, ₹${s.treatment / 100} per treatment, ${s.months} months`);
    res.json({ settings: { ...s, firstBookingRupees: s.firstBooking / 100, treatmentRupees: s.treatment / 100 } });
  });

  const cleanPartner = (b, existing = {}) => {
    const kind = b.kind ?? existing.kind;
    if (!isKind(kind)) throw new HttpError(400, "Please choose the type of partner.");
    const name = cleanText(b.name ?? existing.name, 120);
    if (name.length < 2) throw new HttpError(400, "Please enter the partner's name.");
    const phone = b.phone === undefined ? existing.phone ?? null : b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !phone) throw new HttpError(400, "Please enter a valid phone number.");
    return {
      kind, name, phone,
      email: b.email === undefined ? existing.email ?? null : validEmail(b.email) || null,
      contact_name: cleanText(b.contactName ?? existing.contact_name ?? "", 120),
      city: cleanText(b.city ?? existing.city ?? "", 60),
    };
  };

  r.post("/referrals/partners", (req, res) => {
    const p = cleanPartner(req.body);
    try {
      const pid = Number(db.prepare(`INSERT INTO partners (code, kind, name, contact_name, phone, email, city, payout_details, status, approved_at, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), ?)`)
        .run(newPartnerCode(db), p.kind, p.name, p.contact_name, p.phone, p.email, p.city, encrypt(cleanText(req.body.payoutDetails, 300)), req.admin.name).lastInsertRowid);
      securityLog(db, req, "partner_added", `partner #${pid}`);
      res.status(201).json({ partner: partnerRow(db.prepare("SELECT * FROM partners WHERE id = ?").get(pid)) });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "A partner with that phone number already exists.");
      throw err;
    }
  });

  r.get("/referrals/partners/:id", (req, res) => {
    const p = db.prepare("SELECT * FROM partners WHERE id = ?").get(id(req.params.id));
    if (!p) throw new HttpError(404, "Partner not found.");
    // The clinic sees the referred patients by name (the partner only ever sees initials).
    const patients = db.prepare(
      `SELECT p.id, p.name, p.patient_code, p.anonymised_at,
         (SELECT MIN(a.created_at) FROM appointments a WHERE a.patient_id = p.id AND a.referral_partner_id = ?) AS referred_at,
         (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS visits
       FROM patients p WHERE p.referred_by = ? ORDER BY referred_at DESC`,
    ).all(p.id, p.id);
    const rewards = db.prepare(
      `SELECT r.*, pt.name AS patient_name, a.appt_no, a.date FROM referral_rewards r
       LEFT JOIN patients pt ON pt.id = r.patient_id LEFT JOIN appointments a ON a.id = r.appointment_id
       WHERE r.partner_id = ? ORDER BY r.id DESC LIMIT 500`,
    ).all(p.id);
    const payouts = db.prepare("SELECT * FROM partner_payouts WHERE partner_id = ? ORDER BY id DESC").all(p.id);
    securityLog(db, req, "partner_viewed", `partner #${p.id}`);
    const shareText = `Hi! For tailbone (coccyx) pain I recommend Dr Rajveer Singh. Book here with my referral code ${p.code}: ${siteUrl(req)}/book?ref=${p.code}`;
    res.json({
      partner: { ...partnerRow(p), payoutDetails: decrypt(p.payout_details), notes: decrypt(p.notes) },
      patients, rewards, payouts,
      links: { book: `${siteUrl(req)}/book?ref=${p.code}`, whatsapp: p.phone ? waLink(p.phone, `Your Tailbone Treatment referral ID is ${p.code}. Share this link: ${siteUrl(req)}/book?ref=${p.code}. Partner page: ${siteUrl(req)}/partner.html`) : null, share: shareText },
    });
  });

  r.patch("/referrals/partners/:id", (req, res) => {
    const pid = id(req.params.id);
    const existing = db.prepare("SELECT * FROM partners WHERE id = ?").get(pid);
    if (!existing) throw new HttpError(404, "Partner not found.");
    const p = cleanPartner(req.body, existing);
    const status = req.body.status ?? existing.status;
    if (!["pending", "active", "suspended"].includes(status)) throw new HttpError(400, "Invalid status.");
    const payout = req.body.payoutDetails === undefined ? existing.payout_details : encrypt(cleanText(req.body.payoutDetails, 300));
    const notes = req.body.notes === undefined ? existing.notes : encrypt(cleanText(req.body.notes, 2000));
    let password = existing.password_hash;
    let version = existing.session_version;
    if (req.body.newPassword) {
      if (String(req.body.newPassword).length < 8) throw new HttpError(400, "The new password must be at least 8 characters.");
      password = hashPassword(String(req.body.newPassword));
      version += 1;
    }
    try {
      db.prepare(`UPDATE partners SET kind = ?, name = ?, contact_name = ?, phone = ?, email = ?, city = ?, payout_details = ?, notes = ?, status = ?,
        password_hash = ?, session_version = ?, failed_logins = CASE WHEN ? THEN 0 ELSE failed_logins END, locked_until = CASE WHEN ? THEN NULL ELSE locked_until END,
        approved_at = CASE WHEN ? = 'active' AND approved_at IS NULL THEN datetime('now') ELSE approved_at END,
        approved_by = CASE WHEN ? = 'active' AND approved_by IS NULL THEN ? ELSE approved_by END WHERE id = ?`)
        .run(p.kind, p.name, p.contact_name, p.phone, p.email, p.city, payout, notes, status, password, version, req.body.newPassword ? 1 : 0, req.body.newPassword ? 1 : 0,
          status, status, req.admin.name, pid);
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) throw new HttpError(409, "Another partner already uses that phone number.");
      throw err;
    }
    if (status !== existing.status) securityLog(db, req, `partner_${status}`, `partner #${pid}`);
    if (req.body.newPassword) securityLog(db, req, "partner_password_reset", `partner #${pid}`);
    res.json({ partner: partnerRow(db.prepare("SELECT * FROM partners WHERE id = ?").get(pid)) });
  });

  r.post("/referrals/partners/:id/payout", (req, res) => {
    const pid = id(req.params.id);
    if (!db.prepare("SELECT 1 FROM partners WHERE id = ?").get(pid)) throw new HttpError(404, "Partner not found.");
    const out = recordPayout(db, pid, { method: req.body.method, reference: req.body.reference, notes: req.body.notes, by: req.admin.name });
    securityLog(db, req, "partner_paid", `partner #${pid}: ${rupees(out.amount)}`);
    res.status(201).json({ payout: out });
  });

  // Withdraw a reward by hand (e.g. a duplicate patient), or restore it.
  r.patch("/referrals/rewards/:id", (req, res) => {
    const rw = db.prepare("SELECT * FROM referral_rewards WHERE id = ?").get(id(req.params.id));
    if (!rw) throw new HttpError(404, "Reward not found.");
    if (rw.status === "paid") throw new HttpError(409, "This reward has already been paid.");
    if (req.body.status === "void") {
      db.prepare("UPDATE referral_rewards SET status = 'void', note = ? WHERE id = ?").run(`Withdrawn by ${req.admin.name}${req.body.reason ? `: ${cleanText(req.body.reason, 200)}` : ""}`, rw.id);
    } else if (req.body.status === "earned") {
      db.prepare("UPDATE referral_rewards SET status = 'earned', note = ? WHERE id = ?").run(`Restored by ${req.admin.name}`, rw.id);
    } else throw new HttpError(400, "Invalid status.");
    res.json({ ok: true });
  });

  // Link a patient to a partner by hand (e.g. the referral was mentioned on the phone), or remove the link.
  r.put("/patients/:id/referrer", (req, res) => {
    const pid = id(req.params.id);
    const patient = db.prepare("SELECT id FROM patients WHERE id = ?").get(pid);
    if (!patient) throw new HttpError(404, "Patient not found.");
    if (!req.body.code) {
      // Unpaid rewards for this patient go; amounts already paid stay on record.
      db.prepare("DELETE FROM referral_rewards WHERE patient_id = ? AND status != 'paid'").run(pid);
      securityLog(db, req, "patient_referrer_removed", `patient #${pid}`);
      db.prepare("UPDATE appointments SET referral_partner_id = NULL WHERE patient_id = ?").run(pid);
      db.prepare("UPDATE patients SET referred_by = NULL WHERE id = ?").run(pid);
      return res.json({ referrer: null });
    }
    const code = String(req.body.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const partner = db.prepare("SELECT * FROM partners WHERE code = ?").get(`REF-${code.replace(/^REF/, "")}`);
    if (!partner) throw new HttpError(404, "No partner has that referral code.");
    if (partner.patient_id === pid) throw new HttpError(400, "A patient can't refer themselves.");
    if (partner.status !== "active") throw new HttpError(409, "That partner isn't active. Approve or resume them first.");
    const first = db.prepare("SELECT id FROM appointments WHERE patient_id = ? AND status != 'cancelled' ORDER BY date, time LIMIT 1").get(pid);
    db.prepare("UPDATE patients SET referred_by = ? WHERE id = ?").run(partner.id, pid);
    db.prepare("UPDATE appointments SET referral_partner_id = NULL WHERE patient_id = ?").run(pid);
    if (first) db.prepare("UPDATE appointments SET referral_partner_id = ? WHERE id = ?").run(partner.id, first.id);
    // Rewards for visits that already happened move to the new partner (unpaid ones only; paid ones stay on record).
    db.prepare("DELETE FROM referral_rewards WHERE patient_id = ? AND partner_id != ? AND status != 'paid'").run(pid, partner.id);
    for (const a of db.prepare("SELECT id FROM appointments WHERE patient_id = ?").all(pid)) syncRewards(db, a.id);
    securityLog(db, req, "patient_referrer_set", `patient #${pid} → partner #${partner.id}`);
    res.json({ referrer: { id: partner.id, code: partner.code, name: partner.name } });
  });

  // What to pay this month: one line per partner with money due, for the accountant or the bank.
  r.get("/referrals/due.csv", (req, res) => {
    const rows = db.prepare(
      `SELECT p.code, p.name, p.kind, p.phone, p.payout_details, SUM(r.amount) AS amount, COUNT(*) AS items
       FROM referral_rewards r JOIN partners p ON p.id = r.partner_id WHERE r.status = 'earned' GROUP BY p.id ORDER BY p.name`,
    ).all();
    securityLog(db, req, "referral_due_exported");
    sendCsv(res, `referral-payouts-${clinicNow().date}.csv`, ["Referral ID", "Partner", "Type", "Phone", "Pay to (UPI / bank)", "Rewards", "Amount (₹)"],
      rows.map((x) => ({ "Referral ID": x.code, Partner: x.name, Type: PARTNER_KINDS[x.kind], Phone: x.phone ? `+${x.phone}` : "", "Pay to (UPI / bank)": decrypt(x.payout_details), Rewards: x.items, "Amount (₹)": (x.amount / 100).toFixed(2) })));
  });

  // ---------- Doctor at your place ----------
  r.get("/home-visits", (req, res) => res.json({ requests: listHomeVisits(db, req.query.status).map((v) => ({
    ...v, whatsapp: waLink(v.phone, `Hi ${v.name.split(" ")[0]}, this is Dr Rajveer Singh's team about your request ${v.ref} for a visit to ${v.city}.`),
  })), statuses: HOME_VISIT_STATUS }));

  r.patch("/home-visits/:id", (req, res) => {
    const v = updateHomeVisit(db, id(req.params.id), req.body);
    res.json({ request: v });
  });

  // ---------- Articles written in the dashboard ----------
  r.get("/articles", (req, res) => res.json({ articles: listArticles(db), tags: TAGS }));

  r.post("/articles", (req, res) => {
    const aid = saveArticle(db, null, req.body, req.admin.name);
    securityLog(db, req, "article_created", `#${aid}`);
    res.status(201).json({ article: listArticles(db).find((a) => a.id === aid) });
  });

  r.put("/articles/:id", (req, res) => {
    const aid = saveArticle(db, id(req.params.id), req.body, req.admin.name);
    res.json({ article: listArticles(db).find((a) => a.id === aid) });
  });

  r.post("/articles/:id/publish", (req, res) => {
    publishArticle(db, id(req.params.id), req.body.publish !== false, req.admin.name);
    securityLog(db, req, req.body.publish === false ? "article_unpublished" : "article_published", `#${req.params.id}`);
    res.json({ article: listArticles(db).find((a) => a.id === Number(req.params.id)) });
  });

  r.delete("/articles/:id", (req, res) => {
    deleteArticle(db, id(req.params.id));
    securityLog(db, req, "article_deleted", `#${req.params.id}`);
    res.json({ ok: true });
  });

  r.post("/articles/preview", (req, res) => res.json({ html: previewBody(req.body.body) }));

  // Full-page preview of a draft, exactly as it will look on the site.
  r.get("/articles/:id/preview", (req, res) => {
    const a = listArticles(db).find((x) => x.id === id(req.params.id));
    if (!a) throw new HttpError(404, "Article not found.");
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }).send(renderArticle(db, a.slug, { preview: true }));
  });

  // Picture, audio or video for an article: the file is the body; its name travels in the query.
  r.post("/articles/media", express.raw({ type: () => true, limit: MEDIA_MAX_BYTES + 1024 }), (req, res) => {
    const media = addMedia(db, req.query.name, req.body);
    securityLog(db, req, "article_media_added", `media #${media.id}`);
    res.status(201).json({ media });
  });
}
