// CGP-KNOW-R-004 (REQ-STUDIO-ANSWER-TO-WIKI) — "팀 브레인에 정리하기" on one finished answer, host
// side. The real ChatPanelProvider handler runs, bundled with esbuild, with only VS Code I/O and the
// model call substituted: it builds a proposal from that answer and the question that prompted it,
// shows the learner what will be written (modal), and writes only on confirm, through
// applyWikiProposal and the same page writer as the session ingest, with the provenance hook.
// .claude/rules/verification.md §2: every case has a control that would fail if the rule were wrong.
// Run: node --experimental-strip-types test/answer-to-wiki.smoke.mjs

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
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export { setHostWriteSink } from './src/artifactProvenance'; export { answerSources } from './src/learningWiki';", resolveDir: here, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});

let root = "";
const ui = { modal: [], answer: undefined, quickPick: 0 };
const vscode = {
  workspace: {
    get workspaceFolders() { return [{ uri: { fsPath: root }, name: "my-work" }]; },
    getConfiguration: () => ({ get: (_k, fallback) => fallback }),
  },
  Uri: { file: (p) => ({ fsPath: p }) },
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
    showInformationMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); return ui.answer; },
    showWarningMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); return ui.answer; },
    showQuickPick: async () => { ui.quickPick++; return undefined; },
    withProgress: async (_o, task) => task({ report() {} }),
  },
  commands: { executeCommand: async () => undefined },
  ProgressLocation: { Window: 10, Notification: 15 },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
const { ChatPanelProvider, setHostWriteSink, answerSources } = module.exports;

let writes = [];
setHostWriteSink({ wrote: (w, actor) => { for (const x of w) writes.push({ rel: path.relative(root, x.absPath).split(path.sep).join("/"), actor }); }, replaced: () => {} });

