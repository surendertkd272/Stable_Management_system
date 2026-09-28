#!/usr/bin/env python3
"""The stall intake processors (edge/intake.py) on synthetic sensor signals:
drinking bouts from a meter and a weighed bucket, meals from a weigh-back
bowl, hay per hour from a weighed net, feeder faults — and the things a horse
does to a scale that must NOT become intake (nudges, a chin on the rim, a
swinging net, a bucket lifted off, staff refilling).

Run:  python3 edge/intake_test.py
"""
import datetime as dt
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from intake import (BucketScale, FeedBowl, FeederFault, FlowBouts, HayScale,  # noqa: E402
                    meal_of)

fails = []


def check(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'' if cond else '  <- ' + str(detail)}")
    if not cond:
        fails.append(name)


IST = 330
# 2026-09-29 00:30 UTC = 06:00 at the stable (IST): a local hour boundary.
T0 = dt.datetime(2026, 9, 29, 0, 30, tzinfo=dt.timezone.utc).timestamp()


class Sig:
    """Feeds a processor a synthetic load-cell signal, one sample every `dt` s."""

    def __init__(self, proc, t0=T0, step=2.0, noise=8.0, seed=1):
        self.proc, self.t, self.dt, self.noise = proc, t0, step, noise
        self.rng = random.Random(seed)
        self.events = []

    def push(self, v):
        self.events += self.proc.add(self.t, v + self.rng.uniform(-self.noise, self.noise))
        self.t += self.dt

    def hold(self, level, secs, spike_every=0, spike=0.0):
        for i in range(int(secs / self.dt)):
            self.push(level + (spike if spike_every and i % spike_every == spike_every - 1 else 0))

    def ramp(self, a, b, secs, wobble=0.0, lift=0.0):
        """a -> b over secs; `lift` is extra weight while it happens (a muzzle
        displacing water, a head pressing the bowl), `wobble` its unsteadiness."""
        n = max(1, int(secs / self.dt))
        for i in range(n):
            self.push(a + (b - a) * (i + 1) / n + lift + self.rng.uniform(-wobble, wobble))

    def of(self, metric):
        return [e for e in self.events if e["metric"] == metric]


# --------------------------------------------------------------------------- #
print("\nFlowBouts — water meter total -> drinking bouts")
f = FlowBouts("m1:total")
ev = []
t, total = T0, 5000.0
ev += f.add(t, total)
check("first reading only sets the baseline", ev == [])
for sip in (300, 250, 0, 0, 400, 200):                 # 10 s polls: gulps with a pause < 60 s
    t += 10; total += sip
    ev += f.add(t, total)
check("no bout while flow is still within the 60 s gap", ev == [], ev)
for _ in range(7):
    t += 10
    ev += f.add(t, total)
visits, mls = [e for e in ev if e["metric"] == "water_visit"], [e for e in ev if e["metric"] == "water_ml"]
check("one bout after 60 s without flow", len(visits) == 1 and len(mls) == 1, ev)
if mls:
    check("bout ml is the sum of the gulps (1150)", mls[0]["value"] == 1150, mls[0])
    check("water_visit value 1, water_ml value = ml", visits[0]["value"] == 1 and mls[0]["value"] == mls[0]["meta"]["ml"])
    check("meta {ml, durationS, boutId} shared, stamped at the bout start",
          visits[0]["meta"] == mls[0]["meta"] and set(mls[0]["meta"]) == {"ml", "durationS", "boutId"}
          and visits[0]["t"] == mls[0]["t"] == T0, mls[0])
    check("durationS spans first to last flow (60 s)", mls[0]["meta"]["durationS"] == 60, mls[0]["meta"])

f = FlowBouts("m1:total")
ev = f.add(T0, 0)
ev += f.add(T0 + 10, 800)
ev += f.add(T0 + 100, 800)                              # 90 s later, no flow: bout 1 ends
ev += f.add(T0 + 110, 1600)
ev += f.add(T0 + 200, 1600)
check("flow separated by > 60 s is two bouts", len([e for e in ev if e["metric"] == "water_ml"]) == 2, ev)

