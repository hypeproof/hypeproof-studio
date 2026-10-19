#!/usr/bin/env bash
# Find a published release whose macOS app was built from the same base as KEY.
#
# Walks the newest published (non-draft) releases of the source repository,
# keeps those whose tag is a Studio app tag (v*) and that carry
# HypeProof-Studio-darwin-arm64.zip, and returns the first one whose
# scripts/mac-base-key.sh value at that tag equals KEY. Prereleases (-rc) count:
# their base bytes are as good as a stable release's.
#
# Prints "<tag> <asset download url>" on a match and exits 0; prints nothing
# and exits 3 when no release matches (the caller then runs the full build).
#
# Read-only and public: plain HTTPS to the GitHub REST API. GH_TOKEN, when set,
# only raises the rate limit (CI passes the workflow token).
#
# Usage: bash scripts/find-mac-base-release.sh KEY [repo] [max-releases]
set -euo pipefail

KEY="${1:?usage: find-mac-base-release.sh KEY [repo] [max]}"
REPO="${2:-${GITHUB_REPOSITORY:-hypeproof/hypeproof-studio}}"
MAX="${3:-30}"
ASSET="HypeProof-Studio-darwin-arm64.zip"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

auth=()
if [[ -n "${GH_TOKEN:-}" ]]; then auth=(-H "Authorization: Bearer $GH_TOKEN"); fi

json="$(curl -fsSL "${auth[@]+"${auth[@]}"}" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/releases?per_page=$MAX")"

candidates="$(jq -r --arg asset "$ASSET" '
  .[] | select(.draft == false) | select(.tag_name | test("^v[0-9]"))
  | . as $r | ($r.assets[] | select(.name == $asset)) as $a
  | "\($r.tag_name) \($a.browser_download_url)"' <<<"$json")"

while read -r tag url; do
  [[ -n "$tag" ]] || continue
  if ! git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    git -C "$REPO_ROOT" fetch -q origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || continue
  fi
  k="$(bash "$REPO_ROOT/scripts/mac-base-key.sh" "$tag" 2>/dev/null || true)"
  if [[ "$k" == "$KEY" ]]; then
    printf '%s %s\n' "$tag" "$url"
    exit 0
  fi
  echo "find-mac-base-release: $tag has base ${k:-<unknown>} (want $KEY)" >&2
done <<<"$candidates"

exit 3
