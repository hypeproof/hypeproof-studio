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

// ── deck skill: only requested slides, only resolvable references ────────────
const template = PLAN.deck;
const prompt = deck.deckPrompt(s1, template, [2, 3], PLAN);
assert.match(prompt, /2번 "제공 가치"/);
assert.match(prompt, /3번 "해결 원리"/);
assert.ok(!prompt.includes('1번 "문제·기회"'), "only the requested slides are asked for");
const dp = {
  slides: [
    { no: 2, title: "한 단계씩 따라간다", bullets: [{ text: "할아버지가 다음 버튼이 작다고 하셨다", refs: ["E-1"] }, { text: "문제 문장", refs: ["P"] }, { text: "없는 번호", refs: ["E-42"] }], open: ["실제 어르신 3명"] },
    { no: 3, title: "기준물로 말한다", bullets: [{ text: "버튼을 키우기로 했다", refs: ["D-1"] }] },
    { no: 5, title: "요청하지 않은 장", bullets: [{ text: "x", refs: ["E-1"] }] },
  ],
};
const d = deck.applyDeckProposal(s1, template, [2, 3], dp, 2);
assert.deepEqual(d.written, [2, 3], "a slide that was not requested is not written");
assert.deepEqual(d.state.deck["2"].bullets.map((b) => b.refs), [["E-1"], ["P"]], "P is citable once there is a problem; unknown numbers are dropped");
assert.equal(d.dropped.length, 1);
const noProblem = deck.applyDeckProposal({ ...s1, problem: null }, template, [2], { slides: [{ no: 2, title: "t", bullets: [{ text: "문제", refs: ["P"] }] }] }, 2);
assert.deepEqual(noProblem.state.deck["2"].bullets, [], "planted: P without a problem is dropped");
const notInTemplate = deck.applyDeckProposal(s1, template, [9], { slides: [{ no: 9, title: "t", bullets: [{ text: "a", refs: ["E-1"] }] }] }, 2);
assert.deepEqual(notInTemplate.written, [], "planted: a slide outside the template is never written");
ok("deck skill: writes only requested template slides, keeps only sentences citing wiki ids (P only with a problem)");

// ── deck rendering follows the plan; the wiki lists deck drops ───────────────
const sDeck = { ...d.state, sessions: [1, 2] };
const files = deck.renderDeck(sDeck, template, PLAN);
assert.ok(files["deck/01.md"].includes("1주차에 채움"), "an empty slide says when the plan fills it");
assert.match(files["deck/02.md"], /초안 · 2주차/);
assert.match(files["deck.html"], /2 \/ 8장/);
assert.match(files["deck.html"], /dot now" href="#s2"/, "this session's slides are marked");
assert.ok(!files["deck.html"].includes("<script"));
const xss = deck.renderDeck({ ...sDeck, team: "<img src=x onerror=alert(1)>" }, template, PLAN)["deck.html"];
assert.ok(!xss.includes("<img"), "planted: markup in the team name is escaped");
const lines = wiki.lintWiki(sDeck);
assert.ok(lines.some((x) => x.startsWith("덱 02:") && x.endsWith("뺐어요")), lines.join("\n"));
assert.ok(deck.lintDeck(sDeck).some((x) => x.includes("근거(E)·결정(D) 번호 없는 문장")), "a P-only sentence is flagged for evidence");
assert.match(wiki.renderWikiPages(sDeck, PLAN)["log.md"], /인용이 없어 뺀 것/);
ok("deck rendering: template order, plan schedule for empty slides, this session marked, escaped; drops listed in lint and log.md");

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
assert.equal(wiki.loadState(dir).deck["2"].title, "한 단계씩 따라간다");
assert.equal(wiki.initWiki(dir, "다른 팀").team, "A · 어르신 길찾기", "init keeps an existing wiki");
assert.equal(wiki.jsonFromText('앞 {"next": {"text": "a"}} 뒤').next.text, "a");
assert.equal(wiki.jsonFromText("{broken"), null);
ok("coach context carries the next session's question and deck focus; disk: init once, notes archived, state round-trips");

console.log(`\n${passed} learning-wiki checks passed`);
