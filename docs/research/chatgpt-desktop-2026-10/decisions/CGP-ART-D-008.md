## CGP-ART-D-008: external-link dialog host line and the minor blocked notice (2026-11-04, agent-selected)

Builds DES-ART-08 on REQ-N11 (CGP-ART-R-008, merged in #1862); CGP-SHELL-D-025 is merged into this row. DEC-14 unchanged.

**Superseded for this scope on 2026-11-14 (Jay, #4090) by CGP-SHELL-R-026:** the blocked notice and 선생님께 알리기 are removed; a minor's link outside the allowlist shows the confirm dialog instead, and the native modal is replaced by the Studio dialog (it cannot make 취소 the default). The 48-character host ellipsis and the loopback rule are kept.
- Bold host: VS Code's native modal has no inline markup, so the host is the second line of the modal's message (drawn bold) and the full address is the detail. Middle ellipsis past 48 characters reuses `middleEllipsis`; 48 keeps at least 24 characters on screen.
- Loopback: "no dialog for loopback preview URLs" is met by opening the learner's own loopback address in the integrated browser for every cohort, so no new system-browser exit is added.
- Blocked notice: the persist:hp-safe core patch is not in the pinned vscodium-base, so nothing enforced the cohort allowlist. The host now checks it before opening a minor's link, behind `hypeproofChat.safeLinkAllowlistEnabled` (machine scope, default off; minor-safety rule). Empty list = nothing admitted (fail closed); loopback always admitted.
- Where: an inline alert beside the composer, not in the browser tab (no trusted in-tab surface, as for CGP-ART-D-002 and D-006).
- 선생님께 알리기: shown only when the class help channel is ready; it fills the learner's own help draft and opens the panel. The learner previews and consents as usual; there is no automatic instructor notification (DEC-14).
- Confirmed by Jay: no

## CGP-ART-D-008 follow-up: the minor safe-link block is on for minor cohorts (2026-11-04, Jay)

Jay, 2026-11-04: turn the blocked notice on for minor cohorts after verifying their allowlists. Supersedes the "default off" bullet of the CGP-ART-D-008 section above.

Superseded on 2026-11-14 (Jay, recorded in #4090): for minor cohorts the allowlist block is replaced by CGP-SHELL-R-026's confirm with the full URL and `열기` / `취소`, and the adult confirm becomes off by default with the setting `hypeproofChat.confirmExternalLinks`. The allowlist still decides which minor links open with no dialog. See the CGP-SHELL-R-026 section below.
- Verified: the Service serves `browser_session` from its profile registry (`resolveProfile` overlays only the system prompt). Two profiles are minor (`minor_cohort: true`, kids-quest, `mode: "safe"`), and both served an empty allowlist, which would have blocked every link. hypeproof-service#321 gives each its own gallery path prefix and makes the `/v1/profile` snapshot test fail on any minor seat with an empty or malformed list. Every other profile is adult (`browse`).
- Enablement is profile-driven (`safeLinkEnforced`): minor seat + safe session + an allowlist with at least one usable entry. An empty (or all-malformed) served list keeps today's integrated route (no block-all). Without a loaded profile, the persisted safe session and allowlist decide; they are registered only by the core patch, so on current builds the block waits for the profile (the link still stays in the integrated browser). Persisting the list in an extension-owned setting is left for the core-patch batch.
- `hypeproofChat.safeLinkAllowlistEnabled` stays machine-scoped and its default becomes true; only an explicit `false` turns the block off, as a support override.
- Adults: unchanged (confirm dialog). Updated 2026-11-14 (Jay, #4090): adults open the system browser with no dialog by default; the setting turns the confirm on (CGP-SHELL-R-026).
- Confirmed by Jay: yes (2026-11-04)

