# Pristine upstream files for the core patch test

Unmodified copies of the VS Code files that `hps-quit-guard.patch` edits, at the pinned
upstream commit `560a9dba96f961efea7b1612916f89e5d5d4d679` (VS Code 1.116.0, MIT).
`extensions/hypeproof-chat/test/quit-guard-patch.smoke.mjs` regenerates the patch from them
and applies it. When the `vscodium-base` pin moves to a new upstream commit, refresh these
copies from `vscodium-base/vscode` and regenerate the patch.
