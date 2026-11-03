# ChatGPT desktop → HypeProof Studio / Chalk: feature-parity plan

Status: research register and plan, 2026-10-19. Rows become requirements slice by slice (section 8).
Target: ChatGPT for macOS 26.1013.40934 (`/Applications/ChatGPT.app`, bundle
`com.openai.codex`, Electron package `openai-codex-electron`; ChatGPT and Codex in one app).
Studio baseline: `hypeproof/hypeproof-studio` origin/main `4f83c0fc`.

## 1. Method and evidence limits

| Step | Tool | Result |
|---|---|---|
| Static app analysis | REA `rea-agents` 6.7.0 CLI, `analyze-javascript-application` on `app.asar` (`--integrity-policy record-and-continue`) | Evidence `ev_0fbe7ebc…06fb61`, asar sha256 `5ddc4e48…16ddb`. Partial: 3,124 of 15,296 JS files parsed before REA's result capacity ran out. It recovered 26 IPC operations, 3 context-bridge APIs, 15 native addons and 157 endpoints. |
| UI surface inventory | Extracted every `id`/`defaultMessage` pair from the renderer bundle | 51,756 messages across ~250 namespaces. This is the primary evidence for "what features exist". |
| Domain analysis | 8 parallel analysts (chat, knowledge/memory, agents, artifacts, learning, voice, shell/settings, design system) | 537 features, 238 functional reqs, 219 design reqs |
| Verification | Adversarial check of every P0 "Studio today" claim and every ALREADY verdict against Studio source (`extensions/hypeproof-chat/{src,webview-ui}`, `chalk/src`, docs) | 25 of 53 P0 premises refuted or partial; 36 P0s overlap existing REQ IDs |
| Merge | One register, cross-domain duplicates merged | 994 rows in, 994 out (879 canonical) |

Limits that apply to every row:
- **A string in the bundle proves the code ships. It does not prove the feature is enabled.** OpenAI's feature flags were not resolved.
- Studio "today" was verified against source, not against a running build. Two areas could not be checked at all: VSCodium patches and the Electron main process (quit guard, menus), and Service code.
- Host workaround used for REA: the CLT 26.2 Swift toolchain ships a duplicate `SwiftBridging` modulemap. REA ran through a `swiftc` wrapper with a VFS overlay (`REA_DARWIN_SWIFTC_PATH`). Nothing on the system was modified.

## 2. Headline: "take everything" vs Studio's product filter

Studio's CLAUDE.md requires every chat feature to trace Philosophy → Product Intent → Requirement → UX → Evidence. Each feature was therefore inventoried and then given a verdict.

| Verdict (canonical features) | Count | Meaning |
|---|---|---|
| ADOPT | 23 | Take as is |
| ADAPT | 187 | Take, reshaped for learners or instructors |
| ALREADY | 95 | Studio/Chalk has it (verified: 63 of 121 implemented in source; the rest are spec-only or partial) |
| DEFER | 72 | Valuable, not now |
| REJECT | 78 | Conflicts with intent: ads, commerce, consumer upsell, social sharing, full-access agents, hidden memory, desktop mascot, PIN-locked chats, global hotkey window |

Surface of the ADOPT/ADAPT features: Studio 140, Both 50, Chalk 19, Service 1.

The most strategically relevant find is that ChatGPT ships about **1,630 interactive learning-block topics** and 784 animated diagrams. They are versioned block types with bounded parameters, explore-only (no grading), and each has a live text description for screen readers. This maps directly onto Studio's lesson-step model and has no Studio equivalent today (epic E16).

## 3. Fix now: confirmed gaps (verified against source)

These do not wait on the roadmap.