const at = 1000;
const u = (id, content) => ({ id, role: "user", content, createdAt: at });
const a = (id, content) => ({ id, role: "assistant", content, createdAt: at });
const tool = (id) => ({ id, role: "tool", content: "", createdAt: at, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const HISTORY = [
  u("u1", "첫 질문은 날씨"), a("a1", "첫 답은 맑음"),
  u("u2", "우리 앱 첫 화면을 바꿀까?"), a("a2", "살펴볼게요"), tool("t2"), a("a2#2", "버튼을 위로 올리면 처음 온 사람이 더 빨리 찾을 것 같아요"),
  u("u3", "다른 이야기"), a("a3", "세 번째 답은 다른 이야기"),
];

/** A provider with only the parts this handler reads; everything else is the real prototype. */
function provider({ profile = { learning_wiki: { enabled: true } }, instructor = false, history = HISTORY, proposal } = {}) {
  const h = Object.create(ChatPanelProvider.prototype);
  const seen = { prompts: [], notices: [] };
  Object.assign(h, {
    cachedProfile: profile,
    _instructorMode: { isInstructor: instructor },
    currentTaskStore: () => ({ getView: () => ({ activeTaskId: "task-1" }), getHistory: () => history }),
    getSeatAudience: () => "adult",
    folderWriteRefusalFor: () => null,
    postPageNotice: (text) => { seen.notices.push(text); },
    completeSkill: async (prompt) => { seen.prompts.push(prompt); return { ok: true, text: JSON.stringify(proposal ?? PROPOSAL) }; },
  });
  return { h, seen };
}
const CITE = "a2";
const PROPOSAL = {
  hypotheses: [{ id: "nH1", text: "처음 온 사람이 버튼을 10초 안에 찾는다", cite: [CITE] }],
  decisions: [{ id: "nD1", therefore: "버튼을 위로 올린다", ai_choice: "AI가 위로 올리자고 했고 나도 그렇게 고른다", observed: [], cite: [CITE] }],
};

let fail = 0;
const t = async (label, fn) => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-answer-wiki-")));
  writes = []; ui.modal = []; ui.answer = undefined; ui.quickPick = 0;
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
  fs.rmSync(root, { recursive: true, force: true });
};
const eq = (x, y, what) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${what}: got ${JSON.stringify(x)}, want ${JSON.stringify(y)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const sourcesIn = (prompt) => JSON.parse(prompt.slice(prompt.lastIndexOf("SOURCES\n") + "SOURCES\n".length));
const wikiFiles = () => { const dir = path.join(root, "wiki"); return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []; };
const ask = (h, messageId) => h.handleAnswerToWiki({ type: "answerToWiki", messageId });

console.log("answer to wiki — one answer, proposal, confirm, write");

await t("sources: that answer (all of its bubbles) and the question that prompted it, cited by the turn's message id (pure)", () => {
  const s = answerSources(HISTORY, "a2#2");
  eq(s, { turns: [{ id: "a2", student: "우리 앱 첫 화면을 바꿀까?", coach: "살펴볼게요\n\n버튼을 위로 올리면 처음 온 사람이 더 빨리 찾을 것 같아요" }], notes: {} }, "sources");
  eq(answerSources(HISTORY, "a1"), { turns: [{ id: "a1", student: "첫 질문은 날씨", coach: "첫 답은 맑음" }], notes: {} }, "control: another answer is its own turn");
  // Negative controls: not a finished answer's last bubble, a user line, an unknown id, no question above.
  eq(answerSources(HISTORY, "a2"), null, "first bubble of a split answer");
  eq(answerSources(HISTORY, "u2"), null, "user line");
  eq(answerSources(HISTORY, "zz"), null, "unknown id");
  eq(answerSources([a("g1", "안녕하세요")], "g1"), null, "greeting with no question");
});

await t("the action builds a proposal from that answer and its question only, and the modal shows what will be written with the turn cited", async () => {
  const { h, seen } = provider();
  await ask(h, "a2#2");
  eq(seen.prompts.length, 1, "one model call");
  const sources = sourcesIn(seen.prompts[0]);
  eq(sources, answerSources(HISTORY, "a2#2"), "the prompt's SOURCES are this answer only");
  for (const other of ["첫 질문은 날씨", "첫 답은 맑음", "다른 이야기", "세 번째 답"]) ok(!seen.prompts[0].includes(other), `another turn leaked into the prompt: ${other}`);
  eq(ui.modal.length, 1, "one confirmation");
  const m = ui.modal[0];
  ok(m.opts?.modal === true, "not modal");
  eq(m.items, ["정리하기"], "confirm button");
  ok(m.opts.detail.includes("가설 H-1: 처음 온 사람이 버튼을 10초 안에 찾는다") && m.opts.detail.includes("결정 D-1: 버튼을 위로 올린다"), `preview: ${m.opts.detail}`);
  ok(m.opts.detail.includes("s1·a2"), `the cited turn is not shown: ${m.opts.detail}`);
});

await t("cancel writes nothing: no wiki folder, no host write", async () => {
  const { h, seen } = provider();
  ui.answer = undefined;
  await ask(h, "a2#2");
  eq(ui.modal.length, 1, "asked");
  eq(wikiFiles(), [], "files after cancel");
  eq(writes, [], "host writes after cancel");
  ok(seen.notices.some((n) => n.includes("정리하지 않았어요")), `notice ${JSON.stringify(seen.notices)}`);
});

await t("confirm writes through applyWikiProposal and the page writer; every write goes through the provenance hook (pages as the AI's)", async () => {
  const { h, seen } = provider();
  ui.answer = "정리하기";
  await ask(h, "a2#2");
  const state = JSON.parse(fs.readFileSync(path.join(root, "wiki", ".wiki-state.json"), "utf8"));
  eq(state.H.map((x) => [x.id, x.cite]), [["H-1", ["s1·a2"]]], "hypothesis numbered and cited by applyWikiProposal");
  eq(state.D.map((x) => [x.id, x.cite]), [["D-1", ["s1·a2"]]], "decision");
  ok(/^\[\d{4}-\d{2}-\d{2}\] 1회차 \| 정리 \| 대화 1턴 · 메모 0 → 가설 \+1 · 근거 \+0 · 결정 \+1 · 뺀 것 0$/.test(state.log.at(-1)), `log line ${state.log.at(-1)}`);
  ok(fs.readFileSync(path.join(root, "wiki", "hypotheses.md"), "utf8").includes("처음 온 사람이 버튼을 10초 안에 찾는다 (s1·a2)"), "page not rendered");
  const byFile = Object.fromEntries(writes.map((w) => [w.rel, w.actor]));
  eq(byFile["wiki/.wiki-state.json"], "studio", "state file writer");
  for (const page of ["wiki/index.md", "wiki/hypotheses.md", "wiki/decisions.md", "wiki/log.md", "wiki/sessions/01.md"]) eq(byFile[page], "ai", `${page} writer`);
  // Every file on disk under wiki/ was reported to the hook (no write bypasses it).
  const onDisk = wikiFiles().filter((f) => fs.statSync(path.join(root, "wiki", f)).isFile()).map((f) => `wiki/${f.split(path.sep).join("/")}`);
  for (const f of onDisk) ok(f in byFile, `written without the hook: ${f}`);
  ok(seen.notices.some((n) => n.includes("팀 브레인에 정리했어요.")), `notice ${JSON.stringify(seen.notices)}`);
  // The same answer twice is not filed twice (sessionHash over the same sources).
  writes = []; ui.modal = [];
  await ask(h, "a2#2");
  eq(writes, [], "second filing wrote");
  eq(ui.modal.length, 0, "second filing asked again");
});

await t("a proposal that cites anything but this turn is dropped; nothing to confirm, nothing written (negative control)", async () => {
  const { h, seen } = provider({ proposal: { hypotheses: [{ id: "nH1", text: "다른 턴에서 온 가설", cite: ["a1"] }], decisions: [{ therefore: "인용 없음", cite: [] }] } });
  ui.answer = "정리하기";
  await ask(h, "a2#2");
  eq(ui.modal.length, 0, "asked to confirm an empty proposal");
  eq(wikiFiles(), [], "files");
  eq(writes, [], "writes");
  ok(seen.notices.some((n) => n.includes("새로 정리할 내용")), `notice ${JSON.stringify(seen.notices)}`);
});

await t("a seat without team brain gets nothing: no model call, no modal, no write (off, absent, lesson, instructor)", async () => {
  const seats = [
    ["off", { profile: { learning_wiki: { enabled: false } } }],
    ["absent", { profile: {} }],
    ["no profile", { profile: null }],
    ["lesson", { profile: { learning_wiki: { enabled: true }, lesson: { version: 1 } } }],
    ["instructor", { instructor: true }],
  ];
  for (const [label, opts] of seats) {
    const { h, seen } = provider(opts);
    ui.answer = "정리하기";
    await ask(h, "a2#2");
    eq(seen.prompts.length, 0, `${label}: model called`);
    eq(ui.modal.length, 0, `${label}: modal`);
    eq(writes, [], `${label}: writes`);
  }
  // Control: the same request on a team-brain seat does reach the model.
  const { h, seen } = provider();
  await ask(h, "a2#2");
  eq(seen.prompts.length, 1, "control");
});

await t("a streaming answer (not in the saved conversation yet) and a non-answer line get nothing", async () => {
  // A running turn is not saved until it ends (handleAnswerVerdict relies on the same fact).
  const { h, seen } = provider({ history: HISTORY.slice(0, 6) });
  ui.answer = "정리하기";
  await ask(h, "a3");
  for (const id of ["a2", "u2", "t2", "", 42]) await ask(h, id);
  eq(seen.prompts.length, 0, "model called");
  eq(ui.modal.length, 0, "modal");
  eq(writes, [], "writes");
  await ask(h, "a2#2");
  eq(seen.prompts.length, 1, "control: the finished answer reaches the model");
});

await t("the handler is wired to the webview message and reuses the session path's builder and writer (no second write path)", () => {
  const src = fs.readFileSync(path.join(here, "src/chatPanelProvider.ts"), "utf8");
  ok(/case "answerToWiki":\s*await this\.handleAnswerToWiki\(msg\);/.test(src), "message case");
  const body = src.slice(src.indexOf("private async runAnswerToWiki("), src.indexOf("private async runAnswerToWiki(") + 4000);
  ok(/wikiPrompt\(/.test(body) && /applyWikiProposal\(/.test(body) && /writeWiki\(/.test(body), "builder or writer not reused");
  ok(!/fs\.writeFileSync|writeFiles\(|saveState\(/.test(body), "a second write path in the handler");
  const ingest = src.slice(src.indexOf("private async runWikiIngest("), src.indexOf("private async runWikiIngest(") + 4000);
  ok(/writeWiki\(dir, r\.state, plan\)/.test(ingest), "the session ingest does not share the writer");
});

if (fail) { console.error(`answer-to-wiki: ${fail} failed`); process.exit(1); }
console.log("answer-to-wiki host OK");
