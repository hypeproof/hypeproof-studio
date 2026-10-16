# ADR 0011 — The front-line coach orchestrates Service-defined helpers through one host tool

- **Status: Accepted for the P0 base, which is merged. It is not active for any learner.**
  - **Basis:** on 2026-10-14 the owner decided to design a front-line orchestrator and build it
    now, on the main branches of the app and the Service, for the first app build after the
    2026-10-17 class (epic #1618). The P0 base merged on 2026-10-14 and 2026-10-15; see
    "What shipped".
  - **Production, checked on 2026-10-16:** the Service code runs in production with every learner
    cohort's flag off. Migration 0044 is not applied, so the agent-run route fails closed. No
    published app release carries A1–A5. See "Production state".
  - **Still open:** the owner decisions O-1 to O-13, the build decisions marked as open for the
    owner, the P1/P2 packages (S4 part B, S7–S10, A4 part B), the requirement and validation docs
    (D2/D3) and e2e acceptance (E1).
- **Scope, as shipped** (`ext` is `extensions/hypeproof-chat`):
  - Service (`hypeproof/hypeproof-service`): `worker/src/agents/`,
    `worker/src/routes/{agents,chat,messages,observations}.ts`,
    `worker/src/lib/{agent-routing,ratelimit-headers,request-settings,analytics}.ts`,
    `worker/migrations/0044-agent-attribution.sql`, the profile field and three profiles, the
    cohort harness and `worker/DEPLOY.md`.
  - App: `ext/src/{sdkCoachHelpers,sdkCoach,browserMcp,proxyClient,protocol,chatPanelProvider,modelSelection,shellPolicy}.ts`;
    new `ext/src/{agentRoster,consultTool,siteCheck,siteCheckRunner,diffGuard,adultArchive,orchestratorHooks,orchestratorSurfaces}.ts`;
    `ext/webview-ui/src/EffortControl.tsx`; the SDK pin in `ext/package.json`,
    `ext/src/sdkBinaryManifest.ts` and `scripts/seed-sdk-binary.{sh,ps1}`; and
    `.github/workflows/pr-ci.yml`.
- **Related:**
  - [ADR 0003](0003-agent-sdk-coach-runtime.md) (SDK coach runtime);
  - [ADR 0006](0006-lesson-model-policy.md) (lesson model policy; its missing request-purpose
    marker, and the conditions its 2026-10-14 amendment sets for any per-request router);
  - [ADR 0007](0007-lesson-feature-binding.md) (lesson feature narrowing);
  - REQ-M10/M11/M12/M22/M23/M41/M42, REQ-E1, AE-25/27/28/29/33, MU-02/04, AB-05/07/10, US-05/11,
    REQ-O1–O7, CR-30/32/34/43–45.
- **Evidence refs:**
  - "Context" and "Capacity and scaling" keep the refs of the first draft: Studio `bcfe8ebd`,
    tag `v0.1.56`, Service `2e563ce`, and official docs fetched on 2026-10-14, quoted with URLs.
  - Everything else cites Studio main `6ad5f9f8` and Service main `9dbe15c8`, which is the
    production pin, unless a line says otherwise.
- **Conventions:**
  - "Inference:" marks reasoning that no one has observed.
  - "Unverified:" marks built behavior that has not been observed in the real CLI, app, Service
    or provider API.
  - "Not built:" marks a decided part that has no code yet.
  - Code comments in both repositories cite "spec §N" and rollout steps R1–R6. The spec is the
    work-package plan (file ownership, tests, interfaces) that accompanied this ADR outside the
    repositories. "Rollout" below defines R1–R6.
  - B-1 to B-18 are the decisions made while building. They are listed in "Decisions made while
    building".

---

## Context

This is what the code did when this ADR was drafted, at the evidence refs above.

The owner asked, in his words: "Is there an orchestrating agent? There should be several agents
split inside the Service, and this should run smoothly." His goal for the built-in harness is to
keep cutting what classes, and learners' post-class homepage building and operation, cost
HypeProof in model spend. Post-class work runs on fixed-price, request-count passes. The cuts
must hold a quality floor.

- **One coach and two fixed helpers.** Installed v0.1.56 runs one Agent SDK coach (SDK and native
  binary 0.3.207, `src/sdkBinaryManifest.ts:29`). It can enable two hard-coded, read-only
  subagents, 코드리뷰어 and 리서처. They are defined with "model omitted → inherit the main
  (gateway-clamped) model" (`src/sdkCoachHelpers.ts:359` at `v0.1.56`; `:367` on `bcfe8ebd`).
  Every delegation is a modal (REQ-M22 ③).
- **The gateway replaces `system` on every `/v1/messages` request**
  (`hypeproof-service@2e563ce:worker/src/routes/messages.ts:519`; REQ-M10).
  - An SDK subagent's definition `prompt` *is* its system prompt (SDK 0.3.207 `sdk.d.ts:51-54`).
  - **Inference (from code):** today's subagent instructions never reach the model. A subagent
    runs under the cohort coach prefix and sees only the delegation text. This is still not
    observed on the wire.
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
- **Passes meter gateway requests, not tokens.** Every request except `count_tokens` used a unit,
  and units were not refunded (`native-trial-budget.ts:57-65`; `native-trial-grants.ts:153-160`).
  - Since then, Service #69 gives back an attempt that ended without output, and #77 refunds
    failed streamed requests. Provider usage is kept in both.
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

Each section states the decision as it shipped. Where the build refined the first draft, the
line names the build decision (B-n). Parts with no code say "Not built".

### 1. The roster lives in the Service profile, versioned and cohort-scoped

Shipped in Service #80 (S1), #91 (S2) and #93 (S6).

- **The field:** `Profile.orchestrator?: { enabled, roster, agents? }`
  (`worker/src/profiles/types.ts:432-436`; types in `worker/src/agents/types.ts`).
  - `agents` is a per-cohort override, `{enabled?, caps?}` per helper or advisor. It can switch
    an agent on or off and lower its caps, never raise them (B-6,
    `worker/src/agents/resolve.ts:35-63`).
- **The roster:** `format: "hps-agent-roster/1"`, an `id`, an immutable semver `version`, a
  `capability_policy` (a capability name → one catalogue model id, the CR-30 shape), and
  `agents[]`. Each agent has:
  - `name` and `title` (Korean product copy);
  - `role` (`coach | helper | advisor | aux`) and `purpose`;
  - `capability`, `effort` and `max_tokens`;
  - a bundled `contract`;
  - declared host `context` keys;
  - a `trigger` (`learner | coach_consult | deterministic_failure | cli_background`);
  - `caps` (`per_turn`, `per_session`) and `enabled`.
- **Role keys are catalogue ids.** They are typed `AnthropicModelId`. An alias is refused, so an
  alias remap can never move a deployed roster version.
- **Contracts:** they reuse the curriculum fields and validator. `allowed_tools` and
  `write_back_targets` must be empty.
  - The files are `worker/src/agents/{design-reviewer,design-advisor,site-brief}.{md,contract.json}`.
  - Invalid contracts and rosters are refused at load, never only warned about (CR-43). A refused
    item is absent from the registry and logged (`worker/src/agents/registry.ts`).
- **A profile must hold a registered roster verbatim.** An edited copy under the same
  `id@version` gives `roster_refused`.
- **The digest:** `rosterDigest` covers the roster JSON, each helper's contract and rendered
  prompt, the shared rules and the aux prefix.
  - `homepage@1.0.0` is `sha256:25127ecc…cef79`, pinned in
    `worker/test/orchestrator/roster.test.mjs:372-373`.
  - A text edit under the same version moves the digest and fails the pin. A new version needs a
    new pin, which is a reviewable edit.
- **Serving** (`worker/src/routes/chat.ts:294-345`, `:510-511`):
  - `GET /v1/profile` adds the `orchestrator` key only when the request carries exactly
    `x-hps-orchestrator: hps-agent-roster/1`. Any other value counts as no declaration.
  - `servedOrchestrator(profile, lesson)` then returns the roster, or `{ enabled: false, reason }`.
    The reasons, in order: `minor_cohort`, `orchestrator_off`, `roster_refused`,
    `proxy_runtime`, `lesson_locked`, `lesson_features`.
  - **Adult** means not `isMinorCohort` and a known lower age bound of 18 or more. A mixed-age or
    unknown audience counts as minor (B-1, `worker/src/agents/resolve.ts:24-33`). The
    orchestrator stays adult-only after the at-any-age change (B-2).
  - **A frozen lesson model policy** gives `lesson_locked` (AE-33, O-3). It also leaves helpers
    with no model, even when the frozen menu lists the helper's model (B-3).
  - **A lesson that narrows a feature** gives `lesson_features` (B-4).
  - The key is appended last. A response with the header is the no-header response plus one
    trailing key.
- **What the app receives:** `format, id, version, digest, coach_brief, checks, agents`. The
  coach and aux are labels only. Each helper and the advisor carry `purpose`, `trigger`,
  `context`, `caps` (after the cohort's override), `enabled` and `model {id, label}`. Prompts,
  contracts, efforts and token caps stay in the Service.
- **The header is the version gate.** It follows the observation-format precedent: "the cohort's
  declaration is a ceiling, not an order".
- **Harness:** four FAIL rules in `worker/scripts/cohort-harness/rules.yaml` and `validate.py`.
  They are `child_orchestrator`, `agent_model_not_in_catalog`, `helper_has_tools` and
  `advisor_trigger_not_deterministic`.
- **Old apps are safe:**
  - v0.1.56 never sends the header; it sends only `x-hps-observation-format`
    (`src/proxyClient.ts:378-381` at `v0.1.56`);
  - it casts the profile JSON without validation (`:391-392`);
  - S2 compared 10 profiles × 16 request axes with the Service before it: all 109 cells without
    the header were byte-identical, and the 51 with it differed by the one trailing key. S6's
    route check repeats this for all 11 profiles;
  - an old Service serves no roster, so a new app registers no orchestrator tools.
- **The new app** sends the header on every `/v1/profile` request, kids included
  (`ext/src/proxyClient.ts:26-30`). It is a capability declaration: the Service decides.

### 2. The coach is the only voice and orchestrates through one host-executed tool

Shipped in Studio #1634 (A2), #1662 (A4) and #1669 (A5), and Service #96 (S5).

- **No SDK subagents for roster agents.** With a served roster, the app omits the SDK `agents`
  option and never lists Agent or Task in `tools`, whatever `sdk_tools.subagents` says
  (`orchestratorBindingFor`, `ext/src/sdkCoachHelpers.ts:320`). The legacy path stays for
  non-orchestrator cohorts and old apps.
- **The switch:** the orchestrator is on only for an adult tier without `minor_cohort`, with a
  parsed roster and the host's arguments (`resolveOrchestrator`,
  `ext/src/orchestratorSurfaces.ts:102`).
  - The parser refuses the whole roster when a field that decides behavior is wrong. It cleans
    display copy instead of refusing it (`parseServedRoster`, `ext/src/agentRoster.ts:205`).
- **The delegation tool:** `mcp__hypeproof__consult({ agent, question 4–400, focus? })`, next to
  `mcp__hypeproof__site_check`, on the in-process `hypeproof` MCP server
  (`ext/src/sdkCoachHelpers.ts:261-262`). When the cohort has no browser grant, they get a
  `hypeproof` server of their own.
- **What the host does** (`ext/src/consultTool.ts`):
  1. It refuses a minor or unknown tier, bad input, an unknown agent, the coach, aux and a
     disabled agent, before any request.
  2. It serializes runs per seat (`withConsultMutex`). Caps and the advisor's trigger are
     checked again inside the lock (`OrchestratorSession`, `:198`).
  3. It assembles **summaries, not transcripts**, from the agent's declared context keys only
     (`assembleConsultContext`, `:687`):
     - at most 3 files, `index.html` by default;
     - each path is contained by the coach's rule, before and after `realpath`;
     - a `..` or empty segment, an absolute path, a symlink out, a binary or a missing file
       refuses the whole consult;
     - excerpts share 40 KB, and the body stays within 48 KB (`:44-65`);
     - `scrubSecrets` runs on everything sent. The chat history is never sent.
  4. It calls `POST /v1/agents/:agent/run` once. The request carries `x-hps-orchestrator`,
     `x-hps-roster`, a uuid `x-hps-agent-call` and `x-hps-turn-id`, with a 75 s client timeout.
     A held pass lease (`trial_busy`) is waited for once, up to 20 s.
  5. It returns the validated JSON as the tool result, at most 2,000 characters
     (`CONSULT_RESULT_MAX`, `:59`). A longer answer loses its least severe findings first
     (B-8, `keepBySeverity` `:1022`, `consultSuccessText` `:1037`).
- **Results are advice to the coach.** Nothing is written back. The coach decides and writes
  under the existing approval policy.
- **The agent-run route** is `worker/src/routes/agents.ts`, mounted behind `signingSecretGuard`
  and `nativeTrialBudget` (`worker/src/index.ts:72-76`, `:117-118`). The Service decides the
  agent, the model, the whole prompt and the output contract. The client names the agent and
  sends `{question, context}`. Refusals come before anything is spent, in this order:
  1. the chat gate, exactly as on `/v1/messages`;
  2. the seat, by S2's own serving rule (B-5): 403 `minor_cohort`; 503
     `agent_model_unavailable` under a frozen lesson; 404 `orchestrator_off` with S2's reason;
     404 without the header; 409 `roster_changed` when `x-hps-roster` disagrees;
  3. 404 `agent_unknown` (also the coach and aux) and `agent_disabled`;
  4. 422 `context_invalid`: a missing turn or call id, a body over 48 KB, a body `model` or
     `system`, or the contract's input schema. An advisor without failure evidence gets 422
     `not_triggered`;
  5. on a metered seat, a helper model the plan does not entitle or price;
  6. 429 `agent_cap_reached`, counted in D1 per turn and per session for the seat. A call id
     that already ran is refused. An unreadable ledger is 503 `ledger_unavailable`
     (`worker/src/routes/agents.ts:398-404`).
- **The run:**
  - one upstream request with a 60 s timeout and no retry, not even CR-32's (B-11);
  - the roster's effort (B-10) and the gateway's thinking rule;
  - structured output for catalogue models on a dated list (`STRUCTURED_OUTPUT_MODELS`,
    `worker/src/routes/agents.ts:101`), with the contract's schema minus the bounds the API
    rejects. The bounds are still enforced when the output is checked.
- **Its answers:**
  - 200 with the whole validated output, findings ordered must, should, could (B-8,
    `worker/src/routes/agents.ts:190-209`);
  - 422 `agent_output_invalid` for a contract failure, a `max_tokens` stop or non-JSON text;
  - 502 or 504 for upstream failures;
  - 429 and 529 keep `retry-after` and the unified rate-limit headers.
- **The Service still never runs a loop or executes a tool.** The agent loop, the delegation and
  tool execution stay on the learner's machine. Inference stays at Anthropic.

### 3. Every upstream request is attributed, routed inside the allowed set, recorded and metered

Shipped in Studio #1634 (A2) and Service #92 (S3) and #88 (S4 part A). The usage-write queue is
not built.

- **Headers and env the app adds on an orchestrator seat** (`ext/src/sdkCoachHelpers.ts:1194-1216`):
  - `x-hps-orchestrator`, `x-hps-agent: coach@<roster-version>` and `x-hps-roster: <id>@<version>`;
  - `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, which makes the CLI send `x-claude-code-request-class:
    main | subagent | workflow | compaction | auxiliary`. That needs v2.1.273+ and is "off by
    default" behind a custom base URL (https://code.claude.com/docs/en/llm-gateway-protocol);
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-5-5`, because without it background calls use
    "The main model" under `ANTHROPIC_AUTH_TOKEN` (same page);
  - `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, so background work stays inside the turn.
  - On every seat, ambient lines for these headers are dropped first.
- **Helper runs need no header for identity.** The route parameter names the agent.
- **Resolution on `/v1/messages`** (`worker/src/lib/agent-routing.ts`, applied in
  `worker/src/routes/messages.ts`):

  | Request class | `x-hps-agent` | Seat runs a roster | Route | Recorded agent, resolution |
  |---|---|---|---|---|
  | absent | absent | any | today's path, no roster lookup | nothing new |
  | `main`, `compaction` | `coach@v` | yes | the learner's selection inside profile ∩ lesson, **without** the force-appended fast pin | `coach`, `learner_selection` |
  | `auxiliary` | `coach@v` | yes | the aux policy below | `aux`, `aux_fast` or `aux_lesson_locked` |
  | `subagent`, `workflow` | any | yes | today's path | `anomaly:<class>`, `today_clamp` |
  | any | `coach@v` | no | today's path | `coach` (no roster), `today_clamp` |
  | absent or unknown | `coach@v` | yes | today's path | `coach`, `today_clamp` |
  | any | not `coach@<semver>` | any | today's path | `unknown`, `today_clamp` |

  - Dropping the fast pin on the coach's own requests closes the bypass ADR 0006 measured, on
    orchestrator seats only.
- **The aux policy:**
  - the lean Service prefix (`worker/src/agents/aux-prefix.md`, 303 characters);
  - the client's system text demoted to the first user message as `<client-instructions>`;
  - `max_tokens` of at most 1,024, which a roster may only lower;
  - the roster's `text.fast` model (Haiku 5.5) when it is in the aux agent's allowed set;
  - the aux agent's effort (`low`), unless the cohort's course effort policy sets one. Both
    homepage cohorts set `medium`, so their aux requests run at medium.
  - A prefilled aux call runs on `claude-haiku-4-5` without thinking, as #73 does (B-12,
    `messages.ts:517-531`). Under a frozen lesson it stays on the lesson default.
- **Per-agent allowed set** (`allowedAgentModels`, `worker/src/agents/resolve.ts:98-114`):
  `{capability_policy[agent.capability]}` ∩ (profile menu ∪ the roster's role keys) ∩ lesson
  set. A frozen lesson model policy makes it empty (B-3). An empty set is a typed refusal, never
  a substitute (AE-25, AE-33, CR-32). B-12's prefill move is the one model change, and it
  predates this ADR.
- **The labels need no cryptographic trust:** every label only *reduces* what a request receives.
  - An "auxiliary" turn loses the coach prompt and is capped at 1,024 tokens.
  - A "coach" label gets nothing beyond the learner's own menu.

  This is how the design meets ADR 0006's call for "a trusted request-purpose discriminator".
  It also forbids a metering exemption keyed on the label (see Metering below).
- **Upstream rate-limit headers** (`worker/src/lib/ratelimit-headers.ts`; B-13):
  - A contract client sends `x-hps-agent`, `x-claude-code-request-class` or
    `x-hps-orchestrator: hps-agent-roster/1`. It gets `anthropic-ratelimit-unified-*` unchanged
    on every response, `retry-after` in integer seconds on 429 and 529, and 529 as 529.
  - The organization-level `anthropic-ratelimit-*` headers are never forwarded.
  - Every other client gets today's responses, 529 → 502 included.
  - Every 429 and 529, and one in 20 other responses, that carries a rate-limit reading is logged
    as a `ratelimit_sample` Analytics Engine datapoint. This applies to all traffic.
- **Recording** (`worker/migrations/0044-agent-attribution.sql`,
  `worker/src/lib/request-settings.ts`, `worker/src/lib/analytics.ts`):
  - Two new tables, keyed by request id, instead of new columns (B-7):
    `usage_request_attribution` (agent, request class, roster, capability, resolution,
    `stop_reason`, agent call id, session) and `usage_request_rows` (request id → `usage_log`
    row).
  - **Coverage fix:** an attributed request always gets a settings row. Without an effort receipt
    the row says `no_receipt` and claims no effort (`request-settings.ts:33`).
  - `GET /v1/request-settings/:turn` adds `agent`, `agent_title`, `request_class`, `roster`,
    `capability`, `resolution`, `stop_reason` and `agent_call_id` when they are set. Rows without
    attribution keep their exact keys and bytes. `session_id` is not returned.
  - `agent_version` is not stored. It is derived from `roster`, because roster versions are
    immutable.
  - A keyed `usage_log` row is stored once per request id, even under concurrent writes (CR-34).
  - **Pass FK fix:** a pass seat's usage row is now written once with session NULL
    (`usageSessionId`, wired at `messages.ts` and `observations.ts`). Before, the first INSERT
    failed on the foreign key and a retry stored it.
  - **Before 0044 is applied:** settings rows with a receipt are still written and the rest are
    skipped and logged. Usage falls back to the old statement. The agent-run route fails closed.
- **Metering:**
  - Each request uses one pass unit, helper and aux requests included (O-1 default). A failed
    attempt follows the pass rules of #69 and #77.
  - An agent run on a pass seat reserves one unit and holds the lease while it runs. A 200 keeps
    the unit. A 422 or a refusal gives it back; a 422's usage is still recorded and counted
    against the cap (B-9).
  - A metered seat may only run a helper whose model its plan entitles and prices (O-13).
  - **Not built:** a separate `agent_requests` allowance (O-1). Product Intent requires the
    learner to understand what a pass includes before running (`docs/PRODUCT-INTENT.md:120-121`,
    `:131`), and AB-10 keeps meters distinct.

### 4. Read-only help runs without a modal; writing stays with the coach; the learner sees who worked

Shipped in Studio #1634 (A1, A2), #1662 (A4) and #1669 (A5).

- **Consult's approval kind is `consultHelper`.** It is in the `requireApprovalFor` enum but not
  in its default (`ext/package.json:436-456`). The setting stays machine-scoped and the single
  approval source.
  - canUseTool answers `ask` with that kind, so a machine that lists it gets a modal (B-17).
  - The modal reads "코치가 도우미에게 물어보려고 해요", with the seat's coach name. It names the
    helper and its model, quotes the question, says the helper sees no chat history and changes
    no file, and has the button "묻기" (`consultApprovalCopy`).
  - Helpers have no tools.
- **Writes** keep REQ-M17's path. **Legacy delegation** keeps its modal.
- **Visibility (AE-27):**
  - Timeline lines come from `orchestratorToolEntry` (`ext/src/chatPanelProvider.ts:317`) and
    render through the existing `ToolLine`:
    - consult, updated in place: "🔎 검토 도우미 · Claude Haiku 5.5 — 묻는 중", then
      "… — 고칠 곳 2개";
    - site check: "📏 390·1280px 확인 — 통과", "📏 390px에서 2곳 넘침" or "📏 미확인(미리보기 꺼짐)".
      There is one line per page per turn, with state `done` whatever the verdict;
    - archive: "🗂 이전 버전 보관 (.hypeproof/history) — <file>";
    - the busy notice.
  - Diff results are not drawn; the coach reads them in the save's result. Aux calls never
    appear.
  - **Findings are never rendered to the learner.** The timeline shows a count only, so a helper
    never speaks to the learner.
  - The details list names each request's agent and model
    (`ext/webview-ui/src/EffortControl.tsx:31-46`): "코치 ·", "검토 도우미 ·", "보조 작업 ·". A
    `no_receipt` row reads "처리 수준 기록 없음". The parser accepts `no_receipt` and marks an
    unknown reason on its own row only (`ext/src/modelSelection.ts:39`).
  - There are no per-answer badges, which AE-27 does not require.
  - The coach brief tells the coach to name the helper whose finding it uses ("Human judgment
    stays visible"). **Unverified:** no real model run has shown that it does.
- **Minors:**
  - the orchestrator is never served to them: the Service adult rule (B-1), the harness
    `child_orchestrator` FAIL, and the client strips in `orchestratorBindingFor`,
    `resolveOrchestrator` and `runConsult`;
  - no new model or classifier touches child text (REQ-O);
  - moderation stays deterministic;
  - the SDK bump still changes the kids' engine, so it needs a kids validation run and notice
    (`docs/AUTONOMY-MANDATE.md`). No such run is recorded on #1618.

### 5. Deterministic tools replace model calls

Shipped in Studio #1629 (A3), #1662 (A4) and #1669 (A5).

- **`site_check`** (`ext/src/siteCheck.ts`, `ext/src/siteCheckRunner.ts:153`, `SiteCheckViewports`
  in `ext/src/browserMcp.ts:341`):
  - **Mechanism:** one CDP `Runtime.evaluate` in the live server's `/__hp_viewport` wrapper. The
    script reloads the saved page, sets each width, measures and restores the width. Emulation
    is ignored by the shipped shell (`src/experimentBrowser.ts:661-663` at `bcfe8ebd`), so the
    width is set on the wrapper's frame.
  - **The tab:** the check measures in a background tab of its own, opened without focus and
    closed after the check. It may also use the learner's own 화면 크기 검수 tab when that tab
    shows the same wrapper. It never uses the learner's preview tab (B-18).
  - **What fails at 390 and 1280:** overflow, with its offenders; content cut off by a clipping
    wrapper; no viewport meta; an `img` without `alt`; a resource loaded from another origin; a
    body font under 16px. Small tap targets are advice, not a fail.
  - **When it runs:** after each coach HTML write, through an SDK `PostToolUse` hook, which adds
    zero model requests; and on demand.
  - It is `unverified` whenever it cannot measure, and never `pass`.
- **Diff guard** (`ext/src/diffGuard.ts:264`):
  - The `PreToolUse` hook keeps the file's current content, and the `PostToolUse` hook reports
    the change. Hooks are used because `canUseTool` "is invoked only when the permission
    evaluation flow resolves to a prompt" (https://code.claude.com/docs/en/agent-sdk/typescript).
  - It reports the share of the existing content that did not survive, weighted by characters,
    and whether the 정보블록 contains the change. Its verdict is `unchanged`, `inside`, `partial`
    or `rewrite`.
  - It reports through `additionalContext` and never blocks (O-5 default).
- **The hooks** (`ext/src/orchestratorHooks.ts:190`) return one `additionalContext` of at most
  400 characters (`:41`, `:97`). They never return a decision or a rewrite. A2's guard strips
  any `allow`, `approve` or input rewrite a hook returns anyway (`guardOrchestratorHooks`,
  `ext/src/sdkCoachHelpers.ts:1300`).
- **Archive before overwrite for adults** (`ext/src/adultArchive.ts`):
  - Before, only kids' world cohorts archived.
  - Adult orchestrator seats whose roster lists `archive_before_overwrite` now copy the old file
    to `.hypeproof/history/<name>-<YYYYMMDD-HHmmss>.html`. This happens before a coach Write
    replaces an existing workspace `.html`, and before a reveal (`revealBuilt`,
    `ext/src/chatPanelProvider.ts:3326`, `:3430`).
  - Edits are not archived; they get a diff.
  - It keeps the newest 20 copies per page (`ext/src/adultArchive.ts:27`). Minor seats never get
    a `.hypeproof` folder.
- **PowerShell destructive verbs** (`ext/src/shellPolicy.ts:132`):
  - A Windows pass runs after the unchanged Unix rules and can only add a flag.
  - It covers the draft's list (`Remove-Item`/`del`/`rd`, `Format-Volume`, `Stop-Process`,
    `Set-ExecutionPolicy`, `iex`, `reg`, `takeown`, `icacls`, `irm|iwr … | iex`,
    `-ExecutionPolicy Bypass`, `-EncodedCommand`), plus the remaining aliases and cmd forms.
    Matching is case-insensitive.
  - A differential over 300,000 generated Unix commands found no changed Unix verdict.
- **The PowerShell tool:** it gets Bash's verdict and is not granted (B-15).

### 6. Escalation is a capped Opus 5.5 roster agent behind deterministic failures and an eval

Built in Service #80 (S1) and #96 (S5) and Studio #1662 (A4). It is switched off on every cohort.

- **`design-advisor`:** capability `reasoning.high` → `claude-opus-5-5`, effort medium,
  4,096 tokens, no tools. It returns `{diagnosis, plan[≤5], stop, ask_learner?}`.
- **Triggers:** consult refuses it unless the host recorded one of these this turn
  (`OrchestratorSession`, and `OrchestratorStreamObserver` in `ext/src/orchestratorHooks.ts:296`):
  - F1: a repeated `site_check` fail after a fix;
  - F2: two structure-guard blocks;
  - F3: two failed edits on one file;
  - F4: an HTML write cut at `max_tokens`. **Inference:** read from two places and not observed
    on a real CLI;
  - F5: an `error_max_turns` on the previous turn.

  The Service cannot see the host's record. It refuses an advisor run without failure evidence
  (422 `not_triggered`).
- **Caps and gate:** 1 per turn and 2 per session on practice, 1 and 1 on the pass. It stays off,
  the synthetic cohort included, until eval E-ADV (O-4). The arms are Sonnet 5.5, Sonnet 5.5 +
  advisor, and Opus 5.5. **Not built:** E-ADV.
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

**Not built** (S10).

- **The signal:** a "may need help" signal for the instructor console, per adult seat.
- **Inputs:** numeric usage features only (failures, stalls, check fails, minutes since the last
  successful write). Never learner text or file content.
- **First a rule:** a deterministic rule ships first.
- **Then Decisions, eval-gated:**
  - a `predicate` question, not `choice`, which a community test found overconfident;
  - model `gpt-6-luna`;
  - an extension of the intake client, which parses only `choice` today
    (`worker/src/lib/intake/decision-provider.ts:9,35-58` at `2e563ce`);
  - a 2 s timeout, fail-open, and computed lazily when the console polls;
  - a daily micro-USD budget reusing the intake reservation pattern
    (`worker/src/lib/intake/decision-review.ts:13,25-27`), never charged to learners.
- **Data handling (OWNER DECISION O-6):** Decisions processes in the US and EU only, with 30-day
  abuse-monitoring retention (https://developers.openai.com/api/docs/guides/your-data).

### 8. Defaults change only through measured roster versions

- **Built:** each attributed request records its agent, roster, capability, resolution and
  `stop_reason` (section 3). The digest pin makes every roster edit reviewable.
- **Not built** (S9): the nightly `agent_daily_metrics` rollup for operators (MU-07), shadow
  replay, and the planted-defect eval set.
- **Metrics:**
  - requests and cost per completed step;
  - cache-hit rate;
  - per-agent spend share;
  - refusal and truncation rates;
  - helper invalid-output rate;
  - quality-floor checks: site-check pass, diff precision, unverified claims.

  All are cut by cohort, roster version, agent and model.
- **How a default changes:**
  1. Propose a new immutable roster version, with its digest pin.
  2. Shadow-replay it on consented adult inputs and a planted-defect eval set ("정답을 심고
     시작한다", `.claude/rules/verification.md` rule 3).
  3. Canary it on a synthetic cohort, then on one human cohort.
  4. Promote it by a profile edit.
- **Guardrails:**
  - Resolution never reads balances or remaining units: no silent downgrade under budget
    pressure (AB-05). The code holds this (`worker/src/agents/resolve.ts:13-14`).
  - Caps stop helpers; they never swap models.
  - The coach's model never changes mid-turn (AE-29).
  - A cheaper candidate that raises refusal, truncation or false-pass rates is rejected.
  - Minors and model-practice cohorts are excluded.

### 9. Homepage first

Shipped as roster `homepage@1.0.0` (`worker/src/agents/rosters/homepage.ts`) on two profiles,
both switched off. Only the synthetic acceptance cohort is on (see "Production state").

| Agent | Model | Effort, `max_tokens` | Role and trigger | Caps (turn, session): practice / pass | Enabled |
|---|---|---|---|---|---|
| `coach` | the learner's selection; `capability: coding` is recorded only | the course policy, 16,384 | the voice; writes; consult; `site_check` | 0, 0 | yes |
| `site_check`, `diff_guard`, archive | none (deterministic) | — | after writes | — | the roster's `checks` |
| `design-reviewer` | Haiku 5.5 (`text.fast`) | medium, 2,048 | helper; `coach_consult`; quality-floor contract | 1, 6 / 1, 4 | yes |
| `design-advisor` | Opus 5.5 (`reasoning.high`) | medium, 4,096 | advisor; `deterministic_failure` | 1, 2 / 1, 1 | **no** |
| `site-brief` | Haiku 5.5 | low, 1,024 | helper; `coach_consult` (P1) | 1, 2 / 1, 2 | **no** |
| `aux` | Haiku 5.5 | low (the course policy makes it medium on both cohorts), 1,024 | CLI background calls; lean prefix; metered | 0, 0 (never consulted) | yes |

- **Profiles** (S6): `homepage-practice-s1.ts:76` carries the roster at its own caps;
  `studio-native-trial.ts:81-88` carries it with overrides to the pass caps. Each is a single
  profile line to switch on.
- **Coach skills:** the coach prefix uses the homepage harness skills from Service #74
  (`399109c`). Practice loads `homepage-craft` and `homepage-sections`; the pass adds
  `homepage-update` (`homepage-practice-s1.ts:68`, `studio-native-trial.ts:44`).
- **Not loaded:** `design-craft` (it contradicts them on viewports and audience),
  `publish-homepage` (14.8 KB, which would ride every request) and `workshop-setup` (the
  `irm | iex` hazard).
- **Model hypotheses:** Haiku 5.5 is about 1/20 of Sonnet 5.5 per token, and review is the light
  step. Both are hypotheses until E-REV compares the reviewer against the coach's own
  self-critique on planted defects. **Not built:** E-REV.

---

## What shipped

| WP | PR | Merged as | What it added | Main files |
|---|---|---|---|---|
| S1 | hypeproof-service#80 | `4837136` | roster and contract types, the homepage roster and three helper contracts, load-time refusal, the digest, the serving conditions, per-agent model resolution, the prompt builder and the aux prefix | `worker/src/agents/*`, `worker/src/profiles/types.ts:432-436` |
| S4 part A | hypeproof-service#88 | `f9bf8a5` | migration 0044, attribution on the settings write and read paths, usage rows keyed by request id, the pass FK helper | `worker/migrations/0044-agent-attribution.sql`, `worker/src/lib/{request-settings,analytics}.ts` |
| S2 | hypeproof-service#91 | `343031f` | `/v1/profile` serving behind the header, `lesson_features`, four harness rules | `worker/src/routes/chat.ts`, `worker/scripts/cohort-harness/` |
| S3 | hypeproof-service#92 | `ece30b6` | routing by agent label and request class, the aux policy, rate-limit header forwarding, 529 passthrough, sampled rate-limit logging, the pass usage row written once | `worker/src/lib/{agent-routing,ratelimit-headers}.ts`, `worker/src/routes/{messages,observations}.ts` |
| S6 | hypeproof-service#93 | `b71c007` | the roster on the practice cohort and the pass (off), the synthetic acceptance cohort (on) | `worker/src/profiles/{homepage-practice-s1,studio-native-trial,synthetic-orchestrator-acceptance,index}.ts` |
| S5 | hypeproof-service#96 | `38d8879` | `POST /v1/agents/:agent/run`, its mounts, caps counted in D1, the deploy note | `worker/src/routes/agents.ts`, `worker/src/index.ts`, `worker/DEPLOY.md:225-253` |
| A3 | hypeproof-studio#1629 | `4304c25f` | site check, diff guard and adult archive as pure modules; PowerShell and cmd verbs in the live shell gate | `ext/src/{siteCheck,diffGuard,adultArchive,shellPolicy}.ts` |
| A1 + A2 | hypeproof-studio#1634 | `7b8a315f` | A1: the exact Agent SDK 0.3.299 pin with its binary manifest and seed scripts, the `extension / windows smokes` job, `consultHelper` in the approval enum. A2: the deny table, orchestrator headers and env, `permissionMode: 'default'` on every seat, the consult and site-check names, the hook guard, the busy notice and bounded abort, the 200K compaction pin | `ext/package.json:501`, `ext/src/sdkBinaryManifest.ts:30`, `scripts/seed-sdk-binary.{sh,ps1}`, `.github/workflows/pr-ci.yml:257`, `ext/src/sdkCoachHelpers.ts` |
| A4 | hypeproof-studio#1662 | `21bd15ba` | the roster parser, the consult host, the site-check runner over CDP, hooks and failure events, the switch-off inventory, the wiring in `runSdkCoach` | `ext/src/{agentRoster,consultTool,siteCheckRunner,orchestratorHooks,orchestratorSurfaces,sdkCoach,browserMcp}.ts` |
| A5 | hypeproof-studio#1669 | `834a6fb1` | the header on `/v1/profile`, the host arguments on the SDK turn, timeline lines, the details list, the consult modal, the archive before `revealBuilt`, the site-check tab, the severity-aware cut, `no_receipt` parsing | `ext/src/{proxyClient,protocol,chatPanelProvider,browserMcp,consultTool,modelSelection}.ts`, `ext/webview-ui/src/EffortControl.tsx` |
| A5 follow-up | hypeproof-studio#1672 | **open** | `consult-tool.smoke` in the Windows job. Merging it needs a token with the `workflow` scope | `.github/workflows/pr-ci.yml` |
| Deploy | hypeproof-studio#1700 | `6ad5f9f8` | the Service pin at main `9dbe15c8`, which is S1–S6 plus #78 and #98 | `config/service-deployment.json` |

Each work-package PR compared its behavior without the headers or the roster against `main`,
with snapshots, digest matrices or differentials, and reports its controls and mutation results
in its PR body.

**Not built:**

- S4 part B, the queue for usage writes (O-8);
- S7, the admission hot path and per-seat leases (O-10);
- S8, the roster store in D1 (O-9);
- S9, metrics, shadow replay and the eval set;
- S10, the stuck signal;
- A4 part B: session resume, moving the volatile tail, and counts-only trace events;
- D2/D3, the requirement rows, validation docs and registry nodes: #1630, #1656 and #1666, all
  open;
- E1, e2e acceptance (Codex).

## Production state

Checked on 2026-10-16.

- **Service code:** in production since Studio #1700, which pins the Service at main `9dbe15c8`
  (`config/service-deployment.json`). deploy-worker run 38762752350 on `6ad5f9f8` started on
  2026-10-15 at 15:42 UTC and succeeded, through "Deploy Worker" and "Verify production".
- **Flags:** only `synthetic-orchestrator-acceptance` is on
  (`worker/src/profiles/synthetic-orchestrator-acceptance.ts:31`).
  - `homepage-practice-s1` and `studio-native-trial` carry the roster switched off.
  - Three profiles inherit the pass's switched-off field by spread. Two of them run the proxy
    runtime and can never be served a roster.
  - No other profile has the field (`worker/test/orchestrator/profiles.test.mjs:69-78`).
  - S6 left the synthetic cohort's `cohorts` row and issuer scope for R3, so no seat is expected
    to exist for it. **Unverified in production:** this was not queried.
- **Inert for learners:** without the `x-hps-*` headers every profile's `/v1/profile` body is
  byte-identical to before, which the profile-serving snapshot checks in CI and in the deploy's
  smoke step. Two things changed without the headers:
  - S3's `ratelimit_sample` telemetry, on upstream responses that carry a rate-limit reading;
  - a pass seat's usage row, which is now written in one INSERT instead of a failed one and a
    retry. The stored row is the same.
- **Migration 0044 is not applied.** `deploy-worker.yml` at `6ad5f9f8` applies migrations up to
  0043 and has no step for 0044 (`.github/workflows/deploy-worker.yml:190-255`). The epic's
  status of 2026-10-15 lists that step as open. The production D1 was not queried.
  - Without the tables, the agent-run route answers 503 `ledger_unavailable` before any provider
    request (`worker/src/routes/agents.ts:398-400`; S5's ledger control).
  - **Unverified in production:** this is shown by tests, not observed.
  - Adding the step is a workflow PR. `DEPLOY.md` states the order: 0044 before helper runs.
- **The app:** the latest published release is v0.1.56 (2026-09-08), which never sends
  `x-hps-orchestrator`. So no seat in the field is served a roster.
  - Release candidate `v2026.1016.0-rc.1` at `6ad5f9f8` carries A1–A5. It exists only as draft
    prereleases (2026-10-15).
  - Its macOS build passed "Verify branding + vendored SDK" with `REQUIRE_SDK_VENDOR=1`
    (build-mac run 38776647996). Its Windows build passed the portable smoke (build-windows run
    38776647947).
  - **The release guard on #1618** (comment of 2026-10-14) applies to it. No release before a
    kids validation run on SDK 0.3.299, E1 on macOS plus the Windows CI smoke, and a canary soak
    (O-11). The Windows CI smoke passes on PRs. No kids validation run, E1 run or soak is
    recorded on #1618.

## Decisions made while building

The work packages and the coordinating session made these choices inside this design. "Open for
the owner" is "yes" where the work package asked for the owner's review, in its PR or its
handoff, and no owner decision is recorded.

| ID | Decision | Where | Why | Open for the owner |
|---|---|---|---|---|
| B-1 | Adult means not `isMinorCohort` and a known lower age bound of 18 or more. A mixed or unknown audience counts as minor | `worker/src/agents/resolve.ts:24-33` | the `curriculumRuntimeAllowed` posture: when in doubt, deny for minors | yes |
| B-2 | The orchestrator stays adult-only after Service #87 and Studio #1527 let profile switches decide features at any age | `worker/src/routes/chat.ts:282-284`; app strips in `orchestratorBindingFor`, `resolveOrchestrator` | the conservative reading, consistent with B-1 | yes: whether it follows the profile at any age |
| B-3 | Any frozen lesson model policy (`model.lesson_locked`) leaves helpers with no model, even when the frozen menu lists the helper's model: `agent_model_unavailable`, 503 on the run route | `worker/src/agents/resolve.ts:107-112` | lesson bindings freeze the learner's menu and no agent roles, so no helper model was rehearsed under them | yes, with O-3 |
| B-4 | A lesson that narrows a feature gets `{enabled:false, reason:"lesson_features"}`, with or without a model policy | `worker/src/routes/chat.ts:275-278`, `:336-340` | a helper's context comes from the workspace; a narrowed coach must not be widened through its helpers | no (the coordinator's decision) |
| B-5 | The agent-run route refuses every seat that `/v1/profile` serves no roster | `servingInputs` and `servedOrchestrator` in `worker/src/routes/agents.ts:150-163`, `:316-327` | a modified client must not reach a helper | no |
| B-6 | A per-cohort override can switch a helper or the advisor on or off and lower its caps. It can never raise a cap, add an agent or touch the coach or aux. The registered profiles use caps-only overrides, which S6's test enforces | `withOverrides`, `worker/src/agents/resolve.ts:35-63`; `worker/test/orchestrator/profiles.test.mjs` | one roster and one digest across cohorts | yes |
| B-7 | New re-runnable tables keyed by `request_id`, instead of `ALTER` | `worker/migrations/0044-agent-attribution.sql` | deploy-worker re-runs migration files on every deploy, and SQLite has no `ADD COLUMN IF NOT EXISTS`; 0024 solved the same problem with a side table | no |
| B-8 | The Service returns the whole validated answer, findings ordered must, should, could. The app trims to 2,000 characters and marks `truncated` and `cut` | `worker/src/routes/agents.ts:42-47`, `:190-209`; `ext/src/consultTool.ts:1022-1075` | a review at its contract limits is about 2,739 characters, and a Service trim would hide the mark from the coach | no |
| B-9 | A 422 on a pass seat gives its unit back (#69, #77). Its usage is recorded and the cap counts the run | `nativeTrialBudget`; `worker/src/routes/agents.ts:33-38` | the pass rule for every non-stream error | yes |
| B-10 | Helpers run at the roster's effort. The course policy and `x-hps-effort` are ignored, and the settings row says `no_receipt`. Aux requests on `/v1/messages` differ: the course policy still sets their effort | `worker/src/routes/agents.ts:416-424`; `worker/src/lib/request-settings.ts:33`; `worker/src/routes/messages.ts:638-677` | the effort is in the digest, and E-REV evaluates it | yes |
| B-11 | One upstream request per run and no retry, not even CR-32's | `worker/src/routes/agents.ts:13` | MU-02 | yes |
| B-12 | A prefilled aux call is served on `claude-haiku-4-5` without thinking, as #73 does, and never moved off a frozen lesson's set | `worker/src/routes/messages.ts:517-531` | Haiku 5.5 rejects an assistant prefill; the first S3 version regressed #73 | no |
| B-13 | 429/529 headers go to orchestrator (contract) clients only, and only they see 529 as 529 | `worker/src/lib/ratelimit-headers.ts:5-13`, `:48-67` | installed apps keep their 502 handling | no |
| B-14 | A deny table for 12 tools that SDK 0.3.299 added or widened, each with its reason | `SDK_DENIED_TOOLS`, `ext/src/sdkCoachHelpers.ts:2338` | none has a Studio use, and `SendFeedback`'s own permission check always allows | no |
| B-15 | PowerShell gets Bash's verdict and is not granted | `SHELL_TOOLS`, `ext/src/sdkCoachHelpers.ts:2309-2318`; `permittedToolsFor` `:212-243` | A2 landed before A3's verbs; granting is one line now that A3 is merged, and changes `tools` for shell cohorts | yes |
| B-16 | A 200K auto-compaction pin on every seat, orchestrator or not | `ext/src/sdkCoachHelpers.ts:898-911`, `:1221-1223` | the 1M window came with the engine bump, not with the orchestrator; the pin is a no-op for gateway aliases | yes |
| B-17 | Consult is `ask` with kind `consultHelper`, which is not in the default list, so there is no modal by default | `ext/package.json:436-456`; `ext/src/chatPanelProvider.ts:287` | `allow` would stop a machine from ever requiring the modal | yes |
| B-18 | The site check measures in a background tab of its own, never the learner's preview | `SiteCheckViewports`, `ext/src/browserMcp.ts:341` | navigating the preview on every save would turn it into the 390px view; the cost is a tab in the strip for about 0.2–2 s per HTML save | yes (UX) |

Two more choices hold until someone decides otherwise:

- The Service counts caps per session (a class run or a pass grant), agent and seat. The app
  counts per conversation.
- On a classroom seat, two parallel runs could both pass the count. The shipped app's per-seat
  mutex prevents that, and S7's per-seat lease (not built) would bound a modified client.

## Unverified

**On a real CLI (2.1.299).** These are E1 scenarios; the binary was read, never run against a
gateway:

- that `x-claude-code-request-class` arrives with `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, and
  which class each call carries;
- that the CLI calls the in-process hooks with the inputs the host expects, and passes
  `additionalContext` to the model;
- when an MCP tool call starts relative to the pass lease, which decides how often a consult
  meets `trial_busy`;
- F4 detection, and what the CLI does with an aborted hook;
- the 2.1.281 "cut short" stream case;
- the PowerShell tool on Windows without Git Bash;
- that a learner workspace's `AGENTS.md` stays out (inference from the binary text);
- that SDK subagent prompts never reach the model (the Context inference).

**Against the real Service and provider:**

- the structured-output request (`output_config.format`) for the listed models. It is built to
  the docs, and no provider call was made;
- whether the Fly proxy passes upstream response headers through. **Inference:** an API-key
  upstream sends no `anthropic-ratelimit-unified-*`;
- the agent-run route and the S4 rows in production. 0044 is not applied, so the route can only
  refuse there.

**In the real app:**

- the background check tab in the shipped shell, and CDP timers on it. **Inference:** covered
  tabs report `visible`, so no throttling is expected;
- the consult modal, the timeline lines and the details list in the real webview. Only render
  smokes ran;
- seeding the 0.3.299 binary on a learner machine. The rc build only proved the vendored SDK
  entry;
- whether the coach names the helper whose finding it uses.

**Not run.** None of these is recorded on #1618 or in the work-package PRs:

- the kids validation run on SDK 0.3.299;
- E1, E-REV, E-ADV and the load test;
- `consult-tool.smoke` on Windows from `main`. It passed on windows-latest only in the CI of
  #1669 and #1672.

---

## Capacity and scaling

Measured or read for the draft at Service `2e563ce` and Studio `bcfe8ebd`, unless a line names
another ref. The status of each mitigation is as of 2026-10-16.

**Where each part runs:**

- The learner's machine runs the loop, the delegation and the tools.
- The Cloudflare Worker gates, rewrites and meters each request.
- Every model call then hops through the Fly proxy `hypeproof-sediment.fly.dev` (NRT). It exists
  because Workers "occasionally lands fetches on HKG, where Anthropic's geo policy refuses"
  (`worker/wrangler.toml:82-86`).
- Anthropic serves every seat from one organization key (`messages.ts:352`).
- KV holds the roster, sessions and pauses. D1 holds the ledgers.

**Per-request Service work at a warm isolate, before this work:**

| Seat | KV reads | D1 reads | D1 writes | Notes |
|---|---|---|---|---|
| Classroom | 4 | 1 | 1 | — |
| Paid pass | 10 | 6 | 6–8 | the full gate runs twice: `native-trial-budget.ts:28-29` and `messages.ts:255`. The agent-run route also runs it twice |
| Metered | 4 | ≈21 | ≈11–12 | — |

- **Upstream:** exactly one fetch, with no retry and no queue (`messages.ts:586-592`).
- **429 and 529:** they lost `retry-after`, and 529 became 502 (`messages.ts:603-622`). That is
  still true for clients without the contract (B-13).
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

**Load test with no provider spend (not built):**

- **Setup:**
  - a mock Anthropic SSE server with configurable latency and usage, which injects 429 and 529
    with `retry-after` and `anthropic-ratelimit-*` headers;
  - the staging Worker (`worker/wrangler.staging.toml`) with `ANTHROPIC_PROXY_URL` pointed at the
    mock. The URL is already configurable (`worker/src/lib/anthropic.ts:72-73`);
  - a driver replaying CLI-shaped bodies at those rates, with a seat-claim burst.
- **What it measures:** overhead, D1 errors, KV refusals, CPU and retry pacing.
- **Real limits** are read from production responses without an extra call: S3's sampled
  `ratelimit_sample` datapoints do this now.

**Mitigations:**

| Mitigation | Status |
|---|---|
| Forward `retry-after` on 429 *and* 529, as Claude Code's gateway contract asks: "Forward the upstream's values unchanged" (https://code.claude.com/docs/en/llm-gateway-protocol) | shipped for contract clients (S3, B-13) |
| Show "지금 요청이 많아 잠시 기다리는 중이에요" on the first busy retry, and abort after 3 retries or 90 s with a Korean retry message, instead of waiting for the 240 s stall watchdog | shipped (A2, `ext/src/sdkCoachHelpers.ts:1571-1585` at `6ad5f9f8`). The CLI's own stream-idle floor is 300 s, so both stay below it |
| Log `anthropic-ratelimit-*` (sampled, and on every 429 and 529) | shipped (S3) |
| Fix the pass `usage_log` FK double write | shipped (S4 part A helper, S3 call sites) |
| Put helper and aux calls in the Haiku 5.5 bucket, away from Sonnet 5.5 | shipped in the roster, for orchestrator seats |
| Queue or batch the non-metering usage writes (O-8) | not built (S4 part B) |
| Move roster seats and classroom seat leases to D1 rows: an atomic insert and an indexed lookup. A Durable Object is the fallback | not built (S7, S8) |
| Cap classroom seats at 2 in-flight requests, with a 600 s ceiling (O-10) | not built (S7) |
| Index `native_trial_requests` and memoize the double gate | not built (S7) |
| Replace the per-turn flattened transcript (`src/sdkCoach.ts:518-521` at `bcfe8ebd`) with session resume, so conversation caches survive across turns | not built (A4 part B) |

---

## Rollout

The code in both repositories cites these step numbers.

| Step | What | State on 2026-10-16 |
|---|---|---|
| R1 | Deploy the Service with every learner flag off, and apply 0044 | The code is deployed (Studio #1700). The no-header snapshots are byte-identical. 0044 is not applied, so helper runs fail closed |
| R2 | App build N with A1–A5: SDK 0.3.299 (O-11) and the kids validation run with notice | `v2026.1016.0-rc.1` exists as draft prereleases. No kids validation run is recorded. The release guard on #1618 applies |
| R3 | E1 acceptance (Codex) on `synthetic-orchestrator-acceptance` | Not recorded as started. It needs 0044, a `cohorts` row and an issuer scope for the cohort |
| R4 | Canary on `homepage-practice-s1` with adult instructors (O-2) | Waiting for R3. One profile line |
| R5 | The paid pass `studio-native-trial`, after O-1 and the Haiku 5.5 price digests for metered seats (O-13) | Waiting for R4. One profile line |
| R6 | The advisor, after E-ADV (O-4) | Waiting for E-ADV. One override line per cohort |

- **SDK packaging for R2** (A1, shipped): the exact pin `0.3.299` in `ext/package.json` and the
  lockfile, six platform sha512 and size entries in `ext/src/sdkBinaryManifest.ts`, and the same
  version and hashes in `scripts/seed-sdk-binary.{sh,ps1}`. A smoke locks all three.
  - Native Haiku 5.5 needs ≥0.3.293, and the "aborted after 180 seconds" gateway fix is in
    2.1.299. Avoid 2.1.265–267 and 2.1.275 behind a gateway.
  - Re-verified by A1 and A2 in code and typings:
    - `permissionMode: 'default'` is explicit on every seat;
    - MultiEdit has no tool definition, so its name in the write set is inert;
    - the task-tool surface change does not reach Studio's explicit `tools` list;
    - the 1M-window default is held at 200K (B-16).
- **Windows CI** (A1, shipped): the `extension / windows smokes` job runs the shell-policy,
  containment, SDK-binary and SDK-vendor smokes on windows-latest. `consult-tool.smoke` joins it
  when #1672 merges.
- **Rollback** at each step is one profile line. A seat with no roster routes as today; an
  `x-hps-agent` label on it is only recorded.

---

## Consequences

**Gained:**

- Service-owned, versioned agents with their own prompts, contracts and models. They are refused
  at load when invalid and pinned by digest.
- Exactly one upstream request per helper run, with no retry and no parallel fan-out.
- Attribution of every request on an orchestrator seat.
- The request-purpose marker ADR 0006 lacked, on orchestrator seats.
- Deterministic review at zero model cost.
- Upstream rate-limit headers and 529 for contract clients, and a bounded busy wait in the app.
- A path to cheaper defaults through roster versions. The measurement half (S9) is not built.

**Costs:**

- One Service route, one migration with two tables, one synthetic profile and four harness
  rules.
- Eight new app modules, two MCP tools and two hooks.
- An SDK bump (0.3.207 → 0.3.299) that also moves the kids' engine, and a 200K compaction pin on
  every seat.
- Helper calls use pass units, given back on failure, until O-1 says otherwise.
- A background tab for about 0.2–2 s per HTML save on orchestrator seats.
- The requirement docs and the traceability registry lag the code until D2/D3.

**Not claimed:**

- That Haiku 5.5 reviews Korean pages well (E-REV), or that the advisor pays (E-ADV).
- Any capacity number beyond the stated inferences.
- Anything listed under "Unverified".

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

The behavior shipped before these rows changed. The requirement and validation docs are
Codex-side under the 2026-09-08 role split. They are tracked in #1630, #1656 and #1666, all
open. Until they land, `docs/studio-requirements.md` describes only the paths that existed
before this work.

- **REQ-M10:** add the agent-run and aux prompts. Client text never becomes `system`, and an
  agent run refuses a body `system` or `model`.
- **REQ-M11:** the fast pin applies to `auxiliary` only on orchestrator seats. The coach's own
  requests there lose the force-appended pin.
- **REQ-M12:** unchanged.
- **REQ-M22 ③:** legacy-only. Consult is modal-free by default and visible.
- **REQ-M23:** since 2026-10-05 it no longer gates SDK subagents by age. The orchestrator is an
  explicit exception and stays adult-only (B-1, B-2).
- **REQ-M41/M42:** a helper's model is quiet server resolution, and an unavailable model is a
  typed refusal. B-12's prefill move is recorded with the model that ran.
- **REQ-E1:** the approval enum offers `consultHelper`; the default is unchanged.
- **AE-25:** per-agent intersection. A frozen lesson leaves it empty (B-3).
- **AE-27:** agent and model per request in details, including the `no_receipt` reading.
- **AE-28:** capability rows for Haiku and Opus 5.5 on the agent-run route, for structured
  outputs, and for Sonnet 5.5 × SDK 0.3.299.
- **AE-29:** a helper's model is a role, not a change of the coach's model.
- **AE-33:** off under frozen lessons (`lesson_locked`), and off under narrowed features
  (`lesson_features`, B-4).
- **MU-02:** one upstream request per run, no retry (B-11). **MU-04:** a 422 run's usage is
  recorded as spent.
- **AB-05/07/10:** no downgrade; each helper attempt is linked to its turn and settled with its
  usage; meters stay distinct. A 422's pass unit is given back (B-9).
- **US-05/11:** a single cost source.
- **REQ-O:** unchanged.
- **New rows:** FO-01 to FO-12 in `docs/requirements/front-line-orchestrator.md`. The file does
  not exist yet, although commits and `docs/studio-requirements.md` REQ-M4 already cite FO-09 to
  FO-11.
- **Also stale:** `docs/sdk-bundling.md` still cites SDK 0.3.207. `config/traceability.json` has
  no node for the new modules, their smokes or this ADR.

## Owner decisions (open)

The defaults are the ones the epic sets until the owner decides.

| ID | Decision | Default in force |
|---|---|---|
| O-1 | Pass units for helper and aux requests | yes, one per request; failed attempts are given back (B-9) |
| O-2 | The human canary cohort and its date | `homepage-practice-s1`; no date |
| O-3 | The roster inside frozen lessons | off under frozen lessons (B-3, `lesson_locked`) |
| O-4 | Advisor thresholds | advisor off |
| O-5 | Whether the diff guard may ask | never blocks |
| O-6 | Decisions data handling and budget | the deterministic rule only (not built) |
| O-7 | Practice course effort | medium (`homepage-practice-s1.ts:26`) |
| O-8 | Queues | direct writes |
| O-9 | Roster-store migration window | KV |
| O-10 | Classroom seat caps | 2 in flight, 600 s (not built) |
| O-11 | The SDK version | 0.3.299, pinned; no canary soak is recorded |
| O-12 | Anthropic tier, spend cap and capacity targets | to be checked by the owner before larger classes |
| O-13 | Price digests for Haiku and Opus 5.5 on metered seats | no metered seat runs a helper; an unpriced model is refused before sending |

The build decisions B-1 to B-3, B-6, B-9 to B-11 and B-15 to B-18 are also open for the owner.
