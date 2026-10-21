# Fast Mac releases (repack path)

Studio releases were Mac only from 2026-10-19; Windows ships again from 2026-10-20
(Jay), through `config/release-platforms.json` below. Most releases change only
`extensions/hypeproof-chat`, so `build-mac.yml` reuses the previously built VS Code
base app and rebuilds only the extension. The full 1–2 h VS Code build runs only when
the base changed.

The release rules (release cut, acceptance, approval, publish gate) are unchanged; see
[06-release-process.md](06-release-process.md). This document covers how the Mac
package is produced and which platforms a release ships.

## Two build paths

`build-mac.yml` picks one in the "Choose build path" step and writes the choice to the
job summary.

| Path | When | Time |
|---|---|---|
| repack | base key matches an Actions cache entry or a published release | minutes |
| full | base inputs changed, nothing reusable, or `full_build=true` | 1–2 h |

The **base key** (`scripts/mac-base-key.sh`) hashes the git objects of:

- the `vscodium-base` submodule pin (fork patches, `prepare_vscode.sh`, icons, upstream)
- `hypeproof-studio.env.example`
- `scripts/apply-product-overrides.sh`, `scripts/install-brand-assets.sh`, `scripts/run-build.sh`
- `scripts/stage-core-patches.sh` and `scripts/patches/core/` (Studio-owned VS Code core
  patches, such as the quit guard, staged into `vscodium-base/patches/user/`)
- `assets/brand/`
- `MAC_BASE_EPOCH` in the script: bump it by hand when a `build-mac.yml` change affects
  the base (runner image, Node pin, the env block, brew dependencies). The workflow file
  itself is not hashed, so editing release steps does not force a full build.

The key is computed from git objects, so it can be evaluated for any tag without a
checkout. That is how the repack path finds a reusable release.

### Repack

1. Base app, in this order:
   - Actions cache entry `mac-arm64-base-e<epoch>-<hash>` (unsigned output of the full
     build), restored straight into `vscodium-base/VSCode-darwin-arm64/`.
   - Otherwise the newest published release whose base key matches
     (`scripts/find-mac-base-release.sh`), downloaded from the public
     `hypeproof/hypeproof-studio` release.
2. `scripts/repack-mac.sh`: strips the old signature, checks the product.json
   checksums, builds and installs the extension with the same
   `scripts/inject-builtin-extensions.sh` the full path uses (extension, webview,
   vendored Agent SDK, version stamp), runs `scripts/stamp-mac-app.sh`, checks the
   checksums again and compares the shipped extension with the fresh build.
3. The same steps as the full path: stamp, import certificate, `sign-mac.sh`,
   `verify-branding.sh` with `REQUIRE_SDK_VENDOR=1`, zip, artifact, live-session freeze,
   draft upload, acceptance dispatch.

### Full

Unchanged, plus: npm caches through `actions/setup-node` and `npm ci`, and the unsigned
base app is saved to the Actions cache right after `run-build.sh`.

## What the repack rewrites

| Field | Value | Same as full path |
|---|---|---|
| product.json `.version` | release version | yes (`stamp-mac-app.sh`) |
| product.json `.commit` | candidate commit (`BUILD_SOURCEVERSION`) | yes |
| Info.plist `CFBundleShortVersionString` | release version | yes |
| bundled extension `package.json` `.version` | release version | yes |
| product.json `.date` | unchanged: upstream VS Code commit date, fixed per base | yes |
| Info.plist `CFBundleVersion` | unchanged: VSCodium build number, fixed per base | yes |

Changing `.version` and `.commit` also invalidates VS Code's cached extension scan, whose
key includes product version, date and commit.

### product.json checksums

`product.json` `checksums` lists 10 core files under `Resources/app/out/vs/` (workbench
bundle, its HTML/CSS, sandbox preload, extension host). Built-in extensions are not in the
list, and `out/media` (the watermark) is not either. So swapping
`extensions/hypeproof-chat` cannot trigger the "installation appears to be corrupt"
warning. `scripts/check-mac-checksums.mjs` measures this on every package: repack runs it
before and after, and `verify-branding.sh` check 12 runs it on both paths.

