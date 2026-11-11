#!/bin/bash
# CI-only signed native previews. Signing material never enters artifacts or source.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true || { echo 'Run through the Apple deployment workflow' >&2; exit 2; }
platform=${1:?Expected ios}
case "$platform" in
  ios) ;;
  *) echo 'Mobile delivery supports iOS only. Desktop uses the existing Studio RC pipeline.' >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../ios"
evidence="$PWD/../evidence/apple-$platform"
mkdir -p "$evidence"
git rev-parse HEAD > "$evidence/source.txt"
git status --porcelain > "$evidence/source-dirty.txt"
test ! -s "$evidence/source-dirty.txt"
private=$(mktemp -d "$RUNNER_TEMP/hp-apple-$platform.XXXXXX")
chmod 700 "$private"
export APPLE_SIGNING_TEMP="$private"
export APPLE_UPLOAD_PLATFORM="$platform"
keychain="$private/signing.keychain-db"
keychain_password=$(uuidgen)
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  if [ -f "$private/installed-profiles.txt" ]; then
    while IFS= read -r installed_profile; do rm -f "$installed_profile"; done < "$private/installed-profiles.txt"
  fi
  rm -rf "$private"
}
trap cleanup EXIT
python3 - <<'PY'
import os,base64,pathlib
os.umask(0o077)
p=pathlib.Path(os.environ['APPLE_SIGNING_TEMP'])
required=['APPLE_DISTRIBUTION_P12','APPLE_DISTRIBUTION_PASSWORD','APPLE_PROFILE',
 'APP_STORE_CONNECT_PRIVATE_KEY','APP_STORE_CONNECT_KEY_ID','APP_STORE_CONNECT_ISSUER_ID','APPLE_DEVELOPER_TEAM_ID']
if os.environ['APPLE_UPLOAD_PLATFORM']=='macos': required += ['APPLE_MAC_INSTALLER_P12','APPLE_MAC_INSTALLER_PASSWORD']
missing=[name for name in required if not os.environ.get(name)]
if missing: raise SystemExit('Missing deployment configuration: '+', '.join(missing))
for env,name in [('APPLE_DISTRIBUTION_P12','distribution.p12'),('APPLE_PROFILE','profile.mobileprovision')]:
    (p/name).write_bytes(base64.b64decode(os.environ[env],validate=True))
if os.environ['APPLE_UPLOAD_PLATFORM']=='macos':
    (p/'installer.p12').write_bytes(base64.b64decode(os.environ['APPLE_MAC_INSTALLER_P12'],validate=True))
(p/('AuthKey_'+os.environ['APP_STORE_CONNECT_KEY_ID']+'.p8')).write_text(os.environ['APP_STORE_CONNECT_PRIVATE_KEY'])
PY
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$private/distribution.p12" -k "$keychain" -P "$APPLE_DISTRIBUTION_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild > /dev/null
if [ "$platform" = macos ]; then
  security import "$private/installer.p12" -k "$keychain" -P "$APPLE_MAC_INSTALLER_PASSWORD" -T /usr/bin/productbuild > /dev/null
fi
curl --fail --silent --show-error https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o "$private/wwdr.cer"
security import "$private/wwdr.cer" -k "$keychain" >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null
# Disposable runner: use the task keychain together with its existing login keychain.
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain" > "$evidence/signing-identity.txt"
identity=$(awk '/Apple Distribution:/{print $2; exit}' "$evidence/signing-identity.txt")
test -n "$identity"
if [ "$platform" = macos ]; then
  # The certificate's portal type differs from its subject. Bind export to its hash.
  installer_identity=$(security find-certificate -a -c '3rd Party Mac Developer Installer:' -Z "$keychain" | awk '/SHA-1 hash:/{print $3; exit}')
  test -n "$installer_identity"
  export APPLE_INSTALLER_IDENTITY="$installer_identity"
