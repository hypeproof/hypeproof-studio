// Venture Memory, local wiki (founder course): the pure module the "이번 수업 정리하기" command runs.
// Each check has a positive case and a planted defect that must be caught.
//
// Run: node --experimental-strip-types test/venture-memory.smoke.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const vm = await import("../src/ventureMemory.ts");
let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const EVENTS = [
  { type: "prompt", turn_id: "a1", text: "우리 팀은 어르신 이동 문제를 골랐어. 할아버지가 보건소 가는 길을 헷갈리셔." },
  { type: "response", turn_id: "a1", text: "어르신이 딱 한 번 하는 행동이 뭐였으면 좋겠어요?" },
  { type: "artifact_snapshot", turn_id: "a1", path: "index.html" },
  { type: "prompt", turn_id: "a2", text: "할아버지께 보여 드렸는데 다음 버튼이 작대." },
  { type: "response", turn_id: "a2", text: "다음 버튼을 키웠어요." },
].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n";

// ── turnsFromEvents ──────────────────────────────────────────────────────────
const turns = vm.turnsFromEvents(EVENTS);
assert.deepEqual(turns.map((t) => t.id), ["t1", "t2"], "turns renumbered in order");
assert.equal(turns[0].student.startsWith("우리 팀은"), true);
assert.equal(turns[1].coach, "다음 버튼을 키웠어요.");
assert.equal(vm.turnsFromEvents("").length, 0, "an empty spool has no turns");
ok("turnsFromEvents: prompt/response pairs per turn, renumbered t1…, other events and bad lines ignored");

// ── applyProposal: citations, numbering, append-only ─────────────────────────
const sources = { turns, notes: { "w1-관찰.md": "할아버지가 다음 버튼을 바로 누르심" } };
const proposal = {
  problem: { text: "어르신이 다음에 어디서 꺾는지 몰라 가족에게 전화한다", cite: ["t1"] },
  hypotheses: [{ id: "nH1", text: "한 단계씩 크게 보이면 혼자 간다", cite: ["t1"] }, { id: "nH2", text: "인용 없는 가설", cite: ["t9"] }],
  evidence: [
    { id: "nE1", kind: "외부 반응", state: "real", outcome: "", hypothesis: "nH1", text: "할아버지가 다음 버튼이 작다고 하심", provenance: "할아버지, 1주차", cite: ["t2"] },
    { id: "nE2", kind: "시험", state: "weird", outcome: "match", hypothesis: "nH1", text: "버튼을 바로 누르심", cite: ["w1-관찰.md"] },
  ],
  decisions: [{ id: "nD1", therefore: "다음 버튼을 키운다", ai_choice: "AI 제안 그대로", observed: ["nE1", "E-99"], cite: ["t2"] }],
  changes: [{ text: "다음 버튼 52px", cite: ["t2"] }],
  next: { text: "실제 어르신 3명에게 보여 드린다", cite: ["t2"] },
  slides: [
    { no: 1, title: "어르신은 어디서 꺾어야 할지 모른다", bullets: [{ text: "할아버지가 길을 헷갈리신다", refs: ["nE1"] }, { text: "번호 없는 문장", refs: ["E-77"] }], open: ["실제 어르신 반응"] },
    { no: 4, title: "이번 주가 아닌 장", bullets: [{ text: "x", refs: ["nE1"] }] },
  ],
};
const s0 = vm.newState("A · 어르신 길찾기");
const sid = vm.sessionHash(1, sources);
const r = vm.applyProposal(s0, 1, sources, proposal, sid, "2026-10-05");
const s1 = r.state;
assert.equal(s1.problem.text.includes("가족에게 전화"), true);
assert.deepEqual(s1.H.map((h) => h.id), ["H-1"], "a hypothesis citing nothing real is dropped");
assert.deepEqual(s1.E.map((e) => [e.id, e.hypothesis, e.state]), [["E-1", "H-1", "real"], ["E-2", "H-1", "self_reported"]], "temp ids resolve; an unknown state falls back to self_reported");
assert.deepEqual(s1.E[1].cite, ["raw/w1-관찰.md"], "a note citation points at raw/");
assert.deepEqual(s1.D[0].observed, ["E-1"], "a decision keeps only evidence that exists");
assert.deepEqual(Object.keys(s1.deck), ["1"], "only this week's slides are written (week 1 → slide 1)");
assert.deepEqual(s1.deck["1"].bullets.map((b) => b.refs), [["E-1"]], "a deck sentence with no resolvable number is dropped");
const withP = vm.applyProposal(s0, 1, sources, { ...proposal, slides: [{ no: 1, title: "t", bullets: [{ text: "문제 문장", refs: ["P"] }] }] }, "p1", "2026-10-05").state;
assert.deepEqual(withP.deck["1"].bullets.map((b) => b.refs), [["P"]], "the problem can be cited as P once there is a problem");
const noP = vm.applyProposal(s0, 1, sources, { slides: [{ no: 1, title: "t", bullets: [{ text: "문제 문장", refs: ["P"] }] }] }, "p2", "2026-10-05").state;
assert.deepEqual(noP.deck["1"].bullets, [], "planted: P without a problem is dropped");
assert.ok(r.dropped.some((d) => d.startsWith("가설")) && r.dropped.some((d) => d.startsWith("덱 01")), JSON.stringify(r.dropped));
assert.equal(s0.H.length, 0, "the previous state is not mutated");
// Planted defect: the same session again is refused, nothing is added.
const again = vm.applyProposal(s1, 1, sources, proposal, sid, "2026-10-05");
assert.equal(again.already, true);
assert.equal(again.state.E.length, 2);
ok("applyProposal: uncited items and unresolved deck references are dropped and listed; temp ids become H-/E-/D- numbers; the same session is not applied twice");

