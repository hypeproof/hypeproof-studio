// cr-review (#1398) — the Weekly Review Pack on the Service: unit and worker D1 layers (SQLite shim
// by default; `--d1` runs the route checks on local workerd D1 and R2 through Miniflare). Real
// Service router and token verifier; packs are composed from real Venture Memory over real
// participant sessions, manual records and hps-evidence-draft/1 revisions. The App's ReviewSession
// is driven against the same router; the model is a planted answer to the Experiment skill's real
// prompt, and once (SQLite) the real coach route with the provider stubbed. Synthetic identities;
// no network.
//
// CR-T02 (Worker half: the review routes) · CR-T45 · CR-T46 · CR-T47 · CR-T48 (Service half) ·
// CR-T49 · CR-T58 (synthetic provider latency) · CR-69 with packs (a regression check of the
// deletion paths, the retention sweep included). Each with a positive sample that must pass and
// a planted defect that must be caught.
//
// Run: node --experimental-strip-types --experimental-sqlite --no-warnings test/cr-review.test.mjs [--d1]

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localCurriculum } from "./harness/curriculum.mjs";
import { createMockEnv, makeCtx, openAIJsonBody, TEST_SECRET } from "./harness/index.mjs";

const venture = await import("../src/lib/curriculum/venture.ts");
const review = await import("../src/lib/curriculum/review.ts");
const memoryMod = await import("../src/lib/curriculum/memory.ts");
const store = await import("../src/lib/curriculum/store.ts");
const { RULES } = await import("../src/skills/curriculum/rules.ts");
const { CURRICULUM_ROUTES, MEMORY_LIMITS, REVIEW_LIMITS, setAfterReviewInsert } = await import("../src/routes/curriculum.ts");
const { participantPrefix } = await import("../src/lib/curriculum/participant-record.ts");
const { runCurriculumRetention } = await import("../src/lib/curriculum/retention.ts");
const { revokeToken } = await import("../src/lib/kv.ts");
const { getProfile } = await import("../src/profiles/index.ts");
const { CR_SURFACES } = await import("../../extensions/hypeproof-chat/src/curriculumRuntime.ts");
const { ReviewSession, directorAvailable } = await import("../../extensions/hypeproof-chat/src/reviewSession.ts");
const reviewView = await import("../../extensions/hypeproof-chat/src/reviewView.ts");
const { completeSkillRequest } = await import("../../extensions/hypeproof-chat/src/skillSession.ts");

const D1_MODE = process.argv.includes("--d1");
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`❌ ${name}\n   ${err.stack ?? err.message}`);
  }
}

const REVIEW_ROUTES = CURRICULUM_ROUTES.filter((r) => /\/projects\/:id\/review(\/|$)|\/reviews$/.test(r));
const DAY = 24 * 3600_000;
/** Profiles for CR-T49's filters: an adult profile whose switch the test turns off, and a minors profile (never allowed, switch on or off). */
const OFF_PROFILE = "studio-model-practice";
const MINORS_PROFILE = "sk-biopharm-kids-2026-grade-5-6-s1";
const MIGRATIONS = ["0032-curriculum-runtime-publish", "0033-curriculum-runtime-evidence", "0034-curriculum-runtime-memory", "0038-curriculum-runtime-review"];
const SECTIONS = review.REVIEW_SECTION_IDS;

let mf = null;
async function fixture(opts = {}) {
  if (!D1_MODE) return localCurriculum(opts);
  const { createMiniflare } = await import("./harness/miniflare.mjs");
  const compatibilityDate = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
  mf ??= createMiniflare({ modules: true, script: 'export default {fetch(){return new Response("local test")}}', compatibilityDate, d1Databases: ["HPS_DB"], r2Buckets: ["HPS_TRACES"] });
  const db = await mf.getD1Database("HPS_DB");
  for (const t of ["cr_weekly_reviews", "cr_deck_slides", "cr_metrics", "cr_stakeholders", "cr_decisions", "cr_experiment_records", "cr_link_rates", "cr_cohort_controls", "cr_test_links", "cr_experiments", "cr_product_versions", "cr_hypotheses", "cr_projects"]) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  for (const m of MIGRATIONS) {
    const sql = readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), "utf8");
    // Twice: every migration is re-runnable.
    for (let i = 0; i < 2; i++) for (const s of sql.replace(/^--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean)) await db.prepare(s).run();
  }
  const bucket = await mf.getR2Bucket("HPS_TRACES");
  for (let page = await bucket.list(); page.objects.length; page = await bucket.list()) await bucket.delete(page.objects.map((o) => o.key));
  return localCurriculum({ ...opts, binding: db, r2: bucket });
}

// ── The Week 2 fixture, on the real routes ─────────────────────────────────────

const PAGE = (marker) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>키오스크 연습</title></head><body><h1>${marker}</h1><button id="order">주문하기</button><script src="app.js"></script></body></html>`;
const V0 = { "index.html": PAGE("버전 0"), "app.js": "document.title += ' ok';" };
const V1 = { ...V0, "index.html": PAGE("버전 1 — 옵션 한 단계"), "help.html": PAGE("도움말") };
const OBSERVER = { note_kind: "observer_note", provenance: { who: "관찰자 A", when: "2주차 수업", where: "교실 키오스크 앞" }, source_state: "real" };

async function started(f, { token, title = "키오스크 실험", week = 2, files = V0, noLink = false } = {}) {
  const t = token ?? (await f.student());
  const p = await f.api("/v1/curriculum/projects", { method: "POST", token: t, body: { title } });
  assert.equal(p.status, 201, p.text);
  const up = await f.upload(p.json.project.id, files, t);
  assert.ok(up.status === 201 || up.status === 200, up.text);
  const e = await f.api("/v1/curriculum/experiments", {
    method: "POST",
    token: t,
    body: { project_id: p.json.project.id, product_version_id: up.id, week, question: "도움 없이 주문을 마칠 수 있나?", method: "task_test", success_criteria: ["5명 중 3명 완료"], hypothesis: "처음 쓰는 사람도 혼자 주문할 수 있다" },
  });
  assert.equal(e.status, 201, e.text);
  // An experiment that only holds manual records (interviews, notes): it never had a link.
  if (noLink) return { token: t, project: p.json.project, version: up.id, experiment: e.json.experiment, hypothesis: e.json.hypothesis, link: null, url: null };
  const l = await f.api(`/v1/curriculum/experiments/${e.json.experiment.id}/links`, { method: "POST", token: t, body: { expires_at: Date.now() + 3600_000 } });
  assert.equal(l.status, 201, l.text);
  return { token: t, project: p.json.project, version: up.id, experiment: e.json.experiment, hypothesis: e.json.hypothesis, link: l.json.link, url: l.json.share_url };
}

async function visit(f, s) {
  let page = await f.open(s.url);
  if (page.status === 302) page = await f.open(new URL(page.headers.get("location"), s.url).href);
  assert.equal(page.status, 200, page.text);
  const cfg = JSON.parse(/window\.__hpTest=(\{.*?\});<\/script>/.exec(page.text)[1]);
  const opened = await f.raw(new URL(`/l/${s.link.id}/__hp/session`, s.url).href, { method: "POST", body: { token: cfg.session_token } });
  assert.equal(opened.status, 204, opened.text);
  return cfg.session_id;
}

async function note(f, s, text) {
  const r = await f.api(`/v1/curriculum/experiments/${s.experiment.id}/notes`, { method: "POST", token: s.token, body: { ...OBSERVER, text } });
  assert.equal(r.status, 201, r.text);
  return r.json.note.id;
}

async function draft(f, s, items, author = "user") {
  const r = await f.api(`/v1/curriculum/experiments/${s.experiment.id}/drafts`, { method: "POST", token: s.token, body: { author, items: items.map((i) => ({ review: "draft", source_refs: [], ...i })) } });
  assert.equal(r.status, 201, r.text);
  return r.json.draft;
}

async function reviewDraft(f, s, d, actions) {
  const r = await f.api(`/v1/curriculum/experiments/${s.experiment.id}/drafts/${d.id}/review`, { method: "POST", token: s.token, body: { revision: d.revision, actions, reason: "학생이 읽고 고름" } });
  assert.equal(r.status, 201, r.text);
  return r.json.draft;
}

/**
 * Week 2 of a team: a hypothesis tested on v0, two participant sessions and two notes, an accepted
 * draft (two observed, one interpreted, two assumed items), v1, a team decision that produced v1
 * citing evidence and an assumption and affecting slides 2–3, and slides 2 and 3.
 */
async function week2(f, opts = {}) {
  const s = await started(f, opts);
  const s1 = await visit(f, s);
  const s2 = await visit(f, s);
  const n1 = await note(f, s, "옵션 고르는 화면에서 멈칫함");
  const n2 = await note(f, s, "세 명 중 두 명이 옵션에서 멈춤");
  const d1 = await draft(f, s, [
    { id: "o1", section: "observation", text: "세 명 중 두 명이 옵션 선택에서 멈췄다", source_refs: [`note:${n1}`, `note:${n2}`] },
    { id: "o2", section: "observation", text: "두 세션이 열렸다", source_refs: [`session:${s1}`, `session:${s2}`] },
    { id: "i1", section: "interpretation", text: "옵션 단계가 너무 많다", source_refs: [`note:${n2}`] },
    { id: "a1", section: "assumption", text: "사용자는 한 단계면 혼자 주문한다", source_refs: [] },
    { id: "a2", section: "assumption", text: "어르신도 같은 문제를 겪는다", source_refs: [] },
  ]);
  const d = await reviewDraft(f, s, d1, ["o1", "o2", "i1", "a1", "a2"].map((item) => ({ item, action: "accept" })));
  const ev = (item) => venture.evidenceItemRef(s.experiment.id, d.id, item);
  const up1 = await f.upload(s.project.id, V1, s.token);
  assert.ok(up1.status === 201 || up1.status === 200, up1.text);
  const dec = await f.api(`/v1/curriculum/projects/${s.project.id}/decisions`, {
    method: "POST",
    token: s.token,
    body: { author: "user", statement: "옵션 선택을 한 단계로 줄인다", evidence_refs: [ev("o1"), ev("i1")], assumption_refs: [ev("a1")], resulting_version_id: up1.id, affected_deck_slides: [2, 3], experiment_id: s.experiment.id },
  });
  assert.equal(dec.status, 201, dec.text);
  for (const n of [2, 3]) {
    const sl = await f.api(`/v1/curriculum/projects/${s.project.id}/slides/${n}`, { method: "PUT", token: s.token, body: { title: n === 2 ? "문제" : "해결", body: "옵션 한 단계", evidence_refs: [ev("o1")], decision_id: dec.json.decision.id } });
    assert.equal(sl.status, 201, sl.text);
  }
  return { ...s, sessions: [s1, s2], notes: [n1, n2], draft: d, ev, v1: up1.id, decision: dec.json.decision };
}

// ── The planted model: an answer to the Experiment skill's real prompt, computed from that prompt ──

/** What a model would answer to the prompt it was sent: an open assumption from the prompt's own register. */
function experimentAnswer(prompt, { bad = false } = {}) {
  assert.match(prompt, /^## Skill\nexperiment@\d/m, "the prompt is the Experiment skill's");
  const context = JSON.parse(/^## Context\n(.*)$/m.exec(prompt)[1]);
  const open = (context.register?.assumed ?? []).find((i) => i.assumption_status === "open");
  return "```json\n" + JSON.stringify({
    ...(open ? { assumption_ref: open.id } : {}),
    assumption: open?.statement ?? "처음 쓰는 사람은 도움 없이 주문하지 못한다",
    why_riskiest: "틀리면 키오스크가 쓸모없다",
    hypothesis: "옵션이 한 단계면 처음 쓰는 사람 5명 중 3명이 도움 없이 주문한다",
    method: "task_test",
    procedure: ["v1을 공개한다", "처음 쓰는 다섯 명에게 주문을 부탁한다"],
    success_criteria: bad ? ["사람들이 좋아한다"] : ["5명 중 3명이 도움 없이 주문을 마친다"],
  }) + "\n```";
}

/** The App's ReviewSession over the real router, with a planted model that counts its calls. */
function sessionFor(f, s, opts = {}) {
  const calls = [];
  let offset = 0;
  const session = new ReviewSession({
    switchOn: () => true,
    token: async () => opts.token ?? s.token,
    directorToken: async () => opts.director ?? null,
    base: () => "https://service.test/v1/curriculum",
    fetchImpl: (url, init) => f.app.fetch(new Request(url, init), f.env, makeCtx()),
    projectId: () => s.project.id,
    // CR-T58: a planted provider latency moves this clock by its milliseconds without sleeping, so
    // the App measures Studio's own time for real and the provider's as planted.
    now: () => Date.now() + offset,
    complete: async (prompt, headers) => {
      calls.push({ prompt, headers });
      if (opts.latency) offset += opts.latency;
      if (opts.complete) return opts.complete(prompt, headers);
      return { ok: true, text: experimentAnswer(prompt, { bad: opts.bad }), model: "hypeproof-default" };
    },
  });
  return { session, calls };
}

