# hype-align ledger contract

The rules `scripts/align.py` applies. Anything not stated here is decided by the canonical
`scripts/work-discovery/discover.py` (spec: `docs/WORK-DISCOVERY.ko.md`).

Contents: 1 Inputs · 2 next · 3 Requirement rows · 4 record (row pins) · 5 check · 6 drift

## 1. Inputs

| Input | Where | Notes |
|---|---|---|
| Ledger | `<studio>/config/requirement-work.json` | loaded with `discover.load_manifest` |
| Integrity | `discover.audit` | missing/changed documents, unassigned IDs, cycles |
| States | `discover.classify` | ready, claimed, in_review, dependency, blocked, reconcile, complete |
| Completion | `discover.fulfilled`, `discover.scope_digest`, `discover.row_digest` | the only definition of complete |
| Test documents | each document's registered `test` path | the only files that define test IDs (§3) |
| Testing mentions | `<studio>/docs/testing/**/*.md` | minus every completion `report` and the report being recorded |
| Lab catalog | `<lab>/web/scripts/lib/studio_catalog.mjs` | `catalogSources`, `excludedSources` |
| Lab features | `<lab>/web/src/content/private/studio-prd/{features.ts,work.json,catalog.json}` | |

Files are read from the working tree, not from a commit. Use a clean worktree.

## 2. next

1. `discover.audit` runs first. Any gap makes the verdict "reconcile the requirement ledger
   first" and the exit code 1; the ranking is still printed as advice.
2. States come from `discover.classify` with a GitHub snapshot:
   - default: offline. Every tracked issue is treated as open, with no PRs and no claims.
     The output says `availability: unchecked`.
   - `--snapshot FILE`: a snapshot saved by `discover.py --save-snapshot` (max age 1 h).
   - `--live`: `discover.live_snapshot` through `gh`.
3. Scope filters (`--item`, `--doc`, `--prefix`) apply after classification, so a dependency
   outside the scope still blocks an item inside it.
4. Ready items sort by this key, smallest first:

   | Order | Key | Source |
   |---|---|---|
   | 1 | priority | best `P<n>` among the requirement rows the item cites; none sorts last |
   | 2 | curriculum week | item field `curriculum_week` (an integer, a `W<n>` / `Week <n>` / `<n>주차` string, or a non-empty list of them; any other value, an empty list included, is exit 2 naming the item), else the earliest row week tag; none sorts last |
   | 3 | unblocks, descending | unfinished items anywhere in the ledger that depend on it, directly or transitively |
   | 4 | ledger order | position in `work_items` |

   The first item is `next`; the whole list is `ranked`. Dependency depth is not a key: every
   dependency of a ready item is complete, so depth would only rank an item whose prerequisites
   finished behind every root, whatever its priority. Dependencies act through `ready` itself and
   through the unblocks tie-break.
5. An in-scope item that carries a PASS `completion` discover.py no longer accepts is **reopened**:
   it was complete, and a pinned file, its scope or its attestation changed since. That holds in any
   state; with `--live` or `--snapshot` it is usually `reconcile`, because the merged slice closed its
   issue. Reopened items are listed in `reopened`, not `ranked`, with `reopened: true`, `changed` (the
   pinned files that no longer match as `path`, and the pinned rows as `path:ID`, suffixed
   ` (row removed)` when no row defines the ID any more), `waiting_on` (its dependencies that are not complete),
   `actionable` (state `ready` or `reconcile` and nothing to wait on) and a `reason` that says what to
   do. They sort actionable first, then by the ranking key. `next` is the first actionable reopened
   item, else the first ranked ready item, because `record` refuses the dependents of a reopened item.
   The text output prints `REOPENED` in place of the packet `next_action`, which describes the
   original work. Ranked entries have `reopened: false` and `changed: []`.
6. Every other in-scope item is in `items` with its `state` and discover.py's `reason`, ordered
   reconcile, in_review, claimed, blocked, dependency, complete; the text output lists all but the
   complete ones under `Not ready`. A `reconcile` item whose issue the snapshot shows closed and that
   has no completion gets the reason "closed without a completion: if its PR merged, verify the
   delivered work and run record". With no `next`, the verdict names the first reconcile item, else
   the first reopened one; with a `next`, it appends `also reconcile <items>`.
