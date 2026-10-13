# dental-codex — Codex SDK coach for GPT-model seats (trial)

Branch `dental-codex`, built on `origin/main` e987aa34. Issue: #1611 ("Codex SDK 시험").
Service counterpart: `hypeproof/hypeproof-service` branch `dental-codex`
(`POST /v1/responses`, see its `docs/dental-codex.md`).

## What changes

An agent-sdk seat whose chosen model is a GPT model runs its turn on
`@openai/codex-sdk` instead of the Claude Agent SDK. Everything else on the seat
(proxy cohorts, Claude models, children's cohorts) is unchanged.

**Today no seat is served that way.** The Service binds agent-sdk seats to Anthropic
(`lesson-model-policy.ts` `modelBinding`), so on production profiles this branch changes
nothing until a seat is marked as GPT. The trial marked one locally (see "Trial").

| File | Change |
|---|---|
| `extensions/hypeproof-chat/src/codexRuntime.ts` | New, pure. The runtime choice, the Codex CLI config, the per-turn headers, the event → tool-line mapping |
| `extensions/hypeproof-chat/src/codexCoach.ts` | New, host half. `runCodexCoach(args)` — same `SdkCoachArgs`, callbacks and `SdkTurnEnd` as `runSdkCoach` |
| `extensions/hypeproof-chat/src/chatPanelProvider.ts` | The agent-sdk branch calls `runCodexCoach` when `codexRuntimeFor(...)` says so, and records a `codex_runtime` workflow event |
| `extensions/hypeproof-chat/src/sdkCoach.ts` | Exports `coachVisibleWorkspaceFiles` and `canonicalizeFsPath` for the Codex coach |
| `extensions/hypeproof-chat/src/localRuntime/toolServer.mjs` (+ `.d.mts`) | A tool handler may return a whole MCP result (image blocks, `isError`), not only a string |
| `extensions/hypeproof-chat/package.json` / lock | `@openai/codex-sdk` 0.162.1 as a devDependency (the SDK pulls its platform binary package) |

## How a turn runs

1. **Choice.** `codexRuntimeFor` → Codex when the runtime is agent-sdk and the chosen
   model choice (or the seat) has `provider: "openai"`. The choice's `codex_model`, else its
   `id`, names the model for the CLI. `HPS_CODEX_RUNTIME=off|on` overrides the choice (A/B
   runs on one seat).
2. **Grants.** Codex always holds a shell and file writes, so a profile without both the
   `shell` and `write` grants stays on the Claude SDK (fail closed).
3. **Provider.** The CLI's model provider is the Service: `base_url = proxyUrl`,
   `wire_api = "responses"`, the workshop token as the provider key, the same `x-hps-*`
   headers the Claude path sends (turn id, effort, lesson binding/step/help, workspace,
   file list, preview address). The Service replaces `instructions` with the cohort blocks
   the Claude path gets, so the course prompt, skills and browser contract are identical.
4. **Isolation.** `CODEX_HOME` is a Studio-owned directory per seat (the twin of
   REQ-M13's `CLAUDE_CONFIG_DIR`); AGENTS.md lookup is off (the twin of
   `settingSources: []`); foreign credentials (`OPENAI_API_KEY`, `CODEX_API_KEY`,
   `ANTHROPIC_*`, …) are scrubbed from the CLI's env.
5. **Tools.**
   - Built-ins are Codex's: `shell` and `apply_patch`. Writes and commands are confined by
     Codex's OS sandbox (`workspace-write`, network off, `approval_policy = never`).
   - The hypeproof MCP tools (preview, browser, publish) are **the Claude path's own
     definitions**: `buildHypeproofMcpServer` is called with a capturing factory, zod shapes
     become JSON Schema, and the tools are served on the loopback MCP transport. Only the
     profile-granted names are served. Every call still goes through `evaluateSdkToolUse`
     and the approval modal; Codex's own MCP approval is set to `approve` because it cannot
     reach the learner in `codex exec`.
6. **Screen.** Codex events become the same `SdkActivity` lines as the Claude path:
   `command_execution` → `Bash`, `file_change` → one `Write`/`Edit` per file,
   `mcp_tool_call` → `mcp__hypeproof__<tool>`, `reasoning` → thinking, `agent_message` →
   text. So the preview reveal, the "고쳤어요" verdict (R0) and observation records read a
   Codex turn like a Claude one. A failed MCP call shows the tool's own sentence.
7. **Failures.** Stall watchdog (same budget, paused while a modal or tool is in flight);
   401 → the token prompt, 400 → bad request, 429 → the request-limit sentence, 5xx →
   the service-error sentence. A "Reconnecting…" stream notice is not a failure.

## Differences from the Claude path

- **Shell commands get no per-command modal.** The Claude path asks for every `Bash`
  call; `codex exec` has no per-call approval hook. The sandbox (workspace-only writes,
  no network) is the boundary instead. File writes were already auto-allowed by policy
  on the Claude path.
- **No token streaming.** Codex `exec` emits an agent message when it is complete, so
  text arrives one message at a time.
- **History** is folded into one prompt per turn, as on the Claude path (no thread resume).

## Trial (2026-10-14, local only)

Local Service with an Azure OpenAI `gpt-6-luna` deployment behind `/v1/responses`;
cohort `boah-dental-2026-1017-s1`; the 1017 cue-sheet turns t01–t09 and t11
(publishing excluded).

| Run | Result | Total |
|---|---|---|
| Codex coach driven directly (no app) | 10/10 turns finished | 236 s |
| Codex coach inside a studio-dev app copy | 10/10 turns finished | 607 s (shared Service and Azure quota with another rehearsal at the same time; not comparable) |
| Claude SDK baseline, same turns, same Azure deployment (2026-10-13) | 10/10 | 286 s |

Behaviour checked in the replies and files: the coach listed what it had invented (t03),
made the map only when asked and encoded the address the skill's way (t06), changed only
the first-screen photo (t07), and said what it could not verify instead of claiming it (t08).
`browser_screenshot` failed in the app run exactly as it does on the Claude path in the
same headless harness; `browser_read`, `browser_open` and `live_preview_start` worked.

Found and fixed during the trial: Codex refused MCP calls under `approval_policy = never`
until the server's tool approval was set to `approve`; without an output cap Azure
reserved the whole output window per request and three turns exhausted a 1M-TPM
deployment (the Service now clamps `max_output_tokens`).

## Not done (follow-ups)

- **Packaging.** The SDK loads from `dist/vendor/node_modules` or `node_modules`. The
  platform binary is 328 MB (darwin-arm64), so a packaged app needs the same seeding path
  as the claude binary (`scripts/seed-sdk-binary.sh`, `hypeproofChat.sdkBinaryPath`).
  `HPS_CODEX_BINARY` already overrides the binary path.
- **Seat marking.** A Service-side way to serve a GPT model on an agent-sdk seat.
- **Shell approval** parity, if the per-command modal must stay for Codex seats.
- **Service ledgers** on `/v1/responses` (budget, lesson binding, usage/cost) before
  it is configured anywhere but locally.
