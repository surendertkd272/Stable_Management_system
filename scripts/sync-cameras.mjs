// Keep each saved camera's link-local address on the adapter port it is on
// now, and report devices on a cable that no saved camera matches. Run by
// scripts/demo.sh with the Mac's IPv6 neighbours, one "address mac interface"
// per line:
//   URL=… ADMIN_PW=… NB="fe80::…%en8 18:74:e2:… en8" WIFI_IF=en0 node scripts/sync-cameras.mjs
// A camera's link-local address comes from its MAC, so the same address with
// another zone (%en8 -> %en9) is the same camera on another port. A device no
// camera matches is only reported, never logged in to: the stable's network
// can hold other people's cameras of the same make.
const { URL: base, ADMIN_PW: pw, NB = "", WIFI_IF = "en0" } = process.env;
const say = (s) => console.log(`\x1b[1m[demo]\x1b[0m ${s}`);
const bare = (h) => String(h ?? "").replace(/%.*$/, "").toLowerCase();
const rows = NB.split("\n").map((l) => l.trim().split(/\s+/))
  .filter((r) => r.length >= 3 && r[0].toLowerCase().startsWith("fe80:"))
  .map(([addr, mac, ifc]) => ({ addr, mac, ifc }));
const onCable = (r) => /^en\d+$/.test(r.ifc) && r.ifc !== WIFI_IF;

const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: pw }) }).then((r) => r.json()).catch(() => ({}));
if (!login.token) {
  say("could not log in to the demo to check the cameras");
  process.exit(0);
}
const h = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
try {
  const cams = (await fetch(`${base}/api/devices`, { headers: h }).then((r) => r.json())).filter((d) => d.kind === "thermal_camera");
  const known = new Set();
  for (const c of cams) {
    const n = rows.find((r) => bare(r.addr) === bare(c.host));
    if (!n) continue;
    known.add(n.addr);
    if (n.addr === c.host) {
      say(`camera "${c.name}" found at ${n.addr}${c.enabled === false ? " (switched off on the Hardware page)" : ""}`);
      continue;
    }
    const r = await fetch(`${base}/api/devices/${c.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ host: n.addr }) });
    say(r.ok ? `camera "${c.name}" is now on ${n.ifc}: ${n.addr}` : `camera "${c.name}" is on ${n.ifc}, but its address could not be updated (HTTP ${r.status})`);
  }
  const strangers = rows.filter((r) => onCable(r) && !known.has(r.addr));
  for (const r of strangers)
    say(`a device on the cable at ${r.addr} (MAC ${r.mac}): if it is a new camera, add it on the Hardware page with this address`);
  if (!known.size && !strangers.length)
    say("no camera on any cable yet: check its power and the USB-Ethernet adapter (it is picked up when plugged in)");
} finally {
  await fetch(`${base}/auth/logout`, { method: "POST", headers: h }).catch(() => {});
}
