#!/usr/bin/env node
// Eval-unit check for the SERVER's camera client (server/camera.mjs) — the code
// the Hardware page uses. The Python smoke test covers the edge agent's driver;
// this covers the other implementation, which has its own Digest and HTTPS code.
// Called by `sparsh_camera_smoketest.py --eval`; prints one JSON object.
//
//   node tools/camera_check.mjs --host 192.168.1.102 --user admin --pass X [--port 80] [--https]
import { CameraClient } from "../server/camera.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const cfg = {
  host: args.host, httpPort: Number(args.port || (args.https ? 443 : 80)), https: Boolean(args.https),
  username: args.user || "admin", password: args.pass || "", timeoutMs: 6000,
};
const out = { transport: cfg.https ? "https" : "http" };

async function attempt(name, fn) {
  try { out[name] = { ok: true, ...(await fn()) }; }
  catch (e) { out[name] = { ok: false, error: e.message }; }
}

await attempt("sessionLogin", async () => {
  const c = new CameraClient(cfg);
  const r = await c.login();
  if (!r.ok) throw new Error(r.error);
  return { method: r.method, model: (await c.deviceInfo()).Model ?? null };
});

await attempt("digestLogin", async () => {
  const c = new CameraClient(cfg);
  const r = await c.login({ forceDigest: true });
  if (!r.ok) throw new Error(r.error);
  return { method: r.method, model: (await c.deviceInfo()).Model ?? null };
});

// Read-back through the same slots-9 test ROIs the Python check writes.
await attempt("readback", async () => {
  const c = new CameraClient(cfg);
  const r = await c.login();
  if (!r.ok) throw new Error(r.error);
  const points = await c.getJson("/ISAPI/Thermometry/Point?Dev=0&Idx=255");
  const areas = await c.getJson("/ISAPI/Thermometry/Area?Dev=0&Idx=255");
  const slots = [...(points.ThermometryList || []), ...(areas.ThermometryList || [])]
    .filter((it) => it.Enable !== "No").map((it) => `${it.Type}:${it.Id}`);
  return { slots: [...new Set(slots)].sort() };
});

console.log(JSON.stringify(out));
