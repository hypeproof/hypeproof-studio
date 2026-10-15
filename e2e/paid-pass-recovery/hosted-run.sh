#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
if [[ "$mode" != preflight && "$mode" != full ]]; then
  echo "usage: hosted-run.sh preflight|full" >&2
  exit 2
fi
: "${RUNNER_TEMP:?}" "${APP_TAG:?}" "${HPS_SERVICE_SOURCE:?}" "${ANTHROPIC_API_KEY:?}" "${GH_TOKEN:?}"

root="$(cd "$(dirname "$0")/../.." && pwd)"
output="$RUNNER_TEMP/paid-recovery-$mode"
upload="$RUNNER_TEMP/paid-recovery-$mode-upload"
assets="$RUNNER_TEMP/paid-recovery-assets-$mode"
app_root="$RUNNER_TEMP/paid-recovery-app-$mode"
keychain="$RUNNER_TEMP/hps-paid-recovery-$mode.keychain-db"
prior_default="$RUNNER_TEMP/hps-prior-default-$mode"
prior_list="$RUNNER_TEMP/hps-prior-list-$mode"
mkdir -p "$output" "$assets" "$app_root"

security default-keychain -d user | sed 's/^[[:space:]]*"//; s/"$//' > "$prior_default"
security list-keychains -d user | sed 's/^[[:space:]]*"//; s/"$//' > "$prior_list"
cleanup() {
  body_status=$?
  set +e
  cleanup_status=0
  bash "$root/e2e/paid-pass-recovery/keychain-cleanup.sh" "$keychain" "$prior_default" "$prior_list" || cleanup_status=1
  node "$root/e2e/paid-pass-recovery/stage-evidence.mjs" "$output" "$upload" || cleanup_status=1
  unset HPS_KEYCHAIN_SCAN_SECRET password
  trap - EXIT INT TERM
  if (( body_status != 0 )); then exit "$body_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT INT TERM

password="$(uuidgen)$(uuidgen)"
echo "::add-mask::$password"
export HPS_KEYCHAIN_SCAN_SECRET="$password"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$password" "$keychain"
existing=()
while IFS= read -r item; do [[ -n "$item" ]] && existing+=("$item"); done < "$prior_list"
security list-keychains -d user -s "$keychain" "${existing[@]}"
security default-keychain -d user -s "$keychain"
export HPS_TEST_KEYCHAIN_PATH="$keychain"

cd "$root"
node scripts/bootstrap-service-packages.mjs
npm ci --prefix e2e
(cd "$HPS_SERVICE_SOURCE" && npm run setup:packages -- worker)
gh release download "$APP_TAG" --repo hypeproof/hypeproof-studio --dir "$assets" --pattern 'HypeProof-Studio-darwin-arm64.zip'
ditto -xk "$assets/HypeProof-Studio-darwin-arm64.zip" "$app_root"
app="$app_root/HypeProof Studio.app"
bash scripts/seed-sdk-binary.sh --version "$(node e2e/unified-release/sdk-seed.mjs version "$app")"

studio_sha="$(git rev-parse HEAD)"
app_sha="$(git rev-parse "$APP_TAG^{commit}")"
node e2e/paid-pass-recovery/run.mjs "$app" "$output" "$studio_sha" "${APP_TAG#v}" "$app_sha" "$mode"
