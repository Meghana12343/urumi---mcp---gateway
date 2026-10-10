import express from "express";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import db from "./db.js";
import { withClient } from "./upstream.js";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const err = (text) => ({ isError: true, content: [{ type: "text", text }] });

function audit(userId, server, tool, ms, outcome, error = null) {
  db.prepare(
    "INSERT INTO audit_log(user_id, server, tool, duration_ms, outcome, error) VALUES(?,?,?,?,?,?)",
  ).run(userId, server, tool, ms, outcome, error);
}

function authenticate(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const user =
    m &&
    db
      .prepare(
        `SELECT u.id, u.email, u.role FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.revoked = 0`,
      )
      .get(sha(m[1]));
  if (!user)
    return res.status(401).json({ error: "invalid or revoked API key" });
  req.user = user;
  next();
}

function buildServer(user) {
  const server = new Server(
    { name: "mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const servers = db.prepare("SELECT * FROM servers WHERE enabled = 1").all();
    const results = await Promise.allSettled(
      servers.map(async (s) => {
        const r = await withClient(s, (c) => c.listTools());
        return r.tools.map((t) => ({
          ...t,
          name: `${slug(s.name)}__${t.name}`,
          description: `[${s.name}] ${t.description ?? ""}`,
        }));
      }),
    );
    return {
      tools: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const full = req.params.name;
    const i = full.indexOf("__");
    const t0 = Date.now();
    const s =
      i > 0 &&
      db
        .prepare("SELECT * FROM servers WHERE enabled = 1")
        .all()
        .find((x) => slug(x.name) === full.slice(0, i));
    if (!s) {
      audit(user.id, null, full, 0, "error", "unknown tool");
      return err(`Unknown tool '${full}'`);
    }
    const tool = full.slice(i + 2);
    try {
      const result = await withClient(s, (c) =>
        c.callTool({ name: tool, arguments: req.params.arguments ?? {} }),
      );
      audit(
        user.id,
        s.name,
        tool,
        Date.now() - t0,
        result.isError ? "error" : "ok",
      );
      return result;
    } catch (e) {
      audit(user.id, s.name, tool, Date.now() - t0, "error", e.message);
      return err(`Upstream '${s.name}' failed: ${e.message}`);
    }
  });

  return server;
}

const app = express();
app.use(express.json());
app.get("/healthz", (_req, res) => res.send("ok"));

app.post("/mcp", authenticate, async (req, res) => {
  const server = buildServer(req.user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) =>
  res.status(405).json({ error: "Method not allowed" }),
);

app.listen(4000, () => console.log("gateway listening on :4000"));
