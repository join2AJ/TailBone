# Builds ../SEARCH-CAMPAIGN-PLAN.md from search-campaign.json (keywords, ads) plus the fixed guidance below.
# Run: python3 resources/google-ads/source/build-plan.py
import json, pathlib

here = pathlib.Path(__file__).parent
d = json.loads((here / "search-campaign.json").read_text())
site = d["site"]
shared_h, shared_d = d["shared"]["headlines"], d["shared"]["descriptions"]

def ad_group(i, g):
    hs = g["headlines"] + shared_h
    out = [f"### Ad group {g['name']}", "",
           f"**Final URL:** `{site}{g['path']}`  ", f"**Display path:** `{' / '.join(g['paths'])}`", "",
           "**Keywords** (paste exactly as written: quotes = phrase match, [brackets] = exact match):", "", "```",
           *g["keywords"], "```", "",
           "**Headlines (15):**", "", "| # | Headline | Characters |", "|---|---|---|",
           *[f"| {n} | {h} | {len(h)}/30 |" for n, h in enumerate(hs, 1)], "",
           "**Descriptions (4):**", "", "| # | Description | Characters |", "|---|---|---|",
           *[f"| {n} | {t} | {len(t)}/90 |" for n, t in enumerate(shared_d, 1)], ""]
    return "\n".join(out)

total_kw = sum(len(g["keywords"]) for g in d["adGroups"])
groups = "\n".join(ad_group(i, g) for i, g in enumerate(d["adGroups"], 1))
negatives = "\n".join(f'"{n}"' for n in d["negatives"])

