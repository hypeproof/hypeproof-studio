#!/usr/bin/env bash
# Uses a prepared/patched source tree. Never invokes get_repo/reset/clean.
set -euo pipefail
umask 022
MODE="$1"
REPO_ROOT="$2"
cd "$REPO_ROOT"
# Caller provides the already resolved standard workflow/run-build environment.
# Re-sourcing the example here could overwrite current target/version flags.
: "${HPS_NAME_SHORT:?resolved standard product environment required}"
: "${BUILD_SOURCEVERSION:?actual candidate SHA required}"
: "${VSCODE_ARCH:?target architecture required}"
case "${OS_NAME:-}" in osx) TARGET=darwin ;; windows) TARGET=win32 ;; *) echo 'ASSEMBLY_BLOCKED: unsupported target' >&2; exit 1 ;; esac
cd vscodium-base/vscode
case "$MODE" in
 compile-base)
  # Prepack alone skips core compilation on modern esbuild source.
  npm run gulp vscode-min-prepack
  npm run gulp core-ci
  ;;
 assemble)
  # Rebuild all extension output; no Studio/Service output comes from the cache.
  cd "$REPO_ROOT"
  VSCODE_TREE="$REPO_ROOT/vscodium-base/vscode" bash scripts/inject-builtin-extensions.sh
  cd vscodium-base
  bash ../scripts/apply-product-overrides.sh
  cd vscode
  npm run gulp compile-extensions-build
  npm run gulp compile-extension-media-build
  npm run copy-policy-dto --prefix build
  node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc "$TARGET"
  # The normal -min-packing task includes esbuild compilation; -min-ci is the
  # audited package-only task and still rebuilds target-native dependencies.
  if [[ "$TARGET" == win32 ]]; then source ../build/windows/rtf/make.sh; fi
  npm run gulp "vscode-${TARGET}-${VSCODE_ARCH}-min-ci"
  source ../build_cli.sh
  ;;
 *) echo 'ASSEMBLY_BLOCKED: unknown phase' >&2; exit 1 ;;
esac
