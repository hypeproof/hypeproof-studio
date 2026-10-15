// cr-browser (#1391) — the local Service and the scripted agent behind the in-app
// Experiment Browser run (e2e/curriculum-runtime/app-layer.spec.ts).
//
// Real: the Service router (worker/src/index.ts) over real HTTP, the served profile and
// the CR switch, the worker's tool injection and Anthropic → OpenAI stream translation,
// and, on the App side, everything the spec drives. Synthetic: the account, the session
// and the MODEL PROVIDER. The provider is a scripted agent: it reads the tool results the
// App sent back (the text the model would receive) and picks the next CR-06 action, so
// what it reports is computed only from what reached it through the App and the Service.
// It proves transport, enforcement and the browser behaviour, never a real model's
// judgement. Nothing here reaches production; no key is used.
//
//   node --experimental-strip-types --experimental-sqlite e2e/curriculum-runtime/app-service.mjs <port> <token-file> <on|off> [publish]
//
// `publish` (cr-publish #1393): the Service also gets SQLite D1 (schema.sql), an in-memory R2
// and HPS_TEST_ORIGIN = http://{project}.test.invalid:<port>, so the App can publish a test
// version and a request whose Host is a test origin reaches the published runtime.
//
// Every run also writes a director's issuer token for the same cohort and profile to `<token-file>.issuer` (cr-review),
// and the admin credential of this run (a random password for /admin's Basic auth) to `<token-file>.admin` (cr-e2e).
//
// Control routes (the spec only): GET /__cr/state · POST /__cr/reset · POST /__cr/plant-dangling
// (cr-evidence: removes one participant session key behind the record's back, with no tombstone,
// so a stored draft's reference stops resolving; publish mode only) · cr-e2e's GET /__cr/records,
// POST /__cr/switch and POST /__cr/plant-deck (service-control.mjs). service-gate.mjs admits them only
// from this Mac and never from a browser (a page's request carries Origin, Referer or Sec-Fetch-*), and
// HPS_CR_CONTROL=0 turns them all off (scripts/cr-dev-kit.sh runs the Service that way). A route that
// changes something takes POST only.
//
// cr-e2e (#1400) adds the scripted model's part of the PRD §14 loop (loop-app.spec.ts and the dev kit):
// `[cr:observe]`, `[cr:edit]`, `[cr:apply]` and the Evidence and Deck Builder skill prompts are answered by
// loop-coach.mjs, and its control routes and recorders are service-control.mjs; cr-e2e owns and pins both,
// and this file only calls in. Every request passes service-gate.mjs first: through a tunnel
// (cr-dev-kit.sh --phone) only the published runtime `/l/…` is reachable.
import "@hypeproof/service-testkit/test/harness/loader.mjs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { GATE_HEADER, gate } from "./service-gate.mjs";
import { createLoopCoach } from "./loop-coach.mjs";
import { createServiceControl, freshE2eState } from "./service-control.mjs";

const [portArg, tokenFile, switchArg, modeArg] = process.argv.slice(2);
// cr-e2e (scripts/cr-dev-kit.sh): HPS_CR_CONTROL=0 turns the /__cr/ control routes off (the gate refuses
// them); the dev kit's Service needs none, and a page open in the browser beside it must reach none.
const CONTROL = process.env.HPS_CR_CONTROL !== "0";
// cr-e2e (scripts/cr-dev-kit.sh --real-model): HPS_CR_MODEL=real lets the Service's own calls to
// api.anthropic.com through with ANTHROPIC_API_KEY from this process's environment, instead of the
// scripted coach. Every other outbound host stays blocked. Off by default; the specs never set it.
const REAL_MODEL = process.env.HPS_CR_MODEL === "real";
if (REAL_MODEL && !process.env.ANTHROPIC_API_KEY) {
  console.error("HPS_CR_MODEL=real needs ANTHROPIC_API_KEY in the environment");
  process.exit(2);
}
const { bootApp, createMockEnv, makeCtx, TEST_SECRET } = await import("@hypeproof/service-testkit/test/harness/index.mjs");
const { getProfile } = await import("@hypeproof/service-testkit/src/profiles/index.ts");
const { issue, issueIssuer } = await import("@hypeproof/service-testkit/src/lib/tokens.ts");
// The kit's exposed mode (one shared test origin, a tunnel: --phone) and paid mode (--real-model) sign
// tokens with a secret made for this run: TEST_SECRET is in the repository, so with it anyone who has
// the source could sign a student's or a director's token for this Service.
const SHARED_ORIGIN = !!process.env.HPS_TEST_ORIGIN && !process.env.HPS_TEST_ORIGIN.includes("{project}");
const SECRET = REAL_MODEL || SHARED_ORIGIN ? randomBytes(32).toString("hex") : TEST_SECRET;
// /admin's Basic-auth password for this run only (cr-e2e: CR-T02 walks the admin routes with it).
const ADMIN_PASSWORD = randomBytes(18).toString("base64url");

