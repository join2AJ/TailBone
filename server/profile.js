// Patient profile details (age, gender, occupation, city, how they found us…) and where bookings come from.
// All optional. Used to plan care and, in totals only, to see which patients the clinic reaches and which ads work.
// Nothing here is ever sent to Google or any advertiser.
import { HttpError, cleanText } from "./services.js";
import { clinicNow } from "./time.js";

export const PROFILE_OPTIONS = {
  gender: { female: "Female", male: "Male", other: "Other", prefer_not: "Prefer not to say" },
  occupation_group: {
    office: "Office / IT / desk job", driver: "Driver / long commutes", homemaker: "Homemaker", student: "Student",
    healthcare: "Healthcare", business: "Business / self-employed", field: "Field or manual work", retired: "Retired", other: "Other",
  },
  sitting_hours: { lt2: "Under 2 hours", "2to5": "2–5 hours", "5to8": "5–8 hours", gt8: "More than 8 hours" },
  pain_since: { lt1m: "Less than a month", "1to6m": "1–6 months", "6to12m": "6–12 months", gt1y: "More than a year" },
  heard_from: {
    google: "Google search", youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", friend: "Friend or family",
    doctor: "A doctor or hospital", partner: "Referral partner", coccyx_org: "coccyx.org", newspaper: "Newspaper / TV", other: "Other",
  },
};

export const PROFILE_COLUMNS = ["gender", "birth_year", "occupation_group", "occupation", "city", "sitting_hours", "pain_since", "heard_from"];

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/** Validate the optional profile fields from a form. Unknown choices are dropped; an impossible age is an error. */
export function cleanProfile(input = {}) {
  const out = {};
  for (const k of ["gender", "occupation_group", "sitting_hours", "pain_since", "heard_from"]) {
    if (typeof input[k] === "string" && Object.hasOwn(PROFILE_OPTIONS[k], input[k])) out[k] = input[k];
  }
  if (input.age !== undefined && input.age !== null && input.age !== "") {
    const age = Number(input.age);
    if (!Number.isInteger(age) || age < 1 || age > 110) throw new HttpError(400, "Please enter an age between 1 and 110.");
    out.birth_year = Number(clinicNow().date.slice(0, 4)) - age;
  }
  const occupation = cleanText(input.occupation, 80);
  if (occupation) out.occupation = occupation;
  const city = cleanText(input.city, 60).replace(/\s+/g, " ");
  if (city) out.city = titleCase(city);
  return out;
}

/**
 * Save profile fields. From the website (`overwrite: false`) only empty fields are filled, because a booking proves nothing
 * about who owns a phone number; the clinic and a verified patient may change them.
 */
export function saveProfile(db, patientId, profile, { overwrite = false } = {}) {
  const cols = Object.keys(profile).filter((k) => PROFILE_COLUMNS.includes(k));
  if (!cols.length) return;
  const set = cols.map((c) => (overwrite ? `${c} = ?` : `${c} = COALESCE(NULLIF(${c}, ''), ?)`)).join(", ");
  db.prepare(`UPDATE patients SET ${set}, profile_updated_at = datetime('now') WHERE id = ?`).run(...cols.map((c) => profile[c]), patientId);
}

/** The profile as shown to the clinic or the patient: labels plus raw values. */
export function profileView(p) {
  const year = Number(clinicNow().date.slice(0, 4));
  const label = (k) => (p[k] ? PROFILE_OPTIONS[k][p[k]] || p[k] : "");
  return {
    gender: p.gender || "", genderLabel: label("gender"),
    age: p.birth_year ? year - p.birth_year : null,
    occupationGroup: p.occupation_group || "", occupationGroupLabel: label("occupation_group"), occupation: p.occupation || "",
    city: p.city || "",
    sittingHours: p.sitting_hours || "", sittingHoursLabel: label("sitting_hours"),
    painSince: p.pain_since || "", painSinceLabel: label("pain_since"),
    heardFrom: p.heard_from || "", heardFromLabel: label("heard_from"),
    updatedAt: p.profile_updated_at || null,
  };
}

// ---------- Where a booking came from ----------