const open = async (f, s, token = s.token, week) => {
  const r = await f.api(`/v1/curriculum/projects/${s.project.id}/review${week ? `?week=${week}` : ""}`, { token });
  assert.equal(r.status, 200, r.text);
  return r.json.review;
};
const rows = async (f, projectId) => (await f.env.HPS_DB.prepare("SELECT week, revision, doc FROM cr_weekly_reviews WHERE project_id = ? ORDER BY week, revision").bind(projectId).all()).results ?? [];
const sectionOf = (pack, id) => pack.sections.find((x) => x.id === id);

/**
 * A D1 binding over `real` whose statements matching `re` go through `hook` (`run` or `first`,
 * with a state shared by every call); every other statement passes through untouched.
 */
function hooked(real, re, hook) {
  const state = { fired: 0 };
  const db = {
    prepare(sql) {
      const st = real.prepare(sql);
      if (!re.test(sql)) return st;
      return {
        bind: (...a) => {
          const b = st.bind(...a);
          return {
            run: (...x) => (hook.run ? hook.run(b, state, ...x) : b.run(...x)),
            first: (...x) => (hook.first ? hook.first(b, state, ...x) : b.first(...x)),
            all: (...x) => b.all(...x),
          };
        },
      };
    },
    batch: (...x) => real.batch(...x),
  };
  return { db, state };
}

/** The first `run` of a statement matching `re` throws (a transient storage failure); later ones run. */
const failingOnce = (real, re) =>
  hooked(real, re, {
    run: async (b, state, ...x) => {
      if (state.fired++ === 0) throw new Error("D1_ERROR: network connection lost (planted)");
      return b.run(...x);
    },
  });

/** The statement that drops a Project's packs (store.ts `dropProjectReviews`). */
const DROP_PACKS = /^DELETE FROM cr_weekly_reviews WHERE project_id = \?$/;

/**
 * Every outbound call a model could be reached by while `fn` runs: the provider hosts every
 * adapter calls (callAnthropic, callOpenAI, callGemini, GLM) and the coach routes. Local D1/R2
 * traffic of Miniflare passes through untouched.
 */
const MODEL_CALL = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|open\.bigmodel\.cn|\/v1\/chat\/completions|\/v1\/messages/;
async function spyModelCalls(fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (MODEL_CALL.test(url)) {
      calls.push(url);
      return Response.json(openAIJsonBody({ content: "{}" }));
    }
    return real(input, init);
  };
  try {
    const out = await fn();
    return { calls, out };
  } finally {
    globalThis.fetch = real;
  }
}

// ── CR-T45 (unit): ten sections, every factual claim linked, interpretation apart ──

await test("CR-T45 positive: the Week 2 fixture yields the ten sections in order, every factual claim with a source, interpretation apart from observed evidence; with no patch pending 'deck slides affected' names the decisions' slides 2 and 3 and says 'no proposal'", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    const { session, calls } = sessionFor(f, s);
    const r = await session.prepare();
    assert.deepEqual(r, { ok: true, regenerated: [...SECTIONS], unchanged: false }, JSON.stringify(r));
    assert.equal(calls.length, 1, "the model was asked once, for its own section");
    assert.deepEqual(calls[0].headers, { "x-hps-skill": "experiment@1.0.0", "x-hps-capability": "reasoning.high" }, "the Experiment skill's tag and capability, never a model id (CR-45)");
    const rv = await open(f, s);
    assert.equal(rv.status, "fresh");
    const pack = rv.pack;
    assert.deepEqual(pack.sections.map((x) => x.id), [...SECTIONS]);
    assert.deepEqual(review.packProblems(pack), [], "the stored pack passes its own check");
    // Every claim about the records names a source, and every source resolves now.
    for (const sec of pack.sections) for (const it of sec.items) if (review.SOURCED_CLASSES.has(it.class)) assert.ok(it.sources.length > 0, `${sec.id}: ${it.text}`);
    for (const ref of review.sourcesOf(pack)) assert.equal(rv.sources[ref]?.found, true, ref);
    // Observed evidence, interpretation and assumptions are separate sections of one class each.
    assert.deepEqual(sectionOf(pack, "observed").items.map((i) => [i.class, i.sources[0]]), [["observed", s.ev("o1")], ["observed", s.ev("o2")]]);
    assert.deepEqual(sectionOf(pack, "interpretation").items.map((i) => [i.class, i.sources[0]]), [["interpreted", s.ev("i1")]]);
    assert.deepEqual(sectionOf(pack, "assumptions").items.map((i) => [i.class, i.sources[0]]), [["assumed", s.ev("a1")], ["assumed", s.ev("a2")]]);
    // The hypothesis, what was tested, the product change with the decision behind v1.
    assert.match(sectionOf(pack, "hypothesis").items[0].text, /처음 쓰는 사람도 혼자 주문할 수 있다/);
    assert.deepEqual(sectionOf(pack, "hypothesis").items[0].sources, [`hypothesis:${s.hypothesis.id}@1`]);
    assert.ok(sectionOf(pack, "experiment").items.some((i) => i.text === "성공 기준: 5명 중 3명 완료" && i.sources[0] === `experiment:${s.experiment.id}`));
    const product = sectionOf(pack, "product_change").items;
    assert.ok(product.some((i) => /새 버전: v1/.test(i.text) && i.sources.includes(`version:${s.v1}`)), JSON.stringify(product));
    assert.ok(product.some((i) => /옵션 선택을 한 단계로 줄인다/.test(i.text) && i.sources.includes(`decision:${s.decision.id}`)));
    // Deck slides affected: the decision's slides 2 and 3, and "no proposal" said in words.
    const deck = sectionOf(pack, "deck_slides");
    assert.deepEqual(deck.items.map((i) => i.text), ['슬라이드 2 (문제): 팀 결정 "옵션 선택을 한 단계로 줄인다"', '슬라이드 3 (해결): 팀 결정 "옵션 선택을 한 단계로 줄인다"']);
    assert.ok(deck.items.every((i) => i.sources.includes(`decision:${s.decision.id}`)));
    assert.deepEqual(deck.proposals, []);
    assert.ok(deck.notes.includes(review.NO_PROPOSAL), JSON.stringify(deck.notes));
    // The agenda is read off the records: the hypothesis with what was observed, and the open assumptions.
    const agenda = sectionOf(pack, "decision_needed").items;
    assert.equal(agenda.length, 2);
    assert.ok(agenda[0].sources.includes(`hypothesis:${s.hypothesis.id}@1`) && agenda[0].sources.includes(s.ev("o1")));
    assert.deepEqual(agenda[1].sources, [s.ev("a1"), s.ev("a2")]);
    // The next experiment is the AI's, labelled, and cites the open assumption it tests.
    const next = sectionOf(pack, "next_experiment");
    assert.ok(next.items.length > 0 && next.items.every((i) => i.class === "ai_suggestion"));
    assert.equal(next.skill, "experiment@1.0.0");
    assert.equal(next.items[0].sources[0], s.ev("a1"));
    assert.ok(next.notes.includes(review.AI_SUGGESTION_NOTE));
    // No chat history anywhere: a project with an experiment but no evidence says so instead of claiming.
    const bare = await started(f, { title: "빈 프로젝트" });
    await sessionFor(f, bare).session.prepare();
    const empty = (await open(f, bare)).pack;
    assert.deepEqual(sectionOf(empty, "observed").items, []);
    assert.deepEqual(sectionOf(empty, "observed").notes, ["이 주에 기록된 관찰이 없어요."]);
    assert.deepEqual(review.packProblems(empty), []);
  } finally {
    f.close();
  }
});

await test("CR-T45 negative: a factual claim without a source, a claim in the wrong section, a 'deck slides affected' section that does not say 'no proposal', and a missing section are each caught exactly once; nothing is stored from a pack that fails", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const good = (await open(f, s)).pack;
    const plant = (fn) => {
      const p = structuredClone(good);
      fn(p);
      return review.packProblems(p);
    };
    assert.deepEqual(plant(() => {}), [], "control: the unplanted pack passes");
    assert.deepEqual(plant((p) => (sectionOf(p, "observed").items[0].sources = [])), ["observed[0]: claim_without_source"]);
    assert.deepEqual(plant((p) => (sectionOf(p, "product_change").items[0].sources = [])), ["product_change[0]: claim_without_source"]);
    assert.deepEqual(plant((p) => sectionOf(p, "observed").items.push({ class: "interpreted", text: "해석이 섞임", sources: [s.ev("i1")] })), ["observed[2]: class_not_allowed:interpreted"]);
    assert.deepEqual(plant((p) => sectionOf(p, "metrics").items.push({ class: "ai_suggestion", text: "AI가 쓴 숫자 12명", sources: [] })), ["metrics[0]: class_not_allowed:ai_suggestion"]);
    assert.deepEqual(plant((p) => (sectionOf(p, "deck_slides").notes = [])), ["deck_slides: no_proposal_not_said"]);
    assert.deepEqual(plant((p) => (sectionOf(p, "observed").items[0].sources = ["chat:turn-3"])), ["observed[0]: unknown_source:chat:turn-3"]);
    assert.deepEqual(plant((p) => p.sections.splice(5, 1)), ["sections_not_the_ten_in_order"]);
    // The commit route runs this check before it stores anything (the route source, read).
    const src = readFileSync(new URL("../src/routes/curriculum.ts", import.meta.url), "utf8");
    assert.match(src, /const problems = packProblems\(pack\);\s*if \(problems\.length\) return refuse\(c, 422, "invalid_pack", \{ problems \}\);[\s\S]{0,700}?insertReview\(/);
  } finally {
    f.close();
  }
});

await test("CR-T45 weeks and sources: a pack reads only its own week (a week-1 observation is in no week-2 section, and the other way round), and lists only the director decisions written from that week's pack; a source deleted after preparing opens as not found while the rest still resolve", async () => {
  const f = await fixture();
  try {
    // One team, week 1 then week 2, an observation in each.
    const w1 = await started(f, { title: "두 주", week: 1 });
    const n1 = await note(f, w1, "1주차: 첫 화면에서 길을 잃음");
    const d1 = await reviewDraft(f, w1, await draft(f, w1, [{ id: "w1o", section: "observation", text: "1주차에 한 명이 첫 화면에서 길을 잃었다", source_refs: [`note:${n1}`] }]), [{ item: "w1o", action: "accept" }]);
    const e2 = await f.api("/v1/curriculum/experiments", { method: "POST", token: w1.token, body: { project_id: w1.project.id, product_version_id: w1.version, week: 2, question: "옵션을 혼자 고를 수 있나?", method: "task_test", success_criteria: ["5명 중 3명 완료"], hypothesis_id: w1.hypothesis.id } });
    assert.equal(e2.status, 201, e2.text);
    const w2 = { ...w1, experiment: e2.json.experiment };
    const n2 = await note(f, w2, "2주차: 옵션에서 멈춤");
    const d2 = await reviewDraft(f, w2, await draft(f, w2, [{ id: "w2o", section: "observation", text: "2주차에 두 명이 옵션에서 멈췄다", source_refs: [`note:${n2}`] }, { id: "w2i", section: "interpretation", text: "옵션 이름이 어렵다", source_refs: [`note:${n2}`] }]), [{ item: "w2o", action: "accept" }, { item: "w2i", action: "accept" }]);
    const ref1 = venture.evidenceItemRef(w1.experiment.id, d1.id, "w1o");
    const ref2 = venture.evidenceItemRef(w2.experiment.id, d2.id, "w2o");
    const refsIn = (pack, id) => sectionOf(pack, id).items.flatMap((i) => i.sources);
    // The week the team ran last is the default.
    assert.equal((await sessionFor(f, w1).session.prepare()).ok, true);
    const p2 = (await open(f, w1)).pack;
    assert.equal(p2.week, 2);
    assert.deepEqual(refsIn(p2, "observed"), [ref2], "week 2's observation only");
    assert.deepEqual(refsIn(p2, "interpretation"), [venture.evidenceItemRef(w2.experiment.id, d2.id, "w2i")]);
    assert.ok(!review.sourcesOf(p2).includes(ref1), "week 1's observation is in no section of the week-2 pack");
    assert.equal((await sessionFor(f, w1).session.prepare(1)).ok, true);
    const p1 = (await open(f, w1, w1.token, 1)).pack;
    assert.deepEqual([p1.week, refsIn(p1, "observed"), refsIn(p1, "interpretation")], [1, [ref1], []], "and week 1's pack holds its own");
    assert.ok(!review.sourcesOf(p1).includes(ref2));
    // The director's decisions are listed under the pack of the week they were written from.
    const director = await f.issuer();
    const decide = async (week, pack, ref) => {
      const r = await f.api(`/v1/curriculum/projects/${w1.project.id}/review/decision`, { method: "POST", token: director, body: { week, revision: pack.revision, statement: `${week}주차 리뷰에서 정한 것`, evidence_refs: [ref], assumption_refs: [], affected_deck_slides: [] } });
      assert.equal(r.status, 201, r.text);
      return r.json.decision.id;
    };
    const dec1 = await decide(1, p1, ref1);
    const dec2 = await decide(2, p2, venture.evidenceItemRef(w2.experiment.id, d2.id, "w2i"));
    assert.deepEqual((await open(f, w1)).decisions.map((d) => d.id), [dec2], "a week-1 decision is not listed on the week-2 pack");
    assert.deepEqual((await open(f, w1, w1.token, 1)).decisions.map((d) => d.id), [dec1], "nor a week-2 decision on the week-1 pack");
    // A source deleted after preparing: the student rejects the week-2 observation. The pack opens
    // as prepared, that claim's source reads "not found", and every other source still resolves.
    for (const ref of review.sourcesOf(p2)) assert.equal((await open(f, w1)).sources[ref]?.found, true, `control: ${ref} resolves before`);
    await reviewDraft(f, w2, d2, [{ item: "w2o", action: "reject" }]);
    const after = await open(f, w1);
    assert.equal(after.pack.revision, p2.revision, "opening generated nothing");
    assert.deepEqual([after.sources[ref2]?.found, after.sources[ref2]?.label], [false, "찾을 수 없는 기록이에요 (지워졌거나 바뀌었어요)"]);
    for (const ref of review.sourcesOf(after.pack).filter((r) => r !== ref2)) assert.equal(after.sources[ref]?.found, true, `${ref} still resolves`);
    assert.equal(after.status, "stale");
    assert.ok(after.stale_sections.includes("observed"));
  } finally {
    f.close();
  }
});

