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

P0: selected-work continuity is required by the 2026-11-11 integrated MVP correction. P1: multimodal intake, real Foundry preview/build flow, transparent budgets and operational feedback, cohort access and peer critique. No duplicate SDK runner or release engine.

P2: financial feedback depth, sustained research/transfer studies, cohort networking and advanced offline inference. Dependencies may promote a narrow P2 item into an earlier vertical slice; labels are not dates or completion claims.

M1 user test: 5-turn Korean voice/text session, optional reflection, restart retains drafts/intent, no unrelated context, deny microphone/offline recovery, keyboard/screen-reader/large-text/light/dark checks on real iPhone and Android. Confirmed intent remains a human action. Do not invite testing merely because a package uploaded.

M2 user test: same selected project continues across devices and creates one working preview through Foundry with visible source/run/artifact identity, stop/retry semantics, usage and actual deployment state.

M3 user test: a cohort participant shares deliberately, receives peer feedback, changes an intention and explains the next time/capital allocation using measured or explicitly estimated costs. Longitudinal growth remains a separate research outcome.

## Delivery boundaries

The existing Mac desktop is the sole desktop product. The previous Catalyst preview is superseded and no longer built or uploaded; its local data is preserved. Mobile parity means the essential user outcomes, not replicating a desktop IDE on a phone. Foundry owns versioned execution and verification; existing platform CI and release engines remain the executors. Keep Foundry/policy/adapter/product versions distinct. READY, merged, signed, uploaded, available to testers, installed and user-accepted are separate states.

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
| P0 / M1 | `ST-REQ-NATIVE-DEPLOYMENT-RECEIPT` | https://github.com/hypeproof/hypeproof-studio/issues/3768 |
| P0 / M1 | `ST-TEST-MOBILE-MILESTONE` | https://github.com/hypeproof/hypeproof-studio/issues/3699 |
| P0 / M1 | `LAB-REQ-PHILOSOPHY-PROTOCOL` | https://github.com/hypeproof/hypeprooflab/issues/1542 |
| P1 / M3 | `LAB-REQ-COHORT-LEARNING` | https://github.com/hypeproof/hypeprooflab/issues/1543 |
| P1 / M2 | `SVC-REQ-PRODUCT-COST` | https://github.com/hypeproof/hypeproof-service/issues/355 |
| P0 / M1 | `HAR-REQ-BOARD-AUTH` | https://github.com/hypeproof/hypeproof-harness/issues/548 |

## First-slice requirements

| ID | Required behavior | Evidence boundary |
|---|---|---|
| MREF-01 | Five optional human-owned notes can be edited in any order on iOS and Android; blank/skip is valid. | Native UI journey and actual device observation.  MREF-T01. |
| MREF-02 | v1 notes/drafts/revisions remain readable; notes persist across restart; a later successful save includes earlier visible failed-save edits. | Migration, save-candidate recovery and Android failure-injection regression.  MREF-T02. |
| MREF-03 | Notes do not become AI context or human-confirmed intention automatically; project data remains isolated. | Captured context and cross-project tests.  MREF-T03. |
| MREF-04 | Reflection-only projects are distinguishable and searchable; visible unsaved text remains exportable. | Library journey and export round-trip regression.  MREF-T04. |
| MREF-05 | Native controls remain usable with keyboard, system theme and accessibility; exact candidate CI is retained before a testing build. | Native iOS/Android evidence; physical-device accessibility remains a separate acceptance.  MREF-T05. |

## Correlated native deployment — MTF-01

MTF-01 refines the existing mobile CD gate/operations direction for Studio #3768.
Optional Harness request inputs are all-or-none and bind expected source,
operation and request digest to the trigger, clean checkout, successful native
CI and upload run/attempt. A mismatch stops before signing. Existing no-input
manual/push runs and the `apple-native-preview` environment remain intact.
After archive/export/validation/upload succeed, preserve a credential-free
receipt with the actual app/build identity and IPA digest. Uploaded, Apple
processing, tester availability and physical acceptance remain separate facts.
No success receipt means an uncertain outcome to reconcile, never automatic
permission to resend. This adds no approval engine, desktop build or bypass of
the existing environment and source-CI gates. MTF-T01 covers the contract; live
trusted workflow and Harness consumption remain distinct acceptance evidence.


