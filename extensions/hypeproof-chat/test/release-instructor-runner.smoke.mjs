// #3597 (chalk#14): the instructor's own CLI subscription runs on the release app. The gate is separate from
// the Dev-only gate (localRuntimeConfig), reads no credential files, and sends only a CLI status command's
// success or failure. The app name is injected so the release branch is tested in both directions.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { localRuntimeConfig } from "../src/localRuntime/index.ts";
import { releaseInstructorRuntime, releaseGateNotice, instructorLocalRuntime, shouldRecheckRelease } from "../src/localRuntime/releaseInstructorRuntime.ts";
import { cliLoginOk, releaseCliEnv } from "../src/localRuntime/cliLocate.ts";
import { subscriptionEnv } from "../src/localRuntime/process.mjs";

let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const ABS = "/Users/instructor/.local/bin/claude";
const OPEN = { isInstructor: true, panelMode: "instructor", rehearsal: false, storedInstructorCredential: false, setting: true, env: {} };
// Stub deps: locate and login are the only external reads; the counters show what was asked.
function deps({ locate = () => ABS, loginOk = async () => true } = {}) {
  const calls = { locate: 0, login: 0 };
  return {
    calls,
    locate: (provider) => { calls.locate++; return locate(provider); },
    loginOk: async (exe, provider) => { calls.login++; return loginOk(exe, provider); },
  };
}

console.log("=== release instructor runner (#3597) ===");

await t("release name, instructor, setting on, CLI present and logged in: the gate opens with an absolute path", async () => {
  const d = deps();
  const r = await releaseInstructorRuntime({ ...OPEN, env: {} }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.config.provider, "claude");
  assert.equal(r.config.executable, ABS);
});

