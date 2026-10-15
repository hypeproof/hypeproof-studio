# A lesson narrows the models it allows; the app switches the next request

Status: Accepted for the bounded implementation #792 / #795; production activation and full E7 acceptance remain separate. The implementation decision below supersedes the original proposal sections. Amended 2026-10-14 by the owner's alias remap to the Claude 5.5 family, recorded in [Alias remap — 2026-10-14](#alias-remap--2026-10-14); the Service implements it in hypeproof/hypeproof-service#73 and #74, merged as `399109c`, and the Studio PR that carries this amendment moves the deploy pin there.

Original audit (first unit of E7 [#755](https://github.com/jayleekr/hypeproof-studio/issues/755), epic [#746](https://github.com/jayleekr/hypeproof-studio/issues/746)).
Design input (docs branch PR [#753](https://github.com/jayleekr/hypeproof-studio/pull/753), pinned at `293d4b5`):
[design §"멀티모델을 수업의 선택권으로 설계"](https://github.com/jayleekr/hypeproof-studio/blob/293d4b54b5bc418ab3b6e0adbd788386c08a7319/docs/design/learning-agent-experience.md),
[multi-model research](https://github.com/jayleekr/hypeproof-studio/blob/293d4b54b5bc418ab3b6e0adbd788386c08a7319/docs/research/agent-experience-2026-09-08/multi-model.md),
[requirements AE-25..AE-33](https://github.com/jayleekr/hypeproof-studio/blob/293d4b54b5bc418ab3b6e0adbd788386c08a7319/docs/requirements/learning-agent-experience.md).
The rows this ADR serves, quoted so a main checkout can read them:

> **AE-25** 기존 provider/alias/profile 경로를 카탈로그와 연결한다. 기관·수업·단계·학생 배정의 허용 교집합을
> Service에서 집행하고 임의 모델 ID/alias/다른 수업 권한으로 우회할 수 없다. 기존 fast 보조 호출도 명시된 정책·예산으로 관리한다.
>
> **AE-26** 강사가 고정/제한 선택 모드를 수업 버전으로 저장·리허설한다. (고정/제한 선택 P0; 자동/비교 P1)
>
> **AE-27** 학생은 입력창에서 허용 선택과 현재 선택을 확인한다. … 턴의 실제 provider/model, 자동/대체 이유,
> 사용량 또는 미확인을 볼 수 있다. 요청 모델 clamp·동일 ID의 다른 alias를 모델 변경으로 오인시키지 않는다.
>
> **AE-28** 모델×실행기×SDK/Gateway×도구/OS 조합에서 검증한 능력만 선택 가능하다.
>
> **AE-33** 확정 수업의 provider/model 매핑·허용 후보·정책/카탈로그 revision·실행기 범위를 보존한다.
> 모델 교체는 재리허설/새 버전/복귀 경로를 거치고 은퇴·강제 차단 시 조용히 다른 모델로 치환하지 않는다.

This ADR decides the contract only. It is written from an audit of the code as of
`feb1310`; the "What exists today" section is the audit's result and is the reason
the contract is this small.

## Implementation decision — #792

The primary UI is an instructor-scoped model switch in the composer. Per-response
model badges are not required. The existing usage records verify actual execution.

- `session-design.model` contains `default` and a bounded `allowed` set from the compiled
  cohort catalogue (explicit reviewed version keys or legacy aliases). Existing issuer authorization applies; students cannot edit it.
- Version choices include Sonnet 4.5/4.6/5, Opus 4.5/4.6/4.7/4.8/5 and Haiku 4.5.
  Only the adult `studio-native-trial` compiled profile opts into the expanded set.
  Other cohorts retain their default/fallback pair. The three existing alias pins stay unchanged;
  #690's all-cohort default migration and long-output/token-limit checks remain separate.
  *(2026-10-14: the pins and the all-cohort migration are superseded by
  [Alias remap — 2026-10-14](#alias-remap--2026-10-14), which also adds Sonnet 5.5, Opus 5.5
  and Haiku 5.5 and lists the profiles that now carry an expanded or explicit set. The
  long-output/token-limit checks are still open.)*
- At freeze the Service adds `binding`: revision `hps-model-selection/1`, effective provider,
  runtime, and deduplicated alias/id/label choices. Drafts cannot submit their own binding.
  Every lesson read compares the frozen binding with the current pins/runtime/provider.
  Drift returns `lesson_unavailable`; a new mapping requires a new frozen version.
  *(2026-10-14: a binding that matches an alias map recorded in `SUPERSEDED_ALIAS_MAPS` is
  not drift; the lesson keeps serving the models it was frozen with. A new mapping still
  requires a new frozen version.)*
- The shared chat gate narrows the profile. **The SDK clamp is changed for explicit
  frozen policies**: all requests, including auxiliary calls, obey the same allowed set.
  There is no guessed auxiliary-purpose exemption. A fixed Sonnet lesson consequently
  uses Sonnet for auxiliary calls too. Old lessons retain their existing fast exception.
- A frozen policy binds one runtime. Sending it through another runtime is refused.
  The App follows that binding; a machine setting cannot widen a minor cohort's runtime.
- `/v1/profile.model_selection` serves the choice list. The existing host config carries
  the requested selection. Workspace state retains one choice scoped to profile, frozen
  lesson digest and catalogue; changing lessons restores that lesson's default.
- The host captures the selection before each request. Changing the menu during a turn
  affects the next request, without clearing input, history or workspace files.
- When SDK is unavailable, an explicitly selected model or frozen policy is not silently
  run through a different runtime. Existing unselected legacy fallback remains available.
- Chalk uses the existing authoring form and shared instructor forwarder; the new scoped
  catalogue read is `GET .../authoring/:course/models/:profile`.

[Acceptance contract](../testing/lesson-model-selection.md), [actual evidence](../research/agent-experience-acceptance-2026-09-08/model-selection/README.md). New Service precedes Chalk;
freezing this optional field establishes the documented rollback floor. This implementation
adds no production deployment, automatic activation, provider transfer, Auto/compare,
new auth/store, full capability matrix or enforced rehearsal workflow. Those parts of
AE-25–34 remain separate work. The original audit and counterexample below describe
pre-#792 behavior and remain useful legacy controls.

## Alias remap — 2026-10-14

Decided by the owner on 2026-10-14. This is the all-cohort model migration that #690 and the
bullet above left to a separate decision; #690's long-output and token-limit half stays open.

Where it stands: merged in `hypeproof/hypeproof-service` as #73 (`bb0d1ef`: catalogue, 5.5
request rules, alias remap) and #74 (`399109c`: homepage harness and the seminar guard). Line
numbers in this section are at Service main `399109c` and relative to `worker/src/` unless a path
says otherwise. Before this Studio PR the deploy workflow pinned `43dd009`, whose map is Haiku 4.5
/ Sonnet 4.6 / Opus 4.7 (`profiles/types.ts:491-495` at that commit); this PR moves the pin to
`399109c` (`.github/workflows/deploy-worker.yml:93`). Verified on macOS through the 0% versions
rc1 `e4483c9b` and rc2 `987383f4`, not yet on Windows (the evidence is listed below).

### Decision

- Upgrade to Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 and remap the provider-neutral aliases
  for **every alias-based cohort** before the 2026-10-17 seminar.
- **The kids classes move only after a validation run passes.** The two kids profiles name only
  aliases (`profiles/kids-workshop-s1.ts:18-21`, `profiles/kids-2026-grade-5-6-s1.ts:27-30`),
  so the code has no kids-only pin and they move in the same commit as every other alias cohort.
  The gate is therefore the promotion of the Service release. The validation run was a closed
  4-minute kids session on the 0% version: 5/5 benign biology and medicine questions were answered
  with no refusal, the proxy route streamed with keep-alives, and the engine built a page
  (hypeproof/hypeproof-service#73).
- **The paid pass keeps Opus 5.5 selectable.** `studio-native-trial` writes out its model block
  instead of spreading the homepage profile's (`profiles/studio-native-trial.ts:19-27`), so a
  change to homepage practice cannot move the pass.
- **Lessons frozen under the old map keep their frozen models until an instructor freezes a new
  version** (AE-33). The mechanism and the procedure follow.
- **OpenAI side, cheaper first:** fast and default `gpt-6-luna`, strong `gpt-6.1-sol`; GPT
  practice defaults to `gpt-6-luna` (`profiles/studio-gpt-practice.ts:26-27`); `gpt-6-astra` is
  no alias target and stays out of the comparison menu (`profiles/studio-model-practice.ts:11-16`).
- **Measurement paths do not follow the coach map.** The observation assessment and the classroom
  report evaluator resolve aliases through the pre-remap map, so a measurement keeps its model
  under unchanged rubric and evaluator revisions (see "What moves and what stays").
- **No per-request model router in the installed app v0.1.56. Any future router needs a new ADR
  first.** That ADR has to settle at least: a trusted request-purpose marker (Decision §2 below
  records that the route cannot tell an auxiliary request from a participant one); the actual
  model of every turn and the reason for any automatic choice (AE-27); Auto and failure fallback
  as separate policies (AE-30); one ledger for every branch (AE-32); switching only at turn
  boundaries (AE-29); no silent override of an explicit choice (REQ-M41/M42); no re-routing of
  frozen lessons (AE-33); and enforcement inside the allowed intersection (AE-25).
- **The goal this serves:** keep cutting HypeProof's model spend per completed step, for classes
  and for post-class pass use, at a quality floor. The floor is not defined or measured yet; no
  HypeProof evaluation compares model tiers on Korean homepage tasks.

This supersedes, in "Implementation decision — #792" above, "The three existing alias pins stay
unchanged" and the deferral of #690's all-cohort default migration.

### Alias table

| Provider | fast | default | strong | Replaced map, kept in `SUPERSEDED_ALIAS_MAPS` |
|---|---|---|---|---|
| anthropic | `claude-haiku-5-5` | `claude-sonnet-5-5` | `claude-opus-5-5` | `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-7` (`ANTHROPIC_ALIASES_UNTIL_2026_10_14`) |
| openai | `gpt-6-luna` | `gpt-6-luna` | `gpt-6.1-sol` | `gpt-5.6-luna` for all three |
| gemini | `gemini-2.5-flash` | `gemini-3.5-flash` | `gemini-3.5-flash` | unchanged |
| glm | `glm-5.2` | `glm-5.2` | `glm-5.2` | unchanged |

Sources: `profiles/types.ts:550-554` (anthropic), `:630-634` (gemini), `:663-667` (openai),
`:674-678` (glm), `:691-699` (the superseded maps). The catalogue keeps every previous id
(`:561-589`), because explicit pins, frozen lessons and the measurement paths still call them.
The OpenAI default and fast aliases now share one id, so the rule in Decision §3 below (the app
compares ids, never aliases) still decides what counts as a model change.

### What each profile serves after the remap

| Profile | Minors | Runtime | Default | SDK auxiliary (`claude-*haiku*`) | Served choices |
|---|---|---|---|---|---|
| `kids-2026-grade-3-4-s1`, `kids-2026-grade-5-6-s1` | yes | agent-sdk | Sonnet 5.5 | Haiku 5.5 | Sonnet 5.5, Haiku 5.5 |
| `dental-copyclone-2026-s1` (seminar), `canary-sdk-contract` | no | agent-sdk | Sonnet 5.5 | Haiku 5.5 | Sonnet 5.5, Haiku 5.5 |
| `dental-teaser-2026-s1` | no | proxy | Sonnet 5.5 | — | Sonnet 5.5, Haiku 5.5 |
| `homepage-practice-s1` | no | agent-sdk | Sonnet 5.5 (explicit id), course effort medium | Haiku 5.5 | Sonnet 5.5, Opus 5.5, Haiku 5.5, each at low/medium/high |
| `studio-native-trial` (trial and paid pass), `synthetic-release-acceptance` | no | agent-sdk | Sonnet 5.5, course effort medium | Haiku 5.5 | nine: Sonnet 5.5, Haiku 5.5, Sonnet 5, Sonnet 4.5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.6, Opus 4.5. Sonnet 4.6, Haiku 4.5 and Opus 4.7 were reachable only through aliases and fold away |
| `studio-gpt-practice` | no | proxy (OpenAI) | `gpt-6-luna` | — | GPT-6 Luna, GPT-6.1 Sol, GPT-5.6 Luna/Terra/Sol |
| `studio-model-practice` | no | proxy (cross-provider) | `glm-5.2` | — | the whole catalogue except `gpt-6-astra`: 21 |

Source: the served-model lock `worker/test/model-catalog.test.mjs:126-140`, which a catalogue or
alias change has to update in the same commit. Lessons without a `model` block follow their
profile and move; lessons with one keep their frozen models (next subsection).

The same release changed two cohorts' cached prefixes (#74). Homepage practice runs the homepage
harness: its own preview contract, the `homepage-craft` and `homepage-sections` skills in place
of `design-craft` and `workshop-setup`, web search off, course effort medium
(`profiles/homepage-practice-s1.ts:14-25`, `:51`, `:62`, `:67`). The pass gets the same two skills
plus `homepage-update` (`profiles/studio-native-trial.ts:43-48`). The seminar (director) and the
canary that mirrors it get a guard against the v0.1.56 `index.html` overwrite paths: no html or js
code fences in chat, one `index.html` with sections, the shared shell ban replaced by an honest
shell rule, and `workshop-setup` served instruction-only
(`prompts/dental-copyclone-2026-s1.md:69-76`, `lib/translate.ts:31-69`,
`profiles/dental-copyclone-2026-s1.ts:67`, `:150`; REQ-D5, REQ-M4). Every other
profile's cached prefix is byte-identical, which `worker/test/prefix-pins.test.mjs` pins.

### How a frozen lesson keeps its models

- At freeze the Service computes the binding from the pins of that moment
  (`routes/authoring.ts:194`) and stores alias, id and label per choice.
- Every read compares the stored binding with a fresh one (`lib/lesson-delivery.ts:23`). Before
  this change the comparison was plain equality with the current pins, so any remap closed every
  model-configured frozen lesson with `409 lesson_unavailable`.
- `frozenLessonPins` (`lib/lesson-model-policy.ts:73-84`) now accepts a binding that matches
  either the current pins or one map recorded in `SUPERSEDED_ALIAS_MAPS`, and returns that map;
  `lessonModelIsCurrent` is true exactly when it returns something (`:86-88`).
- The chat gate applies the lesson with those pins (`lib/chat-gate.ts:332` → `applyLessonModel`,
  `lib/lesson-model-policy.ts:92-97`, which sets `model.pins`), and the coach resolvers honor
  them: `/v1/messages` (`routes/messages.ts:168-180`), `/v1/chat/completions` (`lib/translate.ts:627`,
  `:737`) and the served menu and labels (`lib/lesson-model-policy.ts:99-105`). A lesson-locked
  profile has no fast exception (`routes/messages.ts:170`, `:177`), so its auxiliary calls stay
  inside its frozen set as well.
- Rules that come with the record: an alias remap must append the map it replaces
  (`worker/DEPLOY.md:130-133`); a change to an alias map that is not recorded still closes the
  lessons frozen under the old values; only maps whose ids are still catalogued may be listed
  (`profiles/types.ts:680-689`). The record is an id map, not a promise that the ids keep
  working: when a frozen id retires upstream, that lesson's requests fail at the provider. They
  are not substituted (AE-33), so the lesson has to be re-frozen before the retirement date.
- Evidence: `worker/test/model-catalog.test.mjs` block 10 (a lesson frozen under the old map is
  served on Sonnet 4.6 under its old labels, returns 409 without the record, and a new version
  binds 5.5) and block 11 (the same for OpenAI). Both use a synthetic upstream. Production D1
  holds two frozen versions, both in `dental-pilot-2026-a`, and neither carries a `model` or
  `features` block (hypeproof/hypeproof-service#73), so no live lesson changes and the mechanism
  has not yet held a real one.

### Re-freezing a lesson onto the 5.5 pins

1. List the model-configured frozen versions (read-only):
   `SELECT cohort_id, course_id, version FROM authoring_versions WHERE json_extract(module_json, '$.content.model') IS NOT NULL;`
   On 2026-10-14 production had none (#73). Lessons without a `model` block need no re-freeze.
2. The instructor opens the frozen version for reuse: `GET /cohorts/:cohort/authoring/:course/versions/:version/readiness`
   returns its content with the Service-produced bindings stripped (`routes/authoring.ts:264-278`).
   This works only while the version is still readable, which is what the superseded record keeps
   true. The instructor saves that content as the draft (`PUT …/authoring/:course`,
   `routes/authoring.ts:111`) and freezes it as a new version (`PUT …/versions/:version`,
   `routes/authoring.ts:162-213`); the Service computes the new binding from the current pins (`:194`).
3. Rehearse the new version before students use it (`POST …/versions/:version/rehearsals`,
   `routes/authoring.ts:302`). A teacher preview is not a student run (AE-26).
4. Deliver it. A participation token names one version (`lib/tokens.ts:22`), so issue the class's
   seats on the new version (`POST …/versions/:version/participants`, `routes/authoring.ts:75`),
   or move selected participants with targeted settings where that path is enabled
   ([classroom-admin U3](../requirements/classroom-admin.md#remote-management-u3-20260921)).
5. Keep the old version. It keeps serving its frozen models while its map stays recorded and its
   ids stay catalogued and unretired, and it is the rollback target.

### What moves and what stays

- **The measurement paths stay on the pre-remap models.** `MEASUREMENT_ALIAS_MAP` is the recorded
  `ANTHROPIC_ALIASES_UNTIL_2026_10_14` (`lib/measurement-models.ts:1-20`, `profiles/types.ts:690-693`).
  The observation assessment (`routes/observations.ts:123`) and the classroom report evaluator's
  profile model (`routes/classroom-reports.ts:59`) resolve the profile default through it, so an
  alias measures on Sonnet 4.6 as before and an explicit id is used as written. Neither reads the
  coach's lesson pins any more. `EVALUATOR_REVISION` and the rubric versions are unchanged, as the
  Service's `AGENTS.md:10` ("preserve … rubric/model versions") requires; moving a measurement to another
  model is a new revision, decided on its own. A `max_tokens` stop is now a failure on both paths
  (`lib/native-assessment.ts:229-232`, `lib/classroom-evaluator.ts:123-124`). `claude-sonnet-4-5`
  (`lib/classroom-evaluator.ts:23`) is used only when a profile resolves no model.
- **SDK auxiliary calls move to Haiku 5.5, with thinking off.** A haiku-class id that the cohort
  does not list is clamped onto the fast pin and flagged auxiliary (`routes/messages.ts:168-180`); a
  request that names one of the cohort's own ids is never auxiliary. Auxiliary calls are sent with
  up-front thinking off at effort `low`; a minor cohort keeps `MINOR_EFFORT`, and a course effort
  policy (the pass and homepage practice at `medium`) still sets the effort, so its receipt stays
  true (`routes/messages.ts:580-596`). An auxiliary call that ends in an assistant prefill, which
  Haiku 5.5 rejects (`lib/model-caps.ts:77-82`, `:200`), is served on `claude-haiku-4-5` without
  thinking (`routes/messages.ts:182-187`, `:471-486`); main coach calls are never moved. Whether the
  v0.1.56 engine (Agent SDK 0.3.207, no `ANTHROPIC_DEFAULT_HAIKU_MODEL`) sends its background calls
  as a haiku id or as the main model is unverified. Production usage from 2026-08-10 to 2026-09-09
  has no Haiku rows ([budget readiness](../research/budget-readiness-2026-09-08/README.md)), which
  does not tell "no auxiliary calls" from "auxiliary calls on the main model".
- **Health probes follow the pins.** The deep health check and the heartbeat probe each current
  `MODEL_MAP` target with up-front thinking off (`cron/health.ts:148-152`, `cron/heartbeat.ts:108-113`,
  `probeRequest` in `lib/model-caps.ts:494-496`); a failing pin is named in the error. The
  heartbeat's OpenAI branch still probes `gpt-4o-mini` (`cron/heartbeat.ts:127`).

### Request shapes the 5.5 models reject, and what the gateway does

The three capability rows are docs-derived, each with a dated `verifiedBy` (`lib/model-caps.ts:155-205`).
The fields that encode the model facts and the gateway policies are documented at `:41-91`.

- `thinking: {type: "disabled"}`: dropped on Opus 5.5, which cannot turn thinking off; rewritten to
  `between_tools` with effort capped at high on Sonnet 5.5; kept on Haiku 5.5 at effort ≤ high
  (`lib/model-caps.ts:365-382`).
- Forced `tool_choice` (`any`, `tool`) becomes `auto` on Opus 5.5 and Sonnet 5.5 (`:384-395`). The
  model is then no longer guaranteed to call the tool the engine forced.
- Non-default sampling is stripped, and the strip also runs on `/v1/chat/completions` for every
  cohort (`routes/chat.ts:929-935`). This reverses "Wiring it there … is out" under "Not in this
  slice" below: every 5.5 model rejects a non-default `temperature`, and `translate()` forwards the
  client's value.
- Effort: a cohort with no course effort policy is capped at `high` on the 5.5 pins
  (`unpolicedEffortCeiling`, `lib/model-caps.ts:57-65`, `:407-420`; `lib/model-effort.ts:36-43`).
  Claude Code 2.1.207 sends `xhigh`, which Sonnet 4.6 lowered to `high`, so those cohorts keep the
  effort they had. No cohort reaches `xhigh` or `max` on a 5.5 pin; lifting that is an owner decision.
- `/v1/chat/completions` turns up-front thinking off on the 5.5 pins, because its clients render
  text only (`routes/chat.ts:922-928`, `lib/model-caps.ts:430-459`): Sonnet `between_tools`, Haiku
  `disabled`, Opus at effort `low`; a minor cohort runs at `MINOR_EFFORT` and a course policy still
  wins. The stream sends `: keep-alive` comments while upstream is silent (`lib/sse.ts:53-75`), and a
  `stop_reason: "refusal"` is answered with a Korean notice instead of an empty reply
  (`lib/sse.ts:154`, `:523-525`; `routes/chat.ts:1089-1093`). `/v1/messages` passes a refusal
  through and logs it (`routes/messages.ts:703-708`).
- Thinking display: on Opus 5.5 and Sonnet 5.5 the progress updates between tool calls arrive in
  thinking blocks that are empty under the `display: "omitted"` the engine sends. For adult
  cohorts the gateway asks for `"summarized"` (`lib/model-caps.ts:476-486`,
  `routes/messages.ts:621-630`), which also returns summaries of the reasoning. Minor cohorts keep
  `"omitted"` (`isMinorCohort`, the fail-safe check moderation uses), so a child's screen can stay
  quiet during a long turn.
- Prefix-bound thinking: `/v1/messages` and `count_tokens` add
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` and the beta
  `thinking-binding-controls-2026-08-01` on adaptive requests (`lib/model-caps.ts:498`, `:514-528`;
  `routes/messages.ts:632-635`, `:663`, `:956`, `:968`), because the gateway's own `system`
  replacement changes the prefix between prompts (REQ-M10). Never over a value the client set.
- Every change is logged as a `#406` line (`dropped`, `lowered`, `auxiliary`, `summarized`). There is
  still no per-turn surface for them (AE-28's second half).

Evidence, from the Service PR records (hypeproof/hypeproof-service#73 and #74; that session's
attestation, not rerun for this document), with normal traffic left on the previous version:

- 16/16 API probes returned 200 on 5.5, including the four shapes 5.5 rejects
  (`thinking.disabled`, forced `tool_choice`, `budget_tokens`, `temperature`), all normalized.
- The installed engine, Claude Code 2.1.207, completed file-writing runs on Sonnet, Opus and Haiku
  5.5, and the usage rows show the 5.5 ids.
- A pass seat wrote an 8,192-token page in 47 s (149 tok/s, against the 65 tok/s the 240 s deadline
  was sized from). Homepage practice built a complete flower-shop page in 29 s. The seminar mirror
  answered a request for example code with no fence and built a 20,748-character single page,
  complete at the 16,384 cap.
- For the same Korean request, `count_tokens` read 11,532 on Sonnet 4.6 and 11,977 on Sonnet 5.5
  (+4%).
- The kids validation run is described under Decision.

Not verified: Windows, the proxy route on Opus 5.5 and Haiku 5.5 in the app, how v0.1.56 shows a
refusal on `/v1/messages`, and whether blocks were actually dropped. The AE-28 matrix keeps these
cells open ([AE-28 matrix](../requirements/learning-agent-experience.md#claude-55-능력-행렬-ae-28-2026-10-14)).

### Rollback floor

- The Studio deploy workflow deploys the Service from the ref pinned at
  `.github/workflows/deploy-worker.yml:93`. This PR moves it from `43dd009` to `399109c`; rolling
  back is restoring `43dd009`.
- The floor (`worker/DEPLOY.md:124-133`): once any model-configured lesson is frozen after the
  remap, an older Service computes the 4.x ids, the binding no longer matches, and that lesson
  returns `409 lesson_unavailable` (`lib/lesson-delivery.ts:23`). A lesson that names a 5.5 or
  GPT-6 id fails the older catalogue the same way. Lessons frozen before the remap survive a
  rollback, and on 2026-10-14 production had no model-configured lesson at all.
- So a rollback after promotion is the ref revert plus moving any class frozen after the remap
  back to its pre-remap version, which step 5 above keeps available.
- Price approval is a precondition only for metered seats, and #73 records that production meters
  none today ([AB price revisions](../requirements/access-budget-settlement.md#claude-55-가격-revision-2026-10-14)).

## What exists today (audited, not assumed)

**Aliases are the entire model vocabulary.** A profile can say `hypeproof-fast`,
`hypeproof-default` or `hypeproof-strong` and nothing else. Raw upstream ids cannot
appear in a profile. Four providers exist (`gemini | anthropic | openai | glm`), each
with its own alias→id map.

| Provider | fast | default | strong |
|---|---|---|---|
| anthropic | claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-7 |
| gemini | gemini-2.5-flash | gemini-3.5-flash | gemini-3.5-flash |
| openai | gpt-4o-mini | gpt-4o | gpt-4o |
| glm | glm-5.2 | glm-5.2 | glm-5.2 |

*(Audit snapshot at `feb1310`. The OpenAI row was already stale on 2026-09-10, when all three
OpenAI aliases moved to `gpt-5.6-luna`; the current table is in
[Alias remap — 2026-10-14](#alias-remap--2026-10-14).)*

Three of the four providers collapse two or three aliases onto the same upstream id.
That single fact decides one design rule below.

Other audited facts that constrain the contract:

- **No profile sets `model.provider`.** All seven registered profiles resolve to
  `default: hypeproof-default`, `fallback: hypeproof-fast`, and every request falls
  through to the deployment-level provider. `hypeproof-strong` is never a default or
  fallback anywhere; it exists only in the maps and in a negative-control test.
- **Two clamps resolve requests against the profile, with an SDK fast exception.** On `/v1/chat/completions` a
  requested model is matched by alias name against `model.default` and
  `model.fallback`; anything else silently becomes the default. On `/v1/messages` the
  same two aliases are matched by name **or** by mapped id, plus a `claude-*haiku*`
  rule. Rewriting the profile changes their default and fallback, but does not remove
  the SDK route's force-appended fast allowance described below.
- **`/v1/messages` force-appends `hypeproof-fast`** to the allowed set even when the
  profile lists no fast fallback. It exists for the CLI's auxiliary calls, but the
  route cannot tell an auxiliary request from a participant one, so it is available to
  both. It is the one place the served set is wider than the profile declares.
- **`/v1/messages` is Anthropic-only** and ignores both `LLM_PROVIDER` and
  `profile.model.provider`. Six of seven profiles run that route.
- **The turn's actual model already ships three ways** and nothing reads two of them:
  the `x-hps-model` response header on both routes, `x-hps-fallback: 1` when a
  substitution occurred (Gemini is the only substituting path in the codebase), and
  the `model` field inside the SSE usage chunk — which the client already parses.
  The usage chunk is suppressed when all token counts are zero, so the header is the
  primary source and the chunk is a join key, not a replacement.
- **The durable record exists.** `usage_log.model` stores the id actually served on
  both routes, including failure rows.
- **Model policy is deliberately compiled, not publishable.** The module layer
  overrides exactly one profile key (`system_prompt`) and its own comment records why
  model, `sdk_tools`, `minor_cohort` and analytics stayed compiled: runtime-loading
  them would route around the cohort harness, which is the review-time safety gate.

## Decision

Three additive pieces. No new schema id, no new store, no new authority.

### 1. The lesson may narrow, never widen

`hps-session-design/1` gains one optional block, the same move ADR-0005 made for
`assistant`:

```ts
model?: { default: ModelAlias; allowed: ModelAlias[] }
```

Validated Service-side at save, at freeze, and on **every read**:

- `allowed` holds 1..2 entries, no duplicates, and `default ∈ allowed`;
- `allowed ⊆ { profile.model.default } ∪ { profile.model.fallback }`.

The narrowing-only rule is what makes this need no new authority. A lesson can never
name an alias the compiled profile does not already grant, so the issuer scope gains
no field, the participation token keeps its promise to carry no runtime capability,
and the cohort harness remains the gate on what a profile may name at all.

### 2. Narrow the profile; the SDK fast exception remains an unmet boundary

The shared chat gate already returns a rewritten profile (that is how a frozen
lesson's text and its AI name reach the model). It gains one more field in the same
spread:

```ts
{ ...profile, model: { ...profile.model, default: lessonDefault, fallback: lessonSecond } }
```

Because both clamps read `profile.model.default` and `profile.model.fallback`, the
rewrite changes the default and fallback on both routes. The proxy route enforces
the narrowed set. The SDK route still permits fast, so profile rewriting alone
does not enforce the lesson's declared set there. Other unrecognized requests fall
through to the served default; only the target of that fallthrough moves.

One carve-out is named rather than silently inherited, and it is **wider than an
auxiliary channel**: `/v1/messages` force-appends `hypeproof-fast`, and the request
carries no purpose marker the Service could check, so an ordinary participant turn
can use it too. The effective allowed set on that route is therefore

    lesson.allowed ∪ { hypeproof-fast }   — always, whatever the lesson says

Measured on a lesson narrowed to `{default}` (the narrowing that exposes it; a
`{fast}` narrowing cannot):

| request on `/v1/messages` | served |
|---|---|
| `hypeproof-default` | claude-sonnet-4-6 |
| `hypeproof-strong` | claude-sonnet-4-6 (clamped) |
| `hypeproof-fast` | **claude-haiku-4-5 — outside the lesson's set** |
| `claude-3-5-haiku-20241022` | **claude-haiku-4-5 — any `claude-*haiku*` string** |
| the same `hypeproof-fast` on `/v1/chat/completions` | claude-sonnet-4-6 (no such exception) |

So this slice **does not** satisfy AE-25's "임의 모델 ID/alias로 우회할 수 없다" on the
SDK route, and must not claim to. Two honest options for the implementation, neither
decided here:

- **Describe, do not pretend.** The served `model.allowed` includes fast on
  agent-sdk seats, and the requirement row records that a lesson cannot exclude the
  fast pin on that route today.
- **Add the missing boundary.** A trusted request-purpose discriminator the Service
  can verify — the auxiliary calls are the CLI's, not the participant's, so they are
  distinguishable in principle but nothing distinguishes them today.

Removing the force-append outright is not free: it would upgrade every CLI auxiliary
call to the lesson's default model, which is the cost reason the route states for
having it.

### 3. Show the seat's set and the actual request evidence from each runtime

`GET /v1/profile` gains one additive key, shaped like the existing `module` key:

```ts
model: {
  current: { alias: ModelAlias; id: string; label: string },
  allowed: Array<{ alias: ModelAlias; id: string; label: string }>,
  source: "profile" | "lesson"
}
```

`id` is the resolved upstream id. `label` is Service-owned display text, so the app
never composes a model name from an alias.

`id` **does not** encode provenance, and the block must not be read as if it did.
`/v1/messages` is Anthropic-pinned; `/v1/chat/completions` uses the deployment's
effective provider; and an SDK-unavailable seat falls back from the first route to the
second mid-session. One seat can therefore serve turns from two endpoints with two
providers, so a seat-level id map is not evidence for either. AE-27 asks for the
turn's *actual* provider and model, which means the implementation must either carry
explicit endpoint/runtime provenance on the turn evidence, or show provider as
**unknown** until that evidence exists. Guessing the vendor from the id's prefix is
exactly the inference this paragraph forbids.

There is deliberately **no "current turn" here**. This block is the *seat's* allowed
set and default.

The turn's actual model reaches the host by **two different paths, and the slice must
implement both**:

- **Proxy route.** `x-hps-model`, `x-hps-fallback`, and the SSE usage chunk, read in
  the proxy client where `x-request-id` is already read. Two headers, no new plumbing.
- **Agent SDK route.** The proxy client is not involved at all — the SDK runs as a
  subprocess and its model evidence arrives per request as an SDK usage event, which
  the host already extracts and spools. Most profiles run this route, so a
  proxy-header-only change would leave the majority of seats with no turn model.

A single turn can also produce several SDK requests, including the CLI's auxiliary
ones. Attribution has to say which request a model belongs to; "the model of the
turn" is not well defined without it.

**The app compares `id`, never `alias`.** This is not a style preference: on gemini
and openai the default and strong aliases are the same id, and on GLM all three are,
so an alias-keyed display would announce a model change where nothing changed. This
is AE-27's "동일 ID의 다른 alias를 모델 변경으로 오인시키지 않는다", satisfied by the
shape rather than by a rule someone must remember.

## Compatibility

| Pair | Behavior |
|---|---|
| Old frozen lesson (no block) + new Service | The optional key may be absent, exactly as for `assistant`. Served set is the compiled profile's; `source: "profile"`. |
| New lesson (block) + new Service + old App | The old client does not consume the added `model` key, like the existing unread `module` key. A TypeScript cast does not remove fields at runtime. No model-policy UI is rendered. |
| New Chalk + old Service | `PUT` draft returns `400 invalid session-design fields`; the edit is preserved. **Deploy the Service before Chalk**, as in ADR-0005. |
| Named-model lesson frozen + Service rolled back below this change | Every read re-validates, the old allowlist rejects the block, and every seat delivered from that version gets `409 lesson_unavailable`. This is a **rollback floor** and takes a second row in the table in `worker/DEPLOY.md`. |
| Client sends an out-of-set model string | Proxy: served default. SDK: fast remains accepted even outside the declared set; other unrecognized requests use the served default. This exception is not a strict lesson restriction. |
| Credential with no lesson | Unchanged. |
| `hypeproofChat.model` setting | Untouched. It stays a free-text string; the server clamp is what makes that harmless, and it continues to. |

## Not in this slice, with the reason from the code

- **A student-facing model picker.** The seat's set has to be served and rendered
  before a choice can mean anything. AE-26's fixed/restricted-choice is the instructor
  half; the picker is the next unit.
- **Auto and compare modes (AE-26 P1, AE-30, AE-31).** They need the candidate set,
  the role assignment, the material sent to each branch and a budget ledger settled
  first. None of those exist.
- **A frozen model *identity* (AE-33's first half) — recorded here as UNMET.** This
  slice freezes the *alias set*, and an alias is not an identity. The alias→id maps are
  compiled, so re-pinning one (or changing the deployment provider) silently moves
  every already-frozen lesson to a different upstream model, with no new version and no
  re-rehearsal. That is precisely the silent substitution AE-33 forbids, and it is a
  path this ADR's earlier draft missed by looking only for a runtime fallback ladder.
  The per-turn usage row records what was served *after the fact*; it is not the
  contract AE-33 asks for. The minimum boundary the implementation must add: the frozen
  version records the resolved id and the catalogue revision alongside the alias, a
  changed pin invalidates the rehearsal for versions bound to it rather than silently
  applying, and a new binding requires a new version. Designing that is the next E7
  unit, not this one.
  *(Since #792 the binding records the resolved ids and drift closes the lesson. Since the
  2026-10-14 remap, a map recorded in `SUPERSEDED_ALIAS_MAPS` keeps such a lesson on its
  frozen models instead of closing it, and only a new version binds the new pins — see
  [Alias remap — 2026-10-14](#alias-remap--2026-10-14).)*
- **A per-turn "which parameters were clamped" surface (AE-28's second half).** The
  parameter guard already returns exactly that list and logs it, but surfacing it needs
  a response field the Anthropic-shaped stream does not have. Also worth recording:
  that guard runs on `/v1/messages` only, so `/v1/chat/completions` is **not**
  capability-protected today. Wiring it there changes runtime behavior and is out.
  *(2026-10-14: the remap made that wiring necessary, and Service main `399109c` runs the
  guard on `/v1/chat/completions` for every cohort. The per-turn surface is still missing.)*
- **Per-step or per-student model mapping.** A session-design step is key-exact, so a
  per-step field is a step-schema change rather than an optional add; and a per-student
  model would be the first runtime capability ever carried on a participation token.
- **Moving model policy into the publishable module layer.** That would route around
  the cohort harness, which is the stated reason it is compiled. A replacement gate
  would have to be designed first.
- **Narrowing `hypeproofChat.model` to an enum or machine scope.** It is the one
  turn-affecting setting that is neither machine-scoped nor in the restricted list, but
  changing that is a behavior change on a shipped app and a requirements edit. The
  server clamp already makes the free-text box harmless. Wording is fixed in this PR;
  the scope decision is separate.
- **Adding `x-hps-fallback` to `/v1/messages`.** There is no model substitution on that
  route to report — the Anthropic path documents that it deliberately has none. The
  header would have no producer. Its absence is the truth, not a gap.
- **The three out-of-band model call paths**, named here so they are not mistaken for
  covered: the cron heartbeat and the cron health check each hard-code ids at tiny
  token budgets, and the native-observation assessor resolves the profile's default
  alias against the Anthropic map and calls Anthropic regardless of the profile's
  provider. They are real spend on real ids that no lesson policy governs.
  *(2026-10-14: the assessor and the classroom report evaluator, which is not listed here,
  stay on the pre-remap models through `MEASUREMENT_ALIAS_MAP`, and the cron health probes
  now follow the current pins — see [Alias remap — 2026-10-14](#alias-remap--2026-10-14).)*

## The load-bearing claim, executed rather than reasoned

The original claim that both clamps enforce the lesson's set with zero clamp edits
was tested and is **false for a default-only SDK profile**, as the counterexample below shows. The first scratch probe
built the profile the chat gate would return for a lesson narrowed to `{fast}` and
called both clamps directly — `translate()` / `translateOpenAI()` for
`/v1/chat/completions`, `resolveMessagesModel()` for `/v1/messages` — with no edit
to either.

| request under a lesson narrowed to `{fast}` | `/v1/chat` | `/v1/messages` |
|---|---|---|
| nothing | claude-haiku-4-5 | — |
| `hypeproof-default` (the profile's own default) | claude-haiku-4-5 | claude-haiku-4-5 |
| `hypeproof-strong` | claude-haiku-4-5 | claude-haiku-4-5 |
| `claude-sonnet-4-6` (the raw id) | claude-haiku-4-5 | claude-haiku-4-5 |
| `gpt-4o` (another provider's id) | claude-haiku-4-5 | — |
| `hypeproof-fast` | claude-haiku-4-5 | claude-haiku-4-5 |

Baseline controls on the unnarrowed profile still resolve to sonnet for default and
strong, and to haiku for the fallback alias and for a raw `claude-*haiku*` id, so the
probe is measuring the narrowing rather than a clamp that always returns fast. The
same holds on the OpenAI map: unnarrowed `hypeproof-strong` gives gpt-4o, narrowed
`hypeproof-default` gives gpt-4o-mini.

The fast exception was measured too, and the first measurement was too weak to see it
properly: narrowing to `{fast}` makes the exception invisible, because fast is inside
the set. Re-run against a `{default}` narrowing it is plain — `hypeproof-fast` and any
`claude-*haiku*` string both escape the lesson's set on `/v1/messages`, while the same
request is clamped on `/v1/chat/completions`. The table under Decision §2 is that run.
The lesson generalises: a positive control that contains the thing under test cannot
falsify it.

The alias collapse that forces id-comparison was counted, not assumed:

| provider | fast / default / strong | distinct ids |
|---|---|---|
| anthropic | claude-haiku-4-5 / claude-sonnet-4-6 / claude-opus-4-7 | 3 |
| gemini | gemini-2.5-flash / gemini-3.5-flash / gemini-3.5-flash | 2 |
| openai | gpt-4o-mini / gpt-4o / gpt-4o | 2 |
| glm | glm-5.2 / glm-5.2 / glm-5.2 | 1 |

The first probe was a scratch file. The default-only SDK counterexample is now
reproducible in [model-policy-probe.mjs](../../e2e/lesson-studio/model-policy-probe.mjs),
with [original results](../research/agent-experience-acceptance-2026-09-08/model-policy/default-only-counterexample.json)
and [planned integration checks](../testing/learning-agent-experience.md). Pure resolver
execution does not verify Service authorization, a frozen lesson or a provider request.

## Verification this slice must carry

- **Service, in the file that already locks lesson policy smuggling:** positive control
  (a lesson narrows to fast; the served default becomes fast on both routes), negative
  controls (a lesson naming an alias outside the profile's two is rejected at save and
  refused at freeze; an already-frozen widening lesson 409s rather than being honoured).
- **The standing `/v1/messages` clamp lock** gains one case: under a lesson-narrowed
  profile the profile's original default is no longer honoured by name, while
  `hypeproof-fast` still is — the auxiliary carve-out survives narrowing.
- **The existing "client cannot override to a non-fallback model" negative control**
  is re-pointed at a lesson-narrowed profile, so it also proves a lesson cannot be
  escaped with an alias string.
- **The `{default}` counterexample as a standing control**, not only the `{fast}` case:
  a lesson narrowed to `{default}` must still show fast being served on the SDK route
  until a purpose boundary exists, so the test states the real behavior rather than the
  one we would prefer.
- **A control this repo does not have yet:** that the seat's served set and the turn's
  `x-hps-model` agree. The cheapest form is asserting, where the header's presence is
  already checked, that its value is one of the ids the same seat's profile lists.
- **The client-side label resolution** is a pure function and gets the same
  positive/negative control treatment as the coach-identity resolver, including the
  two-aliases-one-id case.
- Every catalogue row inherits the existing pin discipline: dated evidence per row,
  lock-tested. No new discipline is invented.

## Sequencing

`#759` (feature A) is merged, so everything this contract reuses is on `main`: the
profile serializer, the validator's allowlist form, the chat gate's lesson
application, and ADR-0005 itself.

`#765` (feature B) and `#788` (composer accessibility name) are merged, with native
evidence in `#780` and `#791`. Client implementation notes should name **symbols,
not line numbers**. AE-27 consumes proxy headers in the proxy client and SDK request
usage through its separate host path; one cannot stand in for the other. The stale
REQ-K1/M11/M14 rows were corrected by `#789`, integrated into this ADR PR. Runtime
lesson model policy, identity pinning and the student picker remain unimplemented.

## Wording corrected alongside this ADR

The audit found documentation that would make the contract unreadable if left standing.
This PR fixes the provider-count and key-requirement drift, and the one operationally
dangerous line: the deploy guide's live secret command sets the Gemini key while the
Anthropic key — which `/v1/messages` always needs — is commented out as optional. None
of these edits change behavior.

## Proposed note, 2026-09-21 — targeted lesson settings (U3 design; not implemented, not accepted)

The targeted-settings design
([classroom ADM, U3](../requirements/classroom-admin.md#remote-management-u3-20260921))
lets an instructor point selected participants of a running class at another frozen
version of the same course. It relies on three statements of this ADR and changes none:
the version's `binding` is compared with the current pins on every read and drift is
`lesson_unavailable`, never a silent substitute; a frozen policy binds **one runtime**,
so a setting whose version binds a different runtime than the run's pinned version is
refused when it is saved (a class does not switch runtime mid-session); and the app's
saved model choice is scoped to the lesson digest, so after a switch the learner is
back on the new version's default, which the learner-facing notice says. The model
actually sent is evidenced where the normalized request leaves for the provider, not at
the gate.
