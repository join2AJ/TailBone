import { config, CLINICS } from "./config.js";
import { encrypt, decrypt } from "./crypto.js";
import { rupees } from "./payments.js";

// Notifications go to two audiences:
//  - patient: WhatsApp Cloud API when configured, otherwise queued as "manual" with a one-tap wa.me link
//  - doctor:  always shown in the dashboard feed; also emailed (Resend) and/or WhatsApp'd when configured
//
// Env (all optional):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID      Meta WhatsApp Cloud API credentials
//   WHATSAPP_TEMPLATE=clinic_update, WHATSAPP_TEMPLATE_LANG=en
//       An approved template whose body is a single variable {{1}}; we put the message text in it.
//   DOCTOR_WHATSAPP=91XXXXXXXXXX                  also notify the doctor on WhatsApp
//   RESEND_API_KEY, EMAIL_FROM, DOCTOR_EMAIL      email the doctor about patient-side changes

const env = (k) => process.env[k] || "";
export const whatsappApiEnabled = () => !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"));
const emailEnabled = () => !!(env("RESEND_API_KEY") && env("EMAIL_FROM") && env("DOCTOR_EMAIL"));

// ---------- Channels (swappable for tests) ----------
let senders = {
  async whatsapp(to, text) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env("WHATSAPP_TEMPLATE") || "clinic_update",
          language: { code: env("WHATSAPP_TEMPLATE_LANG") || "en" },
          // Template variables can't contain newlines or long runs of spaces.
          components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " · ").slice(0, 1000) }] }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
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

