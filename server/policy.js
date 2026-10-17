// Fees, commission and cancellation / reschedule / follow-up rules.
// Stored in the `settings` table so the clinic can change them from the dashboard.
// Amounts in settings are whole rupees (easy to edit); everything else in the app uses paise.

export const DEFAULT_POLICY = {
  fees: { blr: 800, del: 800, online: 800 },
  followup: { fee: 500, windowDays: 30 },          // review visit within N days of a completed visit
  payments: { mode: "online" },                      // online = pay to confirm (when a gateway is configured) | clinic = pay at clinic
  commission: { enabled: false, type: "fixed", value: 100, doctorAccountId: "" },
  cancellation: [                                    // first tier whose hoursBefore is met applies
    { hoursBefore: 24, refundPercent: 100 },
    { hoursBefore: 4, refundPercent: 50 },
    { hoursBefore: 0, refundPercent: 0 },
  ],
  reschedule: { minHoursBefore: 12, maxTimes: 2 },
  holdMinutes: 15,                                   // unpaid online bookings release the slot after this
};

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Validate and normalise a policy object coming from the dashboard. Throws on nonsense values. */
export function sanitizePolicy(input = {}, base = DEFAULT_POLICY) {
  const p = structuredClone(base);
  if (input.fees) for (const k of Object.keys(p.fees)) p.fees[k] = clampInt(input.fees[k], 0, 100000, p.fees[k]);
  if (input.followup) {
    p.followup.fee = clampInt(input.followup.fee, 0, 100000, p.followup.fee);
    p.followup.windowDays = clampInt(input.followup.windowDays, 0, 365, p.followup.windowDays);
  }
  if (input.payments && ["online", "clinic"].includes(input.payments.mode)) p.payments.mode = input.payments.mode;
  if (input.commission) {
    const c = input.commission;
    p.commission.enabled = !!c.enabled;
    if (["fixed", "percent"].includes(c.type)) p.commission.type = c.type;
    p.commission.value = clampInt(c.value, 0, p.commission.type === "percent" ? 50 : 100000, p.commission.value);
    if (c.doctorAccountId !== undefined) {
      const id = String(c.doctorAccountId).trim();
      if (id && !/^acc_[A-Za-z0-9]{6,30}$/.test(id)) throw Object.assign(new Error("Doctor's Razorpay linked account id should look like acc_XXXXXXXX."), { status: 400 });
      p.commission.doctorAccountId = id;
    }
  }
  if (Array.isArray(input.cancellation) && input.cancellation.length) {
    const tiers = input.cancellation
      .map((t) => ({ hoursBefore: clampInt(t.hoursBefore, 0, 720, 0), refundPercent: clampInt(t.refundPercent, 0, 100, 0) }))
      .sort((a, b) => b.hoursBefore - a.hoursBefore);
    if (tiers.at(-1).hoursBefore !== 0) tiers.push({ hoursBefore: 0, refundPercent: 0 });
    p.cancellation = tiers.slice(0, 6);
  }
  if (input.reschedule) {
    p.reschedule.minHoursBefore = clampInt(input.reschedule.minHoursBefore, 0, 720, p.reschedule.minHoursBefore);
    p.reschedule.maxTimes = clampInt(input.reschedule.maxTimes, 0, 10, p.reschedule.maxTimes);
  }
  if (input.holdMinutes !== undefined) p.holdMinutes = clampInt(input.holdMinutes, 5, 60, p.holdMinutes);
  return p;
}

export function getPolicy(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'policy'").get();
  if (!row) return structuredClone(DEFAULT_POLICY);
  try {
    return sanitizePolicy(JSON.parse(row.value));
  } catch {
    return structuredClone(DEFAULT_POLICY);
  }
}

