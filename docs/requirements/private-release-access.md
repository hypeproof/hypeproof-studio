# Private organization release access

Owner decision: 2026-10-10, hypeproof/hypeproof-harness#287; implementation #1584.
The source and release repositories remain private on GitHub Free. Installers
and update checks are available to members with repository read access.

## Requirements

- Resolve the latest release and download assets using the member's existing
  GitHub CLI login or explicit `HPS_RELEASE_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.
  Never embed or persist a shared credential in the app or installer.
- Authenticate only the exact organization release API. An asset redirect may
  receive no Authorization header and must target a known GitHub asset host.
- Keep byte count, SHA-256, timeout, partial-file cleanup and existing-file guards.
  Missing credentials, missing digest, or a denied API response fail explicitly.
- Windows and macOS bootstrap scripts require GitHub CLI and verify SHA-256
  before launching or installing. Preserve the existing platform restrictions.
- The private cross-repository requirement workflow passes a Contents-read token
  to the Harness checkout; it does not widen the normal workflow token.

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