await t("dev-only env does not open the release gate: HPS_DEV_EXECUTABLE is ignored, no CLI found means closed", async () => {
  const d = deps({ locate: () => null });
  const r = await releaseInstructorRuntime({ ...OPEN, env: { HPS_DEV_RUNTIME: "1", HPS_DEV_EXECUTABLE: "/tmp/fake-claude", HPS_DEV_PROVIDER: "claude", HPS_DEV_MODEL: "x" } }, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_cli");
});

await t("the Dev gate stays closed on the release app name even with HPS_DEV_RUNTIME=1 (#1317)", () => {
  const cfg = localRuntimeConfig("HypeProof Studio", "http://127.0.0.1:8787/v1", { HPS_DEV_RUNTIME: "1", HPS_DEV_PROVIDER: "claude", HPS_DEV_EXECUTABLE: ABS, HPS_DEV_MODEL: "sonnet" });
  assert.equal(cfg, null);
});

await t("positive control: the Dev name with HPS_DEV_RUNTIME=1 still opens the Dev runner", () => {
  const cfg = localRuntimeConfig("HypeProof Studio Dev", "http://127.0.0.1:8787/v1", { HPS_DEV_RUNTIME: "1", HPS_DEV_PROVIDER: "claude", HPS_DEV_EXECUTABLE: ABS, HPS_DEV_MODEL: "sonnet" });
  assert.notEqual(cfg, null);
});

await t("the provider uses the Dev runner first and the release gate only when the Dev runner is absent", () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /localRuntimeConfig\(vscode\.env\.appName, proxyUrl\) \?\? instructorLocalRuntime\(/);
  // A stub host without the release fields must still work (the #3580 lesson): no method call on `this` here.
  assert.doesNotMatch(src, /this\.localRuntimeFor\(/);
});

await t("a learner (student token, not instructor) is closed and no CLI is looked up", async () => {
  const d = deps();
  const r = await releaseInstructorRuntime({ ...OPEN, isInstructor: false }, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_instructor");
  assert.equal(d.calls.locate, 0, "no CLI lookup for a learner");
  assert.equal(d.calls.login, 0);
});

await t("a student slot is closed even for an instructor token", async () => {
  const d = deps();
  const r = await releaseInstructorRuntime({ ...OPEN, panelMode: "student" }, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "student_slot");
  assert.equal(d.calls.locate, 0);
});

await t("the setting off (the default) is closed and no CLI is looked up", async () => {
  const d = deps();
  const r = await releaseInstructorRuntime({ ...OPEN, setting: false }, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "setting_off");
  assert.equal(d.calls.locate, 0);
});

await t("a rehearsal seat is closed this time, with or without a stored instructor credential", async () => {
  for (const stored of [false, true]) {
    const d = deps();
    const r = await releaseInstructorRuntime({ ...OPEN, rehearsal: true, storedInstructorCredential: stored }, d);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "rehearsal");
    assert.equal(d.calls.locate, 0);
  }
});

await t("no CLI installed is closed with a reason, not a crash", async () => {
  const r = await releaseInstructorRuntime({ ...OPEN }, deps({ locate: () => null }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_cli");
});

await t("a relative CLI path is refused (the executable must be absolute)", async () => {
  const r = await releaseInstructorRuntime({ ...OPEN }, deps({ locate: () => "claude" }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "relative_path");
});

await t("a CLI that is installed but not logged in is closed with login_failed", async () => {
  const r = await releaseInstructorRuntime({ ...OPEN }, deps({ loginOk: async () => false }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "login_failed");
});

await t("the notice for each closed reason names the cause without numbers, paths or output", () => {
  for (const reason of ["no_cli", "login_failed", "relative_path"]) {
    const copy = releaseGateNotice(reason);
    assert.ok(copy.length > 0, reason);
    assert.doesNotMatch(copy, /[0-9]/, `${reason} copy has no digits`);
    assert.doesNotMatch(copy, /[\/\\]/, `${reason} copy has no paths`);
  }
});

await t("cliLoginOk uses only the exit status: a status command that prints a secret returns a boolean and nothing else", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hps-cli-"));
  const ok = path.join(dir, "ok-cli");
  const bad = path.join(dir, "bad-cli");
  writeFileSync(ok, "#!/bin/sh\necho SECRET-TOKEN-VALUE\nexit 0\n");
  writeFileSync(bad, "#!/bin/sh\necho SECRET-TOKEN-VALUE\nexit 1\n");
  chmodSync(ok, 0o755);
  chmodSync(bad, 0o755);
  assert.equal(await cliLoginOk(ok, "claude"), true);
  assert.equal(await cliLoginOk(bad, "claude"), false);
});

await t("the CLI child environment drops vendor API keys, HPS_* values and token-shaped names", () => {
  const env = releaseCliEnv({ PATH: "/usr/bin", HOME: "/Users/x", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b", CODEX_API_KEY: "c", HPS_ISSUER_TOKEN: "d", MY_SECRET: "e", GITHUB_TOKEN: "f" });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.HPS_ISSUER_TOKEN, undefined);
  assert.equal(env.MY_SECRET, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(subscriptionEnv({ ANTHROPIC_API_KEY: "a", HPS_X: "b" }).ANTHROPIC_API_KEY, undefined);
});

await t("no credential file is read by the gate or the CLI probe (static check of the new modules)", () => {
  for (const f of ["../src/localRuntime/releaseInstructorRuntime.ts", "../src/localRuntime/cliLocate.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /readFileSync|readFile\(|createReadStream|auth\.json|\.credentials|keychain|Keychain/, f);
  }
});

// Review fixes (#3608): the release runner is an instructor-turn resource only, and a closed gate for a missing CLI or a failed login is re-checked on the next instructor turn.
const RELEASE_CFG = { provider: "claude", executable: ABS, model: "sonnet", label: "Claude Code · 로컬 구독 · sonnet" };
await t("a learner turn never receives the release runner, even when the gate was open before the panel changed", () => {
  // The panel changed to a student seat: isInstructor is false, so the learner lookup gets nothing from the release gate.
  assert.equal(instructorLocalRuntime(false, RELEASE_CFG), null);
  assert.deepEqual(instructorLocalRuntime(true, RELEASE_CFG), RELEASE_CFG);
  assert.equal(instructorLocalRuntime(true, null), null);
});

await t("the provider reads the release runner only through instructorLocalRuntime (no direct learner-path read)", () => {
  const src = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const reads = src.split("\n").filter((line) => /this\.releaseRuntime\b/.test(line) && !/private releaseRuntime|this\.releaseRuntime = /.test(line));
  assert.ok(reads.length > 0);
  for (const line of reads) assert.match(line, /instructorLocalRuntime\(/, line.trim().slice(0, 120));
});

await t("a closed gate for a missing CLI or a failed login is checked again on the next instructor turn; other reasons are not", () => {
  assert.equal(shouldRecheckRelease("no_cli"), true);
  assert.equal(shouldRecheckRelease("login_failed"), true);
  assert.equal(shouldRecheckRelease("setting_off"), false);
  assert.equal(shouldRecheckRelease("not_instructor"), false);
  assert.equal(shouldRecheckRelease("rehearsal"), false);
  assert.equal(shouldRecheckRelease(undefined), false);
});

await t("a gate closed for no CLI opens after the instructor installs and logs in (re-check)", async () => {
  let installed = false;
  const deps = { locate: () => (installed ? ABS : null), loginOk: async () => true };
  const first = await releaseInstructorRuntime({ ...OPEN }, deps);
  assert.equal(first.reason, "no_cli");
  installed = true;
  const again = await releaseInstructorRuntime({ ...OPEN }, deps);
  assert.equal(again.ok, true);
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall release-instructor-runner checks passed");
