// In-process imitation of the demo unit's JSON-RPC API (/mtrpc), for tests.
// Built from the camera's own web app; replies to the login challenge match the
// real unit byte-for-byte in shape. The rest is our best reading until it is
// checked against the unit (see server/mtrpc.mjs TODO(verify)).
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");
// The blocks the web app puts on every rule (and the firmware requires).
const FULL = () => ({
  local_setting: { enable: false, target_radiation_coefficient: 0.95, target_distance: 2, target_reflection_temperature: 25 },
  alarm_output: { enable: true, output_result: "kAverageTemperature", alarm_condition: "kBelow", alarm_threshold_temperature: 20, temperature_error: 0.1, temperature_duration: 30 },
});

// snapshot(channel) may return a JPEG Buffer to serve real pictures (channel 0
// colour, 1 thermal); without it a tiny placeholder JPEG is served.
export async function startFakeMtrpc({ username = "admin", password = "pw", realm = "A9FNF", snapshot = null } = {}) {
  const st = {
    username, password, realm,
    challenges: new Map(),        // pre-login session_id -> nonce
    sessions: new Set(), logins: 0, failedLogins: 0,
    config: {
      "Thermal.thermometry_rule_all": { thermometry_rules: [
        { enable: true, type: "kPoint", name: "vendor-default", rule_id: 0, points: [{ x: 4096, y: 4096 }], ...FULL() },
        { enable: false, type: "kRectangle", name: "", rule_id: 1, points: [], ...FULL() },
      ] },
      "Thermal.thermal_global_config": { measurement_mode: "kBodySurface", target_radiation_coefficient: 0.95, target_distance: 1 },
      "NetWork.net_interface_list": { iface: [{ ifname: "eth0", mac: "18:74:E2:DC:D5:D0", ipv4: { ipaddr: "192.168.0.10" } }] },
    },
    // Pixel temperatures in camera coordinates (0–8191): a hot eye spot on a
    // cooler head. breathingBpm > 0 makes the nostril region oscillate.
    eye: { x: 2700, y: 2700, r: 120, c: 37.5 }, nostril: { x0: 4000, y0: 5000, x1: 5000, y1: 5800 },
    breathingBpm: 0, background: 30,
  };
  const pixel = (x, y) => {
    if (x === 8192 || y === 8192) return "0.00";                 // the unit's sentinels
    if (x > 8192 || y > 8192 || x < 0 || y < 0) return "-1.00";
    const e = st.eye, n = st.nostril;
    if ((x - e.x) ** 2 + (y - e.y) ** 2 <= e.r ** 2) return e.c.toFixed(2);
    if (x >= n.x0 && x <= n.x1 && y >= n.y0 && y <= n.y1) {
      const breath = st.breathingBpm ? 0.6 * Math.sin((2 * Math.PI * st.breathingBpm * Date.now()) / 60000) : 0;
      return (34 + breath).toFixed(2);
    }
    return st.background.toFixed(2);
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (obj) => { const b = JSON.stringify(obj); res.writeHead(200, { "Content-Type": "application/json" }); res.end(b); };
      if (req.url.startsWith("/download_file?snapshot") && req.method === "GET") {
        const q = new URL(req.url, "http://x").searchParams;
        if (!st.sessions.has(q.get("session_id"))) { res.writeHead(401); return res.end(); }
        const jpeg = snapshot?.(Number(q.get("channel")) || 0) ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, Number(q.get("channel")) || 0, 0xff, 0xd9]);
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        return res.end(jpeg);
      }
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
      if (method === "Control.GetSystemInfo")
        return ok({ data: { hardware_version: "TPC-B3404-ILP", software_version: "V0.4.5_10.2.42", serial_number: "0000000000",
          thermal_lens: "25mm", video_source: ["CHN_SOURCE_CAMARE", "CHN_SOURCE_THERMAL"] } });
      if (method === "Control.GetPointTemperature") {
        st.pointReads = (st.pointReads || 0) + 1;
        return ok({ data: { temp_unit: "°C", temperature: pixel(params.data?.x, params.data?.y) } });
      }
      if (method === "Auth.Logout") { st.sessions.delete(params.session_id); return ok({}); }
      if (method === "Config.GetConfig") {
        if (!(params.name in st.config)) return err(-100200, "unknown config");
        return ok({ data: structuredClone(st.config[params.name]) });
      }
      if (method === "Config.SetConfig") {
        // Like the real firmware: a malformed rule drops the connection
        // instead of returning an error.
        if (params.name === "Thermal.thermometry_rule_all" &&
            (params.data?.thermometry_rules || []).some((r) => !r.local_setting || !r.alarm_output || !Array.isArray(r.points) ||
              !Number.isInteger(r.rule_id) || r.rule_id < 0 || r.rule_id > 11)) {
          st.crashes = (st.crashes || 0) + 1;
          return req.socket.destroy();
        }
        st.config[params.name] = structuredClone(params.data);
        return ok({});
      }
      return err(-100100, `unknown method ${method}`);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { st, port: server.address().port, expireSessions: () => st.sessions.clear(), close: () => new Promise((r) => server.close(r)) };
}
