"""Copy the Windows laptop's recordings to this Mac, over Tailscale.

On the laptop: stop the recorder, then double-click SHARE-RECORDINGS.bat
(tools/windows-recorder). It shares C:\\EquiCare-recordings read-only with
this Mac only. Here:

  python3 tools/fetch_recordings.py --laptop 100.105.13.127 \\
      --to ~/EquiCare-demo/recordings/devices-1790666091722-307

The thermal and colour clips edge/replay.py analyses come first; the full-HD
colour (colour-hd/) only with --hd — it is several times larger and only makes
nicer photos. A clip already here at the same size is skipped, so a copy that
stopped (Wi-Fi dropped) carries on where it was when run again.
"""
import argparse
import json
import queue
import sys
import threading
import time
import urllib.request
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--laptop", required=True, help="the laptop's Tailscale address")
    ap.add_argument("--to", required=True, help="folder to copy into (thermal/, visible/ … are made in it)")
    ap.add_argument("--hd", action="store_true", help="also copy colour-hd/ (large)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--only", choices=("thermal", "visible", "colour-hd"), help="copy just this stream")
    ap.add_argument("--first", choices=("thermal", "visible"),
                    help="copy all of this stream before the other (a slow link: the colour carries most of the analysis)")
    ap.add_argument("--ports", help="several sharing windows (SHARE-MORE.bat: 8765,8766,8767,8768): "
                                    "one clip each at a time — on a slow Wi-Fi four streams carry far more than one")
    a = ap.parse_args()

    ports = [int(x) for x in a.ports.split(",")] if a.ports else [a.port]
    base = f"http://{a.laptop}:{ports[0]}"
    with urllib.request.urlopen(f"{base}/list", timeout=20) as r:
        items = json.loads(r.read() or b"[]")
    if isinstance(items, dict):                              # one clip: PowerShell sends the object alone
        items = [items]
    streams = ("thermal", "visible") + (("colour-hd",) if a.hd else ())
    if a.only:
        streams = (a.only,)
    # In time order, each period's streams together: the night can be analysed
    # from the start while the rest is still coming.
    items = sorted((i for i in items if i["path"].split("/")[0] in streams),
                   key=lambda i: (0 if not a.first or i["path"].startswith(a.first + "/") else 1,
                                  i["path"].split("/")[1], streams.index(i["path"].split("/")[0])))
    dest = Path(a.to).expanduser()
    todo = [i for i in items if not ((dest / i["path"]).exists() and (dest / i["path"]).stat().st_size == i["size"])]
    total = sum(i["size"] for i in todo)
    print(f"{len(items)} clips on the laptop, {len(items) - len(todo)} already here; copying {len(todo)} "
          f"({total / 1e9:.1f} GB)", flush=True)
    work = queue.Queue()
    for i in todo:
        work.put(i)
    lock, state = threading.Lock(), {"done": 0, "k": 0}
    t0 = time.time()

    def worker(port):
        base_p = f"http://{a.laptop}:{port}"
        while True:
            try:
                i = work.get_nowait()
            except queue.Empty:
                return
            out = dest / i["path"]
            out.parent.mkdir(parents=True, exist_ok=True)
            part = out.with_suffix(f".{port}.part")
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(f"{base_p}/{i['path']}", timeout=180) as r, open(part, "wb") as f:
                        while True:
                            b = r.read(1 << 20)
                            if not b:
                                break
                            f.write(b)
                    if part.stat().st_size != i["size"]:
                        raise IOError(f"got {part.stat().st_size} of {i['size']} bytes")
                    part.replace(out)
                    break
                except Exception as e:                       # noqa: BLE001
                    print(f"  {i['path']}: {e} — " + ("trying again" if attempt < 2 else "skipped; run again later"), flush=True)
                    time.sleep(3)
            with lock:
                state["done"] += i["size"]
                state["k"] += 1
                rate = state["done"] / max(1, time.time() - t0)
                left = (total - state["done"]) / rate if rate else 0
                print(f"  {state['k']}/{len(todo)} {i['path']}  {state['done'] / 1e9:.2f}/{total / 1e9:.2f} GB, "
                      f"{rate * 8 / 1e6:.0f} Mbit/s, ~{left / 60:.0f} min left", flush=True)

    threads = [threading.Thread(target=worker, args=(p,)) for p in ports]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    missing = [i["path"] for i in items if not ((dest / i["path"]).exists() and (dest / i["path"]).stat().st_size == i["size"])]
    print("all copied" if not missing else f"{len(missing)} not copied — run again: {missing[:5]}")
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
