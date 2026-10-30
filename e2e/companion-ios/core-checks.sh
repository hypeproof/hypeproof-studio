#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
checks_dir="$(mktemp -d "${TMPDIR:-/tmp}/hypeproof-ios-core.XXXXXX")"
trap 'rm -rf "$checks_dir"' EXIT
swift_flags=(-swift-version 5 -strict-concurrency=complete -parse-as-library)
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--vfs-overlay" || ! -f "$2" ]]; then
    echo "Usage: core-checks.sh [--vfs-overlay compiler-overlay.json]" >&2
    exit 2
  fi
  swift_flags+=(-vfsoverlay "$2")
fi
swiftc "${swift_flags[@]}" \
  "$repo_root/apps/companion-ios/Sources/CompanionCore/DeviceSignIn.swift" \
  "$repo_root/apps/companion-ios/Sources/CompanionCore/DeviceHTTP.swift" \
  "$repo_root/e2e/companion-ios/ProtocolChecks.swift" -o "$checks_dir/protocol-checks"
"$checks_dir/protocol-checks"
