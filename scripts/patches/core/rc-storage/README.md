# Durable RC profile isolation

The generated `../hps-rc-storage.patch` changes only startup for an app at
`~/Applications/HypeProof-RC-<candidateVersion>/HypeProof Studio.app`.
The same immutable app promoted outside that directory retains production startup,
profile and OS encryption namespace. No keychain item, ACL or encryption setting
is modified by the installer or validator.

The installer creates a fresh `~/Library/Application Support/HPS-RC-Profiles/<candidateVersion>`.
It never copies the legacy `HPS-<candidateVersion>` profile or any old ciphertext.
It refuses an existing dedicated profile unless both profile and kit already carry
the exact marker. Legacy kit installs may be upgraded when the new profile does
not yet exist; old profiles remain untouched.

`.hps-rc-profile-v1` is an exact UTF-8 line contract with a final newline, stored in
both the kit directory and profile root:

1. `hps-rc-profile-v1` (schema)
2. `HypeProof Studio RC` (the only permitted namespace)
3. Candidate version, for example `2026.1024.0-rc.2`
4. Embedded app/product version, for example `2026.1024.0`
5. Exact source SHA (40 lowercase hex characters)
6. Absolute app bundle path
7. Absolute dedicated profile path

Historical builds whose embedded version contains the same prerelease suffix also
work. `install-kit.mjs render --app-version <embeddedVersion>` records the exact
value; the default remains candidate version for historical callers. The embedded
version must equal the candidate or its numeric base. Installation checks the zip
SHA, bundle version, and embedded product version/source. The marker is configuration,
not an authentication or code-signing boundary. It cannot select arbitrary keychain
names or paths.

Core validates the actual app path, product version/source, markers and absence of
symlink path components before reading `argv.json`. A direct Finder app launch under
the canonical kit directory selects the same dedicated profile automatically. A
legacy/malformed kit refuses before secret storage startup. Explicit conflicting
CLI paths, `VSCODE_PORTABLE`, `VSCODE_APPDATA`, and in-memory secret storage refuse.
After VS Code resolves `userDataPath`, core validates that final path again, then
calls `app.setName('HypeProof Studio RC')` before Electron's `ready` event. The
launcher clears inherited portable/appdata/development overrides and never enables
in-memory secrets. No production namespace fallback exists for canonical RC kit mode.

This timing follows Electron 39.8.7's
[`ElectronBrowserMainParts::PostCreateMainMessageLoop`](https://github.com/electron/electron/blob/v39.8.7/shell/browser/electron_browser_main_parts.cc):
on macOS it uses `Browser::Get()->GetName()` to set the encryption keychain service
and account before ready/network initialization. That is why a fresh user-data
directory alone cannot isolate the global safeStorage namespace. Later Electron
changes that eagerly initialize secret storage are not assumed to apply here.

If keychain access is blocked, cancel and report the error. Entering a password,
choosing Always Allow, changing existing item ACLs, and disabling encryption are not
normal RC test steps.

Regenerate and test without modifying the cached upstream tree:

```sh
python3 scripts/patches/core/rc-storage/build_patch.py <pristine-vscode-tree>
VSCODE_SOURCE=<pristine-vscode-tree> TYPESCRIPT_PATH=<typescript-module> \
  node --test scripts/patches/core/rc-storage/rc-storage.test.mjs
node --test scripts/release/test/install-kit.test.mjs
```

The focused tests apply the generated patch to pristine upstream, execute the real
patched startup prelude with the real upstream path resolver, and exercise positive
and negative profile contracts. Installer tests use synthetic bundles and scratch
homes, including managed candidate/embedded version differences, inherited overrides,
malformed marker refusal, and preservation of legacy ciphertext. These are source
and installer contract evidence; actual signed-app safeStorage writes and restart
reads still require separate installed-app verification.
