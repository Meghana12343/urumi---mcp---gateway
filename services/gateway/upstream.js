import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000);

function race(promise, ms, label) {
  let timer;
  const t = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export async function withClient(server, fn) {
  const headers = {};
  if (server.auth_header && server.auth_value)
    headers[server.auth_header] = server.auth_value;
  const client = new Client({ name: "mcp-gateway", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
  try {
    return await race(
      (async () => {
        await client.connect(transport);
        return fn(client);
      })(),
      TIMEOUT,
      `upstream '${server.name}'`,
    );
  } finally {
    client.close().catch(() => {});
  }
}
