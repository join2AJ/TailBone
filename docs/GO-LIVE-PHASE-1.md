# Going live with phase 1 (free: Netlify + Supabase)

Phase 1 needs no paid server. The website is on **Netlify** (free). The dashboard's logins and the content the clinic changes are stored in **Supabase** (free plan, data kept in Mumbai). Both are already connected in the code.

| What | Where |
|---|---|
| Website | https://tailbone.netlify.app (later tailbonetreatment.com) |
| Clinic dashboard (phase 1) | https://tailbone.netlify.app/dashboard |
| Supabase project | "tailbone-clinic" in the "Ajays co" organisation, region Mumbai |

## What the dashboard can do in phase 1

| | Doctor | Super admin (owner) |
|---|---|---|
| Videos: YouTube videos and Instagram reels/posts, which pages show them, order, show/hide | ✓ | ✓ |
| Announcement bar (e.g. "Clinic closed on Diwali"), with start and end dates | ✓ | ✓ |
| Opening hours and contact details (phone, WhatsApp, email) | ✓ | ✓ |
| FAQ questions and answers | ✓ | ✓ |
| Newspaper clippings (upload a photo, publication, date) | ✓ | ✓ |
| History: see every change and who made it, and undo it | ✓ | ✓ |
| Launch phase: what is hidden (booking, stories and so on, and each article) | | ✓ |
| Staff: add or remove the people who can sign in, and see the activity log | | ✓ |

Changes show on the website within about a minute. Launch-phase changes go live when you press **Publish** (see step 5).

Everyone signs in with an email, a password **and** a 6-digit code from an authenticator app on their phone (Google Authenticator or Microsoft Authenticator). Someone who learns a password still can't get in. These protections are enforced inside the database itself, not only by the website:
- only people on the staff list can change anything;
- only the super admin can change the launch phase or the staff list.

## Steps (about 10 minutes)

1. **Create your own login.** In Supabase, open the project → **Authentication** → **Users** → **Add user** → **Create new user**. Use join2ajkumar@gmail.com, choose a strong password, and tick **Auto Confirm User**. You are already on the staff list as super admin.
2. **Stop strangers signing up.** In Supabase → **Authentication** → **Sign In / Providers**, switch off **Allow new users to sign up**. Only the accounts you add can exist.
3. **Sign in.** Open https://tailbone.netlify.app/dashboard and sign in. The first time, it shows a QR code: scan it with the authenticator app and type the 6-digit code. After that you only type the code.
4. **Add the doctor.**
   - In the dashboard → **Staff & activity**, add Dr Rajveer's email with the role Doctor.
   - Then create his login in Supabase as in step 1, with his email.
   - Give him the password in person or by phone, never by email or chat. He sets up his authenticator the first time he signs in.
5. **(Optional) The Publish button for the launch phase.**
   - In Netlify → **Site configuration** → **Build & deploy** → **Build hooks**, add a hook called "Dashboard publish" and copy its address.
   - Then in **Environment variables**, add:
     - `NETLIFY_BUILD_HOOK` = that address;
     - `LAUNCH_URL` = `https://tailbone.netlify.app/api/launch`.
   - Without this, launch-phase changes still save, and they go live with the next deploy.

## If someone loses their phone
- **Super admin:** in Supabase → Authentication → Users, open the person → remove their MFA factor. They set up a new authenticator at their next sign-in.
- **Doctor:** you can also switch him off at once in the dashboard → Staff & activity → Disable.

## Costs and limits
Netlify's and Supabase's free plans are far above what this needs: 125,000 dashboard/content requests and 100 GB of traffic a month on Netlify; 500 MB of database and 1 GB of pictures on Supabase.

A free Supabase project is paused after 7 days with no activity at all. The public website calls it whenever someone visits, so this should not happen. If it ever does, the website keeps showing its built-in content, and you press **Restore** in Supabase.

## Later phases
Online booking, payments and patient records (phase 2 onwards) need the full clinic server. It runs on Render (from about US$7 a month); see the README. The phase-1 dashboard stays as it is.
