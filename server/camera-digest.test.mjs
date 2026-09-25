// HTTP Digest fallback — MD5 and SHA-256. The vendor's API document (B22,
// §4.5.2) allows either; a client that only speaks MD5 is refused by firmware
// that challenges with SHA-256, and the Hardware page's connection test fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { CameraClient, parseDigestChallenge } from "./camera.mjs";

const HASH = { "MD5": "md5", "SHA-256": "sha256" };

/** A camera that refuses session login and speaks only Digest `algorithm`. */
function digestCamera(algorithm, password = "s3cret") {
  const nonces = new Set();
  const H = (s) => createHash(HASH[algorithm]).update(s).digest("hex");
  const srv = http.createServer((req, res) => {
    const a = req.headers.authorization || "";
    const f = Object.fromEntries([...a.matchAll(/(\w+)="?([^",]*)"?/g)].map((m) => [m[1], m[2]]));
    const ok = a.startsWith("Digest ") && nonces.has(f.nonce) && (f.algorithm || "MD5").toUpperCase() === algorithm &&
      f.response === H(`${H(`admin:Server Status:${password}`)}:${f.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${H(`${req.method}:${f.uri}`)}`);
    if (!ok) {
      const nonce = randomBytes(8).toString("hex");
      nonces.add(nonce);
      res.writeHead(401, { "WWW-Authenticate": `Digest realm="Server Status", nonce="${nonce}", qop="auth", algorithm=${algorithm}` });
      return res.end("{}");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ DeviceSN: `SN-${algorithm}` }));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port })));
}

for (const algorithm of ["MD5", "SHA-256"]) {
  test(`Digest ${algorithm}: logs in, reads, and refuses a wrong password`, async () => {
    const { srv, port } = await digestCamera(algorithm);
    try {
      const c = new CameraClient({ host: "127.0.0.1", httpPort: port, username: "admin", password: "s3cret" });
      const r = await c.login();
      assert.equal(r.ok, true, r.error);
      assert.match(r.method, /^digest/);
      assert.equal((await c.getJson("/ISAPI/System/Capability/DeviceInfo")).DeviceSN, `SN-${algorithm}`);
      const bad = new CameraClient({ host: "127.0.0.1", httpPort: port, username: "admin", password: "nope" });
      assert.equal((await bad.login()).ok, false);
    } finally {
      srv.close();
    }
  });
}

test("challenge parsing: prefers SHA-256 when several are offered, reads quoted lists", () => {
  const both = parseDigestChallenge(
    `Digest realm="R", nonce="a", qop="auth", algorithm=MD5, Digest realm="R", nonce="b", qop="auth", algorithm=SHA-256`);
  assert.equal(both.algorithm, "SHA-256");
  assert.equal(both.nonce, "b");
  assert.equal(parseDigestChallenge(`Digest realm="R", nonce="n", qop="auth-int,auth"`).qop, "auth");
  assert.equal(parseDigestChallenge(`Digest realm="R", nonce="n", algorithm="SHA256"`).algorithm, "SHA-256");
  assert.equal(parseDigestChallenge(`Basic realm="x"`), null);
});
