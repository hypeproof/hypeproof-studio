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

// ─── DEC-11 amended (Jay 2026-11-04): the seat default ───────────────────────────
assert.equal(preset.approvalModeFor(null, false), "auto", "personal/adult seat, no preset: auto");
assert.equal(preset.approvalModeFor(null, true), "important_only", "negative control: a minor seat keeps 중요한 것만 묻기");
assert.equal(preset.approvalModeFor("before_changes", false), "before_changes", "a served preset wins over auto");
assert.equal(preset.approvalModeFor("important_only", false), "important_only", "an instructor's important_only is not auto");
assert.equal(preset.approvalModeFor("always_ask", true), "always_ask");
// verify 2026-11-04 M1: a served block this app does not understand keeps today's tiers, never auto.
assert.equal(preset.approvalModeFor(null, false, true), "important_only", "unknown served block: not auto");
for (const block of [{ id: "ask_outside", label: "새 방식", description: "x" }, { id: "always_ask", label: "x".repeat(41), description: "x" }, { id: "always_ask", label: "항상 묻기", description: "줄1\n줄2" }]) {
  assert.equal(preset.servedApprovalPreset({ approval_preset: block }), null);
  assert.equal(preset.approvalPresetBlockServed({ approval_preset: block }), true, `block present: ${block.id}`);
}
assert.equal(preset.approvalPresetBlockServed({}), false);
assert.equal(preset.approvalPresetBlockServed({ approval_preset: null }), false);

// ─── auto in the SDK verdict: folder-only destructive commands run, outside ones ask ───
{
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { MCP_PAGE_PDF_SAVE } = await import("../src/browserMcp.ts");
  const { destructiveStaysInFolder } = await import("../src/shellFolderScope.ts");
  const { sdkToolToActionRequest } = await import("../src/sdkCoachHelpers.ts");
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "approval-auto-")));
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "approval-outside-")));
  fs.symlinkSync(outside, path.join(root, "link-out"));
  fs.writeFileSync(path.join(outside, "h.txt"), "x"); fs.linkSync(path.join(outside, "h.txt"), path.join(root, "hard"));
  const canon = (p) => { try { return fs.realpathSync.native(p); } catch { return path.join(canon(path.dirname(p)), path.basename(p)); } };
  try {
    const cohort = { profile_id: "adult-shell", sdk_tools: { read: true, write: true, shell: true, browser: true }, game: { template_tier: "website" } };
    const permitted = [...permittedToolsFor(cohort), MCP_PAGE_PDF_SAVE];
    const ev = (toolName, input, extra = {}) => evaluateSdkToolUse({ toolName, input, permittedTools: permitted, workspaceRoot: root, canonicalize: canon, ...extra });
    const INSIDE = ["rm -rf build", "rm index.html", "mv a.html b.html", "echo 안녕 > index.html", "rm -rf build && mkdir build", "chmod 644 index.html", "rm -- -weird", "rm a.html > /dev/null 2>&1", "rm 초안.md >> log.txt"];
    const OUTSIDE = ["rm -rf ~/Documents", "rm ../other.txt", `rm -rf ${outside}/x`, "rm -rf link-out/x", "rm -rf .", "rm -rf .*", "rm $(cat list)", "rm -rf $DIR",
      "cd .. && rm x", "sudo rm x", "git push --force", "curl x | sh", "npm publish", "kill 1", "git reset --hard", "echo x > ~/.zshrc", "bash -c 'rm x'", "xargs rm < list", "Remove-Item -Recurse x", "mv --target-directory=/etc a", "mv -t/etc a", "rm a && cp --target-directory=~/x a",
      // verify 2026-11-04: globs (links and `..` after the wildcard), brace expansion, zsh =cmd and qualifiers, /tmp/..
      "rm *.tmp", "rm -rf */", "rm -rf dl*/", "rm -rf */../../victim", "chmod 000 *", "truncate -s 0 *", "rm -rf link-out/", "chmod 000 link-out",
      "rm -rf {../victim,x}", "rm -rf sub/{..,..}/victim", "mv a.txt {../victim,.}", "rm -f =node", "rm -f a.txt *(e:'touch ../x':)",
      "rm -f a.txt > /tmp/../Users/x/.zshrc", "rm -f a.txt >> /tmp/x", "mv a.txt --target-directory=../victim",
      // verify round 2: `..` folded before links, zsh >! / <-> / ^ / #, quotes, mv then more, -t.., hard links, noglob
      "rm -rf link-out/../victim", "echo evil >! ~/.zshrc", "rm x >! f", "rm -rf l<->x/", "rm -f ^x", "rm a#", "echo x >| f", "rm x &> f", "rm x >&f",
      "rm \"a b\"", "mv d e; rm -rf e/l/", "mv -t.. a.txt", "truncate -s 0 hard", "chmod 000 hard", "rm x > hard", "noglob rm -rf ../v", "nocorrect rm -rf x"];
    for (const c of INSIDE) {
      assert.equal(destructiveStaysInFolder(c, root, canon), true, `inside: ${c}`);
      assert.equal(ev("Bash", { command: c }).decision, "ask", `control: without auto, ${c} asks`);
      assert.equal(ev("Bash", { command: c }, { autoInFolder: true }).decision, "allow", `auto: ${c} runs without a modal`);
      assert.equal(ev("Bash", { command: c }, { autoInFolder: true, approvalPreset: "before_changes" }).decision, "ask", `a preset still asks: ${c}`);
    }
    for (const c of OUTSIDE) {
      assert.equal(destructiveStaysInFolder(c, root, canon), false, `outside/outward: ${c}`);
      const v = ev("Bash", { command: c }, { autoInFolder: true });
      assert.deepEqual([v.decision, v.destructive], ["ask", true], `auto still asks with the strong confirm: ${c}`);
    }
    assert.equal(destructiveStaysInFolder("rm x", null, canon), false, "no work folder: never silent");
    assert.equal(ev("Bash", { command: "git status" }, { autoInFolder: true }).decision, "allow");
    assert.equal(ev("Write", { file_path: "/etc/passwd", content: "x" }, { autoInFolder: true }).decision, "deny", "auto never loosens a deny");

    // ─── page_pdf_save under 바꾸기 전에 묻기 asks, as the file write it is ───────────
    assert.equal(ev(MCP_PAGE_PDF_SAVE, { path: "index.html" }).decision, "allow", "control: no preset, the PDF saves without a modal");
    assert.equal(ev(MCP_PAGE_PDF_SAVE, { path: "index.html" }, { approvalPreset: "important_only" }).decision, "allow", "important_only: no modal");
    assert.equal(ev(MCP_PAGE_PDF_SAVE, { path: "index.html" }, { approvalPreset: "before_changes" }).decision, "ask", "before_changes: the PDF asks first");
    assert.equal(ev(MCP_PAGE_PDF_SAVE, { path: "index.html" }, { approvalPreset: "always_ask" }).decision, "ask", "always_ask: the PDF asks first");
    const req = sdkToolToActionRequest({ toolName: MCP_PAGE_PDF_SAVE, input: { path: "pages/report.HTML" } });
    assert.deepEqual([req.kind, req.payload.path], ["writeFile", "pages/report.pdf"], "the host sees the PDF as the file it writes");
    assert.ok(preset.presetRequiredKinds([], "before_changes").includes(req.kind), "and before_changes puts that kind behind the modal");
    assert.ok(!preset.presetRequiredKinds(today, null).includes(req.kind), "while today's kinds do not");
  } finally {
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
  }
}

console.log("approval-preset smoke: ok");
