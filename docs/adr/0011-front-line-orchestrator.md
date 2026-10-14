# ADR 0011 — The front-line coach orchestrates Service-defined helpers through one host tool

- **Status: Proposed.**
  - On 2026-10-14 the owner decided to design a front-line orchestrator and implement it now, on
    the main branches of the app and the Service. It targets the first app build after the
    2026-10-17 class.
  - This ADR proposes its shape. Items marked **OWNER DECISION** are not decided.
- **Scope:**
  - Service (`hypeproof/hypeproof-service`): `worker/src/profiles/types.ts`, `routes/chat.ts`,
    `routes/messages.ts`, a new `routes/agents.ts`, a new `worker/src/agents/`, and the ledgers.
  - App: `extensions/hypeproof-chat/src/{sdkCoach,sdkCoachHelpers,browserMcp,shellPolicy,chatPanelProvider,protocol}.ts`
    and new modules.
- **Related:**
  - [ADR 0003](0003-agent-sdk-coach-runtime.md) (SDK coach runtime);
  - [ADR 0006](0006-lesson-model-policy.md) (lesson model policy; its missing request-purpose
    marker);
  - REQ-M10/M11/M12/M22/M23/M41/M42, AE-25/27/28/29/33, MU-02, AB-05/07/10, US-05/11, REQ-O1–O7,
    CR-30/32/34/43–45.
- **Evidence refs:**
  - Studio `origin/main` at `bcfe8ebd` and tag `v0.1.56`;
  - Service HEAD `2e563ce`, with its branch `feat/claude-5-5-models` where named;
  - official docs fetched on 2026-10-14, quoted with URLs.
- **Conventions:** "Inference:" marks reasoning that no one has observed. A full work-package
  plan (file ownership, tests, interfaces) accompanies this ADR outside the repository. The table
  in "Implementation" is its summary.

---

## Context

The owner asked, in his words: "Is there an orchestrating agent? There should be several agents
split inside the Service, and this should run smoothly." His goal for the built-in harness is to
keep cutting what classes, and learners' post-class homepage building and operation, cost
HypeProof in model spend. Post-class work runs on fixed-price, request-count passes. The cuts
must hold a quality floor.

What the code does today:

- **One coach and two fixed helpers.** Installed v0.1.56 runs one Agent SDK coach (SDK and native
  binary 0.3.207, `src/sdkBinaryManifest.ts:29`). It can enable two hard-coded, read-only
  subagents, 코드리뷰어 and 리서처. They are defined with "model omitted → inherit the main
  (gateway-clamped) model" (`src/sdkCoachHelpers.ts:359` at `v0.1.56`; `:367` on main). Every
  delegation is a modal (REQ-M22 ③, `docs/studio-requirements.md:350`). `origin/main` is
  unchanged here.
- **The gateway replaces `system` on every `/v1/messages` request**
  (`hypeproof-service@2e563ce:worker/src/routes/messages.ts:519`; REQ-M10).
  - An SDK subagent's definition `prompt` *is* its system prompt (SDK 0.3.207 `sdk.d.ts:51-54`).
  - **Inference (from code):** today's subagent instructions never reach the model. A subagent
    runs under the cohort coach prefix and sees only the delegation text.
- **Custom headers are per process.** They are set once per query through
  `ANTHROPIC_CUSTOM_HEADERS` (`src/sdkCoachHelpers.ts:986-1021`).
  - On the wire, a subagent carries only a random `x-claude-code-agent-id`.
  - `x-claude-code-agent-type` is `custom` for user-defined agents, and "A user-chosen agent name
    is never sent" (https://code.claude.com/docs/en/llm-gateway-protocol).
  - So the gateway cannot tell which helper made a request.
- **SDK subagents are background-first and can nest.** "Subagents run in the background by
  default" (since 2.1.198, before the 0.3.207 pin). On 2.1.172–2.1.216 they nest "up to five
  layers deep". The Agent tool takes a per-call model override (`sdk-tools.d.ts:458-464`;
  https://code.claude.com/docs/en/sub-agents).
