# Native DEV companion host controls — partial source evidence

Base: Studio `02e425f7cfbdf7a81916c93d4703ceba4046de0e`. This slice owns only
`companionDevHostCommands.ts`, its focused smoke test, and this evidence. It adds
no extension activation/manifest registration, account factory, schema, policy,
transport, or crypto implementation.

## Intent and bounded behavior

Product Intent's learner judgment and explicit effects boundaries map here to
DMC-02/12/14/15: a person compares both screens, chooses approval explicitly,
sees transport state separately from file authority, and distinguishes local
close from signed server revocation. These source tests do not close those REA
or installed-app acceptance requirements.

`registerDevCompanionHostCommands(context, ports)` registers only when the actual
extension mode is Development. Command ID: `hypeproofChat.devCompanionHost`.
The caller supplies `createOwner(signal?)` and a mandatory
`onDidInvalidate(listener): Disposable`. The caller must emit invalidation on
account/configuration/task/workspace changes, including while the owner is idle.
The returned disposable is also added to context subscriptions. Registration and
opening/dismissing the menu create no owner and send no protocol operation.

The structural owner contract was agreed directly with the separate
`CompanionDevHostOwner` implementer. Authentication, current scope, proof and key
validation, shared request admission, host runtime approval and lifecycle remain
inside that owner. This command layer does not turn view metadata into authority.

Each invocation offers one eligible action:

| Menu action | Explicit effect |
| --- | --- |
| 새 기기 초대 준비 | Create the caller-owned native owner and start an invitation |
| 초대 정보 복사 | Copy the ephemeral challenge JSON to the clipboard |
| 기기 참여와 비교 코드 확인 | Inspect the claim; display its comparison code without approval |
| 두 화면의 코드 직접 확인 | Fresh inspect, empty phone-code input, then separate both-screens-match modal; submit exact entered code to owner |
| 암호화 연결 준비 | Connect the approved cipher |
| 현재 작업과 저장된 HTML 확인 | Describe the currently selected task/artifact/version, without a file path or content read |
| 요청 한 번 받기·확인 | One bounded owner receive/handle turn, with truthful processing/ACK/expiry/pending counts |
| 이 컴퓨터에서만 연결 닫기 | Separately confirmed local close; no implicit server revocation |
| 이 기기의 연결 권한 철회 | Separately confirmed signed server request; success only after owner reports revoked |

The challenge stays in RAM and never enters menu/status text, logs, URLs or
storage. Only the explicit clipboard action releases it to the caller's local
clipboard. Error messages never echo raw exceptions, credentials or paths. Code
input has no prefilled value and this layer does not compare/approve it
automatically. Connecting does not automatically receive, read a file, or execute
a request. The existing native owner/runtime owns the separate file approval.

Every pending action has an operation/generation lease. Caller invalidation or
progress cancellation aborts and closes the old owner, clears the private
challenge, and permits a replacement owner. Late old resolution/rejection cannot
publish status, invoke later steps, replace the new owner, or release its busy
guard. A factory result arriving after invalidation/disposal is closed before
its invitation method can run. Dismissing a comparison/close/revoke dialog before
confirmation has no corresponding authority/effect call. No timer, polling,
automatic retry, remote execution route or fallback is added.

## Verification

Node v22.22.1. All checks used the shared `hype-resource` owner
`codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version 1, work/local_heavy,
wait-timeout/timeout 1800 seconds.

PASS: four focused dialog interaction tests. They execute the bundled command
module against a VS Code native API stub, driving actual registered callbacks,
QuickPick/input/modal responses, cancellable progress, clipboard and lifecycle
events. Controls cover the complete explicit invitation-to-turn sequence,
wrong-code sanitized failure, pre-confirm cancellation, local close versus
revocation failure/success, old resolve/reject while a replacement remains busy,
receive cancellation and stale factory disposal. An initial fixture failure
left a simulated menu choice queued after the busy guard correctly prevented a
menu; clearing that unused simulated choice fixed the fixture. No source behavior
was weakened for the test.

```sh
~/.local/bin/hype-resource run --owner codex:01a12522-7c7d-70c2-b09a-353dad5e2280 --job companion-dev-host-command-focused-v2-20261028 --version 1 --stage work --workload local_heavy --wait-timeout 1800 --timeout 1800 -- /Users/jaylee/.nvm/versions/node/v22.22.1/bin/node --experimental-strip-types --test extensions/hypeproof-chat/test/companion-dev-host-commands.smoke.mjs
```

PASS: full extension TypeScript, using the existing ignored dependency symlink
authorized by the captain, with no package install or pin changes.

```sh
~/.local/bin/hype-resource run --owner codex:01a12522-7c7d-70c2-b09a-353dad5e2280 --job companion-dev-host-command-ts-20261028 --version 1 --stage work --workload local_heavy --wait-timeout 1800 --timeout 1800 -- /Users/jaylee/.nvm/versions/node/v22.22.1/bin/node extensions/hypeproof-chat/node_modules/typescript/bin/tsc --noEmit -p extensions/hypeproof-chat/tsconfig.json
```

NOT RUN in this slice: actual native application/dialogs, real Worker or package
composition, genuine account login, Android/iOS, production entry, distribution
and release. The captain owns the separate native composition observation. No
GitHub operation or product registration was performed.
