## CGP-ART-R-004 / CGP-ART-D-004: 이 부분 고치기 in the Chalk plan view (2026-11-13)

Jay approved building it on 2026-11-13. It is an extension of the authoring assistant (CGP-AGENT-R-014), and the approval allows one new Haiku prompt, for this scope only, under these constraints:
- the same `HPS_AUTHORING_ASSISTANT` flag;
- the same US$0.20 per instructor per KST day cap;
- metadata-only logs;
- the Service, not the model, splices the result back, so every byte outside the section stays unchanged;
- a Chalk plan view with 이 부분 고치기.

The Service half is hypeproof-service#433 (not merged, not deployed). Confirmed by Jay: yes (2026-11-13) for the approved scope and constraints above. Confirmed by Jay: no for the agent-selected choices below.

- **Generator (agent choice, from the plan).** `chalk-plan/1` files are written by Studio instructor mode through the Chalk tools. Neither hps-authoring-batch nor the assistant route writes them. The assistant's existing prompt and key allow-list cover SessionDesign keys only, and its draft projection drops `plan_ref`. So the section revision is a second task beside it: its own prompt, a `{section_html}` output and the chalk-plan validator. It reuses the assistant's flag, price revision, cap, charge ledger, client and log line.
- **Anchor (agent choice).** The anchor is `{file, section, marker?:{name,value}}`: a whole section, or an element inside it whose marker value is unique in that section.
  - Cell markers (`data-chalk-field`, `-role`, `-requires`, `-forbids`, `-derived-from`) are not addressable, because their values repeat by design.
  - The Service locates the element in the stored file with the parser's tokenizer. Chalk uses the same uniqueness rule, so it only offers what the Service will accept.
- **Save, not proposal (agent choice).** Unlike CH-10, the result is saved as the next draft revision through the PUT /plan save. Reasons:
  - The existing FB-01 compare is `GET /diff` between saved revisions.
  - The FB-05 link (`chalk_feedback_revisions`) needs a revision.
  - Saving server-side keeps the byte-identical splice from passing back through the browser.

  A draft is never what learners get: freeze, rehearsal and confirmation still gate that.
- **What the Service refuses (agent choice).** With 422 and nothing stored:
  - a shape change;
  - anything PUT /plan refuses;
  - an element or attribute outside a fixed allowlist that the stored section does not already have with the same value. Style and script elements, and loading or form elements, are never allowed; a style or event attribute is allowed only when it is unchanged;
  - a link or resource, or a `data-chalk-requires` tool, that the selected section does not already carry (the rest of the plan does not count);
  - a dropped, unlinked or changed prohibited move, risk or consent item (`data-chalk-move`, `-risk`, `-consent`), a removed `data-chalk-forbids` word, or a lowered `data-chalk-safety`. These are matched by element identity (the element's own markers when unique, else its position), so moving one to another element counts as a removal;
  - any parser finding (warn or fail) that the stored plan did not already have;
  - markup that a browser could read differently from the plan tokenizer (round 2 of the verification). This also applies to every PUT /plan. It covers abrupt or `--!>` comments, CDATA, a quoted value containing `<` or `>`, an unquoted value with quotes or a backtick, a `<` that does not start a well-formed tag, duplicate attributes and NUL. Round 3 adds three more. Inside a tag, only space, tab, LF and CR count as whitespace, so a form feed is refused. `textarea`, `template`, `svg` and `math` are refused anywhere, because foreign content and raw text are read differently. `style` and `title` are allowed only in the document head, with no `<` in their text. Five of the six plan fixtures and the derived handout and runbook use a head `<style>` or `<title>`, so refusing those outright would refuse real plans. The Service's own lesson and ops skeletons still save. Round 4 adds CSS. In a head `<style>` and in `style` attributes, the Service refuses every way CSS can load a resource other than `url(data:image…)`: `image-set()` (with or without a vendor prefix), `image()`, `cross-fade()`, `element()`, `src()`, `@import` and `@font-face`. Matching is case-insensitive and happens after CSS escapes and HTML entities are decoded and comments are dropped. A leading `<!DOCTYPE html>` and spec-valid comments still pass. The Service's own skeleton is full of guide comments, so refusing every comment would break real plans. A revision may keep a comment the section already has but may add none, and it may not add a second element carrying the selected marker.

  The FB-05 feedback, anchor and revision link are written in the save's own batch, so a save that loses the revision race leaves none of them. This was tightened after an independent verification found that the first version accepted dropped moves, styles, tools named elsewhere in the plan and moved prohibitions.

  Parser findings are all `warn` today (FB-03), so "no new failure" alone would have refused nothing.
- **History (agent choice).** The new table `chalk_feedback_anchors` (migration 0085) holds the anchor next to the existing `chalk_feedback` row. No column was added to an applied table.
- **Hover (agent adaptation of DES-ART-04).** The design row says hovering shows the outline and the button. Chalk's shipped lock REQ-CHALK-ROW-ACTIONS (CGP-DS-R-021, `chalk/test/row-actions.test.mjs`) forbids hover-revealed actions and mouse or pointer hover handlers on every Chalk page. So:
  - the pointer outline is CSS `:hover` on the innermost mark;
  - 이 부분 고치기 follows focus, which a click, a tap or Tab all give;
  - keyboard focus shows both the outline and the button, and Enter opens the composer, as the row asks.

  Showing the button on hover alone would need that lock changed. That is a design-system decision, not made here.
- **Rendering (agent choice).** The plan is parsed with `DOMParser`, rebuilt from a closed tag list, and keeps only `data-chalk-*` attributes. It is drawn as light paper (surface white, ink `#242c28`). The outline uses `ink-50`, about 5.9:1 on the paper, and `Highlight` under forced colors.
- **Forwarder (agent choice).** Chalk admits the path by name until its service-contracts pin moves past 0.1.5, the same pattern as CGP-SHELL-R-003. The forward budget is 45 s for this path only, because the Service waits up to 30 s on Haiku.
- **Copy.** The section names, the composer wording and the error sentences are the agent's wording.
- **Not covered:**
  - a real Haiku answer: NOT RUN, the model is a fake client in tests;
  - a real instructor browser on macOS or Windows: only headless Chromium on Ubuntu was used;
  - a real screen reader;
  - staging or production.

