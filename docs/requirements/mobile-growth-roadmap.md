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

### MTF-01

MTF-01 refines the existing mobile CD gate/operations direction for Studio #3768.
Optional Harness request inputs are all-or-none and bind expected source,
operation and request digest to the trigger, clean checkout, successful native
CI and upload run/attempt. The upload consumes the exact current-attempt gate
artifact and revalidates its source, request and native identity before signing
and receipt emission. An older successful gate retained by a failed-job-only
rerun is refused; rerun all jobs to create a fresh gate. A mismatch stops before
signing. Existing no-input
manual/push runs and the `apple-native-preview` environment remain intact.

Studio #3866 separates the immutable app candidate from a pinned trusted-main
workflow source when the fourth `expected_workflow_sha` request input is present.
All four fields bind a v2 request; original three-field and no-input calls retain
v1 equal-source behavior. App source remains the exact native-CI candidate; no
native-tree equivalence can substitute another full source SHA. Control helpers
run from the clean workflow checkout, while Xcode inputs come from the clean
candidate checkout. Trusted same-repository GET ancestry proofs require candidate
→ workflow → current main at admission and before signing. Ordinary main advances
preserve both pinned identities; rewritten ancestry or moved workflow identity
refuses signing. Gate/upload receipts distinguish app and workflow source while
retaining exact run/attempt, artifact, request and native-CI provenance. This is a
transport contract, not Apple availability or installed-device acceptance.

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

The interaction target below incorporates the 2026-11-12 correction in MFR-03:
one deliberate start, automatic turn boundaries and an always-available stop.
Earlier requirements for a separate voice confirmation sheet, manual end-speech
or a next-turn tap are superseded. The current iPhone account-conversation source
implements that target. Automatic conversation belongs to the account question
screen on each platform. Under Studio #3985, the secondary device notebook retains
local on-device dictation and editable records, without an independent anonymous
AI connection or automatic conversation. The Android account candidate in
#3733/#3735 uses the shared automatic controller. Physical five-turn Korean voice
acceptance remains open under #3687; source and synthetic controls do not establish it.

| ID | Requirement | Verification boundary |
|---|---|---|
| MVOICE-01 | Dictation appends a Korean transcript to the selected project's editable draft and never automatically sends or confirms intent. | Native control/persistence regressions; actual Korean ASR separately.  MVOICE-T01. |
| MVOICE-02 | A deliberate conversation-microphone action starts the foreground interaction after required OS permissions and existing AI/storage consent. Explain auto-send and read-aloud in the interface without a recurring app confirmation sheet. Unsent draft, expired access and changed account/conversation block auto-send. | Native permission/expiry/draft tests and generation-token checks; iPhone also MFR-T03. MVOICE-T02. |
| MVOICE-03 | Stable speech plus acoustic silence finalizes one transcript through existing Service admission. After its matching reply is read, the still-active foreground conversation resumes listening without an end-speech or next-turn tap. Stop or an invalidated session prevents reopening. | State/duplicate callback and matching-reply regressions; five spoken turns on each physical platform remain required. MVOICE-T03. |
| MVOICE-04 | Stop, background, project change, audio interruption and late permission callbacks release/fence microphone, playback and pending client work. Partial words remain recoverable. | Native lifecycle/permission tests plus physical interruption check.  MVOICE-T04. |
| MVOICE-05 | Require platform on-device recognition; no network recognizer fallback or paid voice API. Missing engine, permission, voice or network keeps text usable. | Capability/error paths and source review; offline physical Korean recognition is not inferred from a simulator.  MVOICE-T05. |

Interaction: '말로 적기' keeps text for review and explicit Send. A deliberate
conversation-microphone action starts automatic listening, finalization and
read-aloud; the interface makes the active microphone and stop action clear.
Each next capture rechecks the original account/conversation, access, foreground
state and pending draft. Stop, leaving the conversation or returning from the
background requires a new deliberate start. Keyboard use remains available
outside capture. A failed or cancelled service reply preserves the already saved
human message; it is not automatically replayed. Silence without words cannot
send a turn.

