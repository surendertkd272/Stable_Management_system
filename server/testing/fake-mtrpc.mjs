// In-process imitation of the demo unit's JSON-RPC API (/mtrpc), for tests.
// Built from the camera's own web app; replies to the login challenge match the
// real unit byte-for-byte in shape. The rest is our best reading until it is
// checked against the unit (see server/mtrpc.mjs TODO(verify)).
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");

export async function startFakeMtrpc({ username = "admin", password = "pw", realm = "A9FNF" } = {}) {
  const st = {
    username, password, realm,
    challenges: new Map(),        // pre-login session_id -> nonce
    sessions: new Set(), logins: 0, failedLogins: 0,
    config: {
      "Thermal.thermometry_rule_all": { thermometry_rules: [
        { enable: true, type: "kPoint", name: "vendor-default", points: [{ x: 4096, y: 4096 }] },
        { enable: false, type: "kRectangle", name: "", points: [] },
      ] },
      "Thermal.thermal_global_config": { emissivity: 0.95, target_distance: 2 },
    },
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (obj) => { const b = JSON.stringify(obj); res.writeHead(200, { "Content-Type": "application/json" }); res.end(b); };
      if (req.url !== "/mtrpc" || req.method !== "POST") { res.writeHead(404); return res.end(); }
      const { id, method, params = {} } = JSON.parse(raw || "{}");
      const ok = (result) => send({ id, jsonrpc: "2.0", result });
      const err = (code, message) => send({ id, jsonrpc: "2.0", error: { code, message } });
      if (method === "Auth.LoginChallenge") {
        const sid = randomUUID(), nonce = randomUUID();
        st.challenges.set(sid, nonce);
        return ok({ data: { digest: { nonce, qop: "auth", realm: st.realm } }, session_id: sid });
      }
      if (method === "Auth.Login") {
        const nonce = st.challenges.get(params.session_id);
        const d = params.data?.digest || {};
        const want = md5(`${md5(`${st.username}:${st.realm}:${st.password}`)}:${nonce}:${d.nc}:${d.cnonce}:${d.qop}:${md5("POST:/mtrpc")}`);
        st.challenges.delete(params.session_id);
        if (!nonce || d.nonce !== nonce || params.data?.username !== st.username || d.response !== want) {
          st.failedLogins++;
          return err(-100105, "username or password error! ");
        }
        const sid = randomUUID();
        st.sessions.add(sid); st.logins++;
        return ok({ data: { session_id: sid, heartbeat_interval: 30 } });
      }
      if (!st.sessions.has(params.session_id)) return err(-100101, "invalid session_id! ");
      if (method === "Auth.Heartbeat") return ok({});
      if (method === "Auth.Logout") { st.sessions.delete(params.session_id); return ok({}); }
      if (method === "Config.GetConfig") {
        if (!(params.name in st.config)) return err(-100200, "unknown config");
        return ok({ data: structuredClone(st.config[params.name]) });
      }
      if (method === "Config.SetConfig") {
        st.config[params.name] = structuredClone(params.data);
        return ok({});
      }
      return err(-100100, `unknown method ${method}`);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { st, port: server.address().port, expireSessions: () => st.sessions.clear(), close: () => new Promise((r) => server.close(r)) };
}
