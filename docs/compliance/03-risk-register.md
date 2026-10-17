# Risk management (ISO 31000) & risk register

## Method
Following the ISO 31000 process: **context → identify → analyse → evaluate → treat → monitor & review → communicate**.

- **Likelihood (L):**
  - 1 rare (less than once in 5 years)
  - 2 unlikely
  - 3 possible (about once a year)
  - 4 likely
  - 5 almost certain (monthly)
- **Impact (I):**
  - 1 negligible
  - 2 minor (short inconvenience)
  - 3 moderate (patients affected, recoverable)
  - 4 major (health data exposed, or more than a day of outage)
  - 5 severe (large breach, regulatory penalty, clinic reputation)
- **Score = L × I.**
  - 1–6: Low (accept)
  - 8–12: Medium (treat within 3 months)
  - 15–25: High (treat now)
- **Risk appetite:** low for patient confidentiality, moderate for availability (phone and WhatsApp booking is an acceptable fallback).
- **Review:** quarterly and after every incident. The risk owner is Dr Rajveer Singh unless stated.

## Register
| ID | Risk | Inherent L×I | Controls in place | Residual L×I | Treatment / next action |
|---|---|---|---|---|---|
| R1 | Stolen or guessed admin password → patient data exposed | 4×5=20 | 2FA, lockout, IP rate limit, scrypt, idle timeout, security log | 1×5=5 | Make 2FA mandatory for all users; monthly log review |
| R2 | Lost or stolen clinic phone with a signed-in dashboard | 3×4=12 | 30-min idle timeout, "sign out all devices", phone screen lock | 2×3=6 | Enforce device lock and encryption (policy §4.6) |
| R3 | Database file or backup leaked from the host | 2×5=10 | AES-256-GCM on notes, 2FA secrets and backup files; provider disk encryption | 1×4=4 | Store `ENCRYPTION_KEY` only in host secrets and a password manager |
| R4 | Encryption key lost → notes and backups unreadable | 2×4=8 | Key in env plus password manager copy | 1×4=4 | Two people hold the password manager entry |
| R5 | Web attack (XSS, injection, CSRF) | 3×4=12 | Strict CSP, output escaping, parameterised SQL, SameSite cookies + header check, input validation | 1×4=4 | Keep CI audit green; yearly pen-test |
| R6 | Vulnerable dependency | 3×3=9 | Single dependency, lockfile, weekly `npm audit` | 2×2=4 | Patch within 14 days of a high finding |
| R7 | Hosting outage (Render or Netlify) | 3×3=9 | Phone and WhatsApp fallback shown automatically; health endpoint | 3×2=6 | Uptime monitor with an SMS alert (doc 04) |
| R8 | Data loss (disk failure, bad deploy, accidental deletion) | 2×5=10 | Daily encrypted backups ×14, weekly offline copy, restore script | 1×3=3 | Quarterly restore test |
| R9 | Message sent to the wrong patient | 3×3=9 | Messages built from the booking record; phone normalised; one-tap preview before sending | 2×2=4 | Staff briefing |
| R10 | Payment fraud or fake payment confirmation | 3×4=12 | Server-side HMAC signature verification, webhook signature, idempotent payment marking | 1×3=3 | Reconcile monthly against Razorpay settlements |
| R11 | Non-compliance with DPDP or GDPR (consent, rights, retention) | 3×4=12 | Consent capture, versioned notice, rights portal, 30-day tracking, auto-retention | 1×3=3 | Yearly privacy review; keep the notice accurate |
| R12 | Processor (supplier) breach | 2×4=8 | Minimal data shared; no card data held; DPAs | 2×3=6 | Collect DPAs and certifications yearly |
| R13 | Spam or bot bookings blocking slots | 3×2=6 | Honeypot, rate limits, 3-active-bookings cap, payment holds expire | 2×1=2 | Accept |
| R14 | Insider misuse (staff browsing records) | 2×4=8 | Individual accounts, view logging, need-to-know rule | 1×4=4 | Monthly log review |

## Risk acceptance
Residual risks above are accepted by the owner. Signature: ________________ Date: ________
