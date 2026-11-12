// studio#3396 item 1 — guardLayoutSetter (webview-ui/src/layoutLoopGuard.ts) passes ordinary changes
// and holds a value that keeps returning, so a measure-and-set loop ends instead of reaching React #185.
import assert from "node:assert/strict";
import { guardLayoutSetter, OSCILLATION_LIMIT, WINDOW_MS, GUARD_LOG } from "../webview-ui/src/layoutLoopGuard";

let clock = 0;
const now = () => clock;
const warnings: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
try {
  // Ordinary changes pass, including fast monotonic ones (a caret anchor while typing).
  const seen: number[] = [];
  const anchor = guardLayoutSetter((v: number) => seen.push(v), "anchor", now);
  for (let i = 1; i <= 20; i++) { clock += 10; anchor(i * 7); }
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, i) => (i + 1) * 7), "monotonic values are never held");
  // A repeated identical value is not a change.
  const flips: boolean[] = [];
  const expanded = guardLayoutSetter((v: boolean) => flips.push(v), "expanded", now);
  expanded(true); expanded(true);
  assert.deepEqual(flips, [true]);
  // An oscillation is held after OSCILLATION_LIMIT returns inside the window, then logged once.
  for (let i = 0; i < 50; i++) expanded(i % 2 === 0 ? false : true);
  assert.ok(flips.length <= 2 + OSCILLATION_LIMIT * 2, `the loop was cut short (${flips.length} calls reached React, not 51)`);
  assert.equal(warnings.filter((w) => w.startsWith(GUARD_LOG)).length, 1, "one log line");
  // After the window passes a real change goes through again.
  const before = flips.length;
  clock += WINDOW_MS * 3;
  expanded(!flips[flips.length - 1]);
  assert.equal(flips.length, before + 1, "the hold ends with the window");
  // Control: a single return (one revisit) is not an oscillation.
  const once: boolean[] = [];
  const single = guardLayoutSetter((v: boolean) => once.push(v), "single", now);
  clock += 1000; single(true); clock += 10; single(false); clock += 10; single(true);
  assert.deepEqual(once, [true, false, true]);
  console.log("PASS layout-loop guard: passes changes, holds an oscillation, releases after the window");
} finally { console.warn = warn; }
