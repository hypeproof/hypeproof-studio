// A4 (spec §3.2, §3.3, §4.4, §7, §15): the consult host against a fake gateway.
//
// Each judgement ships with its controls (verification rule 2):
// - an unknown or disabled agent is refused before any HTTP call | a known one makes one;
// - the advisor is refused without a failure event this turn     | with one, it runs;
// - two parallel consults are serialized                          | the same two requests
//                                                                  without the host overlap;
// - the context holds no transcript, no undeclared key and no file outside the workspace
//                                                                  | a marker planted in the
//                                                                  workspace file is seen;
// - trial_busy is waited once (≤ 20 s) and then reported          | a lease that clears runs;
// - results stay within 2,000 characters and every refusal is typed.
// Nothing here needs node_modules or a POSIX path, so it can join the Windows smokes.
//
// Run: node --experimental-strip-types test/consult-tool.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const C = await import("../src/consultTool.ts");
const { parseServedRoster } = await import("../src/agentRoster.ts");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

// ── A workspace, and a secret outside it ────────────────────────────────────
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hps-a4-consult-")));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
const WS = path.join(scratch, "ws");
const OUTSIDE = path.join(scratch, "outside");
fs.mkdirSync(path.join(WS, "pages"), { recursive: true });
fs.mkdirSync(OUTSIDE, { recursive: true });
const SECRET = "OUTSIDE-SECRET-7f3a91";
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), SECRET);
const PAGE = [
  "<!doctype html><html lang=\"ko\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>빵집</title></head><body>",
  "<header id=\"top\"><h1>동네 빵집</h1></header>",
  "<!-- 정보블록:시작 -->",
  "<section id=\"hours\"><h2>영업시간</h2><p>매일 9시–18시</p></section>",
  "<!-- 정보블록:끝 -->",
  "<section class=\"menu list\"><h2>메뉴</h2><p>소금빵</p></section>",
  "<p>deploy token GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>",
  "</body></html>",
].join("\n");
fs.writeFileSync(path.join(WS, "index.html"), PAGE);
fs.writeFileSync(path.join(WS, "pages", "about.html"), "<h1>소개</h1>\n<p>about</p>\n");
fs.writeFileSync(path.join(WS, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
let symlinked = false;
try {
  fs.symlinkSync(path.join(OUTSIDE, "secret.txt"), path.join(WS, "notes.txt"));
  symlinked = true;
} catch {
  /* no symlink privilege (Windows): that sub-check is skipped below */
}

// ── The roster: §10.1, with the advisor enabled (the synthetic profile's choice) ──
const SERVED = {
  format: "hps-agent-roster/1", id: "homepage", version: "1.0.0", coach_brief: "검토가 필요하면 도우미에게 물어보세요.",
  checks: ["site_check", "diff_guard", "archive_before_overwrite"],
  agents: [
    { name: "coach", title: "코치", role: "coach" },
    { name: "design-reviewer", title: "검토 도우미", role: "helper", purpose: "품질 기준으로 검토한다.", trigger: "coach_consult",
      context: ["file_excerpt", "site_outline", "site_check", "learner_goal"], caps: { per_turn: 1, per_session: 6 }, enabled: true,
      model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" } },
    { name: "design-advisor", title: "설계 자문", role: "advisor", purpose: "반복 실패를 진단한다.", trigger: "deterministic_failure",
      context: ["failure_evidence", "file_excerpt", "site_check", "diff_summary", "learner_goal"], caps: { per_turn: 1, per_session: 2 }, enabled: true,
      model: { id: "claude-opus-5-5", label: "Claude Opus 5.5" } },
    { name: "site-brief", title: "이어하기 요약", role: "helper", trigger: "coach_consult", context: ["site_outline"], caps: { per_turn: 1, per_session: 2 }, enabled: false },
    { name: "goal-only", title: "목표 도우미", role: "helper", trigger: "coach_consult", context: ["learner_goal"], caps: { per_turn: 3, per_session: 9 }, enabled: true },
    { name: "aux", title: "보조", role: "aux", trigger: "cli_background" },
  ],
};
const parsed = parseServedRoster(SERVED);
assert.equal(parsed.ok, true, parsed.reason);
const ROSTER = parsed.roster;
const ADULT = { game: { template_tier: "website" } };

const REVIEW = {
  verdict: "issues",
  findings: [
    { rule: "contrast", where: "#hero .cta", severity: "must", fix: "글자색을 더 진하게" },
    { rule: "alt", where: "img.logo", severity: "should", fix: "alt 추가" },
  ],
  unverified: ["390px 실제 화면"],
};
const ADVICE = { diagnosis: "표가 390px보다 넓어요.", plan: [{ step: "표를 감싸는 div 에 overflow-x:auto" }], stop: false };
const okBody = (agent, output) => ({
  ok: true, agent, version: "1.0.0", roster: "homepage@1.0.0", model: { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  capability: "text.fast", output, request_id: "req_1",
});
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A fake gateway: records every request and how many were in flight at once. */
function gateway(answer) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = async (url, init) => {
    const call = { url: String(url), method: init?.method, headers: { ...(init?.headers ?? {}) }, body: String(init?.body ?? ""), signal: init?.signal };
    calls.push(call);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await answer(call, calls.length);
    } finally {
      inFlight--;
    }
  };
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

let uuidSeq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, "0")}`;
let seatSeq = 0;

function setup(answer, over = {}) {
  const gw = gateway(answer);
  const events = [];
  const session = over.session ?? new C.OrchestratorSession();
  if (!over.session) session.beginTurn("turn_1");
  const deps = {
    roster: ROSTER,
    profile: ADULT,
    session,
    seatKey: `seat-${++seatSeq}`,
    gateway: { url: "https://api.hypeproof-ai.xyz/v1", token: "tok-a4", turnId: "turn_1", lessonBinding: "token:0123456789abcdef", fundingSource: "pass:abc" },
    workspaceRoot: WS,
    lessonStep: "s1",
    learnerGoal: () => "우리 동네 빵집 홈페이지를 혼자 고칠 수 있게",
    fetch: gw.fetch,
    emit: (e) => events.push(e),
    newId: uuid,
    ...over,
  };
  return { gw, events, session, deps };
}
const resultOf = (r) => JSON.parse(r.content[0].text);
const reviewerOk = () => json(200, okBody("design-reviewer", REVIEW));

// ── 1. An unknown or disabled agent is refused before any HTTP call ─────────
{
  const { gw, deps, events } = setup(reviewerOk);
  for (const [agent, code] of [["design-unknown", "agent_unknown"], ["coach", "agent_unknown"], ["aux", "agent_unknown"], ["site-brief", "agent_disabled"]]) {
    const r = await C.runConsult(deps, { agent, question: "첫 화면을 검토해 주세요" });
    assert.equal(r.isError, true);
    assert.deepEqual(resultOf(r), { ok: false, agent, code, message: C.CONSULT_MESSAGES[code] });
  }
  assert.equal(gw.calls.length, 0, "no request for an unknown, coach, aux or disabled agent");
  assert.deepEqual(events.map((e) => [e.kind, e.state, e.code]), [
    ["consult", "error", "agent_unknown"], ["consult", "error", "agent_unknown"], ["consult", "error", "agent_unknown"], ["consult", "error", "agent_disabled"],
  ]);
  // Positive control: a known, enabled agent makes exactly one request.
  const r = await C.runConsult(deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.equal(r.isError, undefined);
  assert.equal(gw.calls.length, 1);
  ok("unknown, coach, aux and disabled agents are refused with a typed result and no request; a known agent makes exactly one");
}

// ── 2. The advisor is refused without a failure event ───────────────────────
{
  const advisorOk = () => json(200, { ...okBody("design-advisor", ADVICE), model: { id: "claude-opus-5-5", label: "Claude Opus 5.5" } });
  const { gw, deps, session } = setup(advisorOk);
  const r = await C.runConsult(deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" });
  assert.equal(resultOf(r).code, "not_triggered");
  assert.equal(gw.calls.length, 0, "no request without a recorded failure");
  // One Edit error is not F3; the second on the same file is.
  assert.equal(session.recordEditError("index.html"), null);
  assert.equal(resultOf(await C.runConsult(deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" })).code, "not_triggered");
  assert.equal(session.recordEditError("index.html").id, "F3");
  // Positive control: with the failure recorded this turn, the advisor runs, and sees it.
  const r2 = await C.runConsult(deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" });
  assert.equal(resultOf(r2).ok, true);
  assert.equal(gw.calls.length, 1);
  const sent = JSON.parse(gw.calls[0].body);
  assert.deepEqual(sent.context.failure_evidence.map((f) => f.id), ["F3"]);
  assert.equal(resultOf(r2).model, "Claude Opus 5.5");
  // A failure of an earlier turn does not carry over…
  session.beginTurn("turn_2");
  const g2 = setup(advisorOk, { session });
  assert.equal(resultOf(await C.runConsult(g2.deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" })).code, "not_triggered");
  // …except F5: the previous turn ended with error_max_turns.
  session.noteTurnEnd("error_max_turns");
  session.beginTurn("turn_3");
  assert.deepEqual(session.failuresThisTurn().map((f) => f.id), ["F5"]);
  assert.equal(resultOf(await C.runConsult(g2.deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" })).ok, true);
  ok("advisor: refused (no request) until a failure is recorded this turn; one Edit error is not F3, two are; F5 carries to the next turn only");
}

// ── 3. Two parallel consults are serialized ─────────────────────────────────
{
  const slow = async (call) => {
    await new Promise((r) => setTimeout(r, 40));
    const agent = call.url.match(/agents\/([^/]+)\/run/)[1];
    return json(200, okBody(agent, agent === "design-advisor" ? ADVICE : REVIEW));
  };
  const { gw, deps, session } = setup(slow);
  session.recordFailure({ id: "F1", detail: "planted", path: "index.html" });
  const [a, b] = await Promise.all([
    C.runConsult(deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" }),
    C.runConsult(deps, { agent: "design-advisor", question: "왜 계속 넘치나요?" }),
  ]);
  assert.equal(resultOf(a).ok, true);
  assert.equal(resultOf(b).ok, true);
  assert.equal(gw.calls.length, 2);
  assert.equal(gw.maxInFlight(), 1, "one helper at a time");
  // Negative control: the same two requests sent without the host do overlap, so the
  // instrument can see a parallel pair.
  const raw = gateway(slow);
  await Promise.all(["design-reviewer", "design-advisor"].map((agent) =>
    C.postAgentRun({ fetch: raw.fetch, gatewayUrl: deps.gateway.url, token: "t", roster: "homepage@1.0.0", agent, callId: uuid(), body: "{}" })));
  assert.equal(raw.maxInFlight(), 2, "control: without the mutex the two run at once");
  // A parallel pair for one agent with a cap of one per turn: one request, one cap_reached.
  const one = setup(slow);
  const pair = await Promise.all([1, 2].map(() => C.runConsult(one.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })));
  assert.deepEqual(pair.map((r) => (resultOf(r).ok ? "ok" : resultOf(r).code)).sort(), ["cap_reached", "ok"]);
  assert.equal(one.gw.calls.length, 1, "the cap is re-checked inside the mutex");
  // The mutex is per seat: another seat is not held up, and a failing run releases it.
  let release;
  const held = C.withConsultMutex("seat-x", () => new Promise((r) => (release = r)));
  let otherRan = false;
  await C.withConsultMutex("seat-y", async () => (otherRan = true));
  assert.equal(otherRan, true);
  release();
  await held;
  await assert.rejects(C.withConsultMutex("seat-x", async () => { throw new Error("boom"); }));
  assert.equal(await C.withConsultMutex("seat-x", async () => "next"), "next", "a throwing run releases the seat");
  ok("serialized: two parallel consults never overlap (control: raw requests do); a parallel pair cannot both pass a cap of one; per seat, released on throw");
}

// ── 4. The context: declared keys only, no transcript, nothing outside ──────
{
  const { gw, deps } = setup(reviewerOk);
  const TRANSCRIPT = "TRANSCRIPT-MARKER-91c2";
  // The consult input is all the coach controls. Even a question quoting the transcript
  // name, or extra fields, add nothing beyond the declared keys.
  await C.runConsult(deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요", history: TRANSCRIPT, context: { transcript: TRANSCRIPT } });
  const body = JSON.parse(gw.calls[0].body);
  assert.deepEqual(Object.keys(body), ["question", "context"]);
  assert.deepEqual(Object.keys(body.context).sort(), ["file_excerpt", "learner_goal", "site_check", "site_outline"], "exactly the reviewer's declared keys");
  assert.ok(!gw.calls[0].body.includes(TRANSCRIPT), "no transcript, whatever the input carried");
  assert.equal(body.context.file_excerpt[0].path, "index.html", "index.html by default");
  assert.match(body.context.file_excerpt[0].text, /영업시간/);
  assert.ok(!gw.calls[0].body.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "secrets in the page are scrubbed");
  assert.match(gw.calls[0].body, /가려짐/);
  assert.deepEqual(body.context.site_outline.info_block, { start_line: 3, end_line: 5 });
  assert.deepEqual(body.context.site_outline.sections.map((s) => s.id ?? s.class), ["top", "hours", "menu list"]);
  assert.deepEqual(body.context.site_check, { verdict: "unverified", path: "index.html" }, "no check this turn: unverified, never a pass");
  assert.equal(body.context.learner_goal, "우리 동네 빵집 홈페이지를 혼자 고칠 수 있게");
  // Negative control: a marker that IS in the workspace file is seen, so the absence above
  // is a real absence.
  fs.writeFileSync(path.join(WS, "pages", "marked.html"), `<p>${TRANSCRIPT}</p>`);
  const g2 = setup(reviewerOk);
  await C.runConsult(g2.deps, { agent: "design-reviewer", question: "이 페이지를 봐 주세요", focus: { files: ["pages/marked.html"] } });
  assert.ok(g2.gw.calls[0].body.includes(TRANSCRIPT), "control: the instrument sees a planted marker");
  // An agent that declares only learner_goal sends no file, though index.html exists.
  const g3 = setup(() => json(200, okBody("goal-only", { verdict: "pass", findings: [] })));
  await C.runConsult(g3.deps, { agent: "goal-only", question: "목표에 맞나요?" });
  assert.deepEqual(Object.keys(JSON.parse(g3.gw.calls[0].body).context), ["learner_goal"]);
  ok("context: exactly the declared keys; no transcript (control: a planted marker is seen); secrets scrubbed; no check → unverified");

  // Files outside the workspace refuse the whole consult, before any request.
  const g4 = setup(reviewerOk);
  const outside = ["../outside/secret.txt", path.join(OUTSIDE, "secret.txt"), "pages/../../outside/secret.txt", "..\\outside\\secret.txt", "C:/outside/secret.txt", ""];
  if (symlinked) outside.push("notes.txt");
  for (const f of outside) {
    const r = await C.runConsult(g4.deps, { agent: "design-reviewer", question: "이 파일을 봐 주세요", focus: { files: [f] } });
    assert.equal(resultOf(r).code, "context_invalid", `${JSON.stringify(f)} is refused`);
  }
  assert.equal(g4.gw.calls.length, 0, "no request carried any of them");
  // A `..` segment is refused even when it would land inside the workspace: the rule is
  // "a plain workspace-relative path", not "whatever resolves inside".
  for (const f of ["pages/../index.html", "./pages/./about.html", "pages//about.html"]) {
    assert.equal(resultOf(await C.runConsult(g4.deps, { agent: "design-reviewer", question: "이 파일을 봐 주세요", focus: { files: [f] } })).code, "context_invalid", f);
  }
  // A file that is not text, or does not exist, is refused too.
  for (const f of ["logo.png", "missing.html"]) {
    assert.equal(resultOf(await C.runConsult(g4.deps, { agent: "design-reviewer", question: "이 파일을 봐 주세요", focus: { files: [f] } })).code, "context_invalid");
  }
  assert.equal(g4.gw.calls.length, 0);
  // Positive control: a nested workspace file is accepted.
  await C.runConsult(g4.deps, { agent: "design-reviewer", question: "소개 페이지를 봐 주세요", focus: { files: ["./pages/about.html"] } });
  assert.equal(g4.gw.calls.length, 1);
  assert.equal(JSON.parse(g4.gw.calls[0].body).context.file_excerpt[0].path, "pages/about.html");
  assert.ok(!g4.gw.calls.some((c) => c.body.includes(SECRET)), "the outside secret never left");
  ok(`containment: ${outside.length} outside, absolute, traversal${symlinked ? ", symlinked" : ""} and empty paths, a binary and a missing file are refused before any request; a nested file is accepted`);
}

// ── 5. trial_busy is waited once ────────────────────────────────────────────
{
  const busy = () => json(429, { error: { code: "trial_busy", type: "rate_limit_error", message: "이미 실행 중인 요청이 있습니다." } });
  const waits = [];
  const sleep = async (ms) => void waits.push(ms);

  // The lease clears during the wait: the consult runs.
  const clears = setup((_, n) => (n <= 2 ? busy() : reviewerOk()), { sleep });
  const r = await C.runConsult(clears.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.equal(resultOf(r).ok, true);
  assert.equal(clears.gw.calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
  const callIds = clears.gw.calls.map((c) => c.headers["x-hps-agent-call"]);
  assert.equal(new Set(callIds).size, 1, "every attempt is the same call (one idempotency key)");
  assert.deepEqual(clears.session.usage("design-reviewer"), { turn: 1, session: 1 }, "one use, not three");

  // Held for the whole wait: one wait of at most 20 s, then `busy`.
  waits.length = 0;
  const held = setup(busy, { sleep });
  const rb = await C.runConsult(held.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.deepEqual(resultOf(rb), { ok: false, agent: "design-reviewer", code: "busy", message: C.CONSULT_MESSAGES.busy });
  assert.equal(waits.reduce((a, b) => a + b, 0), C.CONSULT_BUSY_WAIT_MS, "one wait, 20 s in all");
  assert.equal(held.gw.calls.length, 1 + C.CONSULT_BUSY_RETRY_DELAYS_MS.length);
  assert.deepEqual(held.session.usage("design-reviewer"), { turn: 0, session: 0 }, "a busy consult uses no cap");
  // …and the next consult starts its own wait: the lease is the coach's, not a fault.
  waits.length = 0;
  held.gw.calls.length = 0;
  assert.equal(resultOf(await C.runConsult(held.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).code, "busy");
  assert.equal(waits.length, C.CONSULT_BUSY_RETRY_DELAYS_MS.length);

  // A shorter window cuts the schedule: never a retry past it, never a zero-length wait.
  waits.length = 0;
  const short = setup(busy, { sleep, busyWaitMs: 5000 });
  assert.equal(resultOf(await C.runConsult(short.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).code, "busy");
  assert.deepEqual(waits, [2000, 3000], "the window bounds the wait");
  assert.equal(short.gw.calls.length, 3);

  // Busy, then another error: no more waiting, the error is the answer.
  waits.length = 0;
  const other = setup((_, n) => (n === 1 ? busy() : json(503, { error: { code: "agent_model_unavailable" } })), { sleep });
  assert.equal(resultOf(await C.runConsult(other.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).code, "agent_model_unavailable");
  assert.equal(other.gw.calls.length, 2);
  assert.deepEqual(waits, [2000]);
  // A spent pass is never waited for (it does not come back by retrying).
  waits.length = 0;
  const spent = setup(() => json(429, { error: { code: "trial_exhausted", message: "이용권의 AI 요청 횟수를 모두 썼습니다." } }, { "x-should-retry": "false" }), { sleep });
  const rs = await C.runConsult(spent.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.equal(resultOf(rs).code, "trial_exhausted");
  assert.equal(resultOf(rs).message, "이용권의 AI 요청 횟수를 모두 썼습니다.", "the Service's own line for a spent allowance");
  assert.equal(spent.gw.calls.length, 1);
  assert.deepEqual(waits, []);
  // A stopped turn stops waiting.
  const controller = new AbortController();
  const stopped = setup(busy, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  const t0 = Date.now();
  await C.runConsult(stopped.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.ok(Date.now() - t0 < 1000, "an abort ends the wait at once");
  ok("trial_busy: one wait (2+4+6+8 s = 20 s) with the same call id, then `busy` with no cap used; a lease that clears runs; another error or a spent pass is not waited for; an abort stops the wait");
}

// ── The request and the answers ─────────────────────────────────────────────
{
  const { gw, deps, events } = setup(reviewerOk);
  const r = await C.runConsult(deps, { agent: "design-reviewer", question: "  첫 화면을 검토해 주세요  " });
  const call = gw.calls[0];
  assert.equal(call.url, "https://api.hypeproof-ai.xyz/v1/agents/design-reviewer/run", "the /v1 base, as the SDK's ANTHROPIC_BASE_URL");
  assert.equal(call.method, "POST");
  assert.deepEqual(call.headers, {
    authorization: "Bearer tok-a4",
    "content-type": "application/json",
    accept: "application/json",
    "x-hps-orchestrator": "hps-agent-roster/1",
    "x-hps-roster": "homepage@1.0.0",
    "x-hps-agent-call": call.headers["x-hps-agent-call"],
    "x-hps-turn-id": "turn_1",
    "x-hps-lesson-binding": "token:0123456789abcdef",
    "x-hps-funding-source": "pass:abc",
  });
  assert.match(call.headers["x-hps-agent-call"], /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(call.body).question, "첫 화면을 검토해 주세요");
  assert.ok(Buffer.byteLength(call.body) <= C.CONSULT_BODY_BYTES_MAX);
  assert.deepEqual(resultOf(r), {
    ok: true, agent: "design-reviewer", title: "검토 도우미", version: "1.0.0", model: "Claude Haiku 5.5", request_id: "req_1", output: REVIEW,
  });
  // Spec §5.2: one consult line, running → done, with the outcome in Korean.
  assert.deepEqual(events.map((e) => [e.kind, e.id === events[0].id, e.state, e.label]), [
    ["consult", true, "running", "🔎 검토 도우미 · Claude Haiku 5.5 — 묻는 중"],
    ["consult", true, "done", "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개"],
  ]);
  // Header values that fail their rule are left out, never sent broken.
  const h = C.agentRunHeaders({ token: "t", roster: "homepage@1.0.0", callId: "not-a-uuid", turnId: "bad id", lessonBinding: "nope", fundingSource: "-x" });
  assert.deepEqual(Object.keys(h).sort(), ["accept", "authorization", "content-type", "x-hps-orchestrator", "x-hps-roster"]);
  assert.equal(C.agentRunUrl("http://localhost:8787/v1/", "design-reviewer"), "http://localhost:8787/v1/agents/design-reviewer/run");

  const cases = [
    [() => json(409, { error: { code: "roster_changed" } }), "roster_changed", false],
    [() => json(422, { error: { code: "agent_output_invalid", problems: ["where_in_excerpt"] } }), "agent_output_invalid", true],
    [() => json(422, { error: { code: "context_invalid" } }), "context_invalid", false],
    [() => json(503, { error: { code: "agent_model_unavailable" } }), "agent_model_unavailable", false],
    [() => json(404, { error: "not found" }), "orchestrator_off", false],
    [() => json(403, { code: "minor_cohort", message: "x" }), "orchestrator_off", false],
    [() => json(502, { error: { code: "upstream" } }), "upstream", false],
    [() => json(500, {}), "upstream", true],
    [() => { throw new TypeError("fetch failed"); }, "offline", true],
    [() => json(200, { ok: true, agent: "design-advisor", output: {} }), "upstream", true],
    [() => json(200, { ok: true, agent: "design-reviewer", output: "text" }), "upstream", true],
  ];
  for (const [answer, code, counted] of cases) {
    const s = setup(answer);
    const res = await C.runConsult(s.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
    assert.equal(resultOf(res).code, code, `→ ${code}`);
    assert.equal(res.isError, true);
    assert.equal(s.session.usage("design-reviewer").turn, counted ? 1 : 0, `${code}: cap ${counted ? "used" : "not used"}`);
    assert.equal(s.gw.calls.length, 1, "nothing is retried");
  }
  // The Service's cap is final: refused locally from then on, without asking again.
  const capped = setup(() => json(429, { error: { code: "agent_cap_reached" } }));
  assert.equal(resultOf(await C.runConsult(capped.deps, { agent: "goal-only", question: "목표에 맞나요?" })).code, "cap_reached");
  assert.equal(resultOf(await C.runConsult(capped.deps, { agent: "goal-only", question: "목표에 맞나요?" })).code, "cap_reached");
  assert.equal(capped.gw.calls.length, 1);
  // A timeout is upstream, within the client ceiling.
  const hung = setup((call) => new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted")))), { httpTimeoutMs: 30 });
  assert.equal(resultOf(await C.runConsult(hung.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).code, "upstream");
  ok("request: URL, method, the §4.1 headers (bad values left out), body ≤ 48 KB; answers: §3.3 JSON, Service codes mapped, the cap counted only when the agent may have run, nothing retried");
}

// ── Caps, input, minors, and the result size ────────────────────────────────
{
  const { gw, deps, session } = setup(reviewerOk);
  await C.runConsult(deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" });
  assert.equal(resultOf(await C.runConsult(deps, { agent: "design-reviewer", question: "다시 봐 주세요" })).code, "cap_reached", "per turn 1");
  for (let t = 2; t <= 6; t++) {
    session.beginTurn(`turn_${t}`);
    assert.equal(resultOf(await C.runConsult(deps, { agent: "design-reviewer", question: "새 섹션을 봐 주세요" })).ok, true, `turn ${t}`);
  }
  session.beginTurn("turn_7");
  assert.equal(resultOf(await C.runConsult(deps, { agent: "design-reviewer", question: "새 섹션을 봐 주세요" })).code, "cap_reached", "per session 6");
  assert.equal(gw.calls.length, 6);

  const g = setup(reviewerOk);
  for (const input of [
    { agent: "design-reviewer", question: "짧" },
    { agent: "design-reviewer", question: "가".repeat(401) },
    { agent: "design-reviewer" },
    { question: "첫 화면을 검토해 주세요" },
    { agent: "design-reviewer", question: "첫 화면을 검토해 주세요", focus: { files: ["a.html", "b.html", "c.html", "d.html"] } },
    { agent: "design-reviewer", question: "첫 화면을 검토해 주세요", focus: { anchors: Array.from({ length: 6 }, (_, i) => `#a${i}`) } },
    { agent: "design-reviewer", question: "첫 화면을 검토해 주세요", focus: "index.html" },
    "design-reviewer",
    null,
  ]) {
    const res = await C.runConsult(g.deps, input);
    assert.equal(resultOf(res).code, "context_invalid", JSON.stringify(input));
  }
  assert.equal(g.gw.calls.length, 0);

  for (const profile of [{ game: { template_tier: "kids-basic" } }, { minor_cohort: true, game: { template_tier: "website" } }, {}]) {
    const m = setup(reviewerOk, { profile });
    assert.equal(resultOf(await C.runConsult(m.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).code, "orchestrator_off");
    assert.equal(m.gw.calls.length, 0, "a minor or unknown tier never consults");
  }

  const huge = { verdict: "issues", findings: Array.from({ length: 40 }, (_, i) => ({ rule: "contrast", where: `#s${i} .x`, severity: "must", fix: "고".repeat(140) })), unverified: ["u".repeat(80)] };
  const big = setup(() => json(200, okBody("design-reviewer", huge)));
  const text = (await C.runConsult(big.deps, { agent: "design-reviewer", question: "첫 화면을 검토해 주세요" })).content[0].text;
  assert.ok(text.length <= C.CONSULT_RESULT_MAX, `≤ 2,000 characters (${text.length})`);
  const parsedBig = JSON.parse(text);
  assert.equal(parsedBig.ok, true);
  assert.equal(parsedBig.truncated, true);
  assert.ok(parsedBig.output.findings.length >= 1 && parsedBig.output.findings.length < 40);
  ok("caps: 1 per turn and 6 per session counted host-side; bad input refused without a request; minors and unknown tiers refused; a large answer is cut to ≤ 2,000 characters, marked");
}

