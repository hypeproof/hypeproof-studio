// CGP-KNOW-R-015 (REQ-STUDIO-ASK-ABOUT-FILE) — "이 파일에 대해 묻기" on the real ChatPanelProvider.
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

console.log("ask about this file — host");
ok(typeof h.askAboutFile === "function", "ChatPanelProvider.askAboutFile exists");

const plan = "# 내 계획\n1. 표지를 만든다\n";
put("notes/plan.md", plan);

await t("a work-folder file (relative path from 작업 자료) attaches through fileAttachment, then the composer is focused", async () => {
  await h.askAboutFile("notes/plan.md");
  const want = fa.readWorkspaceTextFile(root, path.join(root, "notes/plan.md"));
  eq(lastAttach()?.attachment, want.preview, "chip is the fileAttachment preview");
  eq(h.pendingFileAttachment?.modelText, want.modelText, "queued model text is fileAttachment's");
  eq(h.pendingFileAttachment?.root, root, "queued for this work folder");
  eq(types(), ["fileAttachment", "focusInput"], "attach, then focus; nothing else (no send, no draft write)");
  eq(dialogs, 0, "no picker");
});

await t("an absolute path from the explorer attaches the same way", async () => {
  await h.askAboutFile(path.join(root, "notes/plan.md"));
  eq(lastAttach()?.attachment?.path, "notes/plan.md", "chip path");
  eq(types(), ["fileAttachment", "focusInput"], "messages");
});