// ── CR-T46 (worker D1): stale by input digest, only stale sections regenerated ──

/** Which sections a new revision rewrote that were fresh, and which stale ones it left as they were. */
function regenerationProblems(before, after, stale) {
  const problems = [];
  for (const id of SECTIONS) {
    const a = sectionOf(before, id);
    const b = sectionOf(after, id);
    const rewritten = b.generated_in === after.revision && after.revision !== before.revision;
    if (stale.includes(id) && !rewritten && !(id === "next_experiment")) problems.push(`${id}: stale but not regenerated`);
    if (!stale.includes(id) && JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${id}: fresh but regenerated`);
  }
  return problems;
}

await test("CR-T46: changing one evidence item marks only the sections that read it stale; preparing again regenerates exactly those and asks the model once per stale model section; a metric marks only the metrics stale and costs no model call; nothing stale writes nothing", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    const { session, calls } = sessionFor(f, s);
    await session.prepare();
    const first = (await open(f, s)).pack;
    assert.equal(calls.length, 1);
    // Nothing stale: no model call, no new revision (an unchanged section is never regenerated).
    assert.deepEqual(await session.prepare(), { ok: true, regenerated: [], unchanged: true });
    assert.equal(calls.length, 1, "no model call when nothing is stale");
    assert.equal((await rows(f, s.project.id)).length, 1, "no revision written");
    // One evidence item changes: the student edits the interpretation.
    const d = (await f.api(`/v1/curriculum/projects/${s.project.id}/memory`, { token: s.token })).json.memory.evidence_items.find((i) => i.id === s.ev("i1"));
    await reviewDraft(f, s, { id: s.draft.id, revision: d.revision }, [{ item: "i1", action: "edit", text: "옵션 단계가 많아 처음 쓰는 사람이 망설인다" }]);
    const staleView = await open(f, s);
    assert.equal(staleView.status, "stale", "a stale pack is never shown as current");
    assert.deepEqual(staleView.stale_sections, ["interpretation", "next_experiment"]);
    assert.equal(staleView.pack.revision, first.revision, "opening generated nothing");
    // Prepare again: exactly the stale sections are rewritten, the model once.
    const r = await session.prepare();
    assert.deepEqual(r, { ok: true, regenerated: ["interpretation", "next_experiment"], unchanged: false });
    assert.equal(calls.length, 2, "one model call for the one stale model section");
    const second = (await open(f, s)).pack;
    assert.equal(second.revision, 2);
    assert.deepEqual(regenerationProblems(first, second, ["interpretation", "next_experiment"]), []);
    assert.equal(sectionOf(second, "interpretation").items[0].text, "옵션 단계가 많아 처음 쓰는 사람이 망설인다");
    // A metric is defined: only the metrics section reads it, and no model section is stale.
    const m = await f.api(`/v1/curriculum/projects/${s.project.id}/metrics`, { method: "POST", token: s.token, body: { name: "페이지 열람", metric_kind: "usage", definition: "참가 세션의 화면 열람 수", unit: "회", source: { type: "event_count", experiment_id: s.experiment.id, event_kind: "page_view" } } });
    assert.equal(m.status, 201, m.text);
    assert.deepEqual((await open(f, s)).stale_sections, ["metrics"]);
    assert.deepEqual(await session.prepare(), { ok: true, regenerated: ["metrics"], unchanged: false });
    assert.equal(calls.length, 2, "a fact section costs no model call");
    const third = (await open(f, s)).pack;
    assert.deepEqual(regenerationProblems(second, third, ["metrics"]), []);
    assert.match(sectionOf(third, "metrics").items[0].text, /^페이지 열람: 근거가 되는 실제 기록이 없어요/);
    // Instrument negative controls: a planted builder that regenerates every section, and one
    // that leaves a stale section as it was, are both caught by the same comparison.
    const everything = { ...third, revision: third.revision + 1, sections: third.sections.map((x) => ({ ...x, generated_in: third.revision + 1, generated_at: x.generated_at + 1 })) };
    assert.ok(regenerationProblems(third, everything, ["metrics"]).length >= 8, "regenerating fresh sections is caught");
    const lazy = { ...third, revision: third.revision + 1 };
    assert.deepEqual(regenerationProblems(third, lazy, ["metrics"]), ["metrics: stale but not regenerated"]);
  } finally {
    f.close();
  }
});

await test("CR-T46 the model section: an answer to other records than the ones now is refused (409 inputs_changed), the press ends with its one model call and the next press stores the pack; an answer the skill gate refuses stores the facts and keeps the AI section not generated, with the problems shown", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    // An answer that breaks the Experiment skill's rule (uncountable success criterion).
    const bad = sessionFor(f, s, { bad: true });
    assert.equal((await bad.session.prepare()).ok, true);
    const pack = (await open(f, s)).pack;
    assert.equal(sectionOf(pack, "next_experiment").digest, null, "the refused suggestion is not stored");
    assert.deepEqual(sectionOf(pack, "next_experiment").notes, [review.NOT_GENERATED]);
    assert.equal(sectionOf(pack, "observed").items.length, 2, "the facts were stored");
    assert.ok((await bad.session.studentView()).refused.some((p) => /experiment_criteria_countable/.test(p)), "the refusal is shown");
    assert.equal((await open(f, s)).status, "stale");
    // The records change between prepare and commit, after the model was asked: the answer is
    // refused and the press ends there, so one press makes one model call (MU-02, decision 2:
    // retry bound 0). The student's next press stores the pack for the records as they are now.
    let changed = false;
    const racing = sessionFor(f, s, {
      complete: async (prompt) => {
        if (!changed) {
          changed = true;
          await note(f, s, "준비하는 사이에 남긴 메모");
          const dr = await draft(f, s, [{ id: "a3", section: "assumption", text: "매장 직원이 옆에서 돕는다", source_refs: [] }]);
          await reviewDraft(f, s, dr, [{ item: "a3", action: "accept" }]);
        }
        return { ok: true, text: experimentAnswer(prompt), model: "hypeproof-default" };
      },
    });
    const storedBefore = (await rows(f, s.project.id)).length;
    const r = await racing.session.prepare();
    assert.deepEqual(r, { ok: false, message: "준비하는 동안 기록이 바뀌었어요. 다시 준비해 주세요." });
    assert.equal(racing.calls.length, 1, "one press, one model call");
    assert.equal((await rows(f, s.project.id)).length, storedBefore, "nothing stored from the refused answer");
    const again = await racing.session.prepare();
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(racing.calls.length, 2, "the next press asks again, for the records as they are now");
    const after = await open(f, s);
    assert.equal(after.status, "fresh");
    assert.ok(sectionOf(after.pack, "assumptions").items.some((i) => i.text === "매장 직원이 옆에서 돕는다"));
    // Directly: a stale input digest is refused before anything is stored.
    const n = (await rows(f, s.project.id)).length;
    const commit = await f.api(`/v1/curriculum/projects/${s.project.id}/review/commit`, { method: "POST", token: s.token, body: { week: 2, base_revision: after.pack.revision, outputs: { next_experiment: { input_digest: "sha256:" + "0".repeat(64), output: {} } } } });
    assert.deepEqual([commit.status, commit.json.error.code], [409, "inputs_changed"]);
    assert.equal((await rows(f, s.project.id)).length, n, "nothing stored");
  } finally {
    f.close();
  }
});

await test("CR-T46 nothing to regenerate, at the Service (CR-49): with only the AI's section stale and its answer missing, refused by the skill gate or failed in the App, a commit regenerates nothing and stores no revision (200 unchanged), so a director who read the pack still decides on it; an accepted answer stores the next revision (control)", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const read = (await open(f, s, director)).pack.revision;
    // The problem is in the Experiment skill's context and in no fact section: only the AI's section goes stale.
    const problem = await f.api(`/v1/curriculum/projects/${s.project.id}/problem`, { method: "PUT", token: s.token, body: { statement: "처음 쓰는 사람은 키오스크 옵션 화면에서 혼자 주문을 끝내지 못한다" } });
    assert.equal(problem.status, 200, problem.text);
    assert.deepEqual((await open(f, s)).stale_sections, ["next_experiment"]);
    const path = `/v1/curriculum/projects/${s.project.id}/review/commit`;
    const stored = async () => (await rows(f, s.project.id)).map((r) => r.revision);
    assert.deepEqual(await stored(), [read]);
    // No answer sent (the model was not reached).
    const none = await f.api(path, { method: "POST", token: s.token, body: { week: 2, base_revision: read } });
    assert.deepEqual([none.status, none.json.unchanged, none.json.regenerated], [200, true, []], none.text);
    assert.deepEqual(await stored(), [read], "no revision written");
    // An answer the Experiment skill's gate refuses.
    const prep = await f.api(`/v1/curriculum/projects/${s.project.id}/review/prepare`, { method: "POST", token: s.token, body: {} });
    assert.deepEqual(prep.json.stale_sections, ["next_experiment"], prep.text);
    const ms = prep.json.model_sections[0];
    const bad = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(experimentAnswer(ms.prompt, { bad: true }))[1]);
    const refused = await f.api(path, { method: "POST", token: s.token, body: { week: 2, base_revision: read, outputs: { next_experiment: { input_digest: ms.input_digest, output: bad } } } });
    assert.deepEqual([refused.status, refused.json.unchanged, refused.json.regenerated], [200, true, []], refused.text);
    assert.ok(refused.json.refused.next_experiment.problems.some((p) => /experiment_criteria_countable/.test(p)), refused.text);
    assert.deepEqual(await stored(), [read], "no revision written");
    // Through the App: the model call fails, so the press commits no answer.
    const failing = sessionFor(f, s, { complete: async () => ({ ok: false, error: "provider_unavailable" }) });
    assert.deepEqual(await failing.session.prepare(), { ok: true, regenerated: [], unchanged: false });
    assert.equal(failing.calls.length, 1);
    assert.deepEqual((await failing.session.studentView()).refused, ["model_failed"], "the press says why nothing changed");
    assert.deepEqual(await stored(), [read], "no revision written");
    // The director decides on the revision read before all of this.
    const decided = await f.api(`/v1/curriculum/projects/${s.project.id}/review/decision`, { method: "POST", token: director, body: { week: 2, revision: read, statement: "옵션을 줄인 v1으로 다시 시험한다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [] } });
    assert.equal(decided.status, 201, decided.text);
    // Control: an accepted answer for the records as they are now stores the next revision, the AI's section only.
    const { session, calls } = sessionFor(f, s);
    assert.deepEqual(await session.prepare(), { ok: true, regenerated: ["next_experiment"], unchanged: false });
    assert.equal(calls.length, 1);
    assert.deepEqual(await stored(), [read, read + 1]);
  } finally {
    f.close();
  }
});

// ── CR-T47 (worker D1): opening never calls a model ──────────────────────────────

await test("CR-T47: opening the latest pack, fresh or stale, as a member or a director, makes zero model calls on every path the pack builder can reach and writes nothing; the spy counts a planted call", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const fresh = await spyModelCalls(async () => [await open(f, s), await open(f, s, director)]);
    assert.deepEqual(fresh.calls, []);
    assert.deepEqual(fresh.out.map((x) => x.status), ["fresh", "fresh"]);
    // Stale: a new note in the draft changes the observed section.
    const dr = await draft(f, s, [{ id: "o3", section: "observation", text: "한 명은 도움말을 눌렀다", source_refs: [`session:${s.sessions[0]}`] }]);
    await reviewDraft(f, s, dr, [{ item: "o3", action: "accept" }]);
    const before = await rows(f, s.project.id);
    const stale = await spyModelCalls(async () => [await open(f, s), await open(f, s, director), (await f.api("/v1/curriculum/reviews", { token: director })).json]);
    assert.deepEqual(stale.calls, [], "a stale pack opens with its marking and no model call");
    assert.equal(stale.out[0].status, "stale");
    assert.ok(stale.out[0].stale_sections.includes("observed"));
    assert.equal(stale.out[1].status, "stale");
    assert.deepEqual(await rows(f, s.project.id), before, "opening wrote nothing");
    // Instrument negative control: a planted model call inside the window is counted.
    const planted = await spyModelCalls(async () => {
      await open(f, s);
      await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" });
    });
    assert.equal(planted.calls.length, 1, "the spy sees a model call made while a pack opens");
    const coach = await spyModelCalls(() => fetch("https://service.test/v1/chat/completions", { method: "POST", body: "{}" }));
    assert.equal(coach.calls.length, 1, "and a request to the coach route");
  } finally {
    f.close();
  }
});

// ── CR-T48, Service half: the director's decision and next experiment write back ──

await test("CR-T48 Service half: the director writes the final decision and the next experiment from the pack; after reopening, the Decision (director actor, evidence of the pack linked) and the Experiment draft are in Venture Memory; a retry writes nothing more", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const { session } = sessionFor(f, s, { director });
    session.select(s.project.id);
    const view = await session.directorView();
    assert.equal(view.available, true, view.notice);
    const rv = view.review;
    assert.equal(rv.status, "fresh");
    const choices = reviewView.packChoices(rv);
    assert.deepEqual(choices.evidence.map((c) => c.ref), [s.ev("o1"), s.ev("o2"), s.ev("i1")]);
    const next = reviewView.suggestedNext(rv);
    assert.equal(next.hypothesis, "옵션이 한 단계면 처음 쓰는 사람 5명 중 3명이 도움 없이 주문한다");
    const form = { statement: "옵션을 한 화면에 모은 v1으로 다음 주에 다시 시험한다", evidence_refs: [s.ev("o1"), s.ev("i1")], assumption_refs: [s.ev("a1")], affected_deck_slides: [2], next: { ...next, question: "옵션이 한 단계면 혼자 주문할 수 있나?" } };
    assert.deepEqual(await session.decide(s.project.id, { week: rv.week, revision: rv.pack.revision }, form), { ok: true, reused: false });
    // Reopen: Venture Memory has both, the decision by the director, linked to the pack's evidence.
    const mem = (await f.api(`/v1/curriculum/projects/${s.project.id}/memory`, { token: s.token })).json.memory;
    const dec = mem.decisions.find((x) => x.actor === "director");
    assert.ok(dec, "the decision is in memory after reopening");
    assert.equal(dec.decided_by, "director-a");
    assert.equal(dec.shown_as, "director_decision");
    assert.deepEqual(dec.evidence_refs, [s.ev("o1"), s.ev("i1")]);
    assert.deepEqual(dec.assumption_refs, [s.ev("a1")]);
    assert.deepEqual(dec.review, { week: 2, revision: rv.pack.revision });
    assert.equal(dec.experiment_id, s.experiment.id);
    const draftExp = mem.experiments.find((e) => e.id === dec.next_experiment_id);
    assert.ok(draftExp, "the Experiment draft is in memory after reopening");
    assert.deepEqual([draftExp.status, draftExp.week, draftExp.question, draftExp.method, draftExp.product_version_id], ["draft", 3, "옵션이 한 단계면 혼자 주문할 수 있나?", "task_test", s.v1]);
    assert.deepEqual(draftExp.drafted_from, { decision_id: dec.id, week: 2, revision: rv.pack.revision });
    assert.equal(mem.hypotheses.find((h) => h.id === draftExp.hypothesis_id)?.statement, next.hypothesis, "the suggested hypothesis was stored for it");
    assert.ok(mem.timeline.some((t) => t.entry === "director_decision" && t.record.id === dec.id), "the timeline shows it as the director's decision");
    // The review shows it under the pack, and the pack is now stale (a new decision and experiment).
    const after = await open(f, s);
    assert.deepEqual(after.decisions.map((x) => x.id), [dec.id]);
    assert.deepEqual(after.drafts.map((x) => x.id), [draftExp.id]);
    assert.equal(after.status, "stale");
    // A retry of the same submission writes nothing more.
    const counts = async () => [(await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_decisions").first()).n, (await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_experiments").first()).n, (await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_hypotheses").first()).n];
    const n = await counts();
    assert.deepEqual(await session.decide(s.project.id, { week: rv.week, revision: rv.pack.revision }, form), { ok: true, reused: true });
    assert.deepEqual(await counts(), n, "the retry stored nothing");
    // A drafted experiment is not run: it is not a week's tested experiment, and the retention sweep never touches it.
    assert.equal(review.weekExperiments({ experiments: mem.experiments }, 3).length, 0);
  } finally {
    f.close();
  }
});

await test("CR-T48 Service half, negatives: a student token cannot write a director decision (unknown route, nothing written); an unreviewed AI item and an item on a record that is not real are refused although the pack shows them, as for a team decision; evidence and assumptions outside the pack, a revision the director did not read, and a director outside the scope are refused; the decision is never stored without the director actor", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    // In the pack the director reads: an AI observation the team has not reviewed, and a
    // reviewed observation resting on a record the student marked simulated.
    const aiIn = await draft(f, s, [{ id: "o7", section: "observation", text: "AI가 센 관찰 (팀 검토 전)", source_refs: [`session:${s.sessions[0]}`] }], "ai");
    const sim = await f.api(`/v1/curriculum/experiments/${s.experiment.id}/notes`, { method: "POST", token: s.token, body: { ...OBSERVER, source_state: "simulated", text: "연습으로 만든 메모" } });
    assert.equal(sim.status, 201, sim.text);
    const unrealDraft = await reviewDraft(f, s, await draft(f, s, [{ id: "o8", section: "observation", text: "연습 기록에서 본 것", source_refs: [`note:${sim.json.note.id}`] }]), [{ item: "o8", action: "accept" }]);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const rv = await open(f, s, director);
    const path = `/v1/curriculum/projects/${s.project.id}/review/decision`;
    const unreviewedRef = venture.evidenceItemRef(s.experiment.id, aiIn.id, "o7");
    const unrealRef = venture.evidenceItemRef(s.experiment.id, unrealDraft.id, "o8");
    // Instrument: both are in the pack's observed section, with their marks, so the pack check
    // (ref_not_in_review) cannot be what refuses them; only the evidence rules can.
    const shown = (ref) => sectionOf(rv.pack, "observed").items.find((i) => i.sources.includes(ref))?.marks;
    assert.deepEqual([shown(unreviewedRef), shown(unrealRef)], [["unreviewed"], ["not_real"]]);
    const body = { week: 2, revision: rv.pack.revision, statement: "옵션을 줄인다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [2] };
    const n = async () => (await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_decisions").first()).n;
    const start = await n();
    const asStudent = await f.api(path, { method: "POST", token: s.token, body });
    const unknown = await f.api("/v1/cr-never-registered", { method: "POST", token: s.token, body });
    assert.deepEqual([asStudent.status, asStudent.json.error.type], [unknown.status, unknown.json.error.type], "a student gets the unknown route");
    assert.equal(await n(), start);
    // Shown in the pack, still not evidence for a person's decision (SX-45, CR-26): the team-decision rules hold for the director.
    const notReviewed = await f.api(path, { method: "POST", token: director, body: { ...body, evidence_refs: [unreviewedRef] } });
    assert.deepEqual([notReviewed.status, notReviewed.json.error.code, notReviewed.json.error.problems], [409, "unresolved_decision_refs", [`evidence_ref_not_reviewed:${unreviewedRef}`]]);
    const notReal = await f.api(path, { method: "POST", token: director, body: { ...body, evidence_refs: [unrealRef] } });
    assert.deepEqual([notReal.status, notReal.json.error.code, notReal.json.error.problems], [409, "unresolved_decision_refs", [`evidence_ref_not_real:${unrealRef}`]]);
    // An AI draft written after the pack was prepared is not in it: refused before the evidence rules (the control of the two above).
    const ai = await draft(f, s, [{ id: "o9", section: "observation", text: "AI가 센 관찰", source_refs: [`session:${s.sessions[0]}`] }], "ai");
    const outside = await f.api(path, { method: "POST", token: director, body: { ...body, evidence_refs: [venture.evidenceItemRef(s.experiment.id, ai.id, "o9")] } });
    assert.deepEqual([outside.status, outside.json.error.code], [409, "ref_not_in_review"], "not in the pack the director read");
    const assumptionAsEvidence = await f.api(path, { method: "POST", token: director, body: { ...body, evidence_refs: [s.ev("a1")] } });
    assert.deepEqual([assumptionAsEvidence.status, assumptionAsEvidence.json.error.code], [409, "ref_not_in_review"], "an assumption is cited as one, never as evidence");
    // Assumptions are cited from the pack's assumptions section only: an observation of the pack
    // cited as an assumption, and an assumption the team accepted after the pack was prepared
    // (reviewed and open, so only the pack check can refuse it).
    const observedAsAssumption = await f.api(path, { method: "POST", token: director, body: { ...body, assumption_refs: [s.ev("o1")] } });
    assert.deepEqual([observedAsAssumption.status, observedAsAssumption.json.error.code, observedAsAssumption.json.error.refs], [409, "ref_not_in_review", [s.ev("o1")]]);
    const lateDraft = await reviewDraft(f, s, await draft(f, s, [{ id: "a9", section: "assumption", text: "준비한 뒤에 받아들인 가정", source_refs: [] }]), [{ item: "a9", action: "accept" }]);
    const lateAssumption = venture.evidenceItemRef(s.experiment.id, lateDraft.id, "a9");
    const notInPack = await f.api(path, { method: "POST", token: director, body: { ...body, assumption_refs: [lateAssumption] } });
    assert.deepEqual([notInPack.status, notInPack.json.error.code, notInPack.json.error.refs], [409, "ref_not_in_review", [lateAssumption]], "an assumption outside the pack the director read");
    const old = await f.api(path, { method: "POST", token: director, body: { ...body, revision: rv.pack.revision + 7 } });
    assert.deepEqual([old.status, old.json.error.code], [409, "review_changed"]);
    const otherDirector = await f.issuer(f.otherCohort, f.other.id);
    const foreign = await f.api(path, { method: "POST", token: otherDirector, body });
    assert.equal(foreign.status, 404, "a director whose scope does not cover the team");
    const noNext = await f.api(path, { method: "POST", token: director, body: { ...body, next_experiment: { question: "", method: "x", success_criteria: [] } } });
    assert.deepEqual([noNext.status, noNext.json.error.code], [400, "hypothesis_required"]);
    assert.equal(await n(), start, "nothing was written by any refused call");
    // Positive control of this test's instrument: the same body by the director is stored, as the director's.
    const ok = await f.api(path, { method: "POST", token: director, body });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.decision.actor, "director");
    const stored = await store.getDecision(f.env.HPS_DB, ok.json.decision.id);
    assert.equal(stored.actor, "director");
    // A team decision on the same pack is not a director decision: the pack's list leaves it out.
    const team = await f.api(`/v1/curriculum/projects/${s.project.id}/decisions`, { method: "POST", token: s.token, body: { author: "user", statement: "팀이 따로 정한 것", evidence_refs: [], assumption_refs: [], affected_deck_slides: [] } });
    assert.equal(team.status, 201);
    assert.deepEqual((await open(f, s)).decisions.map((x) => x.id), [ok.json.decision.id]);
    assert.deepEqual(review.decisionsOfReview([{ ...stored, actor: "student" }], 2), [], "a decision without the director actor is not the director's");
  } finally {
    f.close();
  }
});

await test("CR-T48 Service half, retries and corrections: the same submission sent again is the stored decision (200 reused, nothing written), whatever the order of its refs; the same statement with other evidence, slides, assumptions or next experiment is a decision of its own, with its own draft", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const rv = await open(f, s, director);
    const path = `/v1/curriculum/projects/${s.project.id}/review/decision`;
    const send = (body) => f.api(path, { method: "POST", token: director, body });
    const counts = async () => [(await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_decisions").first()).n, (await f.env.HPS_DB.prepare("SELECT COUNT(*) AS n FROM cr_experiments").first()).n];
    const body = { week: 2, revision: rv.pack.revision, statement: "다음 주에 다시 시험한다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [2] };
    const first = await send(body);
    assert.equal(first.status, 201, first.text);
    const n1 = await counts();
    const retry = await send({ ...body, statement: ` ${body.statement} ` });
    assert.deepEqual([retry.status, retry.json.reused, retry.json.decision.id], [200, true, first.json.decision.id], "a retry (the statement as stored) is the stored decision");
    assert.deepEqual(await counts(), n1, "and writes nothing");
    // Corrected under the same statement: other evidence, another slide, and a next experiment.
    const corrected = { ...body, evidence_refs: [s.ev("o2"), s.ev("i1")], affected_deck_slides: [5], next_experiment: { hypothesis: "도움말 버튼이 있으면 혼자 주문한다", question: "도움말을 누르나?", method: "interview", success_criteria: ["5명 중 3명"] } };
    const second = await send(corrected);
    assert.equal(second.status, 201, second.text);
    assert.notEqual(second.json.decision.id, first.json.decision.id);
    assert.deepEqual([second.json.decision.evidence_refs, second.json.decision.affected_deck_slides, second.json.experiment?.question], [[s.ev("o2"), s.ev("i1")], [5], "도움말을 누르나?"]);
    const n2 = await counts();
    const secondRetry = await send({ ...corrected, evidence_refs: [s.ev("i1"), s.ev("o2")] });
    assert.deepEqual([secondRetry.status, secondRetry.json.reused, secondRetry.json.decision.id, secondRetry.json.experiment?.id], [200, true, second.json.decision.id, second.json.experiment.id], "its retry, refs in another order, is that decision with its draft");
    assert.deepEqual(await counts(), n2);
    // Each other field the director chose makes another decision too.
    for (const [what, change] of [["assumptions", { assumption_refs: [s.ev("a1")] }], ["slides", { affected_deck_slides: [3] }], ["next experiment", { next_experiment: { ...corrected.next_experiment, question: "도움말을 끝까지 읽나?" } }]]) {
      const r = await send({ ...body, ...change });
      assert.equal(r.status, 201, `${what}: ${r.text}`);
    }
    const mem = (await f.api(`/v1/curriculum/projects/${s.project.id}/memory`, { token: s.token })).json.memory;
    assert.equal(mem.decisions.filter((d) => d.actor === "director").length, 5);
    assert.deepEqual(mem.experiments.filter((e) => e.status === "draft").map((e) => e.question).sort(), ["도움말을 끝까지 읽나?", "도움말을 누르나?"], "a draft per decision that wrote one");
  } finally {
    f.close();
  }
});

await test("CR-T48 Service half, at the same time: two identical submissions sent together (a double press) store one decision and one draft; the one that loses answers that decision and takes back nothing it names; the store never takes back a draft a decision names", async () => {
  const f = await fixture();
  const real = f.env.HPS_DB;
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const rv = await open(f, s, director);
    const path = `/v1/curriculum/projects/${s.project.id}/review/decision`;
    const body = { week: 2, revision: rv.pack.revision, statement: "다음 주에 다시 시험한다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [2], next_experiment: { hypothesis: "옵션이 한 화면이면 혼자 주문한다", question: "혼자 주문할 수 있나?", method: "task_test", success_criteria: ["5명 중 3명"] } };
    // The first request's decision insert is held until the second request has finished: the
    // first has then written the hypothesis and the draft, and the second finds both and stores
    // the decision naming the draft.
    const seen = [];
    let release;
    const gate = new Promise((r) => (release = r));
    let reached;
    const atInsert = new Promise((r) => (reached = r));
    let held = false;
    f.env.HPS_DB = {
      prepare(sql) {
        seen.push(sql);
        const st = real.prepare(sql);
        if (held || !/^INSERT OR IGNORE INTO cr_decisions/.test(sql)) return st;
        held = true;
        return {
          bind: (...a) => {
            const b = st.bind(...a);
            return { run: async () => (reached(), await gate, b.run()), first: (...x) => b.first(...x), all: (...x) => b.all(...x) };
          },
        };
      },
      batch: (...x) => real.batch(...x),
    };
    const firstSent = f.api(path, { method: "POST", token: director, body });
    await atInsert;
    const mark = seen.length;
    const second = await f.api(path, { method: "POST", token: director, body });
    release();
    const first = await firstSent;
    f.env.HPS_DB = real;
    assert.equal(second.status, 201, second.text);
    const draftId = second.json.decision.next_experiment_id;
    assert.ok(draftId);
    assert.deepEqual([first.status, first.json.reused, first.json.decision.id, first.json.experiment?.id], [200, true, second.json.decision.id, draftId], first.text);
    assert.deepEqual(seen.slice(mark).filter((q) => /^DELETE FROM cr_(experiments|hypotheses)/.test(q)), [], "the request that lost took back nothing");
    const mem = (await f.api(`/v1/curriculum/projects/${s.project.id}/memory`, { token: s.token })).json.memory;
    assert.equal(mem.decisions.filter((d) => d.actor === "director").length, 1, "one decision");
    const drafts = mem.experiments.filter((e) => e.status === "draft");
    assert.deepEqual(drafts.map((e) => e.id), [draftId], "the draft the decision names is stored, once");
    assert.ok(mem.hypotheses.some((h) => h.id === drafts[0].hypothesis_id && h.statement === body.next_experiment.hypothesis), "with its hypothesis");
    // The store's own guard, behind the route's: a draft a decision names is never taken back;
    // one no decision names is (control).
    await store.deleteExperimentDraft(real, draftId);
    assert.ok(await store.getExperiment(real, draftId), "a draft a decision names stays");
    const unnamed = await store.createExperimentDraft(real, { id: venture.newVentureId("exp"), project_id: s.project.id, week: 3, hypothesis_id: drafts[0].hypothesis_id, question: "아무 결정도 이름을 대지 않은 초안", method: "task_test", success_criteria: ["1명"], product_version_id: drafts[0].product_version_id, now: Date.now(), key: "test:unnamed", max: 100 });
    assert.equal(unnamed.ok && unnamed.created, true);
    await store.deleteExperimentDraft(real, unnamed.experiment.id);
    assert.equal(await store.getExperiment(real, unnamed.experiment.id), null, "control: a draft no decision names is taken back");
  } finally {
    f.env.HPS_DB = real;
    f.close();
  }
});

await test("CR-T48 Service half, the Project's decision bound: a full Project refuses the director's decision (409 decision_limit) before writing anything; filled while the submission is being written, it keeps nothing of it (the draft and the hypothesis it wrote are taken back)", async () => {
  const f = await fixture();
  const real = f.env.HPS_DB;
  const bound = MEMORY_LIMITS.decisionsPerProject;
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const rv = await open(f, s, director);
    const path = `/v1/curriculum/projects/${s.project.id}/review/decision`;
    const body = { week: 2, revision: rv.pack.revision, statement: "다음 주에 다시 시험한다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [2], next_experiment: { hypothesis: "도움말이 있으면 혼자 주문한다", question: "도움말을 누르나?", method: "task_test", success_criteria: ["5명 중 3명"] } };
    const count = async (table) => Number((await real.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).bind(s.project.id).first()).n);
    const counts = async () => [await count("cr_decisions"), await count("cr_experiments"), await count("cr_hypotheses")];
    const before = await counts();
    // Full before the submission: refused before anything is written.
    MEMORY_LIMITS.decisionsPerProject = before[0];
    const full = await f.api(path, { method: "POST", token: director, body });
    assert.deepEqual([full.status, full.json?.error?.code], [409, "decision_limit"], full.text);
    assert.deepEqual(await counts(), before, "nothing written");
    // One place left, taken by a team decision that lands while the director's submission is
    // written: after its hypothesis and draft, right before its decision insert.
    MEMORY_LIMITS.decisionsPerProject = before[0] + 1;
    let team = null;
    const { db, state } = hooked(real, /^INSERT OR IGNORE INTO cr_decisions/, {
      run: async (b, st, ...x) => {
        if (st.fired++ === 0) {
          f.env.HPS_DB = real;
          team = await f.api(`/v1/curriculum/projects/${s.project.id}/decisions`, { method: "POST", token: s.token, body: { author: "user", statement: "팀이 먼저 정한 것", evidence_refs: [], assumption_refs: [], affected_deck_slides: [] } });
        }
        return b.run(...x);
      },
    });
    f.env.HPS_DB = db;
    let raced;
    try {
      raced = await f.api(path, { method: "POST", token: director, body });
    } finally {
      f.env.HPS_DB = real;
    }
    assert.equal(state.fired, 1, "the director's decision insert was reached");
    assert.equal(team?.status, 201, team?.text);
    assert.deepEqual([raced.status, raced.json?.error?.code], [409, "decision_limit"], raced.text);
    assert.deepEqual(await counts(), [before[0] + 1, before[1], before[2]], "only the team's decision stays: the director's draft and the new hypothesis are taken back");
    // Control: with room, the same submission stores its decision, its draft and its hypothesis.
    MEMORY_LIMITS.decisionsPerProject = bound;
    const stored = await f.api(path, { method: "POST", token: director, body });
    assert.equal(stored.status, 201, stored.text);
    assert.deepEqual(await counts(), [before[0] + 2, before[1] + 1, before[2] + 1]);
  } finally {
    MEMORY_LIMITS.decisionsPerProject = bound;
    f.env.HPS_DB = real;
    f.close();
  }
});

await test("director decisions downstream: a director's decision drives a Deck Builder patch and a hypothesis revision as the team's does; an AI suggestion still drives neither", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const rv = await open(f, s, director);
    const made = await f.api(`/v1/curriculum/projects/${s.project.id}/review/decision`, { method: "POST", token: director, body: { week: 2, revision: rv.pack.revision, statement: "슬라이드 3을 결과로 고친다", evidence_refs: [s.ev("o1")], assumption_refs: [], affected_deck_slides: [3] } });
    assert.equal(made.status, 201, made.text);
    const dec = made.json.decision;
    const ctx = { decisions: [{ id: dec.id, actor: "director", statement: dec.statement, affected_deck_slides: [3], evidence_refs: dec.evidence_refs }] };
    assert.deepEqual(RULES.deck_patches_affected_only(ctx, { decision_id: dec.id }, { patches: [{ slide: 3 }] }), []);
    assert.deepEqual(RULES.deck_patches_affected_only({ decisions: [{ ...ctx.decisions[0], actor: "ai" }] }, { decision_id: dec.id }, { patches: [{ slide: 3 }] }), ["$: decision_is_ai_suggestion"]);
    const revised = await f.api(`/v1/curriculum/projects/${s.project.id}/hypotheses/${s.hypothesis.id}/revisions`, { method: "POST", token: s.token, body: { revision: 1, statement: "옵션이 한 단계면 혼자 주문할 수 있다", status: "revised", decision_id: dec.id } });
    assert.equal(revised.status, 201, revised.text);
    const slide = await f.api(`/v1/curriculum/projects/${s.project.id}/slides/3`, { method: "PUT", token: s.token, body: { title: "결과", body: "한 단계", evidence_refs: [], decision_id: dec.id } });
    assert.equal(slide.status, 201, slide.text);
    const aiDec = await f.api(`/v1/curriculum/projects/${s.project.id}/decisions`, { method: "POST", token: s.token, body: { author: "ai", statement: "AI 제안", evidence_refs: [], assumption_refs: [], affected_deck_slides: [4] } });
    const aiSlide = await f.api(`/v1/curriculum/projects/${s.project.id}/slides/4`, { method: "PUT", token: s.token, body: { title: "AI", body: "", evidence_refs: [], decision_id: aiDec.json.decision.id } });
    assert.deepEqual([aiSlide.status, aiSlide.json.error.code], [409, "decision_is_ai_suggestion"]);
    const mem = (await f.api(`/v1/curriculum/projects/${s.project.id}/memory`, { token: s.token })).json.memory;
    const belief = mem.belief_changes.find((b) => b.hypothesis_id === s.hypothesis.id);
    assert.equal(belief.reason, "recorded", "a belief changed because of the director's decision is recorded");
    assert.deepEqual(memoryMod.shownAs({ actor: "director" }), "director_decision");
  } finally {
    f.close();
  }
});

// ── CR-T49 (worker D1): the four-team overview ───────────────────────────────────

await test("CR-T49: four directed teams show fresh, stale and missing correctly with zero model calls, for their own review week or the week asked; another cohort's team never appears, nor a team of the directed cohort under a profile the scope does not list, under a listed profile whose switch is off, or under a minors profile; the instrument catches a planted foreign team, and each filtered team appears once its own check passes; a revoked director token is refused (401 revoked)", async () => {
  const f = await fixture();
  const offProfile = getProfile(OFF_PROFILE);
  const minors = getProfile(MINORS_PROFILE);
  const saved = [offProfile.curriculum_runtime, minors.curriculum_runtime];
  const restore = (p, v) => (v === undefined ? delete p.curriculum_runtime : (p.curriculum_runtime = v));
  try {
    const a = await week2(f, { title: "1팀" });
    const b = await week2(f, { title: "2팀", token: await f.student("cr-b") });
    const c = await started(f, { title: "3팀", token: await f.student("cr-c") });
    const d = await week2(f, { title: "4팀", token: await f.student("cr-a") });
    for (const t of [a, b, d]) await sessionFor(f, t).session.prepare();
    // 2팀's evidence changes after preparing: stale. 3팀 never prepared: missing.
    const dr = await draft(f, b, [{ id: "o5", section: "observation", text: "한 세션이 끝까지 갔다", source_refs: [`session:${b.sessions[0]}`] }]);
    await reviewDraft(f, b, dr, [{ item: "o5", action: "accept" }]);
    // Another cohort's team, prepared, under a profile the director's scope does not cover.
    const outsider = await week2(f, { title: "다른 반", token: await f.student("hp-a", f.other.id, f.otherCohort) });
    await sessionFor(f, outsider).session.prepare();
    // Three teams of the directed cohort itself, stored as a served profile's student would store
    // them: under a profile the scope does not list (its switch on), under a listed profile whose
    // switch is off, and under a listed minors profile (its switch on; minors never pass).
    offProfile.curriculum_runtime = { enabled: false };
    minors.curriculum_runtime = { enabled: true };
    const team = async (profile, creator, title) => (await store.createProject(f.env.HPS_DB, { cohort_id: f.cohort, profile_id: profile, creator, title, now: Date.now(), max: 10 })).id;
    const unlisted = await team(f.other.id, "cr-x1", "목록에 없는 프로필");
    const switchedOff = await team(offProfile.id, "cr-x2", "스위치 꺼진 프로필");
    const minorsTeam = await team(minors.id, "cr-x3", "미성년 프로필");
    const director = await f.issuer(f.cohort, [f.profile.id, offProfile.id, minors.id]);
    const { calls, out } = await spyModelCalls(() => f.api("/v1/curriculum/reviews", { token: director }));
    assert.deepEqual(calls, [], "the overview makes no model call");
    assert.equal(out.status, 200, out.text);
    const teams = out.json.teams;
    const status = Object.fromEntries(teams.map((t) => [t.title, t.status]));
    assert.deepEqual(status, { "1팀": "fresh", "2팀": "stale", "3팀": "missing", "4팀": "fresh" });
    assert.deepEqual(teams.find((t) => t.title === "2팀").stale_sections, ["observed", "decision_needed", "next_experiment"]);
    assert.equal(teams.find((t) => t.title === "1팀").week, 2);
    // `?week=` names the week the overview reads, for every team.
    const week1 = (await f.api("/v1/curriculum/reviews?week=1", { token: director })).json.teams;
    assert.deepEqual([...new Set(week1.map((t) => t.week))], [1], "every team is read for the week asked");
    assert.deepEqual(Object.fromEntries(week1.map((t) => [t.title, t.status])), { "1팀": "missing", "2팀": "missing", "3팀": "missing", "4팀": "missing" }, "no team prepared week 1");
    assert.equal((await f.api("/v1/curriculum/reviews?week=0", { token: director })).status, 400);
    // A revoked director token sees no team's status (the same token read the overview before its revocation: control).
    const issued = await f.issuerIssued();
    const before = await f.api("/v1/curriculum/reviews", { token: issued.token });
    assert.deepEqual([before.status, before.json.teams.length], [200, 4], "control: the token reads the overview before it is revoked");
    await revokeToken(f.env.HPS_KV, issued.jti, { reason: "test", by: "test" }, 3600);
    const revoked = await f.api("/v1/curriculum/reviews", { token: issued.token });
    assert.deepEqual([revoked.status, revoked.json?.error?.code, revoked.json?.teams], [401, "revoked", undefined], "a revoked director token is refused");
    const foreign = (list) => list.filter((t) => t.cohort_id !== f.cohort || t.project_id === outsider.project.id);
    assert.deepEqual(foreign(teams), [], "no team of another cohort");
    assert.equal(out.json.truncated, false);
    // Instrument negative control: a planted overview listing the outsider is caught by the same check.
    assert.equal(foreign([...teams, { project_id: outsider.project.id, cohort_id: f.otherCohort, title: "다른 반" }]).length, 1);
    // The other cohort's own director sees only its team; a student gets the unknown route.
    const otherDirector = await f.issuer(f.otherCohort, f.other.id);
    assert.deepEqual((await f.api("/v1/curriculum/reviews", { token: otherDirector })).json.teams.map((t) => t.title), ["다른 반"]);
    assert.equal((await f.api("/v1/curriculum/reviews", { token: a.token })).status, 404);
    assert.equal(REVIEW_LIMITS.overviewProjects >= 4, true);
    // The directed cohort's own teams under the wrong profile: not one is listed.
    const filtered = [unlisted, switchedOff, minorsTeam];
    assert.deepEqual(teams.filter((t) => filtered.includes(t.project_id)).map((t) => t.title), [], "no team of a profile the scope does not list, a switch-off profile or a minors profile");
    // Positive controls: each is a real, listable team once its own check passes.
    const unlistedDirector = await f.issuer(f.cohort, [f.other.id]);
    assert.deepEqual((await f.api("/v1/curriculum/reviews", { token: unlistedDirector })).json.teams.map((t) => t.project_id), [unlisted], "a scope that lists its profile sees it");
    offProfile.curriculum_runtime = { enabled: true };
    const switchedOn = (await f.api("/v1/curriculum/reviews", { token: director })).json.teams.map((t) => t.project_id);
    assert.ok(switchedOn.includes(switchedOff), "its switch on, it is listed");
    assert.ok(!switchedOn.includes(minorsTeam), "a minors profile is not, with its switch on");
  } finally {
    restore(offProfile, saved[0]);
    restore(minors, saved[1]);
    f.close();
  }
});

// ── CR-69 with packs: a deletion takes the team's packs with it ──────────────────

await test("CR-69 with packs: deleting a participant session or an experiment's data deletes the Project's packs (the receipt counts them); a pack stored while its evidence was being deleted is taken back (409 evidence_changed)", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    assert.equal((await rows(f, s.project.id)).length, 1);
    const one = await f.api(`/v1/curriculum/experiments/${s.experiment.id}/sessions/${s.sessions[1]}`, { method: "DELETE", token: s.token });
    assert.equal(one.status, 200, one.text);
    assert.equal(one.json.receipt.review_packs_deleted, 1);
    assert.deepEqual(await rows(f, s.project.id), []);
    assert.equal((await open(f, s)).status, "missing");
    // Prepared again, then the experiment's data is deleted.
    await sessionFor(f, s).session.prepare();
    const all = await f.api(`/v1/curriculum/experiments/${s.experiment.id}`, { method: "DELETE", token: s.token });
    assert.equal(all.status, 200, all.text);
    assert.equal(all.json.receipt.review_packs_deleted, 1);
    assert.deepEqual(await rows(f, s.project.id), []);
    // The race: the drafts disappear after the pack was composed and stored (a deletion whose drop already ran).
    const t = await week2(f, { title: "경합" });
    const prep = await f.api(`/v1/curriculum/projects/${t.project.id}/review/prepare`, { method: "POST", token: t.token, body: {} });
    assert.equal(prep.status, 200, prep.text);
    const ms = prep.json.model_sections[0];
    const output = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(experimentAnswer(ms.prompt))[1]);
    setAfterReviewInsert(async (project) => {
      const prefix = participantPrefix(project.cohort_id, project.id);
      const page = await f.r2.list({ prefix });
      for (const o of page.objects) if (o.key.includes("/drafts/")) await f.r2.delete(o.key);
    });
    try {
      const commit = await f.api(`/v1/curriculum/projects/${t.project.id}/review/commit`, { method: "POST", token: t.token, body: { week: prep.json.week, base_revision: 0, outputs: { next_experiment: { input_digest: ms.input_digest, output } } } });
      assert.deepEqual([commit.status, commit.json.error.code], [409, "evidence_changed"], commit.text);
      assert.deepEqual(await rows(f, t.project.id), [], "no pack quoting deleted evidence is left");
    } finally {
      setAfterReviewInsert(undefined);
    }
    // What is left is prepared again, and nothing of the deleted evidence is in it.
    assert.equal((await sessionFor(f, t).session.prepare()).ok, true);
    const left = (await open(f, t)).pack;
    assert.deepEqual(review.evidenceRefsOf(left), []);
    // Control: without the deletion the same preparation stores its pack.
    const u = await week2(f, { title: "대조" });
    assert.equal((await sessionFor(f, u).session.prepare()).ok, true);
    assert.equal((await rows(f, u.project.id)).length, 1);
    // Without migration 0038 the deletion paths and the memory read find no pack instead of failing.
    const noTable = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1_ERROR: no such table: cr_weekly_reviews: SQLITE_ERROR"); }, all: async () => { throw new Error("D1_ERROR: no such table: cr_weekly_reviews: SQLITE_ERROR"); } }) }) };
    assert.equal(await store.dropProjectReviews(noTable, "prj-x"), 0);
    assert.deepEqual(await store.reviewSummariesOf(noTable, "prj-x"), []);
    const other = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1_ERROR: disk I/O error"); } }) }) };
    await assert.rejects(store.dropProjectReviews(other, "prj-x"), /disk I\/O/, "any other failure is not swallowed");
  } finally {
    f.close();
  }
});

await test("CR-69 with packs, the AI's suggestion: when another week's data is deleted after the commit read the records and before its insert, a pack whose suggestion quotes a statement the deletion removed is taken back (409 evidence_changed) although no section cites that statement; with nothing deleted the same preparation stores its pack (control); a suggestion kept, stale, from an earlier revision goes with that revision (the insert on top of it fails, 409 review_changed)", async () => {
  const f = await fixture();
  const real = f.env.HPS_DB;
  // One Project, week 1 then week 2. Week 1 holds an observation; week 2 an observation and an
  // open assumption. The week-2 pack cites only week 2's items, while the Experiment skill reads
  // the project-wide register, week 1's observation included.
  const W1 = "1주차에 한 명이 첫 화면에서 길을 잃었다";
  const twoWeeks = async (title) => {
    const w1 = await started(f, { title, week: 1 });
    const n1 = await note(f, w1, "1주차: 첫 화면에서 길을 잃음");
    const d1 = await reviewDraft(f, w1, await draft(f, w1, [{ id: "w1o", section: "observation", text: W1, source_refs: [`note:${n1}`] }]), [{ item: "w1o", action: "accept" }]);
    const e2 = await f.api("/v1/curriculum/experiments", { method: "POST", token: w1.token, body: { project_id: w1.project.id, product_version_id: w1.version, week: 2, question: "옵션을 혼자 고를 수 있나?", method: "task_test", success_criteria: ["5명 중 3명 완료"], hypothesis_id: w1.hypothesis.id } });
    assert.equal(e2.status, 201, e2.text);
    const w2 = { ...w1, experiment: e2.json.experiment };
    const n2 = await note(f, w2, "2주차: 옵션에서 멈춤");
    await reviewDraft(f, w2, await draft(f, w2, [{ id: "w2o", section: "observation", text: "2주차에 두 명이 옵션에서 멈췄다", source_refs: [`note:${n2}`] }, { id: "w2a", section: "assumption", text: "옵션 이름만 바꾸면 혼자 고른다", source_refs: [] }]), [{ item: "w2o", action: "accept" }, { item: "w2a", action: "accept" }]);
    // The model's answer to the week-2 prompt quotes week 1's observation in its reasoning and cites week 2's open assumption.
    const prep = await f.api(`/v1/curriculum/projects/${w1.project.id}/review/prepare`, { method: "POST", token: w1.token, body: { week: 2 } });
    assert.equal(prep.status, 200, prep.text);
    const ms = prep.json.model_sections[0];
    assert.ok(ms.prompt.includes(W1), "the model reads week 1's observation");
    const output = { ...JSON.parse(/```json\n([\s\S]*?)\n```/.exec(experimentAnswer(ms.prompt))[1]), why_riskiest: `1주차 관찰 "${W1}"을(를) 보면 가장 위험하다` };
    return { w1, w2, ref1: venture.evidenceItemRef(w1.experiment.id, d1.id, "w1o"), ms, output };
  };
  const commit = (t) => f.api(`/v1/curriculum/projects/${t.w1.project.id}/review/commit`, { method: "POST", token: t.w1.token, body: { week: 2, base_revision: 0, outputs: { next_experiment: { input_digest: t.ms.input_digest, output: t.output } } } });
  try {
    // Control: nothing deleted, the pack is stored; it quotes week 1's observation in the AI's
    // section only, and no section cites it (so the check of the cited items alone cannot see it).
    const ctl = await twoWeeks("두 주, 대조");
    const stored = await commit(ctl);
    assert.equal(stored.status, 201, stored.text);
    const pack = stored.json.review.pack;
    assert.ok(!review.evidenceRefsOf(pack).includes(ctl.ref1), "no section cites week 1's observation");
    assert.deepEqual(pack.sections.filter((x) => JSON.stringify(x).includes(W1)).map((x) => x.id), ["next_experiment"], "only the AI's suggestion quotes it");
    // The race: the student deletes week 1's data after the commit read the records and before its insert.
    const t = await twoWeeks("두 주, 경합");
    let receipt = null;
    const h = hooked(real, /^INSERT OR IGNORE INTO cr_weekly_reviews/, {
      run: async (b, state, ...x) => {
        if (state.fired++ === 0) {
          f.env.HPS_DB = real;
          const del = await f.api(`/v1/curriculum/experiments/${t.w1.experiment.id}`, { method: "DELETE", token: t.w1.token });
          assert.equal(del.status, 200, del.text);
          receipt = del.json.receipt;
          f.env.HPS_DB = h.db;
        }
        return b.run(...x);
      },
    });
    f.env.HPS_DB = h.db;
    let raced;
    try {
      raced = await commit(t);
    } finally {
      f.env.HPS_DB = real;
    }
    assert.equal(h.state.fired, 1, "the commit reached its insert");
    assert.equal(receipt?.review_packs_deleted, 0, "the deletion found no pack to drop: none was stored yet");
    assert.deepEqual([raced.status, raced.json?.error?.code], [409, "evidence_changed"], raced.text);
    assert.ok(raced.json.error.refs.includes(t.ref1), `the deleted observation is named: ${raced.text}`);
    assert.deepEqual(await rows(f, t.w1.project.id), [], "no pack quoting the deleted statement is left");
    // What is left is prepared again: week 1's statement is in no part of the new pack.
    assert.equal((await sessionFor(f, t.w1).session.prepare(2)).ok, true);
    const again = await rows(f, t.w1.project.id);
    assert.equal(again.length, 1);
    assert.ok(!again[0].doc.includes(W1), "the new pack does not quote the deleted statement");

    // A suggestion kept from an earlier context: revision 1 holds the suggestion quoting week 1;
    // then the problem changes (only the AI's section goes stale) and a metric is defined (the
    // metrics section too). A press whose model call fails stores revision 2 with the metrics
    // regenerated and the old suggestion kept, stale. When week 1's data is deleted during that
    // commit, the deletion drops revision 1 and the insert on top of it fails (409
    // review_changed), so no revision keeps the deleted statement.
    const k = await twoWeeks("두 주, 남은 제안");
    assert.equal((await commit(k)).status, 201);
    const pr = await f.api(`/v1/curriculum/projects/${k.w1.project.id}/problem`, { method: "PUT", token: k.w1.token, body: { statement: "처음 쓰는 사람은 옵션 화면에서 혼자 주문하지 못한다" } });
    assert.equal(pr.status, 200, pr.text);
    const mt = await f.api(`/v1/curriculum/projects/${k.w1.project.id}/metrics`, { method: "POST", token: k.w1.token, body: { name: "열람", metric_kind: "usage", definition: "참가 세션의 화면 열람 수", unit: "회", source: { type: "event_count", experiment_id: k.w2.experiment.id, event_kind: "page_view" } } });
    assert.equal(mt.status, 201, mt.text);
    assert.deepEqual((await open(f, k.w1, k.w1.token, 2)).stale_sections, ["metrics", "next_experiment"]);
    let keptReceipt = null;
    const kh = hooked(real, /^INSERT OR IGNORE INTO cr_weekly_reviews/, {
      run: async (b, state, ...x) => {
        if (state.fired++ === 0) {
          f.env.HPS_DB = real;
          const del = await f.api(`/v1/curriculum/experiments/${k.w1.experiment.id}`, { method: "DELETE", token: k.w1.token });
          assert.equal(del.status, 200, del.text);
          keptReceipt = del.json.receipt;
          f.env.HPS_DB = kh.db;
        }
        return b.run(...x);
      },
    });
    f.env.HPS_DB = kh.db;
    let kept;
    try {
      kept = await sessionFor(f, k.w1, { complete: async () => ({ ok: false, error: "provider_unavailable" }) }).session.prepare(2);
    } finally {
      f.env.HPS_DB = real;
    }
    assert.equal(kh.state.fired, 1, "the commit reached its insert");
    assert.equal(keptReceipt?.review_packs_deleted, 1, "the deletion dropped revision 1");
    assert.equal(kept.ok, false, JSON.stringify(kept));
    assert.deepEqual(await rows(f, k.w1.project.id), [], "no revision keeps the deleted statement");
  } finally {
    f.env.HPS_DB = real;
    f.close();
  }
});

await test("CR-69 with packs, the retention sweep (decision 6): an experiment with no link and only manual records, deleted 30 days after its last record, takes the Project's packs with it; at 29 days the pack stays", async () => {
  const f = await fixture();
  try {
    const s = await started(f, { title: "인터뷰만 한 팀", noLink: true });
    const n = await note(f, s, "참가자 A가 옵션 화면에서 멈춤");
    await reviewDraft(f, s, await draft(f, s, [{ id: "m1", section: "observation", text: "참가자 A가 옵션 화면에서 멈췄다", source_refs: [`note:${n}`] }]), [{ item: "m1", action: "accept" }]);
    const at = Date.now();
    assert.equal((await sessionFor(f, s).session.prepare()).ok, true);
    const before = await rows(f, s.project.id);
    assert.equal(before.length, 1);
    assert.ok(before[0].doc.includes("참가자 A가 옵션 화면에서 멈췄다"), "the pack quotes the manual record's statement");
    const env = { ...f.env, HPS_TEST_ORIGIN: undefined };
    assert.ok(!(await runCurriculumRetention(env, at + 29 * DAY)).deleted.includes(s.experiment.id), "29 days after the last record: not due");
    assert.equal((await rows(f, s.project.id)).length, 1, "control: the pack stays while the records it quotes do");
    assert.ok((await runCurriculumRetention(env, at + 31 * DAY)).deleted.includes(s.experiment.id), "30 days after the last record: deleted");
    assert.deepEqual(await rows(f, s.project.id), [], "the pack went with the records it quotes");
    assert.equal((await open(f, s)).status, "missing");
  } finally {
    f.close();
  }
});

await test("CR-69 with packs, a drop that fails once: the deletion is not marked done, so the next sweep removes the pack (the delete action, the no-link sweep); a session erase answers 500 and repeating it removes the pack; a session that never was still drops nothing, nor does the erased session repeated under another experiment of the Project", async () => {
  const f = await fixture();
  const real = f.env.HPS_DB;
  const logged = [];
  const consoleError = console.error;
  try {
    const env = { ...f.env, HPS_TEST_ORIGIN: undefined };
    // The student's delete action on an experiment that ran with participants.
    const s = await week2(f);
    assert.equal((await sessionFor(f, s).session.prepare()).ok, true);
    assert.ok((await rows(f, s.project.id))[0].doc.includes("세 명 중 두 명이 옵션 선택에서 멈췄다"), "control: the pack quotes the data to delete");
    const del = failingOnce(real, DROP_PACKS);
    f.env.HPS_DB = del.db;
    const deleted = await f.api(`/v1/curriculum/experiments/${s.experiment.id}`, { method: "DELETE", token: s.token });
    f.env.HPS_DB = real;
    assert.equal(del.state.fired, 1, "the planted failure fired");
    assert.equal(deleted.status, 500, deleted.text);
    assert.equal((await rows(f, s.project.id)).length, 1, "the pack outlived the failed drop");
    assert.equal((await store.getExperiment(real, s.experiment.id)).data_deletion_pending, true, "so the deletion is still pending");
    assert.ok((await runCurriculumRetention(env, Date.now())).deleted.includes(s.experiment.id), "the next sweep takes it at once");
    assert.deepEqual(await rows(f, s.project.id), [], "and the pack goes");
    const done = await store.getExperiment(real, s.experiment.id);
    assert.deepEqual([done.data_deletion_pending, typeof done.data_deleted_at], [undefined, "number"], "then the deletion is done");

    // The sweep's no-link branch: an experiment holding only manual records.
    const m = await started(f, { title: "인터뷰만 한 팀", noLink: true });
    const n = await note(f, m, "참가자 A가 옵션 화면에서 멈춤");
    await reviewDraft(f, m, await draft(f, m, [{ id: "m1", section: "observation", text: "참가자 A가 옵션 화면에서 멈췄다", source_refs: [`note:${n}`] }]), [{ item: "m1", action: "accept" }]);
    const at = Date.now();
    assert.equal((await sessionFor(f, m).session.prepare()).ok, true);
    const sweep = failingOnce(real, DROP_PACKS);
    console.error = (...a) => logged.push(a.join(" "));
    let first;
    try {
      first = await runCurriculumRetention({ ...env, HPS_DB: sweep.db }, at + 31 * DAY);
    } finally {
      console.error = consoleError;
    }
    assert.equal(sweep.state.fired, 1, "the planted failure fired");
    assert.ok(!first.deleted.includes(m.experiment.id) && logged.some((l) => l.includes("curriculum_retention_failed") && l.includes(m.experiment.id)), "the failed one is logged, not reported deleted");
    assert.equal((await rows(f, m.project.id)).length, 1, "its pack outlived the failed drop");
    assert.ok((await runCurriculumRetention(env, at + 31 * DAY + 1)).deleted.includes(m.experiment.id), "the next tick takes it again");
    assert.deepEqual(await rows(f, m.project.id), [], "and the pack goes");

    // A participant session's erase.
    const t = await week2(f, { title: "세션 지우기" });
    assert.equal((await sessionFor(f, t).session.prepare()).ok, true);
    const erase = (sid) => f.api(`/v1/curriculum/experiments/${t.experiment.id}/sessions/${sid}`, { method: "DELETE", token: t.token });
    const er = failingOnce(real, DROP_PACKS);
    f.env.HPS_DB = er.db;
    const one = await erase(t.sessions[1]);
    f.env.HPS_DB = real;
    assert.equal(er.state.fired, 1, "the planted failure fired");
    assert.equal(one.status, 500, one.text);
    assert.equal((await rows(f, t.project.id)).length, 1, "the pack outlived the failed drop");
    const again = await erase(t.sessions[1]);
    assert.equal(again.status, 200, again.text);
    assert.deepEqual([again.json.receipt.kind, again.json.receipt.already_deleted, again.json.receipt.review_packs_deleted], ["participant_session_deleted", true, 1]);
    assert.deepEqual(await rows(f, t.project.id), [], "repeating the erase removes the pack");
    // Control: a session that never was is still the unknown route, and drops nothing.
    const later = await f.api("/v1/curriculum/experiments", { method: "POST", token: t.token, body: { project_id: t.project.id, product_version_id: t.version, week: 3, question: "도움말을 누르나?", method: "interview", success_criteria: ["5명 중 3명"], hypothesis_id: t.hypothesis.id } });
    assert.equal(later.status, 201, later.text);
    assert.equal((await sessionFor(f, t).session.prepare()).ok, true);
    assert.equal((await erase("ps-" + "0".repeat(32))).status, 404);
    assert.equal((await rows(f, t.project.id)).length, 1, "nothing dropped for a session that never was");
    // The erased session repeated under another experiment of the same Project is the unknown
    // route too, as a live session there is, and drops nothing.
    const elsewhere = await f.api(`/v1/curriculum/experiments/${later.json.experiment.id}/sessions/${t.sessions[1]}`, { method: "DELETE", token: t.token });
    const unknown = await f.api("/v1/cr-never-registered", { method: "DELETE", token: t.token });
    assert.deepEqual([elsewhere.status, elsewhere.json?.error?.type, elsewhere.json?.receipt], [unknown.status, unknown.json?.error?.type, undefined], elsewhere.text);
    assert.equal((await rows(f, t.project.id)).length, 1, "nothing dropped under another experiment");
    const liveElsewhere = await f.api(`/v1/curriculum/experiments/${later.json.experiment.id}/sessions/${t.sessions[0]}`, { method: "DELETE", token: t.token });
    assert.equal(liveElsewhere.status, unknown.status, "control: a live session of the first experiment is the unknown route under the other");
    assert.equal((await erase(t.sessions[1])).status, 200, "control: under its own experiment the repeat still answers");
  } finally {
    console.error = consoleError;
    f.env.HPS_DB = real;
    f.close();
  }
});

await test("CR-69 with packs, the order of the drop: a pack stored after the deletion began and before its record scan passes its own check (every source still resolves) and is dropped after the scan, by the delete action and by the retention sweep's no-link branch", async () => {
  const f = await fixture();
  const real = f.env.HPS_TRACES;
  // The record scan of a deletion starts by writing the experiment's tombstone (local-record
  // deleteTask). Right before that write a team member prepares and stores a pack in full: its
  // sources all resolve then, so only a drop after the scan can take it (a drop before the scan
  // would leave it quoting the deleted statements).
  const packAtScan = (s) => {
    const tombstone = `/deleted/${s.experiment.id}`;
    const during = {};
    const bucket = new Proxy(real, {
      get(t, k) {
        const v = t[k];
        if (typeof v !== "function") return v;
        if (k !== "put") return (...a) => v.apply(t, a);
        return async (...a) => {
          if (!during.commit && typeof a[0] === "string" && a[0].endsWith(tombstone)) {
            during.commit = "started";
            const prep = await f.api(`/v1/curriculum/projects/${s.project.id}/review/prepare`, { method: "POST", token: s.token, body: {} });
            const ms = prep.json?.model_sections?.[0];
            const output = ms ? JSON.parse(/```json\n([\s\S]*?)\n```/.exec(experimentAnswer(ms.prompt))[1]) : undefined;
            during.commit = await f.api(`/v1/curriculum/projects/${s.project.id}/review/commit`, { method: "POST", token: s.token, body: { week: prep.json?.week, base_revision: 0, ...(ms ? { outputs: { next_experiment: { input_digest: ms.input_digest, output } } } : {}) } });
          }
          return v.apply(t, a);
        };
      },
    });
    return { bucket, during };
  };
  try {
    // The student's delete action, on an experiment that ran with participants.
    const s = await week2(f);
    const action = packAtScan(s);
    f.env.HPS_TRACES = action.bucket;
    let del;
    try {
      del = await f.api(`/v1/curriculum/experiments/${s.experiment.id}`, { method: "DELETE", token: s.token });
    } finally {
      f.env.HPS_TRACES = real;
    }
    assert.equal(del.status, 200, del.text);
    assert.equal(action.during.commit?.status, 201, `a pack was stored while the deletion ran: ${action.during.commit?.text}`);
    assert.ok(JSON.stringify(action.during.commit.json.review.pack).includes("세 명 중 두 명이 옵션 선택에서 멈췄다"), "control: it quotes the evidence the scan then deletes");
    assert.equal(del.json.receipt.review_packs_deleted, 1, "the drop after the scan takes it");
    assert.deepEqual(await rows(f, s.project.id), [], "no pack quoting the deleted evidence is left");

    // The retention sweep's no-link branch: an experiment holding only manual records, deleted
    // 30 days after its last record, with a pack stored at the start of its record scan.
    const m = await started(f, { title: "인터뷰만 한 팀", noLink: true });
    const n = await note(f, m, "참가자 A가 옵션 화면에서 멈춤");
    await reviewDraft(f, m, await draft(f, m, [{ id: "m1", section: "observation", text: "참가자 A가 옵션 화면에서 멈췄다", source_refs: [`note:${n}`] }]), [{ item: "m1", action: "accept" }]);
    const at = Date.now();
    const sweep = packAtScan(m);
    const swept = await runCurriculumRetention({ ...f.env, HPS_TEST_ORIGIN: undefined, HPS_TRACES: sweep.bucket }, at + 31 * DAY);
    assert.ok(swept.deleted.includes(m.experiment.id), "the sweep deleted the manual records");
    assert.equal(sweep.during.commit?.status, 201, `a pack was stored while the sweep ran: ${sweep.during.commit?.text}`);
    assert.ok(JSON.stringify(sweep.during.commit.json.review.pack).includes("참가자 A가 옵션 화면에서 멈췄다"), "control: it quotes the manual record the scan then deletes");
    assert.deepEqual(await rows(f, m.project.id), [], "the sweep's drop after the scan takes it");
  } finally {
    f.env.HPS_TRACES = real;
    f.close();
  }
});

// ── The coach route itself: one upstream call per stale model section (SQLite) ────

if (!D1_MODE) {
  await test("CR-T46 on the real coach route: 'Prepare Weekly Review' sends the Experiment skill's request through /v1/chat/completions with its tag and capability and no model; one upstream call per stale model section, none when only facts are stale", async () => {
    const f = await fixture();
    const { getProfile } = await import("../src/profiles/index.ts");
    const profile = getProfile("canary-sdk-contract");
    const coachEnv = createMockEnv({ withSession: false, withRoster: false });
    const now = Date.now();
    await coachEnv.HPS_KV.put(`cohort:${f.cohort}:active_session`, JSON.stringify({ session_id: "sess-review", profile_id: profile.id, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3600_000).toISOString() }));
    await coachEnv.HPS_KV.put(`cohort:${f.cohort}:roster`, JSON.stringify({ users: ["cr-a", "cr-b", "cr-c"], updated_at: new Date(now).toISOString() }));
    try {
      const s = await week2(f);
      const sent = [];
      const session = new ReviewSession({
        switchOn: () => true,
        token: async () => s.token,
        directorToken: async () => null,
        base: () => "https://service.test/v1/curriculum",
        fetchImpl: (url, init) => f.app.fetch(new Request(url, init), f.env, makeCtx()),
        projectId: () => s.project.id,
        complete: (prompt, headers) =>
          completeSkillRequest((url, init) => {
            const req = new Request(url, init);
            sent.push({ skill: req.headers.get("x-hps-skill"), capability: req.headers.get("x-hps-capability") });
            return f.app.fetch(req, coachEnv, makeCtx());
          }, { proxyUrl: "https://api.test/v1", baseHeaders: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, binding: {}, prompt, headers }),
      });
      const upstream = [];
      const real = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (/api\.openai\.com/.test(url)) {
          const body = JSON.parse(init.body);
          upstream.push({ model: body.model, prompt: body.messages.at(-1).content });
          return Response.json(openAIJsonBody({ content: experimentAnswer(String(body.messages.at(-1).content)) }));
        }
        return real(input, init);
      };
      try {
        assert.equal((await session.prepare()).ok, true);
        assert.equal(upstream.length, 1, "one upstream call for the one stale model section");
        assert.deepEqual(sent, [{ skill: "experiment@1.0.0", capability: "reasoning.high" }]);
        assert.ok(upstream[0].model, "the lesson model policy chose the model; the request named none");
        assert.equal((await open(f, s)).status, "fresh");
        const m = await f.api(`/v1/curriculum/projects/${s.project.id}/metrics`, { method: "POST", token: s.token, body: { name: "열람", metric_kind: "usage", definition: "열람 수", unit: "회", source: { type: "event_count", experiment_id: s.experiment.id, event_kind: "page_view" } } });
        assert.equal(m.status, 201);
        assert.deepEqual((await session.prepare()).regenerated, ["metrics"]);
        assert.equal(upstream.length, 1, "only facts were stale: no upstream call");
      } finally {
        globalThis.fetch = real;
      }
    } finally {
      f.close();
    }
  });
}

// ── CR-T58 (synthetic): regeneration time, provider latency apart ───────────────

await test("CR-T58 (synthetic provider latency): ten full regenerations through the App session with a normal planted provider latency pass the 30 s target and report Studio's time apart; a slow provider is a provider-caused miss, never a Studio pass; the stored revision carries the Service's own commit time, measured (a held commit stores at least the hold)", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    const NORMAL_MS = 8_000;
    const studio = [];
    for (let i = 0; i < 10; i++) {
      await store.dropProjectReviews(f.env.HPS_DB, s.project.id);
      const { session } = sessionFor(f, s, { latency: NORMAL_MS });
      const r = await session.prepare();
      assert.deepEqual(r.regenerated, [...SECTIONS], "a full regeneration: every section");
      const t = (await session.studentView()).timing;
      assert.ok(t.provider_ms >= NORMAL_MS && t.provider_ms < NORMAL_MS + 500, JSON.stringify(t));
      assert.equal(t.verdict, "pass", JSON.stringify(t));
      studio.push(t.total_ms - t.provider_ms);
    }
    studio.sort((x, y) => x - y);
    const p = (q) => studio[Math.min(studio.length - 1, Math.floor(q * studio.length))];
    console.log(`   CR-T58 synthetic: Studio share of a full regeneration over 10 runs (${D1_MODE ? "local workerd D1" : "SQLite"}): p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${studio.at(-1)} ms; provider planted at ${NORMAL_MS} ms`);
    assert.ok(studio.at(-1) < reviewView.REGENERATION_TARGET_MS - NORMAL_MS, "Studio's share leaves the target to the provider");
    // A slow provider: a miss, and its cause is the provider, not a Studio pass.
    await store.dropProjectReviews(f.env.HPS_DB, s.project.id);
    const slow = sessionFor(f, s, { latency: 35_000 });
    await slow.session.prepare();
    const st = (await slow.session.studentView()).timing;
    assert.equal(st.verdict, "miss_provider", JSON.stringify(st));
    assert.match(reviewView.timingLine(st), /30초를 넘었어요 \(AI 응답이 늦었어요\)/);
    // The verdict itself, with planted figures.
    assert.equal(reviewView.regenerationVerdict({ total_ms: 9_000, provider_ms: 8_000 }).verdict, "pass");
    assert.equal(reviewView.regenerationVerdict({ total_ms: 36_000, provider_ms: 35_000 }).verdict, "miss_provider");
    assert.equal(reviewView.regenerationVerdict({ total_ms: 41_000, provider_ms: 9_000 }).verdict, "miss_studio");
    // The stored pack carries the App's figures for later reading (CR-62 across real runs): the
    // run up to sending the commit, and the Service's own commit time, which the App could not
    // send. Read back, the two add up to the App's whole run, the network round trip apart.
    const stored = (await open(f, s)).pack.timing;
    assert.ok(stored.provider_ms >= 35_000 && stored.provider_ms < 35_500, JSON.stringify(stored));
    assert.ok(Number.isInteger(stored.commit_ms) && stored.commit_ms >= 0, JSON.stringify(stored));
    assert.ok(stored.total_ms + stored.commit_ms <= st.total_ms + 2, `${JSON.stringify(stored)} vs the App's ${JSON.stringify(st)}`);
    // `commit_ms` is the Service's own measurement: a commit whose read of the base revision is
    // held HOLD_MS stores at least that much, next to the App's figures as sent.
    const HOLD_MS = 300;
    await store.dropProjectReviews(f.env.HPS_DB, s.project.id);
    const prep = await f.api(`/v1/curriculum/projects/${s.project.id}/review/prepare`, { method: "POST", token: s.token, body: {} });
    assert.equal(prep.status, 200, prep.text);
    const ms = prep.json.model_sections[0];
    const output = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(experimentAnswer(ms.prompt))[1]);
    const real = f.env.HPS_DB;
    const held = hooked(real, /^SELECT doc FROM cr_weekly_reviews WHERE project_id = \? AND week = \? ORDER BY revision DESC LIMIT 1$/, {
      first: async (b, state, ...x) => {
        if (state.fired++ === 0) await new Promise((r) => setTimeout(r, HOLD_MS));
        return b.first(...x);
      },
    });
    f.env.HPS_DB = held.db;
    let commit;
    try {
      commit = await f.api(`/v1/curriculum/projects/${s.project.id}/review/commit`, { method: "POST", token: s.token, body: { week: prep.json.week, base_revision: 0, timing: { total_ms: 9_000, provider_ms: 8_000 }, outputs: { next_experiment: { input_digest: ms.input_digest, output } } } });
    } finally {
      f.env.HPS_DB = real;
    }
    assert.equal(commit.status, 201, commit.text);
    assert.ok(held.state.fired >= 1, "the commit read its base revision through the hold");
    const measured = (await open(f, s)).pack.timing;
    assert.deepEqual([measured.total_ms, measured.provider_ms], [9_000, 8_000], "the App's figures as sent");
    assert.ok(measured.commit_ms >= HOLD_MS - 2, `the Service's commit time covers the hold: ${JSON.stringify(measured)}`);
  } finally {
    f.close();
  }
});

