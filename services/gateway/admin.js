import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import { withClient } from "./upstream.js";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const router = express.Router();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function session(req, res, next) {
  try {
    const p = jwt.verify(req.cookies.session, JWT_SECRET);
    const u = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(p.uid);
    if (!u) throw new Error("no user");
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: "not logged in" });
  }
}
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "admin only" });

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email || "");
  if (!u || !u.password_hash || !bcrypt.compareSync(password || "", u.password_hash))
    return res.status(401).json({ error: "invalid credentials" });
  const token = jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: "8h" });
  res.cookie("session", token, { httpOnly: true, sameSite: "lax" });
  res.json({ id: u.id, email: u.email, role: u.role });
});
router.post("/logout", (_req, res) => { res.clearCookie("session"); res.json({ ok: true }); });
router.get("/me", session, (req, res) => res.json(req.user));

const pub = (s) => ({
  id: s.id, name: s.name, url: s.url, enabled: !!s.enabled,
  auth_header: s.auth_header, has_credential: !!s.auth_value,
});

router.get("/servers", session, adminOnly, async (_req, res) => {
  const rows = db.prepare("SELECT * FROM servers ORDER BY id").all();
  const out = await Promise.all(rows.map(async (s) => {
    if (!s.enabled) return { ...pub(s), status: "Disabled", tools: [] };
    try {
      const r = await withClient(s, (c) => c.listTools());
      return { ...pub(s), status: "Connected",
        tools: r.tools.map((t) => ({ name: t.name, description: t.description })) };
    } catch (e) {
      return { ...pub(s), status: "Unreachable", error: e.message, tools: [] };
    }
  }));
  res.json(out);
});

router.post("/servers", session, adminOnly, (req, res) => {
  const { name, url, auth_header, auth_value } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: "name and url required" });
  try { new URL(url); } catch { return res.status(400).json({ error: "invalid url" }); }
  try {
    const r = db.prepare("INSERT INTO servers(name, url, auth_header, auth_value) VALUES(?,?,?,?)")
      .run(name, url, auth_header || null, auth_value || null);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch { res.status(409).json({ error: "name already exists" }); }
});

router.patch("/servers/:id", session, adminOnly, (req, res) => {
  const cur = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  db.prepare("UPDATE servers SET name=?, url=?, enabled=?, auth_header=?, auth_value=? WHERE id=?").run(
    b.name ?? cur.name, b.url ?? cur.url,
    b.enabled === undefined ? cur.enabled : (b.enabled ? 1 : 0),
    b.auth_header ?? cur.auth_header, b.auth_value ? b.auth_value : cur.auth_value, cur.id);
  res.json({ ok: true });
});

router.delete("/servers/:id", session, adminOnly, (req, res) => {
  db.prepare("DELETE FROM servers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/users", session, adminOnly, (_req, res) =>
  res.json(db.prepare("SELECT id, email, role, created_at FROM users ORDER BY id").all()));

router.post("/users", session, adminOnly, (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: "email and password (8+ chars) required" });
  try {
    const r = db.prepare("INSERT INTO users(email, role, password_hash) VALUES(?,?,?)")
      .run(email, role === "admin" ? "admin" : "member", bcrypt.hashSync(password, 10));
    res.status(201).json({ id: r.lastInsertRowid });
  } catch { res.status(409).json({ error: "email already exists" }); }
});

router.delete("/users/:id", session, adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "cannot delete yourself" });
  db.prepare("UPDATE api_keys SET revoked = 1 WHERE user_id = ?").run(req.params.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/keys", session, (req, res) => {
  const sel = `SELECT k.id, k.prefix, k.label, k.revoked, k.created_at, u.email
               FROM api_keys k JOIN users u ON u.id = k.user_id`;
  const rows = req.user.role === "admin"
    ? db.prepare(sel + " ORDER BY k.id DESC").all()
    : db.prepare(sel + " WHERE k.user_id = ? ORDER BY k.id DESC").all(req.user.id);
  res.json(rows);
});

router.post("/keys", session, (req, res) => {
  const key = "mcp_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO api_keys(user_id, key_hash, prefix, label) VALUES(?,?,?,?)")
    .run(req.user.id, sha(key), key.slice(0, 8), (req.body && req.body.label) || null);
  res.status(201).json({ key });
});

router.delete("/keys/:id", session, (req, res) => {
  const k = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(req.params.id);
  if (!k || (req.user.role !== "admin" && k.user_id !== req.user.id))
    return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(k.id);
  res.json({ ok: true });
});

router.get("/audit", session, (req, res) => {
  const base = `SELECT a.ts, u.email, a.server, a.tool, a.duration_ms, a.outcome, a.error
                FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`;
  const rows = req.user.role === "admin"
    ? db.prepare(base + " ORDER BY a.id DESC LIMIT 200").all()
    : db.prepare(base + " WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 200").all(req.user.id);
  res.json(rows);
});

export default router;