// ── hypothesis status: supported only with a real match ──────────────────────
assert.equal(s1.H[0].status, "팀 시험에서만 맞음", "the only match is a team test (E-2), so not supported");
const s2 = vm.applyProposal(s1, 2, { turns: [{ id: "t1", student: "경로당 어르신 두 분 중 한 분이 끝까지 가셨어. 기준에 맞았어." }], notes: {} }, {
  evidence: [{ id: "nE1", kind: "외부 반응", state: "real", outcome: "match", hypothesis: "H-1", text: "어르신 한 분이 끝까지 가심", cite: ["t1"] }],
}, "s2", "2026-10-12").state;
assert.equal(s2.H[0].status, "지지", "a real observation judged a match supports it");
const planted = { ...s2.H[0] };
assert.equal(vm.hypothesisStatus(planted, s2.E.map((e) => ({ ...e, state: "simulated" }))), "팀 시험에서만 맞음", "planted: the same matches marked simulated must not support it");
ok("hypothesis status: 열림 → 팀 시험에서만 맞음 → 지지 only after a real match; simulated matches never support");

// ── lint, pages, deck ────────────────────────────────────────────────────────
const issues = vm.lint(s1);
assert.ok(issues.some((x) => x.includes("H-1") && x.includes("팀 시험에서만")), issues.join("\n"));
assert.ok(issues.some((x) => x.includes("E-1") && x.includes("판정")), "a real reaction with no judgement is listed");
const files = vm.renderWiki(s1);
for (const k of ["venture.md", "hypotheses.md", "evidence.md", "decisions.md", "weeks/w1.md", "deck/01.md", "deck/08.md", "log.md", "deck.html"]) assert.ok(k in files, k);
assert.match(files["deck/01.md"], /초안 · 1주차/);
assert.match(files["log.md"], /인용이 없어 뺀 것/, "log.md lists what was dropped (the command's notice points there)");
assert.match(files["deck/02.md"], /2주차에 채움/);
assert.match(files["deck.html"], /주간 팩 1주차/);
assert.ok(!files["deck.html"].includes("<script"), "the weekly pack has no script");
assert.match(files["deck.html"], /&lt;|어르신/, "text is escaped and present");
const xss = vm.deckHtml({ ...s1, team: "<img src=x onerror=alert(1)>" });
assert.ok(!xss.includes("<img"), "planted: markup in the team name is escaped");
ok("lint and pages: every page renders, the deck follows v5 order, the weekly pack is script-free and escapes text");

// ── disk round trip, notes, proposal parsing, coach context ──────────────────
const dir = join(mkdtempSync(join(tmpdir(), "vm-")), "venture");
const init = vm.initWiki(dir, "A · 어르신 길찾기");
assert.equal(init.course, "founder-ai-for-good");
assert.ok(existsSync(join(dir, "notes")) && existsSync(join(dir, "deck.html")));
writeFileSync(join(dir, "notes", "w1-관찰.md"), "할아버지가 다음 버튼을 바로 누르심");
writeFileSync(join(dir, "notes", "ignore.png"), "x");
assert.deepEqual(Object.keys(vm.readNotes(dir)), ["w1-관찰.md"], "only .md/.txt notes are read");
vm.writeWiki(dir, s1);
vm.archiveNotes(dir, sources.notes);
assert.equal(readFileSync(join(dir, "raw", "w1-관찰.md"), "utf8"), "할아버지가 다음 버튼을 바로 누르심");
assert.deepEqual(Object.keys(vm.readNotes(dir)), [], "an ingested note leaves notes/, so next week reads only new notes");
writeFileSync(join(dir, "notes", "w1-관찰.md"), "다른 날 같은 이름 메모");
vm.archiveNotes(dir, vm.readNotes(dir));
assert.equal(readFileSync(join(dir, "raw", "w1-관찰.md"), "utf8"), "할아버지가 다음 버튼을 바로 누르심", "planted: a same-name note must not overwrite the cited raw file");
assert.equal(readFileSync(join(dir, "raw", "w1-관찰-2.md"), "utf8"), "다른 날 같은 이름 메모");
assert.equal(vm.loadState(dir).E.length, 2);
assert.equal(vm.initWiki(dir, "다른 팀").team, "A · 어르신 길찾기", "init keeps an existing wiki");
assert.deepEqual(vm.proposalFromText('설명 {"next": {"text": "a", "cite": ["t1"]}} 끝').next.text, "a");
assert.equal(vm.proposalFromText("JSON 없음"), null);
assert.equal(vm.proposalFromText("{broken"), null);
const ctx = vm.coachContext(s1);
assert.match(ctx, /지난주에 무엇을 시험했고/);
assert.match(ctx, /2주차/, "the next week's question");
const prompt = vm.ingestPrompt(s1, 2, sources);
assert.match(prompt, /2번 "제공 가치"/);
assert.match(prompt, /3번 "해결 원리"/);
ok("disk: init once, notes read and archived, state round-trips; proposal parsing tolerates prose; coach context and the week-2 prompt");

console.log(`\n${passed} venture-memory checks passed`);
