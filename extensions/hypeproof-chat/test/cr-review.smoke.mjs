// The Weekly Review panel, App side (cr-review #1398): the session over a stub Service (the
// student's "Prepare Weekly Review" and the director's overview, pack and decision), the
// director's form checks, the webview's decision press (webview-ui/src/reviewPanelState.ts and
// App's wiring of it), the timing verdict (CR-62) and the panel rendered for real
// (test/sx-render.mjs). Every check has a planted defect that must be caught. The same flows
// against the real Service router run in worker/test/cr-review.test.mjs; the director's write
// and the reopen in the app are e2e/curriculum-runtime/review-app.spec.ts (CR-T48).
//
// Run: node --experimental-strip-types test/cr-review.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReviewSession, directorAvailable } from "../src/reviewSession.ts";
import { REVIEW_SECTION_IDS, directorFormProblems, packChoices, regenerationVerdict, sectionTitle, suggestedNext, timingLine } from "../src/reviewView.ts";
import { pressDecision, reviewPanelReducer } from "../webview-ui/src/reviewPanelState.ts";
import { rendererStatus, renderComponent, visibleText } from "./sx-render.mjs";

let passed = 0;
const ok = (n) => {
  passed++;
  console.log(`✓ ${n}`);
};

const EV = (id) => `ev:exp-1/drf-1/${id}`;
const SECTION = (id, items, notes = [], extra = {}) => ({ id, digest: "sha256:" + "1".repeat(64), generated_at: 1, generated_in: 1, items, notes, ...extra });
const PACK = {
  project_id: "prj-1",
  week: 2,
  revision: 3,
  prepared_at: Date.UTC(2026, 9, 5, 1, 0),
  prepared_by: "cr-a",
  sections: [
    SECTION("hypothesis", [{ class: "record", text: "가설: 처음 쓰는 사람도 혼자 주문할 수 있다 · 아직 확인 중", sources: ["hypothesis:hyp-1@1"] }]),
    SECTION("experiment", [{ class: "record", text: "질문: 도움 없이 주문을 마칠 수 있나? · 방법: 과제 해 보기 · 진행 중", sources: ["experiment:exp-1"] }]),
    SECTION("observed", [
      { class: "observed", text: "세 명 중 두 명이 옵션 선택에서 멈췄다", sources: [EV("o1")] },
      { class: "observed", text: "AI가 센 관찰", sources: [EV("o9")], marks: ["unreviewed"] },
    ]),
    SECTION("interpretation", [{ class: "interpreted", text: "옵션 단계가 너무 많다", sources: [EV("i1")], marks: ["ai_written"] }]),
    SECTION("product_change", [], ["실험한 뒤로 새 버전은 없어요."]),
    SECTION("metrics", [], ["정한 지표가 없어요."]),
    SECTION("deck_slides", [{ class: "record", text: '슬라이드 2 (문제): 팀 결정 "옵션 선택을 한 단계로 줄인다"', sources: ["decision:dec-1"] }], ["아직 제안된 슬라이드 수정이 없어요."], { proposals: [] }),
    SECTION("assumptions", [{ class: "assumed", text: "사용자는 한 단계면 혼자 주문한다", sources: [EV("a1")] }]),
    SECTION("decision_needed", [{ class: "agenda", text: '가설 "처음 쓰는 사람도 혼자 주문할 수 있다"을(를) 그대로 둘지, 고칠지, 버릴지 정하기 (관찰한 것 2개)', sources: ["hypothesis:hyp-1@1", EV("o1")] }]),
    SECTION("next_experiment", [{ class: "ai_suggestion", text: "가설: 옵션이 한 단계면 5명 중 3명이 혼자 주문한다", sources: [EV("a1")] }], ["AI가 기록을 보고 만든 제안이에요. 다음 실험은 디렉터와 팀이 정해요."], {
      skill: "experiment@1.0.0",
      suggestion: { assumption: "사용자는 한 단계면 혼자 주문한다", assumption_ref: EV("a1"), hypothesis: "옵션이 한 단계면 5명 중 3명이 혼자 주문한다", method: "task_test", procedure: ["v1을 공개한다"], success_criteria: ["5명 중 3명이 혼자 주문을 마친다"] },
    }),
  ],
};
const SOURCES = {
  "hypothesis:hyp-1@1": { ref: "hypothesis:hyp-1@1", kind: "hypothesis", found: true, label: "처음 쓰는 사람도 혼자 주문할 수 있다", lines: ["1번째 기록 · 아직 확인 중"] },
  [EV("o1")]: { ref: EV("o1"), kind: "evidence_item", found: true, label: "세 명 중 두 명이 옵션 선택에서 멈췄다", lines: ["확인한 것 · 검토함", "메모 note-1"] },
  [EV("o9")]: { ref: EV("o9"), kind: "evidence_item", found: false, label: "찾을 수 없는 기록이에요 (지워졌거나 바뀌었어요)", lines: [] },
};
const REVIEW = { project_id: "prj-1", project_title: "키오스크 실험", week: 2, status: "stale", stale_sections: ["observed", "next_experiment"], pack: PACK, sources: SOURCES, decisions: [], drafts: [], weeks: [{ week: 2, revision: 3, prepared_at: 1 }] };

