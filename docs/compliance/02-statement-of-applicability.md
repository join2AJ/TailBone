# Statement of Applicability: ISO/IEC 27001:2022 Annex A

Status key:
- ✅ **Implemented in the software**, with evidence in the repository
- 🟡 **Process**: the clinic or operator must carry it out (procedure in this pack)
- ➖ **Not applicable**, with the reason given

Control titles are paraphrased. See the standard for the full text.

## A.5 Organisational controls
| Control | Status | How / evidence |
|---|---|---|
| 5.1 Policies for information security | 🟡 | `01-information-security-policy.md`, to be approved and signed |
| 5.2 Roles and responsibilities | 🟡 | Policy §5 |
| 5.3 Segregation of duties | 🟡 | Owner approves risks; operator runs systems. Small organisation, so this is compensated by logs |
| 5.7 Threat intelligence | 🟡 | Weekly `npm audit` in CI; subscribe to Render, Netlify and Razorpay status pages |
| 5.9 Inventory of information and assets | ✅/🟡 | `07-privacy-dpdp-gdpr.md` (data inventory and processors); device list kept by the owner |
| 5.10 Acceptable use | 🟡 | Policy §4 |
| 5.12 / 5.13 Classification and labelling | ✅ | Health text is "Confidential: encrypted"; dashboard pages carry `noindex` and `no-store` |
| 5.15 Access control | ✅ | Admin-only API (`requireAdmin`); patients see only their own booking (reference + phone) |
| 5.16 Identity management | ✅ | One account per person (`npm run admin:create`) |
| 5.17 Authentication information | ✅ | scrypt password hashing; minimum 10 characters (policy says 12); TOTP secrets encrypted |
| 5.18 Access rights | 🟡 | Remove leavers the same day; review accounts quarterly |
| 5.19–5.22 Supplier security | 🟡 | Processor list and DPA checklist in doc 07 |
| 5.23 Cloud services | 🟡 | Render (disk encryption at rest, provider-managed), Netlify (HTTPS); enable provider 2FA |
| 5.24–5.28 Incident management | ✅/🟡 | `05-incident-response.md`; security log and audit trail provide evidence |
| 5.29 / 5.30 Continuity and ICT readiness | ✅/🟡 | `04-business-continuity.md`; daily encrypted backups and restore script |
| 5.31 Legal and contractual requirements | 🟡 | DPDP, GDPR, IT Act 2000, clinical record rules, tax retention (doc 07) |
| 5.33 Protection of records | ✅ | Append-only appointment events; financial records kept de-identified on erasure |
| 5.34 Privacy and PII protection | ✅ | Consent, notice versioning, rights self-service, retention, encryption (doc 07) |
| 5.35 / 5.36 Independent review and compliance | 🟡 | Yearly internal review using this pack; external audit for certification |
| 5.37 Documented operating procedures | ✅ | README, `PAYMENTS-SECURITY-HOSTING.md`, this pack |

## A.6 People controls
| Control | Status | How / evidence |
|---|---|---|
| 6.1 Screening | 🟡 | Reference checks for staff with dashboard access |
| 6.2 Employment terms | 🟡 | Confidentiality clause; policy acknowledgement |
| 6.3 Awareness and training | 🟡 | Yearly 30-minute briefing (phishing, WhatsApp hygiene, reporting) |
| 6.5 After termination | 🟡 | Same-day account removal; "sign out all devices" |
| 6.6 Confidentiality agreements | 🟡 | Signature block in the policy |
| 6.7 Remote working | ✅/🟡 | HTTPS-only dashboard, 2FA, idle timeout; device rules in the policy |
| 6.8 Event reporting | 🟡 | Report to the owner immediately (doc 05) |

## A.7 Physical controls
| Control | Status | How / evidence |
|---|---|---|
| 7.1–7.13 Data-centre physical security | ➖ / supplier | Hosted by Render and Netlify (their SOC 2 / ISO 27001 attestations) |
| 7.7 Clear desk and screen | 🟡 | Screen lock on clinic devices; no printed patient lists left out |
| 7.9 Assets off-premises | 🟡 | Encrypted phones and laptops |
| 7.10 Storage media | ✅/🟡 | Backups are encrypted files; downloaded copies stay on an encrypted drive |
| 7.14 Secure disposal | 🟡 | Factory-reset devices before disposal |

## A.8 Technological controls
| Control | Status | How / evidence |
|---|---|---|
| 8.1 User endpoint devices | 🟡 | Policy §4.6 |
| 8.2 Privileged access | ✅ | Only admins reach `/api/admin/*`; no shared accounts |
| 8.3 Information access restriction | ✅ | Patients: own booking only; public pages hold no personal data |
| 8.5 Secure authentication | ✅ | TOTP 2FA, per-account lockout (5 attempts / 15 min), per-IP rate limit, 30-min idle and 12-h absolute timeout, session revocation (`server/auth.js`) |
| 8.7 Protection against malware | ✅/🟡 | Strict CSP blocks injected scripts; devices keep OS protection on |
| 8.8 Technical vulnerabilities | ✅ | CI `npm audit` on every push and weekly (`.github/workflows/ci.yml`) |
| 8.9 Configuration management | ✅ | Infrastructure as code (`render.yaml`, `netlify.toml`, `Dockerfile`); secrets only in environment variables |
| 8.10 Information deletion | ✅ | Erasure tool, automatic retention (`server/privacy.js`) |
| 8.11 Data masking | ✅ | Public stories show first name + initial only; erased records are de-identified |
| 8.12 Data leakage prevention | ✅ | No analytics or trackers; fonts self-hosted; maps and Instagram load only on request; CSP `connect-src` restricted |
| 8.13 Information backup | ✅ | Daily encrypted backups, 14 kept, plus offline copy (doc 04) |
| 8.15 Logging | ✅ | `security_log` and `appointment_events` tables |
| 8.16 Monitoring | ✅/🟡 | `/api/health` for uptime monitoring; monthly log review |
| 8.17 Clock synchronisation | ✅ | Hosting platform NTP; all times stored in UTC, displayed in IST |
| 8.19 Software installation on systems | ✅ | Minimal dependencies (Express only); `npm ci` from a lockfile |
| 8.20–8.22 Network security and segregation | ✅ | Platform-managed TLS; API behind the Netlify proxy; admin API separated by authentication |
| 8.23 Web filtering | ➖ | Not applicable to a public website |
| 8.24 Use of cryptography | ✅ | TLS 1.2+, AES-256-GCM, HMAC-SHA256 (sessions, Razorpay), scrypt |
| 8.25–8.29 Secure development and testing | ✅ | Input validation, parameterised SQL, output escaping, honeypot, CSV-injection guard; 28 automated tests including security tests |
| 8.31 Separation of environments | ✅/🟡 | Local and test databases are separate; use Razorpay **test** keys outside production |
| 8.32 Change management | ✅ | Git history, CI checks before deployment |
| 8.33 Test information | ✅ | Tests use synthetic data only |
| 8.34 Audit testing | 🟡 | Run audits on a copy restored from backup, not on live data |
