# Studio Architecture Decision Records

This directory records decisions that explain why Studio is structured the way
it is. ADRs are short and stable. They are not meeting notes. A new ADR is
required when a PR changes architecture boundaries, release topology, auth
contracts, preview safety policy, or the docs source-of-truth model.

## Index

| ADR | Status | Decision |
|---|---|---|
| `0001-source-owned-dev-docs.md` | Accepted | Keep dev docs in product repos and publish through `hypeprooflab`. |
| `0002-native-browser-via-webcontentsview.md` | Proposed | Build the education native browser on Electron `WebContentsView` (core patch + CDP), not a cmux/WKWebView port. |
| `0003-agent-sdk-coach-runtime.md` | Accepted (recorded 2026-10-14) | Adopt the Claude Agent SDK as the coach runtime; keep the fork and embed the SDK coach. The provider-proxy plumbing and the alias maps stay while proxy cohorts exist; on 2026-10-14 the maps were remapped instead of retired. |
| [0004-chalk-authoring-storage.md](0004-chalk-authoring-storage.md) | Accepted | Service-owned drafts and frozen session-design documents. |
| [0005-lesson-assistant-identity.md](0005-lesson-assistant-identity.md) | Proposed | A frozen lesson's fixed AI display name travels through the existing `ux.coach` contract; no new profile key, no capability change. |
| [0006-lesson-model-policy.md](0006-lesson-model-policy.md) | Accepted for the bounded #792/#795 implementation; amended 2026-10-14 | A frozen lesson may narrow the models it allows within what the profile already grants, and the app is told the seat's set. The 2026-10-14 amendment remaps the aliases to the Claude 5.5 family, keeps lessons frozen under the old map on their frozen models, and requires a new ADR before any per-request router. |
| [0007-lesson-feature-binding.md](0007-lesson-feature-binding.md) | Proposed | A frozen lesson may narrow the features its seat may use, within the compiled profile's grant; enforced at both the chat gate and the profile serializer, and explicit that this is not a boundary on the Agent SDK route. |
| [0008-activity-connection-boundaries.md](0008-activity-connection-boundaries.md) | In progress | Validate a candidate and prepare its workspace before committing the existing credential. |
| [0009-voice-transport-and-provider.md](0009-voice-transport-and-provider.md) | Proposed | VO-02 전송 선택의 틀: 전송보다 **캡처**가 앞이고, Anthropic·Gemini 는 약관의 18세 조항이 아동 코호트를 배제하며, 유료 선택지는 모두 새 원가 meter 를 요구한다. **결정은 하지 않는다** — 고르는 것은 사람이다. |
| [0011-front-line-orchestrator.md](0011-front-line-orchestrator.md) | Proposed | The coach stays the only voice and orchestrates Service-defined, versioned helpers through one host-executed `consult` tool. Every request is attributed and routed inside the allowed set. Deterministic checks replace review calls. Open owner decisions are listed. |
