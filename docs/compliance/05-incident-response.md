# Incident response & personal-data breach notification

Applies to any event that may affect the confidentiality, integrity or availability of patient or clinic data. Examples:
- a lost phone
- an unknown sign-in in the security log
- a message sent to the wrong person
- a leaked password or key
- malware on a clinic device
- an outage
- a supplier notifying us of a breach

> **Legal timelines.** Confirm against the current text of the law; the DPDP Rules were notified in November 2025 with phased commencement.
> - **DPDP (India):** inform the **Data Protection Board** and **each affected person** *without delay* on becoming aware of a personal-data breach. Send a detailed report to the Board within **72 hours** (or longer if the Board allows).
> - **GDPR (EU patients):** notify the supervisory authority within **72 hours** unless the breach is unlikely to risk people's rights. Inform affected people *without undue delay* if the risk is high.
> - **CERT-In (IT Act, 2022 directions):** report specified cyber incidents (e.g. data breach or leak, unauthorised access, compromise of critical accounts) to CERT-In within **6 hours** of noticing them, at incident@cert-in.org.in.

## Roles
- **Incident lead:** Dr Rajveer Singh (owner), who decides on notifications.
- **Technical lead:** the IT operator, who handles containment, investigation and recovery.

## Steps (NIST CSF RS / ISO 27001 A.5.24–5.28)
1. **Detect and report (immediately).** Whoever notices it messages the incident lead. Note the time you became aware; the clock starts here.
2. **Triage (within 1 hour).** What happened, which data and how many patients are affected, and whether it's still happening. Severity:
   - **Sev 1:** health data exposed, or active compromise
   - **Sev 2:** contact data exposed, or an outage over 8 hours
   - **Sev 3:** no data exposed
3. **Contain (as fast as possible):**
   - Compromised account → Dashboard → Settings → **Sign out all other devices**, change the password, check 2FA.
   - Leaked secret → rotate it in Render (`SESSION_SECRET` signs everyone out; also rotate the Razorpay and WhatsApp tokens).
   - Malicious change → suspend the service in Render, and restore the last good deploy or backup (doc 04).
   - Lost device → sign out all devices, and wipe it remotely (Find My Device / Find My).
4. **Preserve evidence.**
   - Export the security log: Settings → Security log → screenshot or copy.
   - Download the appointment history of the affected records.
   - Keep the Render and Netlify logs.
5. **Assess notification duties (by 24 hours at the latest).** If personal data was, or may have been, accessed, disclosed, altered, lost or made unavailable, it is a **personal-data breach**.
   - Notify the **Data Protection Board** and the affected patients (DPDP).
   - Notify **CERT-In** if the incident type is covered.
   - Notify the **EU supervisory authority** if EU residents' data is involved and there's a risk.
6. **Notify** using the templates below.
7. **Recover.** Restore the service, verify integrity, and reconcile payments.
8. **Learn (within 2 weeks).** Root cause, record the lessons, update the risk register (03) and the controls, and brief staff.

## Message to affected patients (template)
> Dear [name], we're writing to tell you about a security incident at Tailbone Treatment Clinic. On [date], [what happened in plain words]. The information involved was [e.g. your name, phone number, appointment date / symptoms you described]. We have [steps taken]. We recommend you [e.g. be cautious of messages claiming to be from us asking for payment]. If you have questions, contact Dr Rajveer Singh at contact@tailbonetreatment.com or +91 98866 88323. You may also contact the Data Protection Board of India. We sincerely apologise.

## Report to the Data Protection Board (contents)
1. The nature, extent, timing and location of the breach.
2. The likely consequences for the people affected.
3. The measures taken, or planned, to reduce the harm.
4. The safety measures being taken to prevent it happening again.
5. The findings about the person or cause responsible, if known.
6. The notifications sent to affected people.
7. The contact person.

## Incident log
| ID | Detected (date/time) | Description | Severity | Personal data? | Notified (Board / CERT-In / patients / EU SA) | Closed | Lessons |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
