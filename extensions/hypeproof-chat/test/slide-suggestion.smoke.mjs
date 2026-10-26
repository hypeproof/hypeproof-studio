// CGP-ART-R-016 / REQ-STUDIO-DECK-SLIDE-SUGGEST: slide suggestion chips. Part 1 drives the pure gate
// (slideSuggestion.ts) with planted defects; part 2 drives the real ChatPanelProvider command with only
// VS Code I/O and the model replaced, and compares the wiki folder byte for byte.
//
// Run: node --experimental-strip-types test/slide-suggestion.smoke.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wiki = await import("../src/learningWiki.ts");
const deck = await import("../src/deckGenerator.ts");
const sg = await import("../src/slideSuggestion.ts");
const { SERVICE_CONTRACT_FIXTURES } = await import("./fixtures/service-contracts/index.mjs");
const PLAN = SERVICE_CONTRACT_FIXTURES.plan;
const template = PLAN.deck;
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

// A wiki with slides 2 (a quote on E-1) and 3 (a number on D-1, "52px") drafted.
const turns = [{ id: "t1", text: "우리 팀은 어르신 이동 문제를 골랐어." }, { id: "t2", text: "할아버지께 보여 드렸는데 다음 버튼이 작대." }];
const sources = { turns, notes: {} };
const s0 = wiki.newState("A · 어르신 길찾기");
const s1 = wiki.applyWikiProposal(s0, 1, sources, {
  problem: { text: "어르신이 다음에 어디서 꺾는지 몰라 가족에게 전화한다", cite: ["t1"] },
  hypotheses: [{ id: "nH1", text: "한 단계씩 크게 보이면 혼자 간다", cite: ["t1"] }],
  evidence: [{ id: "nE1", kind: "외부 반응", state: "real", outcome: "", hypothesis: "nH1", text: "할아버지가 다음 버튼이 작다고 하심", cite: ["t2"] }],
  decisions: [{ id: "nD1", therefore: "다음 버튼을 52px로 키운다", ai_choice: "AI 제안 그대로", observed: ["nE1"], cite: ["t2"] }],
  changes: [], next: null,
}, wiki.sessionHash(1, sources), "2026-10-05", PLAN).state;
const drafted = deck.applyDeckProposal(s1, template, [2, 3], { slides: [
  { no: 2, headline: "다음 버튼은 바로 통했다", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지, 시험 자리" }, support: ["직접 보여 드림", "직접 만남"], notes: "첫 시험에서 들은 말", refs: ["E-1"], gaps: ["실제 어르신 3명"] },
  { no: 3, headline: "버튼을 52px로 키웠다", visual: { type: "number", value: "52px", label: "다음 버튼" }, support: ["할아버지 말을 듣고"], notes: "결정", refs: ["D-1"], gaps: [] },
] }, 2);
assert.deepEqual(drafted.written, [2, 3], JSON.stringify(drafted.dropped));
const S = { ...drafted.state, sessions: [1, 2] };
const answer = (slides) => ({ slides });
const simpler3 = { no: 3, headline: "버튼을 52px로", visual: { type: "number", value: "52px", label: "다음 버튼" }, support: [] };

// ── chips: at most three, only for a drafted slide ──
assert.deepEqual(sg.SLIDE_CHIPS.map((c) => c.label), ["쉽게 줄이기", "그림으로 보이기", "핵심 강조"]);
assert.equal(sg.slideChips(S, 3).length, 3);
assert.ok(sg.slideChips(S, 3).length <= sg.MAX_SLIDE_CHIPS);
assert.deepEqual(sg.slideChips(S, 1), [], "an undrafted slide offers no chips");
const prompt = sg.slideSuggestionPrompt(S, template, 3, "simplify", PLAN);
assert.match(prompt, /3번 장 하나만/);
assert.match(prompt, /더 짧고 쉬운 말로/);
assert.match(prompt, /다음 버튼을 52px로 키운다/, "the prompt carries the slide's cited entries");
assert.ok(!prompt.includes("할아버지가 다음 버튼이 작다고 하심"), "and only those (slide 3 does not cite E-1)");
ok("chips: 쉽게 줄이기 · 그림으로 보이기 · 핵심 강조, none for an undrafted slide; the prompt names one slide and its own evidence");

// ── the gate: one slide only, numbers rule, quotes, refs fixed ──
const good = sg.checkSlidePatch(S, template, 3, "simplify", answer([simpler3]));
assert.equal(good.ok, true, JSON.stringify(good));
assert.equal(good.patch.after.headline, "버튼을 52px로");
assert.deepEqual(good.patch.after.refs, ["D-1"]);
assert.equal(good.patch.after.notes, "결정", "notes stay as they were");
assert.deepEqual(good.patch.before, S.deck["3"]);
assert.match(sg.slidePatchDetail(good.patch), /지금[\s\S]*제목: 버튼을 52px로 키웠다[\s\S]*바꾼 안[\s\S]*제목: 버튼을 52px로\n/);
assert.match(sg.slidePatchDetail(good.patch), /근거: 팀 결정·문제 정의/, "the evidence label is shown with the proposal");

const other = sg.checkSlidePatch(S, template, 3, "simplify", answer([simpler3, { no: 2, headline: "다른 장", visual: { type: "statement", value: "x" } }]));
assert.equal(other.ok, false, "planted: an answer that also rewrites slide 2 is refused whole");
assert.match(other.reason, /다른 장/);
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...simpler3, no: 2 }])).ok, false, "planted: an answer for a different slide is refused");
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([simpler3, simpler3])).ok, false, "planted: a duplicate entry is refused");
const num = sg.checkSlidePatch(S, template, 3, "visual", answer([{ ...simpler3, visual: { type: "number", value: "3명 중 2명", label: "혼자 감" } }]));
assert.equal(num.ok, false, "planted: a number absent from the cited entries");
assert.match(num.reason, /근거에 없는 숫자\(3, 2\)/, "neither 3 nor 2 is a value in the cited entries (52 does not support 2)");
assert.equal(sg.checkSlidePatch(S, template, 3, "visual", answer([{ ...simpler3, support: ["９０% 만족"] }])).ok, false, "planted: a full-width digit counts as a number (NFKC)");
assert.equal(sg.checkSlidePatch(S, template, 3, "highlight", answer([{ ...simpler3, refs: ["E-1", "P"], headline: "어르신이 다음 버튼이 작다고 하심" }])).patch.after.refs.join(), "D-1", "a patch never changes the citations");
assert.equal(sg.checkSlidePatch(S, template, 3, "visual", answer([{ ...simpler3, visual: { type: "quote", value: "정말 편해요", label: "어르신" } }])).ok, false, "planted: an invented quote");
assert.equal(sg.checkSlidePatch(S, template, 2, "highlight", answer([{ no: 2, headline: "작은 버튼이 문제였다", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지" }, support: [] }])).ok, true, "the slide's own quote may stay");
assert.equal(sg.checkSlidePatch(S, template, 3, "visual", answer([{ ...simpler3, visual: { type: "quote", value: "다음 버튼을 52px로 키운다", label: "" } }])).ok, true, "a quote verbatim from the cited entry passes");
assert.equal(sg.checkSlidePatch(S, template, 3, "visual", answer([{ ...simpler3, visual: { type: "quote", value: "다음 버튼을 52px로 키운다", label: "팀장" } }])).ok, false, "planted: a speaker the cited entry does not name");
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...S.deck["3"], no: 3 }])).ok, false, "an unchanged slide is no proposal");
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", null).ok, false, "no usable answer");
assert.equal(sg.checkSlidePatch(S, template, 1, "simplify", answer([{ ...simpler3, no: 1 }])).ok, false, "an undrafted slide");
assert.equal(sg.checkSlidePatch(S, template, 3, "bogus", answer([simpler3])).ok, false, "an unknown chip");
// Bypasses from the first verify (cgp-artr016 verify, fix 1): every one is refused.
const refuse = (no, chip, slide, why) => { const r = sg.checkSlidePatch(S, template, no, chip, answer([slide])); assert.equal(r.ok, false, `planted: ${why} → ${JSON.stringify(r)}`); return r.reason; };
for (const planted of ["٩٠٪ 만족", "۹۰ 명", "९० 명", "๙๐ 명", "九十 퍼센트 만족", "Ⅻ명 시험", "구십 퍼센트", "열 명 중 아홉 명", "９０%", "⁹⁰", "⑨", "5\u200B3명"]) {
  assert.match(refuse(3, "visual", { ...simpler3, support: [planted] }, `number ${planted}`), /근거에 없는 숫자/);
}
assert.match(refuse(3, "visual", { ...simpler3, visual: { type: "number", value: "52px", label: "통계청 조사" } }, "a new source attribution"), /근거에 없는 출처\(통계청/);
assert.match(refuse(3, "simplify", { ...simpler3, support: ["보건복지부 장관 발표"] }, "a source phrase in support"), /근거에 없는 출처/);
assert.match(refuse(2, "highlight", { no: 2, headline: "작은 버튼이 문제였다", visual: { type: "quote", value: "다음 버튼이 작다", label: "보건복지부 장관" }, support: [] }, "the slide's own quote, re-attributed"), /근거에 없는 사람의 말/);
assert.match(refuse(3, "highlight", { ...simpler3, headline: "버튼을 52px로 (E-2)" }, "an evidence id in the headline"), /근거 번호/);
assert.match(refuse(3, "highlight", { ...simpler3, support: ["D－1 결정"] }, "a full-width-dash id in support"), /근거 번호/);
assert.equal(sg.checkSlidePatch(S, template, 2, "highlight", answer([{ no: 2, headline: "작은 버튼이 문제였다", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지, 시험 자리" }, support: [] }])).ok, true, "positive control: the slide's own quote with its own label");
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...simpler3, support: ["한 번에 보이게"] }])).ok, true, "positive control: an idiom is not a number");
// Re-verify bypasses (fix 2, owner decision "no new quantity words"): each phrase invents a quantity slide 3 and D-1 do not have.
const REVERIFY_QUANTITIES = ["절반이 만족", "반이 혼자 감", "반수", "과반", "삼분의 이", "삼분의 일", "구할 만족", "열에 아홉", "열에 일곱", "열 중 아홉", "십중팔구", "십 중 팔구", "오십삼", "다섯", "스물", "이십", "하나 둘 셋", "오십삼 픽셀", "아홉 명꼴", "첫째 시험", "셋째", "첫 번째", "한두 명", "두어 명", "서너 명", "삼사 명", "몇십 명", "수백 명", "five users", "nine of ten", "ninety percent", "fifty-three", "twice as fast", "half of users", "four fifths", "a dozen"];
for (const planted of REVERIFY_QUANTITIES) {
  assert.match(refuse(3, "visual", { ...simpler3, support: [planted] }, `quantity ${planted}`), /근거에 없는 (숫자|수량 표현)/);
}
assert.match(refuse(3, "visual", { ...simpler3, visual: { type: "statement", value: "열에 아홉이 만족" } }, "a statement visual"), /수량 표현/);
assert.match(refuse(3, "visual", { ...simpler3, visual: { type: "steps", items: ["하나", "둘", "셋"] } }, "steps items as number words"), /수량 표현/);
assert.match(refuse(3, "simplify", { ...simpler3, support: ["언론 보도"] }, "보도 is not 보 + particle 도"), /근거에 없는 출처/);
assert.match(refuse(3, "simplify", { ...simpler3, support: ["전문가 의견"] }, "전문가 is not 전문 + particle 가"), /근거에 없는 출처/);
for (const planted of ["세 어르신이 만족", "첫번째 시험", "% 기준"]) assert.match(refuse(3, "visual", { ...simpler3, support: [planted] }, `quantity ${planted}`), /수량 표현/);
assert.deepEqual(sg.unsupportedSources(["보도"], "보 다음 버튼"), ["보도"], "a cited 보 does not support 보도");
assert.deepEqual(sg.unsupportedSources(["전문가"], "전문적인 조언"), ["전문가"], "a cited 전문 does not support 전문가");
assert.deepEqual(sg.unsupportedSources(["언론 보도에"], "언론 보도 내용"), [], "positive control: a cited 보도 with a particle on the face");
assert.match(refuse(3, "simplify", { ...simpler3, support: ["병원 자료"] }, "병원 as a source"), /근거에 없는 출처/);
assert.match(refuse(3, "simplify", { ...simpler3, support: ["유튜브 영상"] }, "유튜브 as a source"), /근거에 없는 출처/);
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...simpler3, headline: "다음 버튼을 52px로 키웠다", support: ["할아버지 말을 듣고"] }])).ok, true, "positive control: a rewrite that keeps the slide's own number passes");
assert.equal(sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...simpler3, headline: "버튼을 크게 바꿨다", support: ["말을 듣고 고침"] }])).ok, true, "positive control: a plain rewording passes");
const SQ = { ...S, deck: { ...S.deck, "3": { ...S.deck["3"], support: ["열에 아홉이 편하대요"] } } };
assert.equal(sg.checkSlidePatch(SQ, template, 3, "simplify", answer([{ ...simpler3, support: ["열에 아홉"] }])).ok, true, "positive control: a quantity word already on the slide may stay");
const dirty = sg.checkSlidePatch(S, template, 3, "simplify", answer([{ ...simpler3, headline: "버튼\u202E을\u2028 52px로\u0007 " + "가".repeat(200) }]));
assert.equal(dirty.ok, true);
assert.ok(!/[\u202E\u2028\u0007]/.test(dirty.patch.after.headline), "bidi, line separators and controls are stripped");
assert.ok([...dirty.patch.after.headline].length <= 80, "length cap");
ok("gate: only the chosen slide, numbers must be in the cited entries (NFKC), no invented quote, citations and notes fixed, hostile text cleaned");

