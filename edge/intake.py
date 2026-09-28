#!/usr/bin/env python3
"""Stall intake sensors: what the horse drank and ate, from raw Modbus values.

A load cell under a water bucket, a feed bowl or a hay net does not report
"drank 2 L" or "ate 1.4 kg" — it reports a weight, several times a minute, and
the horse is part of that signal: it pushes the bowl about, rests its chin on
the bucket, tugs the net and sets it swinging. A water meter reports a running
total. These processors turn both into the events the server expects
(SENSORS_SPEC §1, §9). Standard library only.

Every processor takes samples as add(t, value) — t in epoch seconds, value in
grams (ml for water; 1 ml of water weighs 1 g) — and returns a list of events:
    {"metric", "value", "unit", "t", "meta"}
edge_agent.ModbusWorker stamps them with the device and sends them.

Tare: set the register's offset so the EMPTY bucket / bowl / net reads 0 g.
Lifted off the scale it then reads below zero, which is how a removal (a
bucket taken away to scrub, a bowl to the feed room, a net taken down to
refill) is told apart from drinking or eating.

Poll load cells every 1–2 s: the smoothing and stability windows below are in
seconds and need several samples each (at the default 10 s poll a window holds
only three).

Thresholds are ours, not published — chosen from typical stable volumes and
eating rates, and constructor arguments so a site can tune them.
"""
import datetime as dt
from collections import deque
from statistics import median


# --------------------------------------------------------------------------- #
# shared: noisy weight -> settled levels
# --------------------------------------------------------------------------- #
class Step:
    """The weight settled at a new level. start = the last moment it was still
    at the old level, end = when it arrived at the new one. low/high = the
    extremes of the rolling median in between (what happened while unsettled)."""
    __slots__ = ("prev", "level", "start", "end", "low", "high")

    def __init__(self, prev, level, start, end, low, high):
        self.prev, self.level, self.start, self.end, self.low, self.high = prev, level, start, end, low, high


class Settle:
    """A rolling median removes short spikes (a nudge, a tug, a muzzle pressing
    down); a level only counts once `share` of the samples in the last
    `stable_s` sit within `tol` of their median — the horse has let go and the
    net has stopped swinging. A horse's head on the rim is never still to a few
    tens of grams, so a tight tolerance is itself a filter against leaning.

    Changes within `tol` are followed as drift (evaporation, load-cell
    temperature) and never become a Step, but `changed_t` still moves once the
    drift adds up to more than `tol` — so slow nibbling is not mistaken for
    "untouched"."""

    def __init__(self, median_s=20.0, stable_s=30.0, tol=30.0, share=0.8, min_n=3):
        self.median_s, self.stable_s, self.tol, self.share, self.min_n = median_s, stable_s, tol, share, min_n
        self.buf = deque()
        self.level = None          # the settled level
        self.settled_t = None      # last time it was settled there: a change started after it
        self.changed_t = None      # when the level last moved (cumulatively) by more than tol
        self.settled = False       # the latest sample completed a settled window
        self.low = self.high = None
        self._anchor = None

    def add(self, t, v):
        self.buf.append((t, v))
        keep = max(self.median_s, self.stable_s)
        while self.buf and self.buf[0][0] < t - keep:
            self.buf.popleft()
        med = median(x for s, x in self.buf if s >= t - self.median_s)
        if self.level is not None:
            self.low = med if self.low is None else min(self.low, med)
            self.high = med if self.high is None else max(self.high, med)
        win = [(s, x) for s, x in self.buf if s >= t - self.stable_s]
        self.settled = False
        # Too few samples, or not yet spanning the window: two readings a
        # second apart agreeing says nothing about the horse having let go.
        if len(win) < self.min_n or t - win[0][0] < 0.75 * self.stable_s:
            return None
        m = median(x for _, x in win)
        near = [s for s, x in win if abs(x - m) <= self.tol]
        if len(near) < self.share * len(win):
            return None
        self.settled = True
        if self.level is None:
            self._set(m, near[0])
            return Step(None, m, near[0], near[0], m, m)
        if abs(m - self.level) <= self.tol:
            self.level, self.settled_t = m, t
            if abs(m - self._anchor) > self.tol:
                self._anchor, self.changed_t = m, t
            return None
        # Not the last single sample near the old level: a muzzle under water
        # raises the reading, so mid-bout samples cross the old level.
        step = Step(self.level, m, self.settled_t, near[0], min(self.low, m), max(self.high, m))
        self._set(m, near[0])
        self.settled_t = t
        return step

    def _set(self, m, since):
        self.level = self._anchor = m
        self.changed_t = self.settled_t = since
        self.low = self.high = m