| # | Gap | Evidence | Requirement |
|---|---|---|---|
| 1 | Chat links and citation chips open the **system browser** with only an `https?://` scheme check. Nothing checks the cohort, so minors leave the safe-session allowlist. Not yet checked: whether VS Code's own link-protection dialog appears first. | `extensions/hypeproof-chat/src/chatPanelProvider.ts:4542-4551` | CGP-ART-R-008 (minors: in-app safe browser only; adults: confirm with the host shown). Blocked only by DEC-14 (force in-app vs confirm). |
| 2 | Self-harm-blocked input from a minor: no help line shown and no instructor signal | No coverage found (searched docs/requirements, design, ext src) | CGP-LEARN-R-013. Legal review: DEC-22 |
| 3 | Model refusals are not handled client-side; only `max_tokens` and error subtypes are mapped | `sdkCoachHelpers.ts:1710-1720` | CGP-AGENT-R-008 refusal banner |
| 4 | `.hp-cta-quiet` border (and lesson-mode Send) measures 1.75:1, below Studio's own 3:1 rule (DES-11) | `webview-ui/src/styles.css:1305-1309`, `--hp-line` | CGP-DS-R-034 / extend DES-11 |
| 5 | Classroom mode "생각하는 중… ✨" has no `role=status`; no completion announcement in either mode | `ChatPanel.tsx:2104`, `ChatDetails.tsx:42-46` | CGP-CHAT-R-001, extend REQ-STUDIO-CHAT-DETAIL |
| 6 | Korean `word-break: keep-all` only on the start page; chat uses `overflow-wrap:anywhere` | `start.css` vs `styles.css` | CGP-DS-R-028, extend DES-03 |

## 4. P0 list after verification

The register's 52 P0s were re-graded against the verification ledger:

