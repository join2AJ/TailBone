# Business continuity & disaster recovery (ISO 22301)

## 1. Business impact analysis
| Activity | Depends on | Max tolerable outage | RTO (restore within) | RPO (max data loss) |
|---|---|---|---|---|
| Patients finding clinic info and contact | Netlify site | 24 h | 4 h | n/a (static) |
| Online booking, rescheduling and cancelling | Render API + DB | 48 h (phone/WhatsApp fallback) | 8 h | 24 h |
| Viewing today's schedule and notes | Dashboard + DB | 4 h during clinic hours | 4 h | 24 h |
| Payments and refunds | Razorpay + API | 48 h (pay at clinic fallback) | 8 h | 0 (Razorpay is the record) |
| Messages to patients | WhatsApp | 24 h | Manual phone calls | n/a |

## 2. Continuity strategies
- **Graceful degradation (built in):** if the API is unreachable, the booking form automatically shows "WhatsApp us / Call us". The rest of the site keeps working from Netlify.
- **Paper fallback:** each morning, the owner prints or screenshots the day's schedule from the Overview page, so clinic days can run during an outage.
- **Backups:**
  - automatic encrypted backup daily after 02:00 IST, 14 kept on the server disk
  - weekly download of the latest backup to an encrypted USB drive or an encrypted cloud folder held by the owner
  - **3-2-1 rule:** 3 copies (live, server backup, offline), on 2 kinds of media, 1 off-site
- **Payments:** Razorpay holds the authoritative payment record. Reconcile after any restore.

## 3. Scenarios and recovery procedures
### S1: Render or API outage
1. Check the Render status page and the uptime monitor alert.
2. Nothing else to do: the site falls back to WhatsApp and phone booking automatically. Pin a WhatsApp status: "Online booking temporarily down, please message us."
3. Once it's back, enter any phone bookings through the dashboard's **+ New appointment**.

### S2: Database lost or corrupted, or a bad deploy
1. Stop the service (Render → Suspend).
2. Download the newest backup, from Render's disk or your offline copy.
3. Restore on any computer with Node 22:
   ```bash
   ENCRYPTION_KEY=<key> npm run backup:restore -- tailbone-2026-10-17T02-10.db.enc restored.db
   # prints: integrity ok · patients: N, appointments: N, followups: N
   ```
4. Upload `restored.db` to the disk as `tailbone.db`, using the Render shell or `scp`, then resume the service.
5. Reconcile payments made since the backup time with the Razorpay dashboard, and re-enter missing bookings.
6. Log it as an incident (doc 05).

### S3: Hosting account compromised or lost
1. Create a new Render service from `render.yaml` in a fresh account.
2. Restore the latest **offline** backup (S2).
3. Rotate every secret: `SESSION_SECRET`, Razorpay keys, the WhatsApp token, the Resend key and, if exposure is suspected, admin passwords.
4. Point `netlify.toml` to the new backend.

### S4: Encryption key compromised
1. Treat it as a potential breach (doc 05).
2. Generate a new key.
3. Export, then re-import, the data: restore the backup with the old key, then start the app with the new key. Notes re-encrypt as they're saved; a one-off migration script is available on request.

### S5: Key person unavailable
The password manager holds the Render, Netlify, Razorpay and GitHub logins and the encryption key. Emergency access is granted to one trusted person.

## 4. Exercises and testing
| Test | Frequency | Pass criteria |
|---|---|---|
| Restore the latest backup on a laptop and run the integrity check | Quarterly | `integrity ok`; record counts match the dashboard |
| Outage drill: stop the API in a test deploy and confirm the WhatsApp fallback appears | Twice a year | Fallback visible within 1 minute |
| Review this plan, contacts and RTO/RPO | Yearly | Updated and signed |

Exercise log: | Date | Test | Result | Issues | Fixed by |

## 5. Monitoring
- Uptime monitor (free: UptimeRobot or Better Stack) on `https://<site>/api/health` every 5 minutes, alerting the owner by SMS or WhatsApp.
- Render email alerts for deploy failures and disk usage over 80%.