7. `--json` adds `availability_checked` (false offline, where a closed issue without a completion
   still ranks as ready; the text `NEXT` block then says to confirm the issue). A refusal or exit 2
   prints `{"command", "verdict", "error", "exit_code"}`.

## 3. Requirement rows

A requirement row is a Markdown table line whose first cell is the ID, the same shape
`discover.requirement_ids` accepts (`| CR-01 | ... |`, optional backticks). Heading-style
(`### VO-01`) and inline IDs have no row, so no priority, week or cited test.

- **Priority**: the first cell that starts with `P0`..`P9` (not `P0-5`). Examples that parse:
  `| P0 |`, `| P0 / INT-CR-01 |`, `| P1 / W2 / INT-CR-03 |`.
- **Week tag**: in that priority cell, `W<n>`, `Week <n>` or `<n>주차`; or a cell that holds
  only week tags (`| W1 |`, `| Week 2 |`, `| W1–W2 |`). Free text elsewhere is ignored, so
  an acceptance sentence quoting "3주차" does not tag the row. The earliest week wins.
- **Cited tests**: every `-T<n>` token in the row's cells.

### Test-ID grammar

`PREFIX-T<n>` with shorthand continuations that expand with the same prefix and width:
`CA-T16/17` → CA-T16, CA-T17 · `SX-T02·03` → SX-T02, SX-T03 · `SX-T52~57` or `..` or `–` → the range.
Commas do not continue a list. A token must not be preceded by a letter, digit or hyphen,
so `INT-ACCESS-01` is not `SS-01`. Requirement-ID mentions expand the same way (`AE-01/02`).

A test ID is **defined** when a registered test document (`documents[].test`) contains it as a
`-T<n>` token or as the first cell of a table row. The first cell counts in two cases: the
document has no `-T<n>` tokens at all, so it keys its tests by requirement ID (Studio
`chalk-mvp`); or the cell is not a registered requirement ID (own test IDs such as `AT-01`). In a
document with `-T<n>` tests, a row keyed by a requirement ID is a coverage row
(`| CR-01 | CR-T01 |`), not a test. A registered test document that is itself a requirement
document defines only `-T<n>` tokens. Nothing else defines a test: an evidence report, even one
under `docs/testing/`, cannot define the test IDs it attests.

A test **belongs to** a requirement when the requirement's row cites it, when the test is keyed by
that requirement ID, or when a registered test document ties them:
- in a table whose header has a target column (a cell matching `target`, `requirement`, `REQ`,
  `요구`, or starting with `대상`: `Targets`, `제품 REQ`, `연결 요구사항`, `대상 SX`), the test's row
  names the requirement in such a column; an ID named in passing in another cell does not count;
- elsewhere (prose, or a table without a target column), one line names both, unless that line
  expands a test range and another ID range at once (`US-01~18 → US-T01~21`), which would pair every
  test with every requirement.

A requirement has a **test link** when its row cites a test, or:
- its registered test document (when it is a different file) names the requirement, or
- a `docs/testing/` document that is not an evidence report names it and the ID's prefix belongs to
  one registered document, or
- its tests live in the requirement document itself and a line other than its own row names
  both the requirement and a `-T<n>` test.

An evidence report is any completion's `report` plus the report `record` is writing.

## 4. record

`record <item>` writes `work_items[i].completion` and, with `--input`, extends
`verification_inputs` (it never removes one; narrowing the inputs is a hand edit to the ledger).
Nothing else in the ledger changes. The file is rewritten as
`json.dumps(indent=2, ensure_ascii=False)` plus a newline, which is the ledger's own format.

```json
"completion": {
  "verdict": "PASS",
  "reviewed_by": "independent verifier",
  "report": "docs/evidence/cr-browser.md",
  "scope_sha256": "<discover.scope_digest of the packet as recorded>",
  "inputs": {"<verification input>": "<sha256>", "<report>": "<sha256>"},
  "rows": {"docs/requirements/curriculum-runtime.md": {"CR-04": "<row digest>", "CR-05": "<row digest>"},
           "docs/testing/curriculum-runtime.md": {"CR-T04": "<row digest>", "CR-T05": "<row digest>"}},
  "commit": "<full 40-character SHA of the merge commit on main>",
  "test_ids": ["CR-T04", "CR-T05"],
  "recorded_at": "2026-09-29T08:00:00Z",
  "pr": 1402
}
```

