// CGP-AGENT-R-001 / R-002 — the lesson approval preset in the app.
//
// Requirement: docs/studio-requirements.md REQ-E1a. The Service serves `approval_preset`
// (hypeproof-service docs/requirements/lesson-approval-preset.md); a preset may only ADD
// asks on top of the app's tiers.
//
//   positive  a served known preset is read; before_changes/always_ask make every SDK shell
//             command ask and add writeFile/executeShell to the modal kinds; always_ask forgets.
//   negative  absent, unknown (full_access) or malformed blocks are ignored, and then the SDK
//             verdicts and modal kinds are exactly today's.
import assert from "node:assert/strict";

const preset = await import("../src/approvalPreset.ts");
const { evaluateSdkToolUse, permittedToolsFor } = await import("../src/sdkCoachHelpers.ts");

const served = (id, label = "바꾸기 전에 묻기") => ({ approval_preset: { id, label, description: "파일을 고치거나 명령을 실행하기 전에 물어봐요." } });

// ─── reading the served block ────────────────────────────────────────────────
assert.deepEqual(preset.servedApprovalPreset(served("before_changes")), { id: "before_changes", label: "바꾸기 전에 묻기", description: "파일을 고치거나 명령을 실행하기 전에 물어봐요." });
assert.equal(preset.servedApprovalPreset(null), null, "no profile");
assert.equal(preset.servedApprovalPreset({}), null, "no preset → today's tiers");
assert.equal(preset.servedApprovalPreset(served("full_access", "모두 허용")), null, "there is no full-access preset");
assert.equal(preset.servedApprovalPreset(served("always_ask", "")), null, "blank name is not drawn");
assert.equal(preset.servedApprovalPreset(served("always_ask", "a\nb")), null, "multi-line name is not drawn");
assert.equal(preset.servedApprovalPreset({ approval_preset: "always_ask" }), null, "bare id is not the served shape");

// ─── modal kinds: only ever more ──────────────────────────────────────────────
const today = ["executeShell", "openBrowser", "delegateAgent", "browserType"];
assert.deepEqual(preset.presetRequiredKinds(today, null), today, "absent preset: unchanged");
assert.deepEqual(preset.presetRequiredKinds(today, "important_only"), today, "important_only is today's tiers");
assert.deepEqual(preset.presetRequiredKinds(today, "before_changes"), [...today, "writeFile"], "before_changes adds file writes");
assert.deepEqual(preset.presetRequiredKinds([], "always_ask"), ["writeFile", "executeShell"], "always_ask adds writes and commands");
for (const id of preset.APPROVAL_PRESET_IDS) for (const kind of today) assert.ok(preset.presetRequiredKinds(today, id).includes(kind), `${id} never removes ${kind}`);
assert.equal(preset.presetForgetsAllows("always_ask"), true);
assert.equal(preset.presetForgetsAllows("before_changes"), false);
assert.equal(preset.presetForgetsAllows(null), false);
assert.equal(preset.stricterPreset("always_ask", null), "always_ask", "a refresh (no profile) never loosens");
assert.equal(preset.stricterPreset(null, "before_changes"), "before_changes");
assert.equal(preset.stricterPreset("before_changes", "important_only"), "before_changes");
assert.equal(preset.stricterPreset("important_only", "always_ask"), "always_ask");
assert.equal(preset.stricterPreset(null, null), null);

// ─── SDK verdicts: a stricter preset asks before every command ───────────────
{
  const cohort = { profile_id: "adult-shell", sdk_tools: { read: true, write: true, shell: true }, game: { template_tier: "website" } };
  const permitted = permittedToolsFor(cohort);
  const ev = (toolName, input, approvalPreset) =>
    evaluateSdkToolUse({ toolName, input, permittedTools: permitted, workspaceRoot: "/Users/x/HypeProofClinic", approvalPreset });
  assert.equal(ev("Bash", { command: "git status" }).decision, "allow", "control: no preset, an everyday command runs");
  assert.equal(ev("Bash", { command: "git status" }, "important_only").decision, "allow", "important_only: today's tier");
  assert.equal(ev("Bash", { command: "git status" }, "before_changes").decision, "ask", "before_changes: every command asks");
  assert.equal(ev("Bash", { command: "git status" }, "always_ask").decision, "ask", "always_ask: every command asks");
  const rm = ev("Bash", { command: "rm -rf build" }, "before_changes");
  assert.equal(rm.decision, "ask"); assert.equal(rm.destructive, true, "destructive keeps the strong confirm");
  assert.equal(ev("Bash", { command: "ls" }, "before_changes").decision, "ask");
  // A preset never loosens a deny.
  assert.equal(ev("Write", { file_path: "/etc/passwd", content: "x" }, "important_only").decision, "deny", "outside the work folder stays denied");
  assert.equal(ev("Write", { file_path: "/Users/x/HypeProofClinic/index.html", content: "x" }, "before_changes").decision, "ask", "writes reach the host approval path");
}

console.log("approval-preset smoke: ok");
