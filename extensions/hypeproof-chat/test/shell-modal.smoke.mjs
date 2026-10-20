// REQ-M4a — the approval modal itself re-checks every shell command.
//
// shell-normalise.smoke.mjs covers the pure helper (shellApprovalFor). This file
// drives the real ChatPanelProvider.resolveActionApproval (bundled with a
// scripted `vscode`, as task-run-state.smoke.mjs does) with requests that carry
// NO destructive flag. If a merge drops the modal's re-check (for example by
// going back to `req.destructive === true` plus commandSignature), every bypass
// row below gets the normal confirm or a remembered pass, and this fails.
//
// Run: node --experimental-strip-types test/shell-modal.smoke.mjs

import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";

const { BYPASS_FORMS, SAFE_COMMANDS } = await import("./fixtures/shell-normalise-table.mjs");
const { TaskCommandAllows, TASK_COMMAND_ALLOW_LABEL } = await import("../src/taskCommandAllow.ts");

const STRONG_TITLE = "⚠️ 되돌리기 어려운 명령이에요. 정말 실행할까요?";

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error",
});
/** Every modal the host raised: [message, options, ...buttons]. Answered "cancel" unless `onModal` picks. */
const modals = [];
/** Optional scripted answer for the next modal: (args) => button label. */
let onModal = null;
const infos = [];
const vscode = {
  window: {
    showWarningMessage: async (...args) => { modals.push(args); return onModal ? onModal(args) : undefined; },
    showInformationMessage: async (m) => { infos.push(m); return undefined; },
  },
  workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)),
  console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder,
});
const P = module.exports.ChatPanelProvider.prototype;

