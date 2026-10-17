# Tailbone Treatment Clinic: workload, problems and automation checklist

This is a practical plan to cut Dr Rajveer Singh's admin time, plug the gaps that lose patients, and grow bookings. Items marked ✅ are **already built into this website**. Items marked ⬜ are next steps.

---

## 1. Where his time goes today (likely pain points)

| # | Problem | Why it hurts | Fix |
|---|---------|--------------|-----|
| 1 | Every booking happens by phone or WhatsApp chat | Back-and-forth messages for every slot, interruptions during treatment, double bookings | ✅ Online slot booking with live availability and a booking reference |
| 2 | Patients ask "Where is the clinic?", "What are the timings?", "What is the fee?" again and again | Answering the same questions dozens of times a day | ✅ Website FAQ and location pages · ⬜ WhatsApp auto-replies (section 3) |
| 3 | Reschedules and cancellations by message | Slots go empty, the diary goes out of date | ✅ Patient self-service at **/manage.html** (reschedule or cancel with reference + phone) |
| 4 | No-shows | Lost income and a wasted slot | ✅ One-tap WhatsApp reminder for tomorrow's patients in the dashboard · ⬜ fully automatic reminders (section 3) |
| 5 | No follow-up after treatment | Never knows who improved, who relapsed, who could be a review | ✅ Follow-ups scheduled when a visit is completed, a check-in link with a 0–10 pain score, and a pain chart per patient |
| 6 | Patient records scattered across chats, phone and paper | Hard to recall history when a patient returns | ✅ Patient profiles with visit history, private notes and check-ins |
| 7 | Travelling between cities (Delhi, Bengaluru, Pune, Mohali, …) | Each visit is announced manually on Instagram and patients must message to book | ⬜ **"Visiting clinics" feature**: add a temporary city and dates, open bookings for it, auto-post the announcement (top next build) |
| 8 | Testimonials live only in Google, Instagram and WhatsApp | Trust signals aren't collected or reused | ✅ Story submission → approve in dashboard → shown on site · ✅ "Ask for a story" WhatsApp link on happy patients' profiles |
| 9 | Instagram content isn't reused on the website | Videos with high views don't help convert website visitors | ✅ Dashboard → Instagram: paste top reels and they appear on the homepage |
| 10 | Payments collected manually | Chasing payments, no record | ⬜ Razorpay/UPI payment link for online consults (pay before the video call) |
| 11 | No numbers on what works | Can't tell which city, ad or post brings patients | ✅ Dashboard KPIs and CSV export · ⬜ "How did you hear about us?" on booking, plus UTM-tagged ad links |
| 12 | One person doing everything | Burnout, slow replies at night, lost leads | ⬜ Shared dashboard login for an assistant (separate accounts already supported) |

---

## 2. Daily routine with the new system (about 10 minutes)

1. **Morning:** open `/admin` → **Overview**.
   - Confirm pending bookings (tap **Confirm**, then **WhatsApp: confirmation**).
   - Tap **Send reminder** for each of tomorrow's patients.
   - Clear **Follow-ups due**: tap **Send on WhatsApp**, and the patient gets their check-in link.
2. **After each patient:** **Complete** the visit, type a note, and keep the follow-up ticked (+14 days by default).
3. **Weekly:**
   - Review **Stories** (approve, feature the best).
   - Add 1–2 top-performing reels in **Instagram**.
   - Block holidays or travel days in **Settings**.
4. **Watch the ⚠️ list:** patients reporting pain ≥ 7 or "worse" appear on the Overview automatically. Call them first.

---

## 3. WhatsApp automation (biggest time saver)

The site currently uses **click-to-send WhatsApp links** (free, no setup: the message is pre-written and he taps Send). The next level is the official **WhatsApp Business Platform (Cloud API)** through a provider such as AiSensy, Interakt, WATI or Gupshup, or Meta's Cloud API directly.

⬜ **Set up:**
- [ ] Move the number to the WhatsApp Business Platform. ⚠️ Plan this carefully: a number on the API can't also be used in the normal WhatsApp Business app. Many clinics use a **second number** for automation and keep the personal one for the doctor.
- [ ] Get Meta to approve message templates (confirmation, reminder, check-in, review request, cancellation).
- [ ] Connect it to this website (one small server change). Bookings, reminders and check-ins then go out **automatically**, with no tapping.

⬜ **Auto-reply bot menu** (keyword or button based, no AI required):
```
Hi 👋 Welcome to Tailbone Treatment Clinic.
1️⃣ Book an appointment  → booking link
2️⃣ Clinic locations & timings
3️⃣ Fees & online consultation
4️⃣ What is Internal Manipulation? → top reel / FAQ
5️⃣ Manage my booking → /manage.html
6️⃣ Talk to the doctor's team
```
- [ ] Away message outside clinic hours, with the booking link.
- [ ] **Automatic reminders:** 24 h and 2 h before each appointment.
- [ ] **Automatic follow-ups:** check-in link on day 3, day 14 and day 30 after a visit.
- [ ] **Review request:** when a check-in says "better", automatically send the Google review link and the story link.
- [ ] **Broadcasts (opt-in only):** "Dr Rajveer is in Pune 26–28 June, book now", sent to patients in that city.