`verdict`, `reviewed_by`, `report`, `scope_sha256`, `inputs` and `rows` are what
`discover.fulfilled` judges, together with `test_ids`, whose tests must each have a row pin.
`commit`, `recorded_at` and optional `pr` are provenance for people and for `check`; discover.py
ignores them.

After writing (not with `--dry-run`), `record` moves the item's issue to Done on the project
boards: the Harness `scripts/board/board.py set <issue URL> --state done`, run through
`with-agent-identity.sh` (harness#397). A ledger outside the `hypeproof` org has no board and is
skipped. A board failure is a warning in the output and the payload's `board`; the record stands.

### Row pins

`rows` maps a document to `{ID: digest}` (`discover.row_digest`), so an edit to another row of the
same document does not reopen the completion:

| Pinned | In | Its rows |
|---|---|---|
| each cited requirement ID | its requirement document | every table line whose first cell starts with the ID (`\| CR-01 \|`, ``\| `CR-01` \|``, `\| G1-T1 표 밀도 \|`) or names it in the §3 shorthand (`\| AE-T20/21 \|`, `\| SX-T52~57 \|`), each read together with its table's header line, and every `###` heading that starts with the ID together with its lines up to the next heading of level 3 or above outside a code fence; once one of those defines the ID, also every paragraph and list item that amends it (below). A fence is read as CommonMark reads one outside a list item: three or more backticks or tildes indented at most three columns (for backticks, an info string without a backtick), closed by the same character, at least as many, alone on its line and indented at most three columns |
| each `--tests` ID | every registered test document where such a row or section defines it; when none does, every registered test document that defines it (§3) | the same |

These are the rows a pin covers. §3's requirement row is narrower and only feeds priority, week
and cited tests. A first cell is read for its leading ID and that ID's shorthand only: a second ID
written in full (`| LT-02 / LT-01 후 |`, "after LT-01") is not defined by the row.

A table whose header repeats its first column's name packs several IDs into a line
(`| ID | 상태 | ID | 상태 |`). Each repeat of that name starts a column group that runs to the next;
the first cell of every group is read as a first cell, and the pin holds only its ID's group of the
line and of the header. Another ID's cells on the same line are not in the pin. The ID's own cells,
a status among them, are, so changing that status reopens the completion like any cited-row edit.

Prose that amends a defined ID is part of its pin. A requirement document often amends rows outside
the table (`- DES-02/03/06: maintain at least eight complete rows at 1280×720`, `AE-01/02/36/41은 …`).
Once a row or `###` section defines an ID in a document, every paragraph and list item there that has
a line starting with the ID is pinned with it, whole. The line starts with the ID when, after its
indentation, a list marker (`-`, `*`, `+`, `1.`) and an opening emphasis (`**`), its text starts the
way a first cell does: the ID, or the §3 shorthand that names it. A paragraph is a run of non-blank
lines. A list item runs from its marker through the lines that continue it and the items nested
deeper in it. Either ends at a blank line, a heading, a table or a code fence; a paragraph also ends
at any list item, and a list item at one that is not nested deeper in it. Neither is read inside a
code fence. Prose inside the ID's own `###` section is pinned with that section once. Prose never
defines an ID on its own: an ID that only prose names keeps the null pin below.

What a pin does not cover:
- text that amends a cited row in a paragraph or list item where no line starts with the ID. This
  covers a statement that names no ID ("takes precedence over the rows below", "every row in
  section E"); an ID inside a label or after other words (`- **공통 동선(DES-01/04):** …`,
  `… and CR-10, CR-12`); a second ID written in full after the first (`T-07/T-08`,
  `AE-T19~21/25, AE-T27~33`); and a block quote. An edit there leaves the completion complete.
  Write an amendment with its IDs first, or in the row itself, and the pin covers it;
- a code fence inside a list item, and a later paragraph of the item after a blank line (unless a
  line of that paragraph starts with the ID): the item's pinned part ends at the fence or the blank
  line;
- a section a cited row links to (`](#anchor)`): the link is pinned, the linked section is not, so
  an edit there leaves the completion complete;
- a second definition of a pinned test, added after `record` in another registered test document: a
  test is pinned only in the documents that defined it when `record` ran;
- the indentation of code in a fence nested in a list item and indented four columns or more:
  CommonMark measures that fence from the list item and the pin from the margin, so its lines are
  read as text, whitespace collapsed.

The digest is SHA-256 over those rows in document order after normalization: table cells are
trimmed with their inner whitespace collapsed (an escaped `\|` stays in its cell), a line inside a
code fence keeps its indentation and spacing (trailing whitespace aside), other lines have their
whitespace collapsed, and blank lines are dropped. Re-aligning a table or changing the spaces within
a line of text is not a change. Editing a cell, the header, the section text, an amending paragraph
or list item, or the indentation of code in them is a change. So are moving a line break inside a
pinned section or amendment, deleting the row, and adding or removing an amendment.

An ID that no row or section defines (an inline ID such as `NAT-01` in a prose cell, or a test named
only in prose) gets the pin `null` and its document is pinned whole in `inputs`. `record` prints a
note naming those IDs and returns them in `whole_document_pins`.

A completion with `rows` holds while: every cited requirement has a pin in its document; every
`test_ids` entry has a pin other than one of the item's requirement pins (a test keyed by its
requirement ID is pinned in its test document); every non-null pin reads the same now; every
document with a null pin is in `inputs`; and `inputs` holds the verification inputs and the report,
all unchanged. A completion without `rows` was recorded before row pins: its `inputs` must hold every
cited requirement document, unchanged, exactly as before, until it is re-recorded with `--replace`.

