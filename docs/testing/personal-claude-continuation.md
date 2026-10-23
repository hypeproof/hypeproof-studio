# Personal Claude Code continuation verification

Status: acceptance specification for Studio [#2485](https://github.com/hypeproof/hypeproof-studio/issues/2485), under ongoing Epic [#1782](https://github.com/hypeproof/hypeproof-studio/issues/1782). Registry: `ST-TEST-PERSONAL-CLAUDE-CONTINUATION`; domain owner: `jayleekr`. Parent: [PCC-01–08](../requirements/personal-claude-continuation.md). A documented scenario is not an executed test.

## Local source contract checks

Run the focused suites using the repository-supported Node runtime from `extensions/hypeproof-chat/`:

```bash
node --experimental-strip-types --test test/personal-continuation-core.smoke.mjs test/personal-continuation-cli.smoke.mjs
```

| ID | Check and expected result | Requirements |
|---|---|---|
| PCC-T01 | Table-drive eligible and ineligible resolved profiles and stale/forged entry messages. Only the exact personal nonminor `studio-open-trial` free end-card offer opens the panel; native code trials, paid/class/minor seats and mismatched activity scopes cannot. | PCC-01 |
| PCC-T02 | Prepare an explicit request and selected text with history off, then on. Compare dispatched data to the complete review. Unselected secrets, memory, files, attachments, and other-task content are absent; approval is unchecked and send is disabled until consent. | PCC-03/05 |
| PCC-T03 | Negative control: inspect → review → consent → edit payload → attempt send. No dispatch occurs until fresh review/consent. Repeat for history, model, account/provider/funding/policy change, five-minute expiry, cancellation, task/activity change and disconnect. Double-click/reused approval produces at most one request. Late inspection or reply cannot restore consent or append stale output. | PCC-04/08 |
| PCC-T04 | With a synthetic CLI, verify exact stdin, empty temporary cwd, disabled tools/hooks/MCP/connectors/persistence/retries/fallback, bounded output/time, and cancellation. Unsupported CLI/account/provider/policy/helper configuration blocks before model dispatch, with official-client guidance and no credential-file read. Environment forwarding must not silently replace auth/provider configuration. | PCC-05/06/08 |
| PCC-T05 | Inject quota, auth, offline, oversized reply, timeout, and write failure. Report the cause without raw provider secrets, do not auto-retry/purchase/fallback, retain original work, and allow AI-free return. One current successful reply appends a personal-account-attributed text exchange to the same task once. | PCC-02/07/08 |

The core and synthetic CLI suites cover a subset of these checks. Host/render and native checks must establish entry gating, real task persistence and lifecycle integration; the existence of a core suite does not imply those layers pass.

## Manual installed-app acceptance

Use an isolated personal test workspace and an explicitly authorized provider account. Before the run record exact Studio commit/package hash, OS, official CLI path/version, profile/account kind, timestamp, and screenshot/evidence paths. Do not record credentials or full sensitive payloads. A real send can incur the account's configured provider charges and requires the learner's explicit in-product consent.

1. Create a task containing an ordinary project file, an existing text conversation, and an unsent draft with distinct markers. Record the task identity and file hash. Reach the free end card separately for request exhaustion and time expiry on an eligible nonminor `studio-open-trial` profile. Expected: personal Claude entry appears, files/history/draft remain available; no purchase or personal send happens automatically.
2. Open `개인 Claude Code로 이어하기` with a supported personal Pro/Max official login. Expected: verified account, recipient and funding/extra-usage notice appear; history is unchecked. Paste only the marker text intended for transfer. Review the full system prompt and payload. Expected: only those selections and the editable request appear; unselected project/private markers are absent.
3. Check consent, edit the request or history selection, then attempt send. Expected: consent clears and no provider request occurs. Reinspect after changing official account/policy or waiting five minutes. Expected: fresh review is required, with no silent account/provider replacement.
4. Review again and explicitly consent to one send. Expected: one text answer appears and is attributed to `Claude Code · 개인 계정` in the same original task; file hash and original composer draft remain unchanged. No tools, file edit, command execution, or second automatic request occurs. Reopen/reload the task and verify the original conversation plus appended exchange are readable.
5. Repeat cancellation, offline, quota/auth failure, unsupported or managed-policy account, and close/disconnect while waiting. Expected: original task/file/history/draft persist; failures explain how to check official Claude Code, `AI 없이 작업으로 돌아가기` works, and there is no auto-retry, purchase, extra-usage enablement or Studio-pass fallback. A delayed answer never appears in a different task after switching activities/tasks.
6. Attempt entry with a class/minor seat, paid pass, code-issued native trial, mismatched profile/activity, instructor mode and a forged/stale offer. Expected: no personal panel or request. These controls do not modify the existing Service authority.

## Evidence status

| Layer | Status for this document revision | Required evidence |
|---|---|---|
| Focused source/synthetic checks | NOT RUN by this documentation change; implementation owner records actual commands/results separately | Exact revision, command, exit status and report |
| Native installed-app integration | NOT RUN | Exact package/OS, screenshots and task/file/history/draft before/after evidence |
| Real official-provider/account billing and reply | NOT RUN | Explicit-consent run, account/funding disclosure and bounded request result without credentials |
| Customer/human acceptance | NOT RUN | Customer-observed continuation and AI-free recovery results |
| Deployment/general availability | NOT RUN | Separate release/deployment records; source checks do not establish either |

Keep PASS, FAIL, BLOCKED and NOT RUN distinct. A blocked provider environment is not a successful official-client integration, and a synthetic response is not customer evidence.
