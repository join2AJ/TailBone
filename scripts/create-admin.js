// Usage: npm run admin:create -- <email> "<name>"   (prompts for the password)
import readline from "node:readline";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";

const [email, name = "Clinic Admin"] = process.argv.slice(2);
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
  db.prepare(
    `INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash`,
  ).run(email, name, hashPassword(password));
  console.log(`Admin ${email} saved.`);
});
