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

const STRONG_TITLE = "⚠️ 되돌리기 어려운 명령이에요. 정말 실행할까요?";

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [new URL("../src/chatPanelProvider.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error",
});
/** Every modal the host raised: [message, options, ...buttons]. Each one is answered "cancel". */
const modals = [];
const vscode = {
  window: { showWarningMessage: async (...args) => { modals.push(args); return undefined; } },
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
  const host = {
    approvedCommandSignatures: new Set(remembered),
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
  assert.ok(raised[0].slice(2).includes("항상 허용 (git status)"), "ordinary command can be remembered");
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
  console.log(`  ok   modal — ${normal} ordinary commands get the normal confirm; a carried flag is never dropped`);
}

console.log("✓ shell-modal smoke passed");
