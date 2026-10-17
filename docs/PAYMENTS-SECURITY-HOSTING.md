# Payments, your commission, security and hosting

## 1. Can I take ₹100 of every ₹800 booking?

**Yes, but only through the payment gateway's split-payment product, never by collecting the money yourself.**

| | ✅ Do this: gateway split (Razorpay Route) | ❌ Don't: collect ₹800 then pay the doctor ₹700 |
|---|---|---|
| How money moves | Patient pays Razorpay. Razorpay settles ₹700 to the doctor's bank and ₹100 to yours | Everything lands in your account and you transfer the doctor's share |
| Legal position | Razorpay is the RBI-licensed payment aggregator | You'd be acting as an unlicensed payment aggregator (RBI PA guidelines) |
| Refunds | Automatic. Both shares are reversed proportionally (`reverse_all`, built in) | You'd have to claw money back from the doctor by hand |
| Trust | The doctor sees every rupee in their own Razorpay dashboard | Disputes are likely |

**What's already built:**
- Dashboard → Settings → **Platform commission**: switch it on and choose a fixed ₹ amount (e.g. ₹100) or a % per booking.
- The doctor's Razorpay *linked account id* (`acc_…`) is entered in the same place.
- Every order is created with a `transfers` entry that sends the doctor's share automatically.
- Dashboard → **Payments** shows collected, refunded, net, doctor's share and platform fee for any date range.

### Steps to make it live
1. **Open a Razorpay account in your name or your business's name** (you are the "platform").
   - Route needs a registered business. A sole proprietorship with GST/Udyam, an LLP or a Pvt Ltd usually works.
   - Ask Razorpay support to enable **Route**.
2. In Razorpay → Route, **add the doctor as a Linked Account** with his bank and KYC details. Copy the `acc_…` id into the dashboard.
3. Put your API keys in the server's environment (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
4. Create a webhook pointing to `https://<site>/api/payments/webhook` for these events:
   - `payment.captured`
   - `order.paid`
   - `refund.processed`
   - `refund.failed`

   Put its secret in `RAZORPAY_WEBHOOK_SECRET`.
5. Test in Razorpay **Test mode** first (test keys, test UPI or cards), then switch to live keys.

### Things to sort out with a CA and the doctor (not legal advice)
- **A written agreement with the doctor.** It should cover:
  - the platform fee (₹100 or x%)
  - who bears Razorpay's gateway charges (about 2% + GST, deducted from the platform account by default)
  - who absorbs the platform fee on refunds (the default here: both shares are reversed proportionally)
  - termination and data ownership: patient data belongs to the clinic
- **GST.** Healthcare services by a clinical establishment are generally GST-exempt. Your platform or maintenance fee is a separate taxable service, and GST registration becomes mandatory above the turnover threshold (₹20 lakh for services in most states). Platforms that collect payments for others can also attract e-commerce operator rules. **Ask a CA before going live.**
- **Income tax.** The platform fee is your business income. Razorpay provides settlement reports for bookkeeping.
- **Show the patient one clear price.** Showing ₹800 is fine; the split is between you and the doctor. Don't add hidden "convenience fees" at checkout.
- **Keep the policy pages online:** `/policies.html` (terms, cancellation and refund), `/privacy.html` and the contact details. Razorpay checks these during activation.

### The simpler alternative
The doctor opens his own Razorpay account (split off), and you bill him a monthly **maintenance fee** with a GST invoice. This involves less regulation and paperwork, and the dashboard's Payments report gives you the booking numbers to invoice against.

---

## 2. Cancellation, rescheduling and follow-up rules (all editable in Settings)

| Situation | Default rule | Who is notified |
|---|---|---|
| Patient cancels **24+ h** before | 100% refund | Doctor (Inbox + email) and patient (confirmation + refund amount) |
| Patient cancels **4–24 h** before | 50% refund | Same |
| Patient cancels **< 4 h** before or after the time | No refund | Same |
| **No-show** (clinic marks it) | No refund | Patient |
| **Clinic cancels** | Always a **100% refund** | Patient, with the refund amount and a rebooking link |
| Patient **reschedules** | Free up to 12 h before, max 2 times per booking; after that "please call" | Doctor (Inbox + email) and patient |
| **Clinic moves** an appointment | Allowed any time; the patient can then reschedule or cancel free | Patient |
| **Follow-up visit** within 30 days of a completed visit | Charged ₹500 instead of ₹800, automatically | — |
| Unpaid online booking | Slot held for 15 minutes, then released | — |
| Payment arrives after the slot was taken by someone else | Full automatic refund | Patient sees the message |

