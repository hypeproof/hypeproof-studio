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
const hz = await import("../src/humanizer.ts");
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

// ── humanizer skill on slides: quotes verbatim, no new numbers, dashes gone ──
{
  const st = { ...s1, deck: { "2": { headline: "단순한 앱이 아니라 혁신적인 길잡이 — 3명 중 2명", visual: { type: "quote", value: "혼자 갈 수 있겠다", label: "경로당 어르신" }, support: ["직접 만남"], notes: "노트", refs: ["E-1"], gaps: [], session: 2 } } };
  const items = deck.slideTextItems(st, [2]);
  assert.ok(!items.some((x) => x.id === "2.value"), "a quote's value is never sent for rewriting");
  const res = hz.applyHumanized(items, { items: [
    { id: "2.headline", text: "어르신 3명 중 2명이 혼자 끝까지 갔다" },
    { id: "2.label", text: "경로당 어르신 5명" },
    { id: "2.support.0", text: "직접 만났다" },
  ] });
  assert.equal(res.items.find((x) => x.id === "2.headline").text, "어르신 3명 중 2명이 혼자 끝까지 갔다");
  assert.equal(res.items.find((x) => x.id === "2.label").text, "경로당 어르신", "planted: a rewrite that adds a number (5) is refused");
  assert.ok(res.rejected.some((x) => x.includes("새 숫자 5")));
  const back = deck.applySlideText(st, res.items);
  assert.equal(back.deck["2"].visual.value, "혼자 갈 수 있겠다", "the quote is untouched");
  assert.equal(back.deck["2"].support[0], "직접 만났다");
  assert.equal(hz.stripDashes("가 — 나 – 다"), "가, 나, 다");
  assert.equal(hz.applyHumanized([{ id: "a", text: "길잡이 — 앱" }], null).items[0].text, "길잡이, 앱", "dashes go even when the model answer fails");
  assert.match(hz.humanizePrompt(items), /대조 구문을 쓰지 않는다/);
  ok("humanizer skill: slide text rewritten without new numbers, quotes verbatim, dashes stripped; failure keeps the original");
}

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