A discover.py from before row pins reads every completion with `rows` as not complete, because it
wants each cited requirement document in `inputs`. That fails closed, and `align.py` refuses such a
discover.py (exit 2), but other readers do not: the product's `next-work.py` runs the discover.py of
whichever `HYPEPROOF_HARNESS` or sibling Harness checkout it finds, and a Harness mirror that a tool
reads may lag main. Update those checkouts to a Harness with row pins before the first completion
with `rows` is recorded in a ledger, or they show recorded items as not complete.

What `commit` guarantees at record time: it is on HEAD and `origin/main`, its ledger registers
the work item, every pinned file except the report is byte-identical there and at HEAD, and every
pinned row reads the same there, at HEAD and in the working tree, so the commit holds the content
the pins describe. It is the slice's squash commit, or a later main commit when a pinned file or row
changed after the squash; an edit to other rows of a cited document after the squash does not
disqualify it. `implementation_paths` are not pinned, so the commit does not vouch for their content.

Refusals (exit 1, nothing written):

| Condition | Why |
|---|---|
| `--tests` empty, or a test ID not defined (§3) | no test result, no completion |
| a test that belongs to none of the item's cited requirements (§3) | the completion must rest on this packet's tests |
| `--evidence` missing, not a file, outside the checkout, the ledger itself, a registered test or requirement document, or one of the item's verification inputs | the report must be pinned, travel with the repo, not define its own tests, and not stand in for a file that must match HEAD |
| `--reviewed-by` empty | discover.py requires an attesting reviewer |
| `--commit` not 7–40 hex, the checkout not a git work tree, the commit unknown, or not an ancestor of HEAD and (when the ref exists) `origin/main` | the record must point at the merged revision, not a PR branch head; it is stored as the full SHA |
| `--commit` whose ledger has no such work item, where a pinned file other than the report differs from HEAD, or where a pinned row reads differently | a commit from before the item, or one that lacks the content the pins describe, is not the delivery |
| item already complete without `--replace` | a verdict is superseded deliberately, not by accident |
| `--replace` with a report whose hash equals the superseded completion's report, whatever the commit or path, or a report that names no 7+ character prefix of the new `--commit` | nothing new was verified: a replacing completion rests on a new run against that commit |
| item has a `gate`, or a `depends_on` item that is not complete | a completion must not jump a human gate or an open prerequisite |
| no `verification_inputs` after `--input`, or the ledger among them | discover.py never counts a requirement-only completion; `record` rewrites the ledger, so pinning it breaks at once |
| a verification input that is a registered requirement document, or a test document where the completion pins test rows | the rows are pinned already; pinned whole as a file, the document would reopen the completion on an edit to any other row. Narrow `verification_inputs` (a hand edit) to the slice's implementation and test files |
| a pinned file or a document holding pinned rows not tracked by git, a pinned file other than the report differing from HEAD, a pinned row differing from HEAD, or a report with unstaged changes | the pins must describe committed content every checkout has; a new or edited report may differ from HEAD only when staged, and ships with the ledger edit |
| any `discover.audit` gap | a completion on a ledger that fails the product's own gate is not a verdict |
| discover.py would not classify the result complete | the record would be dead on arrival |
| any broken link from §5 for this item (Lab excluded) | `record` never writes what `check` rejects |

