# Recoverable core secret storage

`build_patch.py` generates `../hps-secure-storage.patch` from the pristine
`HEAD` of the pinned VS Code checkout. It does not modify that checkout. The
existing `scripts/stage-core-patches.sh` picks up the patch automatically and
stages it as `99-hps-secure-storage.patch` for the normal user-patch pipeline.
No Electron version change is involved.

The base service selects its backing store without contacting OS encryption.
Listing keys, missing-key reads, and explicit deletes use storage metadata only.
Existing-secret reads and writes check encryption availability on each operation;
failures propagate with ciphertext unchanged, so callers can retry after access
is restored. A decryption failure is not evidence that the stored record should
be deleted. Explicit in-memory mode remains supported and retains its backing
store across reinitialization. Browser embedder providers retain their existing
routing and events.

This does not suppress an OS authorization prompt when an actual encrypted secret
is accessed. It does not use plaintext persistence or make storage unavailable
errors look like a successful volatile write. `type: persisted` identifies the
selected backing store; it does not assert that OS encryption is currently
accessible. Callers must handle rejected reads/writes.

## Regenerate and verify

From the Studio repository root, with its existing TypeScript dev dependency and
Node 22.22.1:

```bash
python3 scripts/patches/core/secure-storage/build_patch.py vscodium-base/vscode
python3 scripts/patches/core/secure-storage/build_patch.py vscodium-base/vscode --check
node --test scripts/patches/core/secure-storage/secure-storage.test.mjs
```

For an isolated worktree, `VSCODE_SOURCE` may point to an existing cached upstream
checkout and `TYPESCRIPT_PATH` to an existing `typescript/lib/typescript.js`.
The test reads pristine modules with `git show HEAD:<path>`, stages patches in a
temporary fixture using the real stage script, checks and applies the generated
patch, then transpiles and executes the patched class and real upstream storage,
sequencer, event, lifecycle, and browser provider modules. Only encryption and
logging are test doubles; no real OS keychain, account, app, or network is touched.

`TEST_UPSTREAM_BASELINE=1` runs the same behavior tests against the unpatched
class as a negative control. Failures for metadata access, implicit fallback,
decryption data loss, and empty in-memory values are expected.

These are local core behavior and patch-pipeline tests, not a full shell build,
installed-app test, real keychain acceptance test, or release approval. Verification
used pristine VS Code `560a9dba96f961efea7b1612916f89e5d5d4d679`.
