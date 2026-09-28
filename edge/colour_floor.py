"""Urination and manure from the COLOUR picture — so one camera covers the floor.

The 25 mm thermal view is ~1.5 × 1.2 m at 3.5 m: aimed at the head it rarely
sees the floor where horses urinate and pass manure. The colour picture is
watched wherever it shows bedding (day and night, IR lamp) — on this unit it
covers about the same area as the thermal (measured 27 Sep), so only where a
floor box is drawn. What a deposit looks like there:
  manure  a new compact pile, darker than the bedding and textured (balls);
  urine   bedding going darker where it is wet — a wider, smoother patch
          (water absorbs near-infrared too, so wet bedding also darkens under
          the night lamp). On clean shavings this shows well; on straw less.
No published system detects horse urination or manure from video (research,
27 Sep): this is our method, a prototype — change detection on the bedding,
with the horse masked out by the detector's box:
  * each floor cell keeps a background (brightness, texture) learned while
    no horse is over it and nothing moves there;
  * a change is only judged once the horse has moved away and the cell has
    stayed the same for CONFIRM_S — a horse, a shadow or a person passing
    does not stay;
  * the patch is classified by shape and texture; the thermal floor check,
    when the patch is also in the thermal view, is the stronger evidence;
  * the patch is then folded into the background so it is counted once;
    mucking out (many cells changing at once, usually with a person) and
    the IR lamp switching re-learn the floor instead of counting anything.
"""
import math


