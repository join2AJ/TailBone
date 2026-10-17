# Google Ads kit: Tailbone Treatment (Performance Max)

Everything the Performance Max "Edit assets" screen asks for, ready to copy or upload. The text is in [`ad-text.json`](ad-text.json) and is checked against Google's character limits.

## 1. Fix first (the campaign can't run until these are done)

| # | Issue in the account | What to do |
|---|---|---|
| 1 | **Balance exhausted** (₹1.55 left; ads stopped on 15 Oct) | **Billing → Add money.** Nothing serves until this is done. |
| 2 | YouTube promotion ends 18 Oct | **Campaign → Settings → End date**: extend it or set no end date. |
| 3 | Disapproved ad: "Unavailable video" | The YouTube video was deleted or made private. Either set it to *Public/Unlisted* again or replace it with a new video (see section 5). |
| 4 | Healthcare certification | Apply in **Tools → Policy manager** if Google asks. Keep these ready: his BPT degree, fellowship certificate, council registration and a clinic registration or GST document. |
| 5 | **Search ad: "add 1 final URL"** | Final URL: `https://tailbone.netlify.app/book`. Once tailbonetreatment.com points to the new site, change it to `https://tailbonetreatment.com/book`. |
| 6 | **Lead form has issues** | It needs a privacy policy URL: `https://tailbone.netlify.app/privacy.html`. All other lead-form fields are in `ad-text.json → leadForm`. |

> Don't use the "71% of IT professionals" figure from the Google Ads assistant in any ad. It has no source, and unverifiable health claims can get ads disapproved. The "desk job / sitting pain" angle itself is good, and it is already in the headlines and search themes.

## 2. Asset checklist (screen by screen)

| Section | What to enter | Ready? |
|---|---|---|
| **Business name** | `Tailbone Treatment` | ✅ |
| **Logos** | `logo-square-1200.png` (1:1) and `logo-landscape-1200x300.png` (4:1) | ✅ |
| **Headlines** (max 15, 30 characters each) | 15 in `headlines` | ✅ |
| **Long headlines** (max 5, 90 characters each) | 5 in `longHeadlines` | ✅ |
| **Descriptions** (max 5, 90 characters; one must be 60 or fewer) | 5 in `descriptions` (the first is the 60-character one) | ✅ |
| **Images** | `image-landscape-1200x628-a/b.png`, `image-square-1200-a/b.png`, `image-portrait-960x1200.png` | ✅ (add real photos too, see section 4) |
| **Videos** | YouTube links | ⏳ see section 5 |
| **Sitelinks** (4+) | 6 in `sitelinks` | ✅ |
| **Callouts** | 6 in `callouts` | ✅ |
| **Structured snippet** | Header "Services" plus 5 values | ✅ |
| **Call** | +91 98866 88323 | ✅ |
| **Lead form** | `leadForm` plus the privacy URL | ✅ |
| **Call to action** | "Book now" (or leave on Automated) | ✅ |
| **Search themes** (max 25) | 12 in `searchThemes` | ✅ |
| **Locations** | Instead of all of India: **Bengaluru + 40 km** and **New Delhi + 40 km** (Gurugram and Noida included). Add **India** only in a separate campaign for online consultations. | Change |
| **Languages** | English **and Hindi** | Change |
| **Audience signal** | Create a custom segment: "people who searched for" the search themes, plus the interests *Back pain*, *Pregnancy & new parents* and *IT professionals*. Upload your patient list as Customer Match **only with patient consent** (DPDP). | Add |
| **Budget** | Google suggests ₹753 a day. Start at ₹500–750 a day for 2 weeks, then adjust using cost per booking. | – |

## 3. Tracking (so Google optimises for real bookings)

The new website does not yet send conversions to Google Ads. Until it does, Performance Max optimises for clicks and calls only. Two options:
- **Quick:** count **Calls from ads** and **WhatsApp clicks** as conversions (Goals → Conversions → New → Phone calls / Website "click to WhatsApp").
- **Best:** add the Google tag and fire a "Booking confirmed" conversion on the booking confirmation screen. The website must also show a cookie choice (DPDP/GDPR), and the tag must be allowed in the site's security policy (CSP). This needs a small code change; ask and it can be added.

## 4. Photos that would make the ads much stronger

Performance Max favours real photos over graphics. Please send them in high resolution (straight from the phone, not via WhatsApp, which compresses them):
- Dr Rajveer in the clinic (a plain background, a smile, a white coat or scrubs): **landscape and square**
- the reception and treatment room in Bengaluru and Delhi (no patients, or only with written consent)
- the clinic signboard and building entrance (helps people find you)
- a consultation photo with a model or staff member (no real patient without consent)

Required sizes: landscape 1200×628, square 1200×1200, portrait 960×1200. Keep text on photos small, or leave it off.

## 5. Videos

Ready now: five animated explainer videos in [`../videos/`](../videos/README.md) (16:9 and 1:1). Upload them to the clinic's YouTube channel and paste the links. Also upload his best Instagram reels (most views) to the clinic's YouTube channel as **Public** or **Unlisted**, then paste the links. Aim for one each of horizontal 16:9, square 1:1 and vertical 9:16, at least 10 seconds long. Without a video, Google auto-generates one from the images, which usually looks generic.

## Re-generating the images

```
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node resources/google-ads/source/render-images.mjs
```
The designs are in `source/render-images.mjs` (brand colours and fonts from the website).
