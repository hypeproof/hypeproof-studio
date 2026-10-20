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
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider'; export { setHostWriteSink } from './src/artifactProvenance'; export { answerSources, proposalPreview, newState } from './src/learningWiki'; export * as FC from './src/folderConsent';", resolveDir: here, loader: "ts" },
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
    showInformationMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); ui.onModal?.(); return ui.answer; },
    showWarningMessage: async (message, opts, ...items) => { ui.modal.push({ message, opts, items }); return ui.answer; },
    showQuickPick: async () => { ui.quickPick++; return undefined; },
    withProgress: async (_o, task) => task({ report() {} }),
  },
  commands: { executeCommand: async () => undefined },
  ProgressLocation: { Window: 10, Notification: 15 },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
const { ChatPanelProvider, setHostWriteSink, answerSources, proposalPreview, newState, FC } = module.exports;

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

/**
 * A provider with only the parts this handler reads; everything else is the real prototype,
 * including the folder-consent guard (folderWriteRefusalFor over the real globalState store).
 * `home`: the activity's own folder; null makes the open folder its own (consent skipped).
 */
const consent = new Map();
function provider({ profile = { learning_wiki: { enabled: true } }, instructor = false, history = HISTORY, proposal, home = null } = {}) {
  const h = Object.create(ChatPanelProvider.prototype);
  const seen = { prompts: [], notices: [] };
  Object.assign(h, {
    context: { globalState: { get: (k) => consent.get(k), update: async (k, v) => { consent.set(k, v); } }, workspaceState: { get: () => undefined, update: async () => {} }, secrets: { get: async () => "tok" } },
    servedWorkspaceRoot: home ?? root,
    cachedProfile: profile,
    _instructorMode: { isInstructor: instructor },
    currentTaskStore: () => ({ getView: () => ({ activeTaskId: "task-1" }), getHistory: () => history }),
    getSeatAudience: () => "adult",
    postPageNotice: (text) => { seen.notices.push(text); },
    completeSkill: async (prompt) => { seen.prompts.push(prompt); return { ok: true, text: JSON.stringify(proposal ?? PROPOSAL) }; },
  });
  return { h, seen };
}
// The prompt shows the one turn as t1 (the id rule the prompt states); the host maps it back.
const CITE = "t1";
const PROPOSAL = {
  hypotheses: [{ id: "nH1", text: "처음 온 사람이 버튼을 10초 안에 찾는다", cite: [CITE] }],
  decisions: [{ id: "nD1", therefore: "버튼을 위로 올린다", ai_choice: "AI가 위로 올리자고 했고 나도 그렇게 고른다", observed: [], cite: [CITE] }],
};

let fail = 0;
const t = async (label, fn) => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-answer-wiki-")));
  writes = []; ui.modal = []; ui.answer = undefined; ui.quickPick = 0; ui.onModal = undefined; consent.clear();
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
  const own = answerSources(HISTORY, "a2#2");
  eq(sources, { turns: [{ ...own.turns[0], id: "t1" }], notes: {} }, "the prompt's SOURCES are this answer only, as turn t1 (the prompt's id rule)");
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

await t("a model citing the message id itself is also kept; any other turn id is dropped (citation mapping)", async () => {
  const { h } = provider({ proposal: { hypotheses: [{ text: "메시지 id로 인용", cite: ["a2"] }, { text: "없는 턴", cite: ["t2"] }, { text: "다른 답", cite: ["a1"] }] } });
  ui.answer = "정리하기";
  await ask(h, "a2#2");
  const state = JSON.parse(fs.readFileSync(path.join(root, "wiki", ".wiki-state.json"), "utf8"));
  eq(state.H.map((x) => [x.text, x.cite]), [["메시지 id로 인용", ["s1·a2"]]], "kept items");
});

