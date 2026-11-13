#!/usr/bin/env bash
# CI-only isolated credential import. No login-keychain mutation or ad-hoc fallback.
set -euo pipefail
set +x
for name in RUNNER_TEMP GITHUB_ENV MACOS_DEVELOPER_ID_P12 MACOS_DEVELOPER_ID_PASSWORD MACOS_DEVELOPER_ID_SHA1 MACOS_TEAM_ID MACOS_NOTARY_KEY_P8 MACOS_NOTARY_KEY_ID MACOS_NOTARY_ISSUER_ID; do
  [[ -n "${!name:-}" ]] || { echo "::error::required official signing configuration missing: $name"; exit 1; }
done
KEYCHAIN="$RUNNER_TEMP/hps-developer-id.keychain-db"
[[ ! -e "$KEYCHAIN" ]] || { echo '::error::refusing to overwrite an existing signing keychain'; exit 1; }
umask 077
CREDENTIAL_DIR="$(mktemp -d "$RUNNER_TEMP/hps-signing-import.XXXXXX")"
KEYCHAIN_PW="$(uuidgen)"
created=0
cleanup() {
  status=$?
  rm -rf "$CREDENTIAL_DIR"
  if [[ "$status" != 0 && "$created" == 1 ]]; then security delete-keychain "$KEYCHAIN"; fi
  exit "$status"
}
trap cleanup EXIT
printf '%s' "$MACOS_DEVELOPER_ID_P12" | base64 --decode > "$CREDENTIAL_DIR/certificate.p12"
printf '%s' "$MACOS_NOTARY_KEY_P8" > "$CREDENTIAL_DIR/notary.p8"
security create-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
created=1
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PW" "$KEYCHAIN"
security import "$CREDENTIAL_DIR/certificate.p12" -k "$KEYCHAIN" \
  -P "$MACOS_DEVELOPER_ID_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PW" "$KEYCHAIN" >/dev/null
# notarytool validates this team API key before storing it in this run's keychain.
# The notary private key is supplied by file, never as an argument value.
xcrun notarytool store-credentials hps-developer-id --keychain "$KEYCHAIN" \
  --key "$CREDENTIAL_DIR/notary.p8" --key-id "$MACOS_NOTARY_KEY_ID" --issuer "$MACOS_NOTARY_ISSUER_ID"
export HPS_DEVELOPER_ID_SHA1="$MACOS_DEVELOPER_ID_SHA1" HPS_APPLE_TEAM_ID="$MACOS_TEAM_ID"
export HPS_SIGNING_KEYCHAIN="$KEYCHAIN" HPS_NOTARY_PROFILE=hps-developer-id
python3 scripts/release/macos-sign.py preflight
{
  printf 'HPS_DEVELOPER_ID_SHA1=%s\n' "$HPS_DEVELOPER_ID_SHA1"
  printf 'HPS_APPLE_TEAM_ID=%s\n' "$HPS_APPLE_TEAM_ID"
  printf 'HPS_SIGNING_KEYCHAIN=%s\n' "$HPS_SIGNING_KEYCHAIN"
  printf 'HPS_NOTARY_PROFILE=%s\n' "$HPS_NOTARY_PROFILE"
} >> "$GITHUB_ENV"