## Native voice client slice — #3687

The objective is lower expression burden while preserving the person's words,
choice to send, and ability to stop. Voice is optional; fluent speech and use of
voice do not measure learning. The shared Service remains responsible for
question policy, model routing and financial admission. This client slice does
not assert that the separate Service policy/measurement work is integrated.

| ID | Requirement | Verification boundary |
|---|---|---|
| MVOICE-01 | Dictation appends a Korean transcript to the selected project's editable draft and never automatically sends or confirms intent. | Native control/persistence regressions; actual Korean ASR separately.  MVOICE-T01. |
| MVOICE-02 | Conversation starts only after explicit disclosure of final-transcript auto-send and read-aloud. Unsent draft, expired access and changed project block auto-send. | Native consent/expiry/draft tests and generation-token checks.  MVOICE-T02. |
| MVOICE-03 | Final transcript sends at most once through existing Service admission; read-aloud ends with a visible next-turn button. Microphone never reopens automatically. | State/duplicate callback regression; five spoken turns on each physical platform remain required.  MVOICE-T03. |
| MVOICE-04 | Stop, background, project change, audio interruption and late permission callbacks release/fence microphone, playback and pending client work. Partial words remain recoverable. | Native lifecycle/permission tests plus physical interruption check.  MVOICE-T04. |
| MVOICE-05 | Require platform on-device recognition; no network recognizer fallback or paid voice API. Missing engine, permission, voice or network keeps text usable. | Capability/error paths and source review; offline physical Korean recognition is not inferred from a simulator.  MVOICE-T05. |

Interaction: '말로 적기' keeps text for review. '음성 대화' explains final-transcript
transmission before starting. '말하기 끝' bounds capture/finalization; '음성 멈춤'
stops the local turn. Read-aloud finishes at '다시 말하기', which rechecks current
project, access and pending draft. Keyboard use remains available outside capture;
recording never continues behind another screen. A failed or cancelled service
reply preserves the already saved human message; it is not automatically replayed.

Capture is bounded (iOS 30 seconds, Android 60 seconds) with finalization timeouts.
No raw audio is written to files or uploaded by the app. Optional self-listening
retains a bounded in-memory clip until stop or navigation. Recognized text is a local draft,
then follows existing project-scoped AI consent/admission when explicitly sent or
when a consented conversation finalizes. On-device speech may be unavailable
because of OS/language assets; the text path is always the recovery route.
There are zero added hosted ASR/TTS calls; device energy, human time, existing AI
inference, and native CI are still costs. No monetary savings or efficacy is
claimed without measured comparisons.

Acceptance remains partial until exact-source native checks, installed iPhone
and Android five-turn Korean sessions, offline recognition, interruption,
permission-denial and text recovery are observed. Synthetic transitions and
emulator UI are reported separately. The current TestFlight baseline does not
contain this source merely because a branch or PR exists.


## Integrated iPhone correction — 2026-11-11

ST-REQ-NATIVE-MOBILE now requires the existing desktop task as the original work,
with same-account iPhone conversation continuity. New desktop software derived
from the mobile app is excluded. Voice, durable chat sync and ongoing contextual
questions are M1 prerequisites, rather than an optional M2 add-on.

The selected personal conversation is explicitly shared as user/assistant text.
The iPhone sends one durable request ID; only the bound desktop session claims
and executes it through the existing provider. Tools remain blocked for remote
conversation turns. Task files stay local and actual making continues in the
same task on the computer. No classroom or temporary-chat sharing. Pending,
running, persisted/completed and unknown are different states; restart never
replays a previously claimed request. Drafts survive save/network failures.

The account-text transport is an explicit opt-in design for this candidate:
Service stores conversation text over TLS, not E2EE. It is distinct from the
older encrypted artifact-preview relay. It must not be silently described as
that relay or satisfy its original retention/encryption requirements. Real data
is shared only after the product disclosure is accepted. Export, revoke,
local-cache deletion and server-copy deletion have distinct semantics.

Questions reuse the existing desktop coach. Optional user-authored goal,
audience, experience and preferred questioning style can be edited, kept local,
or explicitly sent as a visible draft. No inferred psychological scores. The
person can skip a question, request another perspective, or choose a small
experiment. Reflection, purpose and the user's wording remain editable.