f = FlowBouts("m1:total")
ev = (f.add(T0, 90000) + f.add(T0 + 10, 90500) + f.add(T0 + 100, 90500)
      + f.add(T0 + 110, 40) + f.add(T0 + 120, 540) + f.add(T0 + 200, 540))     # reset (power cut) between bouts
mls = [e["value"] for e in ev if e["metric"] == "water_ml"]
check("a meter reset never reports a negative drink", all(v > 0 for v in mls) and mls == [500, 500], mls)

f = FlowBouts("m1:total")
ev = f.add(T0, 0) + f.add(T0 + 10, 30) + f.add(T0 + 20, 60) + f.add(T0 + 100, 60)
check("a drip under 100 ml is not a drink", ev == [], ev)

f = FlowBouts("m1:total")
ev, tot = f.add(T0, 0), 0
for i in range(1, 20 * 6):                              # 20 min of unbroken flow
    tot += 150
    ev += f.add(T0 + i * 10, tot)
check("unbroken flow for 20 min: warning (leak / stuck valve)", f.warning and "leak" in f.warning, f.warning)
ev += f.add(T0 + 1300, tot)
check("... and it is not counted as drinking", ev == [], ev)

f = FlowBouts("m1:total")
f.add(T0, 0); f.add(T0 + 10, 700)
ev = f.tick(T0 + 40) + f.tick(T0 + 75)
check("a bout closes on tick when polls stop arriving", [e["value"] for e in ev if e["metric"] == "water_ml"] == [700], ev)

# --------------------------------------------------------------------------- #
print("\nBucketScale — weighed bucket -> bouts and refills")
s = Sig(BucketScale("m2:bucket"))
s.hold(12000, 120)
drink_start = s.t
s.ramp(12000, 10500, 40, wobble=150, lift=800)          # muzzle in the water pushes the reading UP
s.hold(10500, 200)
mls = s.of("water_ml")
check("a drink with the muzzle under water -> one bout", len(mls) == 1 and len(s.of("water_visit")) == 1, s.events)
if mls:
    check("bout ml ≈ 1500 (±60)", abs(mls[0]["value"] - 1500) <= 60, mls[0])
    check("stamped near the start of drinking (within 15 s)", abs(mls[0]["t"] - drink_start) <= 15,
          mls[0]["t"] - drink_start)
    check("durationS roughly the 40 s of drinking", 20 <= mls[0]["meta"]["durationS"] <= 75, mls[0]["meta"])
check("no refill invented from the muzzle's displacement", s.of("water_refill") == [], s.of("water_refill"))

s = Sig(BucketScale("m2:bucket"))
s.hold(12000, 120)
s.ramp(12000, 11600, 6)                                  # pushed against the wall: 400 g on the wall
s.hold(11600, 60)
s.ramp(11600, 12000, 6)                                  # swings back
s.hold(12000, 200)
check("a nudge that is undone is neither drink nor refill", s.events == [], s.events)

s = Sig(BucketScale("m2:bucket"))
s.hold(12000, 100, spike_every=10, spike=2000)          # the horse knocking it every 20 s
s.hold(12000, 100, spike_every=7, spike=-1500)
check("short knocks (spikes) are ignored", s.events == [], s.events)

s = Sig(BucketScale("m2:bucket"))
s.hold(6000, 100)
s.ramp(6000, 14000, 30, wobble=300)                      # hose
s.hold(14000, 200)
refills = s.of("water_refill")
check("staff refilling -> water_refill ≈ 8000 ml, not drinking",
      len(refills) == 1 and abs(refills[0]["value"] - 8000) <= 80 and not s.of("water_ml"), s.events)
if refills:
    check("water_refill unit ml", refills[0]["unit"] == "ml")

s = Sig(BucketScale("m2:bucket"))
s.hold(5000, 100)
s.ramp(5000, -1500, 4)                                   # lifted off to scrub (empty bucket tared to 0)
s.hold(-1500, 180)
s.ramp(-1500, 15000, 4)
s.hold(15000, 200)
check("bucket lifted off and brought back fuller: a refill of 10 000 ml, no drink",
      [round(e["value"], -2) for e in s.of("water_refill")] == [10000] and not s.of("water_ml"), s.events)