Capture is bounded (iOS 30 seconds, Android 60 seconds) with finalization timeouts.
No raw audio is written to files or uploaded by the app. Optional self-listening
retains a bounded in-memory clip until stop or navigation. Recognized text is a local draft,
then follows existing project-scoped AI consent/admission when explicitly sent or
when an explicitly started conversation finalizes. On-device speech may be unavailable
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
| MPER-02 | Same-account personal messages appear in the existing desktop task store. A visible “나의 질문” action on the default first screen and restored personal task navigation works without a command palette or status bar. Selecting another task does not create a new reflection identity or turn this conversation into a tool runner. | Rendered first-entry → account/admission → real host/store tests, workspace-reload controls and separate two-device acceptance. |
| MPER-03 | Preserve drafts and submitted words on failure; retry the same uncertain ID without repeating AI. Stale/account-switched snapshots and reserved message-ID collisions are refused. | Native cache, host, account and Service negative controls. |
| MPER-04 | Account/AI storage disclosure precedes first use; existing entitlement and monetary ceiling apply. Explicit question intent survives existing login and personal-pass selection, but canceled login, sign-out, a different account/activity/task or an invalid reload marker cannot redirect later. Classroom activities never silently become personal. Cancellation cannot promise a dispatched provider call is unbilled. | Account/admission negative controls, source-bound reload evidence, Service gates and separate release smoke. |
| MPER-05 | A clear making request is acknowledged without completing self-introduction; guide to an existing desktop task. The desktop action lets the person review their own words and creates an ordinary unsent task draft atomically, without copying the whole conversation or running tools. Cancel, account change and failed persistence preserve the original conversation. | Prompt/policy review, real task-store controls and actual conversation review before broader rollout. |

Delivery: Studio #3725 is the bounded iPhone/existing-desktop slice, under #3690. Service reflection-api@1 and migration 0073 are release prerequisites. Input uses recent conversation (20 messages / 24,000 UTF-16 units), not an inferred permanent personality. The display shows the latest 80 messages; account export retains older rows. New free-account entitlement, Android account sync, scheduled push questions, approved durable personal context and an automatic Foundry handoff remain follow-up work; existing local notebooks remain available. The broader iOS/Android goal is unchanged.

### Conversation from the first screen (Studio #3937)

MPER-01 includes an editable text/voice composer before login. A person can write
or dictate locally, then choose the existing account login. Cancelled or failed
login and relaunch preserve those words. Successful explicit login places them
in the personal account's local draft only when that draft is empty and has no
outstanding request; it never sends them. An existing account draft wins and the
guest copy stays available for explicit restoration when safe. Unreadable storage
is preserved and blocks overwrite. A cached account opens its personal history
immediately; a delayed refresh cannot replace the person's later selection.

The iPhone adapts the existing desktop chat hierarchy: one conversation home,
unboxed assistant prose, right-aligned user bubbles, system canvas/light and dark
surfaces, and a single rounded composer. Native Dynamic Type replaces fixed web
font sizes; desktop forest/lime accent roles are adapted for readable controls.
Conversation history is secondary navigation. The existing device notebook remains
available through that navigation and settings, without becoming a competing tab.
Microphone use remains explicit and subject to OS permission. Leaving for history,
privacy or the notebook stops capture. No new Mac app or account/AI entitlement is
introduced. This bounded iPhone change does not establish Android parity or full
desktop feature/design parity.

### Android personal questions · issue #3733

Extend the existing `apps/studio-native` Android package with the same Service
reflection conversation. The local notebook remains a separate destination;
this does not revive the older companion WebView or introduce another product.

