import { config, CLINICS } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import { rupees } from "./payments.js";
import { hasConsent } from "./privacy.js";

// Notifications go to two audiences:
//  - patient: WhatsApp Cloud API when configured, otherwise queued as "manual" with a one-tap wa.me link
//  - doctor:  always shown in the dashboard feed; also emailed (Resend) and/or WhatsApp'd when configured
//
// Env (all optional):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID      Meta WhatsApp Cloud API credentials
//   WHATSAPP_TEMPLATE=clinic_update, WHATSAPP_TEMPLATE_LANG=en, WHATSAPP_TEMPLATE_LANG_HI=hi
//       An approved Utility template with one variable {{1}} (the message text), in English and in Hindi. See DEPLOY.md.
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET    for WhatsApp's webhook: delivery receipts and replies such as STOP
//   DOCTOR_WHATSAPP=91XXXXXXXXXX                  also notify the doctor on WhatsApp
//   RESEND_API_KEY, EMAIL_FROM, DOCTOR_EMAIL      email the doctor about patient-side changes

const env = (k) => process.env[k] || "";
const isDemo = () => env("DEMO_MODE") === "true"; // never message real people from the demo
export const whatsappApiEnabled = () => !isDemo() && !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"));
const emailEnabled = () => !isDemo() && !!(env("RESEND_API_KEY") && env("EMAIL_FROM") && env("DOCTOR_EMAIL"));

// ---------- Channels (swappable for tests) ----------
let senders = {
  /** Send `text` inside the approved template (in Hindi for Hindi-speaking patients). Returns WhatsApp's message id. */
  async whatsapp(to, text, lang = "en") {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env("WHATSAPP_TEMPLATE") || "clinic_update",
          language: { code: lang === "hi" ? env("WHATSAPP_TEMPLATE_LANG_HI") || "hi" : env("WHATSAPP_TEMPLATE_LANG") || "en" },
          // Template variables can't contain newlines or long runs of spaces.
          components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json().catch(() => ({})))?.messages?.[0]?.id || null;
  },
  async email(subject, text) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env("EMAIL_FROM"), to: [env("DOCTOR_EMAIL")], subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Email API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};
export function setSenders(overrides) {
  senders = { ...senders, ...overrides };
}