/** The words a naive "always allow" key would use: the first two words, quotes and all. */
const naiveSignatures = (c) => {
  const words = c.trim().split(/\s+/);
  return [words[0], words.slice(0, 2).join(" "), words[0]?.replace(/^.*\//, "").replace(/^\\/, "").replace(/['"]/g, "")];
};

const ask = async (command, { destructive, remembered = [] } = {}) => {
  // CGP-AGENT-R-004: the remember store is per task and keyed by the exact command; plant every
  // naive key AND the exact command, so a destructive form must still get the strong confirm.
  const taskCommandAllows = new TaskCommandAllows();
  for (const k of [...remembered, command.trim().split(/[ \t]+/).join(" ")]) if (remembered.length) taskCommandAllows.remember("task", k);
  const host = {
    taskCommandAllows,
    taskCommandAllowState: () => ({ key: "task", refusal: null }),
    approvedBrowserOrigins: new Set(),
    coachDisplayName: () => "코치",
  };
  const before = modals.length;
  const approved = await P.resolveActionApproval.call(host, {
    requestId: "r", kind: "executeShell", description: "", payload: { command },
    ...(destructive === undefined ? {} : { destructive }),
  });
  return { approved, raised: modals.slice(before) };
};

let n = 0;
// Positive controls: every bypass form, sent without the verdict's flag and with
// a naive "always allow" already granted for its leading words, still raises
// the strong confirm, with no "항상 허용" button, and runs nothing when cancelled.
for (const c of BYPASS_FORMS) {
  for (const destructive of [undefined, false]) {
    const { approved, raised } = await ask(c, { destructive, remembered: naiveSignatures(c) });
    assert.equal(raised.length, 1, `modal raised: ${JSON.stringify(c)}`);
    const [message, options, ...buttons] = raised[0];
    assert.equal(message, STRONG_TITLE, `strong confirm: ${JSON.stringify(c)}`);
    assert.equal(options?.modal, true);
    assert.deepEqual(buttons, ["실행", "취소"], `no 항상 허용 on a destructive command: ${JSON.stringify(c)}`);
    assert.equal(approved, false, `cancel runs nothing: ${JSON.stringify(c)}`);
    n++;
  }
}
console.log(`  ok   modal — ${BYPASS_FORMS.length} bypass forms without the flag get the strong confirm (${n} requests)`);

// Negative controls: ordinary commands get the normal confirm with a remember
// button, a remembered one passes silently, and the verdict's flag is never
// dropped by the modal.
{
  const { raised } = await ask("git status");
  assert.equal(raised.length, 1);
  assert.notEqual(raised[0][0], STRONG_TITLE, "ordinary command: normal confirm");
  assert.ok(raised[0].slice(2).includes(TASK_COMMAND_ALLOW_LABEL), "ordinary command can be remembered for this task");
  const remembered = await ask("git status", { remembered: ["git status"] });
  assert.deepEqual([remembered.approved, remembered.raised.length], [true, 0], "remembered → silent");
  let normal = 0;
  for (const c of SAFE_COMMANDS) {
    const { raised: r } = await ask(c);
    assert.equal(r.length, 1, `modal raised: ${JSON.stringify(c)}`);
    assert.notEqual(r[0][0], STRONG_TITLE, `ordinary, but strong confirm: ${JSON.stringify(c)}`);
    normal++;
    const flagged = await ask(c, { destructive: true });
    assert.equal(flagged.raised[0][0], STRONG_TITLE, `the verdict's flag is kept: ${JSON.stringify(c)}`);
  }
  // A carried flag beats a remembered exact key: the key for `git status` is planted, the request
  // arrives with destructive: true, and it still gets the strong confirm with no remember button.
  {
    const planted = await ask("git status", { destructive: true, remembered: ["git status"] });
    assert.equal(planted.raised.length, 1, "carried flag + remembered key: still asks");
    assert.equal(planted.raised[0][0], STRONG_TITLE, "carried flag + remembered key: strong confirm");
    assert.deepEqual(planted.raised[0].slice(2), ["실행", "취소"], "carried flag + remembered key: no remember button");
    assert.equal(planted.approved, false);
  }
  console.log(`  ok   modal — ${normal} ordinary commands get the normal confirm; a carried flag is never dropped`);
}

// The scope is read from the host, not only from the store. A host whose scope is scripted shows
// two checks that the real provider tests cannot reach without legacy data:
{
  const scoped = (scopeRef, store) => ({
    taskCommandAllows: store,
    taskCommandAllowState: () => ({ key: scopeRef.key, refusal: scopeRef.refusal }),
    approvedBrowserOrigins: new Set(),
    coachDisplayName: () => "코치",
  });
  const send = (host, command) => P.resolveActionApproval.call(host, { requestId: "r", kind: "executeShell", description: "", payload: { command } });
  const silent = async (host, command) => { const before = modals.length; const ok = await send(host, command); return ok === true && modals.length === before; };

  // (a) A refused scope in between (read-only consent with no write stamp, e.g. legacy data where
  // the scope key does not change on full → read → full) still ends the allow: the store observes
  // the refused scope before refusing.
  {
    const scope = { key: "full", refusal: null };
    const store = new TaskCommandAllows();
    const host = scoped(scope, store);
    store.remember("full", "git status");
    assert.equal(await silent(host, "git status"), true, "positive control: remembered → silent");
    Object.assign(scope, { key: "read", refusal: "읽기만 허용된 폴더예요." });
    assert.equal(await send(host, "git status"), false, "read-only scope refuses");
    Object.assign(scope, { key: "full", refusal: null });
    assert.equal(await silent(host, "git status"), false, "full → read → full with the same key: asked again");
  }

  // (b) A scope change while the modal is open is not remembered, even when the scope is back by
  // the next request (no shell request observed the change, so the generation did not move).
  {
    const scope = { key: "s1", refusal: null };
    const store = new TaskCommandAllows();
    const host = scoped(scope, store);
    onModal = () => { scope.key = "s2"; return TASK_COMMAND_ALLOW_LABEL; };
    assert.equal(await send(host, "git status"), true, "the learner picked the remember button");
    onModal = null;
    scope.key = "s1";
    assert.equal(await silent(host, "git status"), false, "scope changed during the modal: not remembered");
    // Negative control: the same pick with a steady scope is remembered.
    onModal = () => TASK_COMMAND_ALLOW_LABEL;
    await send(host, "git log --oneline");
    onModal = null;
    assert.equal(await silent(host, "git log --oneline"), true, "steady scope: remembered");
  }
  console.log("  ok   modal — a refused scope in between and a scope change during the modal both end the allow");
}

console.log("✓ shell-modal smoke passed");