s = Sig(BucketScale("m2:bucket"))
s.hold(12000, 100)
s.ramp(12000, 11200, 20, wobble=100, lift=600)
s.hold(11200, 40)                                        # head up, looks round (settles), drinks again
s.ramp(11200, 10400, 20, wobble=100, lift=600)
s.hold(10400, 200)
mls = s.of("water_ml")
check("two gulps with a 40 s pause are one bout of ≈ 1600 ml",
      len(mls) == 1 and abs(mls[0]["value"] - 1600) <= 80, [m["value"] for m in mls])

s = Sig(BucketScale("m2:bucket"))
for i in range(6 * 3600 // 60):                          # evaporation: 200 ml over 6 h, 1 sample/min
    s.events += s.proc.add(T0 + i * 60, 12000 - 200 * i / 360)
check("slow evaporation is not drinking", s.events == [], s.events)

s = Sig(BucketScale("m2:bucket"))
s.hold(10000, 100)
s.ramp(10000, 8000, 30, wobble=100, lift=600)
s.hold(8000, 16)                                          # drinks, and staff fill before it settles
s.ramp(8000, 15000, 20, wobble=300)
s.hold(15000, 200)
mls, refills = s.of("water_ml"), s.of("water_refill")
check("a drink just before a refill is split at the lowest point",
      len(mls) == 1 and abs(mls[0]["value"] - 2000) <= 150 and len(refills) == 1 and abs(refills[0]["value"] - 7000) <= 150,
      [(e["metric"], e["value"]) for e in s.events])

# --------------------------------------------------------------------------- #
print("\nFeedBowl — weigh-back bowl -> offered / eaten / left")
check("meal names from the stable's clock",
      [meal_of(h) for h in (5, 10, 11, 14, 15, 20, 21, 2)] ==
      ["morning", "morning", "midday", "midday", "evening", "evening", "other", "other"])

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
fill_t = s.t
s.ramp(0, 2000, 10, wobble=200)                          # a scoop poured in
s.hold(2000, 180)
offered = s.of("feed_offered_g")
check("fill confirmed -> feed_offered_g 2000", len(offered) == 1 and abs(offered[0]["value"] - 2000) <= 10, s.events)
s.ramp(2000, 500, 20 * 60, wobble=120, lift=150)         # eating: muzzle pressing, bowl pushed about
s.hold(500, 10 * 60)
check("not closed while the bowl has been still < 20 min", not s.of("feed_intake_g"), s.events)
s.hold(500, 12 * 60)
eaten, left = s.of("feed_intake_g"), s.of("feed_refusal_g")
check("settled 20 min after eating -> eaten 1500, left 500",
      len(eaten) == 1 and len(left) == 1 and abs(eaten[0]["value"] - 1500) <= 15 and abs(left[0]["value"] - 500) <= 15,
      [(e["metric"], e["value"]) for e in s.events])
if offered and eaten:
    ids = {e["meta"]["mealId"] for e in offered + eaten + left}
    check("all three share meta {meal, mealId}, meal 'morning' (06:00 IST)",
          len(ids) == 1 and all(e["meta"] == {"meal": "morning", "mealId": offered[0]["meta"]["mealId"]}
                                for e in offered + eaten + left), [e["meta"] for e in s.events])
    check("all three stamped at the fill", all(abs(e["t"] - fill_t) <= 4 for e in offered + eaten + left),
          [e["t"] - fill_t for e in s.events])

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(300, 120)
s.ramp(300, 700, 4)
s.hold(700, 70)                                          # chin resting in the bowl, still enough to settle
s.ramp(700, 300, 4)
s.hold(300, 300)
check("a head resting in the bowl is not a fill", s.events == [], s.events)

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
s.ramp(0, 150, 4)
s.hold(150, 50)
s.ramp(150, 300, 4)                                      # a second scoop within 2 min
s.hold(300, 200)
offered = s.of("feed_offered_g")
check("two scoops of 150 g are one fill of 300 g", len(offered) == 1 and abs(offered[0]["value"] - 300) <= 8,
      [(e["metric"], e["value"]) for e in s.events])

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
s.ramp(0, 2000, 10)
s.hold(2000, 180)
s.ramp(2000, 800, 10 * 60, wobble=100)
s.hold(800, 5 * 60)                                      # not settled 20 min yet ...
s.ramp(800, 2800, 10)                                    # ... when the next feed goes in
s.hold(2800, 180)
eaten, left, offered = s.of("feed_intake_g"), s.of("feed_refusal_g"), s.of("feed_offered_g")
check("the next fill closes the previous meal (eaten 1200, left 800)",
      len(eaten) == 1 and abs(eaten[0]["value"] - 1200) <= 12 and abs(left[0]["value"] - 800) <= 12,
      [(e["metric"], e["value"]) for e in s.events])
check("... and opens a new one offering 2800 g (leftovers included)",
      len(offered) == 2 and abs(offered[1]["value"] - 2800) <= 12 and offered[0]["meta"]["mealId"] != offered[1]["meta"]["mealId"],
      [(e["metric"], e["value"]) for e in offered])

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
s.ramp(0, 2000, 10)
s.hold(2000, 30 * 60)
check("an untouched bowl is not a refusal after 30 min", not s.of("feed_refusal_g"), s.events)
s.hold(2000, 32 * 60)
left = s.of("feed_refusal_g")
check("... but is after an hour: eaten 0, left 2000",
      len(left) == 1 and abs(left[0]["value"] - 2000) <= 8 and s.of("feed_intake_g")[0]["value"] <= 8, s.events)

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
s.ramp(0, 2000, 10)
s.hold(2000, 180)
s.ramp(2000, 1200, 8 * 60, wobble=100)
s.hold(1200, 60)
s.ramp(1200, -600, 4)                                    # taken to the feed room
s.hold(-600, 20 * 60)
eaten, left = s.of("feed_intake_g"), s.of("feed_refusal_g")
check("bowl taken away closes the meal (eaten 800, left 1200)",
      len(eaten) == 1 and abs(eaten[0]["value"] - 800) <= 10 and abs(left[0]["value"] - 1200) <= 10,
      [(e["metric"], e["value"]) for e in s.events])
s.hold(-600, T0 + 6 * 3600 - s.t)                       # brought back filled at 12:00 IST
s.ramp(-600, 2500, 4)
s.hold(2500, 200)
offered = s.of("feed_offered_g")
check("... brought back filled: a new meal, 'midday', 2500 g",
      len(offered) == 2 and abs(offered[1]["value"] - 2500) <= 10 and offered[1]["meta"]["meal"] == "midday",
      [(e["metric"], e["value"], e["meta"]) for e in offered])

s = Sig(FeedBowl("m3:bowl", utc_offset_min=IST), noise=4)
s.hold(0, 120)
s.ramp(0, 2000, 10)
s.hold(2000, 180)
s.ramp(2000, 1000, 10 * 60, wobble=100)
s.hold(1000, 200, spike_every=8, spike=900)             # knocking the empty-ish bowl about
s.hold(1000, 25 * 60)
check("knocks while eating are not new fills", len(s.of("feed_offered_g")) == 1, s.of("feed_offered_g"))

# --------------------------------------------------------------------------- #
print("\nHayScale — weighed net -> hay eaten per hour")


def hay_run(proc, hours, eat_g_per_h, events=None, start=6000.0, step=2.0, seed=4):
    """A net eaten from at a steady rate, tugged: while the horse eats (about
    a third of each minute) the reading swings ±400 g and is pulled down."""
    rng = random.Random(seed)
    events = [] if events is None else events
    t, n = T0, int(hours * 3600 / step)
    for i in range(n):
        w = start - eat_g_per_h * (i * step) / 3600
        tugging = (i * step) % 60 < 20
        v = w + (400 * math.sin(i * 1.7) + 250 if tugging else 0) + rng.uniform(-20, 20)
        yield t, v
        t += step


h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 3.2, 500):
    ev += h.add(t, v)