/** Campaign details the booking page passes on (from the ad or link the visitor arrived by). */
export function cleanAttribution(input = {}) {
  const word = (v) => cleanText(v, 80).replace(/[^\w .:/@+-]/g, "").toLowerCase();
  return {
    utm_source: word(input.source) || null,
    utm_medium: word(input.medium) || null,
    utm_campaign: word(input.campaign) || null,
    ad_click: input.gclid ? 1 : 0,
    landing_page: cleanText(input.landing, 120).replace(/[^\w./#?=&-]/g, "") || null,
  };
}

/** One channel name per booking, for reports. */
export const CHANNEL_SQL = `CASE
  WHEN a.source != 'web' THEN 'Phone / walk-in (added by the clinic)'
  WHEN a.referral_partner_id IS NOT NULL THEN 'Referral partner'
  WHEN a.ad_click = 1 OR a.utm_medium IN ('cpc','ppc','paid','ads') THEN 'Google Ads'
  WHEN a.utm_source IS NOT NULL THEN 'Campaign link: ' || a.utm_source
  ELSE 'Website (search, direct or social)' END`;

const AGE_BANDS = [[0, 17, "Under 18"], [18, 29, "18–29"], [30, 39, "30–39"], [40, 49, "40–49"], [50, 59, "50–59"], [60, 200, "60+"]];

/** Totals for the "Ads & insights" section: who the patients are and which channels bring visits. Counts only, no names. */
export function insights(db, { from, to }) {
  const year = Number(clinicNow().date.slice(0, 4));
  // Patients who booked in the period (by the day the booking was made, in clinic time), excluding erased records.
  const patients = db.prepare(
    `SELECT p.* FROM patients p WHERE p.anonymised_at IS NULL AND EXISTS (
       SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND date(a.created_at, '+330 minutes') BETWEEN ? AND ? AND a.status != 'cancelled')`,
  ).all(from, to);
  const tally = (key, labels) => {
    const counts = new Map();
    for (const p of patients) {
      const k = typeof key === "function" ? key(p) : p[key] ? labels?.[p[key]] || p[key] : "Not given";
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => (a.label === "Not given") - (b.label === "Not given") || b.n - a.n);
  };
  const ageBand = (p) => {
    if (!p.birth_year) return "Not given";
    const age = year - p.birth_year;
    return AGE_BANDS.find(([lo, hi]) => age >= lo && age <= hi)[2];
  };
  const channels = db.prepare(
    `SELECT ${CHANNEL_SQL} AS label, COUNT(*) AS bookings,
       SUM(a.status = 'completed') AS visits, SUM(a.status IN ('cancelled','no_show')) AS lost,
       SUM(CASE WHEN a.payment_status IN ('paid','partially_refunded') THEN a.amount_paid - a.amount_refunded ELSE 0 END) AS revenue
     FROM appointments a WHERE date(a.created_at, '+330 minutes') BETWEEN ? AND ? GROUP BY label ORDER BY bookings DESC`,
  ).all(from, to);
  const campaigns = db.prepare(
    `SELECT IFNULL(a.utm_campaign, '(no campaign name)') AS campaign, IFNULL(a.utm_source, CASE WHEN a.ad_click THEN 'google' END) AS source,
       COUNT(*) AS bookings, SUM(a.status = 'completed') AS visits
     FROM appointments a WHERE date(a.created_at, '+330 minutes') BETWEEN ? AND ? AND a.source = 'web' AND (a.ad_click = 1 OR a.utm_source IS NOT NULL)
     GROUP BY campaign, source ORDER BY bookings DESC LIMIT 20`,
  ).all(from, to);
  const landing = db.prepare(
    `SELECT a.landing_page AS page, COUNT(*) AS bookings FROM appointments a
     WHERE date(a.created_at, '+330 minutes') BETWEEN ? AND ? AND a.source = 'web' AND a.landing_page IS NOT NULL GROUP BY page ORDER BY bookings DESC LIMIT 10`,
  ).all(from, to);
  const filled = patients.filter((p) => p.gender || p.birth_year || p.occupation_group || p.city).length;
  return {
    from, to,
    patients: patients.length,
    profilesFilled: filled,
    gender: tally("gender", PROFILE_OPTIONS.gender),
    age: tally(ageBand),
    occupation: tally("occupation_group", PROFILE_OPTIONS.occupation_group),
    city: tally("city").slice(0, 12),
    sitting: tally("sitting_hours", PROFILE_OPTIONS.sitting_hours),
    painSince: tally("pain_since", PROFILE_OPTIONS.pain_since),
    heardFrom: tally("heard_from", PROFILE_OPTIONS.heard_from),
    channels,
    campaigns,
    landing,
  };
}
