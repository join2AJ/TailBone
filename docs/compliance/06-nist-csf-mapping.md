# NIST Cybersecurity Framework 2.0: current profile

**Target tier:** Tier 2 "Risk-informed" is appropriate for a small clinic. Tier 3 "Repeatable" applies once the monthly routine (doc 00) has run for 6 months.

| Function | Category | Current implementation | Gap / next step |
|---|---|---|---|
| **GOVERN (GV)** | GV.OC Context | Scope, laws and suppliers documented (docs 01, 07) | — |
| | GV.RM Risk strategy | ISO 31000 register with appetite and scoring (doc 03) | Quarterly review |
| | GV.RR Roles | Owner, IT operator and staff roles (policy §5) | Sign the policy |
| | GV.PO Policy | Information security & privacy policy (doc 01) | Approve yearly |
| | GV.SC Supply chain | Processor list with DPA checklist (doc 07); single code dependency | Collect DPAs |
| **IDENTIFY (ID)** | ID.AM Assets | Data inventory and systems (doc 07); infrastructure as code | Keep a device list |
| | ID.RA Risk assessment | Risk register; CI dependency audit | Yearly external pen-test |
| | ID.IM Improvement | Lessons from incidents feed the register (doc 05) | — |
| **PROTECT (PR)** | PR.AA Identity & access | Individual accounts, TOTP 2FA, lockout, rate limits, idle and absolute session timeouts, revocation | Make 2FA mandatory |
| | PR.AT Awareness | — | Yearly 30-minute briefing |
| | PR.DS Data security | TLS/HSTS; AES-256-GCM for notes, 2FA secrets and backups; no card data; data minimisation; no trackers; self-hosted fonts | — |
| | PR.PS Platform security | CSP without inline scripts, security headers, minimal dependencies, lockfile, CI tests | Keep Node up to date |
| | PR.IR Resilience | Graceful fallback to phone/WhatsApp; daily backups | Uptime monitor |
| **DETECT (DE)** | DE.CM Monitoring | Security log (sign-ins, failures, lockouts, views, exports, erasures, settings); appointment audit trail; health endpoint | Monthly review; uptime alerting |
| | DE.AE Adverse events | Lockout alerts in the log; patient "worse" alerts in the dashboard (clinical) | Email the owner on account lockout (future) |
| **RESPOND (RS)** | RS.MA Management | Incident procedure with severities (doc 05) | — |
| | RS.CO Communication | DPDP, GDPR and CERT-In timelines and templates (doc 05) | — |
| | RS.MI Mitigation | Sign out everywhere; secret rotation; service suspend | — |
| **RECOVER (RC)** | RC.RP Recovery | Encrypted backups, restore script with integrity check, scenarios S1–S5 (doc 04) | Quarterly restore test |
| | RC.CO Communication | Patient message templates; WhatsApp status | — |
