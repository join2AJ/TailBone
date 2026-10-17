# Pre-launch audit: website, dashboard and backend

**Date:** 17 October 2026 · **Scope:** all public pages, the patient portal, the clinic dashboard, the API, security and privacy behaviour.

**Method:**
- **Automated:** HTML validation (html-validate); accessibility with axe-core (WCAG 2.1 AA + best practice) on 11 public pages and 10 dashboard screens, in light and dark mode.
- **End-to-end browser runs** on phone and desktop sizes.
- **Manual code review** of the frontend and backend.
- **Security probes** against a running server.

## Results at a glance
| Check | Before | After |
|---|---|---|
| axe accessibility violations (rule types) | 9 (incl. 2 critical, 4 serious) | **0** |
| HTML validator problems (excluding style rules) | 99 | 14 cosmetic: DOCTYPE case, and spaces in phone *link text* |
| Automated tests | 38 | **42** (4 audit regression tests added) |
| JavaScript disabled | sections invisible, stats "0" | content visible, real numbers |
| Browser console errors / horizontal scroll | none | none |

## Findings and fixes

### Privacy & security
| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Automatic WhatsApp messages and reminders would also go to patients who **didn't opt in** to WhatsApp (DPDP / GDPR consent) | High | Automatic sending now requires the `whatsapp_updates` consent. Otherwise the message is queued with "consider calling instead". Tested. |
| 2 | Sign-in timing revealed whether an email had an account (unknown emails skipped the slow password hash) | Medium | The same hash work runs for unknown emails. Tested. |
| 3 | The JSON-LD business data could be corrupted by HTML escaping | Low | Verified as valid JSON after the fixes. |
| 4 | Footer Facebook, YouTube and LinkedIn icons opened those **sites' home pages**, not the clinic's | Medium | Replaced with Instagram (real), WhatsApp and email. A comment marks where to add real pages. |

### Data correctness
| # | Finding | Severity | Fix |
|---|---|---|---|
| 5 | Deleted patient stories **reappeared** after a server restart | Medium | Seeding runs once, tracked by a flag. Tested. |
| 6 | Calendar (.ics) files used a time-zone name without a time-zone definition, so Outlook could show the wrong time | Medium | Exact UTC times (10:00 IST → 04:30 UTC). Verified. |
| 7 | "Collected (30 days)" was counted by last-edit date, not appointment date | Low | Counted by appointment date. |
| 8 | WhatsApp-request mode used the visitor's device date (wrong "today" for visitors abroad) | Low | Uses clinic time (IST). |
| 9 | The day strip ran the "release unpaid holds" clean-up 22 times per request | Low | Runs once. |

### Frontend, accessibility, presentation
| # | Finding | Severity | Fix |
|---|---|---|---|
| 10 | Brand green with white text, and green links, at **3.3:1** contrast (WCAG needs 4.5:1) | Serious | `--brand` #15803d for fills (5:1) and a new `--ink` token for green text (light and dark). Red and WhatsApp-green fixed the same way. |
| 11 | If JavaScript fails or is blocked, all animated sections stayed **invisible** and the stats showed "0" | High | Animations only apply when JS runs (`html.js`). Real numbers are in the HTML. Verified with JS off. |
| 12 | Phone numbers could wrap mid-number ("+91 98866 / 88323") | Medium | Non-breaking spaces everywhere. |
| 13 | Inner pages had **no `<h1>`**, and headings skipped levels | Moderate | Hidden per-page `<h1>` from the router. Stories and My appointments headings corrected. |
| 14 | Links in text were distinguished by colour only | Serious | Underlined. |
| 15 | Dashboard form fields weren't linked to their labels; empty table headers | Critical | Labels linked automatically. Hidden "Actions" header text. |
| 16 | The stories carousel auto-scrolled with **no pause** (WCAG 2.2.2) and couldn't be reached by keyboard | Serious | Pause/resume button. The track is focusable and labelled. |
| 17 | Day and time buttons used list-box roles incorrectly; carousel dots used tab roles without panels | Moderate | Toggle buttons (`aria-pressed`). Dots use `aria-current`. |
| 18 | 12 buttons had no `type` | Medium | All typed. The dialog close button kept as submit (it closes `<dialog>`). |
| 19 | Content outside landmarks (top bar, demo bar, skip link) | Moderate | Labelled regions. |
| 20 | No **link-preview image** for WhatsApp/Facebook shares, no iPhone home-screen icon, no web app manifest | Medium | 1200×630 preview card, apple-touch-icon, `manifest.webmanifest`, Open Graph and Twitter tags. |
| 21 | Fonts loaded late | Low | Preloaded. |
| 22 | No canonical address per page | Low | Set by the router for each page. |
| 23 | Pages cached by browsers for 1 hour, so updates weren't seen | Medium | HTML is `no-cache`; assets stay cached. Tested. |
| 24 | Dashboard session timeout showed sign-in with no explanation | Low | Explains that the user was signed out after 30 minutes. |

## Verified unchanged / passing
These were checked and need no change:

- **Server probes:**
  - admin API without sign-in → 401
  - admin changes without the request header → blocked
  - path traversal → 404
  - `.env` and data files are not served
  - 200 KB body → 413
  - malformed JSON → 400
  - SQL-style input → harmless (parameterised queries)
- **Stories:** stored script text is shown as text, never run, and is moderated before publication.
- **Security headers:** CSP, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy are present.

## Open items (need the clinic's input, not code)
1. **Content accuracy:**
   - New Delhi address (two versions in circulation)
   - opening hours ("by appointment" vs fixed times)
   - the "12 years" and "10,000+ patients" figures
   - fees
2. **The doctor's photo and qualifications.** The "RS" placeholder is still shown.
3. **Consent for the 9 testimonials** carried over from the old website, or replace them with stories collected through the new form.
4. **Real Facebook / YouTube page links**, if they exist.
5. **Deployment:** the backend isn't live yet (see `DEPLOY.md`), and Razorpay and WhatsApp still need a live test.
6. **Possible later hardening:** prevent re-use of the same 2FA code within its 30-second window; a yearly external penetration test.
