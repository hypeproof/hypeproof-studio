// The classroom-operation panels follow the Service, per cohort (hype-dental D-025, 2026-10-14).
//
// What is locked: an explicit `false` hides exactly that panel; anything else (absent field,
// absent profile, `true`) keeps it, because every cohort before the switch was served without the
// field and must look the same. And the chat view really gates both renders on this answer — the
// drawing itself is checked in the app (e2e/one-click-publish/classroom-panels.spec.ts).
//
// Run: node --experimental-strip-types test/classroom-panels.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { classroomPanelsShown } = await import("../src/classroomPanels.ts");

const both = { help: true, approval: true };
assert.deepEqual(classroomPanelsShown(null), both, "no profile yet: nothing is hidden by default");
assert.deepEqual(classroomPanelsShown({}), both, "a cohort served without the field (every cohort before it) keeps both");
assert.deepEqual(classroomPanelsShown({ classroom_panels: {} }), both);
assert.deepEqual(classroomPanelsShown({ classroom_panels: { help_request: true, artifact_approval: true } }), both);
assert.deepEqual(classroomPanelsShown({ classroom_panels: { help_request: false, artifact_approval: false } }), { help: false, approval: false }, "1017: both off");
assert.deepEqual(classroomPanelsShown({ classroom_panels: { help_request: false } }), { help: false, approval: true }, "each panel is its own switch");
assert.deepEqual(classroomPanelsShown({ classroom_panels: { artifact_approval: false } }), { help: true, approval: false });
console.log("✓ panels: only an explicit false hides, per panel; absent keeps the old screen");

// The chat view draws each panel only when its own answer says so (and never in instructor mode).
const panel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /const classroomPanels = classroomPanelsShown\(config\?\.profile\);/);
assert.match(panel, /\{!props\.instructor && classroomPanels\.help && <HelpRequest /, "help panel gated on its switch");
assert.match(panel, /\{!props\.instructor && help && classroomPanels\.approval && <details [^>]*data-artifact-approval=""/, "approval panel gated on its switch");
console.log("✓ ChatPanel gates both renders on the Service's answer");

console.log("\n✓ classroom-panels smoke 통과");
