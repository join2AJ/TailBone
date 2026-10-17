# Site map

## Public website (patients)

```
tailbone.netlify.app
│
├── /                     Home: hero, key numbers, 6 "explore" cards
├── /coccydynia           What is coccydynia: causes, symptom self-check, 5 self-care tips
├── /treatment            How treatment works: 4-step journey, why choose us, Instagram videos
├── /doctor               Dr Rajveer Singh: profile, patient stories carousel
├── /locations            Clinics: Bengaluru · New Delhi · Online tabs, maps, opening hours
├── /faq                  Frequently asked questions
├── /book                 Book an appointment
│     ├── live slots → pay (Razorpay, if on) → booking reference + WhatsApp + calendar file
│     └── no server reachable → same form sends a WhatsApp request
│
├── /stories.html         All patient stories + "Share your story" form
├── /manage.html          My appointments (booking reference + phone)
│     ├── reschedule / cancel (shows the refund before confirming)
│     └── your data: download it, WhatsApp updates on/off, correct or delete
├── /checkin.html?t=…     Follow-up check-in from a WhatsApp link (pain 0–10, better/same/worse)
├── /policies.html        Terms, fees, cancellation & refund policy
├── /privacy.html         Privacy notice (DPDP / GDPR) + data-rights request form
├── /404.html             Page not found
│
├── /sitemap.xml · /robots.txt · /.well-known/security.txt
└── Always available:     top bar (open/closed now) · menu · floating WhatsApp · phone bottom bar (Call · WhatsApp · Book)
```

## Clinic dashboard (staff)

```
/admin                    Sign in (email + password + 2FA code) · demo button in demo mode
│
├── #/overview            Today, tomorrow's reminders, follow-ups due, pain alerts, key numbers, 14-day chart
├── #/appointments        Filter and search · confirm · complete (+ follow-up) · reschedule · cancel · refund · history
├── #/inbox               Changes made by patients · messages waiting to be sent to patients
├── #/followups           Due · overdue · upcoming · done (send check-in link on WhatsApp)
├── #/patients            Search
│     └── #/patient/:id   Contact, private notes, consent record, export / erase data, pain chart, visits, follow-ups
├── #/stories             Approve, feature, edit or reject patient stories
├── #/instagram           Choose the reels and posts shown on /treatment
├── #/payments            Collected · refunded · net · doctor's share / platform fee
├── #/privacy             Data-rights requests with 30-day deadlines
├── #/settings            My password and 2FA · fees and refund rules · holidays · CSV export (by permission)
│                         + commission split, backups, security log (super admin only)
└── #/control             ★ Super admin only: switch website features on or off · add, disable or reset users · choose each admin's sections
```

## Who can do what

| Role | Access |
|---|---|
| **Super admin** (the platform owner; the first account, from `ADMIN_EMAIL`) | Everything, plus the Control panel, commission settings, backups and the security log. There is always at least one super admin. |
| **Admin** (e.g. Dr Rajveer, front desk) | Overview and their own password and 2FA, plus only the sections the super admin ticks: appointments, follow-ups, patients, inbox, stories, Instagram, payments, privacy, settings, export. |

**Website features the super admin can switch off:**
- online booking (the Book page then sends a WhatsApp request)
- online payments
- patient reschedule/cancel
- follow-up check-ins
- stories
- Instagram
- the symptom checker
- the WhatsApp bubble

Privacy rights (the notice, requests and "download my data") always stay on.

## API (used by the pages; not for visitors)

```
/api
├── config · days · slots                              opening hours, fees, policy, free slots
├── appointments (POST)                                book
├── payments/verify · payments/webhook                 Razorpay
├── manage/lookup · cancel · reschedule · export · consent
├── checkin/:token                                     follow-up check-in
├── stories · media                                    published stories, Instagram posts
├── privacy/request                                    data-rights request
├── admin/*                                            dashboard (sign-in required, per-section permissions)
└── admin/superadmin/*                                 features and users (super admin only)
```

## Demo mode (`DEMO_MODE=true`, a separate sample database that resets every 24 h)

| Who | One-click link | What you see |
|---|---|---|
| Doctor (admin) | `/admin?demo=1`, or the **Try the demo as the doctor** button on the sign-in page | Full dashboard with 6 sample patients: today's visits, a pain alert, follow-ups, a cancellation and refund, a story to approve, a privacy request |
| Patient | `/manage.html?demo=1`, or the **Try as a demo patient** button | Asha Verma's booking tomorrow (TB-DEMO42): reschedule, cancel with refund preview, download data |

The yellow demo bar on every page links to both. In demo mode no real WhatsApp messages, emails or payments are sent, and password, 2FA and backup actions are disabled.
