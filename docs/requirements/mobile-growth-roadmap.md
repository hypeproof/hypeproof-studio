# Mobile Studio growth roadmap

Status: implementation started; not a claim of full mobile parity or Foundry production delivery.

## Purpose and source precedence

Studio helps people express, reconsider and act on their own intention. Eastern philosophical reflection, plural perspectives and learning through practice inform the design; human agency, judgment, responsibility and social correction remain the normative baseline. Usage, verbal fluency and revenue are not human worth or validated growth scores.

Sources: Lab PHILOSOPHY.md §§2,5,7; MISSION.md; the 2026-11-08 philosophy revision discussion supplied by the owner; the 2026-11-10 request for iOS/Android depth, mobile-first development through Foundry, detailed Kanban priorities and CD. The DOCX distinguishes proposals from adopted canonical philosophy; this roadmap does not silently rewrite that distinction. Existing integration umbrella: Studio #2803; native baseline: #3659 / PR #3661. Reuse existing voice #3686/#3687, continuity #3076 and proactive-conversation research #3297.

## As is → To be

| Area | Observed baseline | Target and gate |
|---|---|---|
| Native distribution | iOS + Mac Catalyst 0.1.1 (2.1) available in internal TestFlight; user reports phone works; Mac installed with receipt. Android APK exists, physical Galaxy not checked. | Separate platform release identities; signed source/artifact/evidence chain; physical-device smoke before a testing milestone. |
| Expression | Text/local drafts; Android system speech handoff. | Low-burden voice, editable transcription, interruption and text fallback using the existing common Service contract. |
| Reflection | Conversations and manually confirmed intent revisions. | Optional observation/person/change/experiment/reflection notes, saved locally; distinguish facts, assumptions, AI suggestions and human confirmation. |
| Continuity | Device-local selected project; bounded recent context. | Account-backed selected-work continuation, explicit merge/recovery and provenance; never send unrelated personal history. |
| Making | No native app-to-Foundry execution. | Chosen intent and acceptance criteria → bounded preview → verify → publish → inspect outcomes through registered Foundry adapters. |
| Economics | Free AI ceiling in Service; no product financial statements. | Separate actual/estimated/allocated cost, token/compute/electricity/infra/labor/operations, revenue/refunds/taxes where relevant, margin and cash; unavailable data stays unknown. |
| Community | No native cohort flow. | Opt-in cohort critique, explain/try/reflect sessions and peer perspective; consent and access control before sharing. |
| Research | Existing philosophical hypotheses and product interpretations. | Source interpretation review → question protocols → burden/agency baseline → comparison → delayed transfer evidence. |
| CD | Successful signed upload; separate CI failure and failed board-sync observed. | Verified candidate promotion, processing reconciliation, recoverable delivery, certificate expiry tracking, cost limits and bounded board updates. |

## Design direction and first slice

Use native system typography for readable Korean and Dynamic Type. Light surfaces #F2F2F7/#FFFFFF, text #1A332E, secondary #636366, action #1A332E; dark surfaces follow system grouped backgrounds and action #73D1AB. Left-aligned hierarchy: current thought → human-confirmed intent → conversation; a clearly named '생각 정리' opens an optional five-part notebook. This is a reflection workspace, not a scored form or compulsory onboarding funnel. A searchable project library shows confirmed intent and unsent drafts. The user's words stay editable and exportable.

First slice ST-REQ-MOBILE-REFLECTION: persist five optional notes (observation, audience, change, experiment, learning), open directly from the active project, preserve v1 records, keep notes out of AI transmissions and confirmed intent, preserve visible edits on save failure/export, and maintain project isolation. Notes may be blank, skipped or written in any order. No automated capability inference. iOS and Android use the same data contract.

## Priority and milestones

P0: usable daily conversation and trustworthy release foundation. Reuse #3686/#3687 and private Service policy/measurement work; implement reflection/library and data retention; repair agent board access and bounded synchronization; prove CI and signing prerequisites.

P1: selected-work continuity, multimodal intake, real Foundry preview/build flow, transparent budgets and operational feedback, cohort access and peer critique. No duplicate SDK runner or release engine.

P2: financial feedback depth, sustained research/transfer studies, cohort networking and advanced offline inference. Dependencies may promote a narrow P2 item into an earlier vertical slice; labels are not dates or completion claims.