## Operator commands

```bash
# Normal release: unchanged. Tag or release-cut; the workflow picks repack when it can.
git tag v2026.1020.0 <sha> && git push origin v2026.1020.0

# Force the full build on a tag (base suspected bad, or to refresh the base):
gh workflow run build-mac.yml --ref v2026.1020.0 -f full_build=true

# Seed the cache for every later tag. Caches saved on a tag ref are visible to that tag
# only; caches saved on main are visible to all tags. Builds main, publishes nothing.
gh workflow run build-mac.yml --ref main -f full_build=true

# Local proof without CI (ad-hoc signing, no upload):
curl -fsSLo base.zip https://github.com/hypeproof/hypeproof-studio/releases/download/<tag>/HypeProof-Studio-darwin-arm64.zip
HPS_VERSION=2026.1020.0 REPACK_SIGN=1 bash scripts/repack-mac.sh --base base.zip --out /path/to/scratch
REQUIRE_SDK_VENDOR=1 bash scripts/verify-branding.sh "/path/to/scratch/HypeProof Studio.app"
```

`repack-mac.sh` stamps the source `extensions/hypeproof-chat/package.json`, as
`inject-builtin-extensions.sh` always has. Restore it with `git checkout` after a local run.

## Per-release Mac installer and Test Kit

Every published release, rc and stable alike, carries two more assets, made by
`scripts/release/install-kit.mjs` in the publish job of `verify-unified-release.yml` while
the release is still a draft:

| Asset | What it is |
|---|---|
| `install-mac.sh` | The one-liner at the top of the release notes. Pinned to the tag: the source commit, the SHA-256 of `HypeProof-Studio-darwin-arm64.zip`, the SDK seed tarball and the seeder are baked in. |
| `HypeProof-<tag>-Test-Kit.zip` | `INSTALL-<version>.command`, `START-<version>.command`, the same `install-mac.sh` and a Korean `READ-ME.txt` worded for the version (no participation code from 2026.1020.0). |

```bash
curl -fsSL https://github.com/hypeproof/hypeproof-studio/releases/download/<tag>/install-mac.sh | bash
curl -fsSL .../install-mac.sh | bash -s -- --system     # stable: /Applications instead
curl -fsSL .../install-mac.sh | bash -s -- --layout kit # stable: side-by-side test install
```

Why curl: the zip is ad-hoc signed and not notarized. A browser download gets
`com.apple.quarantine` and Gatekeeper refuses the app; curl adds no quarantine flag.

What the script does, in order. It writes nothing until the safety checks pass.

1. Refuses a non-arm64 Mac, root, a symlinked install or profile path, an existing
   `HypeProof Studio.app` with another bundle id, a kit folder or profile it did not make
   (`.hps-kit-<version>` marker), and a running copy of the target app.
2. Downloads the zip with curl, checks the baked SHA-256, extracts it and checks the bundle
   id and `CFBundleShortVersionString`.
3. Installs. `app` layout (stable default): `~/Applications/HypeProof Studio.app`, or
   `/Applications` with `--system` (never sudo). `kit` layout (rc default, and the Test Kit):
   `~/Applications/HypeProof-RC-<version>/` with its own profile at
   `~/Library/Application Support/HPS-<version>/` and `START-<version>.command`. The new copy
   is staged beside the old one and swapped in; the old copy is restored if the swap fails.
4. Clears quarantine on the curl path only, as `scripts/install.sh` does. The .command kit
   never changes security settings.
5. Seeds the coach SDK binary from this release's `claude-agent-sdk-darwin-arm64-<v>.tgz`
   through `scripts/seed-sdk-binary.sh --tarball`, fetched at the source commit and checked
   against its SHA-256, as Lab's open install does. A failure is a warning: Studio offers to
   fetch the seed itself on first use (REQ-M46).