// ── 팀 브레인: the wiki's name, called by name in the chat ─────────────────────
{
  const I = (t, name = "팀 브레인") => wiki.brainIntent(t, name, "주차");
  for (const t of ["팀 브레인에 정리해 줘", "팀 브레인에 저장", "오늘 내용 팀 브레인에 넣어 줘", "팀브레인 정리해줘!", "오늘 수업 팀 브레인에 정리해 주세요 🙏", "팀 브레인에 정리 좀 부탁해", "팀 브레인아 저장해 둬"]) {
    assert.deepEqual(I(t), { kind: "ingest" }, t);
  }
  assert.deepEqual(I("2주차 내용 팀 브레인에 정리해 줘"), { kind: "ingest", session: 2 }, "a session the student names rides along");
  for (const t of ["팀 브레인으로 덱 만들어 줘", "팀 브레인 덱 초안", "팀 브레인으로 이번 주 덱 초안 써 줘", "팀 브레인으로 슬라이드 만들어 줄래?"]) assert.deepEqual(I(t), { kind: "deck" }, t);
  for (const t of ["팀 브레인에 뭐 있어?", "팀 브레인 보여 줘", "팀 브레인 요약해 줘", "팀 브레인", "팀 브레인 덱 보여 줘"]) assert.deepEqual(I(t), { kind: "show" }, t);
  // Planted: a casual mention, the plain word without the name, or a sentence that is not a request must stay a coach turn.
  for (const t of [
    "우리 팀 브레인이 부족한가 봐 ㅋㅋ",
    "오늘 내용 정리해 줘",
    "정리",
    "덱 만들어 줘",
    "브레인스토밍 하자",
    "팀 브레인스토밍 결과 정리해 줘",
    "브레인에 정리해 줘",
    "팀 브레인 정리 기능은 어떻게 써?",
    "팀 브레인에 아직 저장하지 마",
    "팀 브레인에 정리했어?",
    "팀 브레인으로 덱 만들었어?",
    "팀 브레인이 뭐야?",
    "할머니가 버튼이 작대. 팀 브레인에 정리해 줘",
    "팀 브레인에 정리하기 전에 할머니 인터뷰 내용을 먼저 같이 봐 줄래?",
    "팀 브레인에 있는 가설이 맞는지 할머니께 다시 물어볼까?",
  ]) assert.equal(I(t), null, `planted: "${t}" must not trigger`);
  // The plan may rename it; the default is 팀 브레인, and only the served name triggers.
  assert.equal(wiki.brainName(PLAN), "팀 브레인");
  assert.equal(wiki.brainName({ name: " 우리 노트 " }), "우리 노트");
  assert.equal(wiki.brainName({ name: "아주 긴 이름이 스무 글자를 훌쩍 넘어가 버린다" }), "팀 브레인", "planted: an overlong name falls back");
  assert.deepEqual(I("우리 노트에 정리해 줘", "우리 노트"), { kind: "ingest" });
  assert.equal(I("팀 브레인에 정리해 줘", "우리 노트"), null, "with a renamed wiki the default name is a normal message");
  assert.equal(wiki.josa("팀 브레인", "은", "는"), "팀 브레인은");
  assert.equal(wiki.josa("우리 노트", "은", "는"), "우리 노트는");
  assert.equal(wiki.ro("팀 브레인"), "팀 브레인으로");
  assert.equal(wiki.ro("우리 일"), "우리 일로", "ㄹ takes 로");
  // A brain call answered by the App does not use up the coach's first turn.
  assert.equal(wiki.firstCoachTurn([]), true);
  assert.equal(wiki.firstCoachTurn([{ role: "user", content: "팀 브레인에 뭐 있어?" }, { role: "assistant", content: "팀 브레인에 1주차까지 정리돼 있어요." }], "팀 브레인", "주차"), true);
  assert.equal(wiki.firstCoachTurn([{ role: "user", content: "할머니가 버튼이 작대" }, { role: "assistant", content: "…" }], "팀 브레인", "주차"), false);
  // The coach is told, in the model input only, to mention it once with both phrases.
  const intro = wiki.brainIntro(PLAN);
  assert.ok(intro.includes('"팀 브레인에 정리해 줘"') && intro.includes('"팀 브레인으로 덱 만들어 줘"') && intro.includes("이번 주차"), intro);
  assert.ok(intro.split("\n").length <= 2, "one or two lines");
  assert.ok(!wiki.brainIntro({}).includes("덱"), "no deck in the plan: no deck phrase");
  assert.match(wiki.brainIntro({}), /오늘 대화가 저장된다\.\]$/, "the sentence still ends without the deck clause");
  assert.ok(wiki.brainIntro({ name: "우리 일", deck: PLAN.deck }).includes('"우리 일로 덱 만들어 줘"'));
  assert.match(wiki.coachContext(s1, PLAN), /^\[팀 브레인 요약 · A · 어르신 길찾기\]/);
  assert.match(wiki.coachContext(s1, { ...PLAN, name: "우리 노트" }), /^\[우리 노트 요약 · /);
  assert.match(wiki.renderWikiPages(s1, PLAN)["index.md"], /^# 팀 브레인 · A · 어르신 길찾기\n/);
  ok("팀 브레인 by name: ingest/deck/show phrases, casual mentions and plain 정리 do not trigger, plan rename, josa, first coach turn, coach intro");
}

// ── 팀 브레인: which session a chat call files under, and what the student is told ──
{
  assert.deepEqual(wiki.defaultIngestSession(wiki.newState("t"), PLAN, "2026-10-05"), { session: 1, last: 0, ambiguous: false });
  assert.deepEqual(wiki.defaultIngestSession(s1, PLAN, "2026-10-12"), { session: 2, last: 1, ambiguous: false }, "next session, no click");
  assert.deepEqual(wiki.defaultIngestSession(s1, PLAN, "2026-10-05"), { session: 2, last: 1, ambiguous: true }, "session 1 was filed today: ask");
  assert.equal(wiki.defaultIngestSession({ ...s1, sessions: [6], log: ["[2026-10-05] 6주차 | 정리 | x"] }, PLAN, "2026-10-05").ambiguous, false, "at the last session there is nothing to choose");

  const deckLine = deck.deckReport({ written: [1], drafted: 1, total: 8, refused: 0, failed: false });
  assert.equal(deckLine, "덱 1장 초안을 썼어요. 지금 덱 1/8장이에요.");
  assert.equal(deck.deckReport({ written: [2, 3], drafted: 3, total: 8, refused: 1, failed: false }), "덱 2·3장 초안을 썼어요. 지금 덱 3/8장이에요. 근거와 맞지 않은 1장은 올리지 않았어요.");
  assert.equal(deck.deckReport({ written: [], drafted: 1, total: 8, refused: 0, failed: true }), "덱 초안은 쓰지 못했어요. 지금 덱 1/8장이에요.");

  const lines = wiki.ingestReport(s0, r, { session: 1, turns: 2, notes: 1 }, PLAN, { deck: deckLine, opened: "덱 미리보기를 열었어요." });
  assert.deepEqual(lines, [
    "팀 브레인에 정리했어요.",
    "1주차 대화 2턴과 메모 1개에서 문제 정의, 가설 1개, 근거 2개, 결정 1개, 바뀐 것 1개를 더했어요.",
    "새 결정 D-1: 다음 버튼을 키운다.",
    "다음 행동: 실제 어르신 3명에게 보여 드린다.",
    "덱 1장 초안을 썼어요. 지금 덱 1/8장이에요.",
    "대화에서 근거를 찾지 못해 뺀 것 1개는 log.md에 적어 뒀어요.",
    "덱 미리보기를 열었어요.",
  ]);
  const none = wiki.ingestReport(s1, { state: s1, dropped: [], logLine: "", already: false }, { session: 2, turns: 0, notes: 1 }, PLAN);
  assert.deepEqual(none, ["팀 브레인에 정리했어요.", "2주차 메모 1개를 읽었지만 새로 더한 것은 없어요."], "nothing new is said plainly");
  const onlyH = wiki.ingestReport(s0, { ...r, state: { ...s1, D: [], next: null } }, { session: 1, turns: 3, notes: 0 }, PLAN);
  assert.equal(onlyH[2], "새 가설 H-1: 한 단계씩 크게 보이면 혼자 간다.", "without a new decision the newest hypothesis is quoted");

  const empty = wiki.brainSummary(null, PLAN, "venture");
  assert.deepEqual(empty, ["팀 브레인은 아직 비어 있어요.", '수업이 끝날 때 "팀 브레인에 정리해 줘"라고 말하면 오늘 대화를 정리해 둘게요.']);
  const sum = wiki.brainSummary(sDeck, PLAN, "venture");
  assert.equal(sum[0], "팀 브레인에 2주차까지 정리돼 있어요.");
  assert.ok(sum.includes("문제: 어르신이 다음에 어디서 꺾는지 몰라 가족에게 전화한다"), sum.join("\n"));
  assert.ok(sum.includes("가설 H-1 (팀 시험에서만 맞음): 한 단계씩 크게 보이면 혼자 간다"));
  assert.ok(sum.includes("최근 결정: D-1 다음 버튼을 키운다"));
  assert.ok(sum.includes("다음 행동: 실제 어르신 3명에게 보여 드린다"));
  assert.ok(sum.includes("덱: 1/8장"));
  assert.ok(sum.includes("자세한 기록은 venture/ 폴더에 있어요."));
  assert.ok(!wiki.brainSummary(sDeck, undefined, "wiki").some((x) => x.startsWith("덱")), "no deck in the plan: no deck line");
  for (const x of [...lines, ...none, ...sum, ...empty, wiki.brainIntro(PLAN)]) assert.ok(!/[—–]|\*\*/.test(x), `plain copy, no dashes or bold: ${x}`);
  ok("팀 브레인 reports: next session by default (asks only after a same-day filing), counts + newest items + deck n/8 + where to look, summary without a model call");
}

// ── manifest: the renamed commands keep the cohort's switch ──────────────────
{
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const cmd = (id) => pkg.contributes.commands.find((c) => c.command === id);
  assert.equal(cmd("hypeproof-chat.wikiIngest").title, "HypeProof: 팀 브레인에 정리하기");
  assert.equal(cmd("hypeproof-chat.deckDraft").title, "HypeProof: 팀 브레인으로 덱 만들기");
  for (const id of ["hypeproof-chat.wikiIngest", "hypeproof-chat.deckDraft"]) {
    assert.equal(cmd(id).enablement, "hypeproof-chat.learningWikiEnabled", id);
    assert.equal(pkg.contributes.menus.commandPalette.find((m) => m.command === id)?.when, "hypeproof-chat.learningWikiEnabled", id);
  }
  ok("manifest: 팀 브레인 command titles, enablement and palette visibility follow hypeproof-chat.learningWikiEnabled");
}

console.log(`\n${passed} learning-wiki checks passed`);
