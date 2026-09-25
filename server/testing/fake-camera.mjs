// In-process fake of the camera's ISAPI surface, for tests. Behaves like
// firmware in the ways that break clients: a hard cap on concurrent sessions,
// sessions the device can expire, dropped connections, a changeable serial,
// and oversized replies.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const md5 = (s) => createHash("md5").update(s).digest("hex");

export async function startFakeCamera({ serial = "SN-A", password = "pw", maxSessions = 3 } = {}) {
  const st = {
    serial, password, maxSessions,
    sessions: new Set(), logins: 0, logouts: 0,
    inflight: 0, maxInflight: 0, dropNext: 0, hugeSnapshot: false, slowMs: 0,
    rois: new Map(), basic: { FPara100: 97, AimDistance: 200 },
  };
  const send = (res, code, obj, type = "application/json") => {
    const body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { "Content-Type": type, "Content-Length": body.length });
    res.end(body);
  };
  const server = http.createServer((req, res) => {
    if (st.dropNext > 0) { st.dropNext--; req.socket.destroy(); return; }
    st.inflight++; st.maxInflight = Math.max(st.maxInflight, st.inflight);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        if (st.slowMs) await new Promise((r) => setTimeout(r, st.slowMs));
        const url = new URL(req.url, "http://x"), p = url.pathname;
        const body = raw ? JSON.parse(raw) : {};
        if (p === "/ISAPI/Security/User/Login") {
          const cr = body.Realm || "";
          const ok = body.Name === md5(`admin:${cr}`) &&
            body.Password === md5(`${md5(`admin:Server Status:${st.password}`)}:${cr}`);
          if (!ok) return send(res, 401, { Result: "Failed", Msg: "bad credentials" });
          if (st.sessions.size >= st.maxSessions) return send(res, 401, { Result: "Failed", Msg: "too many sessions" });
          const sid = randomBytes(8).toString("hex");
          st.sessions.add(sid); st.logins++;
          return send(res, 200, { SessionID: sid });
        }
        if (!st.sessions.has(req.headers.sessionid)) {
          res.setHeader("WWW-Authenticate", 'Basic realm="Server Status"');
          return send(res, 401, { Result: "Failed", Code: 401 });
        }
        if (p === "/ISAPI/Security/User/Logout") { st.sessions.delete(req.headers.sessionid); st.logouts++; return send(res, 200, { Result: "OK" }); }
        if (p === "/ISAPI/System/Capability/DeviceInfo") return send(res, 200, { Model: "SC-IT6420-HB", DeviceSN: st.serial, FWVersion: "V2.0" });
        if (p === "/ISAPI/System/Capability/CSCI") return send(res, 200, { WithCCD: "Yes", WithMetaRaw: "Yes", WithBlackBody: "No" });
        if (p === "/ISAPI/Thermometry/BasicParam")
          return req.method === "PUT" ? (Object.assign(st.basic, body), send(res, 200, { Result: "OK" })) : send(res, 200, st.basic);
        if (p === "/ISAPI/Thermometry/Query") {
          const list = [...st.rois.values()].map((r) => r.Type === "Point"
            ? { Id: r.Id, Type: "Point", PointTemp: { Value: 3760, RatX: r.Point.RatX, RatY: r.Point.RatY } }
            : { Id: r.Id, Type: r.Type, MaxTemp: { Value: 3680 }, MinTemp: { Value: 3120 }, AvgTemp: { Value: 3640 } });
          return send(res, 200, { ThermometryList: list });
        }
        const kind = p.match(/^\/ISAPI\/Thermometry\/(Point|Area)$/)?.[1];
        if (kind && req.method === "PUT") {
          for (const it of body.ThermometryList || []) st.rois.set(`${kind}:${it.Id}`, it);
          return send(res, 200, { Result: "OK" });
        }
        if (kind) return send(res, 200, { ThermometryList: [...st.rois.values()].filter((r) => r.Type === kind) });
        if (p === "/ISAPI/Snapshot/JPG") {
          if (st.hugeSnapshot) {
            res.writeHead(200, { "Content-Type": "image/jpeg" });
            const chunk = Buffer.alloc(1024 * 1024);
            for (let i = 0; i < 40 && !res.destroyed; i++) res.write(chunk);
            return res.end();
          }
          return send(res, 200, Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");
        }
        return send(res, 404, { Result: "Failed" });
      } finally {
        st.inflight--;
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    st, port: server.address().port,
    expireSessions: () => st.sessions.clear(),
    close: () => new Promise((r) => server.close(r)),
  };
}
