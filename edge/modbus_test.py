#!/usr/bin/env python3
"""The edge agent's Modbus decoding must match the server's (server/modbus.mjs):
the Hardware page's "test read" is only trustworthy if the edge box decodes the
same registers the same way. Runs 2000 random vectors through both.

Run:  python3 edge/modbus_test.py
"""
import json
import math
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from edge_agent import modbus_decode, ModbusWorker   # noqa: E402

fails = []
def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'' if cond else '  <- ' + detail}")
    if not cond:
        fails.append(name)

print("\nfixed vectors")
check("float32 37.6 high-first", abs(modbus_decode([0x4216, 0x6666], "float32") - 37.6) < 1e-5)
check("float32 37.6 low-first", abs(modbus_decode([0x6666, 0x4216], "float32", "low-first") - 37.6) < 1e-5)
check("int16 -2", modbus_decode([0xFFFE], "int16") == -2)
check("uint16 65534", modbus_decode([0xFFFE], "uint16") == 65534)
check("uint32 65538", modbus_decode([1, 2], "uint32") == 65538)
check("int32 -2", modbus_decode([0xFFFF, 0xFFFE], "int32") == -2)

print("\nPython and JavaScript agree on 2000 random vectors")
random.seed(5)
vecs = []
for _ in range(2000):
    typ = random.choice(["uint16", "int16", "uint32", "int32", "float32"])
    vecs.append({"regs": [random.randrange(65536), random.randrange(65536)], "type": typ,
                 "order": random.choice(["high-first", "low-first"])})
js = ("import('./server/modbus.mjs').then(m => { const v = JSON.parse(require('fs').readFileSync(0,'utf8'));"
      " console.log(JSON.stringify(v.map(x => { const r = m.decode(x.regs, x.type, x.order);"
      " return Number.isNaN(r) ? 'NaN' : r; }))); })")
out = subprocess.run(["node", "-e", js], input=json.dumps(vecs), capture_output=True, text=True,
                     cwd=HERE.parent, timeout=60)
if out.returncode != 0:
    check("node decoder ran", False, out.stderr[-300:])
else:
    theirs = json.loads(out.stdout)
    bad = []
    for v, j in zip(vecs, theirs):
        mine = modbus_decode(v["regs"], v["type"], v["order"])
        if isinstance(mine, float) and math.isnan(mine):
            same = j == "NaN"
        elif v["type"] == "float32":
            same = j != "NaN" and (mine == j or (math.isinf(mine) and math.isinf(j)) or abs(mine - j) <= abs(mine) * 1e-6)
        else:
            same = mine == j
        if not same:
            bad.append((v, mine, j))
    check("2000/2000 identical", not bad, f"{len(bad)} differ, e.g. {bad[:2]}")

print("\ncounter registers report intake, not the running total")
readings = []
w = ModbusWorker({"id": "m1", "name": "meter", "kind": "modbus_sensor", "host": "x",
                  "registers": [{"name": "total", "address": 0, "type": "uint32", "metric": "water_ml",
                                 "mode": "counter", "scale": 1, "offset": 0}], "pollSeconds": 0},
                 lambda rs: readings.extend(rs))
seq = iter([[0, 1000], [0, 1250], [0, 1250], [0, 40], [0, 90]])   # 1000 -> 1250 -> same -> RESET -> 90
import edge_agent  # noqa: E402
edge_agent.modbus_read = lambda *a, **k: next(seq)
for _ in range(5):
    w.run_once()
vals = [r["value"] for r in readings]
check("first poll only sets the baseline", len(vals) == 3, f"got {vals}")
check("increase is reported as intake (250 ml, then 0)", vals[:2] == [250, 0], f"got {vals}")
check("a meter reset never reports negative intake", all(v >= 0 for v in vals) and vals[2] == 50, f"got {vals}")

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}\n")
sys.exit(1 if fails else 0)
