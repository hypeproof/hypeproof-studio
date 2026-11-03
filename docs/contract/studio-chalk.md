# Studio ↔ Chalk command contract (v0)

Status: v0, contract version `1`. Canonical copy: this file (studio). The Chalk repository links here; it does not keep a copy.
Scope: how HypeProof Studio and the Chalk extension (`hypeproof.hypeproof-chalk`) talk. Studio is public; Chalk is private.

## 1. Principles

- The two extensions talk only through VS Code commands (`vscode.commands.executeCommand` / `registerCommand`).
- Arguments and results are JSON values only. (The same shape works for remote or web hosts later.)
- Every call carries `contractVersion: 1`. A different value is refused with `reason: "contractVersion"`.
- Backward-compatible additions may appear under the same version. Renaming, removing, or changing the meaning of a field requires a new version.
- Studio owns: the local executor, the server address, the issuer-token check (whoami), approval policy, the preview, and the folder.
- Chalk owns: the instructor surface (UI), the Chalk tool definitions and handlers, the instructor brief, and the course-plan logic.

## 2. Commands

### 2.1 Studio → Chalk (Chalk registers; Studio calls)

| Command | Arguments | Result | Notes |
|---|---|---|---|
| `hypeproof.chalk.activateInstructor` | `{ contractVersion, sessionNonce, issuerToken, verifiedServerUrl, connection? }` | `{ ok, contractVersion, reason? }` | Called once Studio has decided the seat is an instructor. Chalk opens its own surface. `reason` (when `ok:false`): `serverChanged`, `serverMissing`, `contractVersion`, `invalidArgs`. |
| `hypeproof.chalk.deactivateInstructor` | `{ contractVersion, sessionNonce, reason }` | `{ ok }` | `reason`: `issuerRemoved`, `rejected`, `studentSlotWins`, `superseded`. Chalk aborts open turns, drops the token and the nonce, and shows nothing. |
| `hypeproof.chalk.status` | — | `{ instructorMode, version }` | Read-only. Student-slot precedence (#1463) is decided by Studio; Studio passes the result. |
| `hypeproof.chalk.onTurnEvent` | `{ contractVersion, sessionNonce, turnId, event }` | depends on the event (§2.4) | Studio sends turn events to Chalk. |

### 2.2 Chalk → Studio (Studio registers; Chalk calls)

| Command | Arguments | Result | Notes |
|---|---|---|---|
| `hypeproof.runtime.runLocalTurn` | `{ contractVersion, sessionNonce, turnId, messages, model?, tools, systemBrief, cwd, policy }` | `{ accepted: true, requestedModel, executorModel }` or `{ accepted: false, reason, message? }` | Starts a turn. Execution is asynchronous; the result arrives as events. `policy` must be `"chalk-instructor"`. |
| `hypeproof.runtime.cancelTurn` | `{ contractVersion, sessionNonce, turnId }` | `{ cancelled }` | Stops the turn; Studio then sends `done(cancelled)`. |
| `hypeproof.runtime.previewOpen` | `{ contractVersion, webPath }` | `{ ok, error? }` | No session nonce in v0 (this command is not tied to a turn). `webPath` must stay inside the Studio folder. |

### 2.3 Refusal reasons from `runLocalTurn`

| `reason` | When | `message` |
|---|---|---|
| `noLocalRuntime` | No local executor (operating build). | `강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.` (exact text; the same sentence the legacy path shows) |
| `noSession` | `sessionNonce` does not match the active session. | — |
| `policy` | `policy` is not `"chalk-instructor"`. | — |
| `contractVersion` | `contractVersion` is not `1`. | — |
| `invalidArgs` | Missing `turnId`, `messages`, or `tools`. | — |

Activation is not refused when no executor exists. The surface opens, and each turn is refused with `noLocalRuntime`. This keeps the operating behavior the same as the legacy path.

### 2.4 Turn events (`hypeproof.chalk.onTurnEvent`, Studio → Chalk)

| `event.kind` | Fields | Chalk's result |
|---|---|---|
| `delta` | `text` | none |
| `activity` | `activity` (opaque object) | none |
| `refusal` | — | none |
| `toolCall` | `callId`, `name`, `input` | `{ result: string, isError: boolean }` |
| `approvalRequest` | `callId`, `action` (contains `prompt`, a `WriteApprovalPrompt`) | `{ approved: boolean }`. No answer, a closed dialog, or an error means `false`. Defined in v0; not sent by Studio in S-2 (see §6). |
| `done` | `status` (`ok`, `cancelled`, `error`), `message?` | none |

Studio sends `done` exactly once per turn.

### 2.5 Chalk calls for tool results

- A `toolCall` is executed by Chalk's own handler. Studio waits for the result and passes it to the model.
- Studio never runs Chalk tool handlers itself. Studio gets only the tool definitions from `runLocalTurn.tools`.

## 3. Session nonce and its limit

- `sessionNonce` is created by Studio for each `activateInstructor`. A new activation creates a new nonce; the old one stops working.
- Chalk checks the nonce on every call from Studio and refuses a stale one.
- **Limit:** the nonce does not stop a malicious extension that runs in the same extension host. It protects against mistakes and misuse of stale calls only. Do not treat it as an authentication secret.

## 4. Tokens and addresses

- The issuer token travels only in `activateInstructor.issuerToken`. Chalk keeps it in memory. Chalk does not store it in VS Code secrets, does not write it to logs or error text, and does not ask Studio for it with a command.
- `verifiedServerUrl` is the address Studio verified with whoami. Chalk does not use it as the server address. Chalk compares it with the Studio setting `hypeproofChat.proxyUrl`. A mismatch is `serverChanged`.
- Chalk does not declare `hypeproofChat.proxyUrl`. Studio declares it.
- When the server setting changes, Studio deactivates the session and activates it again with a new nonce (see §5).

## 5. Connection label and changes

- `connection` (optional in `activateInstructor`): `"server"` (default when absent), `"subscription-claude"`, `"subscription-codex"`.
- Chalk maps the value to the label text used by the legacy panel:
  - `server` → `서버`
  - `subscription-claude` → `내 Claude 구독`
  - `subscription-codex` → `내 Codex 구독`
- Studio's source for the value is the legacy computation (`chatPanelProvider.ts`, `instructorConnection`), which depends on the local executor. The value is fixed for the life of a process. A change (for example, a restart with other settings) starts a new session, so `activateInstructor` carries the new value. No separate notification is needed.

## 6. Approval

Approval policy is owned by Studio: Studio decides whether an action needs approval. Chalk is asked only through `approvalRequest` and answers with the human's choice; Chalk's answer is only the answer.

Deny by default: a missing answer, a closed dialog, an error, or a turn that is already closed is `approved: false`.

In this version (S-2) Studio does not send `approvalRequest`. Runtime approvals (writes, shell, browser) use the existing Studio modal, exactly as before. The `approvalRequest` event is defined here so that Chalk can answer it when Studio starts sending it (M-4 / S-2b).

## 7. Model

- `model` in `runLocalTurn` is optional. Studio records it and reports it back as `requestedModel`. It does not change which model runs.
- The executor runs with its own model (`executorModel`). This keeps the legacy behavior.

## 8. Working folder

- Studio runs turns in its own coach folder. The `cwd` argument is informational for Chalk and is not used to choose the folder.

## 9. Preview

- `previewOpen` opens an HTML file inside the Studio folder, using Studio's preview command. A path outside the folder is refused with `outside-folder`.

## 10. Tests

Studio: `extensions/hypeproof-chat/test/chalk-contract.smoke.mjs` runs the contract against a stub command bus and a stub runner (no vscode module).

Chalk side: the Chalk repository runs the matching round trip against a stub Studio command bus.

## 11. Version history

- v0 (2026-10-23): first contract (S-2 in Studio; M-2 in Chalk). Adds `connection?` and `runLocalTurn` `message` as backward-compatible additions.
