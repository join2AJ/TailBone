# Deploying tailbone.netlify.app with booking, payments and the dashboard

**What runs where:**

```
Browser ──► Netlify  (tailbone.netlify.app: website files from /public)
               └── /api/*  ──proxy──►  Render (Node backend + encrypted database on a disk, Singapore)
```

Netlify can't run the backend or keep a database, so the backend runs on **Render**. Netlify forwards `/api/*` to it, so visitors only ever see your Netlify address. Time needed: about 30 minutes. Cost: Render Starter (about US$7/month) plus a 1 GB disk (about US$0.25/month). Netlify stays free.

---

## Step 1: Prepare two secrets (2 min)
On any computer with Node, run this twice and save both values in a password manager (Bitwarden, 1Password, Google Password Manager):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- First value → `ENCRYPTION_KEY`. **If you lose it, the encrypted notes and backups can't be read.**
- Second value → keep for later, if you ever need to rotate keys.

Also choose the admin email and a strong password (12+ characters).

## Step 2: Create the backend on Render (10 min)
1. Go to **render.com** and sign up with GitHub. Turn on **2FA** in your Render account settings.
2. **New → Blueprint** → select the **join2AJ/TailBone** repo and branch `ccr-5e1d60c0-7itqhu` (or `main` after you merge).
3. Render reads `render.yaml` and shows the service **tailbone-api** (Starter, Singapore, 1 GB disk). Fill in the values it asks for:

   | Key | Value |
   |---|---|
   | `SITE_URL` | `https://tailbone.netlify.app` (later your own domain) |
   | `ENCRYPTION_KEY` | the value from step 1 |
   | `ADMIN_EMAIL` | **your** email: this first account is the **super admin** (all features, users, commission) |
   | `ADMIN_PASSWORD` | a strong password (change it after the first login) |
   | Razorpay, WhatsApp, Resend keys | **leave empty for now**: the site then uses pay-at-clinic and one-tap WhatsApp |

4. Click **Apply**. When the deploy finishes, copy the service URL, e.g. `https://tailbone-api.onrender.com`.
5. Check it: open `https://tailbone-api.onrender.com/api/health`. It should show `{"ok":true}`.

## Step 3: Connect Netlify to the backend (3 min)
1. In the repo, edit **`netlify.toml`** and replace every `BACKEND_URL` (three places: the API, dashboard articles and their media) with your Render host (without `https://`):
   ```toml
   to = "https://tailbone-api.onrender.com/api/:splat"
   ```
   Commit and push. (Or ask me to do it once you have the URL.)
2. In Netlify: **Site configuration → Build & deploy**. Check that it builds from the same branch. The *publish directory* comes from `netlify.toml` (`public`).
3. Netlify redeploys automatically. Open `https://tailbone.netlify.app/#appointment`: you should see real days and times instead of "WhatsApp us".

## Step 4: First sign-in and security setup (5 min)
1. Open **https://tailbone.netlify.app/admin** and sign in.
2. Go to **Settings**:
   - **Change password.**
   - **Account security → Set up two-factor sign-in** (Google or Microsoft Authenticator).
   - **Fees, payments & policies:** check the fees and refund rules.
   - **Backups → Back up now**, then **Download**. Store it on an encrypted drive.
3. Go to **Control panel**:
   - **+ Add user** for Dr Rajveer (role *Admin*). Tick the sections he should see, such as appointments, follow-ups, patients, inbox, stories, payments, privacy and settings.
   - Share the temporary password privately. Each person changes it and turns on 2FA.
   - Switch website features on or off as needed (e.g. turn **Online payments** on only after Razorpay is live).
4. Locked out? In the Render **Shell**, run `npm run admin:create -- you@example.com "Your Name" --super`. It resets the password and unlocks the account.

## Step 5: Monitoring (3 min)
- At **uptimerobot.com** (free), add an HTTP monitor for `https://tailbone.netlify.app/api/health` every 5 minutes, with alerts to the doctor's phone or email.
- In Render: Settings → Notifications → turn on deploy-failure emails.

## Step 6 (when ready): Online payments
1. Create and activate a Razorpay account. Activation needs the live site pages `/policies.html`, `/privacy.html` and contact details, which already exist.
2. Razorpay → **Settings → API Keys** → generate **Test** keys first. In Render, set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. Razorpay → **Webhooks → Add**:
   - URL: `https://tailbone.netlify.app/api/payments/webhook`
   - Events: `payment.captured`, `order.paid`, `refund.processed`, `refund.failed`
   - Put the secret you choose into `RAZORPAY_WEBHOOK_SECRET` in Render.