> Compliance: only message patients who contacted you or gave consent (WhatsApp policy), and keep health data private (India's DPDP Act, 2023). The booking flow already stores data only on your own server.

---

## 4. Instagram (@drrajveersingh_9886688323)

**Profile fixes (5 minutes):**
- [ ] Change the category from "Sports & Fitness Instruction" to **Physical therapist** or **Medical & health**, so people searching for tailbone pain find him.
- [ ] Bio: *"Coccyx/tailbone pain specialist · Non-surgical · Delhi · Bengaluru · Online · 👇 Book in 30 sec"*, with the link to the website's booking section.
- [ ] Highlights: *Book · Locations · Patient stories · What is IM? · Cushion*.
- [ ] Add a **WhatsApp** contact button and a **Book** action button.

**Automation:**
- [ ] DM auto-replies with an official Meta partner tool (e.g. ManyChat): when someone comments **"PAIN"** on a reel, automatically DM them the booking link and a short explainer. This turns viral reels into bookings without manual replies.
- [ ] Saved replies for common DMs (fees, location, "is it painful?").
- [ ] Schedule posts in advance (Meta Business Suite is free).

**Content system:**
- [ ] Every week, add the top 1–2 reels by views to **Dashboard → Instagram** so the website shows the best proof.
- [ ] Repeat what already performs: myth-busting ("Water park rides damage your tailbone?"), "What exactly happens in tailbone manipulation", city-visit announcements, and patient stories (with written consent).
- [ ] Turn each approved website story into a quote-card post.

---

## 5. Advertising (spend where patients search)

- [ ] **Google Business Profile** for each clinic (free, highest-intent traffic):
  - accurate hours and the booking link
  - photos
  - replies to every review
  - a monthly post
  - keep the address identical everywhere (the Delhi address currently differs between WhatsApp and the website, so fix it)
- [ ] **Google Search ads:**
  - Keywords: "tailbone pain treatment Delhi", "coccyx pain doctor Bangalore", "coccydynia specialist", "pain in tailbone while sitting".
  - Send traffic to the booking section.
  - Track bookings as conversions.
- [ ] **Meta (Instagram/Facebook) ads:**
  - Boost the reels that already perform best.
  - Use **Click-to-WhatsApp** ads targeting women 22–45 (post-pregnancy tailbone pain is common), office workers and people who've had a fall.
  - Target each visiting city 7–10 days before he travels.
- [ ] **YouTube:** reuse the reels as Shorts and longer explainers. YouTube is the second-largest search engine.
- [ ] **Referral network:** send a one-page PDF to gynaecologists, orthopaedists and physiotherapists in each city ("we treat the coccyx cases you can't").
- [ ] Use UTM-tagged links per channel and add "How did you hear about us?" to booking, so every rupee of ad spend can be measured.

> Healthcare ad rules: avoid guarantees ("100% cure"), before/after claims and unverifiable superlatives ("India's No. 1"). Meta and Google both restrict these, and professional councils discourage them. Patient stories need written consent, which the site's story form already collects.

---

## 6. Next website features (in priority order)

1. ⬜ **Visiting clinics:** temporary cities and dates (Pune, Mohali, Chandigarh…) with their own slots, plus an auto-generated announcement image or text.
2. ⬜ **WhatsApp Cloud API integration:** fully automatic confirmations, reminders and follow-ups.
3. ⬜ **Online payment** (Razorpay) for online consultations and the TBT cushion.
4. ⬜ **Fees page and TBT cushion shop page.**
5. ⬜ **Google review link** after a "better" check-in.
6. ⬜ **Lead source tracking** on bookings and a monthly report email.
7. ⬜ **Multi-staff accounts with roles** (assistant can book and confirm, but not see private notes).
8. ⬜ **Hindi version** of key pages.

---

## 7. Information needed from Dr Rajveer

- [ ] The correct **New Delhi address** (WhatsApp says *111D/9, Shivani Apartment*, the website says *150A/09, Shanti Apartment*).
- [ ] The real opening hours per clinic (WhatsApp says "appointment only").
- [ ] Consultation **fees** (in-person and online), if they should be shown.
- [ ] A professional **photo** for the doctor section, and his qualifications and registration to display.
- [ ] Links to his Facebook page, YouTube channel and Google Business Profile.
- [ ] His **top 6–10 reels** by views (from the Instagram Professional dashboard), to paste into Dashboard → Instagram.
- [ ] Permission from the patients behind the existing testimonials, or replace them with new consented stories.