/** A stub Service answering by `METHOD /path`; every call is recorded with its token and body. */
const stub = (answers, calls) => async (url, init) => {
  const u = new URL(url);
  const key = `${init?.method ?? "GET"} ${u.pathname.replace(/^\/v1\/curriculum/, "")}`;
  calls.push({ key, token: String(init?.headers?.authorization ?? "").replace(/^Bearer /, ""), body: init?.body ? JSON.parse(init.body) : undefined, search: u.search });
  const queue = answers[key];
  const a = Array.isArray(queue) ? queue.shift() : queue;
  if (!a) return new Response(JSON.stringify({ error: { type: "not_found" } }), { status: 404, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify(a.body ?? a), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
};
const PREPARE = (over = {}) => ({ week: 2, base_revision: 3, status: "stale", stale_sections: ["observed", "next_experiment"], model_sections: [{ section: "next_experiment", headers: { "x-hps-skill": "experiment@1.0.0", "x-hps-capability": "reasoning.high" }, prompt: "## Skill\nexperiment@1.0.0", input_digest: "sha256:" + "d".repeat(64) }], ...over });
const ANSWER = "```json\n" + JSON.stringify({ assumption: "a", why_riskiest: "b", hypothesis: "c", method: "task_test", procedure: ["d"], success_criteria: ["5명 중 3명"] }) + "\n```";

function make(answers, opts = {}) {
  const calls = [];
  const completions = [];
  const session = new ReviewSession({
    switchOn: () => opts.on ?? true,
    token: async () => (opts.token === undefined ? "student-tok" : opts.token),
    directorToken: async () => opts.director ?? null,
    base: () => "https://svc.test/v1/curriculum",
    projectId: () => "prj-1",
    fetchImpl: stub(answers, calls),
    complete: async (prompt, headers) => {
      completions.push({ prompt, headers });
      return opts.complete ? opts.complete(prompt, headers) : { ok: true, text: ANSWER, model: "hypeproof-default" };
    },
  });
  return { session, calls, completions };
}

// ── The student: views and "Prepare Weekly Review" ──────────────────────────────
{
  const off = make({}, { on: false });
  assert.equal((await off.session.studentView()).available, false);
  assert.deepEqual(await off.session.prepare(), { ok: false, message: "이 수업에서는 주간 리뷰를 쓸 수 없어요." });
  assert.deepEqual([off.calls.length, off.completions.length], [0, 0], "switch off: nothing sent, no model call");
  const signedOut = make({}, { token: null });
  assert.equal((await signedOut.session.studentView()).notice, "참여 코드를 먼저 입력해 주세요.");
  assert.equal(signedOut.calls.length, 0);

  const read = make({ "GET /projects/prj-1/review": { review: REVIEW } });
  const v = await read.session.studentView();
  assert.deepEqual([v.mode, v.available, v.review.status], ["student", true, "stale"]);
  assert.deepEqual(read.calls.map((c) => c.key), ["GET /projects/prj-1/review"]);
  assert.equal(read.completions.length, 0, "opening asks no model");

  // A stale model section: one model call with the skill's metadata, then the commit.
  const prep = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE() }, "POST /projects/prj-1/review/commit": { status: 201, body: { regenerated: ["observed", "next_experiment"] } } });
  assert.deepEqual(await prep.session.prepare(), { ok: true, regenerated: ["observed", "next_experiment"], unchanged: false });
  assert.equal(prep.completions.length, 1);
  assert.deepEqual(prep.completions[0].headers, { "x-hps-skill": "experiment@1.0.0", "x-hps-capability": "reasoning.high" });
  const commit = prep.calls.find((c) => c.key === "POST /projects/prj-1/review/commit").body;
  assert.deepEqual([commit.week, commit.base_revision, commit.outputs.next_experiment.input_digest, commit.outputs.next_experiment.model], [2, 3, "sha256:" + "d".repeat(64), "hypeproof-default"]);
  assert.equal(commit.outputs.next_experiment.output.method, "task_test");
  assert.equal(typeof commit.timing.total_ms, "number");
  assert.equal(prep.calls[0].token, "student-tok", "the student token, never the issuer's");
  assert.equal((await prep.session.studentView()).timing?.verdict ?? "pass", "pass");

  // Fresh: nothing is asked and nothing is committed.
  const fresh = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE({ status: "fresh", stale_sections: [], model_sections: [] }) } });
  assert.deepEqual(await fresh.session.prepare(), { ok: true, regenerated: [], unchanged: true });
  assert.deepEqual([fresh.completions.length, fresh.calls.map((c) => c.key)], [0, ["POST /projects/prj-1/review/prepare"]]);
  // Only facts stale: committed with no model call.
  const facts = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE({ stale_sections: ["metrics"], model_sections: [] }) }, "POST /projects/prj-1/review/commit": { status: 201, body: { regenerated: ["metrics"] } } });
  assert.deepEqual((await facts.session.prepare()).regenerated, ["metrics"]);
  assert.equal(facts.completions.length, 0, "a fact section costs no model call");
  assert.deepEqual(facts.calls.at(-1).body.outputs, {});
  // Records changed between the two calls after the model was asked: the press ends there, so one
  // press makes one model call (MU-02, decision 2: retry bound 0); the next press asks again.
  const race = make({ "POST /projects/prj-1/review/prepare": [{ body: PREPARE() }, { body: PREPARE({ base_revision: 4 }) }], "POST /projects/prj-1/review/commit": [{ status: 409, body: { error: { code: "inputs_changed" } } }, { status: 201, body: { regenerated: ["next_experiment"] } }] });
  assert.deepEqual(await race.session.prepare(), { ok: false, message: "준비하는 동안 기록이 바뀌었어요. 다시 준비해 주세요." });
  assert.deepEqual([race.completions.length, race.calls.filter((c) => c.key.endsWith("/commit")).length], [1, 1], "one press, one model call, one commit");
  assert.equal((await race.session.prepare()).ok, true);
  assert.deepEqual([race.completions.length, race.calls.filter((c) => c.key.endsWith("/commit")).map((c) => c.body.base_revision)], [2, [3, 4]], "the next press asks again");
  // A race on the facts alone, before any model call: the press starts over once by itself.
  const factRace = make({ "POST /projects/prj-1/review/prepare": [{ body: PREPARE({ stale_sections: ["metrics"], model_sections: [] }) }, { body: PREPARE({ base_revision: 4, stale_sections: ["metrics"], model_sections: [] }) }], "POST /projects/prj-1/review/commit": [{ status: 409, body: { error: { code: "review_changed" } } }, { status: 201, body: { regenerated: ["metrics"] } }] });
  assert.deepEqual(await factRace.session.prepare(), { ok: true, regenerated: ["metrics"], unchanged: false });
  assert.deepEqual([factRace.completions.length, factRace.calls.filter((c) => c.key.endsWith("/commit")).map((c) => c.body.base_revision)], [0, [3, 4]]);
  // The model fails or answers no JSON: the facts are still committed, the reason is shown.
  const failing = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE() }, "POST /projects/prj-1/review/commit": { status: 201, body: { regenerated: ["observed"] } } }, { complete: async () => ({ ok: false }) });
  assert.equal((await failing.session.prepare()).ok, true);
  assert.deepEqual(failing.calls.at(-1).body.outputs, {}, "no output is invented for a failed model call");
  assert.deepEqual(failing.session.lastRefusal(), ["model_failed"]);
  const prose = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE() }, "POST /projects/prj-1/review/commit": { status: 201, body: { regenerated: ["observed"] } } }, { complete: async () => ({ ok: true, text: "죄송해요" }) });
  await prose.session.prepare();
  assert.deepEqual(prose.session.lastRefusal(), ["not_json"]);
  // The gate refused the answer: its problems are what the panel shows.
  const gated = make({ "POST /projects/prj-1/review/prepare": { body: PREPARE() }, "POST /projects/prj-1/review/commit": { status: 201, body: { regenerated: ["observed"], refused: { next_experiment: { problems: ["experiment_criteria_countable $.success_criteria[0]: not_countable"] } } } } });
  await gated.session.prepare();
  assert.match(gated.session.lastRefusal()[0], /not_countable/);
  // Planted defect: a session that asks the model even when the pack is fresh is caught by the same count.
  class Eager extends ReviewSession {
    async prepare() {
      await this["ports"].complete("x", {});
      return super.prepare();
    }
  }
  const eagerCalls = [];
  const eager = new Eager({ switchOn: () => true, token: async () => "t", directorToken: async () => null, base: () => "https://svc.test/v1/curriculum", projectId: () => "prj-1", fetchImpl: stub({ "POST /projects/prj-1/review/prepare": { body: PREPARE({ status: "fresh", model_sections: [] }) } }, []), complete: async () => (eagerCalls.push(1), { ok: false }) });
  await eager.prepare();
  assert.equal(eagerCalls.length, 1, "a model call on a fresh pack is counted");
  ok("student: switch off and signed out send nothing; one model call per stale model section with the skill's metadata; none when fresh or only facts are stale; a race after the model call ends the press (one model call per press), a race on facts alone starts over once; a failed or refused answer stores the facts and shows why");
}

