#!/usr/bin/env bash
# Copy Studio-owned VS Code core patches into the fork's patch pipeline.
#
# prepare_vscode.sh applies vscodium-base/patches/user/*.patch last. Studio keeps its own
# core patches in scripts/patches/core/ (reviewed with the Studio change that needs them)
# and stages them here as 99-hps-*.patch before every prepare_vscode.sh run. Copying is
# idempotent; the staged files are untracked in the submodule.
#
# Usage: bash scripts/stage-core-patches.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/scripts/patches/core"
DEST="$REPO_ROOT/vscodium-base/patches/user"

mkdir -p "$DEST"
for patch in "$SRC"/*.patch; do
  [[ -f "$patch" ]] || continue
  cp "$patch" "$DEST/99-$(basename "$patch")"
  echo "[stage-core-patches] staged $(basename "$patch")"
done