export function savePolicy(db, input) {
  const policy = sanitizePolicy(input, getPolicy(db));
  db.prepare("INSERT INTO settings (key, value) VALUES ('policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(policy));
  return policy;
}

/** Appointment start as a real instant (clinic time is IST, UTC+05:30). */
export const appointmentStart = (appt) => new Date(`${appt.date}T${appt.time}:00+05:30`);
export const hoursUntil = (appt, now = new Date()) => (appointmentStart(appt) - now) / 3_600_000;

/** Price for a booking: follow-up rate if the patient had a completed visit within the window. */
export function priceFor(db, policy, { clinic, patientId, date }) {
  let visitType = "new";
  if (patientId && policy.followup.windowDays > 0) {
    const recent = db.prepare(
      `SELECT 1 FROM appointments WHERE patient_id = ? AND status = 'completed'
       AND date >= date(?, ?) AND date <= ? LIMIT 1`,
    ).get(patientId, date, `-${policy.followup.windowDays} days`, date);
    if (recent) visitType = "followup";
  }
  const rupees = visitType === "followup" ? Math.min(policy.followup.fee, policy.fees[clinic]) : policy.fees[clinic];
  const fee = rupees * 100;
  return { visitType, fee, platformFee: platformFee(policy, fee) };
}

/** Commission kept by the platform, in paise. Never more than the fee. */
export function platformFee(policy, fee) {
  const c = policy.commission;
  if (!c.enabled || fee <= 0) return 0;
  const cut = c.type === "percent" ? Math.round((fee * c.value) / 100) : c.value * 100;
  return Math.min(cut, fee);
}

/** How much of what was paid goes back, given who cancels and when. */
export function refundQuote(appt, policy, { actor = "patient", now = new Date(), noShow = false } = {}) {
  const refundable = Math.max(0, (appt.amount_paid || 0) - (appt.amount_refunded || 0));
  const hours = hoursUntil(appt, now);
  let percent;
  let rule;
  if (actor === "clinic" && !noShow) {
    percent = 100;
    rule = "Cancelled by the clinic: full refund.";
  } else if (noShow) {
    percent = 0;
    rule = "No-show: no refund.";
  } else {
    const tier = policy.cancellation.find((t) => hours >= t.hoursBefore) || { hoursBefore: 0, refundPercent: 0 };
    percent = hours < 0 ? 0 : tier.refundPercent;
    rule = hours < 0
      ? "The appointment time has passed: no refund."
      : `Cancelled ${tier.hoursBefore ? `${tier.hoursBefore}+ hours` : "less than " + (policy.cancellation.at(-2)?.hoursBefore ?? 0) + " hours"} before: ${percent}% refund.`;
  }
  return { refundable, percent, amount: Math.round((refundable * percent) / 100), hoursBefore: Math.max(0, Math.floor(hours)), rule };
}

/** Whether a patient may reschedule online, and why not. */
export function rescheduleCheck(appt, policy, now = new Date()) {
  const hours = hoursUntil(appt, now);
  if ((appt.reschedule_count || 0) >= policy.reschedule.maxTimes) {
    return { allowed: false, reason: `Online rescheduling is limited to ${policy.reschedule.maxTimes} time(s) per booking. Please call the clinic.` };
  }
  if (hours < policy.reschedule.minHoursBefore) {
    return { allowed: false, reason: `Appointments can be moved online up to ${policy.reschedule.minHoursBefore} hours before. Please call the clinic.` };
  }
  return { allowed: true, remaining: policy.reschedule.maxTimes - (appt.reschedule_count || 0) };
}

/** Plain-language summary shown to patients before booking and on the policy page. */
export function policySummary(policy) {
  const tiers = policy.cancellation;
  const lines = tiers.map((t, i) => {
    if (t.hoursBefore === 0) {
      const prev = tiers[i - 1];
      return prev ? `Less than ${prev.hoursBefore} hours before: ${t.refundPercent}% refund` : `${t.refundPercent}% refund`;
    }
    return `${t.hoursBefore}+ hours before: ${t.refundPercent}% refund`;
  });
  return {
    cancellation: lines,
    reschedule: policy.reschedule.maxTimes
      ? `Free rescheduling up to ${policy.reschedule.minHoursBefore} hours before, up to ${policy.reschedule.maxTimes} time(s) per booking.`
      : "Online rescheduling is not available. Please call the clinic.",
    followup: policy.followup.windowDays
      ? `Review visits within ${policy.followup.windowDays} days of a completed visit are charged at ₹${policy.followup.fee}.`
      : "",
    noShow: "Missed appointments without notice are not refunded.",
    clinic: "If the clinic cancels or must move your appointment, you get a full refund or a free new slot.",
  };
}
