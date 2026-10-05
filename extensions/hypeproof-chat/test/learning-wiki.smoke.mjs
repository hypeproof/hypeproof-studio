// Learning wiki and deck generator skills (generic), and the founder plan that specializes them.
// Each check has a positive case and a planted defect that must be caught.
//
// Run: node --experimental-strip-types test/learning-wiki.smoke.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wiki = await import("../src/learningWiki.ts");
const deck = await import("../src/deckGenerator.ts");
const { FOUNDER_AI_FOR_GOOD_V5: PLAN } = await import("../../../worker/src/profiles/plans/founder-ai-for-good-v5.ts");
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const EVENTS = [
  { type: "prompt", turn_id: "a1", text: "우리 팀은 어르신 이동 문제를 골랐어. 할아버지가 보건소 가는 길을 헷갈리셔." },
  { type: "response", turn_id: "a1", text: "어르신이 딱 한 번 하는 행동이 뭐였으면 좋겠어요?" },
  { type: "artifact_snapshot", turn_id: "a1", path: "index.html" },
  { type: "prompt", turn_id: "a2", text: "할아버지께 보여 드렸는데 다음 버튼이 작대." },
  { type: "response", turn_id: "a2", text: "다음 버튼을 키웠어요." },
].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n";

// ── wiki skill: turns, citations, numbering, append-only ──────────────────────
const turns = wiki.turnsFromEvents(EVENTS);
assert.deepEqual(turns.map((t) => t.id), ["t1", "t2"]);
assert.equal(wiki.turnsFromEvents("").length, 0);
const sources = { turns, notes: { "s1-관찰.md": "할아버지가 다음 버튼을 바로 누르심" } };
const proposal = {
  problem: { text: "어르신이 다음에 어디서 꺾는지 몰라 가족에게 전화한다", cite: ["t1"] },
  hypotheses: [{ id: "nH1", text: "한 단계씩 크게 보이면 혼자 간다", cite: ["t1"] }, { id: "nH2", text: "인용 없는 가설", cite: ["t9"] }],
  evidence: [
    { id: "nE1", kind: "외부 반응", state: "real", outcome: "", hypothesis: "nH1", text: "할아버지가 다음 버튼이 작다고 하심", cite: ["t2"] },
    { id: "nE2", kind: "시험", state: "weird", outcome: "match", hypothesis: "nH1", text: "버튼을 바로 누르심", cite: ["s1-관찰.md"] },
  ],
  decisions: [{ id: "nD1", therefore: "다음 버튼을 키운다", ai_choice: "AI 제안 그대로", observed: ["nE1", "E-99"], cite: ["t2"] }],
  changes: [{ text: "다음 버튼 52px", cite: ["t2"] }],
  next: { text: "실제 어르신 3명에게 보여 드린다", cite: ["t2"] },
};
const s0 = wiki.newState("A · 어르신 길찾기");
const sid = wiki.sessionHash(1, sources);
const r = wiki.applyWikiProposal(s0, 1, sources, proposal, sid, "2026-10-05", PLAN);
const s1 = r.state;
assert.deepEqual(s1.H.map((h) => h.id), ["H-1"], "a hypothesis citing nothing real is dropped");
assert.deepEqual(s1.E.map((e) => [e.id, e.hypothesis, e.state]), [["E-1", "H-1", "real"], ["E-2", "H-1", "self_reported"]]);
assert.deepEqual(s1.E[1].cite, ["raw/s1-관찰.md"]);
assert.deepEqual(s1.D[0].observed, ["E-1"]);
assert.match(r.logLine, /1주차 \| 정리/, "the plan's session label is used");
assert.equal(s0.H.length, 0, "the previous state is not mutated");
assert.equal(wiki.applyWikiProposal(s1, 1, sources, proposal, sid, "2026-10-05").already, true, "planted: the same conversation again is refused");
assert.equal(s1.H[0].status, "팀 시험에서만 맞음");
const real = { ...s1.E[1], state: "real" };
assert.equal(wiki.hypothesisStatus(s1.H[0], [s1.E[0], real]), "지지");
assert.equal(wiki.hypothesisStatus(s1.H[0], s1.E.map((e) => ({ ...e, state: "simulated", outcome: "match" }))), "팀 시험에서만 맞음", "planted: simulated matches never support");
ok("wiki skill: cited items only, temp ids numbered, append-only, status needs a real match, the same conversation is not applied twice");