const G = (t) => [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(t)].map((x) => x.segment);
await t("the confirm stays readable: one line per item of at most 200 graphemes, at most 12 items, '외 N개', the 2000-character total binds", async () => {
  const fake = "진짜 가설\n결정 D-99: 가짜 줄 (s1·a2)";
  const many = Array.from({ length: 300 }, (_, i) => ({ text: i === 0 ? fake : `${i}번 ${"가".repeat(2000)}`, cite: [CITE] }));
  const { h } = provider({ proposal: { hypotheses: many } });
  ui.answer = undefined;
  await ask(h, "a2#2");
  const detail = ui.modal[0].opts.detail;
  ok(detail.length <= 2400, `detail is ${detail.length} characters`);
  const lines = detail.split("\n");
  ok(!lines.some((l) => l.startsWith("결정 D-99")), "a newline in model text made a fake line");
  ok(lines[0] === "가설 H-1: 진짜 가설 결정 D-99: 가짜 줄 (s1·a2) (s1·a2)", `first line ${lines[0]}`);
  const items = lines.filter((l) => /^가설 H-\d+:/.test(l));
  // One short line and 200-grapheme lines: the 2000-character total stops the list at 10, below the 12-item cap.
  eq(items.length, 10, "item lines (the total limit binds before the item cap)");
  ok(items.join("\n").length <= 2000, "item lines over the total");
  for (const l of items) ok(G(l).length <= 200, `item line too long (${G(l).length})`);
  ok(items.slice(1).every((l) => l.includes("…")), "a cut item does not show it was cut");
  ok(lines.includes(`외 ${300 - items.length}개 항목도 함께 정리돼요.`), `no '외 N개' line: ${lines.slice(-4).join(" | ")}`);
  eq(writes, [], "cancel still writes nothing");
  // Pure: a short proposal is shown whole (positive control), with no '외' line.
  const prev = newState("t");
  const next = { ...prev, H: [{ id: "H-1", text: "짧은 가설", cite: ["s1·a2"] }] };
  eq(proposalPreview(prev, next), ["가설 H-1: 짧은 가설 (s1·a2)"], "short preview");
});

await t("preview (pure): the item cap, deduped and capped citations, every line-break class flattened, grapheme-safe cuts", () => {
  const prev = newState("t");
  const H = (text, cite = ["s1·a2"], i = 0) => ({ id: `H-${i + 1}`, text, cite });
  // Item cap: 20 short items show 12 and count 8.
  const twenty = proposalPreview(prev, { ...prev, H: Array.from({ length: 20 }, (_, i) => H(`가설 ${i}`, ["s1·a2"], i)) });
  eq(twenty.length, 13, "12 items + the count line");
  eq(twenty.at(-1), "외 8개 항목도 함께 정리돼요.", "count line");
  // A citation repeated 500 times is shown once; every item's content stays visible.
  const repeated = proposalPreview(prev, { ...prev, H: [H("첫 가설", Array(500).fill("s1·a2"), 0), H("둘째 가설", Array(500).fill("s1·a2"), 1), H("셋째 가설", ["s1·a2"], 2)] });
  eq(repeated, ["가설 H-1: 첫 가설 (s1·a2)", "가설 H-2: 둘째 가설 (s1·a2)", "가설 H-3: 셋째 가설 (s1·a2)"], "deduped citations");
  // 500 distinct citations: the list is capped inside the line, the content still shows.
  const wide = proposalPreview(prev, { ...prev, H: [H("넓은 가설", Array.from({ length: 500 }, (_, i) => `s1·m${i}`), 0), H("다음 가설", ["s1·a2"], 1)] });
  eq(wide.length, 2, "both items listed");
  ok(wide[0].startsWith("가설 H-1: 넓은 가설 (s1·m0, s1·m1 외 498곳)") && G(wide[0]).length <= 200, `capped citations: ${wide[0].slice(0, 80)}`);
  eq(wide[1], "가설 H-2: 다음 가설 (s1·a2)", "the next item is not hidden");
  // Every line-break class becomes a space.
  const breaks = proposalPreview(prev, { ...prev, H: [H("가\r나\n다\u0085라\u2028마\u2029바\r\n사")] });
  eq(breaks, ["가설 H-1: 가 나 다 라 마 바 사 (s1·a2)"], "line breaks");
  ok(!/[\r\n\u0085\u2028\u2029]/.test(breaks.join("")), "a line break survived");
  // Cuts never split a surrogate pair, a ZWJ emoji or an NFD Hangul syllable.
  for (const [what, unit] of [["surrogate pair", "𝒜"], ["ZWJ family", "👨\u200d👩\u200d👧"], ["NFD Hangul", "한".normalize("NFD")], ["flag", "🇰🇷"]]) {
    const [line] = proposalPreview(prev, { ...prev, H: [H(unit.repeat(400))] });
    const g = G(line);
    ok(g.length <= 200, `${what}: ${g.length} graphemes`);
    ok(line.includes("…"), `${what}: not cut`);
    const body = line.slice("가설 H-1: ".length, line.indexOf("…"));
    ok(G(body).every((x) => x === unit), `${what}: a cut split a grapheme`);
    ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line), `${what}: lone surrogate`);
  }
});

