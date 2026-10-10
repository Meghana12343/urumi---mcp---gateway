import bcrypt from "bcryptjs";
import db from "./db.js";

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password || password.length < 8) {
  console.error("Usage: node seed.js <email> <password-8-chars-min> [woo-mcp-url]");
  process.exit(1);
}
const wooUrl = process.argv[4] || "http://localhost:3001/mcp";

db.prepare("INSERT OR IGNORE INTO users(email, role, password_hash) VALUES(?, 'admin', ?)")
  .run(email, bcrypt.hashSync(password, 10));
db.prepare("INSERT OR IGNORE INTO servers(name, url) VALUES('woo', ?)").run(wooUrl);
console.log("Admin created. Log in, then create API keys from the dashboard or API.");