// Every CGP-CHAT-R-011 refusal still refuses, with its unchanged copy.
fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
fs.symlinkSync(outside, path.join(root, "linked-dir"));
put(".env", "TOKEN=x");
put(".git/config", "[core]");
put("pic.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]));
put("big.txt", "a".repeat(fa.FILE_ATTACH_MAX_BYTES + 1));
put("many.txt", "가".repeat(fa.FILE_ATTACH_MAX_CHARS + 1));
put("empty.txt", "");
const REFUSALS = [
  ["outside (explorer path in another folder)", path.join(outside, "secret.txt"), "outside"],
  ["../ escape from a relative path", "../outside/secret.txt", "outside"],
  ["file link", "link.txt", "link"],
  ["folder link", "linked-dir/secret.txt", "link"],
  ["hidden file", ".env", "hidden"],
  ["file in a hidden folder", ".git/config", "hidden"],
  ["binary", "pic.png", "binary"],
  ["over the byte cap", "big.txt", "too-large"],
  ["over the character cap", "many.txt", "too-many-chars"],
  ["empty", "empty.txt", "empty"],
  ["a folder", "notes", "not-file"],
  ["missing", "nope.txt", "missing"],
];
for (const [what, target, cause] of REFUSALS) {
  await t(`refused: ${what} → ${cause}`, async () => {
    eq(fa.readWorkspaceTextFile(root, path.resolve(root, target)).cause, cause, "fileAttachment's own verdict (control)");
    await h.askAboutFile(target);
    refusedWith(fa.FILE_REFUSAL_COPY[cause], what);
  });
}

await t("refused: no work folder", async () => {
  const cwd = h.resolveCoachCwd;
  h.resolveCoachCwd = () => undefined;
  try { await h.askAboutFile("notes/plan.md"); } finally { h.resolveCoachCwd = cwd; }
  refusedWith(fa.FILE_REFUSAL_COPY["no-workspace"], "no folder");
});

const gateCopy = denialCopy({ source: "lesson", feature: "작업 폴더 파일 붙이기" }, "neutral");
await t("instructor seat: refused with the file-attach gate copy, nothing read", async () => {
  h._instructorMode = { isInstructor: true };
  await h.askAboutFile("notes/plan.md");
  refusedWith(gateCopy, "instructor");
});
await t("no sdk_tools.read: refused (photo grants do not count)", async () => {
  h.cachedProfile = { ...PERSONAL, sdk_tools: { read: false, write: true }, input: { image_paste: true, image_files: true } };
  await h.askAboutFile("notes/plan.md");
  refusedWith(gateCopy, "no read");
});
await t("no profile: fail closed", async () => {
  h.cachedProfile = null;
  await h.askAboutFile("notes/plan.md");
  refusedWith(gateCopy, "no profile");
});
await t("REQ-M32 kids track (minor cohort with sdk_tools.read) gets the action", async () => {
  h.cachedProfile = { activity_kind: "classroom", minor_cohort: true, coach_runtime: "agent-sdk", sdk_tools: { read: true, write: true } };
  await h.askAboutFile("notes/plan.md");
  eq(lastAttach()?.attachment?.path, "notes/plan.md", "attached");
  eq(types(), ["fileAttachment", "focusInput"], "messages");
});

const consent = (level) => store.set(FOLDER_CONSENT_KEY, { "act-1": { [root]: { level, at: 1 } } });
await t("folder consent \"AI 안 씀\": refused with its existing copy, nothing queued", async () => {
  consent("none");
  await h.askAboutFile("notes/plan.md");
  refusedWith(folderNoAiCopy(), "AI 안 씀");
  eq(modals, 0, "no question asked");
});
await t("folder consent: the same refusal through the composer picker (one path)", async () => {
  consent("none");
  pickNext = path.join(root, "notes/plan.md");
  await h.attachWorkspaceFile();
  refusedWith(folderNoAiCopy(), "AI 안 씀, picker");
  eq(dialogs, 0, "refused before the picker opens");
});
await t("control: \"읽기만\" and \"읽고 고치기\" still attach; an undecided folder attaches without asking", async () => {
  for (const level of ["read", "full"]) {
    store.clear(); posted = []; h.pendingFileAttachment = null;
    consent(level);
    await h.askAboutFile("notes/plan.md");
    eq(lastAttach()?.attachment?.path, "notes/plan.md", `${level}: attached`);
  }
  store.clear(); posted = []; h.pendingFileAttachment = null;
  await h.askAboutFile("notes/plan.md");
  eq(lastAttach()?.attachment?.path, "notes/plan.md", "undecided: attached");
  eq(modals, 0, "attaching never asks; the send does");
});

await t("the composer picker path is unchanged: dialog, then the same checks", async () => {
  pickNext = path.join(root, "notes/plan.md");
  await h.attachWorkspaceFile();
  eq(dialogs, 1, "picker opened");
  eq(lastAttach()?.attachment?.path, "notes/plan.md", "attached");
  ok(!types().includes("focusInput"), "the picker path does not post a focus request");
  posted = []; h.pendingFileAttachment = null;
  pickNext = path.join(outside, "secret.txt");
  await h.attachWorkspaceFile();
  refusedWith(fa.FILE_REFUSAL_COPY.outside, "picker outside");
});

await t("a second ask replaces the queued file (one file at a time, like the picker)", async () => {
  put("notes/other.md", "다른 메모\n");
  await h.askAboutFile("notes/plan.md");
  await h.askAboutFile("notes/other.md");
  eq(h.pendingFileAttachment?.preview.path, "notes/other.md", "latest file queued");
});

await t("a refusal after a good attach keeps the earlier chip visible", async () => {
  await h.askAboutFile("notes/plan.md");
  posted = [];
  await h.askAboutFile(".env");
  eq(lastAttach()?.attachment?.path, "notes/plan.md", "earlier chip re-sent with the error");
  eq(lastAttach()?.error, fa.FILE_REFUSAL_COPY.hidden, "error");
});

// ─── Wiring locks: the webview message, the explorer command and its menu ─────────────────────
const src = (p) => fs.readFileSync(path.join(here, p), "utf8");
await t("webview message askAboutFile goes to askAboutFile (no second attach path)", async () => {
  const provider = src("src/chatPanelProvider.ts");
  ok(/case "askAboutFile":\s*\n?\s*(if \(typeof msg\.path === "string"\) )?await this\.askAboutFile\(msg\.path\)/.test(provider), "message case");
  const body = /async askAboutFile\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(provider)?.[1] ?? "";
  ok(/this\.attachWorkspaceFile\(/.test(body), "askAboutFile calls attachWorkspaceFile");
  ok(!/readWorkspaceTextFile|pendingFileAttachment\s*=/.test(body), "askAboutFile does not read or queue on its own");
  eq((provider.match(/readWorkspaceTextFile\(/g) ?? []).length, 1, "one call site of readWorkspaceTextFile in the provider");
});
await t("explorer context menu: files only, one work folder, behind the gate context key", async () => {
  const pkg = JSON.parse(src("package.json"));
  const cmd = pkg.contributes.commands.find((c) => c.command === "hypeproof-chat.askAboutFile");
  ok(cmd, "command contributed");
  eq(cmd.title, "이 파일에 대해 묻기", "title");
  const item = pkg.contributes.menus["explorer/context"].find((m) => m.command === "hypeproof-chat.askAboutFile");
  ok(item, "explorer/context item");
  for (const clause of ["hypeproof-chat.askAboutFileEnabled", "!explorerResourceIsFolder", "resourceScheme == file", "workspaceFolderCount == 1"]) ok(item.when.includes(clause), `when has ${clause}`);
  const palette = pkg.contributes.menus.commandPalette.find((m) => m.command === "hypeproof-chat.askAboutFile");
  eq(palette?.when, "false", "hidden from the command palette (it needs a file)");
  const ext = src("src/extension.ts");
  eq(fa.ASK_ABOUT_FILE_COMMAND, "hypeproof-chat.askAboutFile", "command id constant");
  eq(fa.ASK_ABOUT_FILE_CONTEXT_KEY, "hypeproof-chat.askAboutFileEnabled", "context key constant");
  ok(/registerCommand\(ASK_ABOUT_FILE_COMMAND, async \(uri\?: vscode\.Uri\)[\s\S]{0,400}provider\.askAboutFile\(target\.fsPath\)/.test(ext), "command calls provider.askAboutFile with the explorer file");
  const provider = src("src/chatPanelProvider.ts");
  ok(/setContext", ASK_ABOUT_FILE_CONTEXT_KEY, fileAttachAllowed\(toolProfile, isInstructor\)\)/.test(provider), "context key follows the file-attach gate");
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.error(`ask-about-file host: ${fail} failed`); process.exit(1); }
console.log("ask-about-file host smoke OK");