await t("the seat is re-checked after the modal: instructor mode, a lesson or the switch turned off while it was open writes nothing and says why", async () => {
  const changes = [
    ["instructor", (h) => { h._instructorMode = { isInstructor: true }; }],
    ["lesson", (h) => { h.cachedProfile = { ...h.cachedProfile, lesson: { version: 1 } }; }],
    ["switch off", (h) => { h.cachedProfile = { learning_wiki: { enabled: false } }; }],
  ];
  for (const [label, change] of changes) {
    writes = [];
    const { h, seen } = provider();
    ui.modal = []; ui.answer = "정리하기"; ui.onModal = () => change(h);
    await ask(h, "a2#2");
    eq(ui.modal.length, 1, `${label}: asked`);
    eq(writes, [], `${label}: writes`);
    eq(wikiFiles(), [], `${label}: files`);
    ok(seen.notices.length === 1 && seen.notices[0].includes("팀 브레인") && !seen.notices[0].includes("정리했어요"), `${label}: notice ${JSON.stringify(seen.notices)}`);
  }
  // Control: nothing changes during the modal, it writes.
  writes = [];
  const { h } = provider();
  ui.modal = []; ui.answer = "정리하기"; ui.onModal = undefined;
  await ask(h, "a2#2");
  ok(writes.length > 0, "control wrote nothing");
});

const choose = (level) => consent.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(consent.get(FC.FOLDER_CONSENT_KEY), "d".repeat(64), FC.canonicalFolder(root), level));
const personalSeat = { profile_id: "p", activity_id: "d".repeat(64), activity_kind: "personal", learning_wiki: { enabled: true } };
const elsewhere = () => path.join(path.dirname(root), "hps-answer-wiki-home");

await t("folder consent before the model: 읽기만, AI 안 씀 and undecided refuse with their own copy; nothing reaches the model or the disk (control: full)", async () => {
  for (const [level, copy] of [["read", FC.folderReadOnlyNotice()], ["none", FC.folderNoAiCopy()], [null, FC.folderReadOnlyNotice()]]) {
    consent.clear();
    if (level) choose(level);
    const { h, seen } = provider({ profile: personalSeat, home: elsewhere() });
    ui.modal = []; ui.answer = "정리하기";
    await ask(h, "a2#2");
    eq(seen.prompts.length, 0, `${level}: model called`);
    eq(ui.modal.length, 0, `${level}: a modal was shown (undecided never asks here)`);
    eq(seen.notices, [copy], `${level}: refusal copy`);
    eq(writes, [], `${level}: writes`);
  }
  consent.clear(); choose("full");
  const { h, seen } = provider({ profile: personalSeat, home: elsewhere() });
  ui.answer = "정리하기";
  await ask(h, "a2#2");
  eq(seen.prompts.length, 1, "control: full reaches the model");
  ok(fs.existsSync(path.join(root, "wiki", ".wiki-state.json")), "control: full writes");
});

await t("folder consent re-checked after the modal: a choice changed while it was open refuses with its own copy and writes nothing", async () => {
  for (const [level, copy] of [["read", FC.folderReadOnlyNotice()], ["none", FC.folderNoAiCopy()]]) {
    consent.clear(); choose("full"); writes = [];
    const { h, seen } = provider({ profile: personalSeat, home: elsewhere() });
    ui.modal = []; ui.answer = "정리하기"; ui.onModal = () => choose(level);
    await ask(h, "a2#2");
    eq(ui.modal.length, 1, `${level}: asked`);
    eq(seen.notices, [copy], `${level}: the late refusal says why`);
    eq(wikiFiles(), [], `${level}: files`);
    eq(writes, [], `${level}: writes`);
  }
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