check("three full hours reported", len(ev) >= 3, ev)
full = [e for e in ev if e["meta"]["periodMin"] == 60]
check("hay_intake_g ≈ 500 g per hour despite tugging and swinging (±80)",
      len(full) >= 2 and all(abs(e["value"] - 500) <= 80 for e in full), [(e["value"], e["meta"]) for e in ev])
check("periods on the stable's clock hours (06:00, 07:00 IST)",
      all((e["t"] - T0) % 3600 == 0 for e in full[1:]), [e["t"] - T0 for e in ev])
check("unit g, meta.periodMin", all(e["unit"] == "g" and set(e["meta"]) == {"periodMin"} for e in ev))

h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 2.2, 500):
    if T0 + 1.5 * 3600 <= t:
        v += 4000                                        # staff stuff 4 kg into the net at 07:30
    ev += h.add(t, v)
check("a refill is not intake (hour with the refill ≈ 500 g)",
      len(ev) >= 2 and abs(ev[1]["value"] - 500) <= 80, [e["value"] for e in ev])

h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 2.2, 500):
    tau = t - T0
    if 1.3 * 3600 <= tau < 1.3 * 3600 + 300:
        v = -400 + random.uniform(-20, 20)               # net taken down (tared: reads below 0)
    elif tau >= 1.3 * 3600 + 300:
        v += 3000                                        # hung back with 3 kg more
    ev += h.add(t, v)