// ── accept / reject on the state ──
const applied = sg.applySlidePatch(S, good.patch);
assert.equal(applied.deck["3"].headline, "버튼을 52px로");
assert.equal(JSON.stringify(applied.deck["2"]), JSON.stringify(S.deck["2"]), "accepting slide 3 leaves slide 2 identical");
assert.equal(S.deck["3"].headline, "버튼을 52px로 키웠다", "the input state is not mutated");
const moved = { ...S, deck: { ...S.deck, "3": { ...S.deck["3"], headline: "학생이 고친 제목" } } };
assert.equal(sg.applySlidePatch(moved, good.patch), null, "planted: the slide changed since the proposal → not applied");
ok("accept changes only that slide and only while it is still the proposal's 'before'");

// ── the real command, with VS Code and the model replaced ──
const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: here, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});
const ws = mkdtempSync(join(tmpdir(), "slide-suggest-"));
let picks = [], modal = [], modalAnswer, executed = [];
const vscode = {
  workspace: { workspaceFolders: [{ uri: { fsPath: ws } }], getConfiguration: () => ({ get: (_k, fallback) => fallback }) },
  Uri: { file: (p) => ({ fsPath: p }) },
  ProgressLocation: { Window: 10 },
  commands: { executeCommand: async (...a) => { executed.push(a); } },
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
    showQuickPick: async (items) => { const want = picks.shift(); return want === undefined ? undefined : items.find(want); },
    showInformationMessage: async (message, opts, ...buttons) => { modal.push({ message, opts, buttons }); return typeof modalAnswer === "function" ? modalAnswer() : modalAnswer; },
    withProgress: async (_o, fn) => fn(),
  },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: (id) => (id === "vscode" ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder, TextDecoder, AbortController, AbortSignal });
