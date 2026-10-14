# 0003 — Adopt the Claude Agent SDK as the coach runtime

Status: Accepted (recorded 2026-10-14). Proposed in #283 on 2026-07-06. The runtime it
decides is the one that ships: v0.1.56 runs the Agent SDK coach (Agent SDK 0.3.207,
`extensions/hypeproof-chat/src/sdkBinaryManifest.ts:29` at `v0.1.56`), and ADR 0006 and
ADR 0007 build on it. Phase 3 ("Retire") has not happened, and its alias-map clause is
superseded; see the 2026-10-14 addendum.

Epic: #282

## Context

The chat coach in `extensions/hypeproof-chat/` is, today, a single-turn
chat-only client talking to `worker/` which proxies four LLM providers through
an OpenAI-compatible shim. It has **no agentic loop, no tool-use, no subagents,
and no MCP** — `mcp_tools_enabled` is a tool allowlist that `translate.ts`
already enforces but that is empty (`[]`) in every current profile, so it is
effectively dormant; the manual-approve gate (`resolveActionApproval`) is
likewise dormant because the model never issues tool actions. The coach emits an HTML blob per turn; the client
string-extracts it and writes `index.html` itself. The gap versus Claude Code is
structural, not incremental: the product is not a weak agent, it is not an agent.

Sustaining this costs us the wrong things. Roughly 800 lines across
`worker/src/lib/{translate,sse,gemini}.ts` plus the `MODEL_MAP` /
`GEMINI_MODEL_MAP` / `OPENAI_MODEL_MAP` tables exist only to hand-marshal
requests, streaming, model aliases, and prompt caching across providers. This is
the highest-churn code in the repo and it re-implements what an agent runtime
ships for free.

What actually differentiates Studio is orthogonal to the runtime: the 7 AI
Native Assets pedagogy, per-cohort profiles and tuned Korean system prompts,
child-safety content sanitization, the workshop token/session operations layer,
the learning-analytics trace schema, the guided coach UX, the skeleton library,
and source trust-tiering. None of these require owning the chat loop or the
provider plumbing.

Bundling Claude Code itself is not a licensable path for a third party (the CLI
and its workflow/orchestration surface are Anthropic's product). The **Claude
Agent SDK** (TypeScript/Python, Anthropic Commercial Terms) is: it exposes the
agentic loop, tool-use, subagents, skills, hooks, MCP, sessions, and permission
modes to embed in our own UI.

## Decision

Adopt the **Claude Agent SDK** as the coach runtime, and **keep the VSCodium
fork** as the delivery vehicle — the SDK-based coach is embedded inside the fork
as the built-in `hypeproof-chat` extension (Phase-5 bundling unchanged). We buy
the engine and keep the pedagogy.

- **Gain (closes the gap):** agentic loop, workspace tool-use, subagents, MCP,
  hooks — reached by configuration, not by re-implementation.
- **Keep (the moat, no pedagogy regression):** `worker/src/profiles/*`,
  `worker/src/prompts/*`, `asset-scorer.ts`, `routes/trace.ts` + `lib/storage.ts`
  analytics, child-safety rules, token/session ops, guided coach UX, skeletons.
  A cohort `Profile` maps to SDK options: `systemPrompt` from `prompts/*.md`,
  `permissionMode`, tool allowlist from the profile's tool policy, model from
  `ModelAlias`. The asset scorer and trace run as post-turn hooks; the
  manual-approve gate becomes a `PreToolUse` hook reusing the existing modal.
  (The profile is the canonical owner of the tool allowlist. The Phase-0/1
  spike derives it client-side from `game.template_tier` + `tools.web_search`;
  Phase 2 should move that policy into the worker profile — folding in
  `mcp_tools_enabled` — so a single server-side field governs both the proxy
  and SDK paths. See #284.)
- **Retire (once the SDK path is default AND no cohort runs the proxy path):**
  `worker/src/lib/{translate,sse,gemini}.ts` and the three model-alias maps.
  Note `translate.ts` is the only place the `mcp_tools_enabled` allowlist is
  enforced today — re-home that check (into the profile→SDK tool policy) before
  deleting it, or a non-empty allowlist on a still-proxied cohort silently stops
  filtering.
  *(2026-10-14: the alias maps are not retired; they were remapped. See the addendum.)*

Migration is staged behind a feature flag (Phase 0 spike → Phase 1 flagged SDK
coach → Phase 2 real tool-use/subagents → Phase 3 remove the plumbing) so the
live cohort is never broken. Branding is "Powered by Claude Agent SDK", with a
shared classroom key and no per-user claude.ai login. Tracked in epic #282.

## Consequences

The worker's role narrows to what only we can own: token issuance, roster and
session operations, the cohort profile API, analytics/trace, and publishing —
not LLM plumbing. Contributors gain real agent capability (the coach can read
and edit the actual workspace, run the preview, and delegate to subagents)
without our team maintaining an agent. We take on an SDK dependency and its
version cadence, must resolve licensing for shared classroom keys before the
first SDK-backed workshop, and must work around Workflows being CLI-only (via a
subprocess or hand-rolled Node orchestration) if multi-agent orchestration is
needed. The pedagogy, profiles, safety rules, and analytics are preserved
unchanged; this ADR changes the runtime boundary, not the product philosophy.

## Addendum

- 2026-07-14 — CLI binary provisioning for packaged builds decided: option (b) on-demand download + instructor pre-seed + proxy fallback (REQ-M7). Evidence, comparison, and W4 implementation sketch: [docs/sdk-bundling.md](../sdk-bundling.md).
- 2026-10-14 — The alias maps persist and the catalogue grows. Instead of retiring
  `MODEL_MAP`, `OPENAI_MODEL_MAP` and `GEMINI_MODEL_MAP`, the owner remapped the
  provider-neutral aliases to the Claude 5.5 family and split the OpenAI side cheaper-first
  ([ADR 0006, Alias remap — 2026-10-14](0006-lesson-model-policy.md#alias-remap--2026-10-14)).
  The aliases remain the vocabulary most profiles and every alias-bound frozen lesson use.
  Reviewed explicit ids sit next to them (12 Claude and 7 OpenAI ids on the Service branch
  `feat/claude-5-5-models`, `worker/src/profiles/types.ts:514-542` at `aa94cf3`, not merged),
  and `SUPERSEDED_ALIAS_MAPS` keeps each replaced map so lessons frozen under it keep their
  models. `translate.ts`, `sse.ts` and `gemini.ts` stay as well: the retirement condition
  ("no cohort runs the proxy path") is false, because the dental teaser, the GPT practice, the
  model-comparison practice and the SDK-unavailable fallback (REQ-M7) use the proxy route. The
  SDK coach still receives the model as the alias the app chose: v0.1.56 passes it into
  `Options.model` (`extensions/hypeproof-chat/src/sdkCoachHelpers.ts:975`, `sdkCoach.ts:490-491`)
  and the gateway resolves it (`worker/src/routes/messages.ts:157-169` on the Service branch).
  Orchestration beyond the two built-in read-only subagents still needs host-side code, and a
  per-request model router needs its own ADR first (ADR 0006).