class ColourFloorWatcher:
    COLS, ROWS = 24, 16
    DARKER = 18.0                  # grey levels darker than the cell's background
    TEXTURE_UP = 1.35              # manure balls: local spread up 35 %+
    CONFIRM_S = 60.0               # unchanged this long after the horse left
    LEARN_RATE = 0.02              # background follows slow light changes
    MAX_PATCH_FRAC = 0.2           # bigger at once: mucking out / light change, re-learn
    MANURE_MAX_CELLS = 12          # a pile is compact
    QUIET_AFTER_RESET_S = 300.0

    def __init__(self, w, h, bounds=None):
        self.w, self.h = w, h
        self.bounds = bounds or (0, int(h * 0.4), w - 1, h - 1)       # default: lower 60 % of the picture
        self.bg = None                                                # [(mean, spread)] per cell
        self.pending = {}                                             # cell -> first time it looked changed
        self.quiet_until = 0.0
        self.last_stand = []                                          # (t, box) — where the horse stood still
        self.n_cells = self.COLS * self.ROWS

    # -- geometry ----------------------------------------------------------- #
    def _cells(self, frame):
        x0, y0, x1, y1 = self.bounds
        cw, ch = (x1 - x0 + 1) / self.COLS, (y1 - y0 + 1) / self.ROWS
        out = []
        for j in range(self.ROWS):
            for i in range(self.COLS):
                cx0, cy0 = int(x0 + i * cw), int(y0 + j * ch)
                cx1, cy1 = int(x0 + (i + 1) * cw), int(y0 + (j + 1) * ch)
                vals = [frame[y * self.w + x] for y in range(cy0, max(cy0 + 1, cy1), 2) for x in range(cx0, max(cx0 + 1, cx1), 2)]
                m = sum(vals) / len(vals)
                sd = math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))
                out.append((m, sd))
        return out

    def _covered(self, box, margin=0.06):
        """Floor cells under the horse's box (0..1 of the frame), with a margin."""
        if not box:
            return set()
        x0, y0, x1, y1 = self.bounds
        cw, ch = (x1 - x0 + 1) / self.COLS, (y1 - y0 + 1) / self.ROWS
        bx0, by0 = (box["x0"] - margin) * self.w, (box["y0"] - margin) * self.h
        bx1, by1 = (box["x1"] + margin) * self.w, (box["y1"] + margin) * self.h
        out = set()
        for j in range(self.ROWS):
            for i in range(self.COLS):
                cx, cy = x0 + (i + 0.5) * cw, y0 + (j + 0.5) * ch
                if bx0 <= cx <= bx1 and by0 <= cy <= by1:
                    out.add(j * self.COLS + i)
        return out

    def _near_stand(self, cells, t):
        """Did the horse stand still over (or right next to) these cells in the
        last 5 minutes? Urinating and passing manure mostly happen standing."""
        self.last_stand = [(s, b) for s, b in self.last_stand if t - s <= 300]
        for _, b in self.last_stand:
            if cells & self._covered(b, margin=0.12):
                return True
        return False

    def reset(self, t, why=""):
        self.bg, self.pending = None, {}
        self.quiet_until = t + self.QUIET_AFTER_RESET_S

    # -- per frame (call ~1/s) ------------------------------------------------ #
    def feed(self, frame, t, horse_box=None, horse_still=False, moving_cells=frozenset()):
        """horse_box: detector box (0..1) or None; moving_cells: floor cells with
        movement just now. Returns finished events (usually [])."""
        cells = self._cells(frame)
        if horse_box and horse_still:
            self.last_stand.append((t, horse_box))
        covered = self._covered(horse_box) | set(moving_cells)
        if self.bg is None:
            if horse_box is None and not moving_cells:
                self.bg = [list(c) for c in cells]                     # learn an empty floor
            elif horse_box is not None:
                self.bg = [None if i in covered else list(c) for i, c in enumerate(cells)]
            return []
        changed = set()
        for i, (m, sd) in enumerate(cells):
            b = self.bg[i]
            if b is None:
                if i not in covered:
                    self.bg[i] = [m, sd]
                continue
            if i in covered:
                self.pending.pop(i, None)
                continue
            darker = b[0] - m >= self.DARKER
            textured = sd >= b[1] * self.TEXTURE_UP and sd - b[1] >= 4
            if darker or textured:
                changed.add(i)
                self.pending.setdefault(i, t)
            else:
                self.pending.pop(i, None)
                b[0] += self.LEARN_RATE * (m - b[0])
                b[1] += self.LEARN_RATE * (sd - b[1])
        if len(changed) > self.MAX_PATCH_FRAC * self.n_cells:
            self.reset(t, "many cells changed at once (mucking out or a light change)")
            return []
        if t < self.quiet_until:
            return []
        # Judge only well away from the horse: its shadow and hooves stay with it.
        near = self._covered(horse_box, margin=0.15)
        ready = {i for i, t0 in self.pending.items() if t - t0 >= self.CONFIRM_S and i not in near}
        events = []
        for comp in self._components(ready):
            # Only whole patches: a patch still growing, or touching the horse, waits.
            if any(nb in covered or (nb in self.pending and nb not in ready) for c in comp for nb in self._nb(c)):
                continue
            ev = self._classify(comp, cells, t)
            for c in comp:                                             # counted once: now part of the floor
                self.bg[c] = list(cells[c])
                self.pending.pop(c, None)
            if ev:
                events.append(ev)
        return events

    def _nb(self, i):
        c, r = i % self.COLS, i // self.COLS
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            x, y = c + dx, r + dy
            if 0 <= x < self.COLS and 0 <= y < self.ROWS:
                yield y * self.COLS + x

    def _components(self, cells):
        cells, out = set(cells), []
        while cells:
            s = cells.pop()
            comp, stack = {s}, [s]
            while stack:
                for n in self._nb(stack.pop()):
                    if n in cells:
                        cells.discard(n)
                        comp.add(n)
                        stack.append(n)
            out.append(comp)
        return out

    def _classify(self, comp, cells, t):
        n = len(comp)
        if n < 2:
            return None                                                # a single cell: noise, a dropped wisp
        dark = sum(self.bg[c][0] - cells[c][0] for c in comp) / n
        tex = sum(cells[c][1] / max(1.0, self.bg[c][1]) for c in comp) / n
        xs = [c % self.COLS for c in comp]
        ys = [c // self.COLS for c in comp]
        fill = n / ((max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1))
        manure = n <= self.MANURE_MAX_CELLS and tex >= self.TEXTURE_UP
        kind = "excretion" if manure else "urination"
        stood = self._near_stand(set(comp), t)
        conf = 0.35 + (0.1 if stood else 0.0) + (0.05 if (manure and fill >= 0.5) or (not manure and n > self.MANURE_MAX_CELLS) else 0.0)
        return {"kind": kind, "start": t - self.CONFIRM_S, "confidence": round(conf, 2), "tier": "colour only",
                "cells": n, "area": round(n / self.n_cells, 3), "darkening": round(dark, 1), "texture": round(tex, 2),
                "fill": round(fill, 2), "horseStoodThere": stood}
