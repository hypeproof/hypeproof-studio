# RC build failure alarm intent tests

Intended canonical path: `docs/testing/rc-build-failure-alarm.md`. These are
acceptance criteria, not an execution report. All tests are NOT RUN at proposal
time. Requirement source: `docs/requirements/rc-build-failure-alarm.md`.

| ID | Targets | Black-box observation and passing criterion |
| --- | --- | --- |
| RCAL-T01 | RCAL-01 | Spawn the CLI with actual-mac-rc-failure and the explicitly derived-windows-failure input. Both exit 0 with the frozen ALARM JSON, including the exact platform, existing alarm title and observed run identity. The real failure is run 41863405602; the Windows control is not remote Windows evidence. |
| RCAL-T02 | RCAL-02 | Feed actual-mac-rc-success (run 41560611200), ordinary-main-build and unified-stage-deferred. Each exits 0 with the frozen IGNORE reason and has no alarm payload. A unified run's workflow head must not become an RC source attestation. |
| RCAL-T03 | RCAL-03 | Feed malformed-json, foreign-source-repository, mismatched-run-url and invalid-rc-contract. Each exits 2 with its frozen REJECT reason, no alarm and no reflected raw input. |
| RCAL-T04 | RCAL-04 | Invoke the actual failure input twice as separate subprocesses. Both produce identical parsed JSON and the same repository/run/attempt key. This is deterministic classification evidence, not proof of exactly-once external delivery. |
| RCAL-T05 | RCAL-05 | Feed unclassified-terminal-result and require exit 3 plus UNDETERMINED/unclassified_conclusion. Run every case under the registered offline/read-only subprocess supervisor, retaining exit/output and enforcement evidence. Without an enforced boundary, side-effect isolation remains NOT VERIFIED. |

The trusted supervisor reads frozen fixture bytes outside the candidate checkout,
launches `node scripts/release/rc-failure-alarm.mjs`, passes raw stdin, closes it
and compares process exit and exactly one JSON object plus newline. Object key
order does not matter. The malformed JSON input is intentionally raw text.
Generated tests are supplementary, not the independent acceptance authority.

The ten named cases and JSON expectations are in the immutable acceptance pack
`rc-failure-pilot-20261105/acceptance.json`. The acceptance report must pin that
pack's manifest digest and the exact candidate source, Node binary, supervisor
and sandbox policy. It must identify the two actual REST projections separately
from the eight derived/parser controls. No live webhook receipt or production
alarm may be inferred.

After implementation, run existing `scripts/release/test/build-contract.test.mjs`
and `scripts/release/test/select-cases.test.mjs` on the same candidate under the
shared resource wrapper on Ubuntu. Record host, source, command, exit and evidence.
They preserve existing release contracts but do not replace the CLI black-box
criteria. No installer or platform build is required for this bounded slice.

Completion evidence belongs in a separate `docs/evidence/rc-build-failure-alarm-intent.md`
report after actual validation. Do not add execution results to this criteria
document or use it as its own verification input. Production delivery of #3173
requires the separate remaining criteria in the requirement document.
