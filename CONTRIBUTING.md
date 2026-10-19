# Contributing

The full contributor guide is **[DEV-GUIDE.md](./DEV-GUIDE.md)** — bilingual
(KR/EN), written to be run by Claude Code. Tell Claude Code *"follow
DEV-GUIDE.md"* and it executes the lifecycle through pre-built harness
(`scripts/setup.sh`, `/report-ui`, `/hype-open-pr`, the issue/PR
templates).

Quick map:

| You want to… | Go to |
|---|---|
| Set up to develop | DEV-GUIDE §1 (`bash scripts/setup.sh`) |
| Understand keys / providers | DEV-GUIDE §2 |
| Build the app | DEV-GUIDE §3 |
| Run tests | DEV-GUIDE §4 |
| Report something you noticed | DEV-GUIDE §5 (`/report-ui`) |
| Land a code change | DEV-GUIDE §6 (`/hype-open-pr` skill) |
| Run several issues in parallel | DEV-GUIDE §7 (`claude -w`) |

Before any `npm ci`: use Node 22.22.1, run `gh auth login` with an account that
can read the private `hypeproof/hypeproof-service`, then run
`npm run bootstrap:service`. Without that step `npm ci` ends in `ENOENT` on a
`.private-service-cache/*.tgz` path and does not say why. `scripts/setup.sh`
runs the same steps; the full order is in [AGENTS.md](./AGENTS.md#install-order).

No terminal? File issues via the web forms
([feature](.github/ISSUE_TEMPLATE/feature_request.yml) ·
[ux](.github/ISSUE_TEMPLATE/ux_suggestion.yml) ·
[bug](.github/ISSUE_TEMPLATE/bug_report.yml)). Team: [CONTRIBUTORS.md](./CONTRIBUTORS.md).
Policy and rules live in [CLAUDE.md](./CLAUDE.md) and
[.claude/rules/](.claude/rules/).

Every PR fills the template's **Release check** section: how the release manager
verifies the change (where → what to click or run → expected result) and whether
it needs a release smoke check. The weekly release checklist is built from it.
The contract is [config/pr-body-contract.json](config/pr-body-contract.json).