doc = f"""# Google Ads: Search campaign plan (Tailbone Treatment, New Delhi)

Budget **₹10,000 a month**. Goal **now: visits to the website** (people who click, then book, WhatsApp or call).
Goal **later: booked appointments**, once enough bookings are being counted (Part 8).

Read once, then follow the steps in order. Every value to type is written out. Ads text was checked against Google's character limits.

---

## Part 0. Do these before creating the campaign

| # | What | Why |
|---|---|---|
| 0.1 | **Use a computer**, not the phone app. Go to ads.google.com. If you see "Smart mode", click the settings gear, then **Switch to Expert Mode**. | The phone screen in your screenshot ("Provide assets to help build your ads") builds an automatic campaign where Google picks the searches. A Search campaign gives you control over keywords and costs. |
| 0.2 | **Don't send ads to www.tailbonetreatment.com yet.** It is still the old website and still advertises the closed Bangalore clinic. Use **{site}** until the domain points to the new site. | Paying for clicks to an outdated page wastes budget. |
| 0.3 | Best: **point tailbonetreatment.com to the new site** (DEPLOY.md, Step 8). Only the website records change; email (contact@tailbonetreatment.com) keeps working if you don't touch the MX records. Afterwards, replace `{site}` with `https://tailbonetreatment.com` in every Final URL below. | A clinic's own domain looks more trustworthy in ads and keeps its Google history. |
| 0.4 | **Pause** the old YouTube promotion campaigns and **delete the Performance Max draft**. | With ₹10,000 a month, every rupee should go to people searching for tailbone treatment. |
| 0.5 | **Add money:** Billing → Add funds → **₹11,800** (₹10,000 for ads + 18% GST that Google India adds). | Prepay accounts stop when the balance runs out. |
| 0.6 | **Google Business Profile:** mark the **Bengaluru** profile *Permanently closed*, and check the **New Delhi** profile (address 150A/09, Shanti Apartment, Kishangarh, Vasant Kunj; hours; phone; website = the new site). | Ads show your Delhi address from this profile (location asset). |
| 0.7 | Tools → **Recommendations → Auto-apply → turn everything OFF**. | Stops Google changing budgets, keywords or ads without asking. |

---

## Part 1. Conversion tracking (15 minutes)

The new website now has the Google tag built in. It only switches on for visitors who tap **Accept** on the cookie banner (required by India's DPDP Act), so expect to see roughly half of real results.

It sends these events (never names, phone numbers or health details):

| Event | When | Suggested value |
|---|---|---|
| `book_appointment` | An online booking is confirmed (once the clinic server is live) | ₹800 |
| `booking_request` | Booking sent as a WhatsApp request (the site today, without the server) | ₹400 |
| `whatsapp_click` | Any WhatsApp button | ₹200 |
| `call_click` | Any "Call" / phone number tap | ₹200 |

Steps:
1. Google Ads → Tools → **Data manager → Google tag**. Check the tag ID is **AW-969590760**, the ID already on the old website. If your account shows a **different ID**, send it to me and I'll update the site.
2. Data manager → **Google Analytics (GA4) → Link** the property **G-HTE5TE5B9K** (also from the old website). Tick "Import app and web metrics".
3. In **Google Analytics** → Admin → **Key events → New key event**: create `book_appointment`, `booking_request`, `whatsapp_click`, `call_click`.
4. Back in Google Ads → Goals → **Conversions → New conversion action → Import → Google Analytics 4 → Web**. Select the four events. For each one: Count = **One**, Value = as in the table, click-through window = **30 days**.
5. Set **Primary**: booking_request, book_appointment, whatsapp_click. Set **Secondary**: call_click (calls are counted by the next step instead).
6. New conversion action → **Phone calls → Calls from ads using call assets**: name "Calls from ads", **call length 60 seconds**, value ₹300, Primary. If Google says call reporting isn't available in India for your account, skip this step.
7. **Test it:** open the site on your phone, tap **Accept**, tap WhatsApp once, and send a test booking request. Within 30 minutes you'll see them in GA4 → Reports → **Realtime**. Conversions show in Google Ads within 24–48 hours.

---

## Part 2. Create the campaign: exactly what to select

**+ New campaign** →

| Screen | Choose / type |
|---|---|
| Objective | **Create a campaign without guidance** |
| Campaign type | **Search** |
| Results | Tick **Website visits** and type the website URL `{site}` (and **Phone calls**: +91 98866 88323) |
| Campaign name | `Search – Tailbone – Delhi NCR – Oct 2026` |
| **Bidding** | Focus on: **Clicks** (this is "Maximize clicks"). Tick **Set a maximum cost per click bid limit**: **₹40** |
| Customer acquisition | Leave unticked |
| **Networks** | **Untick** Google Search Partners. **Untick** Google Display Network. |
| **Locations** | "Enter another location" → add: **Delhi** (state/territory), **Gurugram**, **Noida**, **Greater Noida**, **Ghaziabad**, **Faridabad** |
| Location options (click to expand) | **Presence: People in or regularly in your included locations** |
| **Languages** | **English** and **Hindi** |
| Audience segments | Skip for now |
| **AI Max / Broad match** | Leave **off** |
| Automatically created assets | **Off** for text (Google can write medical claims you haven't approved) |
| Start and end dates | Start today; no end date |
| **Ad schedule** | Monday–Sunday, **07:00 – 22:00** (WhatsApp and online booking work late; calls are answered in clinic hours) |
| Campaign URL options | Leave empty |

Then Google asks for keywords and ads. Build **ad group 1** there, then add groups 2–6 afterwards from the campaign page (Ad groups → +).

---

## Part 3. Budget

| Setting | Value |
|---|---|
| Average daily budget | **₹325** |
| Monthly maximum Google can charge | 30.4 × ₹325 ≈ **₹9,880** (+ 18% GST) |

Google may spend up to twice the daily budget on a busy day, but never more than 30.4 days' worth in a month.

**What ₹10,000 can buy (estimate; real numbers come from Keyword Planner, Part 5):** health searches in Delhi usually cost **₹15–50 per click**, so expect roughly **250–500 clicks a month**. If 6–10% of visitors book, WhatsApp or call, that is about **15–45 enquiries**. Judge results after 3–4 weeks, not days.

---

## Part 4. Ad groups, keywords and ads ({total_kw} keywords in 6 groups)

One theme per ad group, each sending people to the page that best matches the search. Use **phrase** and **exact** match only (no broad match).

{groups}
---

## Part 5. Keyword research (check the numbers before launch)

I can't open your Google Ads account, so the **search volumes and costs must come from your Keyword Planner**. It takes 10 minutes:

1. Tools → Planning → **Keyword Planner → Get search volume and forecasts**.
2. Paste all the keywords from Part 4 (copy each block).
3. At the top, set **Location: Delhi NCR (the six places in Part 2)**, **Language: English and Hindi**, period: **last 12 months**.
4. Look at **Avg. monthly searches** and **Top of page bid (high range)**.

How to read it:
- **"–" or 0 searches:** keep the keyword anyway. Low-volume keywords cost nothing until searched.
- **Top-of-page bid (high) above ₹40** on your most important keywords (groups 1 and 2): raise the **max CPC limit** to ₹50–60.
- Use the **"Discover new keywords"** tab with `tailbone pain` and `coccyx pain` to find extra searches. Add only those that mean "I want treatment" (not "what is", "images" or "exercises").
- **Send me a screenshot or the CSV download** and I'll refine the list and the bid limit.

Also try these **Hindi / Hinglish** searches in Keyword Planner. Add them to ad group 1 only if they show searches: `"tailbone pain ka ilaj"`, `"tailbone dard"`, `"poonch ki haddi me dard"`, `"पूंछ की हड्डी में दर्द"`.

---

## Part 6. Negative keywords: block searches that never become patients

Campaign → Keywords → **Negative keywords → + → Add to: Campaign**. Paste these (phrase match):

```
{negatives}
```

Why some of these are there:
- **Cushion, pillow, chair:** product shoppers.
- **MRI, X-ray, scan:** people looking for a scan centre.
- **Pilonidal, cyst, piles:** different conditions.
- **Other cities, including Bangalore:** the Bengaluru clinic has closed. Remove **"lucknow"** when that clinic opens.
- **Don't add "tail".** Many people type "tail bone pain" as two words.

---

## Part 7. Assets (they make the ad bigger and more clickable)

Campaign → **Assets → + Asset**, at **campaign** level:

| Asset | What to enter |
|---|---|
| **Sitelinks** (4–6) | From `ad-text.md`: Book an Appointment, About Tailbone Pain, How Treatment Works, Meet Dr Rajveer Singh, Clinics & Timings, Tips & Articles |
| **Callouts** (4–6) | Non-Surgical Care · New Delhi & Online · Video Consultations · Open 7 Days · Book Online 24x7 · WhatsApp Reminders |
| **Structured snippet** | Header **Services**: Coccydynia, Subluxed Coccyx, Post-Pregnancy Pain, Sitting Pain, Post-Injury Pain |
| **Call** | +91 98866 88323. Schedule: Mon–Fri 10:00–17:00, Sat 10:00–15:00, Sun 08:00–15:00 (shows only when someone can answer) |
| **Location** | Link the **New Delhi** Google Business Profile (Part 0.6) |
| **Business name + logo** | `Tailbone Treatment` + `logo-square-1200.png` |
| **Images** | `image-square-1200-a.png`, `image-square-1200-b.png`, `image-landscape-1200x628-a.png`, `image-landscape-1200x628-b.png` (Google shows images on some search ads) |
| **Lead form** | Skip for now: the website's booking and WhatsApp capture leads better and are tracked |

---

## Part 8. Bidding plan: from website visits to appointments

| Phase | When | Bid strategy | Watch |
|---|---|---|---|
| **1. Traffic** | Weeks 1–3 | **Maximize clicks**, max CPC ₹40 | Search terms, CTR above 5%, cost per click |
| **2. Conversions** | After **15+ primary conversions in 30 days** | Campaign settings → Bidding → **Maximize conversions** (no target) | Cost per conversion |
| **3. Appointments** | When the clinic server is live (real bookings with appointment numbers) and **30+ conversions a month** | Make **book_appointment** the only Primary conversion; set **Target CPA** to your average of the last 30 days | Cost per booked appointment |

Change bidding only once every 2 weeks. Each change restarts Google's learning (about 7 days).

**Ad copy reminders for health ads:** no "cure", "guaranteed", "100%", "painless" or before/after claims. Physiotherapy clinic ads are normally allowed in India. If Google asks for healthcare verification, submit the BPT degree, fellowship certificate and clinic registration (Tools → Policy manager).

---

## Part 9. Launch checklist

- [ ] Expert mode on a computer (0.1)
- [ ] Final URLs use the new site (0.2 / 0.3)
- [ ] Old YouTube / Performance Max paused (0.4)
- [ ] ₹11,800 added (0.5)
- [ ] Bengaluru profile closed, Delhi profile correct (0.6)
- [ ] Auto-apply off (0.7)
- [ ] Conversions imported and tested in Realtime (Part 1)
- [ ] Search only, no partners or display, Delhi NCR, Presence, English + Hindi (Part 2)
- [ ] ₹325/day, Maximize clicks, ₹40 limit (Parts 2–3)
- [ ] 6 ad groups, each with keywords, 15 headlines, 4 descriptions (Part 4)
- [ ] Keyword Planner checked (Part 5)
- [ ] Negative keywords added (Part 6)
- [ ] Sitelinks, callouts, snippet, call, location, logo, images (Part 7)
- [ ] Ads show **Approved** or **Eligible** (Ads tab), then the campaign is **Enabled**

---

## Part 10. Weekly routine (15 minutes, twice a week for the first month)

1. **Insights & reports → Search terms:** anything irrelevant goes in **Add as negative keyword**. Anything good that isn't a keyword yet goes in **Add as keyword** (phrase).
2. **Keywords:** pause keywords that spent **₹800+** with no conversions after 3 weeks.
3. **Ads:** after 2–3 weeks, look at Ad strength and the asset report. Replace headlines Google marks **Low**.
4. **Budget:** if "Limited by budget" shows and conversions are good, consider raising the budget. If the cost per click is far below ₹40, leave it.
5. **Clinic side:** reply to WhatsApp enquiries within 1 hour during clinic hours. Fast replies turn clicks into patients.

**Month-1 targets (to judge it fairly):** CTR **5%+**, average CPC **under ₹40**, **15+ enquiries** (bookings + WhatsApp + calls) for ₹10,000.

Later, with more budget: a separate **"Online consultation – India"** campaign (online-only keywords, all of India, ₹3,000–5,000/month), and **Lucknow** when that clinic opens.
"""
(here.parent / "SEARCH-CAMPAIGN-PLAN.md").write_text(doc)
print("wrote SEARCH-CAMPAIGN-PLAN.md")