check("net taken down and refilled: intake unaffected (≈ 500 g)",
      len(ev) >= 2 and abs(ev[1]["value"] - 500) <= 90, [e["value"] for e in ev])

h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 2.2, 500):
    tau = t - T0
    if 1.2 * 3600 <= tau < 1.2 * 3600 + 600:
        v -= 600                                          # resting on the wall for 10 min, then released
    ev += h.add(t, v)
check("a transient drop that recovers is not intake (≈ 500 g)",
      len(ev) >= 2 and abs(ev[1]["value"] - 500) <= 80, [e["value"] for e in ev])

h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 2.2, 400):
    tau = t - T0
    if tau >= 1.5 * 3600:
        v -= 2000                                         # 2 kg pulled out onto the floor at once
    ev += h.add(t, v)
check("hay pulled out faster than any horse eats is not counted (≈ 400 g)",
      len(ev) >= 2 and abs(ev[1]["value"] - 400) <= 80, [e["value"] for e in ev])

h = HayScale("m4:hay", utc_offset_min=IST)
ev = []
for t, v in hay_run(h, 4.2, 500):
    tau = t - T0
    if 1.25 * 3600 <= tau < 1.6 * 3600 or 2 * 3600 <= tau < 3 * 3600:
        continue                                           # sensor offline 21 min, then a whole hour
    ev += h.add(t, v)
mins = [e["meta"]["periodMin"] for e in ev]
check("a sensor gap shortens periodMin to the minutes measured", any(10 <= m <= 50 for m in mins), mins)
check("an hour with no samples is not reported (never as 0 g)",
      not any(T0 + 2 * 3600 <= e["t"] < T0 + 3 * 3600 for e in ev), [(e["t"] - T0, e["value"]) for e in ev])
check("measured stretches are sensible (≤ 8.5 g/min)",
      all(e["value"] <= 8.5 * e["meta"]["periodMin"] + 60 for e in ev), [(e["value"], e["meta"]) for e in ev])

# --------------------------------------------------------------------------- #
print("\nFeederFault — fault code register")
ff = FeederFault("m5:fault")
ev = ff.add(T0, 0) + ff.add(T0 + 10, 2) + ff.add(T0 + 20, 2)
check("a fault appearing -> one feeder_fault 'jam'",
      [(e["metric"], e["value"], e["meta"]["kind"]) for e in ev] == [("feeder_fault", 1, "jam")], ev)
