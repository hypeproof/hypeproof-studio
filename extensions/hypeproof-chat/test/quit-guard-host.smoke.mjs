// REQ-STUDIO-QUIT-GUARD — what the host tells the quit guard: a running turn, and a queued
// unsent message reported per chat surface (sidebar and editor chat) and forgotten when that
// surface goes away.
import assert from "node:assert/strict";
import { build } from "esbuild";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/chatPanelProvider.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
const vscodeStub = { Uri: { joinPath: () => ({}) }, ViewColumn: { One: 1 } };
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscodeStub : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, URL, AbortSignal, AbortController, TextEncoder, TextDecoder });
const { quitGuardPrompt } = await import("../src/quitGuardHelpers.ts");

const provider = Object.create(module.exports.ChatPanelProvider.prototype);
Object.assign(provider, {
  context: { extensionUri: {} },
  renderHtml: () => "",
  finishNotice: { release() {} },
  writeApprovalRequest: { cancel() {} },
  activeStreams: new Map(),
  pendingSends: 0,
  queuedSources: new Set(),
  // A task workspace whose active task does not match: any message that reaches the task
  // checks is answered with a task error instead of being handled.
  currentTaskStore: () => ({ getView: () => ({ activeTaskId: "task-1" }) }),
  posted: [],
});
provider.post = async (m) => { provider.posted.push(m); };

function surface() {
  const s = { listeners: [], disposers: [], visible: true };
  s.webview = { options: null, html: "", onDidReceiveMessage: (fn) => s.listeners.push(fn) };
  s.onDidDispose = (fn) => s.disposers.push(fn);
  s.onDidChangeVisibility = () => {};
  s.onDidChangeViewState = () => {};
  s.reveal = () => {};
  s.send = async (msg) => { for (const fn of s.listeners) await fn(msg); };
  s.dispose = () => { for (const fn of s.disposers) fn(); };
  return s;
}

const activity = () => ({ ...provider.quitGuardActivity() }); // copy out of the vm realm
assert.deepEqual(activity(), { turnRunning: false, queuedUnsent: false });
assert.equal(quitGuardPrompt(activity()), null, "idle: no dialog");

// Sidebar reports a queued message (no taskId: the report bypasses the task checks).
const sidebar = surface();
provider.resolveWebviewView(sidebar);
await sidebar.send({ type: "queueState", queued: true });
assert.deepEqual(provider.posted, [], "a queue report is never answered with a task error");
assert.deepEqual(activity(), { turnRunning: false, queuedUnsent: true });
assert.equal(quitGuardPrompt(activity()).detail.split("\n")[0], "보내지 않은 메시지가 있어요.");

// The editor chat reports its own queue; clearing one surface keeps the other.
const editor = surface();
await provider.openInEditor(editor);
await editor.send({ type: "queueState", queued: true });
await sidebar.send({ type: "queueState", queued: false });
assert.equal(activity().queuedUnsent, true, "the editor chat still holds a message");
editor.dispose();
assert.equal(activity().queuedUnsent, false, "a closed surface's queue is forgotten");

// A sidebar that goes away while holding a queue is forgotten too.
await sidebar.send({ type: "queueState", queued: true });
assert.equal(activity().queuedUnsent, true);
sidebar.dispose();
assert.equal(activity().queuedUnsent, false);

// Only a literal true counts as queued.
const again = surface();
provider.resolveWebviewView(again);
await again.send({ type: "queueState", queued: "yes" });
assert.equal(activity().queuedUnsent, false);

// A running turn, in any of its forms, is reported.
provider.activeStreams.set("s1", new AbortController());
assert.equal(activity().turnRunning, true);
assert.equal(quitGuardPrompt(activity()).detail.split("\n")[0], "지금 하고 있는 대답이 멈춰요.");
provider.activeStreams.clear();
provider.pendingSends = 1;
assert.equal(activity().turnRunning, true, "a send that has not opened its stream yet");
provider.pendingSends = 0;
provider.pendingApprovals = new Map([["a", {}]]);
assert.equal(activity().turnRunning, true, "a turn waiting on an approval");
provider.pendingApprovals = new Map();
assert.equal(activity().turnRunning, false);

// The command the core calls is registered with this answer.
const ext = fs.readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");
assert.ok(ext.includes("vscode.commands.registerCommand(QUIT_GUARD_COMMAND, () => quitGuardPrompt(provider.quitGuardActivity())),"));

// An update install, which ends in a quit, is refused while a turn runs.
assert.ok(ext.includes("if (provider.hasActiveStream()) {\n        void vscode.window.showInformationMessage(UPDATE_DURING_TURN_COPY);\n        return;\n      }"));
assert.ok(ext.indexOf("UPDATE_DURING_TURN_COPY);") < ext.indexOf("await runUpdate(info"), "checked before the update starts");

console.log("quit guard host: running turn and per-surface queued message reported, cleared on close PASS");
