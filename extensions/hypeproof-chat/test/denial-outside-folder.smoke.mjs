// #3224 (folded into #3221) — Jay 2026-10-29: the coach tried to Write to /tmp and the step read only
// "[안전 규칙] 안전 규칙에 맞지 않아 실행하지 않았어요." A path outside the work folder now says so in the learner's step,
// as an enum (no path), and every other denial keeps its sentence.
import assert from "node:assert/strict";
import { denialNotice, denialNoticeLabel, denialNoticeView, storedDenialNotice } from "../src/denialNotice.ts";
import { evaluateSdkToolUse } from "../src/sdkCoachHelpers.ts";

const OUTSIDE = "작업 폴더 밖이라 실행하지 않았어요. AI는 작업 폴더 안에서만 파일을 만들고 고쳐요.";
const ws = "/Users/someone/HypeProofTrial";
const gate = (toolName, input) => evaluateSdkToolUse({ toolName, input, permittedTools: ["Bash", "Read", "Write", "Edit"], workspaceRoot: ws, canonicalize: (p) => p, audience: "solo" });

// The recorded call: Write to /tmp. The verdict carries the cause the host maps to the detail.
const v = gate("Write", { file_path: "/tmp/report-src.html", content: "<html>" });
assert.equal(v.decision, "deny"); assert.equal(v.source, "safety"); assert.equal(v.cause, "path_outside_workspace");
assert.equal(gate("Read", { file_path: "/Users/someone/Downloads/CLOiD.html" }).cause, "path_outside_workspace");

for (const classroom of [false, true]) {
  const d = denialNotice("safety", classroom, "outside_folder");
  assert.deepEqual(d, { source: "safety", classroom, detail: "outside_folder" });
  const view = denialNoticeView(d);
  assert.equal(view.label, "안전 규칙"); assert.equal(view.text, OUTSIDE);
  const label = denialNoticeLabel(d);
  assert.equal(label, `[안전 규칙] ${OUTSIDE}`);
  assert.deepEqual(storedDenialNotice(label), { source: "safety", classroom: false, detail: "outside_folder" }, "the saved step decodes back to the detail");
  assert.ok(!/\/tmp|\/Users/.test(label), "no path in the saved step");
}

// Negative controls: no detail keeps today's sentence; a detail on another source, or an unknown detail, is dropped.
assert.equal(denialNoticeView(denialNotice("safety")).text, "안전 규칙에 맞지 않아 실행하지 않았어요.");
assert.deepEqual(denialNotice("lesson", false, "outside_folder"), { source: "lesson", classroom: false });
assert.deepEqual(denialNotice("safety", false, "other"), { source: "safety", classroom: false });
assert.deepEqual(storedDenialNotice("[안전 규칙] 안전 규칙에 맞지 않아 실행하지 않았어요."), { source: "safety", classroom: false }, "old saved steps still decode");
assert.equal(storedDenialNotice(`[안전 규칙] ${OUTSIDE} /tmp/x`), null, "a tag followed by other prose is not decoded");
console.log("denial-outside-folder: ok");
