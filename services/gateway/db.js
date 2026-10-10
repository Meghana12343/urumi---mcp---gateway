import Database from "better-sqlite3";
const db = new Database(process.env.DB_PATH || "./gateway.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS api_keys(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, key_hash TEXT UNIQUE NOT NULL,
  prefix TEXT NOT NULL, label TEXT, revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS servers(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, url TEXT NOT NULL,
  auth_header TEXT, auth_value TEXT, enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, user_id INTEGER,
  server TEXT, tool TEXT, duration_ms INTEGER, outcome TEXT, error TEXT);
`);
export default db;