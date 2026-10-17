// Usage: npm run admin:create -- <email> "<name>" [--super]   (prompts for the password)
// The first account is always the super admin. Others are admins with default permissions,
// which the super admin can change in the dashboard (Control panel). Re-running for an existing
// email resets its password and unlocks it (useful if the super admin is locked out).
import readline from "node:readline";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";

const args = process.argv.slice(2);
const makeSuper = args.includes("--super");
const [email, name = "Clinic Admin"] = args.filter((a) => a !== "--super");
if (!email || !email.includes("@")) {
  console.error('Usage: npm run admin:create -- <email> "<name>"');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Password (min 10 characters): ", (password) => {
  rl.close();
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  const db = openDb();
  const first = !db.prepare("SELECT 1 FROM admins").get();
  const role = makeSuper || first ? "superadmin" : "admin";
  db.prepare(
    `INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash,
       role = CASE WHEN ? = 'superadmin' THEN 'superadmin' ELSE admins.role END,
       failed_logins = 0, locked_until = NULL, disabled = 0, session_version = admins.session_version + 1`,
  ).run(email, name, hashPassword(password), role, role);
  console.log(`${role === "superadmin" ? "Super admin" : "Admin"} ${email} saved.`);
});