- The patient sees the exact refund amount **before** confirming a cancellation.
- Every change is recorded in the appointment's **History**: who did it, when and what.

**Notifications:**
- **Patient → doctor:** every booking, reschedule and cancellation appears in Dashboard → **Inbox**. It's also emailed to the doctor if `RESEND_API_KEY` / `DOCTOR_EMAIL` are set, and WhatsApp'd if `DOCTOR_WHATSAPP` is set.
- **Clinic → patient:** confirmations, moved times, cancellations, refunds and no-shows.
  - With the **WhatsApp Cloud API** configured, they're sent automatically, and tomorrow's reminders go out by themselves.
  - Without it, each message waits in Inbox → *Messages to patients* with a one-tap **Send on WhatsApp** button.

---

## 3. Security: what "cyber proof" means here

**About disabling right-click:** it only stops casual users. Anyone can still screenshot, use developer tools or view the page source. The site adds a light deterrent on photos and videos (no right-click or drag-to-save). The real protection is that **private data never reaches public pages**.

**What protects patient data:**

| Layer | What's in place |
|---|---|
| Data never public | Patient details live only on the server. Public pages show the clinic's own content. Patients see only their own booking, and only with reference + phone |
| Encryption in transit | HTTPS everywhere (Netlify and Render provide certificates). `Strict-Transport-Security` forces HTTPS |
| Encryption at rest | Clinical notes, symptoms, check-in comments and message texts are encrypted with **AES-256-GCM** in the database (`ENCRYPTION_KEY`) |
| Payments | Card and UPI details go straight to Razorpay. This server never sees them. Payment success is verified with an HMAC signature, and webhooks are signature-checked |
| Admin access | scrypt-hashed passwords, signed HttpOnly SameSite=Strict cookies, login rate limit, CSRF header check, 12 h sessions |
| Browser hardening | Strict **Content-Security-Policy** (no inline or foreign scripts except Razorpay), `X-Frame-Options`, `nosniff`, a referrer policy and a permissions policy |
| Abuse limits | Rate limits on booking, lookups and stories; a honeypot spam field |
| Audit trail | Every appointment change is logged with actor and time |
| Exports | CSV export only for signed-in staff, protected against formula injection |

**Your to-do list for security:**
- [ ] Set a long, unique `ADMIN_PASSWORD`, and change it after first login.
- [ ] Generate `ENCRYPTION_KEY` once and **store a copy in a password manager**. If you lose it, the encrypted notes can't be read.
- [ ] Turn on daily backups of the data disk (Render: disk snapshots) and keep a copy elsewhere.
- [ ] Give each staff member their own login (`npm run admin:create`); never share one.
- [ ] Keep `npm audit` clean and update Node regularly.
- [ ] India's DPDP Act 2023: collect only what's needed (already the case), publish the privacy notice (already done), and delete data on request.

---

## 4. Hosting: Netlify + a backend

Netlify only serves files. The booking system needs a running server and a database. Recommended setup:

```
Patient browser ──► Netlify (tailbonetreatment.com)
                      ├─ /, /stories.html, /admin …   static pages from /public
                      └─ /api/*  ──proxy──►  Render web service (Node + SQLite on a persistent disk)
```

1. **Backend on Render:**
   - New → **Blueprint** → select this repo. `render.yaml` sets up the service and a 1 GB disk.
   - Fill in the environment values it asks for: `SITE_URL`, `ENCRYPTION_KEY`, the admin login and, later, the Razorpay keys.
   - A paid "Starter" instance is needed for the persistent disk. Free instances lose data and sleep.
2. **Netlify:**
   - In `netlify.toml`, replace `BACKEND_URL` with the Render address, e.g. `tailbone-api.onrender.com`.
   - Netlify reads the publish folder (`public`) from the file automatically.
3. Open `https://<your-netlify-site>/admin` and sign in.

Until step 1 is done, the Netlify site still works. Booking falls back to "WhatsApp us / call us".

Alternatives to Render: Railway (volume), Fly.io (volume), or any small VPS (Docker image included).
