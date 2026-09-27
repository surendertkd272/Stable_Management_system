"""Urination and manure from the floor, in real °C (the camera's pixel reads).

Method from DeePosit (a thermal mouse-cage system: F1 0.88 urine, 0.90 faeces;
PMC12393880), adapted to a stall:
  * each floor cell has a background that follows the floor slowly and is
    frozen while the horse or a warm patch covers it;
  * a candidate is a cell that rose ΔT above BOTH its background and the floor
    median — a slow warm-up (a sun patch) is followed by the background and
    never qualifies; spilled water never had a warm phase at all;
  * it is only confirmed once the horse is off it (no movement on it in the
    video for a few seconds) for two scans in a row;
  * each patch is then followed until it has cooled, and classified by HOW it
    cooled: urine soaks into cool bedding and cools within minutes, a manure
    pile is compact and stays warm far longer.
No published cooling data exists for horse urine or manure on bedding, so the
urine/manure split comes from the Hardware page's floor cooling test (warm
water and fresh manure on this stable's bedding). The default is our guess.
Detection uses the change in the SAME cell over seconds, so the camera's
±2 °C absolute accuracy matters much less than its frame-to-frame noise.
"""
import time


class FloorTracker:
    DELTA_C = 1.5                  # °C above background and floor median (DeePosit: robust 1.1–3.0)
    URINE_HALF_LIFE_MIN = 5.0      # cools to half its rise faster than this -> urine (guess until calibrated)
    MAX_AREA_FRAC = 0.35           # bigger than this share of the floor box -> a body print, not a deposit
    MAX_TRACK_MIN = 45.0
    BASE_RATE = 0.05               # background follows the floor at 5 % per scan

    def __init__(self, cols=16, rows=10, delta_c=None, urine_half_life_min=None):
        self.cols, self.rows = cols, rows
        self.delta = delta_c or self.DELTA_C
        self.urine_hl = urine_half_life_min or self.URINE_HALF_LIFE_MIN
        self.base = None
        self.streak = None
        self.patches = []
        self.spent = set()             # cells of a finished patch, until back at floor temperature

    def grid(self, box):
        pts = []
        for j in range(self.rows):
            for i in range(self.cols):
                pts.append({"x": box["x0"] + (box["x1"] - box["x0"]) * (i + 0.5) / self.cols,
                            "y": box["y0"] + (box["y1"] - box["y0"]) * (j + 0.5) / self.rows})
        return pts

    def _neighbours(self, i, diag=False):
        c, r = i % self.cols, i // self.cols
        steps = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (1, -1), (-1, 1), (-1, -1)] if diag else [])
        for dx, dy in steps:
            x, y = c + dx, r + dy
            if 0 <= x < self.cols and 0 <= y < self.rows:
                yield y * self.cols + x

    def _components(self, cells):
        cells, out = set(cells), []
        while cells:
            s = cells.pop()
            comp, stack = {s}, [s]
            while stack:
                for n in self._neighbours(stack.pop()):
                    if n in cells:
                        cells.discard(n)
                        comp.add(n)
                        stack.append(n)
            out.append(comp)
        return out

    def scan(self, temps, now=None, horse_cells=(), lying_recent=False):
        """temps: °C per cell (None = no reading); horse_cells: cells the horse
        is on or moving over. Returns finished events (usually [])."""
        now = time.time() if now is None else now
        n = len(temps)
        horse = set(horse_cells)
        if self.base is None:
            self.base = list(temps)
            self.streak = [0] * n
            return []
        vals = sorted(t for t in temps if t is not None)
        if not vals:
            return []
        med = vals[len(vals) // 2]
        rise = [None if (t is None or b is None) else t - b for t, b in zip(temps, self.base)]
        in_patch = set().union(*[p["cells"] for p in self.patches]) if self.patches else set()
        # A finished patch's tail is still a little warm: not a new deposit.
        self.spent = {i for i in self.spent if rise[i] is not None and rise[i] >= self.delta / 3}
        cand = [i for i in range(n)
                if rise[i] is not None and rise[i] >= self.delta and temps[i] - med >= self.delta
                and i not in horse and i not in self.spent]
        cs = set(cand)
        for i in range(n):
            self.streak[i] = self.streak[i] + 1 if i in cs else 0

        # New patches: confirmed candidates (2 scans) that no active patch owns
        # and that do not touch the horse.
        fresh = [i for i in cand if self.streak[i] >= 2 and i not in in_patch]
        for comp in self._components(fresh):
            if any(nb in horse for c in comp for nb in self._neighbours(c, diag=True)):
                continue                                         # wait until the horse has moved off
            self.patches.append({"start": now, "cells": set(comp), "area0": len(comp) / n,
                                 "series": [], "peak": 0.0, "peak_t": now, "area_max": len(comp) / n,
                                 "lying_recent": lying_recent})

        done = []
        for p in list(self.patches):
            cells = p["cells"]
            # Grow with neighbouring candidates (urine spreads into the bedding).
            grow = {nb for c in cells for nb in self._neighbours(c) if nb in cs}
            cells |= grow
            covered = any(c in horse for c in cells)
            rs = [rise[c] for c in cells if rise[c] is not None]
            if not covered and rs:
                mean_rise = sum(rs) / len(rs)
                warm_now = sum(1 for c in cells if rise[c] is not None and rise[c] >= self.delta / 2) / n
                p["series"].append((now, mean_rise, warm_now))
                p["area_max"] = max(p["area_max"], warm_now)
                if mean_rise > p["peak"]:
                    p["peak"], p["peak_t"] = mean_rise, now
                cooled = p["peak"] > 0 and mean_rise <= 0.2 * p["peak"]
            else:
                cooled = False
            if cooled or (now - p["start"]) / 60 >= self.MAX_TRACK_MIN:
                self.patches.remove(p)
                self.spent |= cells
                ev = self._classify(p, now)
                if ev:
                    done.append(ev)

        # Background follows the floor, but not under the horse or a patch.
        in_patch = set().union(*[p["cells"] for p in self.patches]) if self.patches else set()
        for i, t in enumerate(temps):
            if t is None or i in horse or i in in_patch or i in cs:
                continue
            if self.base[i] is None:
                self.base[i] = t
            else:
                self.base[i] += self.BASE_RATE * (t - self.base[i])
        return done

    def _classify(self, p, now):
        s = p["series"]
        if not s or p["peak"] < self.delta:
            return None
        # Half-life: minutes from the peak until the mean rise fell to half.
        hl = None
        for t, r, _ in s:
            if t >= p["peak_t"] and r <= 0.5 * p["peak"]:
                hl = (t - p["peak_t"]) / 60
                break
        cells = p["cells"]
        xs = [c % self.cols for c in cells]
        ys = [c // self.cols for c in cells]
        fill = len(cells) / ((max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1))
        spread = p["area_max"] / p["area0"] if p["area0"] else 1.0
        feats = {"peak_rise_c": round(p["peak"], 2), "half_life_min": None if hl is None else round(hl, 1),
                 "area0": round(p["area0"], 3), "area_max": round(p["area_max"], 3),
                 "spread": round(spread, 2), "fill": round(fill, 2),
                 "minutes_tracked": round((now - p["start"]) / 60, 1)}
        if p["area_max"] > self.MAX_AREA_FRAC or (p["lying_recent"] and p["area_max"] > 0.15):
            return {"kind": None, "rejected": "body print where the horse lay", **feats}
        kind = "urination" if (hl is not None and hl < self.urine_hl) else "excretion"
        urine_shape = spread >= 1.3 or fill < 0.6 or p["area0"] >= 0.08
        shape_agrees = urine_shape == (kind == "urination")
        return {"kind": kind, "start": p["start"], "confidence": 0.6 if shape_agrees else 0.4,
                "shape_agrees": shape_agrees, "tier": "probable", **feats}
