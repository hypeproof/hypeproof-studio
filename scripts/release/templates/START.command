#!/bin/bash
# Exact-build kit launcher. RC profile/namespace validation also runs in core on double-click.
set -euo pipefail
VERSION="@@VERSION@@"
APP_VERSION="@@APP_VERSION@@"
SOURCE="@@SOURCE_SHA@@"
PRERELEASE="@@PRERELEASE@@"
APP="$HOME/Applications/@@KIT_DIR_NAME@@/HypeProof Studio.app"
STATE="$HOME/Library/Application Support/HPS-$VERSION"
if [[ "$PRERELEASE" == 1 ]]; then
  STATE="$HOME/Library/Application Support/HPS-RC-Profiles/$VERSION"
  rc_marker() { printf '%s\n' hps-rc-profile-v1 'HypeProof Studio RC' "$VERSION" "$APP_VERSION" "$SOURCE" "$APP" "$STATE"; }
  for dir in "$(dirname "$APP")" "$STATE"; do
    if [[ ! -f "$dir/.hps-rc-profile-v1" || -L "$dir/.hps-rc-profile-v1" ]] || ! cmp -s "$dir/.hps-rc-profile-v1" <(rc_marker); then
      echo 'RC 프로필 검증 실패. 기존 프로필은 유지됩니다. 이 버전의 설치 명령을 다시 실행하세요.'
      exit 1
    fi
  done
else
  [[ -f "$STATE/.hps-kit-$VERSION" ]] || { echo "먼저 INSTALL-$VERSION.command 또는 한 줄 설치 명령을 실행하세요."; exit 1; }
fi
[[ -d "$APP" ]] || { echo "먼저 INSTALL-$VERSION.command 또는 한 줄 설치 명령을 실행하세요."; exit 1; }
unset VSCODE_PORTABLE VSCODE_APPDATA VSCODE_DEV VSCODE_CWD HPS_KIT_INMEMORY_SECRETS
unset HPS_TEST_E2E HPS_TEST_TOKEN HPS_TEST_ISSUER_TOKEN HPS_TEST_COACH_NAME HPS_TEST_COACH_PERSONALITY HPS_DEV_RUNTIME HPS_DEV_PROVIDER HPS_DEV_TOKEN_FILE HPS_DEV_ISSUER_TOKEN_FILE HPS_DEV_MODEL HPS_DEV_EXECUTABLE
export VSCODE_CLI=1
EXE=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Contents/Info.plist")
exec "$APP/Contents/MacOS/$EXE" --user-data-dir="$STATE" --extensions-dir="$STATE/extensions" --new-window --skip-welcome --skip-release-notes