// An adult, workshop-tier profile with browser control, image paste and an observation
// format (every condition curriculumRuntimeAllowed and the validator ask for). Only the
// switch and the runtime are set here, in this process; nothing is written to the repo.
const profile = getProfile("canary-sdk-contract");
Object.assign(profile, { coach_runtime: "proxy", curriculum_runtime: { enabled: switchArg === "on" } });
const cohort = profile.session.cohort_id;
const app = await bootApp();
const env = createMockEnv({
  withSession: false,
  withRoster: false,
  environment: "development",
  secret: SECRET,
  adminPassword: ADMIN_PASSWORD,
  env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: REAL_MODEL ? process.env.ANTHROPIC_API_KEY : "synthetic-no-live-key", OPENAI_API_KEY: undefined, ANTHROPIC_PROXY_URL: undefined },
});
if (modeArg === "publish") {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { sqliteBinding, memoryR2 } = await import("@hypeproof/service-testkit/test/harness/curriculum.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync(new URL(import.meta.resolve("@hypeproof/service-testkit/schema.sql")), "utf8"));
  // The rows usage accounting references (as the classroom-ops fixture mirrors them), so a turn's usage row is not refused.
  db.prepare("INSERT OR IGNORE INTO cohorts(id, display_name) VALUES(?, ?)").run(cohort, cohort);
  db.prepare("INSERT OR IGNORE INTO sessions(id, cohort_id, profile_id, starts_at, ends_at) VALUES(?, ?, ?, ?, ?)").run("cr-app-session", cohort, profile.id, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 6 * 3600_000).toISOString());
  Object.assign(env, { HPS_DB: sqliteBinding(db), HPS_TRACES: memoryR2(), HPS_TEST_ORIGIN: process.env.HPS_TEST_ORIGIN || `http://{project}.test.invalid:${portArg}` });
}
const now = Date.now();
await env.HPS_KV.put(`cohort:${cohort}:active_session`, JSON.stringify({ session_id: "cr-app-session", profile_id: profile.id, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 6 * 3600_000).toISOString() }));
await env.HPS_KV.put(`cohort:${cohort}:roster`, JSON.stringify({ users: ["cr-adult-a"] }));
writeFileSync(tokenFile, (await issue({ u: "cr-adult-a", c: cohort, p: profile.id }, 6, SECRET)).token, { mode: 0o600 });
// cr-review (#1398): a director's issuer token whose scope covers this cohort and profile, next to
// the learner's (`<token-file>.issuer`), for the director's Weekly Review screen (CR-51, CR-53).
writeFileSync(`${tokenFile}.issuer`, (await issueIssuer({ issuer: "cr-director", scopes: [{ cohort, profiles: [profile.id] }] }, 6, SECRET)).token, { mode: 0o600 });
writeFileSync(`${tokenFile}.admin`, ADMIN_PASSWORD, { mode: 0o600 });

// ── the scripted agent ───────────────────────────────────────────────────────

