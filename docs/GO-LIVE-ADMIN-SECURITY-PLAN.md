# Go-live, dashboard and security plan (Phases 1–3)

**For:** the clinic owner and Dr Rajveer Singh · **Date:** 6 November 2026 · **Status:** proposal, waiting for approval

This document has four parts:

1. What a full professional review of the website found, and what to fix.
2. What the doctor will be able to change himself in the dashboard, in three phases.
3. How to make the website live, step by step.
4. Security and legal rules, in three phases, with an honest note on which standards apply.

---

## 1. Professional review: what to correct or improve

**What is already strong:** secure connection settings, encrypted backups, encrypted clinical notes and documents, sign-in lockout after repeated failures, sessions that end when idle, a security log kept 2 years, consent and data-rights handling, 88 automatic tests, and fast pages.

**Fixed during this review (6 Nov):**
- A building block of the server (the part that reads form data) had a known weakness that could let someone slow the server down. It has been updated, and no known weaknesses remain.
- The security policy still listed the Bengaluru clinic. It now says New Delhi, Online and Lucknow (opening soon).

**Still to do.** "Must" means before going live.

| # | Priority | Area | Finding | What to do | Phase |
|---|---|---|---|---|---|
| 1 | Must | Going live | The public site is up, but booking, payments, My appointments and the dashboard need the server, which isn't deployed yet. The site still uses its temporary netlify.app address. | Follow part 3 below. | 1 |
| 2 | Must | Google | Google is told the main address is tailbone.netlify.app. Rankings built there would have to move later. | Switch everything to tailbonetreatment.com on launch day. The old-site redirects are already built. | 1 |
| 3 | Must | Security | Two-step sign-in (a code from a phone app) is available for staff but optional. | Make it compulsory for every dashboard account. | 1 |
| 4 | Must | Backups | Daily backups are encrypted, but they are kept on the same server disk. If the server is lost, the backups go with it. | Copy each night's backup to a second place (for example Google Drive or cloud storage), and test a restore every 3 months. | 1 |
| 5 | Must | Legal / professional | Some wording and features carry professional-rule risk: the "Dr" title used with a BPT qualification, "Exclusive specialist", patient testimonials, and referral rewards to doctors and hospitals (₹1,000 a visit). | One-time review by a healthcare lawyer, or a check with the physiotherapy council under the NCAHP Act 2021. Until then, keep rewards for doctors and hospitals switched off and use "Coccyx pain specialist". | 1 |
| 6 | Must | Medical content | The 30 articles, the new picture guide and the Hindi pages have not yet been read by Dr Rajveer or a Hindi speaker. | Dr Rajveer reads and approves them. Each article then shows "Medically reviewed by Dr Rajveer Singh, <date>", which Google also values for health content. | 1 |
| 7 | Must | Paperwork | The security and privacy documents (docs/compliance) still have blanks for the owner's name, the person responsible and the approval date. | Fill them in and sign. Name a grievance officer for patients' privacy complaints, as the DPDP law requires. | 1 |
| 8 | High | Email | Emails from the clinic's domain can land in spam unless the domain is set up to vouch for them (records called SPF, DKIM and DMARC). | Set these up on launch day. | 1 |
| 9 | High | Monitoring | Nobody is alerted if the site goes down or errors pile up. | Free uptime monitor with SMS or email alerts, plus a weekly automatic security check of the code's building blocks. | 1 |
| 10 | High | Dashboard | Changing page text, FAQs, opening hours, photos or YouTube videos needs a developer today. | The dashboard "Website content" section (part 2). | 1–3 |
| 11 | Medium | Accounts | Every outside account (Gmail, domain, Netlify, Render, Razorpay, GitHub, Meta) needs two-step sign-in and a recovery phone. | Part 3, step 1. | 1 |
| 12 | Medium | Money | There is no GST invoice and no monthly check that Razorpay's payouts match the bookings. | Add both. | 2 |
| 13 | Medium | Attack protection | There is no shield in front of the site against bots and floods of traffic. | Put Cloudflare (free plan) in front of the domain. | 2 |
| 14 | Medium | Testing | Nobody outside has tried to break in. | An independent security test (called VAPT) by a CERT-In empanelled firm, then once a year. | 2 |
| 15 | Medium | Accessibility | There has been no formal check for people with poor sight or who use screen readers. | WCAG 2.1 AA audit and fixes. | 2 |
| 16 | Low | Old articles | The 12 articles from the old site have odd capitals in their titles, and some read like adverts. | Tidy the titles and add "Medically reviewed". | 2 |
| 17 | Low | Small fixes | The pain chart in My appointments has no axis labels; one newspaper photo is large (335 KB); the demo shows an error on Backups. | Small fixes. | 1 |
| 18 | Low | Getting found | The Google Business Profile, its reviews and Search Console are not linked yet. | Part 3, step 9. | 1 |

---

## 2. What the doctor can change himself (dashboard "Website content")

**Already in the dashboard today:**
- Instagram videos: add by link, hide, delete.
- Articles: write with pictures, video and audio; publish; hide.
- Patient stories: approve, edit.
- Fees and policies, holidays, WhatsApp settings.
- Website feature switches and staff accounts.

