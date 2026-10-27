# Desktop-first mobile companion REA

Status: approved product direction; runtime, mobile and production acceptance open.
Parent: hypeproof/hypeproof-studio#2803. Decision: 2026-10-27.
Intent: [Product Intent](../PRODUCT-INTENT.md). Design and delivery order:
[desktop-mobile-companion](../plan/desktop-mobile-companion.md).
Tests: [DMC tests](../testing/desktop-mobile-companion.md).

## Human decisions and proposals

Jay confirmed that the first customer focus is children creating working web
artifacts; mobile familiarity should reduce keyboard dependence. Requests beyond
the mobile scope should be handed to the computer. Jay then confirmed desktop
workspace setup before mobile pairing, local resources/execution with relay, and
reuse for adult work automation, and requested REA followed by fast implementation.

Classroom host topology, exact device targets, framework, retention durations and
prices remain design proposals until their specific decisions are made. No child
data, production device permission, external delivery or spending is enabled here.

## Requirements

| ID | Priority | Requirement and acceptance | Owner boundary | Test |
|---|---|---|---|---|
| DMC-01 | P0 | Desktop selects an existing local workspace and shows its owner/host before pairing. Reuse task/history stores; no recursive upload or automatic migration. | Studio | DMC-T01 |
| DMC-02 | P0 | Pair a device through an expiring one-use challenge and explicit host confirmation. Grants bind actor, device, workspace, project and capability; revoke without changing unrelated devices. QR possession alone is not authority. | Service + Studio | DMC-T02 |
| DMC-03 | P0 | Keep originals and execution receipts on the host; mobile retains scoped cache and unsent drafts; Service relays bounded data without adopting a permanent workspace copy. Define encryption/key lifecycle before real-data rollout. | Studio + Service | DMC-T03 |
| DMC-04 | P0 | Distinguish local mobile interaction, host execution while remaining on mobile, and desktop-surface handoff. Denied/unknown capabilities never become a desktop workaround. | Studio policy adapter | DMC-T04 |
| DMC-05 | P0 | A host-dependent request waits when its selected computer is asleep/off/disconnected. Cached reads and local drafts do not execute AI or consume a model budget. No silent cloud fallback. | Studio + Service | DMC-T05 |
| DMC-06 | P0 | Persist request ID and exact payload before acknowledging receipt; distinguish phone-saved, host-accepted, running, outcome-unknown and completed. Reconcile uncertain external effects instead of promising generic exactly-once execution. | Studio | DMC-T06 |
| DMC-07 | P0 | Reconnect by stable event cursor and request ID. Reject an ID reused for different bytes, stale workspace/task versions, revoked access and old executor epochs. Preserve conflicting drafts for review. | Studio + Service | DMC-T07 |
| DMC-08 | P0 | A child creates, uses and revises a web artifact from touch-first controls. Short voice/photo inputs are optional, reviewable and removable; typing remains available. Keep the actual artifact central and preserve the previous working version. | Mobile surface | DMC-T08 |
| DMC-09 | P0 | An instructor can prepare a classroom host, isolate each learner's workspace/resources, observe blocked work and limit concurrent execution. Never share the instructor's personal filesystem or credentials with learners. Measure capacity before promising a class size. | Studio + Service + instructor surface | DMC-T09 |
| DMC-10 | P1 | An adult delegates a bounded operation on selected local resources, inspects the result and approves effects under the applicable policy. Sending/publishing/spending is separate from preview and generation. | Studio + Service | DMC-T10 |
| DMC-11 | P1 | Desktop handoff retains project ID, selected artifact version, draft/attachments, pending intent and run identity. An offline target means waiting, not successful transfer. Continue the same run or reconcile it; never replay simply because the screen changed. | Studio + mobile | DMC-T11 |
| DMC-12 | P0 | Both Service and the host enforce actual capability and scope. A model recommendation, mobile UI state or pure route planner is not authorization. Reject invalid, expired, revoked, stale or cross-workspace requests before side effects. | Service + Studio | DMC-T12 |
| DMC-13 | P1 | Preserve first-run device pairing, Korean input, preview interaction, large text, screen readers and resume on actual Android/iOS phones/tablets. Emulator and browser fixtures remain separately labelled. | Mobile | DMC-T13 |
| DMC-14 | P0 | Make host availability, storage location, sender, selected version and effect status understandable. Cancel-requested differs from confirmed stopped; sleep/offline never appears as complete. | All surfaces | DMC-T14 |
| DMC-15 | P1 | Explicitly distinguish cache removal, source deletion, sharing revocation, export and optional backup. Do not adopt proposed research TTLs as production policy or silently destroy pending work. | Studio + Service | DMC-T15 |

## Original REA reconciliation

| Existing source | Disposition for the initial companion mode |
|---|---|
| Studio #2803, #2804: no learner PC/CLI/GitHub prerequisite | Retain for the learner. An instructor/authorized host prepares the execution environment. |
| Service #197 SCONT-R03 / C01: PC-off editing and full shared-workspace sync | Preserve as a separate cloud-continuity ambition, not a dependency or completed claim. Local companion offers cached reads/drafts; new execution waits for its host. |
| SMOB-R09/R10, SCONT-R08, SAGENT recurring work | Mobile-off work may continue on an online host. Host-off execution requires a separately authorized always-on host/cloud offering; not automatic in this MVP. |
| Service #205/#206, Studio #2832/#2841 | Synthetic cloud immutable records remain separate. Do not close, rewrite or reuse their acceptance as local relay proof. |
| Existing 2026-10-27 bridge research and 34 local PoC checks | Reuse protocol hypotheses and failure cases. They are not current product code or mobile/device acceptance. |

## Non-goals of the first slice

No general remote terminal, credential forwarding, continuous screen streaming,
permanent hosted filesystem, new production auth policy, public publishing,
unattended external messaging, framework commitment or release claim. Do not
silently turn off-device cloud work into a requirement that a child owns a laptop.

## First implementation boundary

The first code slice is the deterministic route planner and a runnable synthetic
scenario driver. It has no filesystem/network/tool execution and grants no
authority. It consumes already-normalized host policy context, fails closed on
scope/version/capability mismatch, and returns a user-facing route/status. Its
tests cannot satisfy DMC-01/02/03/06 or installed-device acceptance. The next slice
must integrate workspace selection, actual pairing and a bounded host dispatcher
before claiming a connected product.
