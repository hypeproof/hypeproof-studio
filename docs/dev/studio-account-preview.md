# Personal account preview (REQ-L13)

Parent outcome: [hypeproof/hypeprooflab#1254](https://github.com/hypeproof/hypeprooflab/issues/1254), account-system plan P4 dated 2026-10-15.
Intent parent: INT-ACCESS-01/05, ST-REQ-ACCESS-BUDGET. The existing access domain owner is Jay (`jayleekr`); this implementation does not appoint a new owner or approve launch policy.

This opt-in candidate connects the real Studio extension and webview to local Service and Lab. Accounts remain off by default and cannot be enabled against a non-loopback URL. Existing classroom, trial, and anonymous purchase paths retain their default behavior. No real Google consent, payment, production deployment, release, legal approval, or Windows acceptance is implied.

## Run an isolated customer test

Start the separately owned local Service on `127.0.0.1:8793` and Lab on `localhost:3193` with their account preview flags. Then, in this Studio checkout:

```sh
node scripts/bootstrap-service-packages.mjs
npm --prefix extensions/hypeproof-chat ci
npm --prefix extensions/hypeproof-chat/webview-ui ci
python3 scripts/studio-dev.py --provider service --account-preview --inmemory-secrets --state-dir /absolute/owned/studio-account-dev run
```

The launcher uses the installed macOS or Windows shell as an isolated copy and builds this checkout's extension/webview. It never replaces the official app. `--account-preview` sets the two local endpoints and machine-only feature switch. The default ordinary development mode disables the switch. `--inmemory-secrets` uses VS Code's SecretStorage implementation held only in this app process, so no OS keychain prompt occurs; quitting the preview requires signing in again. Omitting this explicit test switch uses normal VS Code SecretStorage, but persistence/keychain behavior is not claimed verified by the automated preview.

The Service provider is selected to avoid silently using a person's CLI subscription. Account/pass navigation requires no model request. Sending an AI prompt requires a separately configured local provider or funded test Service; never interpret entry success as AI execution success.

For quiet automated Mac evidence, first `prepare` instead of `run`, then:

```sh
bash scripts/prep-test-app.sh '/absolute/owned/studio-account-dev/HypeProof Studio Dev.app'
npm --prefix e2e ci
HPS_ACCOUNT_DEV_STATE=/absolute/owned/studio-account-dev HPS_ACCOUNT_EVIDENCE=/absolute/owned/evidence node e2e/accounts/mac-preview.mjs
```

The harness uses the real prepared app, in-memory secrets, an off-screen nonfocusable window, and CDP port 9393. It intercepts only external browser opening and writes the explicit approval URL to `device-link.json`; open that URL in the separately controlled synthetic Lab browser and approve the matching number. It captures the actual app at start, pending approval, signed-in pass list, and pass activity preview. It leaves the app running until the owned state directory gets a `stop-preview` file. This is a development app, not a browser imitation or installed release acceptance.

## Acceptance and failure controls

- `account-session.smoke.mjs`: pending device requests have no session; browser denial/expiry/cancellation have recoverable copy; cancellation racing approval revokes the late session; views expose no credential fields; concurrent reads rotate only once; selected-pass credentials renew; network failures retain credentials; revocation and another window's logout clear the matching local session.
- `account-runtime.smoke.mjs`: the real StartPage and ActivityConnections preserve the old classroom until the normal activity commit; the SecretStorage adapter used by chat/SDK returns the refreshed pass credential; account purchases include bearer auth and never anonymous claim; changing Service sends no account token to the new origin; revocation preserves classroom credentials and files.
- `account-lock.smoke.mjs`: separate Node processes share the same rotation lock and recover a dead owner without overlapping critical sections.
- Existing purchase, activity-connection and pass-takeover tests remain the classroom/anonymous and transactional negative controls.
- The Mac harness verifies visible customer controls through raw CDP mouse events. Service/browser approval is still an independent integration dependency.

## Credential lifetime and runtime limits

The account bundle is pinned to its configured Service. Rotation reads current SecretStorage under a per-storage inter-process lock, so multiple windows cannot reuse an old refresh token. Account pass records store the session/pass binding; the existing `ActivityConnections.token()` path used by `ChatPanelProvider.handleSend`, proxy and SDK resolves it before each turn. Credentials renew with five minutes left, exceeding the existing 240-second pass turn deadline. No refresh credential is ever sent to the SDK.

The app checks the account every 15 seconds. Confirmed session revocation stops active streams, rejects pending approvals, disconnects the matching active activity, and deletes only that session's saved account activity credentials. Files and unrelated classroom credentials remain. The Service independently checks session validity on requests. Offline sign-out removes local credentials and explicitly reports that remote revocation was not confirmed; the web account page can revoke that device later.

## Browser return (R2)

The Google entry button includes the multicolor Google mark. Device start sends an
optional `return_uri` generated by `vscode.env.asExternalUri`; VS Code adds the
originating `windowId` and brings that window to the foreground when its URI handler
returns. The URI contains a cryptographically random, short-lived, single-use
`state`, never an account credential or device code. Lab invokes the approved URI
and offers a manual retry plus Dock/taskbar instructions when the OS blocks opening.
The handler joins any in-flight poll and retains the return request through slow-down
responses. On confirmed approval the host reveals the account page once and requests
the original-window URI itself if the browser never returned; unknown, cancelled, consumed and expired state does nothing to
credentials. Ordinary background refresh never steals focus. A fresh start replaces
the attempt. OS protocol registration and browser prompts remain native acceptance
checks; unit tests alone do not prove foreground switching on a released app.
