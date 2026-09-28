#!/usr/bin/env python3
"""The edge agent's Modbus decoding must match the server's (server/modbus.mjs):
the Hardware page's "test read" is only trustworthy if the edge box decodes the
same registers the same way. Runs 2000 random vectors through both.

Run:  python3 edge/modbus_test.py
"""
import json
import math
import random
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from edge_agent import modbus_decode, ModbusWorker   # noqa: E402

fails = []
def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'' if cond else '  <- ' + str(detail)}")
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

# --------------------------------------------------------------------------- #
from edge_agent import crc16, rtu_request, rtu_parse  # noqa: E402

print("\nModbus RTU framing and CRC (published vectors)")
for req, crc in (("01 03 00 00 00 0A", "C5 CD"), ("01 03 00 00 00 01", "84 0A"),
                 ("11 03 00 6B 00 03", "76 87"), ("01 04 00 00 00 01", "31 CA")):
    got = struct.pack("<H", crc16(bytes.fromhex(req))).hex(" ").upper()
    check(f"CRC of {req} = {crc} (low byte first)", got == crc, got)
check("read request frame 01 03 00 00 00 0A C5 CD", rtu_request(1, 3, 0, 10) == bytes.fromhex("01030000000AC5CD"),
      rtu_request(1, 3, 0, 10).hex(" "))
check("spec reply 11 03 06 AE41 5652 4340 49AD -> three registers",
      list(rtu_parse(bytes.fromhex("110306AE415652434049AD"), 0x11, 3, 3)) == [0xAE41, 0x5652, 0x4340])


def raises(fn, needle):
    try:
        fn()
    except Exception as e:                                  # noqa: BLE001
        return needle in str(e), str(e)
    return False, "no error"


def framed(hexbody):
    b = bytes.fromhex(hexbody)
    return b + struct.pack("<H", crc16(b))


ok, msg = raises(lambda: rtu_parse(bytes.fromhex("110306AE415652434049AE"), 0x11, 3, 3), "CRC")
check("a garbled reply is refused (CRC), with what to check", ok and "terminator" in msg, msg)
ok, msg = raises(lambda: rtu_parse(framed("018302"), 1, 3, 1), "illegal data address")
check("an exception reply says which (2 = illegal data address)", ok, msg)
ok, msg = raises(lambda: rtu_parse(framed("0203020064"), 1, 3, 1), "unit 2")
check("a reply from another unit is refused", ok, msg)


class FakeSerial:
    """A sensor on the RS-485 line, answering read requests from its registers."""

    def __init__(self, unit, regs, prefix=b"", silent=False):
        self.unit, self.regs, self.prefix, self.silent = unit, regs, prefix, silent
        self.rx, self.written, self.closed = b"", [], False

    def reset_input_buffer(self):
        self.rx = b""

    def write(self, data):
        self.written.append(bytes(data))
        unit, fn, addr, count = struct.unpack(">BBHH", data[:6])
        assert crc16(data[:6]) == struct.unpack("<H", data[6:8])[0]
        if self.silent or unit != self.unit:
            return
        body = bytes([unit, fn, 2 * count]) + b"".join(struct.pack(">H", self.regs.get(addr + i, 0)) for i in range(count))
        self.rx = self.prefix + body + struct.pack("<H", crc16(body))

    def read(self, n):
        out, self.rx = self.rx[:n], self.rx[n:]
        return out                                          # short / empty = the port's timeout

    def close(self):
        self.closed = True


print("\nModbus RTU through the worker, over a fake serial port")
opened = []
port = FakeSerial(7, {100: 0x4216, 101: 0x6666})         # 37.6 as float32
real_open_serial = edge_agent.open_serial
edge_agent.open_serial = lambda *a: (opened.append(a), port)[1]
rtu_dev = {"id": "r1", "name": "stall thermometer", "kind": "modbus_sensor", "transport": "rtu",
           "serialPort": "/dev/ttyFAKE0", "baud": 19200, "parity": "E", "stopBits": 1, "unitId": 7, "function": 3,
           "registers": [{"name": "temp", "address": 100, "type": "float32", "metric": "body_temp_c", "unit": "°C"}],
           "pollSeconds": 0}