// ── The director: overview, pack, decision ─────────────────────────────────────
{
  const none = make({}, { director: null });
  assert.equal((await none.session.directorView()).notice, "강사 토큰을 넣어야 디렉터 화면을 볼 수 있어요.");
  assert.equal(none.calls.length, 0);
  const teams = [{ project_id: "prj-1", title: "1팀", cohort_id: "c", members: 2, week: 2, status: "fresh", stale_sections: [], revision: 3, prepared_at: 1 }];
  const d = make({ "GET /reviews": { teams, truncated: false }, "GET /projects/prj-1/review": { review: { ...REVIEW, status: "fresh", stale_sections: [] } }, "POST /projects/prj-1/review/decision": { status: 201, body: { decision: { id: "dec-9" } } } }, { director: "issuer-tok" });
  const ov = await d.session.directorView();
  assert.deepEqual([ov.mode, ov.available, ov.teams.map((t) => t.status), ov.review], ["director", true, ["fresh"], null]);
  d.session.select("prj-1");
  const opened = await d.session.directorView();
  assert.equal(opened.review.pack.revision, 3);
  assert.ok(d.calls.every((c) => c.token === "issuer-tok"), "the director's reads use the issuer token");
  const form = { statement: "옵션을 줄인 v1으로 다시 시험한다", evidence_refs: [EV("o1")], assumption_refs: [EV("a1")], affected_deck_slides: [2], next: { hypothesis: "옵션이 한 단계면 혼자 주문한다", question: "혼자 주문할 수 있나?", method: "task_test", success_criteria: ["5명 중 3명", " "] } };
  assert.deepEqual(await d.session.decide("prj-1", { week: 2, revision: 3 }, form), { ok: true, reused: false });
  const sent = d.calls.at(-1);
  assert.deepEqual([sent.key, sent.token], ["POST /projects/prj-1/review/decision", "issuer-tok"]);
  assert.deepEqual(sent.body, { week: 2, revision: 3, statement: "옵션을 줄인 v1으로 다시 시험한다", evidence_refs: [EV("o1")], assumption_refs: [EV("a1")], affected_deck_slides: [2], next_experiment: { hypothesis: "옵션이 한 단계면 혼자 주문한다", question: "혼자 주문할 수 있나?", method: "task_test", success_criteria: ["5명 중 3명"] } });
  // The form is checked in the director's words before anything is sent.
  const n = d.calls.length;
  const bad = await d.session.decide("prj-1", { week: 2, revision: 3 }, { ...form, statement: " ", next: { ...form.next, method: "x", success_criteria: [] } });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /무엇을 하기로 했는지/);
  assert.equal(d.calls.length, n, "nothing sent");
  assert.deepEqual(directorFormProblems({ ...form, next: null }), [], "a decision alone is allowed");
  // One decision in flight: a second press while the first is being written sends nothing.
  let openGate;
  const gate = new Promise((r) => (openGate = r));
  const decisionCalls = [];
  const inner = stub({ "POST /projects/prj-1/review/decision": [{ status: 201, body: { decision: { id: "dec-9" } } }, { status: 200, body: { decision: { id: "dec-9" }, reused: true } }] }, decisionCalls);
  const once = new ReviewSession({ switchOn: () => true, token: async () => null, directorToken: async () => "issuer-tok", base: () => "https://svc.test/v1/curriculum", projectId: () => "prj-1", fetchImpl: async (url, init) => (await gate, inner(url, init)), complete: async () => ({ ok: false }) });
  const pressed = once.decide("prj-1", { week: 2, revision: 3 }, form);
  const pressedAgain = once.decide("prj-1", { week: 2, revision: 3 }, form);
  assert.equal(once.isDeciding(), true);
  openGate();
  assert.deepEqual(await pressedAgain, { ok: false, busy: true, message: "결정을 기록하고 있어요." });
  assert.deepEqual(await pressed, { ok: true, reused: false });
  assert.deepEqual([decisionCalls.length, once.isDeciding()], [1, false], "two presses while one is in flight: one request");
  assert.deepEqual(await once.decide("prj-1", { week: 2, revision: 3 }, form), { ok: true, reused: true }, "control: once answered, the next press is sent");
  assert.equal(decisionCalls.length, 2);
  // The webview's side of it (reviewPanelState.ts, which App's reducer and decide button use): a
  // press shows the status line before the decision goes to the host, and the host's next answer
  // ends it; with the panel closed a press changes nothing.
  const dview = { mode: "director", available: true, notice: null, review: REVIEW, teams: [], running: false, timing: null, refused: null };
  let panel = reviewPanelReducer(null, { type: "reviewState", view: dview, error: "이전 오류" });
  assert.deepEqual([panel.deciding, panel.error], [false, "이전 오류"]);
  const order = [];
  const press = { type: "reviewDecision", projectId: "prj-1", week: 2, revision: 3, form };
  pressDecision((a) => (order.push(a.type), (panel = reviewPanelReducer(panel, a))), (m) => order.push(m), press);
  assert.deepEqual(order, ["reviewDeciding", press], "the status line first, then the decision to the host");
  assert.deepEqual([panel.deciding, panel.error, panel.done], [true, null, null], "an earlier line is cleared while it is written");
  panel = reviewPanelReducer(panel, { type: "reviewState", view: dview, done: "결정과 다음 실험을 프로젝트 기억에 기록했어요." });
  assert.deepEqual([panel.deciding, panel.done], [false, "결정과 다음 실험을 프로젝트 기억에 기록했어요."], "the host's answer ends it");
  assert.equal(reviewPanelReducer(null, { type: "reviewDeciding" }), null, "no panel, nothing shown");
  assert.equal(reviewPanelReducer(panel, { type: "reviewClose" }), null);
  // App wires both ends to it (checked on its source: App needs a webview host to run): the decide
  // button presses through pressDecision, the host's reviewState reaches the reducer, and the panel
  // is drawn with the reducer's `deciding`.
  const appSrc = readFileSync(new URL("../webview-ui/src/App.tsx", import.meta.url), "utf8");
  const APP = {
    press: /onDecide=\{\(projectId, week, revision, form\) => pressDecision\(dispatch, postToHost, \{ type: "reviewDecision", projectId, week, revision, form \}\)\}/,
    answer: /case "reviewState": dispatch\(\{ type: "reviewState", view: msg\.view, error: msg\.error, done: msg\.done \}\); break;/,
    reduce: /case "reviewState":\s*case "reviewDeciding":\s*case "reviewClose": \{[^}]*?reviewPanelReducer\(state\.review, action\)/,
    panel: /deciding=\{state\.review\.deciding\}/,
  };
  const appProblems = (src) => Object.entries(APP).filter(([, re]) => !re.test(src)).map(([k]) => k);
  assert.deepEqual(appProblems(appSrc), []);
  assert.deepEqual(appProblems(appSrc.replace("pressDecision(dispatch, postToHost, ", "postToHost(")), ["press"], "planted: a press that never shows the status line");
  assert.deepEqual(appProblems(appSrc.replace(/case "reviewState": dispatch\(\{ type: "reviewState"[^\n]*\n/, "")), ["answer"], "planted: the host's answer never reaches the panel");
  assert.deepEqual(appProblems(appSrc.replace("reviewPanelReducer(state.review, action)", "state.review")), ["reduce"], "planted: the reducer is bypassed");
  assert.deepEqual(appProblems(appSrc.replace("deciding={state.review.deciding}", "deciding={false}")), ["panel"], "planted: the panel is never told");
  // The host posts nothing for a busy answer (a second press while the first is being written), so
  // the first decision's answer is the one that ends the status line.
  const providerSrc = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const BUSY = /const r = await this\.reviewSession\.decide\([\s\S]{0,1500}?\n {4}\}\);\s*(?:\/\/[^\n]*\n\s*)*if \(!r\.ok && r\.busy\) return;\s*return this\.postReviewState\("director"/;
  assert.match(providerSrc, BUSY);
  assert.doesNotMatch(providerSrc.replace("if (!r.ok && r.busy) return;", ""), BUSY, "planted: a busy answer that posts is caught");
  assert.ok(directorFormProblems({ ...form, affected_deck_slides: [9] }).some((p) => /1번부터 8번/.test(p)));
  // What the form offers: the pack's reviewed, real evidence; never an unreviewed AI item.
  const choices = packChoices(REVIEW);
  assert.deepEqual(choices.evidence.map((c) => c.ref), [EV("o1"), EV("i1")]);
  assert.deepEqual(choices.assumptions.map((c) => c.ref), [EV("a1")]);
  assert.ok(!choices.evidence.some((c) => c.ref === EV("o9")), "an unreviewed AI item is not offered");
  assert.deepEqual(suggestedNext(REVIEW), { hypothesis: "옵션이 한 단계면 5명 중 3명이 혼자 주문한다", question: "사용자는 한 단계면 혼자 주문한다", method: "task_test", success_criteria: ["5명 중 3명이 혼자 주문을 마친다"] });
  // The director key's probe: only a 200 for the issuer token turns it on.
  const probe = [];
  assert.equal(await directorAvailable({ base: "https://svc.test/v1/curriculum", token: "issuer-tok", fetchImpl: stub({ "GET /director/projects": { projects: [] } }, probe) }), true);
  assert.equal(await directorAvailable({ base: "https://svc.test/v1/curriculum", token: "issuer-tok", fetchImpl: stub({}, probe) }), false, "the unknown route (switch off) keeps it off");
  assert.equal(await directorAvailable({ base: "https://svc.test/v1/curriculum", token: null, fetchImpl: stub({}, probe) }), false);
  assert.equal(probe.length, 2, "no call without an issuer token");
  ok("director: no issuer token, no call; overview and pack read with the issuer token; the decision and next experiment sent as the form says, checked first, one at a time; the webview shows the status line from the press to the host's answer, App wires it, and the host posts nothing for a busy press; the form offers only reviewed, real evidence of the pack; the director key follows the Service's answer");
}

// ── CR-62: the timing verdict ───────────────────────────────────────────────────
{
  assert.deepEqual(regenerationVerdict({ total_ms: 12_400, provider_ms: 11_900 }), { total_ms: 12_400, provider_ms: 11_900, verdict: "pass" });
  assert.equal(regenerationVerdict({ total_ms: 33_000, provider_ms: 31_000 }).verdict, "miss_provider");
  assert.equal(regenerationVerdict({ total_ms: 33_000, provider_ms: 1_000 }).verdict, "miss_studio");
  assert.equal(timingLine(regenerationVerdict({ total_ms: 12_400, provider_ms: 11_900 })), "준비 시간 12.4초 (AI 응답 11.9초)");
  assert.equal(timingLine(regenerationVerdict({ total_ms: 33_000, provider_ms: 31_000 })), "준비 시간 33.0초 (AI 응답 31.0초) · 30초를 넘었어요 (AI 응답이 늦었어요)");
  // A provider share larger than the whole run is a broken measurement, not a faster Studio.
  assert.equal(regenerationVerdict({ total_ms: 1_000, provider_ms: 5_000 }).provider_ms, 1_000);
  ok("CR-62 verdict: under 30 s passes; a slow provider is a provider-caused miss, a slow Studio a Studio miss; the line says which");
}

// ── The panel, rendered ─────────────────────────────────────────────────────────
const status = rendererStatus();
if (!status.available) {
  console.log(`ok review panel render SKIP — ${status.detail}`);
} else {
  const props = (view) => ({ view, error: null, done: null, busy: false, onRefresh() {}, onPrepare() {}, onOpenTeam() {}, onDecide() {}, onClose() {} });
  const student = (review, extra = {}) => props({ mode: "student", available: true, notice: null, review, teams: null, running: false, timing: null, refused: null, ...extra });
  const html = await renderComponent("ReviewPanel", student(REVIEW, { timing: regenerationVerdict({ total_ms: 9_000, provider_ms: 8_000 }) }));
  const text = visibleText(html);
  assert.equal((html.match(/data-testid="review-section"/g) ?? []).length, 10, "the ten sections");
  for (const id of REVIEW_SECTION_IDS) assert.match(html, new RegExp(`data-section="${id}"`));
  for (const id of REVIEW_SECTION_IDS) assert.match(text, new RegExp(sectionTitle(id, 2).replace(/[()]/g, "\\$&")));
  assert.deepEqual([...html.matchAll(/data-section="([a-z_]+)" data-stale="yes"/g)].map((m) => m[1]), ["observed", "next_experiment"], "only the stale sections are marked");
  assert.match(text, /2주차 · 준비한 뒤로 바뀐 기록이 있어요/);
  assert.match(text, /아직 제안된 슬라이드 수정이 없어요\./);
  assert.match(text, /다음 실험 제안 \(AI\)/);
  assert.match(text, /AI가 쓴 해석/);
  assert.match(text, /아직 검토하지 않은 초안/);
  assert.match(text, /준비 시간 9\.0초 \(AI 응답 8\.0초\)/);
  assert.match(html, /data-testid="review-prepare"/);
  assert.doesNotMatch(html, /review-decision-form/, "a student has no director form");
  // Planted defect: an answer that says fresh while listing stale sections draws no stale mark (the Service's word is drawn as given).
  const misread = await renderComponent("ReviewPanel", student({ ...REVIEW, status: "fresh" }));
  assert.equal((misread.match(/data-stale="yes"/g) ?? []).length, 0);
  // Missing pack: said in words, no sections.
  const missing = visibleText(await renderComponent("ReviewPanel", student({ ...REVIEW, status: "missing", stale_sections: [], pack: null })));
  assert.match(missing, /이 팀은 2주차 리뷰를 아직 준비하지 않았어요/);
  // Unavailable (switch off): nothing of a pack is drawn.
  const off = await renderComponent("ReviewPanel", props({ mode: "student", available: false, notice: "이 수업에서는 주간 리뷰를 쓸 수 없어요.", review: null, teams: null, running: false, timing: null, refused: null }));
  assert.doesNotMatch(off, /review-section|review-prepare/);
  // The director: overview first, then the pack with the form; a director decision drawn under it.
  const teams = [{ project_id: "prj-1", title: "1팀", cohort_id: "c", members: 2, week: 2, status: "fresh", stale_sections: [], revision: 3, prepared_at: 1 }, { project_id: "prj-2", title: "2팀", cohort_id: "c", members: 2, week: 2, status: "missing", stale_sections: [], revision: null, prepared_at: null }];
  const overview = await renderComponent("ReviewPanel", props({ mode: "director", available: true, notice: null, review: null, teams, running: false, timing: null, refused: null }));
  assert.deepEqual([...overview.matchAll(/data-testid="review-team" data-status="([a-z]+)"/g)].map((m) => m[1]), ["fresh", "missing"]);
  assert.doesNotMatch(overview, /review-prepare/, "a director never prepares a pack");
  const withDecision = { ...REVIEW, status: "fresh", stale_sections: [], decisions: [{ id: "dec-9", statement: "옵션을 줄인 v1으로 다시 시험한다", actor: "director", shown_as: "director_decision", evidence_refs: [EV("o1")], assumption_refs: [], affected_deck_slides: [2], next_experiment_id: "exp-2", no_evidence: false }], drafts: [{ id: "exp-2", week: 3, question: "혼자 주문할 수 있나?", method: "task_test", success_criteria: ["5명 중 3명"], status: "draft", hypothesis_id: "hyp-2" }] };
  const dhtml = await renderComponent("ReviewPanel", props({ mode: "director", available: true, notice: null, review: withDecision, teams, running: false, timing: null, refused: null }));
  const dtext = visibleText(dhtml);
  assert.match(dhtml, /data-testid="review-decision-form"/);
  assert.deepEqual([...dhtml.matchAll(/data-testid="review-pick-evidence" data-ref="([^"]+)"/g)].map((m) => m[1]), [EV("o1"), EV("i1")], "only the pack's reviewed, real evidence is pickable");
  assert.match(dtext, /디렉터 결정: 옵션을 줄인 v1으로 다시 시험한다/);
  assert.match(dtext, /다음 실험 초안 \(3주차\): 혼자 주문할 수 있나\?/);
  assert.match(dhtml, /data-testid="review-decision" data-actor="director"/);
  // A decision sent and not answered yet, drawn from the state a press leaves (reviewPanelState.ts):
  // no button to press again, a status line instead, and no refresh (one press, one decision).
  const directorView = { mode: "director", available: true, notice: null, review: withDecision, teams, running: false, timing: null, refused: null };
  let pressed = reviewPanelReducer(null, { type: "reviewState", view: directorView });
  pressDecision((a) => (pressed = reviewPanelReducer(pressed, a)), () => undefined, { type: "reviewDecision", projectId: "prj-1", week: 2, revision: 3, form: { statement: "옵션을 줄인다", evidence_refs: [EV("o1")], assumption_refs: [], affected_deck_slides: [], next: null } });
  const sending = await renderComponent("ReviewPanel", { ...props(pressed.view), deciding: pressed.deciding });
  assert.doesNotMatch(sending, /data-testid="review-decide"/, "no decide button while a decision is in flight");
  assert.match(visibleText(sending), /결정을 기록하고 있어요…/);
  assert.match(dhtml, /data-testid="review-decide"/, "control: nothing in flight, the button is there");
  assert.doesNotMatch(dhtml, /review-deciding/);
  const refresh = (h) => /<button type="button"( disabled="")?>새로 불러오기<\/button>/.exec(h);
  assert.deepEqual([refresh(sending)?.[1], refresh(dhtml) && (refresh(dhtml)[1] ?? "enabled")], [' disabled=""', "enabled"], "no refresh while a decision is in flight (control: drawn and enabled otherwise)");
  const answered = reviewPanelReducer(pressed, { type: "reviewState", view: directorView, done: "결정과 다음 실험을 프로젝트 기억에 기록했어요." });
  const after = await renderComponent("ReviewPanel", { ...props(answered.view), done: answered.done, deciding: answered.deciding });
  assert.match(after, /data-testid="review-decide"/, "the host's answer brings the button back");
  assert.doesNotMatch(after, /review-deciding/);
  ok("panel render: ten titled sections with only the stale ones marked, 'no proposal' and the AI section said in words, the timing line; missing and switch-off draw no pack; the director's overview, form and decision; after a press no decide or refresh button until the host answers");
}

console.log(`\n${passed} cr-review smoke checks passed`);