const { ChatPanelProvider } = module.exports;

const dir = wiki.wikiDir(ws, PLAN);
const snapshot = () => {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[p.slice(dir.length)] = readFileSync(p).toString("base64"); } };
  walk(dir);
  return out;
};
const seed = () => { rmSync(dir, { recursive: true, force: true }); wiki.saveState(dir, S); wiki.writeFiles(dir, { ...wiki.renderWikiPages(S, PLAN), ...deck.renderDeck(S, template, PLAN) }); };
let model, notices, calls, enabled;
const h = Object.create(ChatPanelProvider.prototype);
Object.assign(h, {
  cachedProfile: { learning_wiki: { enabled: true, plan: PLAN } },
  folderWriteRefusalFor: () => null,
  getSeatAudience: () => "personal",
  postDenialNotice: async () => {},
  postPageNotice: (t) => { notices.push(t); },
  completeSkill: async (p) => { calls.push(p); return model; },
});
Object.defineProperty(h, "cachedProfile", { get: () => ({ learning_wiki: { enabled, plan: PLAN } }) });
const reset = () => { seed(); picks = [(x) => x.no === 3, (x) => x.id === "simplify"]; modal = []; modalAnswer = undefined; executed = []; notices = []; calls = []; enabled = true; model = { ok: true, text: JSON.stringify(answer([simpler3])) }; };

