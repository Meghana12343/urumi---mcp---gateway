# System design and tradeoffs

## Architecture choices

- **k3d locally, k3s on a VPS:** both are k3s, so the same Helm charts work; only values differ.
- **Helm only:** one chart per component (`store`, `woo-mcp`, `demo-mcp`, `gateway`, `dashboard`); secrets live in Kubernetes Secrets and are never in the repo.
- **Namespaces:** `store` (WordPress, MySQL, woo-mcp), `mcp` (demo servers), `platform` (gateway, dashboard). Only the Ingress is public.
- **WooCommerce MCP server talks to the store through the WooCommerce REST API** (consumer key/secret from a Secret). REST is the supported interface, needs no extra WordPress plugin, and works over the in-cluster Service; WP-CLI would require exec access into the WordPress pod.
- **Gateway in Node.js with SQLite on a PVC:** simple, no extra database workload. Tradeoff: one replica only.
- **Stateless MCP:** every request gets a fresh server/transport, so no session affinity is needed and a restart loses nothing.

## Tool aggregation, routing and failure handling

- **Listing:** the gateway reads all enabled servers from the database and calls `tools/list` on each in parallel (`Promise.allSettled`). A failing server is skipped, so one dead upstream never breaks the list.
- **Name collisions:** every tool is exposed as `<server>__<tool>` (for example `notes__ping` and `utils__ping`). The prefix is the routing key: a call is split at the first `__` and sent to that server.
- **Calls:** one upstream connection per call with an overall timeout (default 8 s). On timeout or error the client gets `Upstream 'x' failed: ...` as a tool error; other servers are unaffected.
- **Dead upstream:** the dashboard shows Connected / Unreachable / Disabled with the reason; Kubernetes restarts the pod and the status recovers.
- **Auth:** API keys are random 24-byte values, stored as SHA-256 hashes, revocable. The chat agent calls the gateway with a 2-minute signed token for the logged-in user, so its calls are audited under that user.
- **Audit log:** every tool call records user, server, tool, time, duration and outcome. Admins see all rows; members see their own.

## What changes for production

| Item          | Local                   | VPS                                      |
| ------------- | ----------------------- | ---------------------------------------- |
| Domain        | `*.localhost`           | real DNS names (`values-prod.yaml`)      |
| Ingress       | Traefik on k3d port 80  | Traefik on k3s; add cert-manager for TLS |
| Storage class | `local-path`            | `local-path` or a cloud class            |
| Images        | `k3d image import`      | pushed to a registry                     |
| Secrets       | `kubectl create secret` | same, or an external secret manager      |

## Known limits (honest list)

- Upstream credentials are stored in SQLite **without encryption at rest**.
- One gateway replica (SQLite); no rate limits.
- No per-tool permissions: any member can call any enabled tool, including `create_product` and `update_order_status`.
- No SSRF filtering when an admin adds a server URL.
- The prod values are written but not tested on a real VPS.
