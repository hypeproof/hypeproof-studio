# Desktop-first mobile companion test contract

Targets: [DMC requirements](../requirements/desktop-mobile-companion.md).
Plan: [delivery order](../plan/desktop-mobile-companion.md).
All product acceptance starts NOT_RUN. Unit route tests are a separate boundary.

| ID | Targets | Scenario and expected evidence | Layer |
|---|---|---|---|
| DMC-T01 | DMC-01 | Select an existing synthetic workspace, identify host/owner, restart and reopen without rewriting files or uploading content. | Installed host |
| DMC-T02 | DMC-02 | One approved device pairs; wrong/expired/reused challenge, second actor and revoked device fail. | Real Service + host + client |
| DMC-T03 | DMC-03 | Trace selected content through the relay, inspect local original and bounded relay lifecycle; test ciphertext isolation and key recovery/revocation. | Integrated transport |
| DMC-T04 | DMC-04 | Cached viewing/drafting stays local; a permitted web build executes on the host without moving screens; a permitted desktop-only edit yields handoff; unknown capability fails closed. | Pure route now; real dispatcher later |
| DMC-T05 | DMC-05 | Disconnect the host: local work remains local, host work waits, no paid/cloud route appears; reconnect explicitly reconciles. | Pure route now; transport later |
| DMC-T06 | DMC-06 | Kill/restart producer around durable write/ACK/effect/receipt boundaries. Replay identical request, conflict bytes, and simulate unknown external outcome without duplicate effects. | Persistence + real adapter |
| DMC-T07 | DMC-07 | Change scope/version, duplicate/out-of-order events, stale epoch, revocation and two devices. Preserve drafts; reject stale execution. | Pure scope/version checks now; transport later |
| DMC-T08 | DMC-08 | Learner makes a quiz, actually uses it, points to a change, compares versions and reopens; no keyboard-only step or teacher doing the task for them. | Device + supervised pilot |
| DMC-T09 | DMC-09 | Two synthetic learners cannot read/write each other or instructor data. Load the agreed class size and record wait times and host failure recovery. | Isolated host + classroom |
| DMC-T10 | DMC-10 | Adult document fixture creates a preview; unapproved or stale sending/publishing never executes. | Host + effect adapter |
| DMC-T11 | DMC-11 | Handoff the exact project/version/draft/run; offline target stays pending; continuation does not create a new execution. | Desktop + mobile |
| DMC-T12 | DMC-12 | Denied grant, wrong actor/device/workspace, expired auth, unknown action and stale decision are rejected by real host/Service regardless of planner or UI output. | Pure denial checks now; real enforcement later |
| DMC-T13 | DMC-13 | Korean IME, keyboard, 1,000-message fixture, selected attachments, accessibility, kill/reopen and push/deep link on supported physical devices. | Android/iOS devices |
| DMC-T14 | DMC-14 | Waiting/accepted/running/unknown/completed and cancellation states match measured host events, including late replies. | UI + integrated host |
| DMC-T15 | DMC-15 | Cache removal preserves source/outbox; revoked/deleted content does not return from old devices; export/backup scope is explicit. | Storage + transport |

Use synthetic data and recorded model output first. Hosted AI, external actions,
real learner data and production activation are separately evidenced. Record
exact source, OS/device, fixture and adapter versions; do not inflate one layer
into another. Child learning outcomes require a separate research protocol.

### Local dispatcher seam

`extensions/hypeproof-chat/test/companion-host-dispatch.smoke.mjs` exercises
DMC-T04/05/06/12 against real synthetic local files and the existing command
receipt journal interface: exact-byte request/result persistence, duplicate and
restart behavior, outcome-unknown recovery, offline waiting, continuation-only
handoff, revoked or changed runtime context, ungranted profile, changed consent,
path/symlink escape, unsupported tool/model/write payloads and storage failure.
Pairing preview `execution_authorized:false` is a mandatory denial control.
These checks do not establish the Service transport or device acceptance rows.
The review regressions instrument real selected-file fd reads: failed acceptance
persistence must perform zero content reads; a successful request performs one
read only after durable running and retries perform none. Recovery must reject
any continuation output and malformed or unselected preview output, preserving
normal continuation without an artifact.