// R1 reject (그대로) and close (Esc → undefined): byte-identical folder
for (const a of ["그대로", undefined]) {
  reset(); modalAnswer = a;
  const before = snapshot();
  await h.deckSlideSuggest();
  assert.equal(modal.length, 1, "the proposal is shown");
  assert.equal(modal[0].opts.modal, true);
  assert.deepEqual(modal[0].buttons, ["반영", "그대로"]);
  assert.match(modal[0].opts.detail, /지금[\s\S]*바꾼 안/);
  assert.deepEqual(snapshot(), before, `${a ?? "closed"}: every file in the wiki folder is byte-identical`);
  assert.match(notices.at(-1), /그대로 두었어요/);
}
ok("host: 그대로 or closing the proposal leaves the wiki folder byte-identical");

// R2 accept (반영): only slide 3 changes; slide 2's files are byte-identical
reset(); modalAnswer = "반영";
let before = snapshot();
await h.deckSlideSuggest();
let after = snapshot();
const st = JSON.parse(readFileSync(join(dir, ".wiki-state.json"), "utf8"));
assert.equal(st.deck["3"].headline, "버튼을 52px로");
assert.equal(JSON.stringify(st.deck["2"]), JSON.stringify(S.deck["2"]));
assert.equal(after["/deck/02.md"], before["/deck/02.md"], "slide 2's page is byte-identical");
assert.notEqual(after["/deck/03.md"], before["/deck/03.md"]);
assert.match(notices.at(-1), /3번 장에 반영했어요/);
assert.equal(calls.length, 1, "one model request");
ok("host: 반영 writes only the chosen slide");