**Rules in every phase:** every change is saved with who made it and when, can be previewed before it goes live, and the last version can be restored with one click.

### Phase 1: videos and everyday updates (with go-live, about 2–3 weeks)

| Section | Add | Edit | Hide / show | Delete | Reorder |
|---|---|---|---|---|---|
| **YouTube videos** (new): paste a link, add a title, choose where it shows (Home, Treatment, Doctor) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Instagram videos** (exists; add reordering and "where it shows") | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Announcement bar** (e.g. "Closed on 14 Nov", "Lucknow now open"), with start and end dates | ✅ | ✅ | ✅ | ✅ | – |
| **Opening hours, phone, WhatsApp, email** | – | ✅ | – | – | – |
| **FAQ** questions and answers | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Newspaper clippings** (photo, paper, year) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Articles, stories, fees, holidays (exist) | ✅ | ✅ | ✅ | ✅ | – |

Not in phase 1: changing page layouts, the home page's main text, or clinic locations. These stay with the developer for now.

### Phase 2: page text, photos and roles (about 1–2 months after launch)

- **Edit page text:**
  - the home page headline and key numbers;
  - the treatment steps;
  - Dr Rajveer's profile;
  - "Why patients choose us".
- **Photo library:** upload once, use anywhere. Pictures are shrunk automatically.
- **Clinics:** add or edit a clinic (address, map, hours, status), for example when Lucknow opens.
- **English and Hindi side by side:** edit both versions of the same text together.
- **Google search text:** the title and description shown in search results for each page.
- **Staff roles:**
  - a *content editor* can draft;
  - *the doctor approves* anything medical before it goes live;
  - *reception* sees appointments only.