- **A pass seat holds one in-flight request.** The pass lease is `lease_id IS NULL`
  (`worker/src/lib/native-trial-grants.ts:141`). A second concurrent request gets 429
  `trial_busy` (`worker/src/middleware/native-trial-budget.ts:82-97`), and the CLI retries it
  silently (`src/sdkCoachHelpers.ts:1166-1173`).
  - Four parallel subagents once collapsed every tool call in a turn
    (`src/sdkCoachHelpers.ts:964-978`).
- **Passes meter gateway requests, not tokens.** Every request except `count_tokens` uses a
  unit, and units are not refunded (`native-trial-budget.ts:57-65`;
  `native-trial-grants.ts:153-160`).
  - One healthy design turn was 4 model requests in 286 s (`src/sdkCoachHelpers.ts:1210`).
  - Requests per completed step is therefore the lever that protects both the margin and the
    learner's allowance.
- **The curriculum runtime already has a contract pattern.** Its seven role skills have JSON
  contracts with eight fields (`worker/src/skills/curriculum/contract.ts:23-32`). They are
  validated and refused at load (`registry.ts:51-68`), name a capability and never a model id
  (`request.ts:3-27`), and have their output gated (`registry.ts:151-159`). The capability is
  "recorded, not yet routed" (CR-45). "Director" there means the human instructor console, so
  this ADR does not use that word for an agent.
- **The research shows fan-out loses here.** Multi-agent variants degraded sequential tasks by
  39–70% (arXiv 2512.08296), and homepage building is an edit-preview-fix sequence. The
  cheapest quality-holding shape is one learner-facing model per session. Deterministic code
  takes over review steps and cheap roles do side work. Switching the coach's model mid-session
  forfeits the cache (research report "Studio cohort model orchestration", 2026-10-14).

---

## Decision

### 1. The roster lives in the Service profile, versioned and cohort-scoped

- **The field:** `Profile.orchestrator?: { enabled: boolean; roster: AgentRoster }`, beside the
  `curriculum_runtime` switch (`worker/src/profiles/types.ts:299-308`).
- **The roster:** `format: "hps-agent-roster/1"`, an `id`, an immutable semver `version`, a
  `capability_policy` (a capability name → one catalogue model key, the CR-30 shape), and
  `agents[]`. Each agent has:
  - `name` and `title` (Korean product copy);
  - `role` (`coach | helper | advisor | aux`) and `purpose`;
  - `capability`, `effort` and `max_tokens`;
  - a bundled `contract`;
  - declared host `context` keys;
  - a `trigger` (`learner | coach_consult | deterministic_failure | cli_background`);
  - `caps` (`per_turn`, `per_session`) and `enabled`.
- **Contracts:** they reuse the curriculum fields and validator. `allowed_tools` and
  `write_back_targets` must be empty. They live under `worker/src/agents/` and are refused at
  load if invalid.
- **Serving:** `GET /v1/profile` serves `orchestrator` only when all of these hold:
  - the flag is on;
  - the cohort is not a minor (`isMinorCohort`);
  - the runtime is `agent-sdk`;
  - the seat is not under a frozen lesson model policy (`lesson_locked`); see AE-33 and O-3;
  - the request carries `x-hps-orchestrator: hps-agent-roster/1`.
- **That header is the version gate.** It follows the observation-format precedent: "the cohort's
  declaration is a ceiling, not an order" (`routes/chat.ts:397-401`). Prompts and output schemas
  stay server-side; the app receives titles, caps, triggers and model labels.
- **Old apps are safe** in four ways:
  - v0.1.56 never sends the header; it sends only `x-hps-observation-format`
    (`src/proxyClient.ts:378-381` at `v0.1.56`);
  - it casts the profile JSON without validation (`:391-392`);
  - requests without the new headers follow today's `/v1/messages` path exactly;
  - an old Service simply serves no roster, so a new app registers no orchestrator tools.

### 2. The coach is the only voice and orchestrates through one host-executed tool

- **No SDK subagents for roster agents.** When a roster is served, the app does not attach the
  SDK `agents` option and does not grant the Agent/Task tool. The legacy `sdk_tools.subagents`
  path stays for non-orchestrator cohorts and old apps.
