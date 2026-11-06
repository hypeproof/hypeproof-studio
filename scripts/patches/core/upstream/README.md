# Pristine upstream files for the core patch test

Unmodified copies of the VS Code files that `hps-quit-guard.patch` edits, at the pinned
upstream commit `560a9dba96f961efea7b1612916f89e5d5d4d679` (VS Code 1.116.0, MIT).
`extensions/hypeproof-chat/test/quit-guard-patch.smoke.mjs` regenerates the patch from them
and applies it. When the `vscodium-base` pin moves to a new upstream commit, refresh these
copies from `vscodium-base/vscode` and regenerate the patch.

`browserView/electron-browser/browserEditor.ts` is also a pristine copy at the same commit, used by `hps-preview-recovery.patch` and the isolated patched-method test. Regenerate with `build_preview_recovery_patch.py`. The snapshot is not a full native build or installed-app acceptance.

The seven `browserView` files under `src/vs/platform/browserView/` and `src/vs/workbench/contrib/browserView/` (except `browserEditor.ts`; `browserViewActions.ts` added 2026-11-07 for the toolbar "Open in External Browser" gate) are pristine copies at the same commit for `hps-safe-session.patch` (the `persist:hp-safe` session, REQ-N11). That patch is hand-maintained, not generated: edit it by applying it to these copies, changing the files, and writing `git diff` back under its three-line header. `extensions/hypeproof-chat/test/safe-session-patch.smoke.mjs` applies it here and runs its URL matcher; `safe-session-gaps.smoke.mjs` compiles the patched `browserViewMainService.ts` and runs it against stand-ins (context menu, CDP targets, pre-flip tabs).
