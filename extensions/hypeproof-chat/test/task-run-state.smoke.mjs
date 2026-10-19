// REQ-STUDIO-TASK-RUN-STATE (AE-03, CGP-AGENT-R-022 recast) — the active task's run state, derived
// from what the webview already knows, plus the host's approval-wait signal (chatPanelProvider bundled
// with a scripted `vscode`, as clear-history.smoke.mjs does). The rail render is test/task-run-state.test.tsx.
//
// .claude/rules/verification.md §2: every state has a positive control (its inputs produce it) and the
// precedence rows are negative controls (a lower-priority input must NOT win over a higher one).
// Run: node --experimental-strip-types test/task-run-state.smoke.mjs

import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";

const { deriveTaskRunState, TASK_RUN_STATE_LABELS, taskRunAccessibleName } = await import("../src/taskRunState.ts");

let n = 0;
const t = (label, fn) => { fn(); n++; console.log(`  ok   ${label}`); };
const idle = { preparing: false, running: false, approvalPending: false, lastOutcome: null };

t("no evidence → no state (negative control: nothing is guessed)", () => {
  assert.equal(deriveTaskRunState(idle), null);
});
t("each state from its own input (positive controls)", () => {
  assert.equal(deriveTaskRunState({ ...idle, preparing: true }), "preparing");
  assert.equal(deriveTaskRunState({ ...idle, running: true }), "running");
  assert.equal(deriveTaskRunState({ ...idle, approvalPending: true }), "approval");
  assert.equal(deriveTaskRunState({ ...idle, lastOutcome: "stopped" }), "stopped");
  assert.equal(deriveTaskRunState({ ...idle, lastOutcome: "error" }), "error");
  assert.equal(deriveTaskRunState({ ...idle, lastOutcome: "done" }), "done");
});
t("precedence: approval > running > preparing", () => {
  assert.equal(deriveTaskRunState({ ...idle, approvalPending: true, running: true, preparing: true }), "approval");
  assert.equal(deriveTaskRunState({ ...idle, approvalPending: true, running: true }), "approval");
  assert.equal(deriveTaskRunState({ ...idle, running: true, preparing: true }), "running");
});
t("a live turn outranks the previous turn's outcome (negative controls: an old 오류/멈춤/끝남 never shows during a run)", () => {
  for (const lastOutcome of ["done", "stopped", "error"]) {
    assert.equal(deriveTaskRunState({ ...idle, lastOutcome, preparing: true }), "preparing");
    assert.equal(deriveTaskRunState({ ...idle, lastOutcome, running: true }), "running");
    assert.equal(deriveTaskRunState({ ...idle, lastOutcome, approvalPending: true }), "approval");
  }
});
t("labels: one short Korean label and a symbol per state", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TASK_RUN_STATE_LABELS).map(([k, v]) => [k, v.label])), {
    preparing: "응답 준비 중", running: "작업 중", approval: "승인 기다리는 중", stopped: "멈춤", error: "오류", done: "끝남",
  });
  for (const { label, symbol } of Object.values(TASK_RUN_STATE_LABELS)) {
    assert.ok(label.split(" ").length <= 3, `${label} is longer than three words`);
    assert.ok(symbol.length >= 1, `${label} has no symbol`);
  }
  const symbols = Object.values(TASK_RUN_STATE_LABELS).map((v) => v.symbol);
  assert.equal(new Set(symbols).size, symbols.length, "two states share a symbol");
});
t("accessible name: title then state; none without a state", () => {
  assert.equal(taskRunAccessibleName("고양이 페이지", "approval"), "고양이 페이지, 승인 기다리는 중");
  assert.equal(taskRunAccessibleName("고양이 페이지", null), undefined);
});

// The host half: resolveActionApprovalTracked reports a wait only while a modal it raised is open.
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
let release, modals = 0;
const vscode = {
  window: { showWarningMessage: async () => { modals++; return new Promise((r) => { release = r; }); } },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
const P = module.exports.ChatPanelProvider.prototype;
const posts = [];
const host = { approvalWaits: 0, post: async (m) => { posts.push(m); }, approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => "코치", resolveActionApproval: P.resolveActionApproval };
const waits = () => posts.filter((m) => m.type === "approvalWait").map((m) => m.waiting);
const tick = () => new Promise((r) => setTimeout(r, 0));

{
  const pending = P.resolveActionApprovalTracked.call(host, { requestId: "r1", kind: "executeShell", description: "", payload: { command: "rm -rf build" }, destructive: true });
  await tick();
  t("host: a raised modal reports 승인 기다리는 중 while it is open (positive control)", () => {
    assert.equal(modals, 1);
    assert.deepEqual(waits(), [true]);
  });
  release("실행");
  const approved = await pending;
  t("host: answering the modal clears the wait and keeps the answer", () => {
    assert.equal(approved, true);
    assert.deepEqual(waits(), [true, false]);
    assert.equal(host.approvalWaits, 0);
  });
}
{
  posts.length = 0;
  const before = modals;
  const allowed = await P.resolveActionApprovalTracked.call(host, { requestId: "r2", kind: "writeFile", description: "", payload: {} });
  host.approvedCommandSignatures.add("npm test");
  const remembered = await P.resolveActionApprovalTracked.call(host, { requestId: "r3", kind: "executeShell", description: "", payload: { command: "npm test" } });
  t("host: an auto-allowed or remembered request raises no modal and reports no wait (negative controls)", () => {
    assert.equal(allowed, true);
    assert.equal(modals, before, "a modal was raised");
    assert.deepEqual(waits(), [], "a wait was reported without a modal");
    assert.equal(typeof remembered, "boolean");
  });
}
{
  posts.length = 0;
  const failing = { ...host, approvalWaits: 0, resolveActionApproval: async (_req, onPrompted) => { onPrompted(); throw new Error("modal failed"); } };
  await assert.rejects(P.resolveActionApprovalTracked.call(failing, { requestId: "r4", kind: "openBrowser", description: "", payload: {} }));
  t("host: a modal that throws still clears the wait", () => {
    assert.deepEqual(waits(), [true, false]);
    assert.equal(failing.approvalWaits, 0);
  });
}

console.log(`task-run-state: ${n} checks passed`);
