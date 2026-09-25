#!/usr/bin/env node
// Read-only probe of a camera that speaks the JSON-RPC (/mtrpc) protocol — the
// Sparsh demo unit. Logs in ONCE (a wrong password counts towards the camera's
// lockout, so there is no retry), reads what the driver still needs confirmed,
// listens to live rule temperatures for a few seconds, logs out. Writes
// nothing to the camera.
//
//   node tools/mtrpc_probe.mjs <host> <username> [--port 80] [--seconds 8] [--out file.json]
//   (the password is asked for, or taken from CAMERA_PASSWORD)
//
// <host> may be an IPv6 link-local address with its interface, as the camera
// is on a direct cable: fe80::1a74:e2ff:fedc:d5d0%en8
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { MtrpcClient } from "../server/mtrpc.mjs";

const [host, username = "admin", ...rest] = process.argv.slice(2);
if (!host) {
  console.error("usage: node tools/mtrpc_probe.mjs <host> <username> [--seconds 8] [--out file.json]");
  process.exit(2);
}
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const seconds = Number(opt("--seconds", 8));
const out = opt("--out", null);
const port = Number(opt("--port", 80));

async function askPassword() {
  if (process.env.CAMERA_PASSWORD) return process.env.CAMERA_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes("password")) process.stdout.write(s); };   // don't echo
  const pw = await new Promise((r) => rl.question("camera password: ", r));
  rl.close();
  process.stdout.write("\n");
  return pw;
}

const report = { host, at: new Date().toISOString() };
const c = new MtrpcClient({ host, httpPort: port, username, password: await askPassword() });
const login = await c.login();
report.login = login;
if (!login.ok) {
  console.error(`login failed: ${login.error}`);
  console.error("Not retrying — the camera counts failed logins. Check the password with Sparsh.");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(`logged in (${login.method})`);

const read = async (label, method, params) => {
  try {
    const r = await c.call(method, params);
    report[label] = r;
    console.log(`\n== ${label}\n${JSON.stringify(r, null, 1).slice(0, 2500)}`);
  } catch (e) {
    report[label] = { error: e.message };
    console.log(`\n== ${label}: ${e.message}`);
  }
};

await read("systemInfo", "Control.GetSystemInfo", { data: {} });
await read("systemTime", "Control.GetSystemTime", { data: {} });
await read("thermalCaps", "Capability.GetThermalAllCaps", { data: {} });
await read("network", "Config.GetConfig", { name: "NetWork.net_interface_list" });
await read("thermalGlobal", "Config.GetConfig", { name: "Thermal.thermal_global_config" });
await read("rules", "Config.GetConfig", { name: "Thermal.thermometry_rule_all" });
await read("temperatureInfo", "Control.GetTemperatureInfo", { data: {} });
await read("pointTemperatureCentre", "Control.GetPointTemperature", { data: { x: 4096, y: 4096 } });

// Live rule temperatures arrive over a WebSocket; capture a few messages to
// learn their shape.
report.ruleTemperatureEvents = [];
if (typeof WebSocket === "function") {
  const wsHost = host.includes(":") && !host.startsWith("[") ? `[${host.replace("%", "%25")}]` : host;
  await new Promise((resolve) => {
    let ws;
    const done = () => { try { ws?.close(); } catch { /* closing */ } resolve(); };
    try {
      ws = new WebSocket(`ws://${wsHost}${port === 80 ? "" : `:${port}`}/mtrpcoverwebsocket`);
    } catch (e) {
      report.ruleTemperatureEvents.push({ error: e.message });
      return resolve();
    }
    ws.onopen = () => ws.send(JSON.stringify({
      id: "probe", jsonrpc: "2.0", method: "Thermal.Attach",
      params: { data: { channel: 0, thermal_type: ["RuleTemperature"] }, session_id: c.sessionId },
    }));
    ws.onmessage = async (m) => {
      const text = typeof m.data === "string" ? m.data : Buffer.from(await m.data.arrayBuffer()).toString("utf8");
      if (report.ruleTemperatureEvents.length < 5) report.ruleTemperatureEvents.push(text.slice(0, 3000));
    };
    ws.onerror = (e) => { report.ruleTemperatureEvents.push({ error: String(e?.message || "websocket error") }); };
    setTimeout(done, seconds * 1000);
  });
  console.log(`\n== ruleTemperatureEvents (${seconds} s)\n${JSON.stringify(report.ruleTemperatureEvents, null, 1).slice(0, 3000)}`);
} else {
  console.log("\n(no WebSocket in this Node — skipping live temperatures; needs Node 22+)");
}

await c.logout();
if (out) {
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nfull report written to ${out}`);
}