| ID | Requirement | Evidence |
|---|---|---|
| MADR-01 | Launch into an optional everyday question. Account approval opens the existing browser page with its exact code included; no desktop, copied pairing code, age/job form or new account protocol. | Native launcher/consent UI and protocol controls. |
| MADR-02 | Read/write `reflection-api@1` using the same account as iPhone and existing desktop. Persist an account-scoped outbox before dispatch; retry an uncertain ID/revision, never silently create a second turn. | Real HTTP serialization, state/model controls and two-device acceptance. |
| MADR-03 | Preserve drafts, original corrupt files and saved words on write/network/refresh failures. Reject stale/account-switched data. Store credentials under Android Keystore encryption in no-backup storage; mark one-use refresh spent before dispatch. | Failure controls and actual emulator Keystore/AtomicFile tests. |
| MADR-04 | Reuse existing Korean on-device speech and installed local TTS through one deliberate microphone action after OS permissions and existing AI/storage consent. Under MVOICE-02/03, native final results send once and only the initiating answer may be read before foreground capture resumes. Stop, account/session/navigation/background changes, expired access and unsent drafts prevent reopening. | VoiceSession and actual callback/Host/model composition controls, inline disclosure and the separate physical Korean voice gate. |
| MADR-05 | Disclose server/AI processing and existing entitlement/cost limits. Guide making requests to the existing desktop's reviewed unsent task flow. Preserve local notebook and free local drafting. | Native UI, existing desktop handoff controls and installed-device review. |

Dependency: Service #386 / migration 0073 and Harness #557 release contract must
be released before claiming live Android reflection readiness. Current account
entitlements apply; this work does not invent a free signed-in AI allowance.
Physical Korean ASR, live account approval and iPhone/Android/desktop sync remain
separate acceptance gates. Source/build tests are not those observations.

#### Android Send during history refresh — Studio #4010

MADR-02/03 and MPER-03 keep one explicit text or dictated Send available while an
existing personal-history GET is waiting. Save the original request ID and words
before dispatch, and retain subsequent draft edits separately. Only this never-sent
request may adopt the successful read's revision and continue once in the same
foreground account/session. An earlier uncertain POST keeps its original bytes.

Stop, background/navigation, account/session changes, a failed or stale read,
remote work in progress, and failed persistence prevent delayed dispatch. The
local outbox survives interruption and restart without automatic replay. The UI
must explain that the words are retained and leave the next choice to the person.
This adds no timer, poll, endpoint, hosted speech call or extra AI turn.

#### Android persistent admission explanation — Studio #4015

MADR-02/03/05 and MPER-03/04 retain an account-reflection request's typed access,
monthly, budget or admission explanation through successful history reads and
relaunch. Store only its request ID and an allowed public error code in the
existing account cache; use fixed customer-facing text, never raw provider text.
Old cache-v1 records remain readable. Keep submitted words, later drafts and the
original uncertain request revision intact, without replay or an extra AI call.

Only a new explicit request or a validated resolved/replaced request clears the
explanation. Failed/unknown or empty reads do not imply success. Account/session
fences, stale responses, failed atomic writes and late Stop/error callbacks must
not erase or attach the reason to another request. Confirmed cancellation or
completion wins over a late failure body. Storage/auth errors take precedence in
the existing status row; local persistence is not live-service acceptance.

#### Android in-flight response Stop — Studio #3997

MADR-02/03/04 and MPER-04 keep `응답 수신 멈추기` available while the original
turn POST is waiting. Stop ends local voice continuation and observes the exact
request ID and words before calling the existing Service cancel route. Only a
matching terminal acknowledgement changes the durable outbox; an unconfirmed stop
preserves its original identity and words without replay. Same-account/session
fences reject late responses; a confirmed failed turn retains its later typed
monthly/admission error. Cancellation does not promise zero provider cost.
Real JVM HTTP and Activity/Keystore tests cover separate boundaries; native live
HTTP, physical speech and billing remain separate acceptance.

#### Confirmed failed-question recovery — Studio #3974

