// CGP-KNOW-D-016 (DES-KNOW-29 / REQ-KNOW-29) — the file info popover's host side: 종류, 크기,
// 만든 대화, 마지막으로 바꾼 대화. Real temp work folders driven through takeRestorePoint /
// diffRestorePoint and the recorder; a real TaskWorkspaceStore resolves each turn at the moment of
// asking. Planted answers: a link only for an AI event recorded with its task and row that the store
// still holds; a cleared, moved or archived turn, an event recorded before this change, an upload or a
// Studio write and every 기록 없음 row come back as plain text.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArtifactProvenanceRecorder, loadLedger, provenanceLedgerFile, provenanceView, recordCoachTurn, emptyLedger, observeOutsideTurn } from "../src/artifactProvenance.ts";
import { ARTIFACT_INFO_TEXT, artifactInfo, artifactSizeLabel, artifactTypeLabel } from "../src/artifactProvenanceView.ts";
import { diffRestorePoint, scanFolder, takeRestorePoint, turnRestoreStoreDir } from "../src/turnRestore.ts";
import { TaskWorkspaceStore } from "../src/taskWorkspaceStore.ts";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "artifact-info-")));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };

await t("종류 and 크기 are named from the file name and the byte count", () => {
  assert.equal(artifactTypeLabel("site/index.html"), "웹페이지 (HTML)");
  assert.equal(artifactTypeLabel("사진.JPG"), "그림 (JPG)");
  assert.equal(artifactTypeLabel("Makefile"), "파일");
  assert.equal(artifactTypeLabel(".env"), "파일");
  assert.equal(artifactTypeLabel("data.parquet"), "PARQUET 파일");
  assert.equal(artifactTypeLabel("x.<img src=x>"), "파일");
  assert.equal(artifactSizeLabel(0), "0바이트");
  assert.equal(artifactSizeLabel(1023), "1023바이트");
  assert.equal(artifactSizeLabel(1536), "1.5KB");
  assert.equal(artifactSizeLabel(20 * 1024 * 1024), "20MB");
  assert.equal(artifactSizeLabel(null), "알 수 없어요");
  assert.equal(artifactSizeLabel(-1), "알 수 없어요");
});

const sha = (c) => c.repeat(64);
await t("a coach turn records its task and row; origin and last come from the file's own lifetime", () => {
  let l = observeOutsideTurn(emptyLedger(), [{ path: "old.md", sha256: sha("a") }], { at: 1 });
  l = recordCoachTurn(l, { turnId: "s1", at: 10, startedAt: 5, added: ["page.html"], changed: ["old.md"], deleted: [], place: { taskId: "t1", messageId: "m1" } },
    [{ path: "old.md", sha256: sha("b") }, { path: "page.html", sha256: sha("c") }]);
  l = recordCoachTurn(l, { turnId: "s2", at: 20, startedAt: 15, added: [], changed: ["page.html"], deleted: [], place: { taskId: "t2", messageId: "m2" } },
    [{ path: "old.md", sha256: sha("b") }, { path: "page.html", sha256: sha("d") }]);
  const byPath = Object.fromEntries(provenanceView(l).entries.map((e) => [e.path, e]));
  assert.deepEqual(byPath["page.html"].origin, { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } });
  assert.deepEqual(byPath["page.html"].last, { kind: "ai_changed", turn: { taskId: "t2", messageId: "m2" } });
  // old.md was there before the first observation: who made it is not known.
  assert.deepEqual(byPath["old.md"].origin, { kind: "none" });
  assert.deepEqual(byPath["old.md"].last, { kind: "ai_changed", turn: { taskId: "t1", messageId: "m1" } });
  // A malformed place is not recorded (and never makes a link).
  const bad = recordCoachTurn(l, { turnId: "s3", at: 30, startedAt: 25, added: ["x.md"], changed: [], deleted: [], place: { taskId: "", messageId: "m" } },
    [{ path: "old.md", sha256: sha("b") }, { path: "page.html", sha256: sha("d") }, { path: "x.md", sha256: sha("e") }]);
  const x = bad.events.find((e) => e.path === "x.md");
  assert.equal(x.taskId, undefined); assert.equal(x.messageId, undefined);
});

