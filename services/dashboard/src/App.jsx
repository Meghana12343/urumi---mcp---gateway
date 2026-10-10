import { useEffect, useState, useCallback } from "react";

async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function useLoad(path, ms) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(
    () => api(path).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)),
    [path]
  );
  useEffect(() => {
    load();
    if (!ms) return;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [data, load, err];
}

const css = `
body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1c1e21}
header{background:#1f2937;color:#fff;padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
header button{background:none;border:0;color:#cbd5e1;cursor:pointer;font-size:15px;padding:6px 10px;border-radius:6px}
header button.on{background:#374151;color:#fff}
header .sp{flex:1}
main{max-width:1000px;margin:20px auto;padding:0 16px}
.card{background:#fff;border-radius:10px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px #0002;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
input,select{padding:7px;border:1px solid #cbd5e1;border-radius:6px;margin:0 6px 6px 0}
button.b{background:#2563eb;color:#fff;border:0;padding:7px 12px;border-radius:6px;cursor:pointer;margin:0 6px 6px 0}
button.d{background:#dc2626}
.ok{color:#15803d;font-weight:600}.bad{color:#b91c1c;font-weight:600}.off{color:#6b7280;font-weight:600}
.err{color:#b91c1c}.key{background:#fef9c3;padding:8px;border-radius:6px;word-break:break-all;font-family:monospace;margin:8px 0}
.login{max-width:340px;margin:80px auto}
small{color:#6b7280}
`;

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try { onLogin(await api("/login", "POST", { email, password })); }
    catch (x) { setErr(x.message); }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h2>MCP Gateway</h2>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} /><br />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><br />
      <button className="b" type="submit">Log in</button>
      <div className="err">{err}</div>
    </form>
  );
}

function Servers() {
  const [rows, load, err] = useLoad("/servers", 10000);
  const empty = { name: "", url: "", auth_header: "", auth_value: "" };
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState("");
  const run = async (fn) => {
    try { await fn(); setMsg(""); load(); } catch (e) { setMsg(e.message); }
  };
  const cls = { Connected: "ok", Unreachable: "bad", Disabled: "off" };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <div className="card">
        <b>Add MCP server</b><br /><br />
        <input placeholder="name" value={f.name} onChange={set("name")} />
        <input placeholder="http://host:3000/mcp" size="32" value={f.url} onChange={set("url")} />
        <input placeholder="header (e.g. Authorization)" value={f.auth_header} onChange={set("auth_header")} />
        <input placeholder="credential value" type="password" value={f.auth_value} onChange={set("auth_value")} />
        <button className="b" onClick={() => run(async () => { await api("/servers", "POST", f); setF(empty); })}>Add</button>
        <div className="err">{msg || err}</div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>URL</th><th>Status</th><th>Tools</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><small>{s.url}</small>{s.has_credential && <><br /><small>credential stored</small></>}</td>
                <td className={cls[s.status]}>{s.status}{s.error && <><br /><small>{s.error}</small></>}</td>
                <td><small>{s.tools.map((t) => t.name).join(", ")}</small></td>
                <td>
                  <button className="b" onClick={() => run(() => api("/servers/" + s.id, "PATCH", { enabled: !s.enabled }))}>{s.enabled ? "Disable" : "Enable"}</button>
                  <button className="b" onClick={() => { const u = prompt("New URL", s.url); if (u) run(() => api("/servers/" + s.id, "PATCH", { url: u })); }}>Edit</button>
                  <button className="b d" onClick={() => confirm("Remove " + s.name + "?") && run(() => api("/servers/" + s.id, "DELETE"))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Keys() {
  const [rows, load] = useLoad("/keys");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  return (
    <div>
      <div className="card">
        <input placeholder="label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="b" onClick={async () => { const r = await api("/keys", "POST", { label }); setKey(r.key); setLabel(""); load(); }}>Generate API key</button>
        {key && (
          <div>
            Copy it now. It is shown only once:
            <div className="key">{key}</div>
            <small>MCP endpoint for Claude Code / Cursor: {location.origin}/mcp (header: Authorization: Bearer your-key)</small>
          </div>
        )}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Key</th><th>Label</th><th>User</th><th>Created</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((k) => (
              <tr key={k.id}>
                <td>{k.prefix}...</td><td>{k.label}</td><td>{k.email}</td><td>{k.created_at}</td>
                <td className={k.revoked ? "bad" : "ok"}>{k.revoked ? "Revoked" : "Active"}</td>
                <td>{!k.revoked && <button className="b d" onClick={async () => { await api("/keys/" + k.id, "DELETE"); load(); }}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Users() {
  const [rows, load] = useLoad("/users");
  const [f, setF] = useState({ email: "", password: "", role: "member" });
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async (fn) => { try { await fn(); setMsg(""); load(); } catch (e) { setMsg(e.message); } };
  return (
    <div>
      <div className="card">
        <b>Invite team member</b><br /><br />
        <input placeholder="email" value={f.email} onChange={set("email")} />
        <input placeholder="temporary password (8+)" type="password" value={f.password} onChange={set("password")} />
        <select value={f.role} onChange={set("role")}><option>member</option><option>admin</option></select>
        <button className="b" onClick={() => run(async () => { await api("/users", "POST", f); setF({ email: "", password: "", role: "member" }); })}>Add user</button>
        <div className="err">{msg}</div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td><td>{u.role}</td><td>{u.created_at}</td>
                <td><button className="b d" onClick={() => confirm("Delete " + u.email + "?") && run(() => api("/users/" + u.id, "DELETE"))}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const [rows] = useLoad("/audit", 5000);
  return (
    <div className="card">
      <table>
        <thead><tr><th>Time (UTC)</th><th>User</th><th>Server</th><th>Tool</th><th>ms</th><th>Outcome</th></tr></thead>
        <tbody>
          {(rows || []).map((a, i) => (
            <tr key={i}>
              <td>{a.ts}</td><td>{a.email}</td><td>{a.server}</td><td>{a.tool}</td><td>{a.duration_ms}</td>
              <td className={a.outcome === "ok" ? "ok" : "bad"}>{a.outcome}{a.error && <><br /><small>{a.error}</small></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("keys");
  useEffect(() => { api("/me").then((u) => { setUser(u); setTab(u.role === "admin" ? "servers" : "keys"); }).catch(() => setUser(null)); }, []);
  if (user === undefined) return <p style={{ padding: 20 }}>Loading... (is the gateway port-forward running?)</p>;
  if (!user)
    return (<><style>{css}</style><Login onLogin={(u) => { setUser(u); setTab(u.role === "admin" ? "servers" : "keys"); }} /></>);
  const admin = user.role === "admin";
  const tabs = [...(admin ? ["servers", "users"] : []), "keys", "audit"];
  const view = { servers: <Servers />, users: <Users />, keys: <Keys />, audit: <Audit /> }[tab];
  return (
    <>
      <style>{css}</style>
      <header>
        <b>MCP Gateway</b>
        {tabs.map((t) => (<button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>))}
        <span className="sp" />
        <small style={{ color: "#cbd5e1" }}>{user.email} ({user.role})</small>
        <button onClick={async () => { await api("/logout", "POST"); setUser(null); }}>Log out</button>
      </header>
      <main>{view}</main>
    </>
  );
}