// ---------- Message text ----------
const prettyDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const prettyTime = (time) => { const [h, m] = time.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const when = (a) => `${prettyDate(a.date)} at ${prettyTime(a.time)}`;

const paymentLine = (a) => {
  if (a.payment_status === "paid") return `Paid ${rupees(a.amount_paid)}.`;
  if (a.payment_status === "pay_at_clinic" || a.payment_status === "unpaid") return a.fee ? `Fee ${rupees(a.fee)}, payable at the clinic.` : "";
  return "";
};

/** Build { patient, doctor } texts for an event. `extra` carries old times, refund info, etc. */
export function compose(event, a, base, extra = {}) {
  const first = a.patient_name.split(" ")[0];
  const where = CLINICS[a.clinic];
  const manage = `${base}/manage.html?ref=${a.ref}`;
  const refund = extra.refund ? ` Refund: ${rupees(extra.refund.amount)} (${extra.refund.percent}%). It reaches the original payment method in 5–7 working days.` : "";
  const who = `${a.patient_name} (+${a.patient_phone})`;
  switch (event) {
    case "booked":
      return {
        patient: a.status === "confirmed"
          ? `Hi ${first}, your appointment ${a.ref} at Tailbone Treatment Clinic is confirmed for ${when(a)} (${where.short}). ${paymentLine(a)} Manage or reschedule: ${manage}`
          : `Hi ${first}, your booking ${a.ref} at Tailbone Treatment Clinic is received for ${when(a)} (${where.short}). ${paymentLine(a)} We'll confirm shortly. Manage or reschedule: ${manage}`,
        doctor: `New booking ${a.ref}: ${who}, ${when(a)}, ${where.short}. ${a.visit_type === "followup" ? "Follow-up visit. " : ""}${paymentLine(a)}`,
      };
    case "confirmed":
      return { patient: `Hi ${first}, your appointment ${a.ref} is confirmed for ${when(a)} at our ${where.short} ${a.clinic === "online" ? "consultation (video link will be shared)" : `clinic, ${where.address}`}. Manage: ${manage}` };
    case "rescheduled":
      return extra.actor === "clinic"
        ? { patient: `Hi ${first}, the clinic has moved your appointment ${a.ref} from ${extra.from} to ${when(a)} (${where.short}). If this doesn't suit you, reschedule or cancel free of charge: ${manage}` }
        : {
          patient: `Hi ${first}, your appointment ${a.ref} is now ${when(a)} (${where.short}). Manage: ${manage}`,
          doctor: `Rescheduled by patient: ${a.ref} ${who} moved from ${extra.from} to ${when(a)} (${where.short}).`,
        };
    case "cancelled":
      return extra.actor === "clinic"
        ? { patient: `Hi ${first}, we're sorry: the clinic had to cancel your appointment ${a.ref} on ${when(a)}.${refund || (a.amount_paid ? "" : "")} Book a new time: ${base}/book` }
        : {
          patient: `Hi ${first}, your appointment ${a.ref} on ${when(a)} is cancelled.${refund} Book again any time: ${base}/book`,
          doctor: `Cancelled by patient: ${a.ref} ${who}, ${when(a)}, ${where.short}.${extra.refund ? ` Refund ${rupees(extra.refund.amount)} (${extra.refund.percent}%) per policy.` : ""}${extra.reason ? ` Reason: ${extra.reason}` : ""}`,
        };
    case "no_show":
      return { patient: `Hi ${first}, we missed you at your appointment ${a.ref} on ${when(a)}. As per our policy this visit isn't refundable. Book a new time: ${base}/book` };
    case "refunded":
      return { patient: `Hi ${first}, a refund of ${rupees(extra.amount)} for booking ${a.ref} has been issued. It reaches the original payment method in 5–7 working days.` };
    case "reminder":
      return { patient: `Hi ${first}, a reminder of your appointment ${a.ref} tomorrow, ${when(a)}, ${a.clinic === "online" ? "online (video link will be shared)" : `at ${where.address}`}. Need to change it? ${manage}` };
    default:
      throw new Error(`Unknown notification event ${event}`);
  }
}

// ---------- Outbox ----------
const insert = (db, row) => Number(db.prepare(
  "INSERT INTO notifications (appointment_id, audience, event, channel, recipient, body, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
).run(row.appointmentId ?? null, row.audience, row.event, row.channel, row.recipient, encrypt(row.body), row.status).lastInsertRowid);

const mark = (db, id, status, error = "") => db.prepare("UPDATE notifications SET status = ?, error = ? WHERE id = ?").run(status, String(error).slice(0, 300), id);

/**
 * Queue and send notifications for an appointment event. Returns quickly; delivery happens in the
 * background and results are recorded in the outbox. Returns a promise for tests to await.
 */
export function notify(db, event, appt, { base = config.siteUrl, ...extra } = {}) {
  const texts = compose(event, appt, base || "", extra);
  const jobs = [];

  if (texts.patient) {
    if (whatsappApiEnabled()) {
      const id = insert(db, { appointmentId: appt.id, audience: "patient", event, channel: "whatsapp_api", recipient: appt.patient_phone, body: texts.patient, status: "pending" });
      jobs.push(senders.whatsapp(appt.patient_phone, texts.patient).then(() => mark(db, id, "sent"), (e) => mark(db, id, "failed", e.message)));
    } else {
      insert(db, { appointmentId: appt.id, audience: "patient", event, channel: "manual", recipient: appt.patient_phone, body: texts.patient, status: "manual" });
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

/**
 * Background job: tomorrow's reminders, sent automatically only when the WhatsApp API is configured
 * (otherwise the dashboard shows one-tap reminder buttons instead).
 */
export async function runReminderJob(db, getAppointment, tomorrow) {
  if (!whatsappApiEnabled()) return 0;
  const due = db.prepare(
    `SELECT id FROM appointments WHERE date = ? AND status IN ('pending','confirmed')
     AND payment_status != 'awaiting' AND id NOT IN (SELECT appointment_id FROM notifications WHERE event = 'reminder' AND appointment_id IS NOT NULL)`,
  ).all(tomorrow);
  for (const { id } of due) await notify(db, "reminder", getAppointment(db, id));
  return due.length;
}