def _ev(metric, value, unit, t, meta=None):
    return {"metric": metric, "value": value, "unit": unit, "t": t, "meta": meta}


def _local(t, utc_offset_min):
    """Wall-clock time at the stable: the edge box's own zone unless given."""
    if utc_offset_min is None:
        return dt.datetime.fromtimestamp(t, dt.timezone.utc).astimezone()
    return dt.datetime.fromtimestamp(t, dt.timezone(dt.timedelta(minutes=utc_offset_min)))


def _stamp(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _drink(key, ml, start, duration_s):
    """One drinking bout = a water_visit plus its water_ml, stamped at the bout
    start and sharing the bout's meta (§1)."""
    meta = {"ml": round(ml), "durationS": None if duration_s is None else round(duration_s), "boutId": f"{key}:{_stamp(start)}"}
    return [_ev("water_visit", 1, "event", start, meta), _ev("water_ml", round(ml), "ml", start, dict(meta))]


# --------------------------------------------------------------------------- #
# water meter (running total)
# --------------------------------------------------------------------------- #
class FlowBouts:
    """A water meter's running total -> drinking bouts.

    Flow within `gap_s` of the last flow belongs to the same bout (a horse
    drinks in gulps with its head up in between); a bout ends after `gap_s`
    without flow. The first reading only sets the baseline, and a total that
    goes backwards (meter reset, rollover) re-baselines instead of reporting a
    negative drink.

    Not counted as drinking: under `min_ml` (a drip, a weeping valve, meter
    creep), and flow that runs on for over `max_bout_s` — no horse drinks for
    15 minutes without lifting its head; that is a leak, a hose or a stuck
    valve, and counting it would hide a horse that is not drinking. It is
    reported as a warning for the Hardware page instead."""

    def __init__(self, key="flow", gap_s=60.0, min_ml=100.0, max_bout_s=15 * 60.0):
        self.key, self.gap_s, self.min_ml, self.max_bout_s = key, gap_s, min_ml, max_bout_s
        self.total = self.last_t = None
        self.bout = None
        self.warning = None

    def add(self, t, total):
        out = self.tick(t)
        if self.total is None or total < self.total:
            self.total, self.last_t = total, t
            return out
        inc, self.total = total - self.total, total
        prev_t, self.last_t = self.last_t, t
        if inc <= 0:
            return out
        if self.bout is None:
            # It started after the previous poll — but not before the gap, if
            # polls were missed (we cannot know more than that).
            self.bout = {"start": max(prev_t, t - self.gap_s), "last": t, "ml": inc, "leak": False}
        else:
            self.bout["last"], self.bout["ml"] = t, self.bout["ml"] + inc
        if t - self.bout["start"] > self.max_bout_s and not self.bout["leak"]:
            self.bout["leak"] = True
            self.warning = (f"water has been flowing for over {int(self.max_bout_s // 60)} min without a pause — "
                            "a leak, a hose or a stuck valve? Not counted as drinking.")
        return out

    def tick(self, t):
        b = self.bout
        if b is None or t - b["last"] < self.gap_s:
            return []
        self.bout = None
        if b["leak"]:
            return []
        self.warning = None
        if b["ml"] < self.min_ml:
            return []
        return _drink(self.key, b["ml"], b["start"], b["last"] - b["start"])


# --------------------------------------------------------------------------- #
# water bucket on a load cell
# --------------------------------------------------------------------------- #
class BucketScale:
    """A weighed water bucket -> drinking bouts and refills.

    A settled drop of at least `drink_min` ml is a drink; a settled rise of at
    least `refill_min` ml is staff refilling (water_refill, the ml added — never
    counted as drinking). Changes in between are drift, a splash, or hay dunked
    in the water, and are ignored. Drops within `bout_gap_s` of each other are
    one bout.

    Nudges: a push that shifts the bucket's weight onto the wall or bracket
    looks like a drink, and the bucket swinging back like a refill. So every
    change is held for `confirm_s`; one that is undone within that time (the
    level returns to where it was) was the horse moving the bucket, and both
    halves are dropped.

    The horse drinking as the bucket is filled (no settled level between) is
    split at the lowest point: drink first, then the refill.

    Removal: lifted off the scale the reading falls below `removed_below`
    (the empty bucket is tared to 0). That is not drinking; when it comes back,
    any rise over the level before it left is a refill."""

    def __init__(self, key="bucket", drink_min=100.0, refill_min=500.0, tol=30.0, median_s=20.0, stable_s=30.0,
                 confirm_s=120.0, bout_gap_s=60.0, removed_below=-200.0):
        self.key, self.drink_min, self.refill_min, self.tol = key, drink_min, refill_min, tol
        self.confirm_s, self.bout_gap_s, self.removed_below = confirm_s, bout_gap_s, removed_below
        self.s = Settle(median_s, stable_s, tol)
        self.pending = None        # {prev, level, end, drinks: [(ml, start, dur)], refills: [(ml, t)]}
        self.off_from = None       # the level before the bucket was lifted off
        self.warning = None

    def add(self, t, v):
        out = []
        step = self.s.add(t, v)
        if step is not None and step.prev is not None:
            out += self._step(step)
        return out + self.tick(t)

    def _step(self, st):
        out = []
        if st.level < self.removed_below:
            if self.off_from is None:
                self.off_from = st.prev
            return out
        if self.off_from is not None:
            added, self.off_from = st.level - self.off_from, None
            out += self._confirm()
            if added >= self.refill_min:
                out.append(_ev("water_refill", round(added), "ml", st.start))
            return out
        p = self.pending
        if p is not None and abs(st.level - p["prev"]) <= 3 * self.tol:
            self.pending = None                               # undone: the horse moved the bucket
            return out
        d = st.level - st.prev
        drinks, refills = [], []
        if d >= self.refill_min:
            # The horse drinking as the bucket was filled, with no settled
            # level between: the lowest point splits the two.
            if st.prev - st.low >= self.drink_min and st.level - st.low >= self.refill_min:
                drinks.append((st.prev - st.low, st.start, None))
                refills.append((st.level - st.low, st.end))
            else:
                refills.append((d, st.start))
        elif d <= -self.drink_min:
            # Not split at the highest point: a muzzle under water pushes the
            # reading up by the water it displaces (a litre or more) for as
            # long as the horse drinks, which would look like a refill. A drink
            # straight after a refill, with no settled moment between, is
            # therefore folded into the refill — a missed drink rather than an
            # invented refill.
            drinks.append((-d, st.start, st.end - st.start))
        else:
            return out
        if (p is not None and not refills and not p["refills"] and p["drinks"]
                and st.start - p["end"] <= self.bout_gap_s):
            ml0, start0, _ = p["drinks"][0]
            p["drinks"] = [(ml0 + drinks[0][0], start0, st.end - start0)]
            p["level"], p["end"] = st.level, st.end
            return out
        out += self._confirm()
        self.pending = {"prev": st.prev, "level": st.level, "end": st.end, "drinks": drinks, "refills": refills}
        return out

    def _confirm(self):
        p, self.pending = self.pending, None
        if p is None:
            return []
        out = []
        for ml, start, dur in p["drinks"]:
            out += _drink(self.key, ml, start, dur)
        out += [_ev("water_refill", round(ml), "ml", at) for ml, at in p["refills"]]
        return out

    def tick(self, t):
        if self.pending is not None and t - self.pending["end"] >= self.confirm_s:
            return self._confirm()
        return []


# --------------------------------------------------------------------------- #
# weigh-back feed bowl
# --------------------------------------------------------------------------- #
# Meal names from the stable's wall clock (hour ranges, ours).
MEALS = (("morning", 4, 11), ("midday", 11, 15), ("evening", 15, 21))


def meal_of(hour):
    for name, lo, hi in MEALS:
        if lo <= hour < hi:
            return name
    return "other"


class FeedBowl:
    """A weighed feed bowl -> offered / eaten / left over, per meal.

    A meal starts with a fill: a settled rise of at least `fill_min` g (rises
    within `revert_s` of each other add up — a second scoop, a feeder auger
    dispensing in steps). A fill undone within `revert_s` (the weight falls
    straight back to where it was) was a head resting in the bowl, not feed:
    a horse cannot eat 200 g of hard feed in two minutes (roughly 100 g/min at
    most — our figure). Only once confirmed does it close the previous meal
    and report feed_offered_g.

    eaten = offered − remaining, measured when the weight has been settled for
    `settle_s` after eating began, or at the next fill, or when the bowl is
    taken away. A bowl never touched is left open for `untouched_s` — a horse
    that has not started yet is not refusing — then reported as refused.
    Eating after the meal is closed is not counted (the next fill starts a
    new meal from what is left).

    All three readings carry meta {meal, mealId} and are stamped at the fill,
    so the server can put a meal's numbers together."""

    def __init__(self, key="bowl", fill_min=200.0, tol=15.0, median_s=20.0, stable_s=30.0, settle_s=20 * 60.0,
                 untouched_s=60 * 60.0, revert_s=120.0, removed_below=-100.0, utc_offset_min=None):
        self.key, self.fill_min, self.tol = key, fill_min, tol
        self.settle_s, self.untouched_s, self.revert_s, self.removed_below = settle_s, untouched_s, revert_s, removed_below
        self.utc_offset_min = utc_offset_min
        self.s = Settle(median_s, stable_s, tol)
        self.meal = None           # the confirmed, open meal
        self.fill = None           # a fill seen but not yet confirmed
        self.rise_base = None      # level before the current run of rises
        self.off = False
        self.warning = None

    def add(self, t, v):
        out = []
        st = self.s.add(t, v)
        if st is not None:
            out += self._step(st)
        return out + self.tick(t)

    def _step(self, st):
        out = []
        if st.prev is None:
            self.rise_base = st.level
            return out
        if st.level < self.removed_below:
            if not self.off:
                self.off = True
                self.fill = None
                if self.meal is not None:
                    out += self._close(max(0.0, st.prev))
            return out
        if self.off:                                      # back from the feed room, maybe filled
            self.off = False
            self.rise_base = 0.0
        if st.level > st.prev:
            if self.fill is not None:
                self.fill["offered"], self.fill["seen"] = st.level, st.end
            elif st.level - self.rise_base >= self.fill_min:
                self.fill = {"t": st.start, "pre": max(0.0, self.rise_base), "offered": st.level, "seen": st.end}
            return out
        self.rise_base = st.level
        f = self.fill
        if f is not None and st.level <= f["pre"] + 2 * self.tol:
            self.fill = None                              # a head in the bowl, not feed
        return out

    def _open(self, f):
        name = meal_of(_local(f["t"], self.utc_offset_min).hour)
        self.meal = {"t": f["t"], "offered": f["offered"], "meal": name, "id": f"{self.key}:{_stamp(f['t'])}"}
        return [_ev("feed_offered_g", round(f["offered"]), "g", f["t"], {"meal": name, "mealId": self.meal["id"]})]

    def _close(self, remaining):
        m, self.meal = self.meal, None
        remaining = max(0.0, min(remaining, m["offered"]))
        meta = {"meal": m["meal"], "mealId": m["id"]}
        return [_ev("feed_intake_g", round(m["offered"] - remaining), "g", m["t"], meta),
                _ev("feed_refusal_g", round(remaining), "g", m["t"], dict(meta))]

    def tick(self, t):
        out = []
        f = self.fill
        if f is not None and t - f["seen"] >= self.revert_s:
            self.fill = None
            if self.meal is not None:
                out += self._close(f["pre"])
            out += self._open(f)
        m, s = self.meal, self.s
        if m is not None and self.fill is None and s.settled and s.level is not None:
            eating_seen = s.level < m["offered"] - 2 * self.tol
            if ((eating_seen and t - s.changed_t >= self.settle_s)
                    or (not eating_seen and t - m["t"] >= self.untouched_s)):
                out += self._close(s.level)
        return out


# --------------------------------------------------------------------------- #
# hay net / rack on a load cell
# --------------------------------------------------------------------------- #
class HayScale:
    """A weighed hay net or rack -> hay_intake_g per clock hour.

    A net is tugged, swings and rests against the wall, so no single reading
    is trusted: the level is a rolling median that counts only when settled
    (wider tolerance than a bucket — a net never hangs quite still). Intake over
    a period = level at its start − level at its end + hay added, so a
    transient drop that recovers (the net leaning on the wall, then released)
    cancels out instead of being counted.

    Added hay: a settled rise of at least `refill_min` g (staff adding hay —
    never intake). A net taken down reads below `removed_below`; when it goes
    back, whatever changed while it was down is attributed to staff, not the
    horse. A drop faster than any horse eats (`max_eat_g_per_min`, ours: 50 g/min
    is ~3 kg/h, well above typical hay intake) is hay pulled out onto the floor
    or the net unloaded — not counted as eaten.

    Periods are clock hours at the stable. A sensor silent for over `max_gap_s`
    ends the measured stretch: meta.periodMin is always the minutes actually
    measured, and a stretch the sensor did not cover is not reported (never as
    0 g)."""

    def __init__(self, key="hay", refill_min=500.0, tol=80.0, median_s=60.0, stable_s=60.0, share=0.7,
                 removed_below=-200.0, max_eat_g_per_min=50.0, period_s=3600, max_gap_s=300.0, utc_offset_min=None):
        self.key, self.refill_min, self.removed_below = key, refill_min, removed_below
        self.max_eat, self.period_s, self.max_gap_s, self.utc_offset_min = max_eat_g_per_min, period_s, max_gap_s, utc_offset_min
        self.s = Settle(median_s, stable_s, tol, share=share)
        self.level = None          # latest settled level with the net on the hook
        self.ref = self.ref_t = None
        self.added = 0.0
        self.off = False
        self.on_seen = False       # the net was on the hook and settled during this stretch
        self.last_t = None
        self.period_end = None
        self.warning = None

    def _period_end(self, t):
        off = _local(t, self.utc_offset_min).utcoffset().total_seconds()
        return (int((t + off) // self.period_s) + 1) * self.period_s - off

    def add(self, t, v):
        out = []
        if self.last_t is not None and t - self.last_t > self.max_gap_s:
            out += self._close(self.last_t)
            self.ref = self.ref_t = None                   # restart from the next settled level
            self.on_seen = False
        if self.period_end is None:
            self.period_end = self._period_end(t)
        while t >= self.period_end:
            out += self._close(self.period_end)
            self.period_end += self.period_s
        self.last_t = t
        st = self.s.add(t, v)
        if st is not None:
            self._step(st)
        if self.s.settled and not self.off:
            self.level = self.s.level
            self.on_seen = True
            if self.ref is None:
                self.ref, self.ref_t, self.added = self.level, t, 0.0
        return out

    def _step(self, st):
        if st.level < self.removed_below:
            self.off = True
            return
        if self.off:
            self.off = False
            if self.level is not None:
                self.added += st.level - self.level        # whatever staff did while it was down
            return
        if st.prev is None or self.level is None:
            return
        d = st.level - self.level
        minutes = max(1.0, (st.end - st.start) / 60)
        if d >= self.refill_min or (d < 0 and -d > max(self.refill_min, self.max_eat * minutes)):
            self.added += d                                # refill, or hay pulled out / unloaded

    def _close(self, end_t):
        out = []
        if self.ref is not None and self.on_seen and self.level is not None and end_t - self.ref_t >= 60:
            eaten = max(0.0, self.ref - self.level + self.added)
            out.append(_ev("hay_intake_g", round(eaten), "g", self.ref_t,
                           {"periodMin": round((end_t - self.ref_t) / 60)}))
        if self.ref is not None:                           # the measurement runs on into the next period
            self.ref, self.ref_t = self.level, end_t
        self.added = 0.0
        self.on_seen = self.ref is not None and not self.off
        return out

    def tick(self, t):
        return []


# --------------------------------------------------------------------------- #
# feeder fault code register
# --------------------------------------------------------------------------- #
# Default code table (a feeder's manual may differ — set the register's
# `faultCodes` in the portal, e.g. {"12": "jam"}). 0 = no fault.
FEEDER_FAULT_CODES = {1: "empty", 2: "jam", 3: "motor_stall", 4: "under_run", 5: "over_run", 6: "sensor"}
FAULT_KINDS = set(FEEDER_FAULT_CODES.values())


class FeederFault:
    """A feeder's fault-code register -> feeder_fault events.

    One event when a fault appears or changes, repeated every `repeat_s` while
    it lasts (the server's alert looks back 2 h, so a fault that is still there
    must not drop out of it). A code not in the table is still a fault: it is
    reported as "sensor" with the raw code in meta.code, to look up in the
    feeder's manual."""

    def __init__(self, key="feeder", codes=None, repeat_s=3600.0):
        self.key, self.repeat_s = key, repeat_s
        self.codes = dict(FEEDER_FAULT_CODES)
        for k, v in (codes or {}).items():
            if v in FAULT_KINDS:
                self.codes[int(k)] = v
        self.active = self.last_emit = None
        self.warning = None

    def add(self, t, value):
        code = int(round(value))
        if code == 0:
            self.active = None
            return []
        if code == self.active and t - self.last_emit < self.repeat_s:
            return []
        self.active, self.last_emit = code, t
        return [_ev("feeder_fault", 1, "event", t, {"kind": self.codes.get(code, "sensor"), "code": code})]

    def tick(self, t):
        return []


PROCESSORS = {"flow": FlowBouts, "bucket": BucketScale, "feed_bowl": FeedBowl, "hay": HayScale, "fault": FeederFault}
