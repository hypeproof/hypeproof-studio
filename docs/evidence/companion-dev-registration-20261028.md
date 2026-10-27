# Existing Studio runtime DEV companion registration

The actual extension activation returns a companion factory-registration capability
only in `ExtensionMode.Development`:

```ts
const activated = await vscode.extensions.getExtension('hypeproof.hypeproof-chat')!.activate();
const registration = activated.companionDev.registerClients({ pairing, relay });
```

`pairing` and `relay` are the existing structurally injected private client
factories. The package remains unpublished/unpinned here. Production activation
returns no such capability. Registration installs the existing explicit native
controls, with no companion account, network, task or journal operation until a
user gesture. The API exports no credentials, paths, owner, journal or native
filesystem ports. The already authorized DEV caller supplies code, not a webview
URL or mobile execution endpoint.

The entry closes over the actual AccountSession, ActivityConnections, provider's
current TaskWorkspaceStore view, opsRuntimeGeneration and prepared workspace.
It requires the existing signed-in account view/stored session and task preparation;
it creates neither accounts nor tasks. The owner, native bridge, raw authenticated
transport and HostSession preserve explicit code comparison, exact-file native
consent, profile/folder/task/version checks and journaled execution. Pairing does
not authorize a read. Local close does not claim remote revocation or key zeroization.

The native subscriptions invalidate idle and active owners on stored account or
current activity credential changes, actual session invalidation, relevant
Service/site/account settings, workspace/trust changes and disposal. Narrow
provider callbacks cover connection/task binding transitions, profile invalidation
and operation generations. An unchanged AccountSession view refresh and ordinary
draft updates do not invoke the callback. Before/after async owner checks remain
in force. No polling, timer coordinator, new auth/task store, manifest command or
production enable flag is added.

One CompanionTransportBudget is retained for the same Service/session across task
or owner recreation. Existing pairing/status/relay HTTP and the explicit initial
routing `/me` use that caller budget through the owner. Native profile/pass and
AccountSession refresh keep their existing owners and are not newly budgeted here.

## Exclusive journal lifetime

A separate hashed companion-scope directory beneath native global storage holds
the existing accountLock mechanism and `journal.json`; the account refresh lock
is never held. Its scope binds Service/account/session/prepared workspace/host/project.
Each owner has exclusive journal use across windows. Writes snapshot on admission,
serialize, write a unique private temporary file and atomically rename it. Loads
return absence only for ENOENT; parse/read/lock failures fail closed. The dispatcher
continues to validate the journal schema and durable request receipts.

Invalidation or explicit close stops journal admission before closing the owner.
Already admitted IO drains before releasing the cross-process lock. An entry-local
release barrier prevents a successor from acquiring/loading before that release;
old future saves reject. A cancelled waiting acquisition never obtains a runner,
settles its existing bounded lock wait, and permits a fresh explicit successor.
Actual acquisition/cleanup errors keep later owner creation blocked. This reuses
existing lock/JournalStore behavior; it is not a claim of power-loss durability or
a new general receipt store.

## Validation boundary

The focused Node checks exercise the actual entry/controls/preparation/owner with
synthetic native/account/client ports, plus actual provider/task/store and disk
lock behavior. They hold an admitted old save mid-write, invalidate, prove the
successor cannot load early, drain, reject later old writes, reject a corrupt
journal read and cancel a waiting acquisition. Existing account-lock multi-process
regressions are included. Production API absence and registration with zero
companion account/task/filesystem/network work are checked. A registered control
creates the real owner only on a gesture and recreates it after journal release;
one routing `/me` occurs per invitation and no implicit relay/profile read occurs.

Exact executed results and source hashes are in the private implementation report
returned with this commit. Full extension TypeScript is checked. Actual registered
Dev app/Worker/mobile acceptance is a separate root-owned run and is NOT RUN by
this change. Real member login, physical Android/iOS, release, production and full
DMC acceptance remain open. Canonical ST-REQ-COMPANION/ST-DES-COMPANION/
ST-TEST-COMPANION and original acceptance remain unchanged; root owns mapping/PRs.
