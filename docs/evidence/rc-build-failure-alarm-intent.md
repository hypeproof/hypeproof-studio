# RC build failure alarm intent: executed component evidence

Date: 2026-11-05. Scoped issue: #3547. Parent #3173 remains open for actual
workflow activation and alarm delivery. This report does not establish a release,
installation, update, production alarm, or settled monetary cost.

## Actual Foundry generation and external acceptance

Foundry request `studio-generated-rc-alarm-002`, run
`f0a8ce8d-22f2-49f7-a22b-79300c033aa6`, reached **READY for the registered CLI
component**. The Ubuntu control used runtime
`bdf939fc5a96d3b67bb4a60904fe7d2707627eda`; the bounded foreground worker ran on
`Mac.Davolink`. The builder started from Studio
`46c290a1e356108d6365ab799ff8fe9b35b5d6d3` and received the behavior contract,
without a prewritten implementation patch or the external expected fixtures.

The builder created exactly the new CLI and its candidate test file. The trusted
supervisor then ran ten frozen input cases and one deterministic repetition in
an enforced offline/read-only Node boundary. All eleven observations passed with
the required exit codes and exact JSON output; the candidate tests were not the
acceptance authority. A separate fresh model verifier accepted the complete
patch and actual supervisor evidence. All owned candidate processes stopped.

The two actual input observations were REST projections of macOS runs
`41863405602` (failure) and `41560611200` (success). The Windows input and other
controls were derived cases. None was represented as an observed webhook
delivery, Windows build, or installed application.

| Binding | SHA256 |
| --- | --- |
| Frozen acceptance pack v2 | `2c62944f6df41d9632f55d2026e45e9511dbd4472cee77e07658a65eeca2ec71` |
| Generated source patch, 8,631 bytes | `958eb7be206c7bd1029526b4979d4f2428ecf16475139e19d9988f2ead52c63d` |
| Trusted black-box report, 40,364 bytes | `c4ab5cbaf9757d175a5edd1cb017b18d71e5634d5a5d68387c7def00502b72be` |
| CLI source file | `f8046672fdfe0c4706265b16ffaa032c78223dfaac56158f533e313d7c729c63` |
| Candidate test file | `2d9a294879e22cc14b4ea8eaff744ebd1375f24251445ace0d130d049a48c5cd` |
| Independent execution-evidence review | `535e17766bef3a600d696a3aaaa7353c524d0e3447d9271b9c2dc099f852527f` |

The authenticated product client downloaded the same patch and report bytes.
Actual API checks confirmed request/callback replay without new events, conflicts
for changed replay bodies, and denial of another tenant/project's access. The
accepted claim digest bound the current Foundry, policy and adapter content pins.
The durable outbox drained. These are internal control/worker observations, not
public service availability.

## Integration regression

The client-downloaded patch was applied unchanged in commit
`c0d408c2cba4b7b358ea4883115a963c3a76efc4`. Root separately registered its existing
requirement, test, design and implementation links; no existing traceability node
was changed. The open #3258 workflow/cut-result changes were left intact.

On Ubuntu host `snts`, a fresh exported checkout of that exact commit used
Node **22.22.1** downloaded from its official distribution and checked against
the official SHA256 list. The following command passed **39 tests**, exit **0**:

```sh
node --test scripts/release/test/rc-failure-alarm.test.mjs \
  scripts/release/test/build-contract.test.mjs \
  scripts/release/test/select-cases.test.mjs
```

Raw regression log SHA256:
`20de8804763c774a99712d6834dc0f2b717c1f85ec27ff99bd1a16e5d8ea34f8`.
The returned source archive, test files and log were checked against their local
bytes. No npm installation, platform build or remote workflow dispatch was needed.

## Failure, cost and retained evidence

The first run, `41bc7fad-47d3-4442-aeec-3958afacbb5a`, remains FAILED. Its adapter
rejected the unchanged executable Git mode of an existing imported module before
validation; its implementation contract also omitted the complete output shape.
A separate no-model diagnostic confirmed the resulting ALARM field mismatch.
The next runtime copied unchanged regular dependencies without their executable
bit and supplied the complete output schema. External expected results were
unchanged; the failed receipt was not rewritten or promoted.

The successful run reported two agent sessions, 368,728 input tokens (299,776
cached) and 4,035 output tokens. The failed run's usage remains separate. These
are CLI-reported usage observations, not settled billing or a per-use price.
The classifier itself makes no model/API/build calls. Its caller must enforce
the documented process and time boundary.

Operator evidence is retained under the existing Foundry run and artifact store:
`artifacts/foundry-runtime-20261105/runs/<run-id>/`, with `receipt.json`, the
client artifacts, review packet, raw logs and independent review. Ubuntu regression
files are retained under `studio-3547-regression/`. CI, merge and production
delivery results must be recorded separately when observed.