fi
security cms -D -i "$private/profile.mobileprovision" > "$private/profile.plist"
profile_uuid=$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$private/profile.plist")
profile_name=$(/usr/libexec/PlistBuddy -c 'Print :Name' "$private/profile.plist")
profile_team=$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$private/profile.plist")
test "$profile_team" = "$APPLE_DEVELOPER_TEAM_ID"
if [ "$platform" = macos ]; then
  # A MAC_APP_STORE profile archives but export rejects it for Catalyst.
  # MAC_CATALYST_APP_STORE carries both iOS and macOS application identifiers.
  catalyst_app_id=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$private/profile.plist")
  mac_app_id=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$private/profile.plist")
  test "$catalyst_app_id" = "$APPLE_DEVELOPER_TEAM_ID.ai.hypeproof.studio.mobile"
  test "$mac_app_id" = "$catalyst_app_id"
fi
# Xcode 16+ uses UserData; retain the legacy location for export tools.
for profiles in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
  mkdir -p "$profiles"
  profile_destination="$profiles/$profile_uuid.mobileprovision"
  test ! -e "$profile_destination"
  cp "$private/profile.mobileprovision" "$profile_destination"
  printf '%s\n' "$profile_destination" >> "$private/installed-profiles.txt"
done
printf '%s\n' "$profile_uuid" > "$evidence/profile-uuid.txt"
export APPLE_PROFILE_NAME="$profile_name" APPLE_SIGNING_IDENTITY="$identity"
python3 - <<'PY'
import os,pathlib,plistlib
options={'method':'app-store-connect','destination':'export','signingStyle':'manual',
 'teamID':os.environ['APPLE_DEVELOPER_TEAM_ID'],'signingCertificate':os.environ['APPLE_SIGNING_IDENTITY'],
 'provisioningProfiles':{'ai.hypeproof.studio.mobile':os.environ['APPLE_PROFILE_NAME']},
 'manageAppVersionAndBuildNumber':False,'uploadSymbols':True,'testFlightInternalTestingOnly':True}
if os.environ['APPLE_UPLOAD_PLATFORM']=='macos': options['installerSigningCertificate']=os.environ['APPLE_INSTALLER_IDENTITY']
with (pathlib.Path(os.environ['APPLE_SIGNING_TEMP'])/'ExportOptions.plist').open('wb') as f:plistlib.dump(options,f)
PY
destination='generic/platform=iOS'
if [ "$platform" = macos ]; then destination='generic/platform=macOS,variant=Mac Catalyst'; fi
archive="$private/HPStudio.xcarchive"
build_number="${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}"
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Release \
  -destination "$destination" -archivePath "$archive" -derivedDataPath "$private/DerivedData" \
  DEVELOPMENT_TEAM="$APPLE_DEVELOPER_TEAM_ID" CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$identity" PROVISIONING_PROFILE_SPECIFIER="$profile_name" \
  CURRENT_PROJECT_VERSION="$build_number" archive > "$evidence/archive.log" 2>&1
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$private/ExportOptions.plist" \
  -exportPath "$private/export" > "$evidence/export.log" 2>&1
extension=ipa; upload_type=ios
if [ "$platform" = macos ]; then extension=pkg; upload_type=macos; fi
package=$(find "$private/export" -maxdepth 1 -name "*.$extension" -print -quit)
test -s "$package"
shasum -a 256 "$package" > "$evidence/package-sha256.txt"
printf '%s\n' "$build_number" > "$evidence/build-number.txt"
export API_PRIVATE_KEYS_DIR="$private"
xcrun altool --validate-app --type "$upload_type" --file "$package" \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID" > "$evidence/validation.log" 2>&1
xcrun altool --upload-app --type "$upload_type" --file "$package" \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID" > "$evidence/upload.log" 2>&1
cp "$package" "$evidence/HP-Studio-$platform.$extension"
echo 'Upload command completed; Apple processing and tester availability must be verified separately.'
