// The behaviour guide must stay honest: every claim cites a source that exists,
// every label it names exists, and every footage label has a definition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PATTERNS, SOURCES, GROUPS, knowledge } from "./knowledge.mjs";
import { LABELS } from "./footage.mjs";

const STATUSES = new Set(["measured", "prototype", "label", "sensor", "not_visible"]);

test("every pattern cites at least one known source, and every source is used", () => {
  const used = new Set();
  for (const p of PATTERNS) {
    assert.ok(p.sources.length > 0, `${p.id} cites nothing`);
    for (const s of p.sources) { assert.ok(SOURCES[s], `${p.id} cites unknown source ${s}`); used.add(s); }
  }
  for (const s of Object.keys(SOURCES)) assert.ok(used.has(s), `source ${s} is never cited`);
  for (const s of Object.values(SOURCES)) assert.match(s.url, /^https:\/\//);
});

test("every pattern says what EquiCare can observe today, in a known group", () => {
  const groups = new Set(GROUPS.map((g) => g.key));
  const ids = new Set();
  for (const p of PATTERNS) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`); ids.add(p.id);
    assert.ok(groups.has(p.group), `${p.id}: unknown group ${p.group}`);
    assert.ok(STATUSES.has(p.equicare.status), `${p.id}: unknown status ${p.equicare.status}`);
    for (const f of ["name", "looks", "means", "confuse"]) assert.ok(p[f], `${p.id}: missing ${f}`);
    assert.ok(["strong", "weak", "normal"].includes(p.specificity), `${p.id}: specificity`);
    if (p.threshold) assert.equal(typeof p.threshold.ours, "boolean");
  }
});

test("labels named by the guide exist, and every label has a definition", () => {
  const keys = new Set(LABELS.map((l) => l.key));
  for (const p of PATTERNS) if (p.label) assert.ok(keys.has(p.label), `${p.id} names unknown label ${p.label}`);
  for (const l of LABELS) assert.ok(l.def && l.def.length > 20, `label ${l.key} has no definition`);
});

test("colic signs from the pain scale can be labelled, with unique shortcuts ('b' stays for boxes)", () => {
  for (const k of ["flank_watching", "kick_at_belly", "stretch_as_if_to_urinate", "lying_lateral", "box_walking", "head_tossing"])
    assert.ok(LABELS.some((l) => l.key === k), `missing label ${k}`);
  const sc = LABELS.map((l) => l.shortcut);
  assert.equal(new Set(sc).size, sc.length, "duplicate shortcut");
  assert.ok(!sc.includes("b"));
  assert.equal(LABELS.find((l) => l.key === "flank_watching").pattern, "flank_watching");
});

test("the eye-temperature entry matches the alert rules (baseline-relative, not rectal)", () => {
  const eye = knowledge().patterns.find((p) => p.id === "eye_temperature");
  assert.match(eye.equicare.how, /baseline/);
  assert.ok(eye.sources.includes("lampang2023"));
});
