// REQ-STUDIO-MISSING-TASK-FOLDER (CGP-AGENT-R-028 / REQ-CGP-AGENT-57): a personal task whose folder
// was moved, renamed or deleted gets one calm in-chat notice with one action, 다시 고르기, instead of a
// failed send. The send is held with the draft kept; the rebind goes through the canonical path and
// folder consent (#2065); classroom and lesson seats keep the existing refusal.
//
// 1 is pure (missingTaskFolder.ts). 2 runs the real folderConsentHost.ts for a picked folder. 3 runs
// the real ChatPanelProvider methods (send hold, notice, 다시 고르기) against a fake VS Code, in the
// style of folder-consent.smoke.mjs. 4 locks the wiring.
//
// Run: node --experimental-strip-types test/missing-task-folder.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";

const M = await import("../src/missingTaskFolder.ts");
const FC = await import("../src/folderConsent.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.join(here, "..");
const require = createRequire(import.meta.url);
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "missing-task-folder-")));
const J = (x) => JSON.parse(JSON.stringify(x)); // values from the vm realm

try {
  const home = path.join(tmp, "HypeProof", "studio");
  const inside = path.join(home, "site");
  const outside = path.join(tmp, "Documents", "Proj");
  const gone = path.join(tmp, "Documents", "Renamed-away");
  const aFile = path.join(tmp, "notes.txt");
  for (const d of [home, inside, outside]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(aFile, "x");
  const outsideLink = path.join(tmp, "proj-link");
  fs.symlinkSync(outside, outsideLink, "dir");

  // ── 1. Pure decisions and copy ──
  {
    assert.equal(await M.folderReachable(home), true);
    assert.equal(await M.folderReachable(gone), false, "a deleted folder is not reachable");
    assert.equal(await M.folderReachable(aFile), false, "a file is not a folder");
    const eacces = async () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); };
    assert.equal(await M.folderReachable(home, { stat: eacces, access: async () => {} }), false, "a locked parent (stat EACCES) is not reachable");
    assert.equal(await M.folderReachable(home, { stat: async () => ({ isDirectory: () => true }), access: eacces }), false, "a folder Studio may not read and write is not reachable");
    const locked = path.join(tmp, "locked");
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o000);
    if (process.getuid?.() !== 0) assert.equal(await M.folderReachable(locked), false, "chmod 000 on disk: not reachable");
    fs.chmodSync(locked, 0o700);
    assert.equal(await M.folderReachable(locked), true, "control: the same folder readable again is reachable");
    assert.equal(await M.missingTaskFolder({ applies: true, folder: gone }), path.resolve(gone));
    // Negative controls: an existing folder, a class seat, no folder known.
    assert.equal(await M.missingTaskFolder({ applies: true, folder: home }), null, "an existing folder gives no notice");
    assert.equal(await M.missingTaskFolder({ applies: false, folder: gone }), null, "a class or lesson seat gets no notice");
    assert.equal(await M.missingTaskFolder({ applies: true, folder: undefined }), null, "no folder known is not 'missing'");
    // A path that now resolves to another folder (a symlink swapped in) is missing; the bound folder is not.
    assert.equal(await M.missingTaskFolder({ applies: true, folder: outsideLink, recorded: home, canonical: FC.canonicalFolder }), path.resolve(outsideLink), "symlink swap → notice");
    assert.equal(await M.missingTaskFolder({ applies: true, folder: outsideLink, recorded: outside, canonical: FC.canonicalFolder }), null, "control: the link to the bound folder is that folder");
    // A one-off error is not remembered: the next check sees the folder again.
    let flaky = true;
    const once = async () => { if (flaky) { flaky = false; return false; } return true; };
    assert.ok(await M.missingTaskFolder({ applies: true, folder: home, reachable: once }), "first check: transient error");
    assert.equal(await M.missingTaskFolder({ applies: true, folder: home, reachable: once }), null, "next check: back");
    const notice = M.missingTaskFolderNotice(gone);
    assert.deepEqual(notice, { message: "이 작업의 폴더를 찾을 수 없어요. 옮기거나 지웠다면 폴더를 다시 골라 주세요.", action: "다시 고르기" });
    assert.equal(M.missingTaskFolderNotice(null), null);
    assert.equal(M.missingTaskFolderNotice(gone, "x").note, "x");
    for (const s of [M.MISSING_TASK_FOLDER_COPY, M.MISSING_TASK_FOLDER_ACTION, M.MISSING_TASK_FOLDER_NOT_A_FOLDER, M.MISSING_TASK_FOLDER_UNDECIDED, M.MISSING_TASK_FOLDER_FAILED, M.MISSING_TASK_FOLDER_NO_AI]) {
      assert.match(s, /[가-힣]/, `Korean copy: ${s}`);
      assert.doesNotMatch(s, /FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|역량|점수|선생님/, `no capability label or teacher word: ${s}`);
    }
    // The pick: cancel, not a folder, a folder in its canonical spelling.
    assert.deepEqual(await M.repickedFolder(undefined, FC.canonicalFolder), { kind: "cancel" });
    assert.deepEqual(await M.repickedFolder(aFile, FC.canonicalFolder), { kind: "invalid" });
    assert.deepEqual(await M.repickedFolder(gone, FC.canonicalFolder), { kind: "invalid" });
    assert.deepEqual(await M.repickedFolder(outsideLink, FC.canonicalFolder), { kind: "ok", folder: outside }, "a symlink is followed to the folder it names");
    assert.deepEqual(await M.repickedFolder(outside, () => { throw new Error("gone between checks"); }), { kind: "invalid" });
    ok("pure: missing / file / unreadable (chmod 000, locked parent) / symlink swap → notice; a transient error is not remembered; existing folder, class seat, no folder → none; pick → cancel / invalid / canonical folder");
  }

  // ── 2. Folder consent for a picked folder (the real host module) ──
  {
    const bundle = await build({ entryPoints: [path.join(extRoot, "src/folderConsentHost.ts")], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ui = { modal: [], answer: undefined };
    const vscode = {
      workspace: { get workspaceFolders() { return [{ uri: { fsPath: gone } }]; } },
      window: { showWarningMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); return ui.answer; } },
    };
    const mod = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, process, Buffer, URL, TextEncoder, TextDecoder, crypto: webcrypto });
    const host = mod.exports;
    const state = new Map();
    const context = { globalState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } } };
    const personal = { profile_id: "p", activity_id: "a".repeat(64), activity_kind: "personal", sdk_tools: { read: true, write: true } };
    const opts = { servedRoot: home };
    assert.equal(await host.folderConsentForFolder(context, personal, opts, inside), "own", "inside the activity's own folder: nothing to ask");
    assert.equal(await host.folderConsentForFolder(context, { ...personal, activity_kind: "classroom" }, opts, outside), "own", "a class seat never asks");
    assert.equal(ui.modal.length, 0);
    ui.answer = undefined;
    assert.equal(await host.folderConsentForFolder(context, personal, opts, outside), undefined, "closed: no answer");
    assert.equal(ui.modal.length, 1);
    assert.equal(ui.modal[0].message, FC.FOLDER_CONSENT_TITLE, "the usual consent question");
    assert.ok(ui.modal[0].opts.detail.startsWith(outside), "it names the picked folder, not the missing one");
    assert.equal(state.size, 0, "a closed question remembers nothing");
    ui.answer = FC.FOLDER_CONSENT_LABEL.read;
    assert.equal(await host.folderConsentForFolder(context, personal, opts, outside), "read");
    assert.equal(FC.readFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, outside), "read", "remembered under the canonical folder");
    ui.answer = undefined;
    assert.equal(await host.folderConsentForFolder(context, personal, opts, outside), "read", "asked once per folder");
    assert.equal(ui.modal.length, 2);
    ok("consent for a picked folder: own / class → nothing to ask; outside → the usual question naming the picked folder, remembered once, closing remembers nothing");
  }

  // ── 3. The real chat host: notice, send hold, 다시 고르기 ──
  {
    const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {ActivityConnectionError} from './src/activityConnections';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ws = { folder: undefined };
    const ui = { toasts: [], modal: [], answer: undefined, picked: undefined, dialogs: [] };
    const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
    const vscode = {
      ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
      Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
      commands: { executeCommand: async () => undefined },
      window: {
        showWarningMessage: async (message, opts, ...items) => { if (opts?.modal) { ui.modal.push({ message, opts, items }); return ui.answer; } ui.toasts.push(message); return undefined; },
        showInformationMessage: async (m) => { ui.toasts.push(m); }, showErrorMessage: async (m) => { ui.toasts.push(m); },
        showOpenDialog: async (o) => { ui.dialogs.push(o); return ui.picked ? [toUri(ui.picked)] : undefined; },
        withProgress: async (_o, f) => f(),
      },
      workspace: {
        get workspaceFolders() { return ws.folder ? [{ uri: toUri(ws.folder), name: path.basename(ws.folder) }] : undefined; },
        getConfiguration: () => ({ get: (_k, fallback) => fallback }),
      },
    };
    const mod = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {}, error() {} }, process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortSignal, crypto: webcrypto });
    const { ChatPanelProvider, ActivityConnectionError } = mod.exports;
    const state = new Map();
    const personal = { profile_id: "p", activity_id: "d".repeat(64), activity_kind: "personal", sdk_tools: { read: true, write: true } };
    const store = { getView: () => ({ activeTaskId: "t1", revision: 1, tasks: [], scope: "s", sourceSelection: null }), getHistory: () => [] };
    const make = (profile = personal) => {
      const h = Object.create(ChatPanelProvider.prototype);
      const posts = [], order = [];
      const reached = { turn: 0 };
      Object.assign(h, {
        context: { globalState: { get: (k) => state.get(k), update: async (k, v) => { state.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => "tok" } },
        cachedProfile: profile, servedWorkspaceRoot: home, _instructorMode: { isInstructor: false },
        pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnRequests: new Map(),
        currentTaskStore: () => store,
        post: async (m) => { posts.push(J(m)); return true; },
        postHistory: async () => { posts.push({ type: "history" }); },
        // The ordinary turn: reaching it means the send was not held.
        handleSend: async () => { reached.turn++; },
        setConnectionChanging: async (v) => { order.push(`changing:${v}`); },
        ensureProfile: async () => profile,
        // The store carry is exercised with the real store in section 3b; here it succeeds.
        carryTaskStoreTo: async (folder) => { order.push(`carry:${folder}`); return true; },
      });
      h.setProjectOpener(async (folder) => { order.push(`open:${folder}`); ws.folder = folder; });
      const notices = () => posts.filter((m) => m.type === "missingTaskFolder");
      return { h, posts, order, reached, notices, last: () => notices().at(-1)?.notice ?? null };
    };

    // The webview's own message, through the real dispatcher (taskId = the open task).
    const send = (h, text, userMessageId) => h.handleMessage({ type: "sendMessage", text, history: [], taskId: "t1", userMessageId });
    // A missing folder: one notice, no toast, the send is held with the draft kept, no turn starts.
    ws.folder = gone;
    {
      const { h, posts, reached, notices, last } = make();
      await send(h, "고양이 그려 줘", "local-1");
      assert.equal(reached.turn, 0, "no turn starts while the folder is missing");
      const rejected = posts.find((m) => m.type === "inputRejected");
      assert.ok(rejected && rejected.text === "고양이 그려 줘", "the text goes back to the composer (draft kept)");
      assert.ok(posts.some((m) => m.type === "history"), "the unsent bubble is replaced by the saved conversation");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone), "one in-chat notice");
      assert.equal(notices().length, 1);
      assert.ok(!posts.some((m) => m.type === "streamError"), "no error banner");
      assert.deepEqual(ui.toasts, [], "no toast");
      assert.equal(h.pendingSends, 0, "the held send leaves no pending slot");
    }
    // Negative control: an existing folder → no notice, the turn starts as before.
    ws.folder = outside;
    {
      const { h, reached, notices } = make();
      await send(h, "고양이 그려 줘", "local-2");
      assert.equal(reached.turn, 1, "the ordinary turn starts");
      assert.equal(notices().filter((m) => m.notice).length, 0, "no notice for an existing folder");
      await h.postMissingTaskFolder();
      assert.equal(notices().at(-1).notice, null, "the state says: no notice");
    }
    // A classroom seat and a lesson-bound seat with a missing folder: no notice, the existing (stricter) path runs.
    ws.folder = gone;
    for (const seat of [{ ...personal, activity_kind: "classroom" }, { ...personal, lesson: { content: { title: "수업" } } }]) {
      const { h, reached, notices } = make(seat);
      await send(h, "안녕", "local-3");
      assert.equal(reached.turn, 1, `${seat.activity_kind}${seat.lesson ? "+lesson" : ""}: the existing send path decides`);
      assert.equal(notices().filter((m) => m.notice).length, 0, "no notice for a class or lesson seat");
    }
    // The instructor surface and a seat without personal tasks: no notice either.
    {
      const { h } = make();
      h._instructorMode = { isInstructor: true };
      assert.equal(await h.missingTaskFolderPath(), null, "instructor: no notice");
      const { h: h2 } = make();
      h2.currentTaskStore = () => undefined;
      assert.equal(await h2.missingTaskFolderPath(), null, "no personal task store: no notice");
    }

    // 다시 고르기 → a folder inside the activity's own folder: rebinds, no consent question, notice gone.
    ws.folder = gone;
    {
      const { h, order, last } = make();
      ui.picked = inside; ui.modal.length = 0;
      await h.repickTaskFolder();
      assert.equal(ui.dialogs.at(-1).canSelectFolders, true, "the folder picker");
      assert.equal(ui.dialogs.at(-1).canSelectFiles, false);
      assert.equal(ui.dialogs.at(-1).openLabel, M.MISSING_TASK_FOLDER_PICK_LABEL);
      assert.deepEqual(order, ["changing:true", `carry:${inside}`, `open:${inside}`, "changing:false"], "the draft is flushed and the store carried before the move, through the project opener");
      assert.equal(ui.modal.length, 0, "own folder: no consent question");
      assert.equal(last(), null, "the notice goes away");
      assert.deepEqual(ui.toasts, []);
    }
    // 다시 고르기 → an outside folder (via a symlink): the consent question first, then the move to the canonical folder.
    ws.folder = gone;
    {
      const { h, order, last } = make();
      ui.picked = outsideLink; ui.answer = FC.FOLDER_CONSENT_LABEL.read; ui.modal.length = 0;
      await h.repickTaskFolder();
      assert.equal(ui.modal.length, 1, "folder consent asks");
      assert.equal(ui.modal[0].message, FC.FOLDER_CONSENT_TITLE);
      assert.ok(ui.modal[0].opts.detail.startsWith(outside), "for the canonical picked folder");
      assert.deepEqual(order, ["changing:true", `carry:${outside}`, `open:${outside}`, "changing:false"]);
      assert.equal(FC.readFolderConsent(state.get(FC.FOLDER_CONSENT_KEY), personal.activity_id, outside), "read");
      assert.equal(last(), null);
    }
    // Closing the consent question: the task does not move; the notice stays with one line why.
    ws.folder = gone;
    {
      const other = { ...personal, activity_id: "e".repeat(64) };
      const { h, order, last } = make(other);
      ui.picked = outside; ui.answer = undefined; ui.modal.length = 0;
      await h.repickTaskFolder();
      assert.equal(ui.modal.length, 1, "asked (a new activity has no remembered choice)");
      assert.deepEqual(order, [], "nothing moves");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone, M.MISSING_TASK_FOLDER_UNDECIDED));
    }
    // A file, a cancelled picker, and a failed move: the notice stays; nothing is lost.
    ws.folder = gone;
    {
      const { h, order, last } = make();
      ui.picked = aFile;
      await h.repickTaskFolder();
      assert.deepEqual(order, []);
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone, M.MISSING_TASK_FOLDER_NOT_A_FOLDER));
      ui.picked = undefined;
      await h.repickTaskFolder();
      assert.deepEqual(order, [], "cancel moves nothing");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone));
      h.setProjectOpener(async () => { throw new Error("EACCES /secret/path"); });
      ui.picked = inside;
      await h.repickTaskFolder();
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone, M.MISSING_TASK_FOLDER_FAILED), "a raw error never reaches the learner");
      h.setProjectOpener(async () => { throw new ActivityConnectionError("이 폴더는 다른 활동에 연결돼 있습니다. 다른 작업 폴더를 선택해 주세요."); });
      await h.repickTaskFolder();
      assert.equal(last().note, "이 폴더는 다른 활동에 연결돼 있습니다. 다른 작업 폴더를 선택해 주세요.", "the activity's own reason is shown");
      assert.ok(order.filter((x) => x === "changing:false").length === order.filter((x) => x === "changing:true").length, "the freeze is always released");
      assert.deepEqual(ui.toasts, []);
    }
    // Negative control: 다시 고르기 when the folder exists does nothing but clear the notice.
    ws.folder = outside;
    {
      const { h, order, last } = make();
      const before = ui.dialogs.length;
      await h.repickTaskFolder();
      assert.equal(ui.dialogs.length, before, "no picker when nothing is missing");
      assert.deepEqual(order, []);
      assert.equal(last(), null);
    }
    // While a turn runs, 다시 고르기 does not move the folder under it.
    ws.folder = gone;
    {
      const { h, order } = make();
      h.pendingSends = 1;
      const before = ui.dialogs.length;
      ui.picked = inside;
      await h.repickTaskFolder();
      assert.equal(ui.dialogs.length, before);
      assert.deepEqual(order, []);
    }
    // N2: answering "AI 안 씀" for the picked folder does not move the task there.
    ws.folder = gone;
    {
      const other = { ...personal, activity_id: "f".repeat(64) };
      const { h, order, last } = make(other);
      ui.picked = outside; ui.answer = FC.FOLDER_CONSENT_LABEL.none; ui.modal.length = 0;
      await h.repickTaskFolder();
      assert.equal(ui.modal.length, 1, "asked");
      assert.deepEqual(order, [], "'AI 안 씀' moves nothing");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone, M.MISSING_TASK_FOLDER_NO_AI));
      ui.answer = undefined;
      await h.repickTaskFolder();
      assert.deepEqual(order, [], "a remembered 'AI 안 씀' moves nothing either");
    }
    // A store that could not be carried: the task does not move.
    ws.folder = gone;
    {
      const { h, order, last } = make();
      h.carryTaskStoreTo = async () => false;
      ui.picked = inside;
      await h.repickTaskFolder();
      assert.ok(!order.some((x) => x.startsWith("open:")), "no move without the conversation");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone, M.MISSING_TASK_FOLDER_FAILED));
    }
    // T1: a retry is held the same way (behaviour, not only the source wiring).
    ws.folder = gone;
    {
      const { h, posts, reached, last } = make();
      await h.handleMessage({ type: "retryMessage", prompt: "다시 해 줘", history: [], taskId: "t1", userMessageId: "local-r" });
      assert.equal(reached.turn, 0, "the retry starts no turn");
      assert.equal(posts.find((m) => m.type === "inputRejected")?.text, "다시 해 줘", "the retry text goes back");
      assert.deepEqual(last(), M.missingTaskFolderNotice(gone));
      ws.folder = outside;
      await h.handleMessage({ type: "retryMessage", prompt: "다시 해 줘", history: [], taskId: "t1", userMessageId: "local-r2" });
      assert.equal(reached.turn, 1, "control: with the folder there, the retry runs");
    }
    // M3: the next send checks again; a folder that is back sends without 다시 고르기.
    const back = path.join(tmp, "Documents", "comes-back");
    ws.folder = back;
    {
      const { h, reached } = make();
      await send(h, "안녕", "local-m3a");
      assert.equal(reached.turn, 0, "held while gone");
      fs.mkdirSync(back, { recursive: true });
      await send(h, "안녕", "local-m3b");
      assert.equal(reached.turn, 1, "the next send runs once the folder is back");
    }
    ok("chat host: missing → notice + held send and retry (draft back, no toast, no turn); existing folder / class / lesson / instructor → no notice; the next send re-checks; 다시 고르기 → own folder rebinds, outside asks consent first; closing, 'AI 안 씀', file, cancel, failed carry or move keep the notice");
  }

  // ── 3b. B1: the rebind keeps the conversation and the draft (real TaskWorkspaceStore, real ActivityConnections) ──
  {
    const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {ActivityConnections} from './src/activityConnections'; export {TaskWorkspaceStore} from './src/taskWorkspaceStore'; export {taskWorkspaceRoot, taskWorkspaceScope} from './src/trialCarryoverSource';", resolveDir: extRoot, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const ws = { folder: undefined };
    const ui = { picked: undefined, modal: 0 };
    const toUri = (p) => ({ fsPath: p, path: p, scheme: "file" });
    const vscode = {
      ViewColumn: { One: 1, Two: 2, Beside: 2 }, ProgressLocation: { Window: 10, Notification: 15 },
      Uri: { file: toUri, joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)), parse: (x) => toUri(x) },
      commands: { executeCommand: async () => undefined },
      window: {
        showWarningMessage: async () => { ui.modal++; return undefined; }, showInformationMessage: async () => undefined,
        showOpenDialog: async () => (ui.picked ? [toUri(ui.picked)] : undefined), withProgress: async (_o, f) => f(),
      },
      workspace: { get workspaceFolders() { return ws.folder ? [{ uri: toUri(ws.folder), name: path.basename(ws.folder) }] : undefined; }, getConfiguration: () => ({ get: (_k, fallback) => fallback }) },
    };
    const mod = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console: { ...console, log() {}, warn() {}, error() {} }, process, Buffer, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, AbortSignal, crypto: webcrypto });
    const { ChatPanelProvider, ActivityConnections, TaskWorkspaceStore, taskWorkspaceRoot, taskWorkspaceScope } = mod.exports;
    const { emptyActivityDraft } = await import("../src/activityDraft.ts");

    const storage = path.join(tmp, "global-storage");
    fs.mkdirSync(storage, { recursive: true });
    const mem = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => { m.set(k, v); }, keys: () => [...m.keys()] }; };
    const secretMap = new Map();
    const raw = {
      globalStorageUri: { fsPath: storage }, globalState: mem(), workspaceState: mem(),
      secrets: { get: async (k) => secretMap.get(k), store: async (k, v) => { secretMap.set(k, v); }, delete: async (k) => { secretMap.delete(k); }, keys: async () => [...secretMap.keys()], onDidChange: () => ({ dispose() {} }) },
    };
    const conn = new ActivityConnections(raw, () => "http://127.0.0.1:8787/v1", () => ws.folder, async () => profile);
    const context = conn.wrap();
    const profile = { profile_id: "personal-a", activity_id: "c".repeat(64), activity_kind: "personal", display_name: "내 작업", sdk_tools: { read: true, write: true } };
    const oldFolder = path.join(home, "cat-game");
    const newFolder = path.join(home, "cat-game-moved");
    fs.mkdirSync(oldFolder, { recursive: true });
    fs.mkdirSync(newFolder, { recursive: true });
    ws.folder = oldFolder;
    await conn.commit("tok", profile, oldFolder);

    const host = () => {
      const h = Object.create(ChatPanelProvider.prototype);
      Object.assign(h, {
        context, cachedProfile: profile, servedWorkspaceRoot: home, _instructorMode: { isInstructor: false },
        pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnRequests: new Map(),
        post: async () => true, postHistory: async () => {}, ensureProfile: async () => profile,
        setConnectionChanging: async () => {},
      });
      // The extension's opener commits the activity to the picked folder, then reloads into it.
      h.setProjectOpener(async (folder) => { await conn.commit("tok", profile, folder); ws.folder = folder; });
      return h;
    };
    const before = host();
    await before.prepareTaskWorkspace(false);
    const store = before.currentTaskStore();
    assert.ok(store, "a personal activity has a task store");
    const taskId = store.getView().activeTaskId;
    await store.append(taskId, [{ id: "u1", role: "user", content: "고양이 게임 만들어 줘", createdAt: 1 }]);
    const draft = { ...emptyActivityDraft(), text: "점수판도 달아 줘" };
    await store.saveDraft(taskId, draft);

    // The learner renames the folder away; 다시 고르기 → the moved folder.
    fs.rmSync(oldFolder, { recursive: true, force: true });
    assert.ok(await before.missingTaskFolderPath(), "the old folder is missing");
    ui.picked = newFolder;
    await before.repickTaskFolder();
    assert.equal(conn.current.workspace, fs.realpathSync(newFolder), "the activity now names the new folder");

    // The window reloads: a new host opens the store for the new record.
    const after = host();
    await after.prepareTaskWorkspace(false);
    const reopened = after.currentTaskStore();
    assert.notEqual(reopened.scope, store.scope, "the new folder has its own scope");
    assert.equal(reopened.getView().activeTaskId, taskId, "the same task is open");
    assert.deepEqual(J(reopened.getHistory()).map((m) => m.content), ["고양이 게임 만들어 줘"], "the conversation is there");
    assert.equal(reopened.getDraft().text, "점수판도 달아 줘", "the draft is there");
    assert.equal(await after.missingTaskFolderPath(), null, "no notice in the new folder");
    // The old scope is never deleted.
    const old = new TaskWorkspaceStore(taskWorkspaceRoot(storage), taskWorkspaceScope({ id: conn.current.id, workspace: oldFolder }));
    assert.equal(old.scope, store.scope, "that is the store the old window used");
    assert.equal(J(old.getHistory()).length, 1, "the old scope keeps its copy");

    const taskDir = path.join(taskWorkspaceRoot(storage), "task-workspaces");
    const backups = () => fs.readdirSync(taskDir).filter((f) => f.includes(".pre-rebind-"));
    const reopen = async () => { const h = host(); await h.prepareTaskWorkspace(false); return h; };

    // B2 (a): A → B, keep working in B, then 다시 고르기 back to A. A's scope already holds the task;
    // the copy from B (where the learner is now) wins, and A's older copy is kept as a backup.
    await reopened.append(taskId, [{ id: "a1", role: "assistant", content: "고양이가 움직여요", createdAt: 2 }, { id: "u2", role: "user", content: "점프도 넣어 줘", createdAt: 3 }]);
    await reopened.saveDraft(taskId, { ...emptyActivityDraft(), text: "B에서 쓴 초안" });
    fs.mkdirSync(oldFolder, { recursive: true }); // the learner moved it back
    fs.rmSync(newFolder, { recursive: true, force: true });
    ws.folder = newFolder;
    assert.equal(backups().length, 0, "no backup before any replacement");
    ui.picked = oldFolder;
    await after.repickTaskFolder();
    assert.equal(conn.current.workspace, fs.realpathSync(oldFolder), "the round trip moves back to A");
    const backA = (await reopen()).currentTaskStore();
    assert.equal(backA.scope, store.scope, "A's own scope again");
    assert.deepEqual(J(backA.getHistory(taskId)).map((m) => m.id), ["u1", "a1", "u2"], "B's conversation wins over A's older copy");
    assert.equal(backA.getDraft(taskId).text, "B에서 쓴 초안", "B's draft wins");
    const saved = backups();
    assert.equal(saved.length, 1, "A's replaced copy is kept as one backup file");
    const backup = JSON.parse(fs.readFileSync(path.join(taskDir, saved[0]), "utf8"));
    assert.equal(backup.task.id, taskId);
    assert.deepEqual(backup.task.messages.map((m) => m.id), ["u1"], "the backup holds A's copy as it was");
    assert.equal(backup.task.draft.text, "점수판도 달아 줘");

    // A task only the target holds is kept beside the moved ones.
    const cFolder = path.join(home, "cat-game-c");
    fs.mkdirSync(cFolder, { recursive: true });
    const cScope = taskWorkspaceScope({ id: conn.current.id, workspace: fs.realpathSync(cFolder) });
    const cOwn = new TaskWorkspaceStore(taskWorkspaceRoot(storage), cScope);
    await cOwn.initialize([], emptyActivityDraft());
    const cOwnTask = cOwn.getView().activeTaskId;

    // B2 (b): a half-done move (the copy landed, the move did not), then the draft is edited, then a retry.
    await new TaskWorkspaceStore(taskWorkspaceRoot(storage), cScope).adoptFrom(backA);
    await backA.saveDraft(taskId, { ...emptyActivityDraft(), text: "고친 초안" });
    const inA = await reopen();
    fs.rmSync(oldFolder, { recursive: true, force: true });
    ws.folder = oldFolder;
    ui.picked = cFolder;
    await inA.repickTaskFolder();
    assert.equal(conn.current.workspace, fs.realpathSync(cFolder), "the retry moves");
    const inC = (await reopen()).currentTaskStore();
    assert.equal(inC.getView().activeTaskId, taskId, "the moved task is active");
    assert.equal(inC.getDraft(taskId).text, "고친 초안", "the edited draft wins over the half-done copy");
    assert.deepEqual(J(inC.getHistory(taskId)).map((m) => m.id), ["u1", "a1", "u2"]);
    assert.ok(inC.getView().tasks.some((t) => t.id === cOwnTask), "the target's own task is kept");
    assert.ok(backups().some((f) => f.startsWith(`${inC.scope}.${taskId}.pre-rebind-`)), "the half-done copy is backed up too");

    // M1 with the real record: the bound path swapped for a symlink to another tree → the notice.
    const elsewhere = path.join(tmp, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.rmSync(cFolder, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, cFolder, "dir");
    assert.equal(await (await reopen()).missingTaskFolderPath(), path.resolve(cFolder), "a symlink swap is missing too");
    ok("B1/B2: 다시 고르기 carries the task store to the new folder's scope (conversation and draft after the reload, old scope kept); a round trip and a retry after a half-done move let the moving copy win, back up the replaced copy and keep the target's own tasks; a symlink swap shows the notice");
  }

  // ── 3c. The carry at store level: diverged copies stay visible, backups are never overwritten, a failed carry leaves verdicts alone ──
  {
    const { TaskWorkspaceStore } = await import("../src/taskWorkspaceStore.ts");
    const { emptyActivityDraft } = await import("../src/activityDraft.ts");
    const root = path.join(tmp, "store-level");
    fs.mkdirSync(root);
    const dir = path.join(root, "task-workspaces");
    const msg = (id, role, content, createdAt) => ({ id, role, content, createdAt });
    const seed = async (scope) => { const st = new TaskWorkspaceStore(root, scope); await st.initialize([], emptyActivityDraft()); return st; };

    // N1: the target's copy has a turn the moving copy lacks → it stays as "<name> · 이전", and is backed up.
    const a = await seed("A");
    const id = a.getView().activeTaskId;
    await a.rename(id, "고양이 게임");
    await a.append(id, [msg("u1", "user", "고양이 게임 만들어 줘", 1)]);
    const b = new TaskWorkspaceStore(root, "B");
    await b.adoptFrom(a);
    await b.append(id, [msg("b1", "assistant", "B에서 만든 답", 2)]);
    await a.append(id, [msg("ua", "user", "A에서만 한 말", 3)]); // A was reopened elsewhere and used
    await new TaskWorkspaceStore(root, "A").adoptFrom(b);
    const backA = new TaskWorkspaceStore(root, "A");
    const view = backA.getView();
    assert.equal(view.activeTaskId, id, "the moved task is active");
    assert.deepEqual(backA.getHistory(id).map((m) => m.id), ["u1", "b1"], "the moving copy wins");
    const earlier = view.tasks.find((t) => t.title === "고양이 게임 · 이전");
    assert.ok(earlier, "A's diverged copy stays visible as its own task");
    assert.deepEqual(backA.getHistory(earlier.id).map((m) => m.id), ["u1", "ua"], "with the turn only A had");
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes(`.${id}.pre-rebind-`)).length, 1, "and it is still backed up");
    // Control: a target copy whose turns are all in the moving copy adds no "· 이전" task.
    await new TaskWorkspaceStore(root, "B").adoptFrom(backA);
    assert.equal(new TaskWorkspaceStore(root, "B").getView().tasks.filter((t) => t.title.endsWith("· 이전")).length, 1, "only the one carried over, no new one");

    // N3: a backup is never overwritten; the same millisecond picks the next free name and the move goes on.
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
      const c = await seed("C");
      const cid = c.getView().activeTaskId;
      await new TaskWorkspaceStore(root, "D").adoptFrom(c);
      const D = new TaskWorkspaceStore(root, "D");
      const first = path.join(dir, `${D.scope}.${cid}.pre-rebind-1700000000000.json`);
      fs.writeFileSync(first, "SENTINEL");
      await new TaskWorkspaceStore(root, "D").adoptFrom(c);
      await new TaskWorkspaceStore(root, "D").adoptFrom(c);
      assert.equal(fs.readFileSync(first, "utf8"), "SENTINEL", "an existing backup is never overwritten");
      const same = fs.readdirSync(dir).filter((f) => f.startsWith(`${D.scope}.${cid}.pre-rebind-1700000000000`)).sort();
      assert.deepEqual(same, [`${D.scope}.${cid}.pre-rebind-1700000000000-1.json`, `${D.scope}.${cid}.pre-rebind-1700000000000-2.json`, `${D.scope}.${cid}.pre-rebind-1700000000000.json`], "same-millisecond backups take unique names");
      assert.equal(new TaskWorkspaceStore(root, "D").getView().activeTaskId, cid, "the moves completed");
    } finally { Date.now = realNow; }

    // N2: a carry whose task-file write fails leaves the target's verdicts as they were.
    const e = await seed("E");
    const eid = e.getView().activeTaskId;
    await e.append(eid, [msg("u1", "user", "질문", 1), msg("a1", "assistant", "답", 2)]);
    await e.recordVerdict(eid, { messageId: "a1", verdict: "right", at: 10 });
    const f = new TaskWorkspaceStore(root, "F");
    await f.adoptFrom(e);
    await e.recordVerdict(eid, { messageId: "a1", verdict: "fix", at: 20 });
    const target = new TaskWorkspaceStore(root, "F");
    const verdictsBefore = fs.readFileSync(target.verdictsPath, "utf8");
    const write = target.writeAtomic.bind(target);
    target.writeAtomic = async (file, content, nonce) => { if (file === target.filePath) throw new Error("injected"); return write(file, content, nonce); };
    await assert.rejects(target.adoptFrom(e));
    assert.equal(fs.readFileSync(target.verdictsPath, "utf8"), verdictsBefore, "verdicts unchanged after a failed carry");
    await new TaskWorkspaceStore(root, "F").adoptFrom(e);
    assert.equal(new TaskWorkspaceStore(root, "F").getVerdicts(eid).a1?.verdict, "fix", "control: the retry carries the new verdict");
    ok("store: a diverged target copy stays visible as '· 이전' and is backed up; backups are never overwritten and same-ms names are unique; a failed carry leaves verdicts untouched");
  }

  // ── 4. Wiring ──
  {
    const read = (p) => fs.readFileSync(path.join(extRoot, p), "utf8");
    const provider = read("src/chatPanelProvider.ts");
    // Both entry points (a new message and a retry) hold before handleSend runs, so the send takes no slot.
    for (const [kind, arg] of [["sendMessage", "msg.text"], ["retryMessage", "msg.prompt"]]) {
      const at = provider.indexOf(`case "${kind}":`);
      const holdAt = provider.indexOf(`if (this.missingFolderApplies() && await this.missingTaskFolderPath()) { await this.holdSendForMissingFolder(${arg}, msg.images, requestedMode); return; }`, at);
      const sendAt = provider.indexOf("await this.handleSend(", at);
      assert.ok(at > 0 && holdAt > at && holdAt < sendAt, `${kind}: the hold runs before handleSend`);
    }
    assert.match(provider, /case "missingTaskFolderRequest": await this\.postMissingTaskFolder\(\); return;/);
    assert.match(provider, /case "missingTaskFolderRepick": await this\.repickTaskFolder\(\); return;/);
    const protocol = read("src/protocol.ts");
    assert.match(protocol, /type: "missingTaskFolder"; notice: import\("\.\/missingTaskFolder"\)\.MissingTaskFolderNotice \| null/);
    // The rebind reuses the project opener (activity commit + ensureWorkspace + canonical root), never a second path.
    const repick = provider.slice(provider.indexOf("  private async repickTaskFolder("), provider.indexOf("  private async repickTaskFolder(") + 3000);
    assert.match(repick, /folderConsentForFolder\(/, "consent before the move");
    assert.match(repick, /this\.projectOpener\(/, "the move goes through the project opener");
    assert.doesNotMatch(repick, /vscode\.openFolder|connections\.commit\(/, "no second rebind path");
    assert.doesNotMatch(repick, /showWarningMessage\(|showInformationMessage\(|showErrorMessage\(/, "no toast");
    ok("wiring: the hold precedes the send's slot; request/repick messages routed; the rebind reuses the project opener after consent; no toast");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nmissing-task-folder.smoke.mjs — ${passed} checks passed`);
