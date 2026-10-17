// Builds one HTML file per short page from content/site.html, so every address has its own title,
// description, canonical link, heading, structured data and only its own content. Search engines and
// AI assistants (which often don't run JavaScript) then read each page as a separate, complete document.
// Run with `npm run build`; the output in public/ is committed.
import fs from "node:fs";
import path from "node:path";
import { root, SITE, injectAnims } from "./partials.js";

export const TEMPLATE = path.join(root, "content/site.html");

export const PAGES = [
  {
    slug: "/", file: "index.html", page: "home",
    title: "Tailbone Pain Treatment in Delhi | Tailbone Treatment Clinic",
    description: "Non-surgical treatment for tailbone (coccyx) pain by Dr Rajveer Singh, coccydynia specialist. Clinic in Vasant Kunj, New Delhi, and online video consultations.",
  },
  {
    slug: "/coccydynia", file: "coccydynia.html", page: "coccydynia", crumb: "Tailbone pain",
    heading: "Coccydynia (tailbone pain): symptoms, causes and self-check",
    title: "Coccydynia (Tailbone Pain): Symptoms, Causes and Self-Check",
    description: "What causes tailbone (coccyx) pain, typical symptoms, warning signs and self-care, with a 1-minute symptom check. Checked against NHS and Cleveland Clinic information.",
  },
  {
    slug: "/treatment", file: "treatment.html", page: "treatment", crumb: "Treatment",
    heading: "Non-surgical tailbone pain treatment",
    title: "Non-Surgical Tailbone Pain Treatment | Tailbone Treatment",
    description: "How coccydynia is treated without surgery: careful assessment, Internal Manipulation of the coccyx and a personalised recovery plan, in New Delhi or online.",
  },
  {
    slug: "/doctor", file: "doctor.html", page: "doctor", crumb: "Dr Rajveer Singh",
    heading: "Dr Rajveer Singh, tailbone pain specialist",
    title: "Dr Rajveer Singh, Tailbone Pain Specialist in New Delhi",
    description: "Dr Rajveer Singh (BPT, Fellowship in Orthopaedic Rehabilitation, Apollo Hospital Chennai) treats coccyx and tailbone pain without surgery. Read patient stories.",
  },
  {
    slug: "/locations", file: "locations.html", page: "locations", crumb: "Clinics",
    heading: "Our clinic in New Delhi, online consultations and opening hours",
    title: "Tailbone Pain Clinic in Vasant Kunj, New Delhi · Timings",
    description: "Address, map and opening hours of the Tailbone Treatment clinic in Vasant Kunj, New Delhi, plus online video consultations. Lucknow clinic opening soon.",
  },
  {
    slug: "/faq", file: "faq.html", page: "faq", crumb: "FAQ",
    heading: "Tailbone pain: frequently asked questions",
    title: "Tailbone Pain FAQ: Treatment, Sessions and Fees",
    description: "Answers about coccydynia, Internal Manipulation, how many sessions are needed, fees, online consultations and appointments at Tailbone Treatment Clinic.",
  },
  {
    slug: "/book", file: "book.html", page: "book", crumb: "Book an appointment",
    heading: "Book a tailbone pain appointment",
    title: "Book a Tailbone Pain Appointment · New Delhi or Online",
    description: "Choose a day and time for a tailbone pain consultation with Dr Rajveer Singh in New Delhi or by video. Instant appointment number and WhatsApp reminders.",
  },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const url = (slug) => `${SITE}${slug === "/" ? "/" : slug}`;

/** Top-level <section> elements inside <main>, with their data-page attributes (nesting-aware). */
export function topSections(html) {
  const out = [];
  const re = /<(\/?)section\b[^>]*>/g;
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1]) { if (depth === 0) start = m.index; depth++; } else if (--depth === 0) {
      const block = html.slice(start, re.lastIndex);
      const open = block.slice(0, block.indexOf(">") + 1);
      out.push({ start, end: re.lastIndex, block, page: /data-page="([^"]*)"/.exec(open)?.[1], except: /data-page-except="([^"]*)"/.exec(open)?.[1] });
    }
  }
  return out;
}