Notes and warnings (still written):
- the report differs from HEAD (new, or a staged edit): commit it with the ledger edit;
- a cited requirement or test that no row or section defines: its document is pinned whole (JSON
  `whole_document_pins`), so any edit to that document reopens the completion;
- a pinned file (a verification input, the report, or a document pinned whole) that another work
  item also pins as a file (its `verification_inputs`, completion inputs or report). An edit to that
  file for the other item reopens this completion; see SKILL.md, "Reopened completions";
- a report that `origin/main` (or HEAD without it) lacks, on a path hype-pr reads as new criteria
  (`scripts/hype-pr/preparation.py`: an added `.md` with a path segment `intent`, `requirement(s)`,
  `design(s)`, `testing` or `validation` followed by `/`, `-`, `_` or `.`): hype-pr blocks the PR
  until `config/traceability.json` registers it. JSON `report_needs_trace_node: true`.

## 5. check

`discover.audit` runs first. Any gap is printed as `GAP:` and fails the check whatever the
scope, as it fails the product's `next-work.py --check` gate; the verdict starts with
"reconcile the requirement ledger first".

Broken links (exit 1):

| Kind | Meaning |
|---|---|
| `requirement-doc` | a cited path is not a registered document or does not exist |
| `requirement` | a cited ID is not defined in its document (`discover.requirement_ids`) |
| `intent` / `design` / `test-doc` | the document's registered intent, design or test file is missing |
| `test-id` | a row cites a test ID that no testing document defines |
| `test-link` | none of the item's requirements has a test link, and no completion test IDs |
| `completion` | a completion lacks test IDs, cites an undefined test or one that belongs to none of the item's requirements, lost its evidence, or no longer holds under `discover.fulfilled` (the detail names the pinned files and rows, as in `next` `changed`, that no longer match) |
| `implementation` | an item with a completion has no `implementation_paths`, or one does not exist |
| `lab` | with `--lab`: neither `work.json` (the item id, or its issue number when no other ledger item shares it) nor `features.ts` (document slug plus one of its IDs, or the whole document) links the item |
| `lab-feature` | with `--lab`: an item `feature_ids` entry is not a feature in `features.ts` |

Warnings (exit unaffected): `untested-requirement` for each cited requirement without a
test link, when the item as a whole still has one.

## 6. drift

Compares, on disk:

- Lab `catalogSources` (paths from the `path:` template, default `docs/requirements/<slug>.md`)
  and `excludedSources`,
- Studio `docs/requirements/**/*.md` (recursive, as the Lab sync script lists it),
- the ledger's `documents` and `excluded`.

| Finding | Meaning |
|---|---|
| `unclassified` | a Studio document the Lab neither lists nor excludes; the detail says whether the ledger registers or excludes it |
| `removed` | the Lab lists or excludes a document Studio no longer has |
| `classification` | the Lab and the ledger disagree: one shows what the other excludes |
| `stale` | a pinned Lab `catalog.json` source differs from the Studio file: document, evidence, excluded document, or plan (added, removed, changed) |

Hashes follow the Lab sync script: SHA-256 of the file text after JavaScript `trim()`.
A different `sourceCommit` alone is not drift; the pin line reports how many commits
behind it is when the checkout knows that commit.