const FLOW = [
  { name: "browser_click", target: ["button", "주문 시작"], expect: /음료 고르기/ },
  { name: "browser_select", target: ["combobox", "음료 고르기"], value: "아이스티", expect: /고른 음료: 아이스티/ },
  { name: "browser_click", target: ["button", "수량 늘리기"], expect: /수량: 2/ },
  { name: "browser_click", target: ["button", "장바구니에 담기"], expect: /장바구니: 2개/ },
  { name: "browser_click", target: ["button", "주문하기"], expect: /주문이 완료되었어요/ },
];
const refOf = (snapshot, role, name) => new RegExp(`\\[ref=(e\\d+)\\] ${role} "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(snapshot)?.[1] ?? null;
/** Failures (CR-08) as the model reads them: error record lines with their step. */
const failuresInText = (text) => {
  const out = [];
  for (const line of text.split("\n")) {
    // A record of an earlier request is not this request's failure (CR-08).
    if (/^- \[[a-z]+\/[a-z]+\] 이전 요청 /.test(line)) continue;
    const m = /^- \[(console|exception|network|log)\/([a-z]+)\](?: 단계 (\d+))? (.*?)(?: @ \S+)?$/.exec(line);
    if (!m || !(m[1] === "exception" || m[1] === "network" || m[2] === "error" || m[2] === "assert")) continue;
    out.push({ step: m[3] ? Number(m[3]) : null, kind: m[1], message: m[4] });
  }
  return out;
};
/** Every console/error record line of a tool result as the model read it, unparsed (CR-08 raw). */
const recordLines = (text) => text.split("\n").filter((l) => /^- \[(console|exception|network|log)\//.test(l));
const blocks = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);
const textOf = (content) => blocks(content).filter((b) => b.type === "text").map((b) => b.text).join("\n");

// cr-e2e adds its own keys (service-control.mjs `freshE2eState`): the §14 coach's observations and edits,
// the recorders' directorProbes and skillOutputs, and the Deck Builder plant.
const state = { requests: [], runs: {}, verify: [], skills: [], skillHeaders: [], ...freshE2eState() };
const coach = createLoopCoach(state, { blocks, textOf });
const e2eControl = createServiceControl({ state, profile, env, cohort, publish: modeArg === "publish" });

/** The next move for one upstream request: a tool call or the final text. */
function agent(body) {
  const msgs = body.messages ?? [];
  // The current turn starts at the last user message that carries text, not tool results.
  let start = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const b = blocks(msgs[i].content);
    if (msgs[i].role === "user" && b.some((x) => x.type === "text") && !b.some((x) => x.type === "tool_result")) { start = i; break; }
  }
  const userText = start >= 0 ? textOf(msgs[start].content) : "";
  const images = start >= 0 ? blocks(msgs[start].content).filter((b) => b.type === "image").length : 0;
  state.requests.push({ at: Date.now(), tools: (body.tools ?? []).map((t) => t.name), userText, images, system: JSON.stringify(body.system ?? "").slice(0, 200000) });
  if (/\[cr:again\]/.test(userText)) return again(msgs.slice(start + 1));
  // cr-verify (#1392): a run started from the "내 제품 테스트" panel, a fix request, a proposal.
  if (/\[Studio 제품 테스트 [^\]]+\]/.test(userText)) return verifyRun(userText, msgs.slice(start + 1));
  if (/\[hps-fix-request\/1\]/.test(userText)) {
    state.verify.push({ kind: "fix", text: userText.slice(0, 30000) });
    return { text: "[로컬 시험 응답] 그 결과를 보고 고칠게요." };
  }
  if (/\[cr:propose\]/.test(userText)) return propose(msgs.slice(start + 1));
  // cr-skills (#1396): a curriculum skill run's prompt (skill, schema, context, input).
  if (/^## Skill\n[a-z-]+@\d/m.test(userText)) return { text: skillAnswer(userText) };
  // cr-e2e (#1400): the §14 loop's own requests (loop-coach.mjs).
  if (/\[cr:observe\]/.test(userText)) return coach.observeOnce(body, msgs, msgs.slice(start + 1));
  if (/\[cr:(edit|apply)\]/.test(userText)) return { text: coach.editAnswer(userText, msgs.slice(0, Math.max(start, 0))) };
  const scenario = /\[cr:flow(?::([a-z0-9-]+))?\]/.exec(userText);
  if (!scenario) return { text: "[로컬 시험 응답] 받았어요." };
  const plant = scenario[1] ?? "";
  const key = plant || "clean";
  const after = msgs.slice(start + 1);
  const round = after.filter((m) => m.role === "assistant").length;
  const run = (state.runs[key] ??= { failedAt: null, failures: [], steps: 0, done: false, results: [], actions: [], lines: [] });
  if (round === 0) {
    Object.assign(run, { failedAt: null, failures: [], steps: 0, done: false, results: [], actions: ["navigate"], lines: [] });
    const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(JSON.stringify(body.system ?? "") + JSON.stringify(msgs))?.[0];
    if (!origin) return finish(run, 0, "미리보기 주소를 받지 못했어요");
    return { tool: "browser_navigate", input: { url: `${origin}/index.html${plant ? `?plant=${plant}` : ""}` } };
  }
  const last = blocks(after.at(-1)?.content).find((b) => b.type === "tool_result");
  const resultText = textOf(last?.content);
  run.results.push({ round, isError: last?.is_error === true, head: resultText.slice(0, 300) });
  for (const line of recordLines(resultText)) run.lines.push({ round, line });
  for (const f of failuresInText(resultText)) if (!run.failures.some((g) => g.message === f.message)) run.failures.push(f);
  const stepDone = round - 1; // round 1 answers the navigate; round k+1 answers step k
  if (last?.is_error === true || !resultText) return finish(run, Math.max(stepDone, 1), "도구 실패");
  if (stepDone >= 1 && !FLOW[stepDone - 1].expect.test(resultText)) return finish(run, stepDone, "기대한 화면이 아님");
  if (stepDone >= 1) run.steps = stepDone;
  if (stepDone === FLOW.length) return finish(run, null, "끝까지 됨");
  const step = FLOW[stepDone];
  const ref = refOf(resultText, ...step.target);
  if (!ref) return finish(run, stepDone + 1, `${step.target[1]} 요소를 찾지 못함`);
  // The executor numbers every action of the turn, the opening navigate included, so a
  // record's "단계 N" names actions[N-1]; the spec maps it back to the flow step.
  run.actions.push(step.target[1]);
  return { tool: step.name, input: { ref, ...(step.value ? { value: step.value } : {}) } };
}
/**
 * CR-08 across requests: a request that does NOT navigate. It observes the document the
 * previous request left (no browser_navigate, so the executor and its records survive),
 * then clicks the one button still on screen. Every record of the earlier request must
 * read "이전 요청", never a step of this request.
 */
function again(after) {
  const round = after.filter((m) => m.role === "assistant").length;
  const run = (state.runs.again ??= { failedAt: null, failures: [], steps: 0, done: false, results: [], actions: [], lines: [] });
  if (round === 0) {
    Object.assign(run, { failedAt: null, failures: [], steps: 0, done: false, results: [], actions: [], lines: [] });
    return { tool: "browser_observe", input: {} };
  }
  const last = blocks(after.at(-1)?.content).find((b) => b.type === "tool_result");
  const resultText = textOf(last?.content);
  run.results.push({ round, isError: last?.is_error === true, head: resultText.slice(0, 300) });
  for (const line of recordLines(resultText)) run.lines.push({ round, line });
  for (const f of failuresInText(resultText)) run.failures.push(f);
  if (last?.is_error === true || !resultText) return finish(run, round, "도구 실패");
  if (round === 1) {
    const ref = refOf(resultText, "button", "도움말 보기");
    if (!ref) return finish(run, 1, "도움말 보기 요소를 찾지 못함");
    run.actions.push("도움말 보기");
    return { tool: "browser_click", input: { ref } };
  }
  run.steps = 1;
  return finish(run, null, "끝까지 됨");
}
// ── cr-verify: the scripted agent's plans, chosen by words in the student's criterion ──
// The plan is the agent's interpretation of a criterion; the runner, not the agent, judges.
const ORDER = [
  { action: "click", target: { role: "button", name: "주문 시작" } },
  { action: "select", target: { role: "combobox", name: "음료 고르기" }, value: "아이스티" },
  { action: "click", target: { role: "button", name: "수량 늘리기" } },
  { action: "click", target: { role: "button", name: "장바구니에 담기" } },
  { action: "click", target: { role: "button", name: "주문하기" } },
];
function planFor(text) {
  if (/흔들/.test(text)) return { steps: [{ action: "navigate", path: "/index.html?plant=flaky" }, ...ORDER], expect: [{ kind: "text", text: "주문이 완료되었어요" }] };
  if (/바깥|외부/.test(text)) return { steps: [{ action: "navigate", path: "https://example.com/" }], expect: [{ kind: "text", text: "x" }] };
  if (/결제 완료/.test(text)) return { steps: ORDER, expect: [{ kind: "text", text: "결제 완료" }] };
  if (/오류/.test(text)) return { steps: ORDER, expect: [{ kind: "no_errors" }] };
  if (/주문이 완료/.test(text)) return { steps: ORDER, expect: [{ kind: "text", text: "주문이 완료되었어요" }] };
  return { steps: [ORDER[0]], expect: [{ kind: "element", role: "combobox", name: "음료 고르기" }] };
}
/** One verify_criterion per criterion of the run, in order, then a short answer. */
function verifyRun(userText, after) {
  const criteria = [...userText.matchAll(/^- ([0-9a-f-]{36}): (.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
  const round = after.filter((m) => m.role === "assistant").length;
  const last = blocks(after.at(-1)?.content).find((b) => b.type === "tool_result");
  if (round === 0) state.verify.push({ kind: "start", at: Date.now() });
  if (round > 0) state.verify.push({ kind: "result", round, isError: last?.is_error === true, text: textOf(last?.content).slice(0, 2000) });
  if (round < criteria.length) {
    const c = criteria[round];
    state.verify.push({ kind: "call", id: c.id, text: c.text, at: Date.now() });
    return { tool: "verify_criterion", input: { criterion_id: c.id, plan: JSON.stringify(planFor(c.text)) } };
  }
  return { text: `[로컬 시험 응답] 기대 조건 ${criteria.length}개를 테스트했어요. 결과는 테스트 창에 있어요.` };
}
function propose(after) {
  const round = after.filter((m) => m.role === "assistant").length;
  if (round === 0) return { tool: "verify_propose_criteria", input: { criteria: JSON.stringify(["주문 시작을 누르면 음료 고르기가 보인다"]) } };
  const last = blocks(after.at(-1)?.content).find((b) => b.type === "tool_result");
  state.verify.push({ kind: "proposed", isError: last?.is_error === true, text: textOf(last?.content).slice(0, 500) });
  return { text: "[로컬 시험 응답] 조건 하나를 제안했어요. 확인해 주세요." };
}

/**
 * cr-skills: the scripted model's answer to a skill prompt, computed only from the prompt it
 * received. "[cr:skill-bad]" in the input plants an answer that breaks the skill's rules.
 */
function skillAnswer(userText) {
  const tag = /^## Skill\n(\S+)/m.exec(userText)[1];
  const context = JSON.parse(/^## Context\n(.*)$/m.exec(userText)?.[1] ?? "{}");
  const bad = /\[cr:skill-bad\]/.test(userText);
  state.skills.push({ at: Date.now(), tag, context_keys: Object.keys(context).sort(), bad });
  if (tag.startsWith("experiment@")) {
    const open = (context.register?.assumed ?? []).find((i) => i.assumption_status === "open");
    return "```json\n" + JSON.stringify({
      ...(open ? { assumption_ref: open.id } : {}),
      assumption: open?.statement ?? "처음 쓰는 사람은 도움 없이 주문하지 못한다",
      why_riskiest: "틀리면 키오스크가 쓸모없다",
      hypothesis: "버튼이 크면 처음 쓰는 사람 5명 중 3명이 도움 없이 주문한다",
      method: "task_test",
      procedure: ["새 버전을 공개한다", "다섯 명에게 주문을 부탁한다"],
      success_criteria: bad ? ["사람들이 좋아한다"] : ["5명 중 3명이 도움 없이 주문을 마친다"],
    }) + "\n```";
  }
  // cr-e2e: the Evidence and Deck Builder skills of the §14 loop (loop-coach.mjs).
  if (tag.startsWith("evidence@")) return coach.evidenceAnswer(context);
  if (tag.startsWith("deck-builder@")) return coach.deckBuilderAnswer(context, JSON.parse(/^## Input\n(.*)$/m.exec(userText)?.[1] ?? "{}"));
  return "{}";
}

function finish(run, failedAt, why) {
  run.failedAt = failedAt;
  run.done = true;
  // The executor's "단계 N" is the Nth action of the request and action 1 is the opening
  // navigate, so action N is flow step N-1: the answer names flow steps only, the same
  // numbering as "N단계에서 멈췄어요".
  const failures = run.failures.map((f) => `${f.step === null ? "-" : Math.max(f.step - 1, 0)}단계 ${f.message}`).join(" · ") || "없음";
  return { text: `[로컬 시험 응답] ${failedAt === null ? "다섯 단계를 모두 마쳤어요" : `${failedAt}단계에서 멈췄어요 (${why})`}. 오류: ${failures}` };
}

const sse = (move, model) => {
  const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
  let s = ev("message_start", { type: "message_start", message: { id: "cr-app", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 12, output_tokens: 0 } } });
  if (move.tool) {
    s += ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_${state.requests.length}`, name: move.tool, input: {} } });
    s += ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(move.input) } });
  } else {
    s += ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    s += ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: move.text } });
  }
  s += ev("content_block_stop", { type: "content_block_stop", index: 0 });
  s += ev("message_delta", { type: "message_delta", delta: { stop_reason: move.tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 9 } });
  return s + ev("message_stop", { type: "message_stop" });
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.anthropic.com") {
    if (REAL_MODEL) return realFetch(input, init);
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const move = agent(body);
    if (!body.stream) return Response.json({ model: body.model, content: [move.tool ? { type: "tool_use", id: "toolu_x", name: move.tool, input: move.input } : { type: "text", text: move.text }], stop_reason: move.tool ? "tool_use" : "end_turn", usage: { input_tokens: 12, output_tokens: 9 } });
    return new Response(sse(move, body.model), { headers: { "content-type": "text/event-stream" } });
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`blocked outbound fetch: ${url.origin}`);
  return realFetch(input, init);
};

// cr-e2e (#1400): every request passes service-gate.mjs before the router sees it. Through a tunnel
// (cr-dev-kit.sh --phone, a shared test origin) only the published runtime `/l/…` answers; this
// Service's API and the control routes below stay on this Mac.
const GATE_SERVICE = { testOrigin: env.HPS_TEST_ORIGIN, environment: env.ENVIRONMENT, control: CONTROL };
const sendJson = (res, status, value) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
async function readBody(req) {
  const parts = [];
  for await (const p of req) parts.push(p);
  return Buffer.concat(parts);
}

/** The spec-only control routes (what service-gate.mjs admits: this Mac, not a browser, control on). */
async function control(req, res, path, search) {
  if (path === "/__cr/state") return sendJson(res, 200, state);
  // A route that changes something takes POST only: a page's <img> or link is a GET.
  if ((path === "/__cr/reset" || path === "/__cr/plant-dangling") && req.method !== "POST") return res.writeHead(405, { allow: "POST" }).end();
  if (path === "/__cr/reset") {
    Object.assign(state, { requests: [], runs: {}, verify: [], skills: [], skillHeaders: [] }, freshE2eState());
    return res.writeHead(204).end();
  }
  const body = (await readBody(req)).toString("utf8");
  if (path === "/__cr/plant-dangling" && modeArg === "publish") {
    const { project, session } = JSON.parse(body);
    const key = `curriculum/${encodeURIComponent(cohort)}/${encodeURIComponent(project)}/sessions/published/${encodeURIComponent(session)}`;
    const had = (await env.HPS_TRACES.get(key)) !== null;
    await env.HPS_TRACES.delete(key);
    return sendJson(res, 200, { removed: had });
  }
  // cr-e2e's routes: /__cr/records, /__cr/switch, /__cr/plant-deck.
  if (await e2eControl.route(req, res, path, search, body)) return;
  return res.writeHead(404).end();
}

const server = createServer(async (req, res) => {
  try {
    const g = gate({ url: req.url, headers: req.headers }, GATE_SERVICE);
    if (!g.ok) return res.writeHead(404, { [GATE_HEADER]: "refused" }).end();
    const path = g.pathname;
    if (g.kind === "local" && (path === "/__cr" || path.startsWith("/__cr/"))) return await control(req, res, path, g.search);
    const body = await readBody(req);
    // This Mac's requests go to the Service's own host. A test origin keeps its Host, so the router
    // dispatches it to the published runtime (cr-publish: `*.test.invalid`, or the ngrok host given as
    // HPS_TEST_ORIGIN for a phone); the router is handed exactly the path the gate checked.
    const host = g.kind === "local" ? `127.0.0.1:${portArg}` : (g.host ?? "no-host.invalid");
    const r = await app.fetch(new Request(`http://${host}${path}${g.search}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), env, makeCtx());
    // cr-skills: what the coach route recorded for a skill request, and whether the App named a model.
    if (req.headers["x-hps-skill"]) state.skillHeaders.push({ sent: { skill: req.headers["x-hps-skill"], capability: req.headers["x-hps-capability"], model_in_body: JSON.parse(body.toString("utf8") || "{}").model ?? null }, answered: { status: r.status, skill: r.headers.get("x-hps-skill"), capability: r.headers.get("x-hps-capability"), model: r.headers.get("x-hps-model") } });
    // cr-e2e: the director route's answers and the skill output gate's verdicts (service-control.mjs).
    await e2eControl.observe(req.method, path, r);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body) res.write(Buffer.from(chunk));
    res.end();
  } catch (e) {
    console.error("service failure", e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(Number(portArg), "127.0.0.1", () => console.log(`READY ${portArg} switch=${switchArg} model=${REAL_MODEL ? "real" : "scripted"} control=${CONTROL ? "on" : "off"}`));
