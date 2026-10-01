// Load readings from a JSON-lines file (edge/replay.py --out) into an EquiCare
// data folder through the server's own ingest — the same checks, horse
// attribution and de-duplication as POST /ingest/readings — without a server
// running. For analysing a recorded night while the demo is stopped, or for
// trying a replay on a copy of the data first.
//
//   EQUICARE_DATA_DIR=~/EquiCare-demo/data node tools/ingest_readings.mjs \
//       --token-file ~/EquiCare-demo/edge-token readings.jsonl
//
// Stop the demo first: two writers to one state.json lose each other's work.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const tokenFile = opt("--token-file");
const file = args[0];
if (!file || !tokenFile || !process.env.EQUICARE_DATA_DIR) {
  console.error("usage: EQUICARE_DATA_DIR=<data folder> node tools/ingest_readings.mjs --token-file <edge token> <readings.jsonl>");
  process.exit(2);
}
const token = readFileSync(tokenFile.replace(/^~/, process.env.HOME), "utf8").trim();
const readings = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { handle } = await import("../server/app.mjs");

let accepted = 0, duplicates = 0, dropped = 0;
for (let i = 0; i < readings.length; i += 500) {
  const res = await handle(new Request("http://localhost/ingest/readings", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ readings: readings.slice(i, i + 500) }),
  }));
  const body = await res.json();
  if (res.status >= 300) { console.error(`batch ${i / 500 + 1}: HTTP ${res.status}`, body); process.exit(1); }
  accepted += body.accepted || 0; duplicates += body.duplicates || 0; dropped += body.dropped || 0;
}
console.log(`${readings.length} readings: ${accepted} stored, ${duplicates} already there` + (dropped ? `, ${dropped} refused` : ""));
await new Promise((r) => setTimeout(r, 3000));        // the store writes its file on a short timer
process.exit(0);