// ── CR-T02 (Worker half): the review routes ──────────────────────────────────────

await test("CR-T02 inventory: every review route is in the App's switch-off inventory and mounted; an unmounted name is not", () => {
  assert.deepEqual(REVIEW_ROUTES, ["GET /v1/curriculum/projects/:id/review", "POST /v1/curriculum/projects/:id/review/prepare", "POST /v1/curriculum/projects/:id/review/commit", "POST /v1/curriculum/projects/:id/review/decision", "GET /v1/curriculum/reviews"]);
  for (const r of REVIEW_ROUTES) assert.ok(CR_SURFACES.workerRoutes.includes(r), `${r} missing from CR_SURFACES.workerRoutes`);
  const src = readFileSync(new URL("../src/routes/curriculum.ts", import.meta.url), "utf8");
  const mounted = new Set([...src.matchAll(/curriculum\.(get|post|put|delete)\("([^"]+)"/g)].map((m) => `${m[1].toUpperCase()} /v1/curriculum${m[2]}`));
  for (const r of REVIEW_ROUTES) assert.ok(mounted.has(r), `${r} is not mounted`);
  assert.ok(!mounted.has("GET /v1/curriculum/projects/:id/reviews"), "control");
});

async function switchOffProblems(f, method, path, token) {
  const opts = { method, token, ...(method === "GET" ? {} : { body: { week: 2, base_revision: 0 } }) };
  const got = await f.api(path, opts);
  const unknown = await f.api("/v1/cr-never-registered", opts);
  const shape = (r) => JSON.stringify({ s: r.status, t: r.json?.error?.type, m: r.json?.error?.message, keys: Object.keys(r.json?.error ?? {}).sort() });
  const headers = (r) => JSON.stringify([...(r.headers ?? [])].filter(([k]) => k !== "x-request-id").sort());
  const problems = [];
  if (shape(got) !== shape(unknown)) problems.push(`${method} ${path}: ${shape(got)} vs ${shape(unknown)}`);
  if (headers(got) !== headers(unknown)) problems.push(`${method} ${path}: headers differ`);
  if (got.json?.error?.path !== new URL("https://x" + path).pathname) problems.push(`${method} ${path}: path differs`);
  return problems;
}

await test("CR-T02 switch OFF: every review route, with real ids and a student, a director or no token, answers as an unknown route and writes nothing; ON they answer; the director probe the App uses follows the switch", async () => {
  const f = await fixture();
  try {
    const s = await week2(f);
    await sessionFor(f, s).session.prepare();
    const director = await f.issuer();
    const real = (p) => p.replace(":id", s.project.id);
    f.setSwitch(false);
    const before = await rows(f, s.project.id);
    for (const route of REVIEW_ROUTES) {
      const [method, path] = route.split(" ");
      for (const token of [s.token, director, undefined]) assert.deepEqual(await switchOffProblems(f, method, real(path), token), [], `${route} (${token === director ? "director" : token ? "student" : "no token"})`);
    }
    assert.deepEqual(await rows(f, s.project.id), before, "nothing written with the switch off");
    const fetchImpl = (url, init) => f.app.fetch(new Request(url, init), f.env, makeCtx());
    assert.equal(await directorAvailable({ base: "https://service.test/v1/curriculum", token: director, fetchImpl }), false, "switch off: the director command stays hidden");
    f.setSwitch(true);
    assert.equal(await directorAvailable({ base: "https://service.test/v1/curriculum", token: director, fetchImpl }), true, "switch on: shown");
    assert.equal(await directorAvailable({ base: "https://service.test/v1/curriculum", token: s.token, fetchImpl }), false, "a student token is not a director");
    assert.equal((await f.api(`/v1/curriculum/projects/${s.project.id}/review`, { token: s.token })).status, 200);
    assert.equal((await f.api(`/v1/curriculum/projects/${s.project.id}/review`, { token: director })).status, 200);
    assert.equal((await f.api("/v1/curriculum/reviews", { token: director })).status, 200);
    // A director reads and decides but never prepares (writes of the pack stay with members).
    assert.equal((await f.api(`/v1/curriculum/projects/${s.project.id}/review/prepare`, { method: "POST", token: director, body: {} })).status, 404);
    // Instrument negative control: a planted review route that answers with the switch off is caught.
    f.setSwitch(false);
    const planted = { ...f, api: (path, o) => (path.endsWith("/review-planted") ? Promise.resolve({ status: 200, json: { review: {} }, headers: new Headers() }) : f.api(path, o)) };
    assert.ok((await switchOffProblems(planted, "GET", `/v1/curriculum/projects/${s.project.id}/review-planted`, s.token)).length > 0);
  } finally {
    f.setSwitch(true);
    f.close();
  }
});

if (mf) await mf.dispose();
if (failed) {
  console.error(`\n${failed} cr-review check(s) failed`);
  process.exit(1);
}
console.log(`\ncr-review (worker ${D1_MODE ? "local workerd D1" : "SQLite"}): OK`);