readings = []
w = ModbusWorker(rtu_dev, lambda rs: readings.extend(rs))
w.run_once()
check("value read and decoded over RTU (37.6)", readings and abs(readings[0]["value"] - 37.6) < 1e-3, readings)
check("port opened with the portal's settings (19200 8E1)", opened and opened[0][:4] == ("/dev/ttyFAKE0", 19200, "E", 1), opened)
check("the request on the wire is unit 7, fn 3, address 100, 2 registers",
      port.written and port.written[0] == rtu_request(7, 3, 100, 2), port.written)

port.prefix = b"\x00"
readings.clear()
w.run_once()
check("a stray byte before the reply (line turn-round) is skipped", readings and abs(readings[0]["value"] - 37.6) < 1e-3)

port.silent = True
ok, msg = raises(w.run_once, "no reply from unit 7")
check("a silent sensor: an error naming the port and what to check", ok and "/dev/ttyFAKE0" in msg and "A/B" in msg, msg)
check("... and the port stays open (the adapter is fine)", not port.closed)
port.silent = False

other = dict(rtu_dev, id="r2", unitId=8, baud=9600)
ok, msg = raises(lambda: ModbusWorker(other, readings.append).run_once(), "same baud rate")
check("a second sensor on the same line with different settings is refused clearly", ok, msg)
same = dict(rtu_dev, id="r3", unitId=8)
check("sensors with the same settings share one line (one port, one lock)",
      edge_agent.rtu_bus_for(same) is edge_agent.rtu_bus_for(rtu_dev) and len(opened) == 1)
ok, msg = raises(lambda: ModbusWorker(dict(rtu_dev, id="r4", unitId=0), readings.append).run_once(), "broadcast")
check("unit id 0 (broadcast) is refused — nothing would ever reply", ok, msg)
w.stop()
edge_agent.rtu_bus_release("r3")
edge_agent.rtu_bus_release("r4")
check("the port is closed once no sensor uses it", port.closed and "/dev/ttyFAKE0" not in edge_agent._RTU_BUSES)

edge_agent.open_serial = real_open_serial
saved = sys.modules.get("serial")
sys.modules["serial"] = None                                # as if pyserial were not installed
try:
    ok, msg = raises(lambda: edge_agent.open_serial("/dev/ttyFAKE1", 9600, "N", 1, 1.0), "pip3 install pyserial")
finally:
    if saved is None:
        del sys.modules["serial"]
    else:
        sys.modules["serial"] = saved
check("without pyserial: a clear error, nothing else breaks", ok, msg)

# --------------------------------------------------------------------------- #
print("\nregister `use` -> intake events, through the worker")


class FakeRegs:
    """modbus_read stand-in: the current value at each address, encoded as its type."""

    def __init__(self, types):
        self.types, self.values, self.fail = types, {}, set()

    def __call__(self, host, port, unit, fn, addr, count, timeout=4.0):
        if addr in self.fail:
            raise IOError("no answer")
        v, typ = self.values[addr], self.types[addr]
        if typ == "float32":
            return struct.unpack(">HH", struct.pack(">f", v))
        if typ == "uint32":
            return [int(v) >> 16, int(v) & 0xFFFF]
        return [int(v) & 0xFFFF]


def worker(regs, types):
    out = []
    fake = FakeRegs(types)
    edge_agent.modbus_read = fake
    wk = ModbusWorker({"id": "s1", "name": "stall sensors", "kind": "modbus_sensor", "host": "x", "pollSeconds": 0,
                       "registers": regs}, lambda rs: out.extend(rs))
    wk.clock = lambda: wk.now
    wk.now = 1790000000.0                                   # 2026-09-21T14:13:20Z
    return wk, fake, out


def poll(wk, fake, addr, values, every):
    for v in values:
        fake.values[addr] = v
        try:
            wk.run_once()
        except RuntimeError:
            pass
        wk.now += every


wk, fake, out = worker([{"name": "meter", "address": 0, "type": "float32", "metric": "water_ml", "use": "flow",
                         "scale": 1, "offset": 0, "unit": "l"},
                        {"name": "room", "address": 5, "type": "int16", "metric": "body_temp_c", "scale": 0.1}],
                       {0: "float32", 5: "int16"})