const keep = (s, page) => (s.page ? s.page.split(" ").includes(page) : s.except ? s.except !== page : true);

// ---------- Structured data (schema.org) ----------
const CLINIC_ID = `${SITE}/#clinic`;
const DOCTOR_ID = `${SITE}/doctor#rajveer-singh`;
const clinic = {
  "@type": ["MedicalClinic", "Physiotherapy"],
  "@id": CLINIC_ID,
  name: "Tailbone Treatment Clinic",
  alternateName: "TailboneTreatment.com",
  url: `${SITE}/`,
  logo: `${SITE}/assets/img/icon-512.png`,
  image: `${SITE}/assets/img/og-image.png`,
  description: "Specialist, non-surgical treatment for tailbone (coccyx) pain, also called coccydynia, led by Dr Rajveer Singh. Clinic in Vasant Kunj, New Delhi, and online video consultations.",
  telephone: "+91-98866-88323",
  email: "contact@tailbonetreatment.com",
  priceRange: "₹500–₹800",
  currenciesAccepted: "INR",
  paymentAccepted: "Cash, UPI, Card",
  medicalSpecialty: "Physiotherapy",
  isAcceptingNewPatients: true,
  foundingDate: "2014",
  address: { "@type": "PostalAddress", streetAddress: "150A/09, Shanti Apartment, Kishangarh, Vasant Kunj", addressLocality: "New Delhi", addressRegion: "Delhi", postalCode: "110070", addressCountry: "IN" },
  areaServed: [{ "@type": "City", name: "New Delhi" }, { "@type": "AdministrativeArea", name: "Delhi NCR" }, { "@type": "Country", name: "India" }],
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "10:00", closes: "17:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "10:00", closes: "15:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "08:00", closes: "15:00" },
  ],
  availableService: [
    { "@type": "MedicalTherapy", name: "Coccydynia (tailbone pain) assessment and treatment" },
    { "@type": "MedicalTherapy", name: "Internal Manipulation of the coccyx" },
    { "@type": "MedicalTherapy", name: "Online video consultation for tailbone pain" },
  ],
  employee: { "@id": DOCTOR_ID },
  sameAs: ["https://www.instagram.com/drrajveersingh_9886688323/"],
};
const doctor = {
  "@type": "Person",
  "@id": DOCTOR_ID,
  name: "Dr Rajveer Singh",
  honorificPrefix: "Dr",
  jobTitle: "Physiotherapist and coccydynia (tailbone pain) specialist",
  image: `${SITE}/assets/img/dr-rajveer-singh.jpg`,
  url: `${SITE}/doctor`,
  worksFor: { "@id": CLINIC_ID },
  hasCredential: [
    { "@type": "EducationalOccupationalCredential", credentialCategory: "degree", name: "Bachelor of Physiotherapy (BPT)" },
    { "@type": "EducationalOccupationalCredential", credentialCategory: "certificate", name: "Fellowship in Orthopaedic Rehabilitation", recognizedBy: { "@type": "Organization", name: "Apollo Hospital, Chennai" } },
  ],
  knowsAbout: ["Coccydynia", "Tailbone pain", "Coccyx pain", "Subluxed coccyx", "Post-pregnancy tailbone pain", "Internal Manipulation of the coccyx", "Orthopaedic rehabilitation"],
  sameAs: ["https://www.instagram.com/drrajveersingh_9886688323/"],
};
const condition = {
  "@type": "MedicalCondition",
  "@id": `${SITE}/coccydynia#condition`,
  name: "Coccydynia",
  alternateName: ["Tailbone pain", "Coccyx pain", "Coccygodynia"],
  code: { "@type": "MedicalCode", code: "M53.3", codingSystem: "ICD-10" },
  associatedAnatomy: { "@type": "AnatomicalStructure", name: "Coccyx (tailbone)" },
  signOrSymptom: ["Pain at the very base of the spine", "Pain that worsens when sitting or leaning back", "Sharp pain when standing up from sitting", "Pain during bowel movements or intercourse"]
    .map((name) => ({ "@type": "MedicalSignOrSymptom", name })),
  riskFactor: ["A fall onto the backside or other injury", "Pregnancy and childbirth", "Prolonged sitting on hard surfaces", "Repetitive strain such as cycling or rowing", "Being well above or below a healthy weight"]
    .map((name) => ({ "@type": "MedicalRiskFactor", name })),
  possibleTreatment: ["Seat cushion, posture and activity changes", "Physiotherapy and manipulation of the coccyx and pelvic floor muscles", "Local injection", "Coccygectomy (surgery), rarely"]
    .map((name) => ({ "@type": "MedicalTherapy", name })),
};

