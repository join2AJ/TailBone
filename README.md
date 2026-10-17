# Tailbone Treatment Clinic

The website and clinic system for [tailbonetreatment.com](https://tailbonetreatment.com/), the coccydynia clinic run by Dr Rajveer Singh in Bengaluru, New Delhi and online.

- **Patients** book real slots online, manage their booking, fill in progress check-ins and share their stories.
- **The clinic** runs everything from a dashboard at `/admin`: appointments, follow-ups, patient records with pain charts, story moderation, Instagram highlights, holidays and exports.

See **[docs/CLINIC-AUTOMATION-CHECKLIST.md](docs/CLINIC-AUTOMATION-CHECKLIST.md)** for the workload, automation and marketing plan.

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
| `/` | Homepage with live open/closed status, symptom checker, treatment journey, live stories, Instagram highlights, clinic tabs with maps, FAQ |
| `/#appointment` | **Live booking**: clinic → day strip (free-slot counts) → time slot → details. Returns a booking reference, a WhatsApp hand-off and an "Add to calendar" (.ics) file |
| `/manage.html` | Patients **reschedule or cancel** using their reference and phone number |
| `/checkin.html?t=…` | **Follow-up check-in**: 0–10 pain score, better/same/worse, sitting tolerance. Happy patients are invited to share a story |
| `/stories.html` | All published stories, plus a **share your story** form (with consent; published as first name and last initial only) |

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
- **Settings:** block holidays per clinic, export all appointments to CSV, change password.

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

The app is a single Node process plus one SQLite file, so it needs a **persistent disk** for `DATA_DIR`.

- **Docker:** `docker build -t tailbone . && docker run -p 3000:3000 -v tailbone-data:/data --env-file .env tailbone`
- **Render / Railway / Fly.io:** set the start command to `npm start`, attach a persistent volume and point `DATA_DIR` at it.
- **VPS:** run with `pm2` or systemd behind Nginx or Caddy with HTTPS.

Set `SITE_URL` to the public URL so links in WhatsApp messages are correct. Back up the `data/` folder regularly, since it holds all patient records.

## Customising
- Clinics, hours and slot length: `server/config.js` (and the hours list in `public/index.html`).
- WhatsApp message wording: `messages()` and `checkinMessage()` in `server/services.js`.
- Phone and WhatsApp number: `WHATSAPP_NUMBER` in `.env`, and the links in `public/*.html`.
