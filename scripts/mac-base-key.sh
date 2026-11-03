#!/usr/bin/env bash
# Print the cache key of the macOS "base app" for a git revision.
#
# The base app is vscodium-base/VSCode-darwin-arm64/HypeProof Studio.app as the
# 1–2 h full build leaves it, BEFORE the per-release steps (shell brand, version
# stamp, signing). Everything in it except Resources/app/extensions/hypeproof-chat
# is decided by the inputs below. When two revisions have the same key, a release
# can reuse the other revision's base app and rebuild only the extension
# (scripts/repack-mac.sh) instead of running the full VS Code build.
#
# The key is computed from git objects, never from the working tree, so it can
# be evaluated for any tag without checking it out. That is what lets the fast
# path find a previous release built from the same base.
#
# Inputs (keep in sync with .claude/rules/build-pipeline.md "Fast Mac repack"):
#   vscodium-base                     submodule pin: fork patches, prepare_vscode.sh,
#                                     icons, upstream VS Code commit
#   hypeproof-studio.env.example      the env CI builds with (APP_NAME, HPS_* …)
#   scripts/apply-product-overrides.sh product.json branding overrides
#   scripts/install-brand-assets.sh   icon SVG install before build_icons.sh
#   assets/brand                      brand SVGs
#   scripts/run-build.sh              the build entry point
#   scripts/stage-core-patches.sh     stages Studio-owned core patches
#   scripts/patches/core              Studio-owned VS Code core patches
#   MAC_BASE_EPOCH (below)            bump by hand when a build-mac.yml change
#                                     alters the base (runner image, Node pin,
#                                     env block, brew deps) — the workflow file is
#                                     deliberately not hashed, so editing its
#                                     comments or release steps does not force a
#                                     1–2 h build
#
# Usage: bash scripts/mac-base-key.sh [rev]     (default HEAD)
# Output: mac-arm64-base-e<epoch>-<24 hex>
set -euo pipefail

MAC_BASE_EPOCH=1
REV="${1:-HEAD}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INPUTS=(
  vscodium-base
  hypeproof-studio.env.example
  scripts/apply-product-overrides.sh
  scripts/install-brand-assets.sh
  assets/brand
  scripts/run-build.sh
  scripts/stage-core-patches.sh
  scripts/patches/core
)

lines="epoch $MAC_BASE_EPOCH"$'\n'
for p in "${INPUTS[@]}"; do
  # ls-tree prints "<mode> <type> <object>\t<path>" for blobs, trees and the
  # submodule gitlink alike. A missing path is an error: a silent empty entry
  # would make two different bases hash the same.
  entry="$(git -C "$REPO_ROOT" ls-tree "$REV" -- "$p")"
  if [[ -z "$entry" ]]; then
    echo "mac-base-key: $p not found at $REV" >&2
    exit 1
  fi
  lines+="$entry"$'\n'
done

if command -v sha256sum >/dev/null 2>&1; then
  digest="$(printf '%s' "$lines" | sha256sum | cut -c1-24)"
else
  digest="$(printf '%s' "$lines" | shasum -a 256 | cut -c1-24)"
fi
printf 'mac-arm64-base-e%s-%s\n' "$MAC_BASE_EPOCH" "$digest"
