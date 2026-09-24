#!/usr/bin/env python3
"""mock_modbus_sensor — a stand-in Modbus/TCP water meter, for exercising
Modbus sensors from the Hardware page without hardware.

Registers (zero-based wire addresses, holding or input):
  100-101  total volume, litres, float32, high word first — rises while "drinking"
  200      water temperature, °C × 10, int16

Usage:  python3 tools/mock_modbus_sensor.py --port 5510 [--lpm 2.0] [--reset-after 120]
"""
import time
import struct
import socket
import argparse
import threading

T0 = time.time()
ARGS = None


def total_litres():
    """A horse drinks in bouts: 20 s drinking at --lpm, 40 s not, repeating."""
    t = time.time() - T0
    if ARGS.reset_after and t > ARGS.reset_after:     # simulate a meter reset/rollover
        t -= ARGS.reset_after
    cycles, rem = divmod(t, 60)
    return (cycles * 20 + min(rem, 20)) * ARGS.lpm / 60.0


def registers():
    hi, lo = struct.unpack(">HH", struct.pack(">f", total_litres()))
    temp = struct.unpack(">H", struct.pack(">h", int(round(24.5 * 10))))[0]
    return {100: hi, 101: lo, 200: temp}


def serve(conn):
    with conn:
        while True:
            req = conn.recv(256)
            if len(req) < 12:
                return
            tid, _, _, unit, fn = struct.unpack(">HHHBB", req[:8])
            addr, count = struct.unpack(">HH", req[8:12])
            regs = registers()
            vals = [regs.get(addr + i) for i in range(count)]
            if fn not in (3, 4) or None in vals:
                conn.sendall(struct.pack(">HHHBBB", tid, 0, 3, unit, fn | 0x80, 2 if fn in (3, 4) else 1))
                continue
            payload = b"".join(struct.pack(">H", v) for v in vals)
            conn.sendall(struct.pack(">HHHBBB", tid, 0, len(payload) + 3, unit, fn, len(payload)) + payload)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5510)
    ap.add_argument("--lpm", type=float, default=2.0, help="litres per minute while drinking")
    ap.add_argument("--reset-after", type=int, default=0, help="seconds until the totaliser resets (0 = never)")
    ARGS = ap.parse_args()
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((ARGS.host, ARGS.port))
    srv.listen(16)
    print(f"[mock-meter] Modbus tcp://{ARGS.host}:{ARGS.port}  total@100 float32, temp@200 int16×10", flush=True)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=serve, args=(c,), daemon=True).start()
