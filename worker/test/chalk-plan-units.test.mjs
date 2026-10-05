// #1466 (E2-7) — planUnits / diffUnits unit tests with real revision fixtures.
// Fixtures: worker/test/fixtures/chalk-plan/r3.html, r4.html, r5.html
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { planUnits, diffUnits } = await import("../src/lib/chalk-plan/units.ts");

const __dir = dirname(fileURLToPath(import.meta.url));
function fixture(name) {
  return readFileSync(join(__dir, "fixtures/chalk-plan", name), "utf8");
}

const r3 = fixture("r3.html");
const r4 = fixture("r4.html");
const r5 = fixture("r5.html");

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
    passed++;
  } catch (e) {
    console.error(`FAIL ${label}`);
    console.error("  ", e.message);
    failed++;
  }
}

// ── positive control: r3 produces units for each expected spec section ──────

check("r3 planUnits: flow steps captured", () => {
  const units = planUnits(r3, "lesson");
  const flowKeys = units.filter(u => u.key.startsWith("flow/"));
  assert.ok(flowKeys.length > 0, "no flow units");
  // at least one title and one role cell
  assert.ok(units.some(u => u.key.endsWith(":title")), "no flow/:title unit");
  assert.ok(units.some(u => u.key.endsWith(":teacher")), "no flow/:teacher unit");
  assert.ok(units.some(u => u.key.endsWith(":learner")), "no flow/:learner unit");
});

check("r3 planUnits: objectives captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("objectives/")), "no objectives units");
});

check("r3 planUnits: evidence captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("evidence/")), "no evidence units");
});

check("r3 planUnits: key-questions captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("key-questions/")), "no key-questions units");
});

check("r3 planUnits: prohibited-moves captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("prohibited-moves/")), "no prohibited-moves units");
});

check("r3 planUnits: support (stuck items) captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("support/")), "no support units");
});

check("r3 planUnits: meta tags captured", () => {
  const units = planUnits(r3, "lesson");
  assert.ok(units.some(u => u.key.startsWith("meta:chalk:")), "no meta units");
});

// ── r3→r4 diff: exactly 3 changes ───────────────────────────────────────────

check("r3→r4 diff: exactly 3 changed units", () => {
  const changes = diffUnits(planUnits(r3, "lesson"), planUnits(r4, "lesson"));
  assert.equal(changes.length, 3, `expected 3, got ${changes.length}: ${changes.map(c => c.key).join(", ")}`);
});

check("r3→r4 diff: flow/s-2:learner changed", () => {
  const changes = diffUnits(planUnits(r3, "lesson"), planUnits(r4, "lesson"));
  const c = changes.find(c => c.key === "flow/s-2:learner");
  assert.ok(c, "flow/s-2:learner not in changes");
  assert.equal(c.kind, "changed");
});

check("r3→r4 diff: flow/s-5:teacher changed", () => {
  const changes = diffUnits(planUnits(r3, "lesson"), planUnits(r4, "lesson"));
  const c = changes.find(c => c.key === "flow/s-5:teacher");
  assert.ok(c, "flow/s-5:teacher not in changes");
  assert.equal(c.kind, "changed");
});

check("r3→r4 diff: flow/s-5:learner changed", () => {
  const changes = diffUnits(planUnits(r3, "lesson"), planUnits(r4, "lesson"));
  const c = changes.find(c => c.key === "flow/s-5:learner");
  assert.ok(c, "flow/s-5:learner not in changes");
  assert.equal(c.kind, "changed");
});

// ── r4→r5 diff: exactly 1 change ────────────────────────────────────────────

check("r4→r5 diff: exactly 1 changed unit", () => {
  const changes = diffUnits(planUnits(r4, "lesson"), planUnits(r5, "lesson"));
  assert.equal(changes.length, 1, `expected 1, got ${changes.length}: ${changes.map(c => c.key).join(", ")}`);
});

check("r4→r5 diff: flow/s-5:title changed", () => {
  const changes = diffUnits(planUnits(r4, "lesson"), planUnits(r5, "lesson"));
  const c = changes.find(c => c.key === "flow/s-5:title");
  assert.ok(c, "flow/s-5:title not in changes");
  assert.equal(c.kind, "changed");
  assert.equal(c.before, "공유: 짝끼리 보여 주고 저장하기");
  assert.equal(c.after, "공유와 정리");
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