function faqFrom(html) {
  const items = [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
  return items.map(([, q, a]) => ({ "@type": "Question", name: text(q), acceptedAnswer: { "@type": "Answer", text: text(a) } }));
}

function graphFor(p, html) {
  const pageUrl = url(p.slug);
  const graph = [
    { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "Tailbone Treatment Clinic", inLanguage: "en-IN", publisher: { "@id": CLINIC_ID } },
    clinic,
  ];
  const webPage = {
    "@type": ["coccydynia", "treatment"].includes(p.page) ? "MedicalWebPage" : p.page === "faq" ? ["WebPage", "FAQPage"] : "WebPage",
    "@id": `${pageUrl}#webpage`, url: pageUrl, name: p.title, description: p.description, inLanguage: "en-IN",
    isPartOf: { "@id": `${SITE}/#website` }, about: { "@id": p.page === "doctor" ? DOCTOR_ID : p.page === "coccydynia" ? condition["@id"] : CLINIC_ID },
    dateModified: new Date().toISOString().slice(0, 10),
  };
  if (["coccydynia", "treatment"].includes(p.page)) {
    webPage.audience = { "@type": "PeopleAudience", audienceType: "Patient" };
    webPage.citation = ["https://my.clevelandclinic.org/health/diseases/10436-coccydynia-tailbone-pain", "https://www.nhs.uk/conditions/tailbone-coccyx-pain/"];
  }
  if (p.page === "faq") webPage.mainEntity = faqFrom(html);
  if (p.slug !== "/") {
    webPage.breadcrumb = { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: p.crumb, item: pageUrl },
    ] };
  }
  graph.push(webPage);
  if (["home", "doctor"].includes(p.page)) graph.push(doctor);
  if (["coccydynia", "treatment"].includes(p.page)) graph.push(condition);
  return { "@context": "https://schema.org", "@graph": graph };
}

export function renderPage(template, p) {
  const sections = topSections(template.slice(template.indexOf("<main"), template.indexOf("</main>")));
  const mainStart = template.indexOf("<main");
  // Drop other pages' sections.
  let html = template;
  for (const s of [...sections].reverse()) {
    if (!keep(s, p.page)) html = html.slice(0, mainStart + s.start) + html.slice(mainStart + s.end);
  }
  html = html.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  const pageUrl = url(p.slug);
  const head = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<link rel="canonical" href="${pageUrl}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:url" content="${pageUrl}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="en_IN">`,
  ].join("\n  ");
  html = html
    .replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, head)
    .replace(/\s*<meta property="og:(title|description|type)"[^>]*>/g, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(graphFor(p, html)).replace(/</g, "\\u003c")}</script>`)
    .replace(/<html lang="en">/, '<html lang="en-IN">');
  if (p.heading) html = html.replace('<main id="main">', `<main id="main">\n    <h1 class="visually-hidden" id="pageTitle">${esc(p.heading)}</h1>`);
  return html;
}

export function buildPages() {
  const template = injectAnims(fs.readFileSync(TEMPLATE, "utf8"));
  fs.writeFileSync(TEMPLATE, template);
  for (const p of PAGES) fs.writeFileSync(path.join(root, "public", p.file), renderPage(template, p));
  return PAGES;
}
