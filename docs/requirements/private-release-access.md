# Private organization release access

Owner decision: 2026-10-10, hypeproof/hypeproof-harness#287; implementation #1584.
The source and release repositories remain private on GitHub Free. Installers
and update checks are available to members with repository read access.
People outside the organization install from a class kit (PRA-08, #1617).

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
| PRA-08 | A person outside the organization installs from a class kit: the release's archive, `install.sh` or `install.ps1` and SDK seeder in one folder with `kit-info.txt` and `SHA256SUMS` (`install.sh --kit`, `install.ps1 -KitDir`). Every kit file is checked against `SHA256SUMS` before use; kit mode makes no GitHub call and asks for no login; dependency installs, app copy, SDK seed and doctor are the member steps. A kit comes from `scripts/make-class-kit.sh` (instructor hand-off) or from the Lab site's participation-code install, which checks the code with the Service and assembles the kit from release assets. `mirror-release` attaches the tag's installers and seeders to every release for that purpose. `SHA256SUMS` detects damage; it does not authenticate who handed the folder over. |
| PRA-09 | The Windows installer (`install.ps1`) accepts Git Bash in any install scope as the POSIX shell: Program Files, `%LOCALAPPDATA%\Programs\Git` (winget user scope, which the installer requests first) or the Git root of the `git.exe` on PATH. A user-scope Git therefore never reaches the WSL install offer. WSL counts only when `wsl -l -q` exits 0 and lists a distribution; the inbox `wsl.exe` stub alone does not pass the doctor. `C:\Windows\System32\bash.exe` (the WSL launcher) is never treated as Git Bash. Trial diagnosis I11. |

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

PRA-08 controls: `scripts/test-installer-kit.sh` (macOS: kit built and installed
without GitHub, damaged kits refused) and `scripts/tests/install-kit-fixture.ps1`
(Windows PowerShell 5.1 job: kit functions, a failed setup refused, the seeder's
output kept off the return value, old optional tools reported). The Lab
participation-code bootstrap is covered on the Lab side.

PRA-09 controls: `scripts/tests/install-posix-shell.Tests.ps1` (Pester 5, mocked
paths, functions loaded from `install.ps1` itself): machine-scope and user-scope
Git, a custom Git root from PATH and a WSL distro pass; no Git with only the
`wsl.exe` stub fails the doctor and still reaches the WSL offer; the System32 WSL
launcher is not Git Bash. Against the previous implementation the user-scope and
stub cases fail, which is the negative control. Whether winget's user-scope
`Git.Git` actually lands in `%LOCALAPPDATA%\Programs\Git` is observed only by the
manual `winget-git-user-scope` job in `private-installers.yml` on a Windows runner.
