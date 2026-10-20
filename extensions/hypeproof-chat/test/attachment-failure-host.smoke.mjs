// CGP-KNOW-R-020 (REQ-STUDIO-ASK-ABOUT-FILE) — "이 파일에 대해 묻기" on the real ChatPanelProvider.
// Bundled with esbuild and run with only VS Code I/O substituted. The action must attach through
// the CGP-CHAT-R-011 path (fileAttachment.ts) with every refusal unchanged, keep the gate
// (sdk_tools.read, never instructors, REQ-M32 kids tracks included), refuse a folder whose stored
// choice is "AI 안 씀", focus the composer only after a successful attach and never send.
// The explorer command and the webview message are locked textually (manifest + wiring).
// Run: node --experimental-strip-types test/ask-about-file-host.smoke.mjs

import { build } from "esbuild";
import vm from "node:vm";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: {
    contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export * as fa from './src/fileAttachment'; export { folderNoAiCopy, FOLDER_CONSENT_KEY } from './src/folderConsent'; export { denialCopy } from './src/denialSource';",
    resolveDir: here, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-ask-file-")));
const root = path.join(tmp, "work");
const outside = path.join(tmp, "outside");
fs.mkdirSync(path.join(root, "notes"), { recursive: true });
fs.mkdirSync(outside);
const put = (rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

let dialogs = 0;
let modals = 0;
const vscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: root } }],
    getConfiguration: () => ({ get: (_k, fallback) => fallback }),
  },
  Uri: { joinPath: (uri, ...names) => ({ fsPath: path.join(uri.fsPath, ...names) }), file: (p) => ({ fsPath: p }) },
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
    showOpenDialog: async () => { dialogs++; return pickNext ? [{ fsPath: pickNext }] : undefined; },
    showWarningMessage: async () => { modals++; return undefined; },
  },
  ProgressLocation: { Window: 10 },
};
let pickNext = null;
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
const { ChatPanelProvider, fa, folderNoAiCopy, FOLDER_CONSENT_KEY, denialCopy } = module.exports;

const store = new Map();
const context = { globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, subscriptions: [] };
const PERSONAL = { activity_kind: "personal", activity_id: "act-1", sdk_tools: { read: true } };

let posted = [];
const h = Object.create(ChatPanelProvider.prototype);
Object.assign(h, {
  context,
  cachedProfile: PERSONAL,
  accessState: null,
  servedWorkspaceRoot: null,
  _instructorMode: { isInstructor: false },
  resolveCoachCwd: () => root,
  post: async (msg) => { posted.push(msg); return true; },
  // Nothing in this action may start a turn.
  handleSend: async () => { throw new Error("askAboutFile sent a message"); },
  sendToCoach: async () => { throw new Error("askAboutFile sent a message"); },
});

