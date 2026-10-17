# Information Security & Privacy Policy

**Organisation:** Tailbone Treatment Clinic (Bengaluru · New Delhi · Online)
**Owner:** Dr Rajveer Singh (top management) · **IT operator:** [name of the person or firm maintaining the website]
**Version:** 1.0 · **Approved:** [date, signature] · **Review:** yearly, or after a major change or incident

## 1. Purpose
To protect the confidentiality, integrity and availability of patient and clinic information. To meet our obligations under India's Digital Personal Data Protection Act 2023 and the DPDP Rules, the EU GDPR where it applies, and the clinical record-keeping rules for our profession. To keep the clinic running through disruptions.

## 2. Scope
- The website (tailbonetreatment.com) and the booking, payment, notification and dashboard systems.
- Clinic devices used to access them (phones, laptops).
- Staff and contractors who handle patient information.
- Suppliers that host or process it: Render, Netlify, Razorpay, Meta WhatsApp, Resend and GitHub.

## 3. Objectives (measured quarterly)
1. Zero confirmed personal-data breaches.
2. 100% of staff accounts have 2FA turned on.
3. 100% of privacy requests answered within 30 days.
4. A backup restore is tested every quarter. Recovery targets: RTO ≤ 8 h, RPO ≤ 24 h.
5. No high or critical dependency vulnerability open for more than 14 days.

## 4. Principles and rules
1. **Need to know.** Patient data is accessed only for care, administration or legal duties. No browsing records out of curiosity: views are logged.
2. **Individual accounts.** Never share logins. 2FA is mandatory for all dashboard users. Leavers lose access the same day.
3. **Strong authentication.** Passwords are at least 12 characters, unique and kept in a password manager.
4. **Minimum data.** Collect only what's needed. Don't copy patient data into personal WhatsApp, email, spreadsheets or photos.
5. **Encryption.** Data in transit uses HTTPS only. Clinical notes and backups are encrypted at rest. Exports and backups are stored only on encrypted devices.
6. **Devices.** Phones and laptops used for the dashboard need a screen lock, current updates and disk encryption (on by default on modern phones and Macs; BitLocker on Windows).
7. **Consent and transparency.** Patients see the privacy notice and give consent before booking. Withdrawal is honoured immediately.
8. **Retention.** Records are kept only as long as the retention schedule (doc 07) says. Automatic erasure runs daily.
9. **Suppliers.** Only use processors with adequate security and a signed data processing agreement.
10. **Incidents.** Anyone who suspects a problem (a lost phone, a strange login, a wrong message sent) reports it **immediately** to the owner, and doc 05 is followed.
11. **Change.** Code changes go through Git with automated tests and a dependency audit. Secrets are never committed.
12. **Continuity.** Backups are taken daily and copied offline weekly. The fallback is phone and WhatsApp booking (doc 04).

## 5. Roles
| Role | Responsibility |
|---|---|
| Owner (Dr Rajveer Singh) | Approves this policy, accepts risks, is the grievance officer for privacy, decides on breach notifications |
| IT operator | Runs the platform, backups, updates, access management, monitoring; maintains this pack |
| Staff | Follow this policy, complete the yearly briefing, report incidents |

## 6. Compliance
Breaking this policy may lead to access being withdrawn and to disciplinary or contractual action. The policy is communicated to all staff and contractors. Each signs the confidentiality acknowledgement below.

> I have read and will follow the Information Security & Privacy Policy. — Name · Signature · Date