- **The delegation tool:** `mcp__hypeproof__consult({ agent, question ≤400, focus? })`, on the
  existing in-process `hypeproof` MCP server (`src/browserMcp.ts:41,557`). The host:
  1. refuses unknown or disabled agents, spent caps, and an advisor with no recorded
     deterministic failure;
  2. serializes runs per seat. The turn already runs under `withCoachSeatLock`
     (`src/sdkCoachHelpers.ts:858`);
  3. assembles **summaries, not transcripts**. Only the agent's declared context goes out:
     contained and scrubbed file excerpts of ≤40 KB, a section outline, the latest check result,
     the last diff summary, the learner's own goal and the lesson step. Never the chat history;
  4. calls `POST /v1/agents/:agent/run` once;
  5. returns the Service's **contract-validated JSON** (≤2,000 characters) as the tool result.
- **Results are advice to the coach.** Nothing is written back. The coach decides and writes
  under the existing approval policy.
- **The agent-run route** is a per-request gateway like `/v1/messages`:
  - it uses the same chat gate and pass metering middleware;
  - it builds the prompt server-side from the agent's instructions, output schema and the
    supplied context;
  - it makes one non-streaming upstream call, with structured output where supported;
  - it validates the output against the contract (the `checkSkillOutput` pattern), records the
    usage, and answers with typed errors;
  - it never retries, except CR-32's transient retry before output.
- **The Service still never runs a loop or executes a tool.** The agent loop, the delegation and
  tool execution stay on the learner's machine (`src/sdkCoach.ts:711`); inference stays at
  Anthropic.

### 3. Every upstream request is attributed, routed inside the allowed set, recorded and metered

- **Headers the app adds:**
  - `x-hps-agent: coach@<roster-version>` and `x-hps-roster`, process-wide;
  - `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, which makes the CLI send `x-claude-code-request-class:
    main | subagent | workflow | compaction | auxiliary`. That needs v2.1.273+ and is "off by
    default" behind a custom base URL (https://code.claude.com/docs/en/llm-gateway-protocol);
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-5-5`, because without it background calls use
    "The main model" under `ANTHROPIC_AUTH_TOKEN` (same page).
- **Helper runs need no header for identity.** The route parameter names the agent.
- **Resolution** (`worker/src/lib/agent-routing.ts`, new):
  - **`main` and `compaction`:** the learner's selection, clamped to profile ∩ lesson. The
    force-appended fast pin no longer applies there, which closes the bypass ADR 0006 measured
    (`0006-lesson-model-policy.md:154-177`).
  - **`auxiliary`:** the roster's `text.fast` role (Haiku 5.5) when allowed. These requests get a
    lean Service prefix, with the client's system text demoted to user-role context (the #384
    posture, `messages.ts:178-205`), and a `max_tokens` of at most 1,024.
  - **No header:** exactly today's behavior.