// ---------- Message text (English and Hindi; the patient's language is set by the site they booked on) ----------
const prettyDate = (date, lang = "en") => new Date(`${date}T00:00:00Z`).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const prettyTime = (time) => { const [h, m] = time.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const when = (a, lang = "en") => (lang === "hi" ? `${prettyDate(a.date, lang)}, ${prettyTime(a.time)}` : `${prettyDate(a.date)} at ${prettyTime(a.time)}`);
const CLINIC_HI = { del: "नई दिल्ली", online: "ऑनलाइन", lko: "लखनऊ", blr: "बेंगलुरु" };

const paymentLine = (a, hi) => {
  if (a.payment_status === "paid") return hi ? `${rupees(a.amount_paid)} का भुगतान हो गया है।` : `Paid ${rupees(a.amount_paid)}.`;
  if (a.payment_status === "pay_at_clinic" || a.payment_status === "unpaid") {
    if (!a.fee) return "";
    return hi ? `फ़ीस ${rupees(a.fee)}, क्लिनिक पर देनी है।` : `Fee ${rupees(a.fee)}, payable at the clinic.`;
  }
  return "";
};

/** Build { patient, doctor } texts for an event. `extra` carries old times, refund info, etc. Doctor texts are always English. */
export function compose(event, a, base, extra = {}) {
  const hi = (a.patient_lang || a.lang) === "hi";
  const L = hi ? "hi" : "en";
  const first = a.patient_name.split(" ")[0];
  const where = CLINICS[a.clinic];
  const place = hi ? CLINIC_HI[a.clinic] || where.short : where.short;
  const no = a.appt_no || a.ref; // the appointment number is the patient's reference
  const manage = `${base}/manage.html?ref=${no}`;
  const book = `${base}${hi ? "/hi/book" : "/book"}`;
  const t = when(a, L);
  const online = a.clinic === "online";
  const refund = extra.refund
    ? (hi ? ` रिफ़ंड: ${rupees(extra.refund.amount)} (${extra.refund.percent}%)। यह 5–7 कामकाजी दिनों में उसी खाते/कार्ड में आ जाएगा।`
      : ` Refund: ${rupees(extra.refund.amount)} (${extra.refund.percent}%). It reaches the original payment method in 5–7 working days.`)
    : "";
  const who = `${a.patient_name}${a.patient_code ? ` ${a.patient_code}` : ""} (+${a.patient_phone})`;
  const joinEn = "Join the video call from My appointments (the button appears 15 minutes before)";
  const joinHi = "वीडियो कॉल My appointments से जुड़ें (बटन 15 मिनट पहले दिखेगा)";
  switch (event) {
    case "booked":
      return {
        patient: hi
          ? (a.status === "confirmed"
            ? `नमस्ते ${first}, टेलबोन ट्रीटमेंट क्लिनिक में आपकी अपॉइंटमेंट ${no} ${t} (${place}) के लिए पक्की हो गई है। ${paymentLine(a, true)} बदलाव या रद्द करने के लिए: ${manage}`
            : `नमस्ते ${first}, टेलबोन ट्रीटमेंट क्लिनिक में आपकी बुकिंग ${no} ${t} (${place}) के लिए मिल गई है। ${paymentLine(a, true)} हम जल्द ही पक्का करेंगे। बदलाव के लिए: ${manage}`)
          : (a.status === "confirmed"
            ? `Hi ${first}, your appointment ${no} at Tailbone Treatment Clinic is confirmed for ${t} (${where.short}). ${paymentLine(a)} Manage or reschedule: ${manage}`
            : `Hi ${first}, your booking ${no} at Tailbone Treatment Clinic is received for ${t} (${where.short}). ${paymentLine(a)} We'll confirm shortly. Manage or reschedule: ${manage}`),
        doctor: `New booking ${no}: ${who}, ${when(a)}, ${where.short}. ${a.visit_type === "followup" ? "Follow-up visit. " : ""}${paymentLine(a)}${hi ? " (Patient chose Hindi.)" : ""}`,
      };
    case "confirmed":
      return {
        patient: hi
          ? `नमस्ते ${first}, आपकी अपॉइंटमेंट ${no} ${t} के लिए पक्की है${online ? `, ऑनलाइन। ${joinHi}` : `, ${place} क्लिनिक: ${where.address}`}। बदलाव के लिए: ${manage}`
          : `Hi ${first}, your appointment ${no} is confirmed for ${t} at our ${where.short} ${online ? `online consultation. ${joinEn}` : `clinic, ${where.address}`}. Manage: ${manage}`,
      };
    case "rescheduled":
      if (extra.actor === "clinic") {
        return {
          patient: hi
            ? `नमस्ते ${first}, क्लिनिक ने आपकी अपॉइंटमेंट ${no} का समय ${extra.from} से बदलकर ${t} (${place}) कर दिया है। अगर यह समय ठीक न हो, तो बिना शुल्क बदलें या रद्द करें: ${manage}`
            : `Hi ${first}, the clinic has moved your appointment ${no} from ${extra.from} to ${t} (${where.short}). If this doesn't suit you, reschedule or cancel free of charge: ${manage}`,
        };
      }
      return {
        patient: hi ? `नमस्ते ${first}, आपकी अपॉइंटमेंट ${no} अब ${t} (${place}) है। बदलाव के लिए: ${manage}` : `Hi ${first}, your appointment ${no} is now ${t} (${where.short}). Manage: ${manage}`,
        doctor: `Rescheduled by patient: ${no} ${who} moved from ${extra.from} to ${when(a)} (${where.short}).`,
      };
    case "cancelled":
      if (extra.actor === "clinic") {
        return {
          patient: hi
            ? `नमस्ते ${first}, हमें खेद है: क्लिनिक को आपकी ${t} की अपॉइंटमेंट ${no} रद्द करनी पड़ी।${refund} नया समय चुनें: ${book}`
            : `Hi ${first}, we're sorry: the clinic had to cancel your appointment ${no} on ${t}.${refund} Book a new time: ${book}`,
        };
      }
      return {
        patient: hi ? `नमस्ते ${first}, आपकी ${t} की अपॉइंटमेंट ${no} रद्द हो गई है।${refund} कभी भी दोबारा बुक करें: ${book}` : `Hi ${first}, your appointment ${no} on ${t} is cancelled.${refund} Book again any time: ${book}`,
        doctor: `Cancelled by patient: ${no} ${who}, ${when(a)}, ${where.short}.${extra.refund ? ` Refund ${rupees(extra.refund.amount)} (${extra.refund.percent}%) per policy.` : ""}${extra.reason ? ` Reason: ${extra.reason}` : ""}`,
      };
    case "no_show":
      return {
        patient: hi
          ? `नमस्ते ${first}, ${t} की आपकी अपॉइंटमेंट ${no} पर आप नहीं आ पाए। नियम के अनुसार इस विज़िट का रिफ़ंड नहीं होता। नया समय चुनें: ${book}`
          : `Hi ${first}, we missed you at your appointment ${no} on ${t}. As per our policy this visit isn't refundable. Book a new time: ${book}`,
      };
    case "refunded":
      return {
        patient: hi
          ? `नमस्ते ${first}, बुकिंग ${no} के लिए ${rupees(extra.amount)} का रिफ़ंड भेज दिया गया है। यह 5–7 कामकाजी दिनों में उसी खाते/कार्ड में आ जाएगा।`
          : `Hi ${first}, a refund of ${rupees(extra.amount)} for booking ${no} has been issued. It reaches the original payment method in 5–7 working days.`,
      };
    case "reminder":
      return {
        patient: hi
          ? `नमस्ते ${first}, याद दिला दें: कल ${t} आपकी अपॉइंटमेंट ${no} है, ${online ? `ऑनलाइन। ${joinHi}` : `${where.address}`}। बदलना हो तो: ${manage}`
          : `Hi ${first}, a reminder of your appointment ${no} tomorrow, ${t}, ${online ? `online. ${joinEn}` : `at ${where.address}`}. Need to change it? ${manage}`,
      };
    case "reminder_soon":
      return {
        patient: hi
          ? `नमस्ते ${first}, आपकी अपॉइंटमेंट ${no} आज ${prettyTime(a.time)} बजे है${online ? `, ऑनलाइन। ${joinHi}: ${manage}` : `। पता: ${where.address}। कृपया 10 मिनट पहले पहुँचें।`}`
          : `Hi ${first}, see you today at ${prettyTime(a.time)} for appointment ${no}${online ? `, online. ${joinEn}: ${manage}` : `. Address: ${where.address}. Please arrive 10 minutes early.`}`,
      };
    case "checkin":
      return {
        patient: hi
          ? `नमस्ते ${first}, डॉ. राजवीर सिंह की टीम से। आपका टेलबोन अब कैसा है? 30 सेकंड में बताएँ: ${extra.link}`
          : `Hi ${first}, it's Dr Rajveer Singh's team from Tailbone Treatment Clinic. How is your tailbone feeling? Please take 30 seconds to tell us: ${extra.link}`,
      };
    default:
      throw new Error(`Unknown notification event ${event}`);
  }
}

// ---------- Outbox ----------
const insert = (db, row) => Number(db.prepare(
  "INSERT INTO notifications (appointment_id, audience, event, channel, recipient, body, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
).run(row.appointmentId ?? null, row.audience, row.event, row.channel, row.recipient, encrypt(row.body), row.status).lastInsertRowid);

const sent = (db, id, wamid) => db.prepare("UPDATE notifications SET status = 'sent', error = '', provider_id = ?, delivery = 'sent', delivery_at = datetime('now') WHERE id = ?").run(wamid || null, id);
const mark = (db, id, status, error = "") => db.prepare("UPDATE notifications SET status = ?, error = ? WHERE id = ?").run(status, String(error).slice(0, 300), id);

/**
 * Queue and send notifications for an appointment event. Returns quickly; delivery happens in the
 * background and results are recorded in the outbox. Returns a promise for tests to await.
 */
export function notify(db, event, appt, { base = config.siteUrl, ...extra } = {}) {
  const texts = compose(event, appt, base || "", extra);
  const jobs = [];

  if (texts.patient) {
    // Automatic WhatsApp only with the patient's consent (DPDP / GDPR). Otherwise the clinic decides how to reach them.
    const consented = appt.patient_id ? hasConsent(db, appt.patient_id, "whatsapp_updates") : false;
    if (whatsappApiEnabled() && consented) {
      const id = insert(db, { appointmentId: appt.id, audience: "patient", event, channel: "whatsapp_api", recipient: appt.patient_phone, body: texts.patient, status: "pending" });
      jobs.push(senders.whatsapp(appt.patient_phone, texts.patient, appt.patient_lang).then((wamid) => sent(db, id, wamid), (e) => mark(db, id, "failed", e.message)));
    } else {
      const id = insert(db, { appointmentId: appt.id, audience: "patient", event, channel: "manual", recipient: appt.patient_phone, body: texts.patient, status: "manual" });
      if (!consented) mark(db, id, "manual", "Patient hasn't agreed to WhatsApp messages: consider calling instead.");
    }
  }

  if (texts.doctor) {
    // Dashboard feed entry (unread until opened).
    insert(db, { appointmentId: appt.id, audience: "doctor", event, channel: "dashboard", recipient: "", body: texts.doctor, status: "sent" });
    if (emailEnabled()) {
      const id = insert(db, { appointmentId: appt.id, audience: "doctor", event, channel: "email", recipient: env("DOCTOR_EMAIL"), body: texts.doctor, status: "pending" });
      jobs.push(senders.email(`[Tailbone] ${event}: ${appt.patient_name}`, texts.doctor).then(() => mark(db, id, "sent"), (e) => mark(db, id, "failed", e.message)));
    }
    if (whatsappApiEnabled() && env("DOCTOR_WHATSAPP")) {
      const id = insert(db, { appointmentId: appt.id, audience: "doctor", event, channel: "whatsapp_api", recipient: env("DOCTOR_WHATSAPP"), body: texts.doctor, status: "pending" });
      jobs.push(senders.whatsapp(env("DOCTOR_WHATSAPP"), texts.doctor).then(() => mark(db, id, "sent"), (e) => mark(db, id, "failed", e.message)));
    }
  }
  return Promise.allSettled(jobs);
}

export function readNotification(row) {
  return row && { ...row, body: decrypt(row.body) };
}

// ---------- Automatic messages (WhatsApp Cloud API) ----------
// Which automatic messages the clinic wants; changed in Settings → WhatsApp.
export const WHATSAPP_DEFAULTS = { dayBefore: true, twoHours: true, checkins: true };
export function getWhatsappSettings(db) {
  let saved = {};
  try { saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'whatsapp'").get()?.value || "{}"); } catch { saved = {}; }
  return { ...WHATSAPP_DEFAULTS, ...saved };
}
export function saveWhatsappSettings(db, input = {}) {
  const next = getWhatsappSettings(db);
  for (const k of Object.keys(WHATSAPP_DEFAULTS)) if (typeof input[k] === "boolean") next[k] = input[k];
  db.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

const WITH_CONSENT = "EXISTS (SELECT 1 FROM consents c WHERE c.patient_id = a.patient_id AND c.purpose = 'whatsapp_updates' AND c.withdrawn_at IS NULL)";
const NOT_SENT = (event) => `a.id NOT IN (SELECT appointment_id FROM notifications WHERE event = '${event}' AND appointment_id IS NOT NULL)`;

/** Reminders the day before (sent from 10 AM), for tomorrow's appointments. Each is sent once. */
export async function runReminderJob(db, getAppointment, tomorrow) {
  if (!whatsappApiEnabled() || !getWhatsappSettings(db).dayBefore) return 0;
  const due = db.prepare(
    `SELECT id FROM appointments a WHERE date = ? AND status IN ('pending','confirmed') AND payment_status != 'awaiting'
     AND ${NOT_SENT("reminder")} AND ${WITH_CONSENT}`,
  ).all(tomorrow);
  for (const { id } of due) await notify(db, "reminder", getAppointment(db, id));
  return due.length;
}

/**
 * Same-day reminder about 2 hours before (between 1½ and 3 hours ahead, so a 10-minute job never misses one).
 * Not for bookings made in the last 3 hours: those people have only just booked.
 */
export async function runSoonReminders(db, getAppointment, { date, minutes }) {
  if (!whatsappApiEnabled() || !getWhatsappSettings(db).twoHours) return 0;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const due = db.prepare(
    `SELECT id FROM appointments a WHERE date = ? AND time BETWEEN ? AND ? AND status IN ('pending','confirmed') AND payment_status != 'awaiting'
     AND created_at < datetime('now', '-3 hours') AND ${NOT_SENT("reminder_soon")} AND ${WITH_CONSENT}`,
  ).all(date, hhmm(Math.min(minutes + 90, 1439)), hhmm(Math.min(minutes + 180, 1439)));
  for (const { id } of due) await notify(db, "reminder_soon", getAppointment(db, id));
  return due.length;
}

/** Follow-up check-in links on their due day (sent from 10 AM to 7 PM), once each. */
export async function runCheckinJob(db, { today, base, checkinsOn }) {
  if (!whatsappApiEnabled() || !getWhatsappSettings(db).checkins || !checkinsOn) return 0;
  const due = db.prepare(
    `SELECT f.id, f.token, f.patient_id, f.appointment_id, p.name AS patient_name, p.phone AS patient_phone, p.lang AS patient_lang
     FROM followups f JOIN patients p ON p.id = f.patient_id
     WHERE f.type = 'checkin' AND f.status = 'pending' AND f.sent_at IS NULL AND f.due_date <= ? AND f.due_date >= date(?, '-7 days')
       AND p.anonymised_at IS NULL
       AND EXISTS (SELECT 1 FROM consents c WHERE c.patient_id = f.patient_id AND c.purpose = 'whatsapp_updates' AND c.withdrawn_at IS NULL)`,
  ).all(today, today);
  for (const f of due) {
    db.prepare("UPDATE followups SET sent_at = datetime('now') WHERE id = ?").run(f.id);
    await notify(db, "checkin", { id: f.appointment_id, patient_id: f.patient_id, patient_name: f.patient_name, patient_phone: f.patient_phone, patient_lang: f.patient_lang, clinic: "del", date: today, time: "10:00" },
      { base, link: `${base || ""}/checkin.html?t=${f.token}` });
  }
  return due.length;
}

/** Send one message to check the set-up (Settings → WhatsApp → Send a test message). */
export async function sendTest(db, to, lang = "en") {
  if (!whatsappApiEnabled()) throw Object.assign(new Error("WhatsApp isn't connected yet. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Render."), { status: 409 });
  const text = lang === "hi" ? "टेलबोन ट्रीटमेंट क्लिनिक से जाँच संदेश। अगर आपको यह मिला है, तो WhatsApp संदेश ठीक काम कर रहे हैं।"
    : "A test message from Tailbone Treatment Clinic. If you received this, automatic WhatsApp messages are working.";
  const id = insert(db, { appointmentId: null, audience: "doctor", event: "test", channel: "whatsapp_api", recipient: to, body: text, status: "pending" });
  try { sent(db, id, await senders.whatsapp(to, text, lang)); } catch (e) { mark(db, id, "failed", e.message); throw Object.assign(new Error(`WhatsApp said: ${e.message}`), { status: 502 }); }
  return { ok: true };
}

// ---------- WhatsApp webhook: delivery receipts and replies ----------
const STOP_WORDS = /^\s*(stop|unsubscribe|band karo|बंद|बंद करो|रोकें|रोको)\s*[.!]?\s*$/i;

/**
 * Handle a webhook payload from WhatsApp: update delivery status of our messages, honour STOP replies (withdrawing
 * WhatsApp consent, as the privacy notice promises) and show other replies to the clinic in the Inbox.
 */
export function handleWhatsappWebhook(db, payload, { withdraw }) {
  let handled = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const st of v.statuses || []) {
        if (!["sent", "delivered", "read", "failed"].includes(st.status)) continue;
        const rank = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const row = db.prepare("SELECT id, delivery FROM notifications WHERE provider_id = ?").get(String(st.id || ""));
        if (!row || (rank[row.delivery] || 0) >= rank[st.status] && st.status !== "failed") continue;
        const err = st.status === "failed" ? (st.errors?.[0]?.title || st.errors?.[0]?.message || "Not delivered") : "";
        db.prepare("UPDATE notifications SET delivery = ?, delivery_at = datetime('now'), status = CASE WHEN ? = 'failed' THEN 'failed' ELSE status END, error = CASE WHEN ? = 'failed' THEN ? ELSE error END WHERE id = ?")
          .run(st.status, st.status, st.status, String(err).slice(0, 300), row.id);
        handled++;
      }
      for (const msg of v.messages || []) {
        const from = String(msg.from || "").replace(/\D/g, "");
        const text = msg.type === "text" ? String(msg.text?.body || "") : msg.type === "button" ? String(msg.button?.text || "") : `[${msg.type}]`;
        const patient = from && db.prepare("SELECT id, name FROM patients WHERE phone = ?").get(from);
        if (patient && STOP_WORDS.test(text)) {
          withdraw(db, patient.id, "whatsapp_updates");
          insert(db, { appointmentId: null, audience: "doctor", event: "whatsapp_stop", channel: "dashboard", recipient: "", body: `${patient.name} (+${from}) replied STOP: automatic WhatsApp messages to them are now off.`, status: "sent" });
        } else {
          insert(db, { appointmentId: null, audience: "doctor", event: "whatsapp_reply", channel: "dashboard", recipient: "",
            body: `WhatsApp reply from ${patient ? patient.name : "an unknown number"} (+${from}): ${text.slice(0, 500)}`, status: "sent" });
        }
        handled++;
      }
    }
  }
  return handled;
}
