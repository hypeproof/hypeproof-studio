// SX (학습 경험 우선 Studio) — a local Service with one learner seat that runs the task flow
// (SX-55): a `hps-observation/2` profile and a frozen session design that has a mission.
//
//   node --experimental-strip-types --experimental-sqlite e2e/sx/sx-service.mjs <port> <token-file> [completion ids, default c1]
//
// Real: the Service router (worker/src/index.ts) over real HTTP, `/v1/profile` serving the
// frozen lesson to a lesson-pinned seat, `/v1/observations/context`, the coach route.
// Synthetic: the account, the class session, and the MODEL, which answers every turn with one
// fixed line. Nothing reaches production and no key is used.
//
// The lesson is `worker/test/fixtures/session-design/week-3.json`, frozen as written except
// that `learning.completion` keeps only the ids given (default `c1`, "기대 조건을 시험 전에
// 적었다"), so the whole flow can be walked by hand from the evidence drawer. The profile is
// `canary-sdk-contract`, the one profile that declares `/2` today; this process sets its coach
// runtime to the proxy so the fixed-line model answers. Nothing is written to the repo.
//
// The seat is written the way the frozen version route would leave it (an `authoring_versions`
// row and a lesson-pinned token) without the authoring, rehearsal and confirmation steps: those
// are Chalk's contract, not the learner's screen this Service exists to show.
//
// Control routes (specs only): GET /__sx/state — the turns the model answered; GET /__sx/hold?ms=N
// — the next streamed turn starts at once and holds its reply for N ms (at most 30 s), so a spec
// can look at the screen while the coach is answering.
import "../../worker/test/harness/loader.mjs";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const [portArg, tokenFile, completionArg = "c1"] = process.argv.slice(2);
if (!portArg || !tokenFile) throw new Error("usage: sx-service.mjs <port> <token-file> [completion ids]");
const { bootApp, createMockEnv, makeCtx, TEST_SECRET } = await import("../../worker/test/harness/index.mjs");
const { sqliteBinding } = await import("../../worker/test/harness/curriculum.mjs");
const { getProfile } = await import("../../worker/src/profiles/index.ts");
const { issue } = await import("../../worker/src/lib/tokens.ts");
const { makeModuleDoc } = await import("../../worker/src/lib/modules.ts");
const { DatabaseSync } = await import("node:sqlite");

const profile = getProfile("canary-sdk-contract");
if (profile?.observation?.format !== "hps-observation/2") throw new Error("canary-sdk-contract no longer declares hps-observation/2");
Object.assign(profile, { coach_runtime: "proxy" });
const cohort = profile.session.cohort_id;
const USER = "sx-learner";
const COURSE = "sx-week3";
const VERSION = "m2026.10.05-1";

const week3 = JSON.parse(readFileSync(new URL("../../worker/test/fixtures/session-design/week-3.json", import.meta.url), "utf8"));
const keep = new Set(completionArg.split(",").map((s) => s.trim()).filter(Boolean));
const completion = week3.learning.completion.filter((c) => keep.has(c.id));
if (!completion.length) throw new Error(`no completion item matches ${completionArg}`);
const content = { ...week3, learning: { ...week3.learning, completion } };

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
db.exec(readFileSync(new URL("../../worker/schema.sql", import.meta.url), "utf8"));
const now = Date.now();
const startsAt = new Date(now - 60_000).toISOString();
const endsAt = new Date(now + 6 * 3600_000).toISOString();
// The rows usage accounting references, so a turn's usage row is not refused.
db.prepare("INSERT OR IGNORE INTO cohorts(id, display_name) VALUES(?, ?)").run(cohort, cohort);
db.prepare("INSERT OR IGNORE INTO sessions(id, cohort_id, profile_id, starts_at, ends_at) VALUES(?, ?, ?, ?, ?)").run("sx-session", cohort, profile.id, startsAt, endsAt);
const module = await makeModuleDoc({ kind: "session-design", profileId: profile.id, version: VERSION, content });
db.prepare("INSERT INTO authoring_drafts(cohort_id, course_id, owner_id, profile_id, revision, content_json, request_id, request_hash, updated_at) VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?)")
  .run(cohort, COURSE, "sx-instructor", profile.id, JSON.stringify(content), "sx-request", "sx-hash", new Date(now).toISOString());