// R3 the model also rewrote slide 2: refused, no proposal shown, nothing written
reset(); model = { ok: true, text: JSON.stringify(answer([simpler3, { no: 2, headline: "다른 장", visual: { type: "statement", value: "x" } }])) }; modalAnswer = "반영";
before = snapshot();
await h.deckSlideSuggest();
assert.equal(modal.length, 0, "no proposal for an answer touching another slide");
assert.deepEqual(snapshot(), before);
assert.match(notices.at(-1), /다른 장까지 고치려 해서/);
ok("host: an answer touching another slide is refused without a proposal");

// R4 the slide changed while the proposal was open: not applied
reset();
modalAnswer = () => { wiki.saveState(dir, { ...S, deck: { ...S.deck, "3": { ...S.deck["3"], headline: "학생이 고친 제목" } } }); return "반영"; };
await h.deckSlideSuggest();
assert.equal(JSON.parse(readFileSync(join(dir, ".wiki-state.json"), "utf8")).deck["3"].headline, "학생이 고친 제목", "the newer slide is kept");
assert.match(notices.at(-1), /그 사이 이 장이 바뀌어서/);
// R5 the switch went off while the proposal was open: nothing written
reset();
modalAnswer = () => { enabled = false; return "반영"; };
before = snapshot();
await h.deckSlideSuggest();
assert.deepEqual(snapshot(), before, "switch off before 반영 → nothing written");
ok("host: a slide changed, or the switch turned off, while the proposal was open is not overwritten");

// R6 a second run while one is in flight is refused; switch off refuses before any model call
reset();
let release;
model = new Promise((r) => { release = () => r({ ok: true, text: JSON.stringify(answer([simpler3])) }); });
h.completeSkill = async (p) => { calls.push(p); return model; };
modalAnswer = "그대로";
const first = h.deckSlideSuggest();
await new Promise((r) => setTimeout(r, 0));
await h.deckSlideSuggest();
assert.match(notices.at(-1), /장을 다듬는 중이에요/);
release(); await first;
assert.equal(calls.length, 1, "the second press started no model request");
reset(); enabled = false; picks = [];
await h.deckSlideSuggest();
assert.equal(calls.length, 0, "switch off: no model call");
assert.equal(modal.length, 0);
ok("host: one run at a time; the learning wiki switch is checked first");

// ── manifest ──
{
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const cmd = pkg.contributes.commands.find((c) => c.command === "hypeproof-chat.deckSlideSuggest");
  assert.equal(cmd.title, "HypeProof: 덱 장 다듬기");
  assert.equal(cmd.enablement, "hypeproof-chat.learningWikiEnabled");
  assert.equal(pkg.contributes.menus.commandPalette.find((m) => m.command === "hypeproof-chat.deckSlideSuggest")?.when, "hypeproof-chat.learningWikiEnabled");
  ok("manifest: 덱 장 다듬기 follows hypeproof-chat.learningWikiEnabled");
}

rmSync(ws, { recursive: true, force: true });
console.log(`\n${passed} slide-suggestion checks passed`);
