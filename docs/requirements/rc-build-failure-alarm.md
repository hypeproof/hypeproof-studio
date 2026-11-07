# RC build failure alarm intent

Owner: jayleekr. Scoped request: hypeproof/hypeproof-studio#3547.
Parent: hypeproof/hypeproof-studio#3173, under #3170 item 2.
This document specifies a bounded implementation slice of that request. It does
not assert that the issue is delivered or that its production alarm is connected.

A release operator should be able to identify an already failed RC platform
build without paying for another build. A small, local CLI consumes run metadata
and returns a deterministic intent for the existing release alarm. The later
delivery adapter must still connect that intent to the existing alarm issue.

## Requirements

| ID | Priority | User problem and observable acceptance | Tests |
| --- | --- | --- | --- |
| RCAL-01 | P0 | A release operator supplies a completed failed Studio RC platform run. The CLI returns an ALARM intent with the observed repository, platform, run ID, attempt, workflow head SHA, tag and canonical run URL, plus the exact existing alarm title. Mac and Windows mapping must reuse the registered platform contract. RC syntax must use the existing build contract without invoking a build. | RCAL-T01 |
| RCAL-02 | P0 | Successful RC builds and events outside the bounded RC build scope do not raise an alarm. Normal main builds and unified verification remain explicit IGNORE decisions; unified acceptance must not be inferred from a main-branch run. | RCAL-T02 |
| RCAL-03 | P0 | Malformed input, foreign repository identity, an inconsistent run URL or an invalid RC contract cannot produce an alarm. They return a stable REJECT reason and exit 2 without reflecting raw input. The operator can correct the recorded input and rerun locally. | RCAL-T03 |
| RCAL-04 | P0 | Repeated observation of the same run and attempt returns identical output and a stable run-attempt key. The result claims deterministic intent only; actual remote duplicate suppression is a separate delivery obligation. | RCAL-T04 |
| RCAL-05 | P0 | Classification makes no network call, subprocess, file write, model call, retry, build, approval or publication. Unknown, cancelled or skipped terminal conclusions return UNDETERMINED and exit 3 for operator review. No claim of build-byte, install, update or production delivery verification is emitted. | RCAL-T05 |

## Ownership, access and cost

Input is internal release metadata, not customer content or credentials. This
CLI has no authenticated account and grants no permissions. The trusted caller
owns collection and limits it to Studio's repository. All three supplied
repository identities must match `hypeproof/hypeproof-studio`. The caller enforces
an offline, read-only subprocess boundary and a time budget. No additional remote
build, provider spend, customer data access or persistent mutation is permitted.

## Design and reuse boundary

Generated source is limited to new `scripts/release/rc-failure-alarm.mjs` and its
new `scripts/release/test/rc-failure-alarm.test.mjs`. Import `PLATFORM` from
`scripts/release/platforms.mjs`; import `buildDispatches` from the existing
`scripts/release/build-contract.mjs` and pass the explicit observed platform.
This avoids the default checkout-platform read and reuses validation of the full
SHA, version and RC tag. It is identifier validation, not proof of what the
historical build checked out. Do not copy a release engine or modify its contract.

The existing alarm title is `Daily release cut skipped: needs attention` in
`.github/workflows/release-cut.yml`. Open #3258 owns that workflow and related
release-cut/cut-result files, tests, pr-ci, traceability and casebook README.
Those paths are excluded from this generation slice. No workflow listener,
GitHub write transport or new alarm identity is introduced.

## Invocation and failure contract

Invoke `node scripts/release/rc-failure-alarm.mjs` without arguments. Stdin is one
JSON value through EOF, bounded to 64 KiB. Stdout is exactly one JSON object plus
a newline. Output schema is `hps-rc-build-alarm-intent/1`. Required output fields
are `schema`, `decision` and `reason`; ALARM additionally has only `repository`,
`platform`, `run` and `alarm` as specified below.

Input has `{repository:{full_name},workflow_run:{...}}`. Required run fields are
`id`, `run_attempt`, `head_sha`, `html_url`, `path`, `event`, `head_branch`,
`status`, `conclusion`, `repository.full_name` and `head_repository.full_name`.
Objects cannot be null or arrays. Strings are nonempty; `conclusion` may be null
only for a noncompleted run. Extra metadata is tolerated but not forwarded.
Run ID and attempt are positive safe integers, SHA is 40 lowercase hex characters,
and URL exactly equals `https://github.com/hypeproof/hypeproof-studio/actions/runs/<id>`.
Envelope, run and head repository names all equal `hypeproof/hypeproof-studio`.

After structural and identity validation, classify in this order:

1. A workflow path other than `.github/workflows/` plus a registered `PLATFORM`
   workflow name returns IGNORE / `out_of_scope_workflow`, exit 0.
2. An event other than `push` or `workflow_dispatch` returns IGNORE /
   `out_of_scope_event`; a noncompleted run returns IGNORE / `not_completed`.
3. A head ref without `-rc.` returns IGNORE / `not_rc_tag`. Otherwise validate
   `buildDispatches({candidate:head_sha,rcTag:head_branch,version:<prefix before -rc.>},
   {platforms:[observedPlatform]})`; failure returns REJECT / `invalid_rc_contract`, exit 2.
4. Conclusion `success` returns IGNORE / `successful_build`, exit 0; `failure`
   returns ALARM / `rc_build_failure`, exit 0.
5. Any other terminal conclusion returns UNDETERMINED /
   `unclassified_conclusion`, exit 3. It is neither a passing build nor an
   automatically approved alarm policy.

Invalid JSON, size or structural types return REJECT / `invalid_input`, exit 2.
Foreign repository identity returns REJECT / `repository_mismatch`, exit 2.
Invalid run ID, attempt, SHA or URL returns REJECT / `invalid_run_identity`, exit 2.
No diagnostic reflects the original input. ALARM `run` has `id`, `attempt`,
`workflowHeadSha`, `tag`, `url`; `alarm` has the existing `title` and
`dedupeKey: hypeproof/hypeproof-studio:workflow-run:<id>:attempt:<attempt>`.

## Remaining delivery criteria

The frozen real observations are macOS failure run 41863405602 and success run
41560611200. Their API projections are not captured webhook deliveries. The
Windows case is a derived contract control, not a verified Windows build.

After this slice, issue #3173 still needs real workflow event activation,
identity binding for unified acceptance failures, delivery to the reused issue,
remote duplicate prevention and an observed failed-run alarm without a new
build. Stable publication, mirror, install and update acceptance are also not
proved by this local classifier. Keep #3173 open until its broader acceptance
has evidence.
