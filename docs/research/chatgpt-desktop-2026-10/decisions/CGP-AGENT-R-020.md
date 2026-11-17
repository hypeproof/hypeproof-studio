| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| CGP-AGENT-R-020 (learner skill cards) | Learner skill cards are authored in Chalk: a name, a one-line summary and a starter prompt, frozen with the lesson version. Studio shows only those cards, never a coach `SKILL.md` or `Profile.skills`. The lesson contract change is approved for this scope. This replaces the row's "view a skill's SKILL.md source" part (agents-codex-automation.md REQ-CGP-AGENT-36) | Jay 2026-11-14 | Implementation pending | yes (2026-11-14) |
## CGP-AGENT-R-020 / CGP-AGENT-D-017: learner skill cards (2026-11-14)

Confirmed by Jay: yes for the scope (2026-11-14): a learner-facing skill card authored in Chalk, frozen with the lesson version, and Studio showing only these cards and never the coach's SKILL.md or `Profile.skills`. The rest are agent choices, approved by the coordinator.

- **Contract.** `skill_cards` is an optional key on `hps-session-design/1`, following the DEC-30 starters pattern: omitted when empty, never coach data (hypeproof-service#488). The caps are 6 cards, name 30, summary 80, and prompt 300 units over at most 6 lines.
- **No links.** There is one `hasLink` rule in the Service, in Chalk and in the Studio reader, narrowed for coding lessons (verify-r027). NFKC and the colon look-alikes come first. Then `<scheme>://`, a known scheme directly followed by `:` (marks stripped, Cyrillic/Greek look-alikes folded), a bare `http:`/`https:`, `www.` plus a domain, and `//` plus a host are refused. Coding text with colons passes, `Q:답` included. One case list (`chalk/test/fixtures/link-cases.json`, copied byte-for-byte into the Service with a sha256 pin) is checked on every side. Only values a write introduces are checked; starters get it on new writes only.
- **Minors.** Cards are served as authored on minor seats, under the starters' safe-text rules.
- **Shelf.** It is collapsed by default and stays after the first message, because a skill is useful at any point, unlike a starter. It shows one "써 보기" button and nothing else: the dropped "보기" source view is the reason the design row was rewritten. Instructor surfaces draw no shelf.
- **Rows rewritten.** REQ-CGP-AGENT-36, DES-CGP-AGENT-36 and their register rows now describe the Chalk-authored card instead of a SKILL.md source view.
- **Not covered:** the installed app against the deployed Service, and a real screen reader.

