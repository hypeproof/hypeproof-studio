// REQ-M4a — destructive-command detection survives quoting, escaping, env
// prefixes and wrappers, and fails closed on what it cannot read.
//
// Found by an independent verifier on main (2026-10-20): `\rm -rf ~`,
// `'rm' -rf ~`, `FOO=1 rm -rf ~`, `git push '--force'` and friends auto-ran
// on any cohort with shell enabled, because the SDK gate runs whatever
// isDestructiveCommand passes and that function read raw words.
//
// One table, every gate: the SDK canUseTool verdict, the approval modal
// (action mapping + shellApprovalFor) and the local runtime.
//
// Run: node --experimental-strip-types test/shell-normalise.smoke.mjs

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { isDestructiveCommand, commandSignature, shellApprovalFor } = await import("../src/shellPolicy.ts");
const { evaluateSdkToolUse, permittedToolsFor, sdkToolToActionRequest } = await import("../src/sdkCoachHelpers.ts");
const { workspaceTools } = await import("../src/localRuntime/tools.ts");

const { BYPASS_FORMS, SAFE_COMMANDS } = await import("./fixtures/shell-normalise-table.mjs");

assert.ok(BYPASS_FORMS.length >= 40, `bypass table has ${BYPASS_FORMS.length} rows`);
assert.ok(SAFE_COMMANDS.length >= 20, `safe table has ${SAFE_COMMANDS.length} rows`);

// ─── Gate 0: the policy function ─────────────────────────────────────────────
{
  const missed = BYPASS_FORMS.filter((c) => !isDestructiveCommand(c));
  assert.deepEqual(missed, [], `destructive forms that auto-run:\n  ${missed.map((c) => JSON.stringify(c)).join("\n  ")}`);
  const flagged = SAFE_COMMANDS.filter((c) => isDestructiveCommand(c));
  assert.deepEqual(flagged, [], `ordinary commands that would now ask:\n  ${flagged.map((c) => JSON.stringify(c)).join("\n  ")}`);
  for (const c of BYPASS_FORMS) assert.equal(commandSignature(c), null, `never remembered: ${JSON.stringify(c)}`);
  console.log(`✓ policy — ${BYPASS_FORMS.length} bypass forms destructive, ${SAFE_COMMANDS.length} ordinary commands not`);
}

// ─── Gate 1: SDK canUseTool (evaluateSdkToolUse) ─────────────────────────────
const shellCohort = {
  profile_id: "copyclone-adult-shell",
  sdk_tools: { read: true, write: true, shell: true },
  game: { template_tier: "website" },
};
const permitted = permittedToolsFor(shellCohort);
const sdkVerdict = (command) =>
  evaluateSdkToolUse({ toolName: "Bash", input: { command }, permittedTools: permitted, workspaceRoot: "/Users/x/Work" });
{
  for (const c of BYPASS_FORMS) {
    assert.deepEqual(sdkVerdict(c), { decision: "ask", destructive: true }, `SDK strong confirm: ${JSON.stringify(c)}`);
  }
  // CGP-AGENT-R-005 (shellLinkPolicy): at the SDK gate, commands that can materialise links (git checkout/switch/…)
  // and commands this layer cannot read (command substitution) get the strong confirm, fail closed. They stay
  // non-destructive for the modal's own check below.
  const LINK_GATED = new Set(["git checkout main", "git checkout -b feature", 'echo "$(date)"']);
  for (const c of SAFE_COMMANDS) {
    const want = LINK_GATED.has(c) ? { decision: "ask", destructive: true } : { decision: "allow" };
    assert.deepEqual(sdkVerdict(c), want, `SDK verdict: ${JSON.stringify(c)}`);
  }
  for (const c of LINK_GATED) assert.ok(SAFE_COMMANDS.includes(c), `LINK_GATED entry is in the table: ${c}`);
  console.log("✓ SDK canUseTool — every bypass form asks with the strong confirm; ordinary commands auto-run");
}

// ─── Gate 2: the approval modal ──────────────────────────────────────────────
// The modal re-derives the flag from the command (it can only add one), so a
// request that reaches it without the SDK verdict's flag still gets the strong
// confirm and can never be remembered.
{
  for (const c of BYPASS_FORMS) {
    const req = sdkToolToActionRequest({ toolName: "Bash", input: { command: c } });
    assert.equal(req.kind, "executeShell");
    assert.equal(req.destructive, true, `action request flagged without the verdict: ${JSON.stringify(c)}`);
    assert.deepEqual(shellApprovalFor(c, false), { destructive: true, signature: null }, `modal strong confirm: ${JSON.stringify(c)}`);
    assert.deepEqual(shellApprovalFor(c, true), { destructive: true, signature: null });
  }
  for (const c of SAFE_COMMANDS) {
    const req = sdkToolToActionRequest({ toolName: "Bash", input: { command: c } });
    assert.equal(req.destructive, undefined, `ordinary command not flagged: ${JSON.stringify(c)}`);
    assert.equal(shellApprovalFor(c, false).destructive, false, `modal normal confirm: ${JSON.stringify(c)}`);
    // A flag the SDK verdict set is never dropped by the modal.
    assert.deepEqual(shellApprovalFor(c, true), { destructive: true, signature: null });
  }
  assert.deepEqual(shellApprovalFor("git status", false), { destructive: false, signature: "git status" });
  console.log("✓ approval modal — flag re-derived from the command, never dropped, never remembered");
}

// ─── Gate 3: the local runtime ───────────────────────────────────────────────
// The local runtime offers no shell tool at all: every command, bypass form or
// not, is refused before it can run, and nothing on disk changes.
{
  const root = await mkdtemp(join(tmpdir(), "studio-shell-normalise-"));
  try {
    const cwd = join(root, "work");
    await mkdir(cwd);
    const canary = join(cwd, "canary.txt");
    await writeFile(canary, "still here");
    let asks = 0;
    const tools = workspaceTools({
      cwd,
      profile: shellCohort,
      signal: new AbortController().signal,
      approve: async () => {
        asks++;
        return true;
      },
    });
    assert.ok(!tools.definitions.some((d) => /bash|shell|powershell/i.test(d.name)), "no shell tool is offered");
    for (const c of [...BYPASS_FORMS, ...SAFE_COMMANDS]) {
      await assert.rejects(tools.call("Bash", { command: c.replaceAll("~", cwd) }), undefined, `local runtime refuses: ${JSON.stringify(c)}`);
    }
    assert.equal(asks, 0, "no approval was even asked");
    assert.equal(await readFile(canary, "utf8"), "still here");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("✓ local runtime — no shell tool; every command refused before it runs");
}

console.log("✓ shell-normalise smoke passed");