4. Book a test appointment with Razorpay's test UPI or card details, cancel it, and check the refund appears in Dashboard → Payments.
5. Swap to **Live** keys.
6. **Commission split:** ask Razorpay to enable **Route**, add the doctor as a Linked Account, then turn on *Split payments* in Settings and paste the `acc_…` id. See `docs/PAYMENTS-SECURITY-HOSTING.md`.

## Step 7 (optional): Automatic WhatsApp and email
- **WhatsApp Cloud API:**
  1. In Meta Business Suite → WhatsApp Manager, add a number (ideally a second clinic number).
  2. Create the template `clinic_update` (Utility category) with the body `{{1}}`, and get it approved.
  3. In Render, set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and optionally `DOCTOR_WHATSAPP`.
- **Email alerts to the doctor:** create a Resend account, verify the domain, and set `RESEND_API_KEY`, `EMAIL_FROM` and `DOCTOR_EMAIL`.

## Step 7b (recommended): Google Calendar

Each booking then appears in Dr Rajveer's Google Calendar (with its appointment number, e.g. `TBA-2610-0007`), and moves or disappears when it is rescheduled or cancelled. Anything else he puts in that calendar (a holiday, a meeting) automatically blocks those online slots. Calendar entries show only the appointment number, first name and clinic: no phone number or health details.

**Option A: full sync (about 10 minutes, free)**
1. Go to console.cloud.google.com and create a project (e.g. "Tailbone clinic").
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **IAM & Admin → Service accounts**: create a service account. Open it, go to **Keys → Add key → JSON** and download the file.
4. In Google Calendar (as the doctor), open **Settings → (his calendar) → Share with specific people**. Add the service account's email address and choose **Make changes to events**. Copy the **Calendar ID** from **Integrate calendar** (for a main calendar, this is his Gmail address).
5. In Render → Environment, add:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: `client_email` from the JSON file
   - `GOOGLE_PRIVATE_KEY`: `private_key` from the JSON file (paste it exactly as it appears, `\n` included)
   - `GOOGLE_CALENDAR_ID`: the Calendar ID from step 4
6. Redeploy. **Dashboard → Settings → Calendar** should show "Google Calendar sync: on". If Google is ever unreachable, bookings still work and the sync retries every 10 minutes.

**Option B: subscribe only (1 minute, one-way)**
Go to **Dashboard → Settings → Calendar → Copy link**. In Google Calendar, choose **Other calendars → + → From URL** and paste the link. Google refreshes it every few hours. Use **Rotate** if the link is ever shared by mistake.

## Step 8 (recommended): Your own domain
1. Netlify → Domain management → add `tailbonetreatment.com`, and follow the DNS steps. HTTPS is automatic.
2. Update `SITE_URL` in Render, and the Razorpay webhook URL.

---

## Optional: a public demo (one-click doctor and patient logins)
Create a **second** Render service from the same repo (New → Web Service, or duplicate `tailbone-api`) with:

| Key | Value |
|---|---|
| `DEMO_MODE` | `true` |
| `NODE_ENV` | `production` |
| `SITE_URL` | the demo address |
| `TRUST_PROXY_HOPS` | `1` (or `2` if a Netlify site proxies to it) |

No disk, Razorpay or WhatsApp keys are needed. The demo uses its own `demo.db` with fictional patients, resets every 24 hours, never sends real payments or messages, and disables password, 2FA and backup actions.

- Doctor: `https://<demo-address>/admin?demo=1` (or the **Try the demo** button on the sign-in page)
- Patient: `https://<demo-address>/manage.html?demo=1`

**Never set `DEMO_MODE=true` on the real clinic service.** The demo account opens the dashboard without a password.

Before the backend is connected, the Netlify site still takes bookings: the Book page sends a filled-in WhatsApp request ("Hi Dr Rajveer, got your details from your website…").

### Troubleshooting
| Symptom | Fix |
|---|---|
| Booking shows "Online booking is unavailable" | `netlify.toml` still says `BACKEND_URL`, or the Render service is down. Check `/api/health` |
| Dashboard says "Your session has ended" right after sign-in | `NODE_ENV=production` needs HTTPS. Use the `https://` Netlify URL |
| Everyone gets "Too many sign-in attempts" | `TRUST_PROXY_HOPS` must be `2` behind Netlify (already set in `render.yaml`) |
| The first request after a while is slow | Normal on Render Starter after a deploy; it stays awake afterwards |
| Restoring data | See `docs/compliance/04-business-continuity.md` §3 |
