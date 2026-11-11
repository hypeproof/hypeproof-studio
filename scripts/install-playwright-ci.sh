#!/usr/bin/env bash
# Run from the package containing the pinned Playwright dependency.
# Only disposable GitHub Linux runners may alter their own package sources.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "$(uname -s)" != "Linux" ]]; then
  echo "install-playwright-ci: requires a disposable GitHub Linux runner" >&2
  exit 2
fi

# The Azure mirror repeatedly failed DNS before browser tests could start.
# Keep Ubuntu suites, components and signature verification unchanged.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [[ -f "$source" ]] || continue
  if grep -q 'azure\.archive\.ubuntu\.com' "$source"; then
    sudo sed -i 's|http[s]*://azure\.archive\.ubuntu\.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source"
  fi
done

# A repository/network failure must fail this stage, not consume the whole job.
timeout 300 npx playwright install --with-deps chromium