// ── Excerpts of a large file ────────────────────────────────────────────────
{
  const lines = Array.from({ length: 4000 }, (_, i) => `<p>줄 ${i + 1} ${"내용".repeat(10)}</p>`);
  lines[1999] = "<section id=\"prices\"><h2>가격</h2></section>";
  lines[3499] = "<!-- 정보블록:시작 -->";
  const big = lines.join("\n");
  fs.writeFileSync(path.join(WS, "big.html"), big);
  const ex = C.fileExcerpts("big.html", big, ["#prices", "정보블록"], C.CONSULT_EXCERPT_BYTES_MAX);
  assert.deepEqual(ex.map((e) => e.start_line), [2000 - C.ANCHOR_WINDOW_LINES, 3500 - C.ANCHOR_WINDOW_LINES], "±40 lines around each anchor");
  assert.ok(ex.every((e) => e.truncated === true));
  assert.ok(ex[0].text.split("\n").length === 2 * C.ANCHOR_WINDOW_LINES + 1);
  assert.match(ex[0].text, /id="prices"/);
  const head = C.fileExcerpts("big.html", big, [], 1000);
  assert.equal(head.length, 1);
  assert.equal(head[0].start_line, 1);
  assert.ok(Buffer.byteLength(head[0].text) <= 1000, "no anchors: the head, within the budget");
  // A page written on one line is cut around the anchor.
  const oneLine = "<p>x</p>".repeat(20000) + "<section id=\"hours\">영업</section>" + "<p>y</p>".repeat(20000);
  const ol = C.fileExcerpts("one.html", oneLine, ["#hours"], 8000);
  assert.equal(ol.length, 1);
  assert.match(ol[0].text, /id="hours"/);
  assert.ok(Buffer.byteLength(ol[0].text) <= 8000);
  // Three files share 40 KB, the small ones whole.
  const g = setup(reviewerOk);
  await C.runConsult(g.deps, { agent: "design-reviewer", question: "세 파일을 봐 주세요", focus: { files: ["big.html", "pages/about.html", "index.html"], anchors: ["#prices"] } });
  const sent = JSON.parse(g.gw.calls[0].body).context.file_excerpt;
  const total = sent.reduce((s, e) => s + Buffer.byteLength(e.text), 0);
  assert.ok(total <= C.CONSULT_EXCERPT_BYTES_MAX, `excerpts ≤ 40 KB (${total})`);
  assert.deepEqual([...new Set(sent.map((e) => e.path))], ["big.html", "pages/about.html", "index.html"]);
  assert.equal(sent.find((e) => e.path === "pages/about.html").truncated, undefined, "a small file goes whole");
  assert.ok(Buffer.byteLength(g.gw.calls[0].body) <= C.CONSULT_BODY_BYTES_MAX);
  ok("excerpts: ±40-line windows around anchors in file order, the head without anchors, a one-line page cut around its anchor; three files share 40 KB, small ones whole; the body stays ≤ 48 KB");
}