Voice offers editable dictation and explicit final-transcript send/read-aloud.
Optional self-listening is memory-only, bounded to 30 seconds, off by default,
and deleted on stop/background/navigation/next capture. A completed answer is
read only after the matching request and original user message are identified.

Shared source tests and CI do not prove physical Korean voice quality, genuine
growth, installed desktop/iPhone interoperability or deployed Service readiness.

## Account-owned personal reflection — first experience

The first mobile experience is an independent conversation that helps a person understand their own direction. The existing Studio desktop opens the same conversation within its task UI. No new Mac application is introduced, and a running desktop is not required for this conversation. Existing host-owned build tasks keep their explicit sharing/execution boundary.

An example path is: install and use the same account → “요즘 어떤 일에 시간을 많이 쓰세요?” → describe a recent moment → explore why it mattered → consider a desired change → choose one small action. This is a flexible conversational example, not a questionnaire or required ladder. A person may begin with a concrete problem, decline a question, change topic or stop. Age and occupation are optional contextual facts, not mandatory identity fields. Philosophical reflection informs the questions; the UI does not lecture on doctrines, infer destiny or score human worth.

| ID | Requirement | Verification |
|---|---|---|
| MPER-01 | iPhone starts with an optional everyday question and existing voice/text composer. No desktop pairing code or running desktop is required for the personal conversation. Existing account browser authentication remains. | Native UI shell and real installed-device flow. |
| MPER-02 | Same-account personal messages appear in the existing desktop task store; selecting another task does not create a new reflection identity or turn this conversation into a tool runner. | Host/store tests and two-device acceptance. |
| MPER-03 | Preserve drafts and submitted words on failure; retry the same uncertain ID without repeating AI. Stale/account-switched snapshots and reserved message-ID collisions are refused. | Native cache, host, account and Service negative controls. |
| MPER-04 | Account/AI storage disclosure precedes first use; existing entitlement and monetary ceiling apply; cancellation cannot promise a dispatched provider call is unbilled. | Account tests, Service gate evidence and release smoke. |
| MPER-05 | A clear making request is acknowledged without completing self-introduction; guide to an existing desktop task. The desktop action lets the person review their own words and creates an ordinary unsent task draft atomically, without copying the whole conversation or running tools. Cancel, account change and failed persistence preserve the original conversation. | Prompt/policy review, real task-store controls and actual conversation review before broader rollout. |

Delivery: Studio #3725 is the bounded iPhone/existing-desktop slice, under #3690. Service reflection-api@1 and migration 0073 are release prerequisites. Input uses recent conversation (20 messages / 24,000 UTF-16 units), not an inferred permanent personality. The display shows the latest 80 messages; account export retains older rows. New free-account entitlement, Android account sync, scheduled push questions, approved durable personal context and an automatic Foundry handoff remain follow-up work; existing local notebooks remain available. The broader iOS/Android goal is unchanged.

## iPhone credential continuity (MIRS-01, Studio #3736)

| ID | Requirement | Evidence |
|---|---|---|
| MIRS-01 | Preserve account identity and prevent one-use credential replay across interrupted iPhone refresh. | Swift credential controls, actual Keychain simulator probe and separate signed-device acceptance. |

MIRS-01 refines MPER-03 for the existing native iPhone account path: before a one-use refresh token is dispatched, atomically persist a refresh-pending state in the same Keychain item. A failed write sends no request. Restoring a pending item requires fresh login, while conversation files and drafts remain unchanged. Only active `/v1/me` identity matching both the prior account and the acquired session may install rotated credentials. A mismatched or uncertain result cannot be adopted; acquired unusable credentials receive best-effort logout. Legacy items without the new flag decode as idle and retain their account-owned records.

This is a client recovery correction, not an authentication provider, entitlement, retention or account-policy change. Studio #3263 / PR #3298 remains the separate experimental iOS foundation; this slice changes only the current `apps/studio-native/ios` product. Exact approval-URL validation, redirect/stream-size enforcement and sleep-inclusive challenge expiry remain transport follow-up work and are not claimed by this slice.
