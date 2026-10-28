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

The subsequent [local dispatcher seam](../evidence/desktop-mobile-companion-routing.md#local-dispatcher-seam-dmc-3-partial-2026-10-27)
provides source/fixture evidence for the selected-artifact portion of
DMC-04/05/06/07/12/14. It reuses the existing classroom receipt journal and file
attachment gates. A normalized current runtime authority permits only the exact
selected `preview.read` or output-free `desktop.continue` operation; pairing
preview metadata supplies no execution authority. Durable accepted/running state
precedes content reads; retries and interrupted recovery do not rerun the request.
This is an unintegrated local adapter, not actual authenticated host/mobile
dispatch. Studio #3072, the complete DMC-3 outcome and full test-contract
acceptance remain open. No requirement or acceptance row is replaced here.
The subsequent [local preparation implementation](../evidence/desktop-companion-workspace-20261027.md)
adds selection of the current existing trusted workspace, explicit review/save
and persisted preparation with an unpaired status. It reuses the existing activity
binding and task-scope identity. Its activity label and machine digest do not
verify an account owner or device authority. This is partial DMC-01/DMC-14
evidence; full DMC-1 ownership/capability acceptance, DMC-T01 and DMC-T14 remain
open. Pairing, grants, transport and dispatch are not implemented by preparation.

The [development host preview composition](../evidence/companion-host-preview-composition.md)
connects these source seams with the existing account/pass/profile and selected
saved HTML. It requires an explicit current-request desktop confirmation and
keeps the factory development-only. Synthetic local Worker/browser observations
do not close DMC-3 or installed-app/device/classroom acceptance.

The [bounded transfer and mobile presentation slice](../evidence/companion-artifact-transfer-20261028.md)
adds framed results and controlled result presentation while retaining the
original runtime/relay limits. Its partial source/browser evidence does not
complete device, restart, classroom or production acceptance.

The separately scoped #3099 source cut adds one owned mobile controller,
request-budget admission, an explicit same-live-cipher data checkpoint and
confirmed local-view cleanup. Restoring data requires exact saved packets and
a surviving cipher-owner attestation; it does not restore keys or authorize a
new request. An uncertain receipt is reconciled without resending the request.
Cold process/key recovery, native product controls and installed device
acceptance remain separate. See the controller, checkpoint, adapter and cleanup
evidence for their exact local/synthetic boundaries.

The separately scoped #3098 native-controls cut registers explicit DEV-only
commands using the existing AccountSession, prepared workspace and task/profile
binding. One owned host session shares the native protocol budget; its journal
lease drains admitted writes before another owner can load. Cipher closure
synchronously closes its native owner and erases owned key references before
late receive work can publish. Local close remains distinct from signed remote
revocation. This cut adds no authoring/execution callback, Android application,
production registration or cold-key recovery. The isolated DEV-copy version fix
retains the upstream extension-compatible engine version and a separate release
marker; stable platform product stamping is outside this cut.

The separately scoped #3100 Android preview experiment wraps the existing
controller in an API35 debug shell with explicit synthetic native provisioning.
The default launcher has no provisioned transport, and release source excludes
the fixture activity. Account credentials remain native RAM; authenticated
encrypted selection metadata is the only device descriptor source. This initial
fixture boundary is distinct from later #3115 personal sign-in, #3114 draft
review and #3097 selected execution. New asset/source checks do not establish
installed or real-member acceptance for a newly assembled cut.

The separately scoped #3114 cut carries a verified phone request as data through
reviewed local handoff and the existing native task draft. Import never dispatches
a model. An explicit ordinary desktop Send may bind the exact unchanged request,
normal user/turn identity, valid restore point and terminal run evidence. Edited
native text loses automatic provenance and remains an ordinary draft; uncertain
runs remain unknown and do not replay. Completion describes a measured ordinary
SDK turn, not edit acceptance, changed HTML or result quality. Prior terminal
records remain when the next request is imported. Mobile receipt observation is
bounded after the one send attempt settles and never resends it. A newer saved
selection is adopted only by an explicit gesture on the same verified pair, and
its preview must be verified before another authored draft. Selected execution
permission is separate #3097 work, and phone-native personal sign-in is #3115.


## Android native personal-account entry — #3115

The Android launcher uses the existing Service device authorization protocol and
fixed Service/Lab origins. Browser approval and current active `/me` account and
session must agree before the separate debug companion entry can open. Access
tokens stay in native RAM; no refresh, process recovery, token bootstrap, new
credential authority or production workspace transport is introduced. The owned
debug sign-in accepts only canonical127.0.0.1 with an explicit adb reverse mapping.
Local cancel suppresses stale installation and interrupts bounded HTTP; known
late credentials receive best-effort logout. A pending code or unknown response
can outlive local cancellation because Service has no pending-device cancel API.
These source controls do not prove Google login, genuine-member eligibility,
physical-device/iOS, classroom or production readiness. Selected execution #3097
remains a separate, default-disabled scope.

## Selected HTML execution foundation

The local execution prototype keeps `preview.read` separate from
`authoring.selected-html`. A Service reservation must match the native owner,
paired device, selected artifact/version, exact phone packet, actual normal-turn
ID, and existing activated model-pass identity. A response digest is provenance,
not an authorization token. Live Service validation, current native consent and
the existing profile/folder policy remain required before effects.

The existing TaskWorkspaceStore retains prepared/bound/terminal records and
returns `created:false` for retained requests; callers must never dispatch those
again. Unknown outcomes remain locked for reconciliation. The SDK policy permits
only the selected regular HTML file through Read/Write/Edit and preserves existing
write approval. No proxy fallback, shell, external tools or broader workspace
context is granted. These source foundations do not activate a production entry
or complete the mobile-only DMC-T04/08/12 scenarios.

The prepared development entry uses the existing desktop Send admission and
history/restore lifecycle. It requires both the local selected-file policy and
the exact Service reservation binding; a client header alone grants nothing.
The reservation's turn ID is the actual SDK turn ID. The binding is captured
before asynchronous work, and Service remains responsible for checking the live
grant and activated-pass identity on every upstream model request. Ambient
environment headers cannot attach a companion reservation to ordinary Send.
No production command or relay execution callback is registered by this seam.
