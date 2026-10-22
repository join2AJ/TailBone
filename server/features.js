// Feature switches (controlled by the super admin) and dashboard permissions for other admins.

export const FEATURES = {
  online_booking: { label: "Online booking", help: "Live slot booking on /book. When off, the Book page sends a WhatsApp request instead.", default: true },
  online_payments: { label: "Online payments", help: "Patients pay through Razorpay when booking (needs Razorpay keys). When off, fees are paid at the clinic.", default: true },
  patient_self_service: { label: "Patients can reschedule or cancel online", help: "On 'My appointments'. When off, patients see their booking but must call to change it.", default: true },
  followup_checkins: { label: "Follow-up check-ins", help: "Pain-score check-in links sent after visits.", default: true },
  stories: { label: "Patient stories", help: "Stories carousel, the stories page and the 'share your story' form.", default: true },
  instagram: { label: "Instagram videos", help: "Instagram highlights on the Treatment page.", default: true },
  symptom_checker: { label: "Symptom self-check", help: "Interactive checklist on the Coccydynia page.", default: true },
  patient_documents: { label: "Documents in My appointments", help: "Patients see and download the documents the clinic shares with them (plans, visit summaries, reports).", default: true },
  patient_uploads: { label: "Patients can upload earlier reports", help: "Patients may add PDF or photo reports they already have, before a visit. Off until the clinic decides to use it.", default: false },
  whatsapp_widget: { label: "Floating WhatsApp button", help: "Chat bubble at the bottom-right of every page.", default: true },
  referrals: { label: "Referral programme", help: "The Refer page, partner sign-up and log-in, referral codes when booking, and 'Refer a friend' in My appointments.", default: true },
  home_visits: { label: "Doctor at your place", help: "Requests for Dr Rajveer to treat patients in their own city (they pay fees, travel, meals and stay).", default: true },
};

// Dashboard sections that can be granted to an admin. The super admin always has all of them,
// plus users & features, backups, the security log and commission settings.
export const PERMISSIONS = {
  appointments: "Appointments (view, book, confirm, reschedule, cancel)",
  followups: "Follow-ups",
  patients: "Patients and clinical notes",
  inbox: "Inbox (patient changes, messages to send)",
  stories: "Patient stories",
  instagram: "Instagram highlights",
  blog: "Blog articles (show or hide)",
  payments: "Payments report and refunds",
  privacy: "Privacy requests, patient data export and erasure",
  settings: "Fees, refund rules and holidays",
  export: "Download appointments (CSV)",
  insights: "Ads & insights (totals only, no names)",
  referrals: "Referral partners and their payouts",
  homevisits: "Doctor at your place requests",
};
export const DEFAULT_PERMISSIONS = ["appointments", "followups", "patients", "inbox", "stories", "instagram", "blog"];

export function getFeatures(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'features'").get();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return Object.fromEntries(Object.entries(FEATURES).map(([k, f]) => [k, typeof saved[k] === "boolean" ? saved[k] : f.default]));
}

export function saveFeatures(db, input) {
  const next = getFeatures(db);
  for (const k of Object.keys(FEATURES)) if (typeof input?.[k] === "boolean") next[k] = input[k];
  db.prepare("INSERT INTO settings (key, value) VALUES ('features', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

export const isOn = (db, key) => getFeatures(db)[key];

/** Effective permissions of a signed-in account. */
export function permissionsOf(admin) {
  if (admin.role === "superadmin") return [...Object.keys(PERMISSIONS), "superadmin"];
  try {
    const list = JSON.parse(admin.permissions || "null");
    return Array.isArray(list) ? list.filter((p) => PERMISSIONS[p]) : [...DEFAULT_PERMISSIONS];
  } catch {
    return [...DEFAULT_PERMISSIONS];
  }
}

export const sanitizePermissions = (list) => [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMISSIONS[p]))];