await t("each row value: link, gone, archived, no place, outside a conversation, 기록 없음", () => {
  const entry = (over) => ({ path: "a.html", kind: "ai_changed", label: "AI가 고침", symbol: "↻", history: [], ...over });
  const found = { taskTitle: "내 홈페이지", messageId: "m1#2", archived: false };
  const info = artifactInfo(entry({ origin: { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } }, last: { kind: "ai_changed", turn: { taskId: "t1", messageId: "m1" } } }), 2048, () => found);
  assert.deepEqual(info.created, { kind: "turn", taskId: "t1", messageId: "m1#2", taskTitle: "내 홈페이지" });
  assert.equal(info.type, "웹페이지 (HTML)"); assert.equal(info.size, "2KB");
  const gone = artifactInfo(entry({ origin: { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } }, last: { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } } }), 1, () => null);
  assert.deepEqual(gone.created, { kind: "text", text: ARTIFACT_INFO_TEXT.missing });
  assert.match(gone.changed.text, /^대화를 찾을 수 없어요/);
  const archived = artifactInfo(entry({ origin: { kind: "ai_created", turn: { taskId: "t9", messageId: "m" } } }), 1, () => ({ ...found, archived: true }));
  assert.equal(archived.created.kind, "text"); assert.match(archived.created.text, /보관한 작업 ‘내 홈페이지’/);
  // An event recorded before this change has a turn id but no task or row.
  const legacy = artifactInfo(entry({ origin: { kind: "ai_created" }, last: { kind: "ai_changed" } }), 1, () => found);
  assert.deepEqual(legacy.created, { kind: "text", text: ARTIFACT_INFO_TEXT.noPlace });
  const upload = artifactInfo(entry({ kind: "learner_uploaded", origin: { kind: "learner_uploaded" }, last: { kind: "studio_changed" } }), 1, () => found);
  assert.equal(upload.created.text, "기록된 대화가 없어요 (내가 올림)");
  assert.equal(upload.changed.text, "기록된 대화가 없어요 (Studio가 고침)");
  // 기록 없음: no turn is claimed even if an origin event exists.
  const none = artifactInfo(entry({ kind: "none", origin: { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } }, last: { kind: "ai_created", turn: { taskId: "t1", messageId: "m1" } } }), 1, () => found);
  assert.deepEqual([none.created, none.changed], [{ kind: "text", text: "기록 없음" }, { kind: "text", text: "기록 없음" }]);
});

await t("the task store finds a turn's first visible row, or says it is gone or archived", async () => {
  const root = path.join(tmp, "store"); fs.mkdirSync(root);
  const store = new TaskWorkspaceStore(root, "info-scope"); await store.initialize();
  const first = store.getView().activeTaskId;
  // The turn's first segment was empty, so its row is `<id>#2`.
  await store.append(first, [{ id: "u1", role: "user", content: "만들어 줘", createdAt: 1 }, { id: "turn-a#2", role: "assistant", content: "만들었어요", createdAt: 2 }]);
  assert.deepEqual(store.findTurnRow(first, "turn-a"), { taskTitle: store.getTask(first).title, messageId: "turn-a#2", archived: false });
  assert.equal(store.findTurnRow(first, "turn-"), null, "a prefix of the id is not the turn");
  assert.equal(store.findTurnRow("no-such-task", "turn-a"), null);
  await store.create("둘째 작업", { taskId: first, revision: store.getView().revision });
  const second = store.getView().activeTaskId;
  // archiveTask takes the open task: open the first again, archive it (the second opens).
  await store.select(first, { taskId: second, revision: store.getView().revision });
  await store.archiveTask(first, { taskId: first, revision: store.getView().revision });
  assert.equal(store.findTurnRow(first, "turn-a").archived, true);
  await store.restoreTask(first, { taskId: store.getView().activeTaskId, revision: store.getView().revision });
  await store.clearHistory(first);
  assert.equal(store.findTurnRow(first, "turn-a"), null, "a cleared conversation has no row");
});

