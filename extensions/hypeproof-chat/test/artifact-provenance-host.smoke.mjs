// REQ-STUDIO-ARTIFACT-PROVENANCE — the real ChatPanelProvider write paths call the host-write hook
// with the right writer. Bundled with esbuild and run with only VS Code I/O substituted, so removing
// any one hook line (agent.md, index.html, engine.js, learner uploads) or the revealBuilt writer
// choice fails a case here. The GitHub pull/clone paths of publishHost are locked textually.
// Run: node --experimental-strip-types test/artifact-provenance-host.smoke.mjs

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
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export { setHostWriteSink } from './src/artifactProvenance';", resolveDir: here, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-provenance-host-")));
const vscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: root } }],
    getConfiguration: () => ({ get: (_k, fallback) => fallback }),
    fs: { writeFile: async (uri, bytes) => { fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true }); fs.writeFileSync(uri.fsPath, bytes); }, readFile: async (uri) => fs.readFileSync(uri.fsPath) },
  },
  Uri: { joinPath: (uri, ...names) => ({ fsPath: path.join(uri.fsPath, ...names) }), file: (p) => ({ fsPath: p }) },
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
  ProgressLocation: { Window: 10 },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
const { ChatPanelProvider, setHostWriteSink } = module.exports;

let writes = [];
setHostWriteSink({ wrote: (w, actor) => { for (const x of w) writes.push({ rel: path.relative(root, x.absPath).split(path.sep).join("/"), actor, data: x.data === undefined ? undefined : String(x.data) }); }, replaced: () => {} });

const h = Object.create(ChatPanelProvider.prototype);
Object.assign(h, {
  revealWriter: "studio",
  resolveCoachCwd: () => root,
  emitArtifactChanged: () => {},
  isLiveServerPreview: () => false,
  surfaceStructureIssues: () => {},
  archiveAdultPage: () => {},
  postToolLog: () => {},
  preview: { show: async () => {} },
});

let fail = 0;
const t = async (label, fn) => {
  writes = [];
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const page = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

console.log("artifact provenance — provider write paths call the hook");

await t("agent.md from the coach's fence is recorded as the AI's (chatPanelProvider saveAgentMdIfPresent)", async () => {
  await h.saveAgentMdIfPresent("답이에요\n```agent-md\n# 역할\n```\n");
  eq(writes.map((w) => [w.rel, w.actor]), [["agent.md", "ai"]], "writes");
  eq(writes[0].data, fs.readFileSync(path.join(root, "agent.md"), "utf8"), "hashed bytes are the written bytes");
});

await t("a page revealed from this turn's answer: index.html recorded as the AI's (saveGameToWorkspace + writer choice)", async () => {
  await h.revealBuilt(page("coach"), { artifactSource: "assistant_response" });
  eq(writes.map((w) => [w.rel, w.actor]), [["index.html", "ai"]], "writes");
  eq(writes[0].data, fs.readFileSync(path.join(root, "index.html"), "utf8"), "bytes");
});

await t("a tool-written reveal is also the AI's", async () => {
  await h.revealBuilt(page("tool"), { artifactSource: "assistant_tool" });
  eq(writes.map((w) => [w.rel, w.actor]), [["index.html", "ai"]], "writes");
});

await t("a prebuilt world: engine.js and index.html recorded as Studio's (saveEngineToWorkspace + saveGameToWorkspace)", async () => {
  await h.revealBuilt(page("world"), { artifactSource: "prebuilt", engineJs: "window.S_ENGINE = 1;" });
  eq(writes.map((w) => [w.rel, w.actor]), [["engine.js", "studio"], ["index.html", "studio"]], "writes");
  eq(writes[0].data, "window.S_ENGINE = 1;", "engine bytes");
});

await t("▶ Run and a re-shown page are Studio's writes (their author is not recorded)", async () => {
  await h.revealBuilt(page("run"), { artifactSource: "manual_preview" });
  await h.revealBuilt(page("again"), { artifactSource: "existing" });
  eq(writes.map((w) => w.actor), ["studio", "studio"], "actors");
});

await t("negative controls: no folder, or a failed write, records nothing", async () => {
  const folders = vscode.workspace.workspaceFolders;
  vscode.workspace.workspaceFolders = [];
  await h.saveGameToWorkspace(page("nowhere"));
  vscode.workspace.workspaceFolders = folders;
  const write = vscode.workspace.fs.writeFile;
  vscode.workspace.fs.writeFile = async () => { throw new Error("disk full"); };
  await h.saveGameToWorkspace(page("failed"));
  await h.saveEngineToWorkspace("x");
  await h.saveAgentMdIfPresent("```agent-md\n# x\n```\n");
  vscode.workspace.fs.writeFile = write;
  eq(writes, [], "no record without a write");
});

await t("negative control: a folder-consent refusal (읽기만) writes nothing and records nothing", async () => {
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  h.folderWriteRefusalFor = () => "이 폴더는 읽기만 해요.";
  try {
    await h.revealBuilt(page("refused"), { artifactSource: "assistant_response", engineJs: "x" });
    await h.saveAgentMdIfPresent("```agent-md\n# refused\n```\n");
  } finally { delete h.folderWriteRefusalFor; }
  eq(writes, [], "no record");
  eq(fs.readFileSync(path.join(root, "index.html"), "utf8"), before, "file untouched");
});

await t("learner uploads of a send: pasted and attached photos recorded as 내가 올림 (recordLearnerUploads)", async () => {
  h.recordLearnerUploads(["assets/pasted-1.png"], "[첨부한 사진]\n- images/외관.jpg");
  eq(writes.map((w) => [w.rel, w.actor]), [["assets/pasted-1.png", "learner_upload"], ["images/외관.jpg", "learner_upload"]], "writes");
  writes = [];
  h.recordLearnerUploads([], "");
  eq(writes, [], "nothing attached, nothing recorded");
});

await t("wiring lock: the send path calls recordLearnerUploads after both commits", () => {
  const src = fs.readFileSync(path.join(here, "src/chatPanelProvider.ts"), "utf8");
  const commit = src.indexOf("const attachedNote = this.commitAttachedImages(attachments, streamId);");
  const record = src.indexOf("this.recordLearnerUploads(savedImages.relPaths ?? [], attachedNote);");
  const restore = src.indexOf("const turnRestorePoint = await this.beginTurnRestore(streamId);");
  if (commit < 0 || record < commit || restore < record) throw new Error("uploads are not recorded between the commit and the restore point");
});

await t("wiring lock: every GitHub clone, download, pull and sync into a folder is followed by noteFolderReplaced", () => {
  const src = fs.readFileSync(path.join(here, "src/publish/publishHost.ts"), "utf8");
  for (const op of ["await downloadRepo(", "await cloneRepo(", "await pullInto(", "await syncClone("]) {
    const at = src.indexOf(op);
    if (at < 0) throw new Error(`${op} not found`);
    const end = op === "await syncClone(" ? src.indexOf("});", at) + 3 : src.indexOf(";", at) + 1;
    const next = src.slice(end, src.indexOf("\n", src.indexOf("\n", end) + 1)).trim();
    if (!next.startsWith("noteFolderReplaced(folder);")) throw new Error(`${op} is not followed by noteFolderReplaced: ${next}`);
  }
});

setHostWriteSink(null);
fs.rmSync(root, { recursive: true, force: true });
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
