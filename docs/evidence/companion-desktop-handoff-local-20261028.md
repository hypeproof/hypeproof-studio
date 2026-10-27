# Local desktop handoff acceptance seam

This initial unregistered DEV adapter stores one bounded reviewed pending request for
an existing same host/project/task and selected saved HTML version. It preserves the
mobile original draft, reviewed intent, selected HTML ID/version reference and a
caller-observed existing run reference/state. It creates no auth/task/execute store,
transport route, Service grant, background receive or runtime execution endpoint.
No extension/manifest/mobile/production registration is added.

TaskWorkspaceStore owns the optional `.companion-handoff.json` sidecar under its
existing queue/inter-process lock/revision comparison/checksum/atomic write helper.
The legacy task file and strict TaskDocument schema are unchanged: older task readers
reject extra TaskDocument keys, so adding a new field there would make existing tasks
unreadable after a downgrade. The sidecar does not increment the task revision. Main
task/draft bytes stay unchanged. Missing sidecar is absent; malformed/unreadable or
wrong-scope/digest data fails the explicit handoff closed, leaving the ordinary task
readable. Same ID/bytes stage/accept is idempotent; different bytes or a second stored
checkpoint cannot overwrite the one retained request. A future explicit dismissal/
retention policy is outside this first bounded one-checkpoint slice.

The native adapter receives the already available TaskWorkspaceStore, caller-owned
fresh current binding/selection/run snapshot and existing-task reveal callback. The
snapshot is a required integration port, not an account/profile implementation or
proof of live authority. The checkpoint supplies no filesystem path, URL, credential,
tool arguments or permissions. Actual Development mode is checked before store/UI
operations; caller invalidation/disposal plus before/after async guards are required.

Staging reports pending only after persistence and a current-scope recheck. Offline/
unknown waits; wrong actor/device/pair/host/project/task/version/epoch/consent/artifact/
run or revoked access cannot report opened. The exact selected file is resolved by
the host, inspected by the existing workspace file helper and verified against its
saved document hash. Explicit native acceptance records the reviewed decision; opening
failure remains accepted-but-unconfirmed and recoverable for an explicit retry.
“Opened” requires actual native navigation API completion and final scope checks.

The incoming original/reviewed text opens in a readonly, script-disabled request panel
beside the exact saved HTML. Every desktop draft field, attachment, queued input and
history stays unchanged. The panel explicitly says nothing was sent or executed.
Known running/terminal/unknown run metadata is displayed for reconciliation only.
There is no Send/execute callback, and no re-execution/resumption claim from run IDs.
The initial selected attachment scope is one exact saved HTML reference; image/file
content transfer, arbitrary selected attachments and automatic draft merging are not
implemented or silently discarded.

Executed focused results and exact source hashes accompany the bot commit in the
private implementation report. Source host checks use actual temp files/store with
fixture-owned VS Code APIs. Real window focus/navigation must be independently
observed and is NOT RUN by this author while the root integration is active. Mobile
durable draft/outbox, authenticated encrypted handoff delivery, closed/cross-project
navigation, production, release, real member/physical device and whole DMC-7/DMC-T11
acceptance remain NOT RUN/open. Canonical requirements/tests are unchanged; root owns
mapping, issue scope and PRs.
