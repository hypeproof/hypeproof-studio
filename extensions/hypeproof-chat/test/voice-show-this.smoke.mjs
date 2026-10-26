// CGP-VOICE-R-009 (REQ-CGPV-14 / DES-CGPV-14) — "보여주기" in voice attaches one explicitly chosen
// Studio artifact per click, never the OS screen.
//   1. The menu is exactly two targets (열린 파일, 미리보기 화면) with Studio's labels; a disabled
//      item always carries its reason; no payload can add, rename or enable a third target.
//   2. editor_file attaches the saved file the editor shows, at its revision (version + sha256),
//      through the work-folder file checks; unsaved, changed-while-reading and out-of-folder files
//      attach nothing.
//   3. preview_tab goes through the page-context primitive; REQ-N3 page_context gates it, and the
//      screenshot rides only with image_paste (minors: only while REQ-N3 is on).
//   4. One click = one attach: a replayed request id and a second click while one runs attach
//      nothing; any other target string ("screen", "desktop", ...) is refused before any capture.
//   5. The real ChatPanelProvider wires both webview messages to this logic (bundled, VS Code I/O
//      substituted).
//   6. Grep: no desktopCapturer / display-media / OS screen-capture code path exists in product
//      source (with a planted positive control proving the scanner finds one).
// Run: node --experimental-strip-types test/voice-show-this.smoke.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";
import { readWorkspaceTextFile } from "../src/fileAttachment.ts";
import { SHOW_THIS_LABEL, SHOW_THIS_TARGETS, SHOW_THIS_UNKNOWN_REASON, showThisMenuView } from "../src/voicePopupHelpers.ts";
import { SHOW_THIS_COPY, ShowThisLedger, editorRevision, isOwnPreviewTab, previewImageAllowed, runShowThis, showThisMenu, withRevision } from "../src/voiceShowThis.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(here, "../..");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-show-this-")));
const root = path.join(tmp, "work");
fs.mkdirSync(path.join(root, "site"), { recursive: true });
fs.mkdirSync(path.join(tmp, "outside"));
const put = (rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
const INDEX = put("site/index.html", "<h1>내 페이지</h1>\n");

const editorOf = (fsPath, text, extra = {}) => ({ scheme: "file", fsPath, isUntitled: false, isDirty: false, version: 3, text, ...extra });
const baseEnv = (over = {}) => ({
  instructor: false, fileAllowed: true, folderRefusal: null, root, editor: editorOf(INDEX, "<h1>내 페이지</h1>\n"),
  pageContext: true, imagePaste: true, previewTab: "own", scope: "task-1", ...over,
});

// ── 1. menu ────────────────────────────────────────────────────────────────
{
  const all = showThisMenu(baseEnv());
  assert.deepEqual(all.map((i) => i.target), ["editor_file", "preview_tab"]);
  assert.deepEqual(all.map((i) => i.label), ["열린 파일", "미리보기 화면"]);
  assert.ok(all.every((i) => i.enabled && i.reason === null), "positive control: both usable");
  assert.deepEqual([...SHOW_THIS_TARGETS], ["editor_file", "preview_tab"]);
  assert.ok(!Object.values(SHOW_THIS_LABEL).some((l) => /전체|화면 전체|데스크톱|창/.test(l)), "a whole-screen item exists");
  const cases = [
    [{ instructor: true }, SHOW_THIS_COPY.instructor, SHOW_THIS_COPY.instructor],
    [{ fileAllowed: false }, SHOW_THIS_COPY.fileOff, null],
    [{ folderRefusal: "이 폴더는 AI 안 씀" }, "이 폴더는 AI 안 씀", null],
    [{ root: undefined }, null, null],
    [{ editor: null }, SHOW_THIS_COPY.noEditor, null],
    [{ editor: editorOf(INDEX, "x", { isUntitled: true, scheme: "untitled" }) }, SHOW_THIS_COPY.untitled, null],
    [{ editor: editorOf(INDEX, "x", { scheme: "git" }) }, SHOW_THIS_COPY.noEditor, null],
    [{ editor: editorOf(INDEX, "x", { isDirty: true }) }, SHOW_THIS_COPY.dirty, null],
    [{ pageContext: false }, null, SHOW_THIS_COPY.previewOff],
    [{ previewTab: "none" }, null, SHOW_THIS_COPY.noPreview],
    [{ previewTab: "other" }, null, SHOW_THIS_COPY.notOwn],
  ];
  for (const [over, fileReason, pageReason] of cases) {
    const [f, p] = showThisMenu(baseEnv(over));
    const label = JSON.stringify(over);
    if (fileReason !== null) { assert.equal(f.enabled, false, label); assert.equal(f.reason, fileReason, label); }
    else if ("root" in over) { assert.equal(f.enabled, false, label); assert.ok(f.reason, label); }
    else assert.equal(f.enabled, true, `${label}: file item must stay usable`);
    if (pageReason !== null) { assert.equal(p.enabled, false, label); assert.equal(p.reason, pageReason, label); }
    else assert.equal(p.enabled, true, `${label}: preview item must stay usable`);
  }
  // Minors: the preview is usable only while REQ-N3 is on (it gates every seat); the screenshot also needs image_paste.
  assert.equal(previewImageAllowed({ imagePaste: true, pageContext: true }), true);
  assert.equal(previewImageAllowed({ imagePaste: true, pageContext: false }), false);
  assert.equal(previewImageAllowed({ imagePaste: false, pageContext: true }), false);
  console.log("PASS menu: two Studio targets, reasons for every disabled case, REQ-N3 gate");

  // The panel's view of a host payload: never more than the two, labels fixed, hostile text cleaned.
  const hostile = showThisMenuView([
    { target: "screen", label: "전체 화면", enabled: true },
    { target: "preview_tab", label: "전체 화면", enabled: true, reason: "x" },
    { target: "editor_file", enabled: false, reason: "저장‮해  주세요\u0007" },
    "junk", null,
  ]);
  assert.deepEqual(hostile.map((i) => [i.target, i.label, i.enabled]), [["editor_file", "열린 파일", false], ["preview_tab", "미리보기 화면", true]]);
  assert.equal(hostile[0].reason, "저장 해 주세요");
  assert.equal(hostile[1].reason, null, "an enabled item shows a reason");
  for (const raw of [null, undefined, {}, "x", [{ target: "editor_file" }]]) {
    const v = showThisMenuView(raw);
    assert.equal(v.length, 2);
    assert.ok(v.every((i) => !i.enabled && i.reason === SHOW_THIS_UNKNOWN_REASON), `unknown payload ${JSON.stringify(raw)} enabled an item`);
  }
  assert.equal(showThisMenuView([{ target: "editor_file", enabled: false, reason: "가".repeat(500) }])[0].reason.length, 200);
  console.log("PASS panel view: no third item, fixed labels, hostile/unknown payloads fail closed");
}

// ── 2–4. runShowThis ───────────────────────────────────────────────────────
const harness = (envs, capture) => {
  const queued = { file: [], page: [] };
  let n = 0, captures = 0;
  const seq = Array.isArray(envs) ? envs : [envs];
  const deps = {
    env: () => seq[Math.min(n++, seq.length - 1)],
    // The provider's contract (attachWorkspaceFile with `voice`): read with the folder checks, verify, then queue.
    attachFile: async (f, revision, verify) => {
      const read = readWorkspaceTextFile(root, f);
      if (!read.ok) return { ok: false, error: read.reason };
      const bad = verify(read.preview);
      if (bad) return { ok: false, error: bad };
      const modelText = withRevision(read.modelText, revision);
      if (modelText === null) return { ok: false, error: "revision" };
      queued.file.push({ preview: read.preview, modelText, root });
      return { ok: true, preview: read.preview };
    },
    capturePreview: async () => { captures++; return capture ? capture() : { url: "http://127.0.0.1:4000/", title: "내 페이지", imageBase64: "IMG", text: "본문", textSource: "own" }; },
    queuePage: (c) => queued.page.push(c),
  };
  return { deps, queued, get captures() { return captures; } };
};
{
  const text = "<h1>내 페이지</h1>\n";
  let h = harness(baseEnv());
  const ledger = new ShowThisLedger();
  let r = await runShowThis({ requestId: "r1", target: "editor_file" }, h.deps, ledger);
  const rev = editorRevision(3, text);
  assert.match(rev, /^v3-[0-9a-f]{12}$/);
  assert.equal(r.ok, true);
  assert.deepEqual(r.reference, { artifactId: "site/index.html", title: "site/index.html", revision: rev });
  assert.equal(h.queued.file.length, 1);
  assert.equal(h.queued.file[0].preview.text, text, "the chip shows exactly what is sent");
  assert.ok(h.queued.file[0].modelText.startsWith(`<file_content path="site/index.html" revision="${rev}">`), h.queued.file[0].modelText.slice(0, 80));
  assert.equal(h.captures, 0, "a file attach captured the preview");
  assert.notEqual(editorRevision(4, text), rev); assert.notEqual(editorRevision(3, text + " "), rev);

  // Replay of the same id attaches nothing more.
  r = await runShowThis({ requestId: "r1", target: "editor_file" }, h.deps, ledger);
  assert.deepEqual([r.ok, r.error], [false, SHOW_THIS_COPY.replay]);
  assert.equal(h.queued.file.length, 1, "a replayed click attached again");

  const refused = async (env, error, label, target = "editor_file") => {
    const hh = harness(env);
    const res = await runShowThis({ requestId: `id-${Math.random().toString(36).slice(2)}`, target }, hh.deps, new ShowThisLedger());
    assert.equal(res.ok, false, `${label}: attached`);
    if (error) assert.equal(res.error, error, label);
    assert.equal(hh.queued.file.length + hh.queued.page.length, 0, `${label}: something was queued`);
    return hh;
  };
  await refused(baseEnv({ editor: editorOf(INDEX, text, { isDirty: true }) }), SHOW_THIS_COPY.dirty, "unsaved");
  await refused(baseEnv({ editor: editorOf(INDEX, "다른 글\n") }), SHOW_THIS_COPY.changed, "buffer differs from disk");
  await refused([baseEnv(), baseEnv({ editor: editorOf(INDEX, text, { version: 4 }) })], SHOW_THIS_COPY.changed, "version moved while reading");
  await refused([baseEnv(), baseEnv({ editor: editorOf(INDEX, text, { isDirty: true }) })], SHOW_THIS_COPY.changed, "edited while reading");
  await refused([baseEnv(), baseEnv({ scope: "task-2" })], SHOW_THIS_COPY.scopeChanged, "task switched while reading");
  await refused([baseEnv(), baseEnv({ fileAllowed: false })], SHOW_THIS_COPY.fileOff, "gate closed while reading");
  const out = path.join(tmp, "outside", "secret.txt"); fs.writeFileSync(out, "secret");
  await refused(baseEnv({ editor: editorOf(out, "secret") }), null, "outside the work folder");
  fs.symlinkSync(out, path.join(root, "link.txt"));
  await refused(baseEnv({ editor: editorOf(path.join(root, "link.txt"), "secret") }), null, "link inside the folder");
  await refused(baseEnv({ instructor: true }), SHOW_THIS_COPY.instructor, "instructor");
  await refused(baseEnv({ fileAllowed: false }), SHOW_THIS_COPY.fileOff, "seat without read");
  // withRevision fails closed: no data tag where it must be, or a revision outside [a-z0-9-], gives null.
  assert.equal(withRevision("no tag", rev), null);
  assert.equal(withRevision('<file_content path="a">x', 'v1" evil="1'), null);
  assert.equal(withRevision(' <file_content path="a">x', rev), null);
  assert.equal(isOwnPreviewTab("http://127.0.0.1:4000/a.html", "http://127.0.0.1:4000/"), true);
  for (const [t, o] of [["https://mail.example/", "http://127.0.0.1:4000/"], ["http://127.0.0.1:4001/", "http://127.0.0.1:4000/"], ["http://127.0.0.1:4000/", undefined], ["file:///tmp/a.html", "file:///tmp/"], [undefined, "http://127.0.0.1:4000/"], ["blob:http://127.0.0.1:4000/x", "http://127.0.0.1:4000/"]]) assert.equal(isOwnPreviewTab(t, o), false, `${t} vs ${o}`);
  console.log("PASS editor_file: exact saved revision only; unsaved/changed/switched/outside/link/instructor attach nothing; replay refused");

  // Preview.
  h = harness(baseEnv());
  r = await runShowThis({ requestId: "p1", target: "preview_tab" }, h.deps, new ShowThisLedger());
  assert.equal(r.ok, true);
  assert.deepEqual(r.reference, { artifactId: "http://127.0.0.1:4000/", title: "내 페이지", revision: null });
  assert.equal(h.queued.page.length, 1); assert.equal(h.queued.page[0].imageBase64, "IMG"); assert.equal(h.queued.page[0].text, "본문");
  h = harness(baseEnv({ imagePaste: false }));
  await runShowThis({ requestId: "p2", target: "preview_tab" }, h.deps, new ShowThisLedger());
  assert.equal(h.queued.page[0].imageBase64, "", "screenshot sent without image_paste");
  let hh = await refused(baseEnv({ pageContext: false }), SHOW_THIS_COPY.previewOff, "REQ-N3 off", "preview_tab");
  assert.equal(hh.captures, 0, "captured with REQ-N3 off");
  hh = await refused(baseEnv({ previewTab: "none" }), SHOW_THIS_COPY.noPreview, "no preview tab", "preview_tab");
  assert.equal(hh.captures, 0);
  hh = await refused(baseEnv({ previewTab: "other" }), SHOW_THIS_COPY.notOwn, "an external page is not the preview", "preview_tab");
  assert.equal(hh.captures, 0);
  // The capture decides ownership: a page that navigated away between menu and capture is refused.
  for (const textSource of ["not-own", "owner-unknown"]) {
    h = harness(baseEnv(), () => ({ url: "https://mail.example/", title: "메일", imageBase64: "IMG", text: "", textSource }));
    r = await runShowThis({ requestId: `own-${textSource}`, target: "preview_tab" }, h.deps, new ShowThisLedger());
    assert.deepEqual([r.ok, r.error, h.queued.page.length], [false, SHOW_THIS_COPY.notOwn, 0], textSource);
  }
  await refused([baseEnv(), baseEnv({ scope: "task-2" })], SHOW_THIS_COPY.scopeChanged, "task switched during capture", "preview_tab");
  await refused([baseEnv(), baseEnv({ pageContext: false })], SHOW_THIS_COPY.previewOff, "REQ-N3 turned off during capture", "preview_tab");
  h = harness(baseEnv(), () => { throw new Error("페이지가 바뀌었어요. 다시 첨부해 주세요."); });
  r = await runShowThis({ requestId: "p4", target: "preview_tab" }, h.deps, new ShowThisLedger());
  assert.deepEqual([r.ok, r.error, h.queued.page.length], [false, "페이지가 바뀌었어요. 다시 첨부해 주세요.", 0]);
  console.log("PASS preview_tab: page-context primitive, REQ-N3 gate, image only with image_paste, races refused");

  // Second click while one runs: refused, not queued.
  let release;
  h = harness(baseEnv(), () => new Promise((res) => { release = () => res({ url: "http://127.0.0.1:4000/", title: "t", imageBase64: "", text: "", textSource: "own" }); }));
  const shared = new ShowThisLedger();
  const first = runShowThis({ requestId: "c1", target: "preview_tab" }, h.deps, shared);
  await new Promise((r2) => setTimeout(r2, 5));
  const second = await runShowThis({ requestId: "c2", target: "editor_file" }, h.deps, shared);
  assert.deepEqual([second.ok, second.error], [false, SHOW_THIS_COPY.busy]);
  release();
  assert.equal((await first).ok, true);
  assert.equal(h.queued.page.length + h.queued.file.length, 1, "a busy click queued");
  assert.equal((await runShowThis({ requestId: "c3", target: "editor_file" }, h.deps, shared)).ok, true, "positive control: next click after release works");

  // Anything but the two targets is refused before any capture or read.
  for (const target of ["screen", "desktop", "window", "entire_screen", "EDITOR_FILE", "preview_tab ", null, 1, {}]) {
    h = harness(baseEnv());
    r = await runShowThis({ requestId: "x1", target }, h.deps, new ShowThisLedger());
    assert.deepEqual([r.ok, r.target, r.error], [false, null, SHOW_THIS_COPY.invalid], JSON.stringify(target));
    assert.equal(h.captures + h.queued.file.length + h.queued.page.length, 0);
  }
  for (const requestId of [undefined, "", "a b", "x".repeat(101), "id ", 7]) assert.equal(await runShowThis({ requestId, target: "editor_file" }, harness(baseEnv()).deps, new ShowThisLedger()), null);
  console.log("PASS one click = one attach; other targets and bad request ids refused before capture");
}

// ── 5. the real provider ──────────────────────────────────────────────────
{
  const require = createRequire(import.meta.url);
  const bundle = await build({
    stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: here, loader: "ts" },
    bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
  });
  const text = "<h1>내 페이지</h1>\n";
  let cdp = 0;
  const tab = { url: "http://127.0.0.1:4000/", title: "내 페이지", startCDPSession: async () => {
    cdp++;
    const listeners = new Set();
    return { onDidReceiveMessage(fn) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; }, onDidClose() { return { dispose() {} }; }, close: async () => {},
      sendMessage: async (m) => {
        let result = {};
        if (m.method === "Target.getTargets") result = { targetInfos: [{ type: "page", targetId: "page" }] };
        else if (m.method === "Target.attachToTarget") result = { sessionId: "s" };
        else if (m.method === "Page.captureScreenshot") result = { data: "SHOT" };
        else if (m.method === "Runtime.evaluate") result = { result: { value: vm.runInNewContext(m.params.expression, { document: { body: { innerText: "본문" } }, location: new URL(tab.url) }) } };
        else if (m.method !== "Target.setDiscoverTargets") throw new Error("unexpected CDP " + m.method);
        for (const fn of [...listeners]) fn({ id: m.id, result });
      } };
  } };
  const doc = { uri: { scheme: "file", fsPath: INDEX }, isUntitled: false, isDirty: false, version: 7, getText: () => text };
  const vscode = {
    workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }) },
    Uri: { joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }), file: (p) => ({ fsPath: p }) },
    window: { createOutputChannel: () => ({ appendLine() {} }), activeTextEditor: { document: doc }, activeBrowserTab: tab, browserTabs: [tab], showWarningMessage: async () => undefined },
    commands: { executeCommand: async () => {} },
    ProgressLocation: { Window: 10 },
  };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
  const { ChatPanelProvider } = mod.exports;
  const store = new Map();
  const context = { globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, subscriptions: [] };
  const posted = [];
  const p = Object.create(ChatPanelProvider.prototype);
  Object.assign(p, {
    context, accessState: null, servedWorkspaceRoot: null, _instructorMode: { isInstructor: false },
    cachedProfile: { activity_kind: "personal", activity_id: "act-1", sdk_tools: { read: true }, input: { page_context: true, image_paste: true }, ux: { coach: {} } },
    resolveCoachCwd: () => root, liveServer: { currentUrl: () => "http://127.0.0.1:4000/" },
    post: async (msg) => { posted.push(msg); return true; },
    handleSend: async () => { throw new Error("show-this sent a message"); },
  });
  // Messages come from the vm realm: compare plain copies.
  const last = (type) => { const m = posted.filter((x) => x.type === type).at(-1); return m === undefined ? m : JSON.parse(JSON.stringify(m)); };
  await p.handleMessage({ type: "voiceShowThisMenu", requestId: "m1" });
  assert.deepEqual(last("voiceShowThisMenu").items.map((i) => [i.target, i.enabled]), [["editor_file", true], ["preview_tab", true]]);
  await p.handleMessage({ type: "voiceShowThis", requestId: "a1", target: "editor_file" });
  const fileRes = last("voiceShowThisResult");
  assert.equal(fileRes.ok, true, JSON.stringify(fileRes));
  assert.equal(fileRes.reference.revision, editorRevision(7, text));
  assert.equal(p.pendingFileAttachment.preview.text, text);
  assert.match(p.pendingFileAttachment.modelText, /revision="v7-[0-9a-f]{12}"/);
  assert.equal(last("fileAttachment").attachment.path, "site/index.html", "the file chip is shown");
  await p.handleMessage({ type: "voiceShowThis", requestId: "a2", target: "preview_tab" });
  assert.equal(last("voiceShowThisResult").ok, true, JSON.stringify(last("voiceShowThisResult")));
  assert.equal(cdp, 1, "preview went through the tab-scoped CDP capture once");
  assert.equal(p.pendingPageImage, "data:image/jpeg;base64,SHOT");
  assert.ok(last("pageAttachment"), "the page chip is shown");
  await p.handleMessage({ type: "voiceShowThis", requestId: "a2", target: "preview_tab" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.replay); assert.equal(cdp, 1);
  await p.handleMessage({ type: "voiceShowThis", requestId: "a3", target: "screen" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.invalid); assert.equal(cdp, 1);
  // A minors cohort with REQ-N3 off: preview disabled with its reason, no capture on click.
  p.cachedProfile = { ...p.cachedProfile, minor_cohort: true, input: { page_context: false, image_paste: true } };
  await p.handleMessage({ type: "voiceShowThisMenu", requestId: "m2" });
  assert.deepEqual(last("voiceShowThisMenu").items[1], { target: "preview_tab", label: "미리보기 화면", enabled: false, reason: SHOW_THIS_COPY.previewOff });
  await p.handleMessage({ type: "voiceShowThis", requestId: "a4", target: "preview_tab" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.previewOff); assert.equal(cdp, 1);
  // Unsaved buffer: refused, nothing replaces the queued file.
  doc.isDirty = true; p.pendingFileAttachment = null;
  await p.handleMessage({ type: "voiceShowThis", requestId: "a5", target: "editor_file" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.dirty); assert.equal(p.pendingFileAttachment, null);
  // Saved buffer whose text is not what is on disk (changed outside the editor): the provider's
  // single file path runs the check after its read and queues nothing.
  doc.isDirty = false; doc.getText = () => "<h1>편집기 글</h1>\n";
  await p.handleMessage({ type: "voiceShowThis", requestId: "a6", target: "editor_file" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.changed); assert.equal(p.pendingFileAttachment, null);
  // A voice refusal never touches the composer's file chip row.
  assert.ok(!posted.some((m) => m.type === "fileAttachment" && m.error), "a voice refusal posted a composer file error");
  // Instructor: neither target.
  doc.getText = () => text;
  p._instructorMode = { isInstructor: true };
  await p.handleMessage({ type: "voiceShowThis", requestId: "a7", target: "editor_file" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.instructor); assert.equal(p.pendingFileAttachment, null);
  p._instructorMode = { isInstructor: false };
  // An external page in the active tab is not "미리보기 화면": disabled with its reason, no capture.
  p.cachedProfile = { ...p.cachedProfile, minor_cohort: false, input: { page_context: true, image_paste: true } };
  tab.url = "https://mail.example/inbox";
  await p.handleMessage({ type: "voiceShowThisMenu", requestId: "m3" });
  assert.deepEqual(last("voiceShowThisMenu").items[1], { target: "preview_tab", label: "미리보기 화면", enabled: false, reason: SHOW_THIS_COPY.notOwn });
  await p.handleMessage({ type: "voiceShowThis", requestId: "a8", target: "preview_tab" });
  assert.equal(last("voiceShowThisResult").error, SHOW_THIS_COPY.notOwn); assert.equal(cdp, 1);
  tab.url = "http://127.0.0.1:4000/";
  // Replies go to the panel that asked; an unknown panel still gets an answer (never left pending).
  const sent = { side: [], editor: [] };
  p.view = { webview: { postMessage: async (m) => { sent.side.push(m.type); return true; } } };
  p.editorChat = { webview: { postMessage: async (m) => { sent.editor.push(m.type); return true; } } };
  const before = posted.length;
  await p.handleMessage({ type: "voiceShowThisMenu", requestId: "m4" }, p.editorChat.webview);
  assert.deepEqual([sent.side, sent.editor], [[], ["voiceShowThisMenu"]], "reply went to the wrong panel");
  await p.handleMessage({ type: "voiceShowThisMenu", requestId: "m5" }, { postMessage: async () => true });
  assert.equal(posted.slice(before).filter((m) => m.type === "voiceShowThisMenu").length, 1, "an unknown panel got no answer");
  console.log("PASS ChatPanelProvider: menu + both targets wired; replay, other target, minors REQ-N3 off, unsaved, disk-differs, instructor and external tab refused; replies routed");
}

// ── 6. no OS screen capture path ───────────────────────────────────────────
{
  const FORBIDDEN = /desktopCapturer|getDisplayMedia|setDisplayMediaRequestHandler|CGWindowListCreateImage|CGDisplayStream|SCShareableContent|ScreenCaptureKit|chromeMediaSource|\bscreencapture\b|(?:askForMediaAccess|getMediaAccessStatus)\(\s*['"]screen/;
  const SKIP = new Set(["node_modules", "dist", "out", ".git", "test", "tests", "__tests__"]);
  const scan = (dir, hits = []) => {
    if (!fs.existsSync(dir)) return hits;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) scan(p, hits); continue; }
      if (!/\.(m?[jt]sx?|cjs|html|patch|sh|json)$/.test(e.name)) continue;
      if (FORBIDDEN.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(repo, p));
    }
    return hits;
  };
  // Positive control: the scanner finds a planted call.
  const plant = path.join(tmp, "plant"); fs.mkdirSync(plant);
  fs.writeFileSync(path.join(plant, "a.ts"), "const s = await navigator.mediaDevices.getDisplayMedia({ video: true });");
  fs.writeFileSync(path.join(plant, "b.ts"), "import { desktopCapturer } from 'electron';");
  fs.writeFileSync(path.join(plant, "c.ts"), "systemPreferences.getMediaAccessStatus('screen')");
  assert.equal(scan(plant).length, 3, "scanner misses a planted screen-capture call");
  const roots = [
    "extensions/hypeproof-chat/src", "extensions/hypeproof-chat/webview-ui/src", "extensions/hypeproof-chat/package.json",
    ...fs.readdirSync(path.join(repo, "extensions")).filter((d) => d !== "hypeproof-chat").map((d) => `extensions/${d}`),
    "chalk/src", "packages", "vscodium-base/patches",
  ];
  const hits = [];
  for (const r of roots) {
    const abs = path.join(repo, r);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { if (FORBIDDEN.test(fs.readFileSync(abs, "utf8"))) hits.push(r); } else scan(abs, hits);
  }
  assert.deepEqual(hits, [], `OS screen-capture code path in product source: ${hits.join(", ")}`);
  assert.ok(fs.existsSync(path.join(repo, "extensions/hypeproof-chat/src/voiceShowThis.ts")), "scan root moved");
  console.log(`PASS no desktopCapturer / display-media / OS screen capture in product source (${roots.length} roots, planted control found)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
