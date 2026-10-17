# Tailbone Treatment Clinic

The website and clinic system for [tailbonetreatment.com](https://tailbonetreatment.com/), the coccydynia clinic run by Dr Rajveer Singh in New Delhi and online (Lucknow opening soon; the Bengaluru clinic has closed).

- **Patients** book real slots online, manage their booking, fill in progress check-ins and share their stories.
- **The clinic** runs everything from a dashboard at `/admin`: appointments, follow-ups, patient records with pain charts, story moderation, Instagram highlights, holidays and exports.

- **Clinics** can be set to open, closed or "opening soon" from the dashboard (Settings → Fees & policies). Every change to fees, clinics and rules is recorded with date, time and who made it, and each booking keeps the cancellation and reschedule rules in force when it was made.
- **Data requests** (copy, correction, deletion) from My appointments go to the dashboard and complete automatically after 3 days if staff haven't acted.
- **Every patient gets a permanent patient ID** (`TBP-00042`) and **every booking an appointment number** (`TBA-2610-0007`), a QR code and a printable appointment card.
- **Google Calendar:** bookings sync to the doctor's calendar both ways (his busy times block slots), plus a private subscription link. See DEPLOY.md.
- **Blog:** articles live as Markdown in `content/blog/`. Run `npm run build` to publish them to `/blog/`. Each article needs an `id:` (its permanent number: use the next unused one, never reuse or change it) and two to four `tags:` from the list in `scripts/build-blog.js` (`TAGS`). Add a line `::anim sitting` (or another file name in `content/animations/`) to place an animated explainer. Visitors can search the blog and filter it by topic. The dashboard's **Blog** section can hide any article by its number; hidden articles disappear from the site at once.
- **Animated explainers** (`content/animations/`): lightweight SVG animations used on the homepage and in the blog, with a still frame for reduced motion. `resources/videos/` has the same animations as MP4s for YouTube, Instagram and Google Ads.
- **One source for the pages:** `content/site.html` holds every short page; `npm run build` turns it into a separate file per page (own title, description, canonical link, structured data), plus the blog, the press page, the sitemap, `robots.txt`, `llms.txt` and the old-site redirects. Commit the output in `public/`.
- **SEO and AI assistants:** see [docs/SEO-AND-AI-VISIBILITY.md](docs/SEO-AND-AI-VISIBILITY.md).
- **Payments** go through Razorpay, with an optional automatic commission split (Route), policy-based refunds and automatic notifications both ways.

- **Security & privacy controls** for ISO 27001 / 22301 / 31000, NIST CSF, DPDP and GDPR:
  - consent capture
  - rights requests
  - data export and erasure
  - automatic retention
  - 2FA, lockout and the security log
  - encrypted daily backups

- **Super admin control panel:**
  - switch website features on or off
  - add, disable or reset dashboard users
  - choose which sections each admin can open
  - commission, backups and the security log are super admin only

**Deploying to Netlify? Start with [DEPLOY.md](DEPLOY.md).** · **Site tree: [docs/SITE-MAP.md](docs/SITE-MAP.md).** · **Demo with one-click doctor and patient logins: `DEMO_MODE=true` (see DEPLOY.md).**

Docs:
- **[docs/PAYMENTS-SECURITY-HOSTING.md](docs/PAYMENTS-SECURITY-HOSTING.md)**: commission split, fees and refund rules, security, Netlify + Render setup
- **[docs/CLINIC-AUTOMATION-CHECKLIST.md](docs/CLINIC-AUTOMATION-CHECKLIST.md)**: workload, automation and marketing plan
- **[docs/compliance/](docs/compliance/00-README.md)**: information security policy, ISO 27001 Statement of Applicability, ISO 31000 risk register, ISO 22301 continuity plan, incident and breach procedure, NIST CSF profile, DPDP/GDPR records

## Quick start

Requires **Node.js 22.5+**. The app uses the built-in `node:sqlite`, so there's no database server to install.

```bash
npm install
cp .env.example .env         # set ADMIN_EMAIL / ADMIN_PASSWORD
npm start                    # http://localhost:3000, dashboard at /admin
```

Other commands:

```bash
npm run dev                                      # restart on file changes
npm test                                         # API tests
npm run admin:create -- doctor@example.com "Dr Rajveer Singh"   # add or reset an admin
```

## Features

### Patient side
| Page | What it does |
|------|--------------|
| `/` | Short homepage: hero, key numbers, and cards linking to each page |
| `/coccydynia` · `/treatment` · `/doctor` · `/locations` · `/faq` | Separate short pages (symptom checker and tips · treatment journey and Instagram · doctor and stories · clinics with maps and hours · FAQ). They switch instantly without reloading (`public/assets/js/router.js`); old `/#section` links redirect |
| `/book` | **Live booking**: clinic → day strip (free-slot counts) → time slot → details. Returns a booking reference, a WhatsApp hand-off and an "Add to calendar" (.ics) file |
| `/manage.html` | Patients **reschedule or cancel** using their reference and phone number |
| `/checkin.html?t=…` | **Follow-up check-in**: 0–10 pain score, better/same/worse, sitting tolerance. Happy patients are invited to share a story |
| `/stories.html` | All published stories, plus a **share your story** form (with consent; published as first name and last initial only) |
| `/policies.html` | Terms, fees, cancellation, rescheduling and refund policy (numbers load live from Settings) |

### Clinic dashboard (`/admin`)
- **Overview:**
  - today's schedule
  - tomorrow's patients, each with a one-tap WhatsApp reminder
  - follow-ups due
  - ⚠️ patients reporting high or worsening pain
  - KPIs and a 14-day chart
- **Appointments:** filter and search; confirm, complete, cancel or reschedule; private notes; pre-written WhatsApp confirmation, reminder and cancellation messages; add phone and walk-in bookings.
- **Complete visit → schedule follow-up** in one step (+3, 7, 14 or 30 days; check-in form, call, review visit or WhatsApp).
- **Follow-ups:** due, overdue, upcoming and completed views, with WhatsApp and copy-link actions.
- **Patients:** search; a profile with editable contact details and private notes; full appointment history; follow-ups; a **pain-score chart** over time; an "Ask for a story" link.
- **Stories:** approve, reject, edit, feature, or add feedback received elsewhere.
- **Instagram:** paste post or reel links (most-viewed first) to show them on the homepage, using Instagram's own embed, loaded on tap.
- **Inbox:** every booking, reschedule and cancellation made by patients, plus the outbox of messages to patients (sent automatically via the WhatsApp API, or one tap each).
- **Payments:** collected, refunded, net, doctor's share and platform fee per period.
- **Settings:** fees per clinic, follow-up rate, pay-online or pay-at-clinic, cancellation refund tiers, reschedule limits, commission split; block holidays; CSV export; change password.
- **Appointment details:** payment and refund panel, an "issue refund" button, the full change history, and a preview of what the patient will be told.

### Under the hood
- Express 5 + SQLite (WAL mode). A partial unique index makes **double booking impossible**, even with simultaneous requests.
- All times are clinic time (IST). Slots are 30 minutes, at least 60 minutes ahead and up to 60 days out (edit in `server/config.js`).
- Security:
  - scrypt password hashing
  - signed, HttpOnly, SameSite=Strict session cookies
  - a CSRF header check
  - login, booking and lookup rate limits
  - a honeypot spam field
  - output escaping in every view
  - CSV formula-injection protection
  - no third-party trackers
- Design system:
  - Sora (display) and Inter (text) fonts
  - fluid type and spacing scales
  - 44px+ touch targets
  - light and dark themes
  - reduced-motion support
  - layout checked at 360, 390, 768, 1024 and 1440px

## Project structure

```
server/
  index.js          start-up (opens DB, seeds admin + stories)
  app.js            Express app, security headers, error handling
  config.js         clinics, opening hours, booking rules, env
  db.js             schema
  time.js           IST date/slot helpers
  services.js       booking, follow-up, story and Instagram logic; WhatsApp message templates
  auth.js           passwords, sessions, rate limiting
  routes/public.js  /api/*        (website, manage, check-in, stories, media)
  routes/admin.js   /api/admin/*  (dashboard)
public/             website, patient pages and /admin dashboard (no build step)
scripts/            create-admin.js
test/               API tests (node:test)
docs/               automation and marketing checklist
```

## Deploying

**Netlify + Render (recommended):** see [docs/PAYMENTS-SECURITY-HOSTING.md](docs/PAYMENTS-SECURITY-HOSTING.md#4-hosting-netlify--a-backend). `netlify.toml` serves `public/` and proxies `/api/*`; `render.yaml` runs the backend with a persistent disk.

Other options:

The app is a single Node process plus one SQLite file, so it needs a **persistent disk** for `DATA_DIR`.

- **Docker:** `docker build -t tailbone . && docker run -p 3000:3000 -v tailbone-data:/data --env-file .env tailbone`
- **Render / Railway / Fly.io:** set the start command to `npm start`, attach a persistent volume and point `DATA_DIR` at it.
- **VPS:** run with `pm2` or systemd behind Nginx or Caddy with HTTPS.

Set `SITE_URL` to the public URL so links in WhatsApp messages are correct. Back up the `data/` folder regularly, since it holds all patient records.

## Customising
- Clinics, hours and slot length: `server/config.js` (and the hours list in `content/site.html`, then `npm run build`).
- WhatsApp message wording: `messages()` and `checkinMessage()` in `server/services.js`.
- Phone and WhatsApp number: `WHATSAPP_NUMBER` in `.env`, and the links in `public/*.html`.