MPER-03/04 and MREF-05 preserve the person's decision after a server-confirmed
`failed` turn: `입력란에 가져오기` copies its text only into an empty effective
account draft, using the existing atomic save-before-adopt path. The failed request
and transcript remain unchanged, and its user message is displayed once. Another
draft, including unsaved edits, is never replaced. Restore stops voice and neither
sends nor resumes capture. Only a later explicit Send creates a new request ID at
the latest confirmed revision. An uncertain `local` outbox keeps its ID and existing
reconciliation path; a transport error alone does not enable failed-turn restore.
This follows **Human judgment stays visible**: the person reviews retained words
before authorizing another request. No provider, account, grant or price policy changes.
Source tests and disposable emulator evidence are distinct from physical/live acceptance.

#### Android long-conversation reading — Studio #3978

Under MPER-03 and MREF-05, reopening the existing Android question conversation
starts at its newest turn. New content and keyboard/layout changes follow the
latest turn only while the person is already near it. A person reading earlier
messages keeps a surviving message and its viewport offset when the recent
80-message window rolls forward; if that anchor has left the available window,
the nearest surviving later message is retained. The **최신 메시지** action has a
48dp minimum touch target and deliberately returns to the latest content. An
explicit Send also returns to the new turn. This view-local behavior changes no
account, persisted draft/outbox, transport, voice policy or recovery contract.
It supports the Product Intent principle that human judgment stays visible by
letting the person review earlier words without an arriving answer taking away
their place. Real Activity geometry/gesture controls cover long history, delayed
snapshot, rollover, keyboard and large text; physical/live acceptance is separate.

### One conversation home and local records (Studio #3985)

MPER-01/03 and MREF-01–05 keep the device notebook as secondary local storage.
Its title and save action distinguish records on this device from account questions.
Existing v1 messages, drafts, reflection notes, confirmed intent revisions, search,
export and corrupt-file recovery remain available in their original storage.
Opening, saving or leaving a notebook never creates an AI grant, dispatches a
question, or imports its archive or draft into the account conversation. The
notebook's old anonymous AI onboarding and continuous-conversation controls are
removed; account conversation keeps the existing voice and admission contract.
Optional on-device dictation only edits the notebook draft. Returning is an
explicit navigation action that preserves both destinations' drafts and stops
capture. Existing server compatibility for older versions remains unchanged.

The notebook owns one native navigation bar. Its title, return action, record
history and menu must remain visible without overlapping each other or a parent
disclosure strip. The local-storage notice belongs below that bar in the record
content. Studio #3998 follows the actual simulator overlap found after #3985;
source integration does not establish visual or installed-device acceptance.

### Desktop visible question entry (Studio #3798)

This follow-up to #3725 reuses the existing StartPage account panel, AccountSession,
pass activation, activity validation, workspace preparation and ChatPanelProvider
reflection method. A normal pass is selected with its existing explicit button;
only the existing eligible super grant follows its existing immediate-entry rule.
No entitlement, checkout, provider call, new Mac app or account store is added.
Missing/denied access explains the existing account/pass choice and preserves work.

One in-memory intent owns login/preparation in the current window. A folder reload
carries only account/session identity on the existing activity-resume marker, already
bound to Service, activity, credential generation, physical folder and expiry. The
marker is consumed before account revalidation and can continue only once. Failed
storage, an invalid marker, account/session change or another navigation never creates
an inferred approval or an automatic retry. Once admission opens the chat, a refused
late question snapshot cannot roll back the person's selected activity or task.
Concurrent configuration reads await the
same durable TaskWorkspaceStore initialization before reflection can open. A current
draft or stream retains the existing refusal/stop boundary. Existing reflection
storage disclosure precedes its first GET/import; entry sends no AI turn or tool call.

Cost: existing bounded account/profile/activity reads and one reflection snapshot
read; zero hosted AI calls from entry. Local focused tests use synthetic HTTP and
actual disk stores. Build/test success does not prove installation, live access or
question quality; those require separate exact-package evidence.

## iPhone credential continuity (MIRS-01, Studio #3736)

| ID | Requirement | Evidence |
|---|---|---|
| MIRS-01 | Preserve account identity and prevent one-use credential replay across interrupted iPhone refresh. | Swift credential controls, actual Keychain simulator probe and separate signed-device acceptance. |

