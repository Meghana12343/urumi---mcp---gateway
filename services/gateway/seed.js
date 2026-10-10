import crypto from "node:crypto";
import db from "./db.js";

const email = process.argv[2] || "admin@example.com";
const wooUrl = process.argv[3] || "http://localhost:3001/mcp";

db.prepare("INSERT OR IGNORE INTO users(email, role) VALUES(?, 'admin')").run(
  email,
);
const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

const key = "mcp_" + crypto.randomBytes(24).toString("hex");
const hash = crypto.createHash("sha256").update(key).digest("hex");
db.prepare("INSERT INTO api_keys(user_id, key_hash, prefix) VALUES(?,?,?)").run(
  user.id,
  hash,
  key.slice(0, 8),
);

db.prepare("INSERT OR IGNORE INTO servers(name, url) VALUES('woo', ?)").run(
  wooUrl,
);
console.log("API key (shown only once, save it):", key);