M1 user test: 5-turn Korean voice/text session, optional reflection, restart retains drafts/intent, no unrelated context, deny microphone/offline recovery, keyboard/screen-reader/large-text/light/dark checks on real iPhone and Android. Confirmed intent remains a human action. Do not invite testing merely because a package uploaded.

M2 user test: same selected project continues across devices and creates one working preview through Foundry with visible source/run/artifact identity, stop/retry semantics, usage and actual deployment state.

M3 user test: a cohort participant shares deliberately, receives peer feedback, changes an intention and explains the next time/capital allocation using measured or explicitly estimated costs. Longitudinal growth remains a separate research outcome.

## Delivery boundaries

The existing Mac desktop IDE RC and the Catalyst preview are different applications. Mobile parity means the essential user outcomes, not replicating a desktop IDE on a phone. Foundry owns versioned execution and verification; existing platform CI and release engines remain the executors. Keep Foundry/policy/adapter/product versions distinct. READY, merged, signed, uploaded, available to testers, installed and user-accepted are separate states.

Foundry's active Ubuntu control plane and registered desktop runner are owned by another session. Do not take over that session, change its pins or relabel its runs as mobile development. Mobile registration/adapter admission is a tracked prerequisite. Signing keys remain in the release environment, outside model workspaces.

## Tracked implementation packages

| Priority | Requirement | Issue |
|---|---|---|
| P0 / M1 | `ST-REQ-MOBILE-REFLECTION` | https://github.com/hypeproof/hypeproof-studio/issues/3688 |
| P0 / M1 | `ST-REQ-MOBILE-UX` | https://github.com/hypeproof/hypeproof-studio/issues/3690 |
| P0 / M1 | `ST-REQ-MOBILE-CONTEXT` | https://github.com/hypeproof/hypeproof-studio/issues/3691 |
| P1 / M2 | `ST-REQ-MOBILE-CAPTURE` | https://github.com/hypeproof/hypeproof-studio/issues/3692 |
| P0 / M1 | `ST-REQ-MOBILE-FOUNDRY-ADAPTER` | https://github.com/hypeproof/hypeproof-studio/issues/3693 |
| P1 / M2 | `ST-REQ-MOBILE-MAKE` | https://github.com/hypeproof/hypeproof-studio/issues/3694 |
| P1 / M2 | `ST-REQ-MOBILE-ECONOMICS` | https://github.com/hypeproof/hypeproof-studio/issues/3695 |
| P1 / M3 | `ST-REQ-MOBILE-COHORT` | https://github.com/hypeproof/hypeproof-studio/issues/3696 |
| P0 / M1 | `ST-REQ-MOBILE-CD-GATE` | https://github.com/hypeproof/hypeproof-studio/issues/3697 |
| P1 / M1 | `ST-REQ-MOBILE-CD-OPS` | https://github.com/hypeproof/hypeproof-studio/issues/3698 |
| P0 / M1 | `ST-TEST-MOBILE-MILESTONE` | https://github.com/hypeproof/hypeproof-studio/issues/3699 |
| P0 / M1 | `LAB-REQ-PHILOSOPHY-PROTOCOL` | https://github.com/hypeproof/hypeprooflab/issues/1542 |
| P1 / M3 | `LAB-REQ-COHORT-LEARNING` | https://github.com/hypeproof/hypeprooflab/issues/1543 |
| P1 / M2 | `SVC-REQ-PRODUCT-COST` | https://github.com/hypeproof/hypeproof-service/issues/355 |
| P0 / M1 | `HAR-REQ-BOARD-AUTH` | https://github.com/hypeproof/hypeproof-harness/issues/548 |

## First-slice requirements

| ID | Required behavior | Evidence boundary |
|---|---|---|
| MREF-01 | Five optional human-owned notes can be edited in any order on iOS and Android; blank/skip is valid. | Native UI journey and actual device observation. |
| MREF-02 | v1 notes/drafts/revisions remain readable; notes persist across restart; a later successful save includes earlier visible failed-save edits. | Migration, save-candidate recovery and Android failure-injection regression. |
| MREF-03 | Notes do not become AI context or human-confirmed intention automatically; project data remains isolated. | Captured context and cross-project tests. |
| MREF-04 | Reflection-only projects are distinguishable and searchable; visible unsaved text remains exportable. | Library journey and export round-trip regression. |
| MREF-05 | Native controls remain usable with keyboard, system theme and accessibility; exact candidate CI is retained before a testing build. | Native iOS/Android evidence; physical-device accessibility remains a separate acceptance. |