// ── wiki skill without a plan is generic ─────────────────────────────────────
const generic = wiki.applyWikiProposal(s0, 2, sources, proposal, "g", "2026-10-05").state;
const gpages = wiki.renderWikiPages(generic);
assert.match(gpages["sessions/02.md"], /# 2회차 정리/, "no plan: the generic label 회차");
assert.ok(!gpages["index.md"].includes("deck/"), "no plan: no deck line");
assert.ok(!wiki.wikiPrompt(generic, 2, sources).includes("주차"), "no plan: the prompt names no course");
assert.equal(wiki.wikiDir("/ws"), "/ws/wiki");
assert.equal(wiki.wikiDir("/ws", PLAN), "/ws/venture");
assert.equal(wiki.wikiDir("/ws", { dir: "../escape" }), "/ws/wiki", "planted: a plan folder outside the workspace falls back");
const ppages = wiki.renderWikiPages(s1, PLAN);
assert.match(ppages["sessions/01.md"], /# 1주차 정리/);
assert.match(ppages["sessions/01.md"], /이 문제를 겪는 사람은 누구이고/, "the plan's session question");
assert.match(ppages["index.md"], /deck\/ 0 \/ 8장/);
ok("wiki skill is generic: no plan → 회차, folder wiki/, no deck; the founder plan → 주차, venture/, its questions");

// ── deck skill: pitch slides, only requested slides, citations and the numbers rule ──
const template = PLAN.deck;
const prompt = deck.deckPrompt(s1, template, [2, 3], PLAN);
assert.match(prompt, /2번 "제공 가치"/);
assert.match(prompt, /3번 "해결 원리"/);
assert.ok(!prompt.includes('1번 "문제·기회"'), "only the requested slides are asked for");
assert.match(prompt, /주장 하나, 시각 요소 하나/);
const dp = {
  slides: [
    { no: 2, headline: "다음 버튼은 바로 통했다", visual: { type: "quote", value: "다음 버튼이 작다", label: "할아버지, 첫 시험" }, support: ["직접 보여 드림"], notes: "첫 시험에서 들은 말", refs: ["E-1", "E-42"], gaps: ["실제 어르신 3명"] },
    { no: 3, headline: "버튼을 52px로 키웠다", visual: { type: "number", value: "52px", label: "다음 버튼" }, refs: ["D-1"] },
    { no: 5, headline: "요청하지 않은 장", visual: { type: "statement", value: "x" }, refs: ["E-1"] },
  ],
};
const d = deck.applyDeckProposal(s1, template, [2, 3], dp, 2);
assert.deepEqual(d.written, [2], "slide 3 cites D-1, whose text has no 52, so the numbers rule drops it; slide 5 was not requested");
assert.deepEqual(d.state.deck["2"].refs, ["E-1"], "unknown references are removed");
assert.ok(d.dropped.some((x) => x.includes("근거에 없는 숫자 52")), JSON.stringify(d.dropped));
const s1Num = { ...s1, D: [{ ...s1.D[0], therefore: "다음 버튼을 52px로 키운다" }] };
assert.deepEqual(deck.applyDeckProposal(s1Num, template, [3], dp, 2).written, [3], "a number present in the cited entry passes");
assert.deepEqual(deck.applyDeckProposal(s1, template, [2], { slides: [{ no: 2, headline: "근거 없음", refs: ["E-77"] }] }, 2).written, [], "planted: a slide with no resolvable reference is not written");
assert.deepEqual(deck.applyDeckProposal({ ...s1, problem: null }, template, [2], { slides: [{ no: 2, headline: "문제", refs: ["P"] }] }, 2).written, [], "planted: P without a problem is not citable");
assert.deepEqual(deck.applyDeckProposal(s1, template, [9], { slides: [{ no: 9, headline: "t", refs: ["E-1"] }] }, 2).written, [], "planted: a slide outside the template is never written");
assert.equal(deck.applyDeckProposal(s1, template, [2], { slides: [{ no: 2, headline: "h", visual: { type: "hologram" }, refs: ["E-1"] }] }, 2).state.deck["2"].visual.type, "statement", "an unknown visual falls back to a statement");
assert.deepEqual(deck.unsupportedNumbers("3명 중 2명", "세 분 중 두 분"), ["3", "2"]);
assert.deepEqual(deck.applyDeckProposal(s1, template, [2], { slides: [{ no: 2, headline: "h", visual: { type: "quote", value: "말", label: "70대 사용자" }, refs: ["E-1"] }] }, 2).written, [], "planted: an age in a label that the evidence does not state is a made-up number");
assert.match(deck.deckPrompt(s1, template, [1], PLAN), /이 장의 역할: 당사자의 어려움만/, "the plan's slide role reaches the prompt");
assert.match(prompt, /"no": 2[\s\S]*"no": 3/, "the JSON skeleton lists every requested slide");
const missing = deck.applyDeckProposal(s1, template, [2, 3], { slides: [{ no: 2, headline: "h", refs: ["E-1"] }] }, 2);
assert.deepEqual(deck.refusedSlides(missing.dropped), [{ no: 3, reason: "빠짐" }], "a requested slide left out is refused, so the repair asks for it");
assert.deepEqual(deck.refusedSlides(["덱 03: \"x…\" (근거에 없는 숫자 52)", "덱 05: \"y…\" (근거 번호 없음)"]), [{ no: 3, reason: "근거에 없는 숫자 52" }, { no: 5, reason: "근거 번호 없음" }]);
const repair = deck.deckRepairPrompt(s1, template, [{ no: 3, reason: "근거에 없는 숫자 52" }], PLAN);
assert.match(repair, /3번: 근거에 없는 숫자 52/);
assert.ok(!repair.includes('2번 "제공 가치"'), "the repair asks only for the refused slides");
assert.equal(deck.basisLabel(s1, ["E-1"]), "근거: 실제 관찰 1");
assert.equal(deck.basisLabel(s1, ["E-1", "E-2"]), "근거: 실제 관찰 1 · 팀 시험 1", "the basis line comes from the cited evidence, not the model");
assert.equal(deck.basisLabel(s1, ["D-1"]), "근거: 팀 결정·문제 정의");
ok("deck skill: headline + one visual + notes; references must resolve; every on-screen number must be in the cited entries; one repair round; basis computed");

// ── deck rendering: pitch slides for the audience, notes and gaps behind the switch ──
const sDeck = { ...d.state, sessions: [1, 2] };
const files = deck.renderDeck(sDeck, template, PLAN);
assert.ok(files["deck/01.md"].includes("1주차에 채움"), "an undrafted slide says when the plan fills it");
assert.match(files["deck/02.md"], /## 다음 버튼은 바로 통했다/);
assert.match(files["deck.html"], /<h2>다음 버튼은 바로 통했다<\/h2>/);
assert.match(files["deck.html"], /class="v-quote"/);
assert.match(files["deck.html"], /1 \/ 8장/);
assert.match(files["deck.html"], /class="notes notes-only"/, "notes and citations are in the notes layer");
assert.ok(!/<article[^>]*>[\s\S]*?<div class="frame">[\s\S]*?E-1[\s\S]*?<\/div>\s*<aside/.test(files["deck.html"]), "citations are not on the slide face");
assert.ok(!files["deck.html"].includes("<script"), "no script; the notes switch is an inline handler only");
const withProduct = deck.renderDeck({ ...sDeck, deck: { "3": { headline: "써 보세요", visual: { type: "product", label: "길 안내 화면" }, support: [], notes: "", refs: ["E-1"], gaps: [], session: 2 } } }, template, PLAN, "../index.html")["deck.html"];
assert.match(withProduct, /<iframe src="\.\.\/index\.html"/, "the product visual embeds the student's page");
const xss = deck.renderDeck({ ...sDeck, team: "<img src=x onerror=alert(1)>" }, template, PLAN)["deck.html"];
assert.ok(!xss.includes("<img"), "planted: markup in the team name is escaped");
assert.ok(wiki.lintWiki(sDeck).some((x) => x.startsWith("덱 03:") && x.endsWith("뺐어요")), wiki.lintWiki(sDeck).join("\n"));
assert.match(wiki.renderWikiPages(sDeck, PLAN)["log.md"], /인용이 없어 뺀 것/);
ok("deck rendering: 16:9 pitch slides in template order, quote/number/product visuals, notes·근거 behind a switch, escaped");

// ── coach context and disk round trip ────────────────────────────────────────
const ctx = wiki.coachContext(s1, PLAN);
assert.match(ctx, /지난 주차에 무엇을 시험했고/);
assert.match(ctx, /2주차/);
assert.match(ctx, /집중할 덱 장: 2 제공 가치, 3 해결 원리/, "the next session's focus comes from the plan");
assert.ok(!wiki.coachContext(s1).includes("덱 장"), "no plan: no deck focus");
const dir = wiki.wikiDir(mkdtempSync(join(tmpdir(), "lw-")), PLAN);
assert.equal(wiki.initWiki(dir, "A · 어르신 길찾기", PLAN).format, "hps-learning-wiki/1");
assert.ok(existsSync(join(dir, "notes")) && existsSync(join(dir, "index.md")));
writeFileSync(join(dir, "notes", "s1-관찰.md"), "할아버지가 다음 버튼을 바로 누르심");
writeFileSync(join(dir, "notes", "ignore.png"), "x");
assert.deepEqual(Object.keys(wiki.readNotes(dir)), ["s1-관찰.md"]);
wiki.archiveNotes(dir, wiki.readNotes(dir));
assert.deepEqual(Object.keys(wiki.readNotes(dir)), [], "an ingested note leaves notes/");
writeFileSync(join(dir, "notes", "s1-관찰.md"), "다른 날 같은 이름");
wiki.archiveNotes(dir, wiki.readNotes(dir));
assert.equal(readFileSync(join(dir, "raw", "s1-관찰.md"), "utf8"), "할아버지가 다음 버튼을 바로 누르심", "planted: a same-name note must not overwrite the cited raw file");
wiki.saveState(dir, sDeck);
wiki.writeFiles(dir, { ...wiki.renderWikiPages(sDeck, PLAN), ...deck.renderDeck(sDeck, template, PLAN) });
assert.equal(wiki.loadState(dir).deck["2"].headline, "다음 버튼은 바로 통했다");
assert.equal(wiki.initWiki(dir, "다른 팀").team, "A · 어르신 길찾기", "init keeps an existing wiki");
assert.equal(wiki.jsonFromText('앞 {"next": {"text": "a"}} 뒤').next.text, "a");
assert.equal(wiki.jsonFromText("{broken"), null);
writeFileSync(join(dir, "..", "index.html"), "<html><head><title>길 안내</title></head></html>");
assert.equal(wiki.productTitle(join(dir, "..")), "길 안내");
assert.equal(wiki.productTitle("/nonexistent"), null);
ok("coach context carries the next session's question and deck focus; disk: init once, notes archived, state round-trips");

console.log(`\n${passed} learning-wiki checks passed`);