let fail = 0;
const t = async (label, fn) => {
  posted = []; h.pendingFileAttachment = null; store.clear(); dialogs = 0; modals = 0; pickNext = null;
  h.cachedProfile = PERSONAL; h._instructorMode = { isInstructor: false };
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const types = () => posted.map((m) => m.type);
const lastAttach = () => posted.filter((m) => m.type === "fileAttachment").at(-1);
const refusedWith = (copy, what) => {
  eq(h.pendingFileAttachment ?? null, null, `${what}: nothing queued`);
  eq(lastAttach()?.error, copy, `${what}: refusal copy`);
  ok(!types().includes("focusInput"), `${what}: a refusal does not move focus`);
};


console.log("attachment failure identity and retry — host");
await t("failed selection retains successful sibling and retries only the chosen file", async () => {
  const first = put("first.txt", "keep this");
  const failed = put("failed.txt", "");
  await h.attachWorkspaceFile(first);
  const original = h.pendingFileAttachment;
  await h.attachWorkspaceFile(failed);
  eq(h.pendingFileAttachment, original, "successful attachment retained");
  const failure = posted.find(m => m.type === 'attachmentFailure').failure;
  ok(failure.name === 'failed.txt', 'failed file chip has its own name');
  put('failed.txt', 'fixed content');
  posted = [];
  await h.retryAttachmentRead(failure.id);
  eq(h.pendingFileAttachment.preview.text, 'fixed content', 'only failed file reread');
  ok(posted.some(m => m.type === 'attachmentFailureResolved' && m.id === failure.id), 'resolved exact id');
  ok(!posted.some(m => m.type === 'streamStart'), 'no model send');
});
await t("retry denied by changed capability terminates busy state with retained failure", async () => {
  h.failedAttachmentReads = new Map();
  await h.attachWorkspaceFile(put('denied.txt', ''));
  const id = posted.find(m => m.type === 'attachmentFailure').failure.id;
  h.cachedProfile = { ...PERSONAL, sdk_tools: { read: false } };
  posted = [];
  await h.retryAttachmentRead(id);
  ok(posted.some(m => m.type === 'attachmentFailure' && m.failure.id === id), 'terminal failure for the same id');
  eq(h.failedAttachmentReads.get(id).running, undefined, 'retry no longer running');
});
await t("retry never follows a different activity or task", async () => {
  h.failedAttachmentReads = new Map();
  let scope = 'task-a'; h.turnRequestScope = () => scope;
  await h.attachWorkspaceFile(put('scoped.txt', ''));
  const id = posted.find(m => m.type === 'attachmentFailure').failure.id;
  scope = 'task-b'; put('scoped.txt', 'must not attach'); posted = [];
  await h.retryAttachmentRead(id);
  eq(posted, [], 'stale retry has no effect');
  eq(h.pendingFileAttachment, null, 'nothing attached');
});
await t("cancel an in-flight native retry and ignore its late read", async () => {
  h.failedAttachmentReads = new Map();
  h.turnRequestScope = () => 'task-native';
  h.isImagePasteEnabled = () => true;
  h.attachImageDataUrl = () => { throw new Error('removed native image attached'); };
  h.failAttachmentRead('/tmp/a.png', 'image', 'read failed', 'retry-native');
  let resolve;
  vscode.workspace.fs = { readFile: () => new Promise(r => { resolve = r; }) };
  const retry = h.retryAttachmentRead('retry-native');
  h.failedAttachmentReads.delete('retry-native');
  resolve(new Uint8Array([137,80,78,71]));
  await retry;
  ok(!posted.some(m => m.type === 'attachmentFailureResolved'), 'canceled retry not attached');
});
await t("native retry: a capability change keeps its own exact copy, before and after the read", async () => {
  h.failedAttachmentReads = new Map();
  h.turnRequestScope = () => 'task-perm';
  let enabled = true; h.isImagePasteEnabled = () => enabled;
  h.failAttachmentRead('/tmp/p.png', 'image', 'read failed', 'perm-id');
  let resolve; vscode.workspace.fs = { readFile: () => new Promise(r => { resolve = r; }) };
  const retry = h.retryAttachmentRead('perm-id');
  enabled = false; posted = [];
  resolve(new Uint8Array([137,80,78,71])); await retry;
  eq(posted.find(m => m.type === 'attachmentFailure').failure.reason, '권한이 바뀌었어요. 파일을 빼거나 권한을 확인해 주세요.', 'permission-change copy (changed during the read)');
  posted = [];
  await h.retryAttachmentRead('perm-id');
  eq(posted.find(m => m.type === 'attachmentFailure').failure.reason, '지금은 이 파일을 붙일 수 없어요. 파일을 빼거나 활동 권한을 확인해 주세요.', 'permission copy (already off)');
});
await t("native retry completing in another task never rebinds its source", async () => {
  h.failedAttachmentReads = new Map();
  let scope = 'old'; h.turnRequestScope = () => scope;
  h.isImagePasteEnabled = () => true;
  h.failAttachmentRead('/tmp/old-private.png', 'image', 'failed', 'old-id');
  let resolve; vscode.workspace.fs = { readFile: () => new Promise(r => { resolve = r; }) };
  const retry = h.retryAttachmentRead('old-id');
  scope = 'new'; posted = [];
  resolve(new Uint8Array([137,80,78,71])); await retry;
  eq(posted, [], 'no content or failure from old task');
  eq(h.failedAttachmentReads.has('old-id'), false, 'old source not rebound');
});
await t("reload repick Cancel retains the named failure and successful replacement resolves only it", async () => {
  h.turnRequestScope=()=> 'same';
  await h.repickAttachment('reloaded','lost.png');
  eq(posted.at(-1).failure.id,'reloaded','Cancel keeps failed identity');
  ok(posted.at(-1).failure.reason.includes('선택하지'),'Cancel is not successful retry');
  posted=[];pickNext=put('replacement.txt','read this');
  await h.repickAttachment('reloaded','lost.txt');
  ok(posted.some(m=>m.type==='attachmentFailureResolved'&&m.id==='reloaded'),'replacement resolves exact old row');
  ok(h.pendingFileAttachment.preview.text==='read this','replacement goes through guarded file path');
});
await t("send preparation retains failures and reuses cached siblings without sending a model request", async () => {
  h.imageStaging=null; h.imageStagingScope=undefined;
  h.isImagePasteEnabled=()=>true;h.isImageFilesEnabled=()=>true;
  h.folderWriteRefusalFor=()=>null;h.connectionChanging=false;h.taskChanging=false;
  const one={id:'one',dataUrl:'data:image/png;base64,aGVsbG8='};
  const result=h.prepareAttachments([one]);eq(result.failures,[],'preparation succeeds');
  ok(result.pastedPaths[0].startsWith('assets/'),'pasted image path contract preserved');
  const again=h.prepareAttachments([one]);eq(again.pastedPaths,result.pastedPaths,'no duplicate write');
  const before=fs.readFileSync(path.join(root,result.pastedPaths[0]));
  h.folderWriteRefusalFor=()=> '권한을 확인해 주세요.';
  const denied=h.prepareAttachments([one]);eq(denied.failures[0].id,'one','exact denied item');
  eq(fs.readFileSync(path.join(root,result.pastedPaths[0])),before,'refusal keeps successful bytes');
  h.imageStaging.dispose();h.imageStaging=null;
});
await t("each preparation failure cause reaches the learner with its own exact copy; the limit failure is final", async () => {
  h.imageStaging=null; h.imageStagingScope=undefined;
  h.isImagePasteEnabled=()=>true;h.isImageFilesEnabled=()=>true;
  h.folderWriteRefusalFor=()=>null;h.connectionChanging=false;h.taskChanging=false;
  const reason=(file)=>h.prepareAttachments([file]).failures[0].reason;
  eq(reason({id:'big',dataUrl:'data:image/png;base64,'+'A'.repeat(12*1024*1024)}),'붙여 넣은 이미지가 너무 커요. 12MB 이하로 줄이거나 파일로 골라 다시 붙여 주세요.','too large');
  eq(reason({id:'bad',dataUrl:'data:text/plain;base64,aGk='}),'붙여 넣은 이미지를 읽을 수 없는 형식이에요. png·jpg 이미지로 다시 붙여 주세요.','bad format');
  eq(reason({id:'nostage',stageId:'nope'}),'사진 준비 기록이 없어요. 이 사진을 다시 골라 주세요.','missing stage record');
  h.connectionChanging=true;
  eq(reason({id:'busy',dataUrl:'data:image/png;base64,aGVsbG8='}),'지금은 이미지를 붙일 수 없어요. 연결이나 작업 전환이 끝난 뒤 이 파일만 다시 시도해 주세요.','unavailable');
  h.connectionChanging=false;
  const limit=h.prepareAttachments(Array.from({length:15},(_,i)=>({id:'f'+i,stageId:'f'+i}))).failures;
  eq(limit.length,1,'one limit row');eq(limit[0].id,'limit','limit id');eq(limit[0].reason,'파일이 너무 많아요. 수를 줄여 주세요.','limit copy');
  eq(limit[0].final,true,'limit failure is final (no retry)');
  h.imageStaging?.dispose();h.imageStaging=null;
});
fs.rmSync(tmp, {recursive:true, force:true});
if (fail) process.exit(1);
console.log('attachment failure host PASS');
