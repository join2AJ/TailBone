# Privacy programme: DPDP Act 2023 (India) and GDPR (EU)

## 1. Roles
- **Data Fiduciary / Controller:** Tailbone Treatment Clinic (Dr Rajveer Singh).
- **Grievance officer / privacy contact:** Dr Rajveer Singh, contact@tailbonetreatment.com, +91 98866 88323. Published in the privacy notice.
- **Data Processors:** listed in §4.
- **Significant Data Fiduciary?** Unlikely at clinic scale. If notified as one, appoint a DPO and an independent auditor, and run yearly DPIAs (DPDP s.10).
- **EU representative (GDPR Art. 27):** only needed if the clinic actively targets EU residents. Currently it doesn't: EU patients who travel in are covered by the GDPR principles in this pack.

## 2. Record of processing activities (GDPR Art. 30)
| Activity | Data subjects | Data | Purpose | Basis (DPDP / GDPR) | Retention | Recipients |
|---|---|---|---|---|---|---|
| Online & clinic booking | Patients | Name, phone, email, clinic, time, symptoms | Provide care | Consent / Art. 6(1)(a) + 9(2)(a),(h) | 3 years after last visit | Render (host) |
| Clinical notes, follow-ups, check-ins | Patients | Health notes, pain scores, comments | Treatment and follow-up | Consent / Art. 9(2)(h) | 3 years after last visit | Render |
| Payments & refunds | Patients | Amount, status, Razorpay IDs | Contract, tax | Legal obligation (s.7) / Art. 6(1)(b),(c) | 8 years, de-identified | Razorpay |
| WhatsApp updates | Patients who opted in | Phone, appointment details | Reminders and updates | Consent / Art. 6(1)(a) | Message text cleared after 1 year | Meta |
| Patient stories | Volunteers | Name, city, story | Publication | Consent / Art. 6(1)(a) | Until withdrawn | Public website |
| Privacy requests | Anyone | Name, contact, request | Legal duty | Legal obligation | 3 years | — |
| Security logs | Staff, visitors | Email, IP, action | Security | Legitimate use / Art. 6(1)(f) | 1–2 years | Render |
| Staff accounts | Staff | Name, email, password hash, 2FA secret | Access control | Contract / legitimate interest | While employed | Render |

## 3. Retention schedule (enforced by `runRetention`, daily)
| Data | Retention | Mechanism |
|---|---|---|
| Patient identity and clinical text | 3 years after the last appointment (`RETENTION_YEARS`) | Automatic erasure (identity, notes, comments wiped) |
| Financial fields (ref, date, fee, amounts) | Kept de-identified | Needed for tax (Income-tax Act / GST, typically 6–8 years) |
| Notification texts | 1 year | Replaced by `[expired]` |
| Security log | 2 years (DPDP Rules require at least 1 year) | Deleted |
| Backups | 14 days on the server; offline copies to be destroyed after 3 months | Rotation |

> Clinical record retention: check the current guidance for your profession (e.g. physiotherapy council or state rules). If a longer period applies, set `RETENTION_YEARS` accordingly and update the notice.

## 4. Processors and transfers
| Processor | Service | Data | Location | DPA / assurance | Status |
|---|---|---|---|---|---|
| Render | Application hosting + disk | All (encrypted notes) | Choose **Singapore** (closest to India) | Render DPA; SOC 2 Type II | ⬜ accept the DPA in the dashboard |
| Netlify | Static site + proxy | Request metadata | Global CDN | Netlify DPA; SOC 2 | ⬜ |
| Razorpay | Payments | Name, phone, email, amount | India | PCI-DSS Level 1; merchant agreement | ⬜ |
| Meta (WhatsApp Cloud API) | Messages | Phone, message text | Global | WhatsApp Business terms and data processing terms | ⬜ |
| Resend (optional) | Email to the doctor | Message text | USA/EU | Resend DPA | ⬜ |
| GitHub | Source code (no patient data) | None | USA | — | — |

**Transfers outside India:** DPDP allows them except to countries the Government restricts (none notified as of writing). **For EU patients:** rely on the processors' Standard Contractual Clauses.

## 5. Consent management (DPDP s.6, GDPR Art. 7)
- Booking needs an affirmative tick for the **care** purpose. **WhatsApp updates** are a separate, optional tick.
- Each consent is stored with the notice **version**, timestamp and source (`consents` table). It's shown on the patient profile in the dashboard.
- **Withdrawal:**
  - patients can switch off WhatsApp updates themselves on the My appointments page
  - other withdrawals come in through the request form
  - withdrawal is recorded, never deleted
- If the notice changes materially: bump `NOTICE_VERSION` in `server/privacy.js` and the date on `privacy.html`. New bookings then record the new version.
- **Children (DPDP s.9 / GDPR Art. 8):** patients under 18 must be booked by a parent or guardian, who gives consent. Staff verify this at the first visit.

## 6. Handling rights requests (SOP)
1. A request arrives through `privacy.html#request`, by email or in person. It appears in **Dashboard → Privacy**, with a 30-day deadline and a doctor-inbox alert.
2. **Verify identity:** call the phone number on file, or ask for the booking reference. Set the status to *Verifying*.
3. **Act on the request:**
   - **Access / portability:** Patient profile → *Export data (JSON)*. Send it securely, for example as a password-protected file with the password shared by phone. Patients can also download it themselves on My appointments.
   - **Correction:** edit the patient's contact details or notes.
   - **Erasure:** cancel any upcoming visits, then Patient profile → *Erase personal data* (type the name to confirm). Explain that payment records are kept de-identified because tax law requires it.
   - **Withdraw consent:** switch off WhatsApp updates, or erase if they ask.
   - **Grievance:** investigate and reply. Tell them they can escalate to the Data Protection Board.
4. Mark the request *Completed* with a note of what was done. The security log keeps evidence of exports and erasures.

## 7. DPIA summary (GDPR Art. 35, recommended for health data)
- **Processing:** online booking and follow-up of patients with coccyx pain; health data in free text and pain scores.
- **Necessity and proportionality:** only the fields needed for care are collected. Notes are optional. There's no profiling, no advertising, no sale and no automated decisions.
- **Risks to people:**
  - disclosure of a health condition (embarrassment, discrimination)
  - unwanted messages
  - loss of records
- **Measures:**
  - encryption at rest and in transit
  - 2FA and access logging
  - patients see only their own data
  - public stories show initials only and need separate consent
  - automatic retention
  - backups
  - breach procedure
- **Residual risk:** low. No prior consultation with an authority is required.
- **Sign-off:** ________ Date: ________