db.prepare("INSERT INTO authoring_versions(cohort_id, course_id, version, source_revision, module_json) VALUES(?, ?, ?, 1, ?)").run(cohort, COURSE, VERSION, JSON.stringify(module));

const app = await bootApp();
const env = createMockEnv({
  withSession: false,
  withRoster: false,
  environment: "development",
  env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "synthetic-no-live-key", OPENAI_API_KEY: undefined, ANTHROPIC_PROXY_URL: undefined, HPS_DB: sqliteBinding(db) },
});
await env.HPS_KV.put(`cohort:${cohort}:active_session`, JSON.stringify({ session_id: "sx-session", profile_id: profile.id, starts_at: startsAt, ends_at: endsAt }));
await env.HPS_KV.put(`cohort:${cohort}:roster`, JSON.stringify({ users: [USER] }));
const lesson = { course_id: COURSE, version: VERSION, sha256: module.sha256 };
writeFileSync(tokenFile, (await issue({ u: USER, c: cohort, p: profile.id, lesson }, 6, TEST_SECRET)).token);

// ── the model: one fixed line per turn ───────────────────────────────────────
const state = { turns: [] };
/** ms the next streamed turn holds its reply (GET /__sx/hold); 0 = answer at once. */
let holdNext = 0;
const ANSWER = "[로컬 시험 응답] 받았어요. 기대 조건부터 같이 정해 볼까요?";
const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
/** The reply in two parts: the start, and the text with the end. A held turn sends the second part late. */
const sse = (model) => [
  ev("message_start", { type: "message_start", message: { id: "sx", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 12, output_tokens: 0 } } })
    + ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ANSWER } })
    + ev("content_block_stop", { type: "content_block_stop", index: 0 })
    + ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } })
    + ev("message_stop", { type: "message_stop" }),
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.anthropic.com") {
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    state.turns.push({ at: Date.now(), system_has_mission: JSON.stringify(body.system ?? "").includes(week3.learning.mission) });
    if (!body.stream) return Response.json({ model: body.model, content: [{ type: "text", text: ANSWER }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 9 } });
    const [start, rest] = sse(body.model);
    const hold = holdNext;
    holdNext = 0;
    if (!hold) return new Response(start + rest, { headers: { "content-type": "text/event-stream" } });
    const bytes = new TextEncoder();
    const held = new ReadableStream({
      async start(c) {
        c.enqueue(bytes.encode(start));
        await new Promise((r) => setTimeout(r, hold));
        c.enqueue(bytes.encode(rest));
        c.close();
      },
    });
    return new Response(held, { headers: { "content-type": "text/event-stream" } });
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`blocked outbound fetch: ${url.origin}`);
  return realFetch(input, init);
};

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/__sx/state") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...state, lesson, completion: completion.map((c) => c.id) }));
    if (req.url?.startsWith("/__sx/hold?")) {
      holdNext = Math.max(0, Math.min(30_000, Number(new URL(req.url, "http://local").searchParams.get("ms")) || 0));
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ hold: holdNext }));
    }
    const parts = [];
    for await (const p of req) parts.push(p);
    const body = Buffer.concat(parts);
    const r = await app.fetch(new Request(`http://127.0.0.1:${portArg}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), env, makeCtx());
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) for await (const chunk of r.body) res.write(Buffer.from(chunk));
    res.end();
  } catch (e) {
    console.error("service failure", e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(Number(portArg), "127.0.0.1", () => console.log(`READY ${portArg} lesson=${COURSE}@${VERSION} completion=${[...keep].join(",")}`));