fake.values[5] = 245
poll(wk, fake, 0, [10.0, 10.0, 10.6, 11.2, 11.2, 11.2, 11.2, 11.2, 11.2, 11.2, 11.2], 10)
bouts = [r for r in out if r["metric"] in ("water_visit", "water_ml")]
check("flow register -> one bout: water_visit + water_ml", [r["metric"] for r in bouts] == ["water_visit", "water_ml"], out)
if bouts:
    ml = bouts[1]
    check("litres scaled to ml (1.2 l -> 1200 ml)", abs(ml["value"] - 1200) <= 1, ml)
    check("source flow_meter, the device named, ISO time of the bout start",
          ml["source"] == "flow_meter" and ml["deviceId"] == "s1" and ml["ts"] == "2026-09-21T14:13:30Z", ml)
    check("meta {ml, durationS, boutId}", set(ml["meta"]) == {"ml", "durationS", "boutId"}, ml["meta"])
check("the raw meter total is not reported as a reading", not any(r["metric"] == "water_ml" and r.get("source") == "modbus" for r in out))
check("a register without `use` still reports its gauge value (source modbus)",
      any(r["metric"] == "body_temp_c" and r["source"] == "modbus" and abs(r["value"] - 24.5) < 1e-6 for r in out))

wk, fake, out = worker([{"name": "meter", "address": 0, "type": "uint32", "metric": "water_ml", "use": "flow", "unit": "ml"}],
                       {0: "uint32"})
poll(wk, fake, 0, [1000, 1700], 10)
fake.fail.add(0)
poll(wk, fake, 0, [1700] * 8, 10)                          # the meter stops answering
check("a failed read still closes a due bout", [r["value"] for r in out if r["metric"] == "water_ml"] == [700], out)

wk, fake, out = worker([{"name": "bucket", "address": 2, "type": "float32", "metric": "water_ml", "use": "bucket", "unit": "kg"}],
                       {2: "float32"})
poll(wk, fake, 2, [12.0] * 60 + [12.8 - 0.075 * i for i in range(20)] + [10.5] * 100, 2)
mls = [r for r in out if r["metric"] == "water_ml"]
check("bucket register (kg) -> a 1500 ml drink, source flow_meter",
      len(mls) == 1 and abs(mls[0]["value"] - 1500) <= 30 and mls[0]["source"] == "flow_meter", out)

wk, fake, out = worker([{"name": "bowl", "address": 3, "type": "int16", "metric": "feed_intake_g", "use": "feed_bowl", "unit": "g"}],
                       {3: "int16"})
poll(wk, fake, 3, [0] * 60 + [2000] * 100, 2)
offered = [r for r in out if r["metric"] == "feed_offered_g"]
check("feed_bowl register -> feed_offered_g with {meal, mealId}, source feeder",
      len(offered) == 1 and offered[0]["value"] == 2000 and offered[0]["source"] == "feeder"
      and set(offered[0]["meta"]) == {"meal", "mealId"}, out)

wk, fake, out = worker([{"name": "net", "address": 4, "type": "int16", "metric": "feed_intake_g", "use": "hay", "unit": "g"}],
                       {4: "int16"})
poll(wk, fake, 4, [int(6000 - i * 10 * 500 / 3600) for i in range(2 * 360)], 10)
hay = [r for r in out if r["metric"] == "hay_intake_g"]
check("hay register -> hay_intake_g per hour, meta.periodMin, source feeder",
      hay and all(r["source"] == "feeder" and "periodMin" in r["meta"] for r in hay)
      and any(r["meta"]["periodMin"] == 60 and abs(r["value"] - 500) <= 60 for r in hay), hay)

wk, fake, out = worker([{"name": "fault", "address": 9, "type": "uint16", "metric": "feed_intake_g", "use": "fault",
                         "faultCodes": {"7": "empty"}}], {9: "uint16"})
poll(wk, fake, 9, [0, 0, 2, 2, 2, 0, 7], 10)
faults = [r for r in out if r["metric"] == "feeder_fault"]
check("fault register -> feeder_fault per new fault (jam, then the site's code 7 = empty)",
      [r["meta"]["kind"] for r in faults] == ["jam", "empty"] and all(r["source"] == "feeder" for r in faults), faults)

wk, fake, out = worker([{"name": "odd", "address": 1, "type": "uint16", "metric": "water_ml", "use": "sprinkler"}], {1: "uint16"})
fake.values[1] = 5
ok, msg = raises(wk.run_once, "unknown register use")
check("an unknown `use` is an error for that register, not a guess", ok and not out, msg)

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}\n")
sys.exit(1 if fails else 0)
