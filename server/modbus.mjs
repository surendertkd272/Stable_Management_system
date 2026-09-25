// Generic Modbus/TCP register reading and decoding, for any sensor that
// speaks it (flow meters, load cells, feeders…) — configured from the Hardware
// page, not coded per device. edge/edge_agent.py implements the same decoding;
// server/modbus.test.mjs and edge/modbus_test.py pin the two to the same
// vectors.
import net from "node:net";

export const TYPES = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2 };
export const WORD_ORDERS = ["high-first", "low-first"];

/** Read `count` 16-bit registers. fn 3 = holding, 4 = input. `address` is the
 *  WIRE (zero-based) address. */
export function readRegisters(host, port, unit, fn, address, count, timeoutMs = 4000) {
  const req = Buffer.alloc(12);
  const tid = Math.floor(Math.random() * 65535);
  req.writeUInt16BE(tid, 0); req.writeUInt16BE(0, 2); req.writeUInt16BE(6, 4);
  req.writeUInt8(unit, 6); req.writeUInt8(fn, 7);
  req.writeUInt16BE(address, 8); req.writeUInt16BE(count, 10);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port, timeout: timeoutMs });
    let buf = Buffer.alloc(0);
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.on("connect", () => sock.write(req));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 9) return;
      if (buf[7] & 0x80) {
        const codes = { 1: "illegal function", 2: "illegal data address", 3: "illegal data value", 4: "device failure" };
        return fail(new Error(`Modbus exception ${buf[8]} (${codes[buf[8]] || "unknown"}) — check the register address and function`));
      }
      if (buf.length < 9 + buf[8]) return;
      sock.end();
      const regs = [];
      for (let i = 0; i < buf[8] / 2; i++) regs.push(buf.readUInt16BE(9 + i * 2));
      if (regs.length < count) return reject(new Error(`asked for ${count} registers, got ${regs.length}`));
      resolve(regs);
    });
    sock.on("timeout", () => fail(new Error(`no Modbus response from ${host}:${port} within ${timeoutMs / 1000}s`)));
    sock.on("error", fail);
  });
}

/** Decode one value from its registers. */
export function decode(regs, type, wordOrder = "high-first") {
  if (TYPES[type] === 1) {
    const v = regs[0] & 0xffff;
    return type === "int16" && v & 0x8000 ? v - 0x10000 : v;
  }
  const [a, b] = wordOrder === "low-first" ? [regs[1], regs[0]] : [regs[0], regs[1]];
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(a & 0xffff, 0);
  buf.writeUInt16BE(b & 0xffff, 2);
  if (type === "float32") return buf.readFloatBE(0);
  if (type === "int32") return buf.readInt32BE(0);
  return buf.readUInt32BE(0);
}

/** The wire address for a register as written in the device's manual. */
export const wireAddress = (reg, addressing) => (addressing === "one-based" ? reg.address - 1 : reg.address);

/** Read and decode every configured register of a sensor. Per-register
 *  errors are reported, not thrown, so one bad address doesn't hide the rest. */
export async function readSensor(dev) {
  const out = [];
  for (const reg of dev.registers || []) {
    try {
      const regs = await readRegisters(dev.host, dev.port, dev.unitId, dev.function, wireAddress(reg, dev.addressing), TYPES[reg.type]);
      const raw = decode(regs, reg.type, reg.wordOrder);
      out.push({ name: reg.name, metric: reg.metric, unit: reg.unit, raw, value: raw * (reg.scale ?? 1) + (reg.offset ?? 0), ok: Number.isFinite(raw) });
    } catch (e) {
      out.push({ name: reg.name, metric: reg.metric, ok: false, error: e.message });
    }
  }
  return out;
}