6. Sends one anonymous install outcome to the Service (PRA-15, CONV-DEC-08):
   `{"result":"ok","step":"done","os":"macos","app_version":"<version>"}`, or `fail` with the
   step that was running. No id or error text, one request per run, 3 s cap, never retried,
   never changes the exit code (`curl -q` ignores `~/.curlrc`). `HPS_NO_INSTALL_PING=1` skips it. The Service route stays
   404 until `HPS_INSTALL_EVENTS=enabled`.

`START-<version>.command` keeps secrets in the macOS keychain. `--use-inmemory-secretstorage`
broke the free start on 2026-10-19 (the claim and install id are lost on the reload, a second
claim mints a new seat). `HPS_KIT_INMEMORY_SECRETS=1` turns it on explicitly.

`check-unified-release.mjs` and the acceptance receipt leave `HypeProof-v*-Test-Kit.zip` out
of the accepted packages (`isAppPackage` in `e2e/unified-release/artifact.mjs`), so the kit
added after acceptance does not read as a changed artifact set. `mirror-release.yml` copies
both assets with `dist/*` and adds the public one-liner to the mirror notes.

Releases published before this change have no `install-mac.sh`. Backfill one by hand:

```bash
node scripts/release/install-kit.mjs render --tag <tag> --source-sha <tag commit> \
  --zip-sha256 <zip sha256 from unified-acceptance.json> \
  --seed-name claude-agent-sdk-darwin-arm64-<v>.tgz --seed-sha256 <from the .sha256 asset> \
  --seeder-sha256 "$(git show <tag commit>:scripts/seed-sdk-binary.sh | shasum -a 256 | cut -d' ' -f1)" \
  --out /path/to/scratch
gh release upload <tag> /path/to/scratch/* --repo hypeproof/hypeproof-studio
```

Controls: `node --test scripts/release/test/install-kit.test.mjs` (baked values, wrong-sha
abort, layouts, refusals, the install outcome ping against a local stub and shellcheck; the install runs need macOS and use a scratch HOME).

## Release platforms

`config/release-platforms.json` lists the platforms a release ships. It is read at the
release's own commit by `scripts/release/platforms.mjs`:

- release-cut dispatches only the configured builders
- `verify-unified-release.yml` waits for, tests and requires only the configured packages
- `check-unified-release.mjs` requires exactly one receipt per configured platform
- `mirror-release.yml` waits only for the configured packages

A commit without the file, or one git cannot read, requires both platforms. Every release
before 2026-10-19 therefore keeps its original two-platform gate.

`build-windows.yml` no longer runs on a tag push. It stays dispatchable:

```bash
gh workflow run build-windows.yml --ref <tag>    # attach Windows packages to that tag's draft
gh workflow run build-windows.yml --ref main     # workflow artifact only
```

A Windows package attached to a Mac-only release is not part of its acceptance gate.
Uploaded after the Mac acceptance ran, it changes the release's asset set, so the Mac
receipt no longer matches and publication is refused. Uploaded before, it would ship
without Windows acceptance. Add `win32-x64` to the config before cutting instead.

### What Windows users see during Mac-only releases

- In-app updater: the mirror's latest release has no Windows installer, so
  `parseLatestRelease` reports no update. No banner, no error; they stay on their version.
- `install-win.ps1`, `install.ps1` and `make-class-kit.sh` without a pinned version
  install the newest published release that has a Windows installer (PRA-09). When
  `/releases/latest` has one they use it; otherwise they list the releases and skip
  drafts, prereleases and macOS-only releases. A pinned version installs exactly that
  release and fails if it has no Windows installer.
- Lab `/api/download/win`, the paid-order Windows download and the `/studio/install/kit`
  Windows kit fall back the same way (hypeprooflab `fix/studio-win-fallback-20261019`).
  The Mac download and kit stay on the latest release: mirror-release still attaches
  `install.sh` and `seed-sdk-binary.sh` to every release.
- A Windows kit needs the installer plus `install.ps1` and `seed-sdk-binary.ps1` on the
  same release, so the Lab kit falls back to the newest release that has all three.
