# Compliance pack: ISO 27001 · ISO 22301 · ISO 31000 · NIST CSF 2.0 · DPDP Act 2023 · GDPR

## Read this first: what "ensured" can and can't mean

| Standard / law | What it is | Can software alone satisfy it? |
|---|---|---|
| **ISO/IEC 27001:2022** | Certifiable **management system** for information security (ISMS) | **No.** Certification is for the *organisation*: policies, risk process, people, internal audit and management review, audited by an accredited certification body. The software provides the technical controls and evidence. |
| **ISO 22301:2019** | Certifiable **business continuity** management system | **No.** Same as above. The software provides backups, restore and monitoring; the clinic owns the plan, tests and reviews. |
| **ISO 31000:2018** | Risk management **guidelines** (not certifiable) | Followed by the risk register in this pack. |
| **NIST CSF 2.0** | Voluntary cybersecurity **framework** (not certifiable) | Mapped in this pack. You choose a target "tier" and profile. |
| **DPDP Act 2023 + DPDP Rules 2025** (India) | **Law** | Compliance means following the law in practice. The site implements notice, consent, rights, retention, security safeguards and breach readiness. The clinic must operate them. |
| **GDPR** (EU) | **Law**; applies when EU residents are treated or targeted | Same as DPDP. Implemented, but needs operating. |

**Bottom line:** the website and dashboard now implement the technical controls these standards expect, and this folder holds the policies and records an auditor or regulator will ask for. To be able to *claim* ISO certification, the clinic (or you, as its IT provider) must run the ISMS for a few months and pass a Stage 1 and a Stage 2 audit. A small clinic can do this realistically in 4–6 months with a consultant.

## Files
| # | Document | Standard(s) |
|---|---|---|
| 01 | [Information security policy](01-information-security-policy.md) | ISO 27001 cl. 5.2, A.5.1 · NIST GV.PO |
| 02 | [Statement of Applicability (Annex A controls)](02-statement-of-applicability.md) | ISO 27001 cl. 6.1.3 |
| 03 | [Risk management & risk register](03-risk-register.md) | ISO 31000 · ISO 27001 cl. 6.1, 8.2 · NIST GV.RM / ID.RA |
| 04 | [Business continuity & disaster recovery](04-business-continuity.md) | ISO 22301 · NIST RC |
| 05 | [Incident response & breach notification](05-incident-response.md) | ISO 27001 A.5.24–5.28 · NIST RS · DPDP s.8(6) · GDPR Art. 33–34 |
| 06 | [NIST CSF 2.0 profile](06-nist-csf-mapping.md) | NIST CSF 2.0 |
| 07 | [Privacy programme: records of processing, retention, DPIA, rights handling](07-privacy-dpdp-gdpr.md) | DPDP · GDPR Art. 30, 35 |

## Shared responsibility

| Area | Built into the software ✅ | Clinic / operator must do ⬜ |
|---|---|---|
| Access control | Individual accounts, 2FA, lockout, 30-min idle timeout, sign-out everywhere | Give every staff member their own login, turn on 2FA, remove leavers the same day |
| Encryption | HTTPS/HSTS, AES-256-GCM for notes, 2FA secrets and backups | Generate `ENCRYPTION_KEY`, store it in a password manager, rotate if exposed |
| Logging | Security log (sign-ins, views, exports, erasures, settings), appointment audit trail | Review the security log monthly (10 minutes) |
| Backups | Daily encrypted backups, 14 kept, restore script with integrity check | Download one weekly to offline storage; test a restore every quarter |
| Privacy | Consent capture, versioned notice, self-service export, consent withdrawal, rights requests with deadlines, erasure, auto-retention | Answer requests within 30 days; keep the notice accurate; sign processor agreements |
| Vulnerabilities | CI: tests + `npm audit` on every push and weekly | Act on failed audits; keep Node and hosting up to date |
| People | — | Confidentiality agreements, yearly 30-minute security and privacy briefing |
| Suppliers | — | Keep the DPAs (data processing agreements) with Render, Netlify, Razorpay, Meta and Resend on file |

## Monthly 15-minute compliance routine
1. Dashboard → Settings → **Security log**: look for failed sign-ins, lockouts or unexpected exports.
2. Dashboard → **Privacy**: no overdue requests.
3. Settings → **Backups**: download the latest to offline storage.
4. GitHub → Actions: the CI run is green.
5. Note anything unusual in the risk register (03) and the incident log (05).
