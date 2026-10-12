# Private organization release access

Owner decision: 2026-10-10, hypeproof/hypeproof-harness#287; implementation #1584.
The source and release repositories remain private on GitHub Free. Installers
and update checks are available to members with repository read access.

## Requirements

| ID | Acceptance |
|---|---|
| PRA-01 | Resolve release metadata and assets with the member GitHub CLI login or explicit GH_TOKEN/GITHUB_TOKEN. The updater and app-only installers also accept HPS_RELEASE_TOKEN. Never embed or persist shared credentials. |
| PRA-02 | Authenticate only the exact organization release API. Updater asset redirects receive no Authorization header and must target a known GitHub asset host. |
| PRA-03 | Preserve updater byte count, SHA-256, timeout, partial-file cleanup and existing-file guards. Missing credentials/digest and denied API access fail explicitly. |
| PRA-04 | Private source and SDK seed scripts use the member GitHub CLI login; custom script mirrors receive no repository credential. |
| PRA-05 | Windows/macOS bootstrap scripts require GitHub CLI and verify SHA-256 before installing. Preserve platform restrictions. |
| PRA-06 | The requirement workflow supplies a Contents-read credential to the private Harness checkout without widening its normal workflow token. |
| PRA-07 | Service development packages and deployment source remain private. Authenticate immutable release acquisition with existing Contents-read access, verify SHA-256 before installing, and stage artifacts only in ignored local/CI cache. No Service package tarball or source snapshot is committed to Studio or copied into Studio releases. Bundled packages preserve canonical implementation bytes and existing authorization behavior. |

## Validation

The update checker, transport, orchestration, runtime and installer smoke suites
exercise success and negative controls. Transport controls cover foreign origins,
foreign redirects, stripped CDN credentials, corrupt/truncated bytes and timeouts.
The Windows workflow runs the installer fixture on PowerShell 5.1 with successful
login, denied API access, bad digest and unsafe filename scenarios.

A live authenticated release download with SHA-256 verification is distinct from
launching a rebuilt app. Source merge and installer publication do not claim that
existing release binaries contain the new updater. A new release must be built
and pass the existing release gates before the updated app is distributed.

PRA-07 controls: `npm run test:private-service-packages`, preserved App/Service
measurement checks, and Chalk instructor authorization checks. The bootstrap
uses `config/service-packages.json` and the existing `HYPEPROOF_READ_TOKEN`;
missing access or changed bytes block acquisition. A successful staged local
install is separate from authenticated remote CI access and runtime publication.
