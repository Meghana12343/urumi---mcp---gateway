import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const MODE = process.env.MODE || "notes";
const PORT = Number(process.env.PORT || 3000);
const notes = [];
let nextId = 1;

const out = (d) => ({
  content: [{ type: "text", text: typeof d === "string" ? d : JSON.stringify(d, null, 2) }],
});

function build() {
  const s = new McpServer({ name: `demo-${MODE}`, version: "1.0.0" });

  s.registerTool("ping", { description: `Health check for the ${MODE} server.` },
    async () => out(`pong from ${MODE}`));

  if (MODE === "notes") {
    s.registerTool("add_note", {
      description: "Save a short note.",
      inputSchema: { text: z.string().min(1) },
    }, async ({ text }) => {
      const n = { id: nextId++, text, created: new Date().toISOString() };
      notes.push(n);
      return out(n);
    });
    s.registerTool("list_notes", { description: "List all saved notes." },
      async () => out(notes));
    s.registerTool("delete_note", {
      description: "Delete a note by id.",
      inputSchema: { id: z.number().int() },
    }, async ({ id }) => {
      const i = notes.findIndex((n) => n.id === id);
      if (i < 0) return { isError: true, content: [{ type: "text", text: "note not found" }] };
      notes.splice(i, 1);
      return out(`deleted note ${id}`);
    });
  }

  if (MODE === "utils") {
    s.registerTool("current_time", {
      description: "Current date and time. Optional IANA timezone, default Asia/Kolkata.",
      inputSchema: { timezone: z.string().optional() },
    }, async ({ timezone }) => {
      try {
        return out(new Date().toLocaleString("en-IN", { timeZone: timezone || "Asia/Kolkata" }));
      } catch {
        return { isError: true, content: [{ type: "text", text: "invalid timezone" }] };
      }
    });
    s.registerTool("sum", {
      description: "Add a list of numbers, for example order totals.",
      inputSchema: { numbers: z.array(z.number()).min(1) },
    }, async ({ numbers }) => out(String(numbers.reduce((a, b) => a + b, 0))));
  }
  return s;
}

const app = express();
app.use(express.json());
app.get("/healthz", (_req, res) => res.send("ok"));

app.post("/mcp", async (req, res) => {
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(PORT, () => console.log(`demo-mcp (${MODE}) listening on :${PORT}`));