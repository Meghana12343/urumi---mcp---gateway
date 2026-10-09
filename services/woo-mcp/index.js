import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const WC_URL = process.env.WC_URL || "http://wordpress";
const auth =
  "Basic " +
  Buffer.from(
    `${process.env.WC_CONSUMER_KEY}:${process.env.WC_CONSUMER_SECRET}`,
  ).toString("base64");

async function wc(path, { method = "GET", query = {}, body } = {}) {
  const url = new URL(`${WC_URL}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "X-Forwarded-Proto": "https",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`WooCommerce ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const out = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const slimOrder = (o) => ({
  id: o.id,
  status: o.status,
  total: o.total,
  currency: o.currency,
  date_created: o.date_created,
  customer:
    `${o.billing?.first_name ?? ""} ${o.billing?.last_name ?? ""}`.trim(),
  items: (o.line_items || []).map((i) => `${i.quantity} x ${i.name}`),
});

function buildServer() {
  const server = new McpServer({ name: "woo-mcp", version: "1.0.0" });

  server.registerTool(
    "list_products",
    {
      description:
        "List products in the store, optionally filtered by search text.",
      inputSchema: {
        search: z.string().optional(),
        per_page: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ search, per_page }) => {
      const p = await wc("products", {
        query: { search, per_page: per_page ?? 20 },
      });
      return out(
        p.map((x) => ({
          id: x.id,
          name: x.name,
          price: x.price,
          status: x.status,
          stock_status: x.stock_status,
        })),
      );
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a new product with a name and a price.",
      inputSchema: {
        name: z.string().min(1),
        regular_price: z.string().describe("Price as a string, e.g. '499'"),
        description: z.string().optional(),
      },
    },
    async ({ name, regular_price, description }) => {
      const p = await wc("products", {
        method: "POST",
        body: {
          name,
          regular_price,
          description,
          status: "publish",
          type: "simple",
        },
      });
      return out({ id: p.id, name: p.name, price: p.price, url: p.permalink });
    },
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List orders. Use 'after' (ISO date like 2026-10-09T00:00:00) to get orders since that time.",
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe("e.g. processing, completed, any"),
        after: z.string().optional(),
        per_page: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ status, after, per_page }) => {
      const o = await wc("orders", {
        query: { status, after, per_page: per_page ?? 20 },
      });
      return out(o.map(slimOrder));
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get full details of one order by its ID.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => out(await wc(`orders/${id}`)),
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Change the status of an order.",
      inputSchema: {
        id: z.number().int(),
        status: z.enum([
          "pending",
          "processing",
          "on-hold",
          "completed",
          "cancelled",
          "refunded",
        ]),
      },
    },
    async ({ id, status }) => {
      const o = await wc(`orders/${id}`, { method: "PUT", body: { status } });
      return out(slimOrder(o));
    },
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.send("ok"));

app.post("/mcp", async (req, res) => {
  const server = buildServer();
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
  res
    .status(405)
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
);

app.listen(3000, () => console.log("woo-mcp listening on :3000"));
