# Studio / Service integration checks

This lane preserves the former `worker/test` checks that exercise Studio code,
read Studio requirements, or contain App assertions alongside Service assertions.
The original commands and source hashes are recorded in `manifest.json`. Its
inventory is not a test result.

Service implementations, harnesses, regression fixtures and deployment templates
come from the version-pinned public `@hypeproof/service-testkit` release. Tests
resolve these inputs through package exports; a local `worker/` checkout or a
sibling Service checkout is not required. App code still comes from this Studio
checkout. `e2e/classroom/service-fixture.mjs` injects the real App snapshot and
collection freezers into the Service harness.

Behavioral checks retain their positive and negative controls. In particular:

- `measurement-core.test.mjs` runs the captured accepted/rejected cases through
  the actual App, public core and Service paths and compares their verdicts.
- `browser-contract.test.mjs` compares the App's real tool names with Service
  prompts and exercises unavailable-browser and minor-cohort denials.
- `classroom-ops-snapshot-device.test.mjs` runs the App's actual freezer/uploader
  against Service SQLite/R2 routes. It checks receipt verification, allowlisted
  files, immutable offline resumes, changed revisions, foreign identities and
  withdrawn consent.
- `quest-result-contract.test.mjs` exercises the App result sanitizer against
  the Service's real quest skeletons and negative controls.

The remaining regression, requirement-registry and historical documentation
checks are retained for their original purposes. A historical documentation
verdict still uses its pinned Git commit when available and reports current-tree
deviations separately; it does not claim that a historical map describes the
current Service layout. `cr-recon.test.mjs` can regenerate its frozen control
inputs under this directory when deliberately invoked with `HPS_CR_RECON_FREEZE=1`.

Run the root `npm run test:service-integration` command for the focused requirement
lane, or `npm run test:service-integration -- --all` for the complete preserved
inventory. Individual commands may be run directly with Node's
`--experimental-strip-types`; a passing focused result does not establish that
unexecuted inventory entries passed.
