// REQ-STUDIO-LEARNING-BLOCK-TEXT (CGP-LEARN-R-003, REQ-CGP-LEARN-03 (a)) — the block catalog's text equivalents. Every one
// of the seven block kinds has a Korean title, a controls help sentence and a state sentence, and the catalog check
// (`materialTextGaps`) names any kind that lacks one (negative controls). The state sentence of each drawable block is a
// different sentence for every state the learner can put it in, so a change of state always changes the words.
// The rendered behaviour (a polite live region updated within 500 ms) is held by learning-block-text-browser.smoke.mjs.
import assert from "node:assert/strict";
import { MATERIAL_KINDS, MATERIAL_TEXT, materialTextGaps } from "../src/lessonFocus.ts";

// (a) positive control: the shipped catalog has no gap.
assert.deepEqual(materialTextGaps(), [], "every block kind has a title, a controls help sentence and a state sentence");
assert.deepEqual(Object.keys(MATERIAL_TEXT).sort(), [...MATERIAL_KINDS].sort(), "the catalog covers exactly the seven kinds");

// Negative controls: the check must catch each missing or empty field, and English-only words.
const broken = (kind, patch) => ({ ...MATERIAL_TEXT, [kind]: patch === null ? undefined : { ...MATERIAL_TEXT[kind], ...patch } });
assert.deepEqual(materialTextGaps(broken("metric_board", null)), ["metric_board: missing"]);
assert.deepEqual(materialTextGaps(broken("criterion_form", { title: "" })), ["criterion_form: title"]);
assert.deepEqual(materialTextGaps(broken("decision_form", { controlsHelp: "Type and save." })), ["decision_form: controlsHelp"]);
assert.deepEqual(materialTextGaps(broken("evidence_note", { state: () => ({ key: "x", sentence: " " }) })), ["evidence_note: stateDescription"]);
assert.deepEqual(materialTextGaps(broken("coach_request", { state: undefined })), ["coach_request: stateDescription"]);

// No judgment, score or capability word in any block text (REQ-CGP-LEARN-02, SX-35).
const BANNED = /점수|등급|정답|오답|맞았|틀렸|잘했|우수|미흡|FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP/;
const all = [];
for (const kind of MATERIAL_KINDS) {
  const c = MATERIAL_TEXT[kind];
  all.push(c.title, c.controlsHelp, c.state({ text: "", reason: "" }).sentence);
}

// Each drawable block: every reachable state has its own sentence; same input gives the same sentence.
const saved = { text: "버튼이 보인다", reason: "선생님이 확인함" };
const CASES = {
  criterion_form: [
    ["empty", { text: "", reason: "" }],
    ["written", { text: "버튼", reason: "" }],
    ["saved", { text: "버튼이 보인다", reason: "", saved: { text: "버튼이 보인다" } }],
    ["saved", { text: "  버튼이 보인다 ", reason: "", saved: { text: "버튼이 보인다" } }],
    ["edited", { text: "버튼이 크다", reason: "", saved: { text: "버튼이 보인다" } }],
    ["cleared", { text: "  ", reason: "", saved: { text: "버튼이 보인다" } }],
  ],
  decision_form: [
    ["empty", { text: "", reason: "" }],
    ["need-reason", { text: "고친다", reason: "" }],
    ["need-decision", { text: "", reason: "왜냐하면" }],
    ["written", { text: "고친다", reason: "왜냐하면" }],
    ["saved", { text: saved.text, reason: saved.reason, saved }],
    ["edited", { text: saved.text, reason: "다른 이유", saved }],
    ["edited", { text: "다른 결정", reason: saved.reason, saved }],
    ["need-reason", { text: saved.text, reason: "", saved }],
    ["need-decision", { text: "", reason: saved.reason, saved }],
    ["cleared", { text: "", reason: "", saved }],
  ],
};
for (const [kind, cases] of Object.entries(CASES)) {
  const byKey = new Map();
  for (const [key, input] of cases) {
    const s = MATERIAL_TEXT[kind].state(input);
    assert.equal(s.key, key, `${kind} ${JSON.stringify(input)}`);
    assert.ok(/[가-힣]/.test(s.sentence), `${kind} ${key}: Korean sentence`);
    // An incomplete form says whether an earlier save is kept, so "with an earlier save" is its own state.
    const state = key + (input.saved && !["saved", "edited", "cleared"].includes(key) ? " (earlier save kept)" : "");
    if (byKey.has(state)) assert.equal(byKey.get(state), s.sentence, `${kind} ${state}: one sentence per state`);
    byKey.set(state, s.sentence);
    all.push(s.sentence);
  }
  const sentences = [...byKey.values()];
  assert.equal(new Set(sentences).size, sentences.length, `${kind}: every state has its own words ${JSON.stringify([...byKey])}`);
}
// A decision saved earlier but now incomplete says the earlier save is kept (it is: the host still holds it).
assert.match(MATERIAL_TEXT.decision_form.state({ text: "x", reason: "", saved }).sentence, /그대로 있어요/);
assert.doesNotMatch(MATERIAL_TEXT.decision_form.state({ text: "x", reason: "" }).sentence, /그대로 있어요/);
for (const s of all) assert.doesNotMatch(s, BANNED, `no judgment or capability word: ${s}`);

console.log(`PASS learning-block-text: ${MATERIAL_KINDS.length} kinds with title, controls help and state sentence; 5 negative controls caught; ${Object.values(CASES).flat().length} state cases`);
