# Personal Claude Code continuation verification

Status: acceptance specification for Studio [#2485](https://github.com/hypeproof/hypeproof-studio/issues/2485), under ongoing Epic [#1782](https://github.com/hypeproof/hypeproof-studio/issues/1782). Registry: `ST-TEST-PERSONAL-CLAUDE-CONTINUATION`; domain owner: `jayleekr`. Parent: [PCC-01–08](../requirements/personal-claude-continuation.md). A documented scenario is not an executed test.

## Focused source and browser checks

From `extensions/hypeproof-chat/`, use the repository-supported Node runtime:

```bash
node --experimental-strip-types --test test/personal-continuation-core.smoke.mjs test/personal-continuation-cli.smoke.mjs
```

The browser/host harness is `e2e/customer-claude/run.mjs`; inspect its current execution options and report before running. Its mocked host/provider and browser rendering are separate from native installed-app or real-provider evidence.

| ID | Check and expected result | Requirements |
|---|---|---|
| PCC-T01 | Eligible versus class/minor/paid/native-code/mismatched profile and forged/stale offer controls: only an exact personal nonminor free `studio-open-trial` end-card offer opens the panel. | PCC-01 |
| PCC-T02 | Public mode prepares the full system prompt and selected text with history off/on, even without an installed CLI. Approval starts unchecked. Clipboard equals the exact reviewed payload and excludes unselected files, memory, credentials and other tasks. No CLI inspection/inference occurs, including when only one experimental gate is set. | PCC-03/05/06 |
| PCC-T03 | Review → consent → edit request/material/history → copy must block until fresh review. Repeat after five-minute expiry, cancellation, disconnect and task/activity change. Approval is consumed once; stale callbacks cannot restore it or write to another task. Explicit paste-answer/save appends one `직접 가져온 답변` exchange to the same task and makes no provider-provenance claim. | PCC-02/04 |
| PCC-T04 | Only exact `HypeProof Studio Dev` plus `HPS_PERSONAL_CLAUDE_EXPERIMENT=1` enables experimental transport. Synthetic CLI checks exact stdin, empty cwd, disabled tools/hooks/MCP/connectors/persistence/retries/fallback, bounded output/time and cancellation. Unsupported auth/policy configurations block dispatch without reading credentials or silently replacing auth/provider configuration. | PCC-05/06/08 |
| PCC-T05 | Copy/save failure, quota/auth/offline/timeout in the experiment, and official-client failure preserve original work. No auto-retry/purchase/extra-usage enablement/fallback occurs. A current experimental reply is attributed separately from a manually imported answer. Account/model/funding/payload/policy changes invalidate experimental consent. | PCC-02/07/08 |

These suites establish only their exercised source, synthetic CLI, browser or mocked-host contracts. They do not confirm subscription-backed third-party distribution approval.

## Manual installed-app acceptance

Use an isolated personal workspace. Record exact Studio commit/package hash, OS, timestamp, profile kind, screenshots and evidence paths. Record official-client version/account scope only if actually exercising that client; never record credentials. Any provider send happens in the official client under the learner's separate decision and account funding.

1. Create an ordinary file, an existing conversation and unsent draft with distinct markers; record task identity and file hash. Reach the free end card separately for request exhaustion and time expiry on an eligible profile. Expected: the entry appears, original files/history/draft stay available, and nothing is purchased or sent automatically.
2. Open the public handoff without an installed/logged-in CLI. Paste only intended material; leave history off, then review. Expected: the full payload and local clipboard destination appear; copy consent is unchecked and account/funding are explicitly left for the official client. No CLI inspector or inference runs.
3. Consent, edit request or toggle history, then attempt copy. Repeat after five minutes or a task/activity switch. Expected: renewed review is required, with no stale clipboard/import action. Review afresh and copy once. Expected: clipboard exactly matches the review; original composer draft/file hash/history are unchanged.
4. Independently open official Claude Code with `claude`, check the actual account, model, policy and possible charges, and decide whether to paste/send. Expected: Studio neither launches/logs in nor sends/purchases/retries on the learner's behalf. A failed/offline/quota outcome leaves the Studio task usable; AI-free return works.
5. Optionally paste a text answer back and explicitly press `이 답변을 작업에 저장`. Expected: one exchange appears in the original task as `직접 가져온 답변`, without claiming verified provider provenance. Reopen/reload and verify original history and the saved exchange; project files and original composer draft remain intact. Cancel/close/switch while waiting and attempt a late save: no other task receives it.
6. Verify class/minor/paid/code-issued native-trial/instructor and forged/stale offer controls. Expected: no panel/request. On the normal customer app, set the experiment environment variable alone; on Dev, omit it. Expected: both remain manual. Only exact Dev identity plus `=1` may expose experimental direct inference; real sends require separately reviewed account/funding/payload consent and authorized evidence collection.

## Evidence status

| Layer | Status for this document revision | Required evidence |
|---|---|---|
| Focused source/synthetic/browser checks | NOT RUN by this documentation change; implementation owner records runs separately | Exact revision, command, exit status and report identifying mocks |
| Native installed-app integration | NOT RUN | Package/OS, screenshots and task/file/history/draft before/after |
| Real official-provider/account billing and reply | NOT RUN | Separately chosen official-client run, account/funding scope and bounded outcome without credentials |
| Customer/human acceptance | NOT RUN | Customer-observed continuation and AI-free recovery |
| Subscription-backed automatic inference GA | BLOCKED | Distribution/authentication confirmation; technical success alone does not unlock it |
| Deployment/release | NOT RUN | Separate release/deployment evidence |

Keep PASS, FAIL, BLOCKED and NOT RUN distinct. Public clipboard success is not a provider response; a synthetic response is not native/customer evidence. Epic #1782 remains ongoing.
