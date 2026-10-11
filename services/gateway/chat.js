import express from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET, session } from "./admin.js";
import { withClient } from "./upstream.js";

const router = express.Router();
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PORT = process.env.PORT || 4000;

function toGemini(s) {
  const o = {};
  if (!s || typeof s !== "object") return o;
  if (s.type) o.type = s.type;
  if (s.description) o.description = s.description;
  if (s.enum) o.enum = s.enum;
  if (s.items) o.items = toGemini(s.items);
  if (s.properties)
    o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGemini(v)]));
  if (s.required) o.required = s.required;
  return o;
}

async function gemini(body) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || `Gemini HTTP ${r.status}`);
  return data;
}

router.post("/", session, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });

  // short-lived token so the agent calls the gateway AS this user
  const token = jwt.sign({ uid: req.user.id, purpose: "chat" }, JWT_SECRET, { expiresIn: "2m" });
  const me = {
    name: "gateway",
    url: `http://127.0.0.1:${PORT}/mcp`,
    auth_header: "Authorization",
    auth_value: `Bearer chat.${token}`,
  };
  const calls = [];
  try {
    const listed = await withClient(me, (c) => c.listTools());
    const decl = listed.tools.map((t) => {
      const d = { name: t.name, description: (t.description || t.name).slice(0, 500) };
      const p = toGemini(t.inputSchema);
      if (p.properties && Object.keys(p.properties).length) d.parameters = p;
      return d;
    });
    const today = new Date().toISOString().slice(0, 10);
    const system =
      `You help a store team. Use the available tools to answer; never invent data. ` +
      `Today is ${today}. For "today's orders" call the list-orders tool with after="${today}T00:00:00". ` +
      `Prices are strings like "499". Keep answers short.`;
    const contents = [
      ...(history || []).slice(-10).map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: String(h.text || "") }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    for (let i = 0; i < 6; i++) {
      const data = await gemini({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: decl.length ? [{ functionDeclarations: decl }] : undefined,
      });
      const content = data.candidates && data.candidates[0] && data.candidates[0].content;
      if (!content) throw new Error("Gemini returned no content");
      const parts = content.parts || [];
      const fcs = parts.filter((p) => p.functionCall);
      if (!fcs.length)
        return res.json({ reply: parts.map((p) => p.text || "").join("").trim() || "(no answer)", calls });

      contents.push(content);
      const responses = [];
      for (const p of fcs) {
        const { name, args } = p.functionCall;
        const t0 = Date.now();
        let out, ok = true;
        try {
          const r = await withClient(me, (c) => c.callTool({ name, arguments: args || {} }));
          out = (r.content || []).map((x) => x.text || "").join("\n");
          ok = !r.isError;
        } catch (e) { out = e.message; ok = false; }
        calls.push({ name, args, ok, ms: Date.now() - t0, result: out.slice(0, 300) });
        responses.push({ functionResponse: { name, response: { result: out.slice(0, 8000) } } });
      }
      contents.push({ role: "user", parts: responses });
    }
    res.json({ reply: "Stopped after 6 tool rounds.", calls });
  } catch (e) {
    res.status(502).json({ error: e.message, calls });
  }
});

export default router;