- **Per-agent allowed set:** `{capability_policy[agent.capability]}` ∩
  (profile allowed ∪ the profile's declared role keys) ∩ lesson allowed. An empty set is a typed
  refusal, never a substitute (AE-25, AE-33, CR-32).
- **The labels need no cryptographic trust:** every label only *reduces* what a request receives.
  - An "auxiliary" turn loses the coach prompt and is capped at 1,024 tokens.
  - A "coach" label gets nothing beyond the learner's own menu.

  This is how the design meets ADR 0006's call for "a trusted request-purpose discriminator"
  (`0006:179-181`). It also forbids a metering exemption keyed on the label (see 4).
- **Recording on existing ledgers (CR-34):** a migration adds `agent`, `agent_version`,
  `request_class`, `roster`, `capability`, `resolution`, `stop_reason`, `agent_call_id` and
  `session_id` to `usage_request_settings`, and `request_id` to `usage_log`.
  - **Coverage fix:** settings rows are written whenever an agent is attributed. Today they need
    an effort receipt (`worker/src/lib/request-settings.ts:8`).
  - `GET /v1/request-settings/:turn` returns the new fields.
- **Metering:** v1 keeps today's rule, one pass unit per request including helper and aux
  requests. **OWNER DECISION O-1:** a separate `agent_requests` allowance changes what a pass
  includes. Product Intent requires the learner to know that before running
  (`docs/PRODUCT-INTENT.md:211-212`), and AB-10 keeps meters distinct.

### 4. Read-only help runs without a modal; writing stays with the coach; the learner sees who worked

- **Consult** gets an approval kind, `consultHelper`. It is in the `requireApprovalFor` enum but
  not its default (`package.json:399-419`). The setting stays machine-scoped and the single
  approval source. Helpers have no tools.
- **Writes** keep REQ-M17's path. **Legacy delegation** keeps its modal.
- **Visibility (AE-27):**
  - One timeline line per consult and per check, through the existing `toolLog`
    (`src/protocol.ts:551`). For example, "🔎 검토 도우미 · Claude Haiku 5.5 — 고칠 곳 2개" and
    "📏 390·1280px 확인 — 통과". Aux calls never appear in the timeline.
  - Per-request agent labels in the existing details list (`webview-ui/src/EffortControl.tsx:17-30`).
  - No per-answer badges, which AE-27 does not require.
  - The coach names the helper whose finding it uses ("Human judgment stays visible").
- **Minors:**
  - the orchestrator is never served to them (serializer, harness `child_orchestrator` FAIL,
    client strip);
  - no new model or classifier touches child text (REQ-O);
  - moderation stays deterministic;
  - the SDK bump still changes the kids' engine, so it needs a kids validation run and notice
    (`docs/AUTONOMY-MANDATE.md`).

### 5. Deterministic tools replace model calls

- **`site_check`:**
  - **Mechanism:** it reuses the live server's `/__hp_viewport` wrapper
    (`src/liveServerHelpers.ts:110,138-151`). Emulation is ignored by the shipped shell
    (`src/experimentBrowser.ts:661-663`), so it sets the iframe width and evaluates in the frame
    over CDP.
  - **What it reports at 390 and 1280:** overflow and offenders, the viewport meta, missing
    `alt`, external URLs, and body font and small targets.
  - **When it runs:** automatically after HTML writes, through an SDK `PostToolUse` hook
    (`sdk.d.ts:2180-2191`), so it adds zero requests; and on demand.
  - It is `unverified` when it cannot measure, and never `pass`.
- **Diff guard:** a `PreToolUse` hook. `canUseTool` "is invoked only when the permission
  evaluation flow resolves to a prompt"
  (https://code.claude.com/docs/en/agent-sdk/typescript).
  - It computes the changed ratio and whether the 정보블록 contains the change.
  - It reports through `additionalContext` and never blocks in v1 (O-5).
- **Archive before overwrite for adults:** today only kids' world cohorts archive
  (`src/chatPanelProvider.ts:2999-3001`). Orchestrator seats copy the old file to
  `.hypeproof/history/` before a reveal or a coach Write replaces HTML.
- **PowerShell destructive verbs:** today the gate is Unix-only, and pipe-to-shell matches only
  curl and wget (`src/shellPolicy.ts:43-90`). Add `Remove-Item`/`del`/`rd`, `Format-Volume`,
  `Stop-Process`, `Set-ExecutionPolicy`, `iex`, `reg`, `takeown`, `icacls`, `irm|iwr … | iex`,
  `-ExecutionPolicy Bypass` and `-EncodedCommand`, matched case-insensitively with positive and
  negative controls.

### 6. Escalation is a capped Opus 5.5 roster agent behind deterministic failures and an eval

- **`design-advisor`:** capability `reasoning.high` → `claude-opus-5-5`, effort medium,
  4,096 tokens, no tools. It returns `{diagnosis, plan[≤5], stop, ask_learner?}`.
- **Triggers:** consult refuses it unless the host recorded one of these this turn:
  - a repeated `site_check` fail after a fix;
  - two structure-guard blocks;
  - two failed edits on one file;
  - an HTML write cut at `max_tokens`;
  - a previous `error_max_turns`.
- **Caps and gate:** at most 1 per turn and 2 per session, off until eval E-ADV (O-4). The arms
  are Sonnet 5.5, Sonnet 5.5 + advisor, and Opus 5.5.
- **It is not the Anthropic advisor tool (`advisor_20260301`),** because:
  - Claude Code attaches it only with a feature flag that "a gateway token with no API key" cannot
    fetch, and "If the main model or the advisor is a model Claude Code does not recognize, the
    advisor is not attached" (https://code.claude.com/docs/en/advisor;
    https://code.claude.com/docs/en/env-vars);
  - 5.5 advisors "return the encrypted `advisor_redacted_result`", so the advice cannot be shown
    or audited;
  - its tokens are reported only in `usage.iterations[]`
    (https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which our
    usage tap and the one-rate price schema would under-bill;
  - metered seats reject server tools in `validateWire` (`worker/src/lib/budget-admission.ts`);
  - "only on deterministic failures" could only be enforced by editing `tools` mid-conversation,
    which "invalidates the entire cache".
- **REQ-M12 needs no amendment:** no gateway-executed tool exists and the `/v1/messages`
  passthrough stays verbatim. The advisor tool remains a P2 option that would need those
  amendments.

### 7. Decisions API: off the coach's path, adults only, fail-open, own meter

- **The signal:** a "may need help" signal for the instructor console, per adult seat.
- **Inputs:** numeric usage features only (failures, stalls, check fails, minutes since the last
  successful write). Never learner text or file content.
- **First a rule:** a deterministic rule ships first.
- **Then Decisions, eval-gated:**
  - a `predicate` question, not `choice`, which a community test found overconfident;
  - model `gpt-6-luna`;
  - an extension of the intake client, which parses only `choice` today
    (`worker/src/lib/intake/decision-provider.ts:9,35-58`);
  - a 2 s timeout, fail-open, and computed lazily when the console polls;
  - a daily micro-USD budget reusing the intake reservation pattern
    (`worker/src/lib/intake/decision-review.ts:13,25-27`), never charged to learners.
- **Data handling (OWNER DECISION O-6):** Decisions processes in the US and EU only, with 30-day
  abuse-monitoring retention (https://developers.openai.com/api/docs/guides/your-data).

### 8. Defaults change only through measured roster versions

- **Metrics:**
  - requests and cost per completed step;
  - cache-hit rate;
  - per-agent spend share;
  - refusal and truncation rates. `stop_reason` becomes recorded; it is not today.
  - helper invalid-output rate;
  - quality-floor checks: site-check pass, diff precision, unverified claims.

  All are cut by cohort, roster version, agent and model.
- **Storage:** the existing ledgers plus a nightly `agent_daily_metrics` rollup, readable by
  operators only (MU-07).
- **How a default changes:**
  1. Propose a new immutable roster version.
  2. Shadow-replay it on consented adult inputs and a planted-defect eval set ("정답을 심고
     시작한다", `.claude/rules/verification.md` rule 3).
  3. Canary it on a synthetic cohort, then on one human cohort.
  4. Promote it by a profile edit.
- **Guardrails:**
  - Resolution never reads balances or remaining units: no silent downgrade under budget
    pressure (AB-05).
  - Caps stop helpers; they never swap models.
  - The coach's model never changes mid-turn (AE-29).
  - A cheaper candidate that raises refusal, truncation or false-pass rates is rejected.
  - Minors and model-practice cohorts are excluded.

### 9. Homepage first

One `homepage` roster v1.0.0 serves `homepage-practice-s1` and the paid pass `studio-native-trial`,
with different caps.

| Agent | Model | Role and trigger | Caps (turn, session): practice / pass |
|---|---|---|---|
| `coach` | learner selection: Sonnet 5.5 default on both after the 5.5 release; medium effort | the voice; writes; consult; `site_check` | — |
| `site_check`, `diff_guard`, archive | none (deterministic) | after writes | — |
| `design-reviewer` | Haiku 5.5 (`text.fast`) | helper; after a first page or a new section; quality-floor contract | 1, 6 / 1, 4 |
| `design-advisor` | Opus 5.5 (`reasoning.high`) | advisor; deterministic failures only; **off** | 1, 2 / 1, 1 |
| `aux` | Haiku 5.5 | CLI background calls; lean prefix | metered |

- **Coach skills:** the coach's prefix uses the homepage harness skills being written on the
  Service branch `feat/homepage-harness`. Practice gets `homepage-craft` + `homepage-sections`;
  the pass gets `homepage-craft` + `homepage-update`. Both are uncommitted at the time of
  writing.
- **Not loaded:** `design-craft` (it contradicts them on viewports and audience),
  `publish-homepage` (14.8 KB, which would ride every request) and `workshop-setup` (the
  `irm | iex` hazard).
- **Model hypotheses:** Haiku 5.5 is about 1/20 of Sonnet 5.5 per token, and review is the light
  step. Both are hypotheses until E-REV compares the reviewer against the coach's own
  self-critique on planted defects.

---

## Capacity and scaling

**Where each part runs:**

- The learner's machine runs the loop, the delegation and the tools.
- The Cloudflare Worker gates, rewrites and meters each request.
- Every model call then hops through the Fly proxy `hypeproof-sediment.fly.dev` (NRT). It exists
  because Workers "occasionally lands fetches on HKG, where Anthropic's geo policy refuses"
  (`worker/wrangler.toml:82-86`).
- Anthropic serves every seat from one organization key (`messages.ts:352`).
- KV holds the roster, sessions and pauses. D1 holds the ledgers.

**Per-request Service work today, at a warm isolate:**

| Seat | KV reads | D1 reads | D1 writes | Notes |
|---|---|---|---|---|
| Classroom | 4 | 1 | 1 | — |
| Paid pass | 10 | 6 | 6–8 | the full gate runs twice: `native-trial-budget.ts:28-29` and `messages.ts:255` |
| Metered | 4 | ≈21 | ≈11–12 | — |

- **Upstream:** exactly one fetch, with no retry and no queue (`messages.ts:586-592`).
- **429 and 529:** both lose `retry-after`, and 529 becomes 502 (`messages.ts:603-622`).
- **Classroom seats:** no gateway timeout and no concurrency cap.

**Bottlenecks, in the order they bind:**

1. **Anthropic organization limits per model.**
   - Each 5.5 model has its own bucket (https://platform.claude.com/docs/en/api/rate-limits):

     | Tier | RPM | ITPM | OTPM |
     |---|---|---|---|
     | Start | 1,000 | 2M | 400K |
     | Build | 5,000 | 5M | 1M |

   - Cache reads do not count toward ITPM on 5.5. Acceleration limits apply to sharp increases.
   - **Monthly spend caps:** Start $500, Build $1,000. At the cap, usage pauses until the next
     month: an organization-wide hard stop.
   - **Inference:** output, which includes thinking, binds first. A Start-tier org would hit
     Sonnet 5.5 OTPM with about 75 learners waiting at once. The org's tier is not in the repos
     (O-12).
2. **The Fly proxy.** One app carries all traffic. Its capacity is unknown, so it needs a load
   test.
3. **D1 single primary,** which "processes queries one at a time"
   (https://developers.cloudflare.com/d1/platform/limits/).
   - Pass seats cost about 14 statements per request.
   - Per-request work grows with history: an unindexed orphan sweep
     (`native-trial-grants.ts:137-138`) and O(n) balance views
     (`migrations/0009-budget-admission.sql:72-107`).
4. **The KV roster:** one JSON value per cohort, rewritten whole, at 1 write per second per key
   (https://developers.cloudflare.com/kv/platform/limits/; `worker/src/lib/kv.ts:40,51-72`).
   - Seat-claim bursts serialize, and a claim that loses 5 rounds fails (`purchase.ts:366-376`).
   - The pass cohort's value grows with every sale.
5. **Decisions:** no published limits, but off-path by design.
6. **Cost:** linear in requests. The levers are requests per completed step, cheaper roles and
   the cache.

**Capacity targets, as parameters:**

- **Parameters:**
  - `L` learners per class, `c` classes at once;
  - `m` ≈ 4 requests per message;
  - `t` = 13.5 s mean request duration (`docs/research/budget-readiness-2026-09-08/README.md:66`);
  - `T` think time;
  - `o` output tokens per request.
- **Rates:** steady RPS = `c·L·m/(T+m·t)`. The burst bound is `c·L/t`.
- **Example:** at `L` = 80, `o` = 1,200 (assumed until measured), the burst is about 356 RPM and
  427K OTPM. That is above the Start tier.
- **Targets to adopt (O-12):**
  - an 80-learner burst with no 429;
  - no D1 "overloaded" errors at 160 pass learners;
  - 80 seat claims in 60 s;
  - Worker overhead under 150 ms p95.

**Load test with no provider spend:**

- **Setup:**
  - a mock Anthropic SSE server with configurable latency and usage, which injects 429 and 529
    with `retry-after` and `anthropic-ratelimit-*` headers;
  - the staging Worker (`worker/wrangler.staging.toml`) with `ANTHROPIC_PROXY_URL` pointed at the
    mock. The URL is already configurable (`worker/src/lib/anthropic.ts:72-73`);
  - a driver replaying CLI-shaped bodies at those rates, with a seat-claim burst.
- **What it measures:** overhead, D1 errors, KV refusals, CPU and retry pacing.
- **Real limits** are read from production responses without an extra call. The plan logs
  `anthropic-ratelimit-*` (sampled, and on every 429) and forwards `retry-after` and
  `anthropic-ratelimit-unified-*`, as Claude Code's gateway contract asks: "Forward the
  upstream's values unchanged" (https://code.claude.com/docs/en/llm-gateway-protocol). Today
  neither happens.

**Mitigations (work packages S3, S4, S7, S8 and A2):**

- Queue or batch the non-metering usage writes (O-8), and fix the pass `usage_log` FK double
  write.
- Move roster seats and classroom seat leases to D1 rows: an atomic insert and an indexed lookup.
  A Durable Object is the fallback.
- Cap classroom seats at 2 in-flight requests, with a 600 s ceiling (O-10).
- Forward `retry-after` on 429 *and* 529. The app shows "지금 요청이 많아 잠시 기다리는 중이에요" on
  the first retry and aborts after 3 retries or 90 s with a Korean retry message. Today nothing
  is shown until the 240 s stall watchdog (`src/sdkCoachHelpers.ts:1220`).
- Put helper and aux calls in the Haiku 5.5 bucket, away from Sonnet 5.5.
- Index `native_trial_requests` and memoize the double gate.
- Later, replace the per-turn flattened transcript (`src/sdkCoach.ts:518-521`) with session
  resume, so conversation caches survive across turns.

---

## Rollout

1. **Flags.** `orchestrator.enabled` is absent or false on every profile. The Service PRs deploy
   first. The profile-serving snapshot must be byte-identical without the header.
2. **App build N (after the class).**
   - **SDK:** `@anthropic-ai/claude-agent-sdk` **0.3.299**, an exact pin (O-11). Native Haiku 5.5
     needs ≥0.3.293; the "aborted after 180 seconds" gateway fix is in 2.1.299. Avoid 2.1.265–267
     and 2.1.275 behind a gateway.
   - **Packaging:** bump `package.json` and the lockfile, `src/sdkBinaryManifest.ts` (six platform
     sha512 and size entries), and `scripts/seed-sdk-binary.{sh,ps1}` (smoke-locked). The vendor
     step reads the lockfile (`scripts/inject-builtin-extensions.sh:65`).
   - **Re-verify:** explicit `permissionMode: 'default'` (0.3.286 can otherwise start in auto
     mode); the status of MultiEdit, which the docs call "legacy"; the task-tool surface change;
     and the 1M-window default behind a base URL (2.1.285). Keep compaction at ≤200K until
     measured.
   - **Windows CI:** a new `extension-windows` PR-CI job runs the shell-policy (PowerShell)
     and containment smokes. Today all PR-CI jobs run on Ubuntu.
   - **Kids validation run** on the new engine.
3. **Canary.**
   1. `synthetic-orchestrator-acceptance` (new, `synthetic: true`), with Codex's e2e acceptance.
   2. `homepage-practice-s1`, adult instructors (O-2).
   3. The paid pass, after O-1 and the Haiku 5.5 price digests for metered seats.
   4. The advisor, after E-ADV.
4. **Rollback** at each step is one profile line. The gateway ignores `x-hps-agent` when the flag
   is off.

---

## Consequences

**Gained:**

- Service-owned, versioned agents with their own prompts and models.
- Exactly one request per helper.
- No parallel fan-out.
- Attribution of every request.
- The request-purpose marker ADR 0006 lacked.
- Deterministic review at zero model cost.
- A measured path to cheaper defaults.

**Costs:**

- One new Service route and migration.
- A host tool and hooks in the app.
- An SDK bump that also moves the kids' engine.
- Helper calls still use pass units until O-1.

**Not claimed:**

- That Haiku 5.5 reviews Korean pages well (E-REV), or that the advisor pays (E-ADV).
- Any capacity number beyond the stated inferences.

## Alternatives considered

| Alternative | Why not |
|---|---|
| SDK subagents with per-agent models (the `agents` option and the Agent tool) | Their prompts are replaced at the gateway. No header names a custom agent. Background-by-default and nesting conflict with the pass lease and sequential work. Each tool round trip is a metered request. **Kept** as the path for a future tool-using helper, identified by a distinct `AgentDefinition.model` tag, which is sent verbatim (https://code.claude.com/docs/en/errors). |
| A per-request model router at the gateway | Caches are per model. Accepted rules forbid silent substitution (AE-29/33, REQ-M41/M42, MU-02, AB-05). Learned routers miss off-distribution traffic (research report). |
| The Anthropic advisor tool | §6 above. |
| A gateway-run agent loop or gateway-executed tools | That breaks REQ-M12's verbatim passthrough and moves tool execution off the learner's machine. |
| Decisions on the coach's path | No published limits, beta, US/EU processing, and not needed for a numeric signal. |

---

## Requirement changes

These ship with the behavior. The requirement and validation docs are Codex-side under the
2026-09-08 role split.

- **REQ-M10:** add the agent-run and aux prompts. Client text never becomes `system`.
- **REQ-M11:** the fast pin applies to `auxiliary` only on orchestrator seats.
- **REQ-M12:** unchanged.
- **REQ-M22 ③:** legacy-only. Consult is modal-free and visible.
- **REQ-M23:** extends to the orchestrator.
- **REQ-M41/M42:** a helper's model is quiet server resolution, and an unavailable model is a
  typed refusal.
- **AE-25:** per-agent intersection.
- **AE-27:** agent role per request in details.
- **AE-28:** new capability rows for Haiku and Opus 5.5 on the agent-run route, and for SDK
  0.3.299.
- **AE-29:** a helper's model is a role, not a change of the coach's model.
- **AE-33:** off under locked lessons until the roster is frozen into the binding (O-3).
- **MU-02:** a scope note.
- **AB-05/07/10:** no downgrade; each helper attempt is linked to its turn; meters stay distinct.
- **US-05/11:** a single cost source.
- **REQ-O:** unchanged.
- **New rows:** FO-01 to FO-12 in `docs/requirements/front-line-orchestrator.md`.

## Owner decisions (open)

| ID | Decision |
|---|---|
| O-1 | Pass units for helper and aux requests |
| O-2 | The human canary cohort and its date |
| O-3 | The roster inside frozen lessons |
| O-4 | Advisor thresholds |
| O-5 | Whether the diff guard may ask |
| O-6 | Decisions data handling and budget |
| O-7 | Practice course effort |
| O-8 | Queues |
| O-9 | Roster-store migration window |
| O-10 | Classroom seat caps |
| O-11 | The SDK version |
| O-12 | Anthropic tier, spend cap and capacity targets |
| O-13 | Price digests for Haiku and Opus 5.5 on metered seats |

## Implementation

Work packages. Each file belongs to exactly one package. Tests go in auto-discovered directories:
`worker/test/orchestrator/` and `extensions/hypeproof-chat/test/*.smoke.mjs`.

- **Service:**
  - S1: roster core and contracts.
  - S2: `/v1/profile` serving and the cohort harness.
  - S3: gateway attribution, the aux policy and upstream header forwarding.
  - S4: ledger dimensions and the write path.
  - S5: the agent-run route and Service wiring.
  - S6: profiles and flags.
  - S7: the admission hot path and seat leases.
  - S8: the roster store.
  - S9: metrics and shadow replay.
  - S10: the stuck signal.
- **App:**
  - A1: the engine bump and Windows CI.
  - A2: the SDK boundary (`sdkCoachHelpers.ts`).
  - A3: deterministic checks and PowerShell.
  - A4: the orchestrator host (`sdkCoach.ts`, `browserMcp.ts` and new modules).
  - A5: panel and visibility (`chatPanelProvider.ts`, `protocol.ts`, `EffortControl.tsx`).
- **Docs and acceptance:**
  - D1: this ADR.
  - D2 and D3: requirements and validation (Codex).
  - E1: e2e acceptance (Codex).