- Video testimonials (with the patient's consent recorded).

### Phase 3: full control (about 3–6 months after launch)

- **Show, hide and reorder** whole sections of any page.
- **New landing pages** for ad campaigns (e.g. "Tailbone pain after delivery"), made from ready blocks.
- **Scheduled publishing** (an article or announcement goes live on a chosen date).
- **Headline testing:** try two headlines and keep the one that gets more bookings.
- **Whole-site history:** see any earlier version and roll back.
- **Visitors and bookings report inside the dashboard,** without opening Google tools.
- More languages if needed.

---

## 3. How to make the website live

**About the Gmail and password:** please don't send the password to me or anyone in chat. You (or Dr Rajveer) sign in to each service yourself; I prepare everything else and change the settings in the code. Where a service needs a secret key, the session can open a secure form for it, so it never appears in the chat.

| Step | Who | What | Time |
|---|---|---|---|
| 1. Lock down the Gmail | You | Turn on 2-Step Verification (Google Authenticator or a passkey). Add a recovery phone and email. Save the backup codes in a safe place. | 15 min |
| 2. Password manager | You | Bitwarden, 1Password or Google Password Manager, for every account below. | 15 min |
| 3. Domain | You | Find where tailbonetreatment.com is registered and sign in. Turn on two-step sign-in and "registrar lock". | 15 min |
| 4. Server (Render) | You sign up with the Gmail; I guide the clicks | Create the server from the ready-made plan in the code. The Starter plan plus a 1 GB disk costs about US$8–10 a month. Create the secret keys; the encryption key **must be saved in two safe places**, because without it encrypted notes and backups can't be opened. | 45 min |
| 5. Website (Netlify) | Me | Point the site at the server and connect the domain. The secure padlock (HTTPS) is automatic. | 30 min |
| 6. Switch to the real address | Me | Every page, the sitemap and Google's settings change from tailbone.netlify.app to tailbonetreatment.com. Old links keep working. | 1 h |
| 7. Payments (Razorpay) | You, then me | Finish the business check (KYC), create live keys, then I connect them. Test with a ₹1 booking and a refund. Razorpay charges about 2% per payment. | 1–3 days for KYC |
| 8. Email and WhatsApp | You, then me | Email: sending service and the domain records from finding 8. WhatsApp: Meta business verification and approval of the message templates. | 2–7 days for Meta |
| 9. Google | You, then me | Search Console (send the sitemap), Google Business Profile (link the site and the booking page), Analytics and Ads IDs. | 1 h |
| 10. Final checks | Both | Create the doctor's dashboard account with two-step sign-in; book, pay, reschedule and cancel a test appointment; restore a backup; turn on the uptime alert. | 2 h |
| 11. Launch and watch | Me | Daily checks for 2 weeks: bookings, payments, emails, Google errors. | 2 weeks |

**Running costs (approximate):**
- Server: about US$8–10 a month.
- Website hosting (Netlify): free.
- Domain: about ₹1,000 a year.
- Payments: about 2% per payment (Razorpay).
- WhatsApp: Meta's per-message charges, small at this volume.
- Email: free at this volume.
- Cloudflare: free.

---

## 4. Security and legal rules by phase

### Which standards and laws apply

| Name | What it is | Does it apply to the clinic? | What we do |
|---|---|---|---|
| **DPDP Act 2023 + DPDP Rules 2025** | India's data protection law | **Yes, the main one** | Notice, consent, data rights, deletion, security, breach reporting to the Data Protection Board within 72 hours. Mostly built; a grievance officer must be named (finding 7). |
| **IT Act 2000 + CERT-In Directions 2022** | Indian cyber rules | **Yes** | Report serious cyber incidents to CERT-In within 6 hours. Keep logs at least 180 days (we keep 2 years). Keep server clocks synchronised. |
| **NCAHP Act 2021** | Law for allied health professionals, including physiotherapists | **Yes** | Professional registration and conduct, including the "Dr" title and advertising (finding 5). |
| **Clinical Establishments Act / Delhi registration** | Clinic registration | **Likely yes** | Check the clinic's registration is current, and show it on the site. |
| **Consumer Protection Act 2019 + ASCI code** | Advertising rules | **Yes** | No misleading claims. Testimonials must be genuine, with consent, and say "results vary" (already done). |
| **Drugs and Magic Remedies Act 1954** | Bans "cure" advertising | **Yes** | No "guaranteed cure" claims. None found in the review. |
| **Telemedicine Practice Guidelines 2020** | Rules for online consultations by medical doctors | Partly, as good practice | Consent, identity check and records for online visits (already built). |
| **GDPR** | EU and UK data law | Only for patients in the EU or UK | Already handled together with DPDP. |
| **HIPAA** | US law for US hospitals and insurers | **No** | We follow similar safeguards, but **never claim "HIPAA compliant"**. That claim would be misleading. |
| **ISO 27001** (information security) and **ISO 22301** (business continuity) | Voluntary certificates, granted after an outside audit | Optional | The software and policy documents are ready. The clinic can only *claim* them after passing the audit (phase 3). |
| **ISO 31000** (risk management) | Guidance, no certificate | Optional | Already followed; there is a risk register in docs/compliance. |
| **ICMR ethical guidelines** | Rules for medical research | Only if patient cases or data are published as research | Written consent before using any case, photo or data in research or papers. |
| **WHO** | Global health guidance, not a law | No rules to meet | Can be cited as a source in articles. |
| **PCI DSS** (card payments) | Card security rules | Handled by Razorpay | We never see card numbers. |
| **RPwD Act 2016 / WCAG 2.1** | Accessibility | Good practice | Accessibility audit (finding 15). |

### What gets done in each phase

| Phase 1: before launch | Phase 2: first 3 months | Phase 3: 3–12 months |
|---|---|---|
| Secure connection (HTTPS, HSTS) and browser protections ✅ already | Cloudflare shield against bots and traffic floods | ISO 27001 and ISO 22301 certification (with a consultant, about 4–6 months; get 2–3 quotes) |
| Encrypted clinical notes, documents and backups ✅ already | Independent security test (VAPT) by a CERT-In empanelled firm | Yearly security test and a yearly restore drill |
| Compulsory two-step sign-in for all staff | Signed privacy impact assessment and data-processing agreements with Render, Netlify, Razorpay and Meta | Standby copy of the server in a second region |
| Copy of the nightly backup to a second place, and a restore test | Staff confidentiality agreements and a short security training | Round-the-clock security monitoring service |
| Two-step sign-in on all outside accounts; domain lock | Access review every 3 months: who can see what | Health ID (ABDM / ABHA) link-up, if wanted |
| Grievance officer named; policies signed | Alerts for suspicious sign-ins | Yearly review of the policies by management |
| Breach plan: Data Protection Board 72 h, CERT-In 6 h, patients informed | GST invoices; monthly payment matching | |
| Uptime monitor and weekly building-block security check | Change keys and passwords on a schedule | |

### "No one should copy" — what is and isn't possible

Anything a browser can show, a person can copy, by screenshot if nothing else. Blocking right-click or text selection doesn't stop copying, annoys patients and breaks accessibility, so we don't recommend it.

What we recommend instead:
1. **Patient data:** the real protection is encryption, sign-in rules and access logs. These are already built. Nobody can see patient data without an account.
2. **Copyright notice and terms of use** in the footer: "© Tailbone Treatment Clinic. Text, diagrams and photos may not be reused without permission."
3. **Mark our own pictures:** a small clinic logo on our diagrams, slides and photos.
4. **Proof of origin:** each article shows its author and date, so it is clear who published first.
5. **Watch and take down:** a monthly Google Alert or Copyscape check; copies are removed through Google's DMCA form and the host.
6. **AI bots:** keep search engines and AI search allowed, because they bring patients. Optionally block bots that collect text only to train AI models (one line in robots.txt; your choice).
7. **Code:** the server code and settings stay private (a private GitHub repository). The page design is visible to browsers by nature, which is normal.

---

## Decisions needed from you

1. Approve phase 1 of the dashboard (part 2) so it can be built.
2. Choose a launch date, and do steps 1–4 of part 3 with me.
3. Arrange the legal check (finding 5) and Dr Rajveer's review of the articles (finding 6).
4. AI training bots: allow or block (part 4, "No one should copy", item 6).
