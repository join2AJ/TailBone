# What's new compared to the old site, and what's next

This is the running record of how the new Tailbone Treatment website and clinic system improves on the old site at **tailbonetreatment.com**, and the plan for what comes next.

**Keep it current:** whenever something is added or changed, add a line to the [change log](#3-change-log) and tick or move items in the [future plan](#4-future-plan). Last updated: **18 October 2026**.

---

## 1. At a glance

| Area | Old site (tailbonetreatment.com) | New site and system |
|---|---|---|
| **Platform** | WordPress 6.8 with plugins (Yoast SEO, Contact Form 7, Site Kit), hosted on the domain | Purpose-built, fast static website (Netlify) plus a clinic server (Render). No plugins to keep patching. |
| **Booking** | "Call to book" phone number and a contact form; staff had to call back | Live online booking: pick clinic, day and time slot in under a minute, with instant confirmation, an appointment number and a QR code |
| **After booking** | Nothing: changes by phone only | **My appointments** page: view, reschedule, cancel (within the clinic's rules), print the appointment card, add to Google Calendar |
| **Payments** | None online | Razorpay (UPI, cards, net banking), automatic refunds by the cancellation rules, optional commission split, fees taken at the desk recorded as UPI, cash or card, and a numbered payment receipt for every paid visit |
| **Clinic dashboard** | None (WordPress admin only) | Full dashboard: today's patients, confirmations, follow-ups, patient records with notes, inbox, payments, privacy requests, stories, blog control, settings, staff accounts and permissions |
| **Follow-up care** | None | Automatic follow-ups after a visit, pain-score check-in links, alerts when a patient reports feeling worse |
| **Messages** | Phone calls | Ready-to-send WhatsApp messages (confirmations, reminders, check-ins) with the clinic's greeting, plus email to the doctor. Fully automatic once the WhatsApp Business API is connected. |
| **Calendar** | None | Every appointment appears in the doctor's Google Calendar with appointment number, patient ID and in-clinic or online |
| **Clinics** | Bangalore and New Delhi both listed | New Delhi plus online; Bengaluru marked closed; Lucknow shown as opening soon. All switchable from the dashboard. |
| **Fees and policies** | Not published online | Fees, refund and reschedule rules published, editable by the clinic, with a dated history of every change; each booking keeps the rules in force when it was made |
| **Content** | 24 articles, 15 pages | All old articles and newspaper clippings brought over, plus new evidence-based articles with tables, diagrams, animations and sources (29 articles in total, 4 of them from Dr Rajveer's own videos) |
| **Blog tools** | WordPress categories and tags | Picture cards for every article, search box, topic filters, "On this page" contents, WhatsApp share, related articles, and admin on/off per article |
| **Search engines and AI** | Yoast SEO, one structured-data block | Separate page per topic, rich structured data (clinic, doctor, condition, FAQ, articles, breadcrumbs), AI-assistant files (llms.txt), IndexNow, sitemap, and 301 redirects from every old address |
| **Online consultations** | Mentioned, arranged by phone | A "Join call" button in My appointments from 15 minutes before, a 2-minute preparation guide and a camera/microphone test; the doctor starts the call or sends the link on WhatsApp from the dashboard |
| **Documents** | None | The clinic shares treatment and exercise plans, visit summaries and reports; patients download them from My appointments. Optional patient uploads of earlier reports (switched off for now). Stored encrypted. |
| **Privacy and law** | Privacy statement page | DPDP Act / GDPR ready: consent records, self-service data requests (copy, correct, delete) completed within 7 days, retention clean-up, encrypted clinical notes and backups, security log |
| **Accessibility** | Not tested | Tested with automated accessibility checks (no errors), in light and dark mode, on phones and desktop |
| **Advertising** | Site Kit by Google | Consent-based Google Ads and Analytics tags with booking, WhatsApp and call conversions, plus a ready Google Ads Search campaign plan |

---

## 2. Everything that is better, in detail

### For patients
- **Book online in under a minute:** clinic, day, time, name and phone. The fee and rules are shown before booking.
- **Appointment number and patient ID** (e.g. TBA-2610-0007 and TBP-00042) on every booking, with a printable card and QR code.
- **My appointments:** reschedule or cancel online within the clinic's rules, see refunds, and add the visit to Google Calendar.
- **Pay online** by UPI, card or net banking, or pay at the clinic.
- **Online video consultations** offered alongside the Delhi clinic, with a **Join call** button in My appointments (from 15 minutes before), a short "how to get ready" guide and a camera and microphone test.
- **Clear information:** each topic has its own short page (tailbone pain, treatment, doctor, clinics, FAQ, book), with animated explainers instead of long walls of text.
- **Research-backed articles** with tables, diagrams, animations and sources.
- **Blog search and topic filters**, so patients find the right article quickly.
- **Share** any article on WhatsApp with one tap.
- **Patient stories** (shared with consent, checked against a real patient ID and appointment number, and approved by the clinic).
- **Symptom self-check** and red-flag warnings that say when to see a doctor urgently.
- **Their data, their choice:** request a copy, a correction or deletion from My appointments, completed within 7 days. WhatsApp updates can be switched off at any time.
- **Works well on phones:** a bottom bar with Call, WhatsApp and Book, a dark mode, and large tap targets.

### For the doctor and staff
- **Overview dashboard:** today's patients first, plus money at a glance (collected today, still to collect at the clinic, this month, last 30 days).
- **One-tap WhatsApp messages** for confirmations, reminders and follow-ups, and **send all of tomorrow's reminders** one after another.
- **Patient records:** visits, clinical notes (encrypted), pain-score trend chart, check-ins, consents and payments in one place.
- **Follow-ups** scheduled when a visit is completed, with overdue alerts and undo.
- **Payments:** online payments, refunds, fees received at the desk (UPI, cash or card), and a spreadsheet download for the accountant.
- **Settings without a developer:** fees, refund and reschedule rules (with change history), clinic open/closed/opening soon, holidays, Google Calendar link.
- **Content control:** approve patient stories, choose Instagram highlights, and switch any blog article on or off by its number.
- **Staff accounts** with per-section permissions, two-factor sign-in, and a security log of every sensitive action.
- **Works on a phone:** tables become readable cards, and forms ask before discarding anything typed.

### Visibility on Google and AI assistants
- A real page per topic, each with its own title, description and canonical address.
- Structured data that Google and AI assistants read directly: clinic (address, hours, fees), Dr Rajveer Singh with credentials, coccydynia (ICD-10 M53.3), FAQ, articles with sources, and breadcrumbs.
- `robots.txt` that welcomes AI assistants (ChatGPT, Claude, Gemini, Perplexity, Copilot and others) while keeping private areas closed.
- `llms.txt` and `llms-full.txt`, a plain-text guide for AI assistants.
- IndexNow, so Bing (which feeds ChatGPT search and Copilot) learns about new pages within hours.
- **Every old address redirects** to its new page (43 rules), so years of rankings and backlinks carry over when the domain moves.
- Old articles keep their original dates and author, and the 11 newspaper clippings have their own "In the news" page.

### Speed, quality and safety
- Pages load quickly on slow mobile connections:
  - small pages
  - compressed files
  - images sized for the screen
  - fonts loaded only when needed
  - the first screen shows without waiting for scripts
- Accessibility tested on every page (WCAG 2.1 AA checks), in light and dark mode.
- Security reviewed and hardened:
  - strict permissions
  - rate limits
  - encrypted notes and backups
  - protection against record takeover by phone number
  - sign-in that reveals nothing about which accounts exist
- 65 automated tests run on every change, and the build is checked for consistency.
- **Daily encrypted backups** and automatic retention clean-up (DPDP / GDPR).
- A **public demo** (tailbone.onrender.com) with sample data, for showing the system without touching real patients.

---

## 3. Change log

Newest first. Add one line per change.

| Date | Change |
|---|---|
| 18 Oct 2026 | **Fixes after review:** after an update, browsers sometimes kept the old design for up to a day, so new sections (fact tiles, picture cards, footer) looked broken. Every page now always loads the latest design. The clinic status under the tabs is now one tidy line: a coloured Open / Opening soon / Closed label and a short note. If the privacy box isn't ticked, booking is blocked (as before); the box is now outlined in red with the message right under it. |
| 18 Oct 2026 | **Dr Rajveer's own advice on the site:** four new articles from his videos (inward vs outward subluxation, when Kegel exercises make it worse, the risks of untrained "bone setting", amusement and water park rides), a new animated diagram of the tailbone shifting inward and outward, and "Dr Rajveer's five rules" on the Tailbone pain page. The cushion and pregnancy articles now include his advice, and the dynamic (sitting and standing) X-ray is explained consistently. |
| 18 Oct 2026 | **Cleaner look:** blog cards now show a picture and the title (tap anywhere to open); inside an article the booking box and "Keep reading" are clearly separate; "Go deeper" is split into "Dr Rajveer explains" and "What the research shows" with picture cards; the fact tiles have icons and colours; clinic tabs are colour-coded (green open, amber opening soon, grey closed) with a one-line status; footer contact details line up properly. |
| 18 Oct 2026 | **Dashboard tidy-up:** Settings is now in tabs (Fees & policies, Holidays, Online consultations, Calendar, My account, Data & backups) instead of one long page; buttons in Follow-ups due line up under the patient's name. A full website and dashboard map is in SITE-MAP.md. |
| 18 Oct 2026 | **Join call for online consultations:** the clinic saves its usual video room (Google Meet, Zoom…) in Settings, or a different link on one appointment. Patients see a "Join call" button in My appointments from 15 minutes before (never earlier, so nobody walks into another consultation), plus a short preparation guide and a camera and microphone test. The doctor has "Start call" and "Send link on WhatsApp" in the dashboard. Online confirmations and reminders now explain how to join, and use the appointment number. |
| 18 Oct 2026 | **Payment receipts:** every paid booking (online or at the clinic) gets a numbered receipt (e.g. TBR-2610-0001). Patients open it from My appointments, the clinic from the appointment's details; both can print it or save it as a PDF. Shows the service, the amount, how it was paid and any refunds. |
| 18 Oct 2026 | **Documents:** on a patient's page the clinic adds PDF or photo documents (treatment and exercise plans, visit summaries, reports) and ticks "Shared"; the patient downloads them under "Your documents" in My appointments. Optional patient uploads of earlier reports are built but switched off (Control panel). Files are checked to be real PDF/JPG/PNG, stored encrypted, every view is logged, and they're included in data downloads and removed with deletion requests. The demo patient has a sample exercise plan. |
| 17 Oct 2026 | Patient login (My appointments) checked end to end: login, reschedule, cancel, WhatsApp setting, data requests, past and cancelled bookings. The appointment number now works however it's typed (lower case, spaces, no dashes), and an empty form points to the missing field. |
| 17 Oct 2026 | Full audit of website, dashboard, backend and speed. Fixed two serious security issues (record takeover by phone number; permission bypass), plus Lucknow bookings, data erasure gaps and date checks. Added the money panel, "Received" button, payments spreadsheet and reminders queue. Made the mobile menu, forms and appointment card easier to use, and added a new 404 page. Pages load faster (first screen, fonts, images, compression). |
| 17 Oct 2026 | Blog: search, topic tags, numbered articles that the admin can switch off, "On this page" contents, WhatsApp share. The full menu now appears on My appointments and other pages. |
| 17 Oct 2026 | Nine evidence-based articles (facts and figures, coccyx shapes, body weight, women, two-wheelers, linked conditions, conditions that mimic tailbone pain, treatment steps, history), with tables, 8 new animated diagrams and verified sources. |
| 17 Oct 2026 | SEO and AI visibility: a page per topic, structured data, robots.txt for AI assistants, llms.txt, IndexNow, the old site's articles and press clippings, redirects from old addresses, and an SEO playbook. |
| 17 Oct 2026 | Google Ads: consent-based tags and conversions, and a Search campaign plan for Delhi NCR (₹10,000/month). |
| 17 Oct 2026 | Clinic open/closed/opening-soon status (Bengaluru closed, Lucknow soon); data requests handled by the clinic or automatically after 3 days; fee and policy change history; the appointment number is the patient's reference. |
| 17 Oct 2026 | Patient IDs, appointment numbers, QR codes and Google Calendar sync; doctor profile, facts page, blog, animated explainers and videos. |
| 17 Oct 2026 | Super admin control panel (feature switches, staff accounts, permissions); one-click demo logins. |
| 17 Oct 2026 | Privacy and security controls (DPDP / GDPR, ISO 27001 / 22301, NIST CSF) and a pre-launch audit. |
| 17 Oct 2026 | Payments, commission split, refund rules, two-way notifications. |
| 17 Oct 2026 | First version: redesigned website, online booking, follow-ups and the clinic dashboard. |

---

## 4. Future plan

### Before going live (owner actions)
- [ ] **Connect the domain:** point tailbonetreatment.com to Netlify (website records only; leave email untouched). Then switch canonical links and the sitemap to the domain (`SITE_URL`) and run IndexNow.
- [ ] **Connect the clinic server:** deploy it on Render, put its address in `netlify.toml` (`BACKEND_URL`), and set `ENCRYPTION_KEY` (keep a safe copy), `SITE_URL` and `PROXY_SECRET`. See the README.
- [ ] **Razorpay:** live keys and webhook; decide online payment or pay at clinic.
- [ ] **Google:**
  - Search Console with the sitemap submitted.
  - Bing Webmaster Tools.
  - Google Business Profile: Delhi updated, Bengaluru marked permanently closed.
- [ ] **Dr Rajveer reviews** the new articles and the homepage figures ("12 years", "20+ years"), and confirms the treatment wording.
- [ ] **Google Ads:** launch the Search campaign (website traffic first; switch to booking conversions once there are about 15 a month).

### Decisions we've put off (nothing is blocked by them)
- [ ] **Login code for patients** (item 3 below): until then, documents open only from bookings the clinic has confirmed, with the existing lockouts. Do this before switching on patient uploads widely.
- [ ] **Patient uploads:** built but off. Switch on in Control panel → "Patients can upload earlier reports" when the clinic is ready to receive them.
- [ ] **What to call the doctor's documents:** labels are "Treatment & exercise plan", "Visit summary", "Report" and "Other". Confirm with Dr Rajveer whether "prescription" should ever be used (he is a physiotherapist, BPT).
- [ ] **Video room:** put the clinic's usual Google Meet or Zoom link in Settings → Online consultations. Use a room where the doctor lets each patient in (waiting room / "ask to join").
- [ ] **GST on receipts:** receipts say "Payment receipt", not "Tax invoice". Ask the accountant whether GST applies to the clinic's services; if the clinic is registered, add its GSTIN and the wording they advise.
- [ ] **Storage:** documents are kept in the database and its backups, which is fine for a single clinic. Move them to cloud storage if they grow past a few gigabytes.

### Next (highest value first)
| # | Feature | Why | Effort |
|---|---|---|---|
| 1 | **Hindi version** of the key pages (home, tailbone pain, book, FAQ) and Hindi WhatsApp messages | Many Delhi NCR patients search and read in Hindi | Medium |
| 2 | **Automatic WhatsApp** (Business API): confirmations, reminders 24 h and 2 h before, and check-ins sent without tapping | Saves the clinic time every day and reduces no-shows | Medium (needs a WhatsApp Business API account) |
| 3 | **Log in to My appointments with a one-time code** sent to the patient's phone | Patients lose their appointment number, and it's the strongest protection for their data | Medium (needs #2 or an SMS provider) |
| 4 | **Clinic day view:** today's list with Arrived, Complete, notes and next visit in one place | Faster on the clinic phone during busy hours | Low |
| 5 | **Week calendar** in the dashboard, with drag to reschedule | See gaps and clashes at a glance | Medium |
| 6 | **Symptom check result sent to WhatsApp** with how long the pain has lasted and the city | More bookings from the symptom check | Low |
| 7 | **Patient timeline and visit-notes template** (one feed of visits, notes, check-ins, messages and payments) | Quicker review before each visit | Medium |
| 8 | **No-show and drop-off watchlist** with a one-tap re-engage message | Brings patients back for review | Low |
| 9 | **Install as an app (PWA)** and new-booking alerts on the doctor's phone | Alerts without checking email | Medium |

### Content (ongoing)
- Two articles a month, reviewed and signed by Dr Rajveer. Topics are listed in [SEO-AND-AI-VISIBILITY.md](SEO-AND-AI-VISIBILITY.md).
- Add new research as it is shared, with checked sources.
- Short YouTube videos answering common questions, each linking to its article.
- New press coverage goes into `content/press.json`.

### Technical upkeep
- Add automatic code formatting and checks (Prettier and ESLint) to the CI checks.
- Split the large dashboard and site scripts into smaller files, and tidy the stylesheet's later additions back into their sections.
- Monthly: check Search Console, Analytics (including visits from AI assistants), and the five AI spot-check questions in the SEO playbook.

---

## 5. Open-source projects we learn from

These GitHub projects do parts of what this system does. We borrow ideas from them, not code (our system is built for a single clinic in India, with Razorpay, WhatsApp and the DPDP Act):

| Project | What we look at it for |
|---|---|
| [Frappe Health](https://github.com/frappe/health) | Billing and receipts, consultation records, Indian clinic workflows |
| [OpenEMR](https://github.com/openemr/openemr) | Patient portal, structured visit notes, documents |
| [Bahmni](https://github.com/Bahmni) | Clinical forms used in Indian hospitals |
| [Medplum](https://github.com/medplum/medplum) / [Ottehr](https://github.com/masslight/ottehr) | Online consultations with a "join call" flow |
| [Cal.com](https://github.com/calcom/cal.com) | Booking experience and reminders |
| [Easy!Appointments](https://github.com/alextselegidis/easyappointments) | Simple self-hosted booking |

## 6. Where things are
- Page text: `content/site.html`. Articles: `content/blog/`. Press: `content/press.json`. Old-address redirects: `content/redirects.json`.
- `npm run build` publishes everything into `public/`. Commit and push, and Netlify deploys.
- More detail:
  - [SITE-MAP.md](SITE-MAP.md) (every page and dashboard section)
  - [SEO-AND-AI-VISIBILITY.md](SEO-AND-AI-VISIBILITY.md)
  - [AUDIT-REPORT.md](AUDIT-REPORT.md)
  - [PAYMENTS-SECURITY-HOSTING.md](PAYMENTS-SECURITY-HOSTING.md)
  - [CLINIC-AUTOMATION-CHECKLIST.md](CLINIC-AUTOMATION-CHECKLIST.md)
  - the Google Ads plan: `resources/google-ads/`