await t("recorder.info over a real folder: turn links, real size, nothing outside the folder", async () => {
  const base = path.join(tmp, "base"), root = path.join(tmp, "work");
  fs.mkdirSync(base); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "notes.md"), "before");
  const rec = new ArtifactProvenanceRecorder(base);
  await rec.view(root, (await scanFolder(root)).files);
  const store = turnRestoreStoreDir(base, root, "t1");
  const point = (await takeRestorePoint({ store, root, id: "s1", turnId: "s1", kind: "turn", now: 1000 })).point;
  await rec.turnStart(root, point);
  fs.writeFileSync(path.join(root, "index.html"), "<h1>안녕</h1>");
  const after = await scanFolder(root);
  await rec.turnEnd(root, point, diffRestorePoint(point, after), after, { taskId: "t1", messageId: "m1" });
  const rows = new Map([["t1/m1", { taskTitle: "첫 작업", messageId: "m1", archived: false }]]);
  const lookup = (ref) => rows.get(`${ref.taskId}/${ref.messageId}`) ?? null;
  const info = await rec.info(root, "index.html", lookup);
  assert.equal(info.size, `${Buffer.byteLength("<h1>안녕</h1>")}바이트`);
  assert.deepEqual(info.created, { kind: "turn", taskId: "t1", messageId: "m1", taskTitle: "첫 작업" });
  assert.deepEqual(info.changed, info.created);
  const notes = await rec.info(root, "notes.md", lookup);
  assert.deepEqual([notes.created.text, notes.changed.text], ["기록 없음", "기록 없음"]);
  // Asking again after the turn's row is gone answers plain text, not a stale link.
  rows.clear();
  assert.equal((await rec.info(root, "index.html", lookup)).created.kind, "text");
  assert.equal(await rec.info(root, "../outside.txt", lookup), null, "an unlisted path has no info");
  assert.equal(await rec.info(root, "missing.md", lookup), null);
  // The ledger keeps the place; a forged place in a saved ledger makes the whole ledger damaged.
  const file = provenanceLedgerFile(base, root);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(saved.events.some((e) => e.path === "index.html" && e.taskId === "t1" && e.messageId === "m1"));
  saved.events.find((e) => e.path === "index.html").messageId = "m".repeat(201);
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal((await loadLedger(file)).stale, true);
  // A listed path that turned into a link is not measured through it.
  const linkRoot = path.join(tmp, "work2"); fs.mkdirSync(linkRoot);
  fs.writeFileSync(path.join(tmp, "big.bin"), Buffer.alloc(5000));
  const rec2 = new ArtifactProvenanceRecorder(path.join(tmp, "base2"));
  fs.writeFileSync(path.join(linkRoot, "a.bin"), "x");
  await rec2.view(linkRoot, (await scanFolder(linkRoot)).files);
  fs.rmSync(path.join(linkRoot, "a.bin")); fs.symlinkSync(path.join(tmp, "big.bin"), path.join(linkRoot, "a.bin"));
  assert.equal((await rec2.info(linkRoot, "a.bin", lookup)).size, "알 수 없어요");
});

await t("the real ChatPanelProvider records the turn's task and row at turn end and answers the popover's request", async () => {
  const { build } = await import("esbuild");
  const vm = await import("node:vm");
  const { createRequire } = await import("node:module");
  const { webcrypto } = await import("node:crypto");
  const require = createRequire(import.meta.url);
  const here = new URL("..", import.meta.url).pathname;
  const bundle = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: here, loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent" });
  const vscode = { workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }) }, Uri: { file: (p) => ({ fsPath: p }) }, window: { createOutputChannel: () => ({ appendLine: () => {} }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
  const { ChatPanelProvider } = module.exports;
  const root = path.join(tmp, "provider-work"), base = path.join(tmp, "provider-base"), tasks = path.join(tmp, "provider-tasks");
  for (const d of [root, base, tasks]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(root, "notes.md"), "before");
  const store = new TaskWorkspaceStore(tasks, "provider"); await store.initialize();
  const taskId = store.getView().activeTaskId;
  const posted = [];
  const make = (instructor) => Object.assign(Object.create(ChatPanelProvider.prototype), {
    context: { globalStorageUri: { fsPath: base } }, provenance: null, turnReview: null, _instructorMode: { isInstructor: instructor },
    resolveCoachCwd: () => root, currentTaskStore: () => store, pageCardScope: () => "scope", postTurnReview() {}, postToolLog() {},
    post: async (m) => { posted.push(m); }, hasActiveStream: () => false, pendingSends: 0, turnRestoreBusy: false, taskChanging: false,
    artifactHistoryEnabled: () => false, postPageCards() {}, enrichPageCard: async () => {}, cachedProfile: null, turnTimelines: new Map(),
  });
  const p = make(false);
  await p.postArtifactProvenance(true);
  const handle = await p.beginTurnRestore("stream-1");
  assert.ok(handle, "a restore point was taken");
  fs.writeFileSync(path.join(root, "index.html"), "<p>hi</p>");
  await p.endTurnRestore(handle, "stream-1", "msg-1", "");
  // The row lands in the task after the ledger write, as in a real turn.
  await store.append(taskId, [{ id: "msg-1", role: "assistant", content: "만들었어요", createdAt: 5 }]);
  await p.postArtifactInfo("req-1", "index.html");
  const answer = posted.filter((m) => m.type === "artifactInfo").at(-1);
  assert.equal(answer.requestId, "req-1");
  // The provider runs in its own vm context: compare plain JSON, not prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(answer.info.created)), { kind: "turn", taskId, messageId: "msg-1", taskTitle: store.getTask(taskId).title });
  assert.equal(answer.info.size, "9바이트");
  // Malformed requests get no answer; the instructor surface gets no info.
  const before = posted.length;
  await p.postArtifactInfo("", "index.html"); await p.postArtifactInfo("r".repeat(101), "index.html"); await p.postArtifactInfo("ok", 7);
  assert.equal(posted.length, before, "malformed requests are dropped");
  await make(true).postArtifactInfo("req-2", "index.html");
  assert.equal(posted.at(-1).info, null, "no info on the instructor surface");
});

console.log(`artifact info: ${passed} passed`);