MIRS-01 refines MPER-03 for the existing native iPhone account path: before a one-use refresh token is dispatched, atomically persist a refresh-pending state in the same Keychain item. A failed write sends no request. Restoring a pending item requires fresh login, while conversation files and drafts remain unchanged. Only active `/v1/me` identity matching both the prior account and the acquired session may install rotated credentials. A mismatched or uncertain result cannot be adopted; acquired unusable credentials receive best-effort logout. Legacy items without the new flag decode as idle and retain their account-owned records.

This is a client recovery correction, not an authentication provider, entitlement, retention or account-policy change. Studio #3263 / PR #3298 remains the separate experimental iOS foundation; this slice changes only the current `apps/studio-native/ios` product. Exact approval-URL validation, redirect/stream-size enforcement and sleep-inclusive challenge expiry remain transport follow-up work and are not claimed by this slice.


## Native login and conversation friction correction — MFR-01–06 (Studio #3771)

The 2026-11-12 owner feedback supersedes the earlier manual end-speech and
per-conversation confirmation-sheet design for iPhone. Product Intent: minimum
necessary intervention and useful work first. A person should explore their own
thought, not operate an agent protocol. This change does not assert a learning
outcome or change account eligibility, financial limits or desktop tool authority.

| ID | Required behavior | Evidence |
|---|---|---|
| MFR-01 | One account-login entry opens the OS authentication session, preserves existing sign-up/invitation rules and returns to the initiating app without manual codes. Random state, S256 PKCE, short-lived one-use exchange, fixed destination and durable Keychain identity remain mandatory. A cancelled/expired exchange exits waiting and cannot automatically replay. | MFR-T01; real browser/provider separately. |
| MFR-02 | Typed/dictated Send persists exactly one outbox request even during background synchronization. An AI admission/network failure stays visible after successful history refresh and app restart. Personal reflection remains independent of desktop availability. Old local-only notebooks visibly say they only save. | MFR-T02 / MFR-T05. |
| MFR-03 | A deliberate conversation-microphone action starts capture after required OS permissions; stable transcript plus acoustic silence finalizes once, receives its own reply, and resumes listening while the foreground conversation is still active. No repeated app confirmation, end-speech or next-turn button is required. Dictation remains a draft until Send. | MFR-T03; five-turn Korean physical audio separately. |
| MFR-04 | Stop, navigation, background, account/conversation change and interruption invalidate old callbacks, stop microphone/playback and prevent late sends. Silence without words cannot send; capture remains bounded to 30 seconds. | MFR-T04; actual microphone indicator separately. |
| MFR-05 | Tests cover the full visible login-to-answer path with a deterministic transport, including desktop-off, denied access, offline/uncertain send and restart. Fixtures cannot replace app identity/outbox logic or reach live providers. | MFR-T05. |
| MFR-06 | Release evidence lists required simulator journeys by exact name and marks absent/skipped/failed cases honestly. Package availability, simulator evidence, live sign-in and physical-device acceptance are separate. Unverified TestFlight candidates may be distributed for testing but cannot be reported as accepted. | MFR-T06; existing Foundry and Harness receipts. |

Cost: no new hosted ASR/TTS calls. Existing Service money limits and routing apply
to each automatically submitted conversation turn. Device energy, CI minutes and
human time remain costs. Endpoint thresholds require physical Korean/noisy-room
validation; synthetic silence controls are not speech-quality evidence. Speech
recognition and microphone OS permissions may both be required by iOS; app-level
repeat approvals are removed, OS consent is not bypassed.

Studio #3995 adds an explicit iPhone personal-response Stop action (at least
44pt) while a submission is in flight or a saved request is pending/running.
It uses the existing Service cancel route and preserves submitted words, request
identity and separate drafts. Stop immediately ends local voice continuation;
only a matching terminal server snapshot confirms the outcome. A completed reply
winning the race remains completed, and an uncertain cancel leaves the outbox
recoverable without replay. Already dispatched AI work may still incur cost.
Source, synthetic native acceptance and installed/live acceptance remain distinct.
