# MCP Gateway on Kubernetes (WooCommerce)

A team MCP gateway running on Kubernetes. An admin registers MCP servers once; every team
member uses all of them through one MCP endpoint and through a chat agent in the dashboard.
The first data source is a WooCommerce store, exposed by an MCP server written from scratch.

## Architecture

```
Browser / MCP client  ->  http://dashboard.localhost   (Traefik Ingress)
                              |
                          dashboard  (nginx: React app, proxies /api and /mcp)
                              |
                          gateway    (Node.js: admin API, chat agent, MCP endpoint)   [ns: platform]
                              |  Streamable HTTP over cluster DNS
          +-------------------+--------------------+
          |                   |                    |
       woo-mcp           demo-notes            demo-utils
          |               [ns: mcp]             [ns: mcp]
   WordPress/WooCommerce REST -> MySQL
          [ns: store]
```

| Component            | What it does                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `charts/store`       | WordPress + MySQL, persistent volumes, Ingress at `store.localhost`                                              |
| `services/woo-mcp`   | MCP server: list/create products, list/get orders, update order status (WooCommerce REST API)                    |
| `services/demo-mcp`  | Small MCP server, run twice (`notes`, `utils`) as the 2nd and 3rd upstream                                       |
| `services/gateway`   | MCP client to every upstream, MCP server to users; users, roles, hashed API keys, audit log, chat agent (Gemini) |
| `services/dashboard` | React dashboard (servers, users, keys, audit, chat) served by nginx                                              |

## Prerequisites

Docker Desktop, `kubectl`, `helm`, `k3d`. Windows PowerShell commands are shown.

## Local setup

**1. Cluster**

```
k3d cluster create urumi -p "80:80@loadbalancer" --agents 1
```

Local domains: `store.localhost` and `dashboard.localhost` resolve to 127.0.0.1 in Chrome/Edge, and
k3d maps port 80 to Traefik, so no hosts-file edit is needed.

**2. Build and load images**

```
docker build -t woo-mcp:0.1.0   services/woo-mcp
docker build -t demo-mcp:0.1.0  services/demo-mcp
docker build -t gateway:0.2.0   services/gateway
docker build -t dashboard:0.1.0 services/dashboard
k3d image import woo-mcp:0.1.0 demo-mcp:0.1.0 gateway:0.2.0 dashboard:0.1.0 -c urumi
```

**3. Store (WordPress + MySQL)**

```
kubectl create namespace store
kubectl -n store create secret generic store-secrets --from-literal=mysql-root-password=<pw1> --from-literal=mysql-password=<pw2>
helm install store charts/store -n store -f charts/store/values-local.yaml
```

Open `http://store.localhost`, finish the WordPress install, install and activate WooCommerce,
skip the wizard, enable **Cash on delivery** (WooCommerce > Settings > Payments), set permalinks to
"Post name", then create REST API keys (WooCommerce > Settings > Advanced > REST API, Read/Write).

**4. WooCommerce MCP server**

```
kubectl -n store create secret generic woo-api-keys --from-literal=consumer-key=<ck_...> --from-literal=consumer-secret=<cs_...>
helm install woo-mcp charts/woo-mcp -n store
```

**5. Demo MCP servers**

```
helm install demo-notes charts/demo-mcp -n mcp --create-namespace --set mode=notes
helm install demo-utils charts/demo-mcp -n mcp --set mode=utils
```

**6. Gateway and dashboard**

```
kubectl create namespace platform
$k = Read-Host "Paste Gemini key"
$s = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
kubectl -n platform create secret generic gateway-secrets --from-literal=jwt-secret=$s --from-literal=gemini-api-key=$k
helm install gateway   charts/gateway   -n platform
helm install dashboard charts/dashboard -n platform
kubectl -n platform exec deploy/gateway -- node seed.js admin@example.com <admin-password> http://woo-mcp.store.svc.cluster.local:3000/mcp
```

Log in at `http://dashboard.localhost`, open **servers**, and add:

- `notes`: `http://demo-notes.mcp.svc.cluster.local:3000/mcp`
- `utils`: `http://demo-utils.mcp.svc.cluster.local:3000/mcp`

## How to use it

**Place an order:** open `http://store.localhost/shop`, add a product, check out with Cash on delivery.
The order appears in WooCommerce > Orders.

**Chat agent:** dashboard > **chat**, for example "What orders do we have?" or
"Create a product named Demo Mug priced 350". Each tool call is shown under the answer and recorded
in the audit log under the logged-in user.

**Invite a member:** dashboard > **users** > add user (role `member`). The member logs in, opens **keys**,
and generates their own API key (shown once, stored only as a SHA-256 hash).

**External MCP client** (Claude Code, Cursor, MCP Inspector): use only the gateway URL and your key.

```
claude mcp add --transport http gateway http://dashboard.localhost/mcp --header "Authorization: Bearer <your-key>"
```

Cursor: `{"mcpServers":{"gateway":{"url":"http://dashboard.localhost/mcp","headers":{"Authorization":"Bearer <your-key>"}}}}`

**Control:** revoke a key in **keys** (next call is rejected); disable a server in **servers** (its tools
disappear from chat and clients); delete an upstream pod and the others keep working while the dashboard
shows the dead one as Unreachable.

## Production-like VPS (k3s)

Same charts, different values. Each chart has a `values-prod.yaml` with the domain, storage class and
image repository. Steps: install k3s, point DNS (`store.`, `dashboard.` records) at the VPS, push the
images to a registry, create the same Secrets, then
`helm install <chart> charts/<chart> -n <ns> -f charts/<chart>/values-prod.yaml`.
Upgrades: `helm upgrade ...`; roll back with `helm rollback <release> <revision> -n <ns>`.
Status: the prod values are written but **not yet verified on a real VPS**. TLS (cert-manager) is not set up.

## Repository layout

`charts/` Helm charts, `services/` source code, `docs/` design note and threat model.

## Documents

- [System design and tradeoffs](docs/design-and-tradeoffs.md)
- [Threat model](docs/threat-model.md)

## Bonus / stand-out items

Attempted: non-root containers, NetworkPolicies limiting access to the MCP servers to the gateway pod,
hashed API keys, roles (admin/member). Not attempted: multi-store provisioning, OAuth, tool permissions,
multi-replica gateway, observability.
