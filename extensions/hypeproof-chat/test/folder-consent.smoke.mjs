// REQ-STUDIO-FOLDER-CONSENT (CGP-KNOW-R-010 / REQ-KNOW-18): opening a folder that is not a
// personal activity's own asks once what the AI may do there; the answer is remembered per
// activity per canonical folder and only ever narrows the seat.
//
// 1–7 are pure (decisions, canonical paths, narrowing, gate source, copy). 8 runs the real
// host module (folderConsentHost.ts, bundled with esbuild) against a fake VS Code surface.
// 9 locks the wiring in the send path, the command registration and the manifest.
//
// Run: node --experimental-strip-types test/folder-consent.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

const FC = await import("../src/folderConsent.ts");
const DS = await import("../src/denialSource.ts");
const H = await import("../src/sdkCoachHelpers.ts");
const { accessProfile, accessRemovedFeatures } = await import("../src/accessClient.ts");
const { CLASSROOM_ONLY_WORDS } = await import("../src/seatVocabulary.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const TEACHER_WORDS = ["선생님", ...CLASSROOM_ONLY_WORDS];
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "folder-consent-")));

try {
  // ── 1. Canonical folder: symlink, case, drive letter; distinct folders stay distinct ──
  {
    const real = path.join(tmp, "MyProject");
    fs.mkdirSync(real);
    const link = path.join(tmp, "link-to-project");
    fs.symlinkSync(real, link, "dir");
    assert.equal(FC.canonicalFolder(link), real, "a symlink resolves to its target");
    assert.equal(FC.canonicalFolder(path.join(real, "sub", "..")), real, "dot segments collapse");
    const lower = path.join(tmp, "myproject");
    if (fs.existsSync(lower)) {
      // Case-insensitive volume (macOS default, Windows): both spellings are one folder.
      assert.equal(FC.canonicalFolder(lower), real, "case variant → on-disk case");
    } else {
      console.log("  (case-sensitive volume: case variant is a different folder here, nothing to merge)");
    }
    // Negative control: a sibling folder never shares the key.
    const other = path.join(tmp, "MyProject2");
    fs.mkdirSync(other);
    assert.notEqual(FC.canonicalFolder(other), FC.canonicalFolder(real));
    // Drive letter: the realpath is injectable, so the Windows spelling is checked anywhere.
    const win = FC.canonicalFolder("c:/Users/a/proj", (p) => p.replace(/^.*?c:/i, "c:"));
    assert.match(win, /^C:/, `drive letter upper-cased: ${win}`);
    assert.throws(() => FC.canonicalFolder(path.join(tmp, "missing")), "a missing folder has no canonical spelling");
    ok("canonical folder: symlink → target, case variant → on-disk case, drive letter upper-cased, distinct folders distinct");
  }

  // ── 2. Which seats ask ──
  {
    const yes = [{ activity_kind: "personal" }, { activity_kind: "trial" }, { pass: { id: "p" } }];
    for (const p of yes) assert.equal(FC.folderConsentApplies(p), true, JSON.stringify(p));
    const no = [
      null, undefined, {},
      { activity_kind: "classroom" },
      { activity_kind: "classroom", pass: { id: "p" } },
      { activity_kind: "personal", lesson: { content: { title: "수업" } } },
      { activity_kind: "trial", lesson_binding: { enforced: true, key: "k" } },
    ];
    for (const p of no) assert.equal(FC.folderConsentApplies(p), false, JSON.stringify(p));
    assert.equal(FC.folderConsentApplies({ activity_kind: "personal" }, true), false, "never on the instructor surface");
    ok("seats: personal / trial / pass ask; classroom, lesson-bound, unknown kind and instructor never ask");
  }

  // ── 3. The activity's own folder ──
  {
    const home = "/u/HypeProof/studio";
    for (const f of [home, `${home}/site`, `${home}-2`, `${home}-dental-homepage`]) assert.equal(FC.isOwnFolder(f, home), true, f);
    for (const f of ["/u/Documents/proj", "/u/HypeProof", `${home}x`, `/elsewhere/studio-2`, "/"]) assert.equal(FC.isOwnFolder(f, home), false, f);
    assert.equal(FC.isOwnFolder(home, null), false, "no served home → every folder asks");
    assert.equal(FC.servedHome("~/HypeProof/studio", "/u"), path.join("/u", "HypeProof/studio"));
    assert.equal(FC.servedHome("relative/dir", "/u"), null);
    assert.equal(FC.servedHome("  ", "/u"), null);
    ok("own folder: home, inside it and Studio's <home>-N / <home>-<repo> siblings; parent, look-alikes and other trees are not");
  }

  // ── 4. The store: per activity, per folder; malformed entries are undecided ──
  {
    let s = FC.writeFolderConsent(undefined, "act-a", "/f1", "read", 1);
    s = FC.writeFolderConsent(s, "act-a", "/f2", "none", 2);
    s = FC.writeFolderConsent(s, "act-b", "/f1", "full", 3);
    assert.equal(FC.readFolderConsent(s, "act-a", "/f1"), "read");
    assert.equal(FC.readFolderConsent(s, "act-a", "/f2"), "none");
    assert.equal(FC.readFolderConsent(s, "act-b", "/f1"), "full", "another activity keeps its own choice for the same folder");
    assert.equal(FC.readFolderConsent(s, "act-b", "/f2"), undefined);
    const before = JSON.stringify(s);
    const changed = FC.writeFolderConsent(s, "act-a", "/f1", "full", 4);
    assert.equal(JSON.stringify(s), before, "writes return a new store");
    assert.equal(FC.readFolderConsent(changed, "act-a", "/f1"), "full");
    assert.equal(FC.readFolderConsent(changed, "act-b", "/f1"), "full");
    // Negative controls: nothing malformed reads as a grant.
    for (const bad of [null, 7, "x", { "act-a": null }, { "act-a": { "/f1": { level: "all" } } }, { "act-a": { "/f1": "full" } }]) {
      assert.equal(FC.readFolderConsent(bad, "act-a", "/f1"), undefined, JSON.stringify(bad));
    }
    assert.equal(FC.readFolderConsent({}, "__proto__", "constructor"), undefined, "prototype keys are not entries");
    assert.equal(FC.readFolderConsent(s, "act-a", "/F1"), undefined, "keys are exact: canonicalize before reading");
    ok("store: per activity per folder, new object on write, malformed or prototype entries → undecided (ask again)");
  }

  // ── 5. The decision before a turn ──
  {
    const store = FC.writeFolderConsent(undefined, "a", "/u/Documents/proj", "read");
    const d = (o) => FC.folderConsentDecision({ applies: true, activityId: "a", folder: "/u/Documents/proj", home: "/u/HypeProof/studio", store, ...o });
    assert.deepEqual(d({}), { kind: "apply", folder: "/u/Documents/proj", level: "read" });
    assert.deepEqual(d({ folder: "/u/Documents/other" }), { kind: "ask", folder: "/u/Documents/other" });
    assert.deepEqual(d({ activityId: "b" }), { kind: "ask", folder: "/u/Documents/proj" }, "a different activity asks again");
    assert.deepEqual(d({ folder: "/u/HypeProof/studio" }), { kind: "skip" }, "own folder never asks");
    assert.deepEqual(d({ applies: false }), { kind: "skip" }, "classroom never asks");
    assert.deepEqual(d({ folder: undefined }), { kind: "skip" });
    assert.deepEqual(d({ activityId: undefined }), { kind: "skip" });
    ok("decision: remembered → apply, new folder or activity → ask, own folder / classroom / no folder → skip");
  }

  // ── 6. Narrowing never widens ──
  {
    const bools = [false, true];
    let combos = 0;
    for (const read of bools) for (const write of bools) for (const shell of bools) for (const subagents of bools) for (const browser of bools) for (const web of bools) for (const pub of bools) {
      combos++;
      const profile = { profile_id: "p", activity_kind: "personal", sdk_tools: { read, write, shell, subagents, browser }, tools: { web_search: web },
        publishing: { enabled: pub, strategy: "github-pages-actions" } };
      const full = FC.narrowForFolder(profile, "full");
      assert.equal(full, profile, "full returns the profile itself (no copy, no change)");
      const ro = FC.narrowForFolder(profile, "read");
      const before = new Set(H.permittedToolsFor(profile)), after = H.permittedToolsFor(ro);
      for (const t of after) assert.ok(before.has(t), `read-only never adds ${t}`);
      for (const t of ["Write", "Edit", "Bash"]) assert.ok(!after.includes(t), `read-only removes ${t}`);
      if (read) assert.ok(after.includes("Read"), "read stays when the profile granted it");
      else assert.ok(!after.includes("Read"), "negative control: read is never granted by the folder choice");
      const mBefore = new Set(H.permittedMcpToolsFor(profile)), mAfter = H.permittedMcpToolsFor(ro);
      for (const t of mAfter) assert.ok(mBefore.has(t), `read-only never adds MCP ${t}`);
      assert.ok(!mAfter.includes("mcp__hypeproof__publish_site"), "read-only removes site publishing");
      assert.deepEqual(H.permittedAgentToolsFor(ro), H.permittedAgentToolsFor(profile), "read-only subagents are unchanged");
      const expected = [write && "write", shell && "shell", pub && "publish"].filter(Boolean);
      assert.deepEqual([...FC.folderRemovedFeatures(ro)], expected, "records only what was on");
      assert.deepEqual([...FC.folderRemovedFeatures(full)], []);
      assert.equal(profile.sdk_tools.write, write, "the input profile is not mutated");
    }
    // Composes with the 이용권 narrowing: both records survive, neither widens.
    const choice = { id: "c", allowed: { features: ["read", "write"] } };
    const granted = { profile_id: "p", activity_kind: "personal", sdk_tools: { read: true, write: true, shell: true }, tools: { web_search: true }, publishing: { enabled: true, strategy: "github-pages-actions" } };
    const both = FC.narrowForFolder(accessProfile(granted, choice), "read");
    assert.deepEqual([...accessRemovedFeatures(both)].sort(), ["shell", "web_search"]);
    assert.deepEqual([...FC.folderRemovedFeatures(both)].sort(), ["publish", "write"], "shell was already removed by the 이용권");
    assert.deepEqual(H.permittedToolsFor(both), ["Read", "Grep", "Glob"].filter((t) => H.permittedToolsFor(granted).includes(t)));
    assert.ok(!("hps.folderRemovedFeatures" in JSON.parse(JSON.stringify(both))), "JSON never carries the record");
    assert.deepEqual([...FC.folderRemovedFeatures({ ...both })].sort(), ["publish", "write"], "a spread copy keeps it");
    ok(`narrowing: ${combos} grant combinations — full is identity, read-only only removes (write, shell, publish), composes with the 이용권`);
  }

  // ── 7. The gate names the folder choice; the copy is the learner's ──
  {
    assert.equal(DS.classifyDenial("folder_choice_narrowed"), "folder");
    assert.equal(DS.DENIAL_SOURCE_LABEL.folder, "폴더 권한");
    const gate = (toolName, input, extra) => H.evaluateSdkToolUse({ toolName, input, permittedTools: ["Read"], audience: "solo", ...extra });
    const folderWrite = gate("Write", { file_path: "a.txt", content: "x" }, { folderRemoved: new Set(["write"]) });
    assert.equal(folderWrite.decision, "deny");
    assert.equal(folderWrite.source, "folder");
    assert.equal(folderWrite.friendly, "[폴더 권한] 이 폴더에서는 파일 고치기를 쓰지 않기로 골랐어요. 바꾸려면 ‘이 폴더의 AI 권한 바꾸기’에서 다시 골라 주세요.");
    assert.equal(gate("Bash", { command: "ls" }, { folderRemoved: new Set(["shell"]) }).source, "folder");
    assert.equal(gate("mcp__hypeproof__publish_site", {}, { folderRemoved: new Set(["publish"]) }).source, "folder");
    // Negative controls: without the record the same deny is the lesson's or the 이용권's.
    assert.equal(gate("Write", { file_path: "a.txt" }).source, "lesson");
    assert.equal(gate("Bash", { command: "ls" }, { accessRemoved: new Set(["shell"]) }).source, "access");
    assert.equal(gate("Bash", { command: "ls" }, { folderRemoved: new Set(["write"]) }).source, "lesson", "a record for another key does not relabel");
    // The record never changes a verdict: a granted tool stays allowed.
    assert.equal(gate("Read", { file_path: "a.txt" }, { folderRemoved: new Set(["write", "shell", "read"]) }).decision, "allow");

    const noAi = FC.folderNoAiCopy();
    assert.equal(noAi, "이 폴더에서는 AI를 쓰지 않기로 골랐어요. 바꾸려면 ‘이 폴더의 AI 권한 바꾸기’에서 다시 골라 주세요.");
    for (const s of [noAi, DS.denialCopy({ source: "folder" }), DS.denialCopy({ source: "folder" }, "classroom"), FC.FOLDER_CONSENT_UNDECIDED, FC.folderConsentDetail("/x")]) {
      for (const w of TEACHER_WORDS) assert.ok(!s.includes(w), `folder copy names no teacher ("${w}"): ${s}`);
      assert.ok(!s.includes("이 수업") && !s.includes("이용권"), `folder copy is not a lesson or 이용권 sentence: ${s}`);
    }
    assert.equal(noAi.split(/(?<=[.])\s/).length, 2, "one reason + one next step");
    assert.ok(noAi.includes(FC.FOLDER_CONSENT_COMMAND_TITLE), "the next step names the one command");
    assert.deepEqual(Object.values(FC.FOLDER_CONSENT_LABEL).sort(), ["읽기·고치기·명령 실행 모두 허용", "읽기만 허용 (고치기·명령은 안 함)", "이 폴더에서는 AI를 쓰지 않음"].sort());
    assert.equal(FC.FOLDER_CONSENT_ORDER[0], "read", "Enter on the first choice never grants commands");
    ok("gate and copy: 폴더 권한 for write / shell / publish removed by the folder choice (negative controls: lesson, 이용권, other key), no teacher words, one next step");
  }

  // ── 8. The real host module against a fake VS Code ──
  {
    const bundle = await build({ entryPoints: [path.join(extRoot, "src/folderConsentHost.ts")], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ws = { folder: undefined };
    const ui = { modal: [], answer: undefined, quick: [], quickAnswer: undefined, info: [] };
    const vscode = {
      workspace: { get workspaceFolders() { return ws.folder ? [{ uri: { fsPath: ws.folder } }] : undefined; } },
      window: {
        showWarningMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); return ui.answer; },
        showQuickPick: async (items, opts) => { ui.quick.push({ items, opts }); return items.find((i) => i.level === ui.quickAnswer); },
        showInformationMessage: async (m) => { ui.info.push(m); },
      },
    };
    const mod = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, process, Buffer, URL, TextEncoder, TextDecoder, crypto: webcrypto });
    const host = mod.exports;
    const state = new Map();
    const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} } };
    const home = path.join(tmp, "HypeProof", "studio");
    fs.mkdirSync(home, { recursive: true });
    const outside = path.join(tmp, "Documents", "Proj");
    fs.mkdirSync(outside, { recursive: true });
    const outsideLink = path.join(tmp, "proj-link");
    fs.symlinkSync(outside, outsideLink, "dir");
    const personal = { profile_id: "p", activity_id: "a".repeat(64), activity_kind: "personal", sdk_tools: { read: true, write: true, shell: true }, tools: {}, publishing: { enabled: true, strategy: "github-pages-actions" } };
    const opts = { servedRoot: home };
    const run = (profile = personal, o = opts) => host.folderConsentProfile(context, profile, o);

    // Own folder: no question, same profile object.
    ws.folder = home;
    assert.equal(await run(), personal);
    ws.folder = path.join(home, "site");
    fs.mkdirSync(ws.folder, { recursive: true });
    assert.equal(await run(), personal);
    assert.equal(ui.modal.length, 0, "own folder never asks");

    // Classroom seat in an outside folder: no question.
    ws.folder = outside;
    const classroom = { ...personal, activity_kind: "classroom" };
    assert.equal(await run(classroom), classroom);
    assert.equal(await run(personal, { ...opts, instructor: true }), personal);
    assert.equal(ui.modal.length, 0, "classroom and instructor never ask");

    // Closing the question: refused, input kept, nothing remembered, asked again next time.
    ui.answer = undefined;
    await assert.rejects(run(), (e) => e instanceof host.FolderConsentRefusal && e.message === "이 폴더에서 AI가 할 수 있는 일을 고른 뒤 다시 보내 주세요. 입력은 그대로 두었어요.");
    assert.equal(ui.modal.length, 1);
    assert.equal(ui.modal[0].message, "이 폴더에서 작업할까요?");
    assert.equal(ui.modal[0].opts.modal, true);
    assert.ok(ui.modal[0].opts.detail.startsWith(outside), "the question names the folder");
    assert.deepEqual(ui.modal[0].items, FC.FOLDER_CONSENT_ORDER.map((l) => FC.FOLDER_CONSENT_LABEL[l]));
    assert.equal(state.size, 0, "a closed question remembers nothing");

    // Read-only: asked once, remembered; the symlinked spelling of the same folder shares it.
    ui.answer = FC.FOLDER_CONSENT_LABEL.read;
    const ro = await run();
    assert.notEqual(ro, personal);
    assert.deepEqual(H.permittedToolsFor(ro), ["Read", "Grep", "Glob"].filter((t) => H.permittedToolsFor(personal).includes(t)));
    assert.equal(ui.modal.length, 2);
    ui.answer = undefined; // a second question would now refuse: proves it is not asked
    ws.folder = outsideLink;
    const again = await run();
    assert.deepEqual(H.permittedToolsFor(again), H.permittedToolsFor(ro));
    assert.equal(ui.modal.length, 2, "asked once per canonical folder");
    const lowerOutside = path.join(tmp, "Documents", "proj");
    if (fs.existsSync(lowerOutside)) {
      ws.folder = lowerOutside;
      await run();
      assert.equal(ui.modal.length, 2, "case variant shares the decision");
    }

    // Another personal activity in the same folder asks for itself.
    ws.folder = outside;
    ui.answer = FC.FOLDER_CONSENT_LABEL.full;
    const otherActivity = { ...personal, activity_id: "b".repeat(64) };
    assert.equal(await run(otherActivity), otherActivity, "full returns the profile untouched");
    assert.equal(ui.modal.length, 3);

    // Change through the one command: "AI 안 씀" then refuses every turn with the folder copy.
    ui.quickAnswer = "none";
    assert.equal(await host.changeFolderConsent(context, personal, opts), "none");
    assert.equal(ui.quick.at(-1).opts.title, "이 폴더의 AI 권한 바꾸기");
    assert.equal(ui.quick.at(-1).items.find((i) => i.level === "read").description, "지금 설정", "the current choice is marked");
    await assert.rejects(run(), (e) => e instanceof host.FolderConsentRefusal && e.message === FC.folderNoAiCopy());
    assert.equal(ui.modal.length, 3, "a remembered 'none' refuses without asking");
    // Back to full via the command.
    ui.quickAnswer = "full";
    await host.changeFolderConsent(context, personal, opts);
    assert.equal(await run(), personal);
    // Command outside a personal seat or in the own folder: an explanation, no change.
    const storeBefore = JSON.stringify(state.get(FC.FOLDER_CONSENT_KEY));
    assert.equal(await host.changeFolderConsent(context, classroom, opts), undefined);
    ws.folder = home;
    assert.equal(await host.changeFolderConsent(context, personal, opts), undefined);
    assert.equal(ui.info.length, 2);
    assert.equal(JSON.stringify(state.get(FC.FOLDER_CONSENT_KEY)), storeBefore);
    // No served home → every folder is outside, including what would have been home.
    ui.answer = FC.FOLDER_CONSENT_LABEL.read;
    const before = ui.modal.length;
    await run(personal, { servedRoot: null });
    assert.equal(ui.modal.length, before + 1, "no served home → asks");
    // The refusal class is the send path's keep-input error.
    const { TurnToolModeError } = await import("../src/turnTools.ts");
    assert.equal(Object.getPrototypeOf(host.FolderConsentRefusal.prototype).constructor.name, TurnToolModeError.name);
    ok("host: own folder / classroom / instructor never ask; closing refuses and remembers nothing; asked once per canonical folder (symlink, case) per activity; the command changes it; 'none' refuses with the folder copy");
  }

  // ── 9. Wiring: send path, command, manifest, gates ──
  {
    const read = (p) => fs.readFileSync(path.join(extRoot, p), "utf8");
    const provider = read("src/chatPanelProvider.ts");
    const turnLine = /const profile=resolvedProfile\?await folderConsentProfile\(this\.context,accessProfile\(resolvedProfile,chosenAccess\),\{servedRoot:this\.servedWorkspaceRoot,instructor:this\._instructorMode\.isInstructor===true\}\):null;/;
    assert.match(provider, turnLine, "the turn's profile passes through the folder choice after the 이용권");
    assert.doesNotMatch(provider.replace(turnLine, ""), /const profile=resolvedProfile\?accessProfile\(/, "no second, un-narrowed turn profile");
    // Negative control: the pattern does not match the old line.
    assert.doesNotMatch("const profile=resolvedProfile?accessProfile(resolvedProfile,chosenAccess):null;", turnLine);
    // The refusal reaches the learner with the input restored (TurnToolModeError branch).
    assert.match(provider, /inputRejected[\s\S]{0,400}error instanceof TurnToolModeError \? error\.message/);
    const turnAt = provider.search(turnLine), sdkAt = provider.indexOf("const sdkEnd = await runSdkCoach({"), localAt = provider.indexOf("const result=await runLocalCoach({config:local,profile,");
    assert.ok(turnAt > 0 && sdkAt > turnAt && localAt > turnAt, "the narrowed profile is computed before both runtimes run");
    const ext = read("src/extension.ts");
    assert.match(ext, /registerCommand\(FOLDER_CONSENT_COMMAND, async \(\) => \{\s*await changeFolderConsent\(context, await provider\.ensureProfile\(\), \{ servedRoot: provider\.servedClassRoot/);
    const manifest = JSON.parse(read("package.json"));
    const cmd = manifest.contributes.commands.find((c) => c.command === FC.FOLDER_CONSENT_COMMAND);
    assert.ok(cmd && cmd.title.endsWith(FC.FOLDER_CONSENT_COMMAND_TITLE), "the command is in the palette");
    assert.match(read("src/sdkCoach.ts"), /folderRemoved: folderRemovedFeatures\(args\.profile\)/);
    assert.match(read("src/localRuntime/tools.ts"), /folderRemovedFeatures\(args\.profile\)\.has\(toolFeatureKey\(name\) \?\? ""\) \? "folder_choice_narrowed"/);
    ok("wiring: send path narrows before both runtimes and keeps input on refusal; command registered and contributed; SDK and local gates name 폴더 권한");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nfolder-consent.smoke.mjs — ${passed} checks passed`);
