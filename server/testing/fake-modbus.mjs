// In-process Modbus/TCP device for tests: registers from a map; reading an
// address that isn't there returns exception 2 (illegal data address), like
// a real device.
import net from "node:net";

export async function startFakeModbus(registers = {}) {
  const regs = { ...registers };   // wire address -> uint16
  const server = net.createServer((sock) => {
    sock.on("data", (req) => {
      if (req.length < 12) return;
      const tid = req.readUInt16BE(0), unit = req[6], fn = req[7];
      const addr = req.readUInt16BE(8), count = req.readUInt16BE(10);
      const values = [];
      for (let i = 0; i < count; i++) values.push(regs[addr + i]);
      if (![3, 4].includes(fn) || values.some((v) => v === undefined)) {
        const ex = Buffer.alloc(9);
        ex.writeUInt16BE(tid, 0); ex.writeUInt16BE(0, 2); ex.writeUInt16BE(3, 4);
        ex[6] = unit; ex[7] = fn | 0x80; ex[8] = [3, 4].includes(fn) ? 2 : 1;
        return sock.write(ex);
      }
      const res = Buffer.alloc(9 + count * 2);
      res.writeUInt16BE(tid, 0); res.writeUInt16BE(0, 2); res.writeUInt16BE(3 + count * 2, 4);
      res[6] = unit; res[7] = fn; res[8] = count * 2;
      values.forEach((v, i) => res.writeUInt16BE(v & 0xffff, 9 + i * 2));
      sock.write(res);
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { regs, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
