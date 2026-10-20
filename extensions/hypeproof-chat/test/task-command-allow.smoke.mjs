// CGP-AGENT-R-004 (REQ-E1 / REQ-M17) — "이번 작업 동안 이 명령 허용" lasts only for this task and
// covers only the exact command.
//
// 1–3 are pure (taskCommandAllow.ts): the label, the exact-command key (any change asks again; the
// earlier "same kind" bypass tables stay null or asked), and the store forgets on any scope change.
// 4 runs the real resolveActionApproval (chatPanelProvider bundled with esbuild) against a fake VS Code
// surface, as folder-consent.smoke.mjs §10 does: within a task an exact repeat is allowed; a task switch,
// a new task, a folder rebind, a consent change, another activity and a reload never carry it over;
// read-only consent refuses before any allow is read. The captured modal text is written to
// $HPS_TASK_ALLOW_CAPTURE when set.
//
// .claude/rules/verification.md §2: every "applies" check has a negative control next to it.
// Run: node --experimental-strip-types test/task-command-allow.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

const A = await import("../src/taskCommandAllow.ts");
const FC = await import("../src/folderConsent.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "task-command-allow-")));
const LABEL = "이번 작업 동안 이 명령 허용";
/** The remembered key, or null (never remembered). */
const key = (c) => A.taskCommandExact(c)?.key ?? null;
/** `variant` is asked again after `base` was allowed: it is never remembered or has another key. */
const asksAgain = (base, variant) => key(variant) === null || key(variant) !== key(base);

try {
  // ── 1. The label and the copy ──
  {
    assert.equal(A.TASK_COMMAND_ALLOW_LABEL, LABEL);
    assert.ok(!A.TASK_COMMAND_ALLOW_LABEL.includes("항상"), "the label never says 항상");
    assert.ok(!A.TASK_COMMAND_ALLOW_LABEL.includes("같은 종류"), "the label no longer promises a kind");
    assert.equal("taskCommandKind" in A, false, "the widening kind is gone");
    assert.equal("taskCommandKindLine" in A, false, "the 같은 종류 line is gone");
    // Undecided consent never says the learner chose.
    assert.doesNotMatch(FC.folderShellUndecidedNotice(), /골랐어요/);
    assert.match(FC.folderShellUndecidedNotice(), /아직 고르지 않아서 명령을 실행하지 않았어요/);
    // A refused command says 명령 실행, not 파일 저장.
    assert.match(FC.folderShellRefusalNotice(), /명령 실행/);
    assert.doesNotMatch(FC.folderShellRefusalNotice(), /파일 저장|저장하려면/);
    ok("label: 이번 작업 동안 이 명령 허용, never 항상 or 같은 종류; shell refusal copy names 명령 실행");
  }

  // ── 2. The exact command: a repeat is allowed, any change asks again ──
  {
    // Positive controls: an exact repeat has the same key; only runs of spaces and tabs are collapsed.
    const ORDINARY = [
      "git status", "git diff", "git diff --stat", "git diff --cached", "git log --oneline", "git log --oneline --graph --all", "git show", "git show --stat", "git status -sb",
      "ls", "ls -la", "ls src", "cat README.md", "cat 문서.md", "cat 초안.md", "echo 안녕하세요", "echo a#b", "pwd", "mkdir site", "touch index.html",
      "grep -rn foo .", "head README.md", "tail -n 20 log.txt", "wc -l a.txt",
    ];
    for (const c of ORDINARY) assert.equal(key(c), c, `exact repeat is remembered: ${c}`);
    assert.equal(key("cat 문서.md".normalize("NFD")), "cat 문서.md".normalize("NFD"), "NFD Hangul file name");
    assert.equal(key("  git   status\t"), "git status", "spaces and tabs collapse");
    assert.equal(key("git\tstatus"), "git status");
    assert.equal(key("git status"), key("git  status"));
    // Any change at all asks again.
    const CHANGES = [
      ["git status", "git status --short", "an added flag"],
      ["git status", "git diff", "a different git subcommand"],
      ["git log --oneline", "git log --oneline --stat", "an added flag"],
      ["cat README.md", "cat README.md ~/.ssh/id_rsa", "an outside path"],
      ["cat README.md", "cat README.md secret.txt", "an extra file"],
      ["ls src", "ls src ../..", "a parent path"],
      ["echo 안녕하세요", "echo 안녕", "a different word"],
    ];
    for (const [base, variant, why] of CHANGES) {
      assert.notEqual(key(base), null, `precondition: ${base} is rememberable`);
      assert.ok(asksAgain(base, variant), `${why}: ${variant} must ask again after ${base}`);
    }
    // Round 5: the positive allowlist. Programs that run another program or fetch remote code are
    // never offered the allow (they still run with the one-time approval).
    const NOT_ALLOWLISTED = [
      // verify-5 repros
      "git clone -u ./evil.sh src dest", "git clone -qu ./evil.sh src dest", "git clone --no-local -u ./evil.sh src dest", "git clone -u sh src dest",
      "npm install foo@file:../evil", "npm install foo@../evil", "npm install foo@file:/tmp/x", "npm install foo@github:evil/x", "npm install evil/repo",
      "git clone host:../x", "git clone github.com:evil/repo", "git ls-remote evil:x", "git archive --remote=evil:x HEAD",
      // remote or executing git subcommands, and git commit (runs hooks)
      "git clone src dest", "git commit", "git commit --all", "git fetch origin", "git pull", "git push origin main", "git submodule update", "git ls-remote origin", "git commit -m 초안", "git add .",
      "git rebase main", "git checkout -b feat", "git config user.name x", "git grep foo", "git tag v1.0",
      // package managers and interpreters
      "npm test", "npm run build", "npm install express", "pnpm install", "yarn", "bun install", "node app.js", "python3 main.py", "python app.py", "pip install requests", "pip3 install requests",
      // other programs
      "cp a.txt b.txt", "find . -name x", "make build", "npx serve", "curl x", "open index.html",
    ];
    for (const c of NOT_ALLOWLISTED) assert.equal(key(c), null, `not allowlisted: ${JSON.stringify(c)}`);
    // Absolute nulls: even an exact repeat of these is asked again.
    const NEVER = [
      // env assignments, wrappers, paths, unlisted and case-variant command words
      "FOO=1 rm a.txt", "FOO=1 git status", "A=b", "env git status", "time ls", "nice cat a",
      "nohup ls", "command git status", "builtin cd x", "exec git status", "sudo ls", "xargs cat", "bash a.sh", "sh a.sh", "zsh a.sh",
      "ENV git status", "Ls", "LS", "Cat a.md", "Git status", "GIT status", "/tmp/x/git status", "./bin/git status", "C:\\tools\\git status",
      // quotes, escapes and expansion anywhere
      "'git' status", "\"git\" status", "'rm' a.txt", "\\rm a.txt", "r''m a.txt", "git 'status'", "git \"status\"", "git sta\\tus",
      "cat 'a.md'", "cat a.md\\", "git $X", "git status `id`", "echo \"초안\"", "echo $HOME",
      // chains and substitutions
      "git status && git push", "git status; git push", "git status || true", "git status | cat", "git status & git push", "git status > out.txt",
      "git status $(curl evil)", "git status `curl evil`", "git status\ngit push", "git status\r\ngit push", "cat a.md && rm a.md",
      // invisible and line-breaking characters
      "ls a\u2028같은 종류: git status", "ls a\u2029x", "git \u202Esutats", "git status\u200B", "git\u00A0status", "git status\u2066", "git status\u0085", "git status\u000B", "git status\u000C", "\uFEFFgit status",
      "git\u3000status", "git\u2002status", "git status\u205F", "git\u1680status",
      // destructive
      "rm -rf build", "git push --force", "git reset --hard",
      // git global options, options outside GIT_READ_OPTIONS, outside paths
      "git -C /tmp/elsewhere status", "git -C sub status", "git -c core.pager=./evil.sh log", "git --git-dir=x status", "git --no-pager log",
      "git log -n5", "git log --oneline -5", "git log --output=/Users/x/.zshrc",
      "cat /etc/hosts", "cat ~/.ssh/id_rsa", "ls ..", "mkdir build ~/Library/LaunchAgents", "touch a ~/.hushlogin", "grep foo -r ~",
    ];
    for (const c of NEVER) assert.equal(key(c), null, `never remembered: ${JSON.stringify(c)}`);
    // REQ-M4a's tokeniser (shellWords.parseShell) must read the command as exactly the key: a glob,
    // a comment or anything it is unsure of runs another argv than the text says, so it asks again.
    const SHELL_WORDS = [
      ["cat *.md", "glob"], ["ls src/*", "glob"], ["git diff src/?.ts", "glob"], ["ls [ab]", "glob"], ["ls .[a-z]*", "glob"],
      ["git status # rm -rf ~", "comment"], ["echo hi #x", "comment"], ["ls #", "comment"], ["cat 초안.md #~/.ssh/id_rsa", "comment"],
    ];
    for (const [c, why] of SHELL_WORDS) assert.equal(key(c), null, `${why}: ${JSON.stringify(c)}`);
    // Each row is the input that gets a key when exactly one check is reverted, so every check has
    // a test that fails without it (mutation tables in the fix-4 and fix-5 reports).
    const PINNED = [
      // round 5: the allowlist itself (each would be keyed with the round-4 list)
      ["npm test", "package manager run"], ["node app.js", "interpreter"], ["cp a.txt b.txt", "cp is not allowlisted"],
      // round 5: git subcommand and options
      ["git commit -m 초안", "git commit runs hooks"], ["git commit --all", "git commit runs hooks (allowlisted option)"], ["git clone src dest", "git clone fetches"], ["git clone -u ./evil.sh src dest", "git clone -u (verify 5 M1)"], ["git clone -qu ./evil.sh src dest", "bundled git clone -qu"],
      ["git diff --ext-diff", "git option outside GIT_READ_OPTIONS"], ["git log --textconv", "git option outside GIT_READ_OPTIONS"], ["git status --untracked-files", "git option outside GIT_READ_OPTIONS"],
      // round 5: `@` and `:` in an argument word
      ["ls foo@file:../evil", "package spec with @file:"], ["git diff foo@../evil", "package spec with @.."], ["cat host:../x", "scp-style remote host:path"], ["git show evil:x", "remote host:path"],
      // zsh equals expansion: `=git` is /usr/bin/git, outside the folder.
      ["ls =git", "zsh =cmd word"], ["cat =node", "zsh =cmd word"], ["echo ==ls", "zsh =cmd word"], ["ls -- =git", "zsh =cmd word after --"], ["touch =git", "zsh =cmd word"],
      ["grep --file==npm x", "zsh =cmd option value"],
      // an outside path as an option value, and as the word itself with a harmless value after `=`
      ["grep --file=~/.ssh/id_rsa x", "outside option value"], ["grep --file=/Users/v/.ssh/id_rsa x", "outside option value"],
      ["cat /tmp/x=y", "outside word with a later ="],
      // a short flag with an attached value can hide a path
      ["grep -f../x foo", "attached short value"], ["head -n5 a.txt", "attached short value"],
      // format and filler characters that render blank (L1)
      ["git statusㅤ", "Hangul filler U+3164"], ["cat README.mdㅤ~/.ssh/id_rsa", "Hangul filler as a fake space"],
      ["git statusᅟ", "Hangul choseong filler U+115F"], ["git statusᅠ", "Hangul jungseong filler U+1160"], ["git statusﾠ", "halfwidth Hangul filler U+FFA0"],
      ["git status͏", "combining grapheme joiner"], ["git status️", "variation selector 16"], ["git status︀", "variation selector 1"],
      ["git status\u{E0020}", "tag space"], ["git status\u{E0100}", "variation selector 17"], ["git status⁡", "function application (Cf)"],
      ["git status឴", "Khmer inherent vowel"],
      // round 5: the L1 residue
      // (in a free argument: `git status<char>` is already refused by the subcommand allowlist)
      ["git status\u180B", "Mongolian free variation selector U+180B"], ["cat README.md\u180B", "Mongolian free variation selector U+180B"],
      ["ls src\u180C", "Mongolian free variation selector U+180C"], ["echo hi\u180D", "Mongolian free variation selector U+180D"], ["cat a.md\u180F", "Mongolian free variation selector U+180F"],
      ["git status\u2800", "Braille blank U+2800"], ["cat README.md\u2800", "Braille blank U+2800"],
    ];
    for (const [c, why] of PINNED) assert.equal(key(c), null, `${why}: ${JSON.stringify(c)}`);
    // Negative controls: the same shapes without the refused part stay rememberable.
    for (const c of ["ls foo", "git diff foo", "cat host", "git show HEAD", "ls git", "cat node", "grep --file=pat.txt x", "cat tmp/x=y", "grep -f pat.txt foo", "head -n 5 a.txt", "git diff --stat", "git status", "cat README.md"]) {
      assert.equal(key(c), c, `plain form stays rememberable: ${c}`);
    }
    assert.deepEqual([...A.ALLOW_COMMANDS].sort(), ["cat", "echo", "git", "grep", "head", "ls", "mkdir", "pwd", "tail", "touch", "wc"], "the allowlist is exactly this");
    assert.deepEqual([...A.GIT_READ_SUBCOMMANDS].sort(), ["diff", "log", "show", "status"], "git: read-only subcommands only");
    for (const o of A.GIT_READ_OPTIONS) assert.doesNotMatch(o, /=|exec|output|config|pack|template|ext|textconv|-c$|^-C$|dir|tree/, `git option names no program or file: ${o}`);
    for (const bad of ["rm", "mv", "cp", "sudo", "env", "bash", "sh", "eval", "caffeinate", "timeout", "busybox", "source", "xargs", "npx", "npm", "pnpm", "yarn", "bun", "node", "python", "python3", "pip", "pip3", "find", "make"]) assert.ok(!A.ALLOW_COMMANDS.has(bad), bad);
    assert.equal("KIND_COMMANDS" in A, false, "the round-4 list is gone");
    ok(`exact command: ${ORDINARY.length} ordinary commands remembered, ${CHANGES.length} kinds of change ask again, ${NOT_ALLOWLISTED.length} not allowlisted, ${NEVER.length + SHELL_WORDS.length + PINNED.length} forms never remembered`);
  }

  // ── 3. The store: one scope at a time, forgets on any change, never persisted ──
  {
    const base = { cohort: "c1", activity: "act", task: "t1", folder: "/w", consent: "skip", instructor: false };
    const K = (o = {}) => A.taskCommandAllowScopeKey({ ...base, ...o });
    const kind = A.taskCommandExact("git status").key;
    const s = new A.TaskCommandAllows();
    assert.equal(s.has(K(), kind), false, "empty at start (a reload is a new store)");
    s.remember(K(), kind);
    assert.equal(s.has(K(), kind), true, "positive control: same task, same command");
    assert.equal(s.has(K(), A.taskCommandExact("git diff").key), false, "another command is asked again");
    for (const change of [{ task: "t2" }, { task: null }, { activity: "act2" }, { folder: "/w2" }, { consent: "full" }, { cohort: "c2" }, { instructor: true }]) {
      const t = new A.TaskCommandAllows();
      t.remember(K(), kind);
      assert.equal(t.has(K(change), kind), false, `changed ${JSON.stringify(change)}`);
      assert.equal(t.has(K(), kind), false, `going back after ${JSON.stringify(change)} does not restore it`);
    }
    const u = new A.TaskCommandAllows();
    u.remember(K(), kind);
    u.observe(K({ task: "t2" }));
    assert.equal(u.has(K(), kind), false, "observing another task (task A → B → A) forgets");
    u.remember(K(), kind);
    u.clear();
    assert.equal(u.has(K(), kind), false, "clear() forgets");
    assert.notEqual(K({ task: "a\",\"b" }), K({ task: "a", activity: "b\",\"act" }), "the key cannot be forged by a separator");
    for (const c of ["full", "skip"]) assert.equal(A.shellAllowedByFolderConsent(c), true, c);
    for (const c of ["read", "none", "ask", "refuse", ""]) assert.equal(A.shellAllowedByFolderConsent(c), false, c);
    ok("store: allow holds within one scope; task/new task/activity/folder/consent/cohort/instructor change forgets it, also on the way back");
  }

  // ── 4. The real approval host (ChatPanelProvider + fake vscode) ──
  {
    const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ws = { folder: undefined };
    const ui = { modals: [], infos: [], pick: undefined };
    const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
    const vscode = {
      ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
      Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
      commands: { executeCommand: async () => undefined },
      window: {
        showWarningMessage: async (message, options, ...buttons) => { ui.modals.push({ message, options, buttons }); return typeof ui.pick === "function" ? ui.pick(buttons) : ui.pick; },
        showInformationMessage: async (m) => { ui.infos.push(m); return undefined; },
      },
      workspace: {
        get workspaceFolders() { return ws.folder ? [{ uri: toUri(ws.folder), name: path.basename(ws.folder) }] : undefined; },
        getConfiguration: () => ({ get: (_k, fallback) => fallback }),
      },
    };
    const mod = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {} }, process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortSignal, crypto: webcrypto });
    const { ChatPanelProvider } = mod.exports;
    const home = path.join(tmp, "home");
    const outside = path.join(tmp, "outside");
    const outside2 = path.join(tmp, "outside2");
    for (const d of [home, outside, outside2]) fs.mkdirSync(d, { recursive: true });
    const state = new Map();
    const personal = { profile_id: "p", activity_id: "d".repeat(64), activity_kind: "personal", sdk_tools: { shell: true } };
    const classroom = { profile_id: "c", activity_id: "e".repeat(64), activity_kind: "classroom", sdk_tools: { shell: true } };
    const task = { id: "task-1" };
    // A window: one provider instance. A reload is a new instance (constructor state is gone).
    const makeWindow = (profile = personal) => {
      const h = Object.create(ChatPanelProvider.prototype);
      Object.assign(h, {
        context: { globalState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => "tok" } },
        cachedProfile: profile, servedWorkspaceRoot: home, _instructorMode: { isInstructor: false }, activeCohortId: "cohort-1",
        nativeHistoryScope: "activity-1", approvedBrowserOrigins: new Set(), coachDisplayName: () => "코치",
        currentTaskStore: () => ({ getView: () => ({ activeTaskId: task.id }) }),
      });
      // The constructor's field initializers do not run under Object.create; the real one is `new TaskCommandAllows()`.
      if (!("taskCommandAllows" in h) || !h.taskCommandAllows) h.taskCommandAllows = new A.TaskCommandAllows();
      return h;
    };
    const choose = (folder, level) => state.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, FC.canonicalFolder(folder), level));
    const shell = (h, command, extra = {}) => h.resolveActionApproval({ requestId: "r", kind: "executeShell", description: command, payload: { command }, ...extra });
    const capture = [];
    const asked = async (h, command, pick, extra) => {
      ui.modals.length = 0; ui.pick = pick;
      const approved = await shell(h, command, extra);
      return { approved, modals: ui.modals.length, modal: ui.modals[0] };
    };

    ws.folder = outside;
    choose(outside, "full");
    let win = makeWindow();

    // Label and modal text.
    const first = await asked(win, "cat 초안.md", LABEL);
    assert.equal(first.modals, 1);
    assert.deepEqual([...first.modal.buttons], ["실행", LABEL], "buttons: 실행 and the task-scoped allow");
    assert.equal(first.modal.message, "코치가 명령을 실행하려고 해요:");
    assert.equal(first.modal.options.modal, true);
    assert.equal(first.modal.options.detail, "cat 초안.md", "the detail is the command itself; no 같은 종류 line");
    assert.ok(!first.modal.buttons.some((b) => b.includes("항상")), "no 항상 허용 on the shell modal");
    assert.equal(first.approved, true);
    capture.push({ case: "normal command (offers the task-scoped allow)", ...first.modal });
    ok("modal: 실행 / 이번 작업 동안 이 명령 허용, detail is the command only");

    // Round 5: a command outside the allowlist still runs with the one-time approval, with no remember button.
    for (const c of ["git commit -m 초안", "npm test", "git clone -u ./evil.sh src dest", "npm install foo@file:../evil"]) {
      const once = await asked(win, c, "실행");
      assert.deepEqual([once.approved, once.modals, [...once.modal.buttons]], [true, 1, ["실행"]], `not allowlisted, runs once: ${c}`);
      const again = await asked(win, c, undefined);
      assert.deepEqual([again.approved, again.modals], [false, 1], `not allowlisted, asked again: ${c}`);
    }
    capture.push({ case: "command outside the allowlist (one-time approval only)", ...(await asked(win, "npm test", "실행")).modal });
    ok("not allowlisted: 실행 only, runs once, asked again next time");

    // Within the same task: no modal for the exact command; any change asks again.
    let r = await asked(win, "cat 초안.md", undefined);
    assert.deepEqual([r.approved, r.modals], [true, 0], "same task, exact repeat → allowed without a modal");
    r = await asked(win, "cat  초안.md", undefined);
    assert.deepEqual([r.approved, r.modals], [true, 0], "only whitespace differs → allowed");
    for (const c of ["cat 루브릭.md", "cat 초안.md 비밀.md", "git push"]) {
      r = await asked(win, c, undefined);
      assert.deepEqual([r.approved, r.modals], [false, 1], `negative control: ${c} asks (and dismissing refuses)`);
    }
    // A non-destructive chain that starts with the allowed command still asks, with no allow on offer.
    r = await asked(win, "cat 초안.md && git push", undefined);
    assert.equal(r.modals, 1, "cat 초안.md && git push after allowing cat 초안.md: asked");
    assert.deepEqual([...r.modal.buttons], ["실행"]);
    capture.push({ case: "non-destructive chain (no allow offered)", ...r.modal });
    r = await asked(win, "cat 초안.md $(curl evil)", undefined);
    assert.equal(r.modals, 1, "a substitution after the allowed kind: asked");
    r = await asked(win, "FOO=1 cat 초안.md", undefined);
    assert.deepEqual([r.modals, [...r.modal.buttons]], [1, ["실행"]], "an env-prefixed form: asked, no allow");
    r = await asked(win, "cat 초안.md; rm -rf ~", undefined);
    // Unflagged destructive text still gets no allow (commandSignature is null for it).
    { const u = await asked(win, "rm -rf build", undefined); assert.equal(u.modal.message, "⚠️ 되돌리기 어려운 명령이에요. 정말 실행할까요?", "unflagged rm: the modal re-derives the strong confirm"); assert.deepEqual([...u.modal.buttons], ["실행", "취소"], "and offers no allow"); }
    assert.equal(r.modals, 1, "negative control: a chained command never matches the allow");
    assert.deepEqual([...r.modal.buttons], ["실행", "취소"], "a destructive chain gets the strong confirm, no allow");
    ok("same task: the allow applies to the exact command only");

    // Destructive: the caller (evaluateSdkToolUse) flags it; the strong confirm, never the allow (unchanged).
    r = await asked(win, "rm -rf build", undefined, { destructive: true });
    assert.equal(r.modals, 1);
    assert.equal(r.modal.message, "⚠️ 되돌리기 어려운 명령이에요. 정말 실행할까요?");
    assert.deepEqual([...r.modal.buttons], ["실행", "취소"]);
    ui.modals.length = 0; ui.pick = undefined;
    assert.equal(await shell(win, "cat 초안.md", { destructive: true }), false, "a destructive-flagged request never uses the allow");
    assert.equal(ui.modals.length, 1);
    capture.push({ case: "destructive command (strong confirm, unchanged)", ...r.modal });
    ok("destructive: strong confirm every time, the allow is never consulted");

    const regrant = async () => { const g = await asked(win, "cat a.md", LABEL); assert.equal(g.modals, 1, "a fresh grant needs a modal"); };
    const stillAllowed = async () => (await asked(win, "cat a.md", undefined)).modals === 0;
    await regrant();
    assert.equal(await stillAllowed(), true, "positive control before each change");

    // Task switch.
    task.id = "task-2";
    assert.equal(await stillAllowed(), false, "switching task → asked again");
    task.id = "task-1";
    assert.equal(await stillAllowed(), false, "switching back to the first task does not restore it");
    await regrant();
    // New task (a new id the window has never seen).
    task.id = "task-new";
    assert.equal(await stillAllowed(), false, "a new task → asked again");
    await regrant();
    assert.equal(await stillAllowed(), true);
    // Folder rebind (#2117): the task moves to another folder.
    ws.folder = outside2; choose(outside2, "full");
    assert.equal(await stillAllowed(), false, "rebinding the folder → asked again");
    ws.folder = outside;
    await regrant();
    // Consent change (#2065): full → read refuses; read → full asks again.
    choose(outside, "read");
    ui.modals.length = 0; ui.infos.length = 0; ui.pick = LABEL;
    assert.equal(await shell(win, "cat a.md"), false, "read-only refuses the remembered kind");
    assert.equal(ui.modals.length, 0, "read-only refuses before any modal or allow");
    assert.deepEqual(ui.infos, [FC.folderShellRefusalNotice()], "with the 명령 실행 copy");
    choose(outside, "full");
    assert.equal(await stillAllowed(), false, "back to full → the earlier allow is gone");
    await regrant();
    // Another window flips consent full → read → full with no shell request here in between: the write
    // time in the shared globalState differs, so the allow is gone.
    state.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, FC.canonicalFolder(outside), "read", 1_000));
    state.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, FC.canonicalFolder(outside), "full", 2_000));
    assert.equal(await stillAllowed(), false, "a consent rewrite from another window → asked again");
    await regrant();
    assert.equal(await stillAllowed(), true, "positive control: an unchanged stamp keeps it");
    // The modal is open while the task changes and changes back (A → B → A): the answer runs this
    // command but is not remembered for any task.
    {
      // A → B → A during the modal, as taskSelect does it (the store clears on each switch).
      win.endTaskCommandAllows();
      ui.modals.length = 0;
      ui.pick = () => { task.id = "task-race"; win.endTaskCommandAllows(); task.id = "task-new"; win.endTaskCommandAllows(); return LABEL; };
      assert.equal(await shell(win, "cat a.md"), true, "the answer still runs this one command");
      ui.pick = undefined;
      assert.equal(await stillAllowed(), false, "A → B → A while the modal was open: not remembered");
      // A → B during the modal and staying on B (no explicit clear: only the key differs).
      ui.pick = () => { task.id = "task-race"; return LABEL; };
      assert.equal(await shell(win, "cat a.md"), true);
      ui.pick = undefined;
      assert.equal(await stillAllowed(), false, "A → B while the modal was open: not remembered for B");
      task.id = "task-new";
      assert.equal(await stillAllowed(), false, "nor for A");
      // Negative control for the check itself: with no change during the modal it is remembered.
      await regrant();
      assert.equal(await stillAllowed(), true);
    }
    // The consent command clears even when nothing is checked in between (full → read → full).
    win.endTaskCommandAllows();
    assert.equal(await stillAllowed(), false, "endTaskCommandAllows() (the consent command) forgets");
    await regrant();
    // Another activity.
    win.nativeHistoryScope = "activity-2";
    assert.equal(await stillAllowed(), false, "another activity → asked again");
    win.nativeHistoryScope = "activity-1";
    await regrant();
    // Reload: a new window starts empty (in memory only), and nothing was written to any store.
    const keysBefore = [...state.keys()].sort();
    win = makeWindow();
    assert.equal(await stillAllowed(), false, "reload → asked again");
    assert.deepEqual([...state.keys()].sort(), keysBefore, "no allow is persisted to globalState");
    ok("never carried over: task switch (and back), new task, folder rebind, consent change, consent command, another activity, reload");

    // Read-only and none: refused before the allow, for every shell request, even destructive ones.
    for (const level of ["read", "none"]) {
      choose(outside, level);
      const w = makeWindow();
      w.taskCommandAllows.remember(w.taskCommandAllowState().key, A.taskCommandExact("git status").key);
      ui.modals.length = 0; ui.infos.length = 0;
      assert.equal(await shell(w, "git status"), false, `${level}: a planted allow is not consulted`);
      assert.equal(await shell(w, "rm -rf build", { destructive: true }), false, `${level}: destructive refused too`);
      assert.equal(ui.modals.length, 0, `${level}: no modal`);
      assert.equal(ui.infos.length, 2);
      assert.equal(ui.infos[0], level === "none" ? FC.folderNoAiCopy() : FC.folderShellRefusalNotice(), `${level}: its own copy`);
    }
    // Undecided outside folder: fail closed like the write question.
    state.delete(FC.FOLDER_CONSENT_KEY);
    { const w = makeWindow(); ui.modals.length = 0; ui.infos.length = 0; assert.equal(await shell(w, "git status"), false, "undecided → refused"); assert.equal(ui.modals.length, 0); assert.deepEqual(ui.infos, [FC.folderShellUndecidedNotice()], "undecided: its own copy, not 골랐어요"); }
    ok("folder consent read-only / none / undecided: refused before any allow or modal");

    // Classroom seat: consent never applies; the modal and the allow work as before (scoped to the window's activity + folder).
    {
      const w = makeWindow(classroom);
      w.currentTaskStore = () => undefined;
      ui.modals.length = 0; ui.pick = LABEL;
      assert.equal(await shell(w, "git status"), true);
      assert.equal(ui.modals.length, 1, "classroom: asked once");
      ui.pick = undefined;
      assert.equal(await shell(w, "git status"), true, "classroom: exact repeat allowed");
      assert.equal(ui.modals.length, 1);
      ws.folder = home;
      assert.equal(await shell(w, "git status"), false, "classroom: another folder asks again (dismissed)");
      ws.folder = outside;
    }
    ok("classroom seat: no consent question, allow scoped to activity + folder");

    if (process.env.HPS_TASK_ALLOW_CAPTURE) {
      const out = capture.map((m) => `## ${m.case}\n\nmessage: ${JSON.stringify(m.message)}\ndetail:  ${JSON.stringify(m.options.detail ?? null)}\nmodal:   ${m.options.modal}\nbuttons: ${JSON.stringify([...m.buttons])}\n`).join("\n");
      fs.mkdirSync(path.dirname(process.env.HPS_TASK_ALLOW_CAPTURE), { recursive: true });
      fs.writeFileSync(process.env.HPS_TASK_ALLOW_CAPTURE, out);
    }
  }

  // ── 5. Wiring: one key, in memory, cleared on task change and by the consent command ──
  {
    const read = (p) => fs.readFileSync(path.join(extRoot, p), "utf8");
    const provider = read("src/chatPanelProvider.ts");
    assert.doesNotMatch(provider, /approvedCommandSignatures/, "the window-session set is gone");
    assert.doesNotMatch(provider, /항상 허용 \(\$\{signature\}\)/, "the old label is gone");
    assert.match(provider, /private readonly taskCommandAllows = new TaskCommandAllows\(\);/);
    assert.doesNotMatch(provider, /\.update\([^)]*taskCommandAllows/, "never persisted");
    assert.match(provider, /msg\.type === 'taskCreate' \|\| msg\.type === 'taskSelect'\) this\.endTaskCommandAllows\(\)/, "task create / select clears");
    assert.match(read("src/extension.ts"), /await changeFolderConsent\([^;]*\);\s*(?:\/\/[^\n]*\n\s*)?provider\.endTaskCommandAllows\(\);/, "the consent command clears");
    assert.match(provider, /invalidateProfile\(\): void \{[\s\S]{0,900}this\.endTaskCommandAllows\(\);/, "a token change (sign-in / sign-out) clears");
    assert.match(provider, /this\.lastAllowInstructor !== undefined && this\.lastAllowInstructor !== isInstructor\) this\.endTaskCommandAllows\(\)/, "an instructor flip clears");
    ok("wiring: no window-session set, no persistence, cleared on task create/select, token change, instructor flip and by the consent command");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`task-command-allow: ${passed} checks passed`);