// ── The tool definition ─────────────────────────────────────────────────────
{
  const agents = (await import("../src/agentRoster.ts")).consultableAgents(ROSTER);
  assert.deepEqual(agents.map((a) => a.name), ["design-reviewer", "design-advisor", "goal-only"]);
  const desc = C.consultToolDescription(ROSTER, agents);
  assert.ok(desc.startsWith("검토가 필요하면 도우미에게 물어보세요."), "the Service's brief first");
  assert.match(desc, /- design-reviewer \(검토 도우미\): 품질 기준으로 검토한다\. \[한 턴 1번, 세션 6번\]/);
  assert.match(desc, /- design-advisor \(설계 자문\): 반복 실패를 진단한다\. \[확인 도구가 실패를 기록한 턴에만 · 한 턴 1번, 세션 2번\]/);
  assert.ok(!desc.includes("site-brief"), "a disabled agent is not offered");
  assert.match(desc, /대화 기록은 보내지 않는다/);
  const mk = (d) => ({ d, min: (n) => mk(`${d}.min(${n})`), max: (n) => mk(`${d}.max(${n})`), optional: () => mk(`${d}?`) });
  const z = { string: () => mk("s"), enum: (v) => mk(`enum(${v.join("|")})`), object: (o) => mk(`{${Object.entries(o).map(([k, v]) => `${k}:${v.d}`).join(",")}}`), array: (i) => mk(`[${i.d}]`) };
  const shape = C.consultInputSchema(z, agents);
  assert.deepEqual(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.d])), {
    agent: "enum(design-reviewer|design-advisor|goal-only)",
    question: "s.min(4).max(400)",
    focus: "{files:[s].max(3)?,anchors:[s].max(5)?}?",
  });
  // A zod without enum/object/array still yields a usable schema; the handler re-checks.
  assert.deepEqual(Object.keys(C.consultInputSchema({ string: () => mk("s") }, agents)), ["agent", "question"]);
  const registered = [];
  const factory = { tool: (...a) => (registered.push(a), a[0]), createSdkMcpServer: (o) => o };
  assert.equal(C.consultMcpTool(factory, z, ROSTER, [], async () => ({ content: [] })), null, "no consultable agent → no tool");
  assert.equal(C.consultMcpTool(factory, z, ROSTER, agents, async () => ({ content: [] })), "consult");
  assert.equal(registered[0][0], "consult", "the short name; the server prefixes mcp__hypeproof__");
  ok("tool: the Service's brief, then each consultable agent with its trigger and caps; the zod enum lists only them; no consultable agent → no tool");
}

console.log(`\n${passed} consult-tool checks passed`);
