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
    assert.equal(M.folderReachable(home), true);
    assert.equal(M.folderReachable(gone), false, "a deleted folder is not reachable");
    assert.equal(M.folderReachable(aFile), false, "a file is not a folder");
    assert.equal(M.folderReachable(home, () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); }), false, "an unreadable folder is not reachable");
    assert.equal(M.missingTaskFolder({ applies: true, folder: gone }), path.resolve(gone));
    // Negative controls: an existing folder, a class seat, no folder known.
    assert.equal(M.missingTaskFolder({ applies: true, folder: home }), null, "an existing folder gives no notice");
    assert.equal(M.missingTaskFolder({ applies: false, folder: gone }), null, "a class or lesson seat gets no notice");
    assert.equal(M.missingTaskFolder({ applies: true, folder: undefined }), null, "no folder known is not 'missing'");
    const notice = M.missingTaskFolderNotice(gone);
    assert.deepEqual(notice, { message: "이 작업의 폴더를 찾을 수 없어요. 옮기거나 지웠다면 폴더를 다시 골라 주세요.", action: "다시 고르기" });
    assert.equal(M.missingTaskFolderNotice(null), null);
    assert.equal(M.missingTaskFolderNotice(gone, "x").note, "x");
    for (const s of [M.MISSING_TASK_FOLDER_COPY, M.MISSING_TASK_FOLDER_ACTION, M.MISSING_TASK_FOLDER_NOT_A_FOLDER, M.MISSING_TASK_FOLDER_UNDECIDED, M.MISSING_TASK_FOLDER_FAILED]) {
      assert.match(s, /[가-힣]/, `Korean copy: ${s}`);
      assert.doesNotMatch(s, /FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|역량|점수|선생님/, `no capability label or teacher word: ${s}`);
    }
    // The pick: cancel, not a folder, a folder in its canonical spelling.
    assert.deepEqual(M.repickedFolder(undefined, FC.canonicalFolder), { kind: "cancel" });
    assert.deepEqual(M.repickedFolder(aFile, FC.canonicalFolder), { kind: "invalid" });
    assert.deepEqual(M.repickedFolder(gone, FC.canonicalFolder), { kind: "invalid" });
    assert.deepEqual(M.repickedFolder(outsideLink, FC.canonicalFolder), { kind: "ok", folder: outside }, "a symlink is followed to the folder it names");
    assert.deepEqual(M.repickedFolder(outside, () => { throw new Error("gone between checks"); }), { kind: "invalid" });
    ok("pure: missing / file / unreadable → notice; existing folder, class seat, no folder → none; pick → cancel / invalid / canonical folder");
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
        pendingSends: 0, activeStreams: new Map(), turnRequests: new Map(),
        currentTaskStore: () => store,
        post: async (m) => { posts.push(J(m)); return true; },
        postHistory: async () => { posts.push({ type: "history" }); },
        // The ordinary turn: reaching it means the send was not held.
        handleSend: async () => { reached.turn++; },
        setConnectionChanging: async (v) => { order.push(`changing:${v}`); },
        ensureProfile: async () => profile,
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
      assert.equal(h.missingTaskFolderPath(), null, "instructor: no notice");
      const { h: h2 } = make();
      h2.currentTaskStore = () => undefined;
      assert.equal(h2.missingTaskFolderPath(), null, "no personal task store: no notice");
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
      assert.deepEqual(order, ["changing:true", `open:${inside}`, "changing:false"], "the draft is flushed before the move, through the project opener");
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
      assert.deepEqual(order, ["changing:true", `open:${outside}`, "changing:false"]);
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
    ok("chat host: missing → notice + held send (draft back, no toast, no turn); existing folder / class / lesson / instructor → no notice; 다시 고르기 → own folder rebinds, outside asks consent first, closing / file / cancel / failure keep the notice");
  }

  // ── 4. Wiring ──
  {
    const read = (p) => fs.readFileSync(path.join(extRoot, p), "utf8");
    const provider = read("src/chatPanelProvider.ts");
    // Both entry points (a new message and a retry) hold before handleSend runs, so the send takes no slot.
    for (const [kind, arg] of [["sendMessage", "msg.text"], ["retryMessage", "msg.prompt"]]) {
      const at = provider.indexOf(`case "${kind}":`);
      const holdAt = provider.indexOf(`if (this.missingTaskFolderPath()) { await this.holdSendForMissingFolder(${arg}, msg.images, requestedMode); return; }`, at);
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