| Disposition | IDs |
|---|---|
| **New P0, confirmed gap** | ART-R-008 (links), LEARN-R-013 (self-harm), AGENT-R-008 (refusal), CHAT-R-002 (edit and resend latest prompt; DEC-08), SHELL-R-001 (no update prompt during a class window), DS-R-027 (IME guard extended to Escape/Tab/Arrow-up/Cmd+Enter), DS-R-034 (no text or control boundary below contrast) |
| **P0, but "extend existing REQ"** | CHAT-R-001 → REQ-STUDIO-CHAT-DETAIL; ART-R-002 + AGENT-R-026 + KNOW-R-017 → extend AE-15 (per-turn review bar, "바뀐 것" panel, restore UI; kids' world already archives to `이전 세상`, only restore is missing); KNOW-R-036 → US-12; KNOW-R-006 → gallery publish only (help request already previews); VOICE-R-024 → existing voice entitlement gate (`voicePopupHelpers.ts:103-124`); DS-R-001/002/003 → consolidate `tokens.css` (10 `--hp-*` tokens ship; 288 hard-coded hex remain) |
| **P0 only if the blocking decision is yes** | KNOW-R-005/022/023/026/027/031/033 (personal AI memory: DEC-01/02); LEARN-R-001..003 (learning blocks: DEC-18/19/20); AGENT-R-001..003 (approval presets: DEC-11) |
| **Unverifiable here, keep P0 pending one check** | SHELL-R-004 quit guard while a coach turn runs (main process not in snapshot) |
| **Dropped as P0 (refuted)** | CHAT-R-003 choice card (ships as `ReplyChoices.tsx`); SHELL-R-029 remaining-requests meter (ships in `AccessControl.tsx`); AGENT-R-022 "next waiting task" (tasks never run concurrently, recast as extend AE-03 P1); AGENT-R-005 write-approval file list (no write modal by default since REQ-E1; reopen only if Jay re-enables write review); KNOW-R-020 attachment errors (per-cause copy exists, extend REQ-STUDIO-CHAT-PHOTO, P1) |
| **Design P0s downgraded to "consolidate"** | DS-R-005/006/010/017/021/023/024 mostly exist in part (44px targets: 42 declarations; dialogs: SX-52; focus restore). They are kept as P1 extensions with measurable acceptance. |

## 5. Roadmap (23 epics → 4 waves)

Sizes: S ≤ 1 week, M 2–4 weeks, L > 1 month, for one engineer.

| Wave | Epics | Why this order |
|---|---|---|
| **W0: safety and correctness (now)** | Section 3 items · E17 Minor safety escalation (S) · E08 Safe browser, links, preview (M) | Live risks for minors; small and independent |
| **W1: foundations** | E01 Design tokens and theming (L) · E02 Korean input and reading comfort (S) · E03 Accessibility, settings sheet, resilience (M) · E20 Desktop shell, updates, OS integration (M) | Every later UI epic renders through tokens; class-time update freeze protects lessons |
| **W2: judgment-visible agent UX** (core of Product Intent #2) | E04 Approval and capability transparency (L) · E05 Change review, versions, restore (L) · E10 Answer judgment and iteration (M) · E12 Run state and attention (M) · E09 Composer context and attachments (L) | Shows the learner what the AI may do and what it changed, and lets the learner undo it |
| **W3: learning and instructor leverage** | E16 Interactive learning blocks (L) · E18 Chalk lesson AI authoring (L) · E19 Chalk classroom ops and reporting (L) · E21 Access, usage, class lifecycle (M) · E07 Outbound sharing (M) | The ChatGPT learning-block model, attached by instructors to lesson steps |
| **W4: decision-gated** | E06 Visible file-based memory (L, DEC-01) · E13 Read aloud and dictation (M, DEC-03..07; read-aloud needs no mic and can go first) · E14 Voice deltas (M) · E11 Plan/goal/steer/delegation (M) · E15 Task navigation (M) · E22 Page/deck editing (M) · E23 Adult/operator tools (S) | Each waits on a policy decision or an SDK capability |

## 6. Decisions only Jay can make (top 10 of 34)

| ID | Decision | Unblocks |
|---|---|---|
| DEC-14 | Minor external links: force the in-app safe browser, or confirm with full URL | W0 #1 |
| DEC-22 | Self-harm escalation: legal (PIPA) review, who responds outside class hours | E17 |
| DEC-27 | Canonical palette (`#202C24` SX vs task-workspace doc `#18231C`; in source `#18231C` is ink-on-accent) | E01 |
| DEC-01/02 | Personal AI memory at all; if yes, file-based in the activity; who enables it for minors | E06 (12 reqs) |
| DEC-03/05 | Mic capture path (REQ-R1/ADR-0009) and audio retention policy | E13/E14 (12 reqs) |
| DEC-11 | Approval preset per lesson version or per step | E04 |
| DEC-12/13 | Version archive for minor seats; trash retention | E05 |
| DEC-18/19/20 | Learning blocks: first authors/curricula, schema home (`steps[]` has no `materials` today), iframe vs in-webview runtime | E16 |
| DEC-24 | Class update freeze vs security fixes; Service min-version gate | E20 |
| DEC-34 | 31 cross-domain verdict conflicts (e.g. temporary chat, idea catalog, hotkey window) | — |

Service-owner asks: class window end time (DEC-25), confirmed remaining count with as-of time (DEC-26, partly ships), feature keys `voice`/`dictation`/`read_aloud` (DEC-07).

## 7. Design requirements summary

219 design rows. Every ADOPT/ADAPT requirement has a measurable design row (px, states, motion, a11y, light/dark, 320px, Korean IME). The cross-cutting design rules from the DS analysis:

- One token source with tiers (primitive → semantic → component); every webview semantic token maps to a `--vscode-*` color with an HP fallback. ChatGPT's extension mode maps 305 VS Code colors.
- Korean typography: `word-break: keep-all` with long-token fallback, learner text ≥ 14px, body line-height ≥ 1.65; Pretendard (OFL) vs system font is DEC-28.
- Contrast: no readable text below 4.5:1 (ChatGPT's own tertiary gray is 3.2:1; do not copy that); control boundaries ≥ 3:1.
- Motion: an explicit app reduce-motion setting overrides the OS; motion only reflects real state.
- 44px learner targets; 4px spacing unit; one 2px/2px focus ring visible in every theme.
- Deliberate differences from ChatGPT: no accent picker, no density modes, no pointer-cursor preference, no proprietary assets. OpenAI Sans and the OpenAI marks are proprietary and must not be reused; Lucide (ISC) and codicons are safe.

## 8. How this lands in the repo

This folder is research input, not a requirement document: it sits outside
`docs/requirements/` so the requirement-work ledger does not count 221 rows at once.

- Each implementation slice promotes its rows into the owning requirement document
  (`docs/studio-requirements.md`, `docs/requirements/*.md`; "extend REQ-x" rows edit that
  row) and registers them in `config/requirement-work.json`, **in the same PR as the code
  and tests**. A register row is done when that PR merges; the register CSV is not edited
  per slice.
- Order: section 5 waves, P0 first, then by epic.
- Decisions (section 6), per Jay 2026-10-19: proceed with the recommended option and record
  the choice in `decisions.md` here. Legal or minor-safety choices (DEC-05 audio retention,
  DEC-22 self-harm escalation, DEC-23 guardian/PIPA) ship **default off** until Jay
  confirms them.
- No ChatGPT code is copied. The bundle is proprietary; slices reimplement observed
  behavior in Studio's own code.

## 9. Files

- `master-register.csv` (994 rows) and `master-register.md`: merged register, epics, decisions
- `verification.md`: P0 and ALREADY claims checked against Studio source
- `domains/*.md`: the eight domain analyses
- Not committed: the extracted UI message catalog (51,756 OpenAI strings) and the REA
  evidence JSON (428 MB). Regenerate with `rea analyze-javascript-application <app.asar>`.