ev = ff.add(T0 + 3000, 2) + ff.add(T0 + 3700, 2)
check("repeated hourly while it lasts (the alert looks back 2 h)", len(ev) == 1, ev)
ev = ff.add(T0 + 3800, 0) + ff.add(T0 + 3810, 1)
check("cleared, then 'empty'", [e["meta"]["kind"] for e in ev] == ["empty"], ev)
ev = ff.add(T0 + 3820, 99)
check("an unknown code is still a fault ('sensor', raw code kept)",
      ev and ev[0]["meta"] == {"kind": "sensor", "code": 99}, ev)
ff = FeederFault("m5:fault", codes={"12": "motor_stall", "13": "made_up"})
check("a site's own code table", ff.add(T0, 12)[0]["meta"]["kind"] == "motor_stall")
check("... kinds outside the spec are not accepted from it", ff.add(T0 + 1, 13)[0]["meta"]["kind"] == "sensor")

# --------------------------------------------------------------------------- #
print("\nsimulator emits the same shapes (edge_agent.sim_hour)")
import edge_agent  # noqa: E402
now = dt.datetime(2026, 9, 29, 12, 0)
rows = []
for hid, stall in edge_agent.ROSTER:
    p = dict(edge_agent.PROFILES.get(hid, {}), _now=now)
    for hrs in range(14 * 24, -1, -1):
        rows += edge_agent.sim_hour(hid, stall, now - dt.timedelta(hours=hrs), p)
by = lambda m: [r for r in rows if r["metric"] == m]  # noqa: E731
w = by("water_ml")[0]
check("drinking bouts: water_visit + water_ml with meta {ml, durationS, boutId}",
      set(w["meta"]) == {"ml", "durationS", "boutId"} and len(by("water_visit")) == len(by("water_ml")))
check("meals: offered / eaten / left share {meal, mealId}",
      all(set(r["meta"]) == {"meal", "mealId"} for r in by("feed_offered_g") + by("feed_intake_g") + by("feed_refusal_g"))
      and len(by("feed_offered_g")) == len(by("feed_intake_g")) == len(by("feed_refusal_g")))
check("hay_intake_g with meta.periodMin", by("hay_intake_g") and all(r["meta"] == {"periodMin": 60} for r in by("hay_intake_g")))
check("water_refill present", len(by("water_refill")) > 0)
st = by("device_status")
check("device_status for leg, head and pelvis",
      {r["meta"]["sensor"] for r in st} == {"leg", "head", "pelvis"}
      and all(set(r["meta"]) == {"sensor", "hardwareId", "signalDbm", "attached", "firmware"} for r in st)
      and all(0 <= r["value"] <= 100 for r in st))
check("steps from the leg, prototype, per 60 min",
      all(r["meta"] == {"sensor": "leg", "periodMin": 60, "prototype": True} for r in by("steps")))
ex = by("exercise_session")
check("exercise_session meta {start, end, steps, distanceM, trotMin, prototype}",
      ex and all(set(r["meta"]) == {"start", "end", "steps", "distanceM", "trotMin", "prototype"} for r in ex))
lr = by("lameness_result")
check("lameness_result meta {limb, head, pelvis, strides, durationS, prototype}",
      lr and all(set(r["meta"]) == {"limb", "head", "pelvis", "strides", "durationS", "prototype"} for r in lr))
sound = [r for r in lr if r["horseId"] != "sultan"]
check("sound horses: small asymmetry, no limb", all(r["value"] < 5 and r["meta"]["limb"] is None for r in sound))
sul = sorted((r for r in lr if r["horseId"] == "sultan"), key=lambda r: r["ts"])
if sul:
    latest, prev = sul[-1], sorted(r["value"] for r in sul[:-1])
    base = prev[len(prev) // 2] if prev else None
    check("sultan: developing left-fore lameness — latest LF, ≥ 6 mm over its own median",
          latest["meta"]["limb"] == "LF" and base is not None and latest["value"] - base >= 6,
          (latest["value"], base, latest["meta"]["limb"]))
check("nothing stamped after the hour it belongs to",
      all(r["ts"] <= (now.replace(microsecond=0).isoformat() + "Z") for r in rows))

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}\n")
sys.exit(1 if fails else 0)
