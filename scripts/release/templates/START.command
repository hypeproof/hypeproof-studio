#!/bin/bash
# Starts the side-by-side HypeProof Studio @@VERSION@@ test install with its own profile.
# Written by install-mac.sh (kit layout); also shipped in HypeProof-@@TAG@@-Test-Kit.zip.
#
# Secrets go to the macOS keychain (the default). --use-inmemory-secretstorage broke the
# free start on 2026-10-19: the window reloads into the workspace, the claim and the
# install id are lost, a second claim mints a new seat and the folder binding refuses it.
# HPS_KIT_INMEMORY_SECRETS=1 still turns it on, explicitly, for builds without free start.
set -euo pipefail
VERSION="@@VERSION@@"
APP="$HOME/Applications/@@KIT_DIR_NAME@@/HypeProof Studio.app"
STATE="$HOME/Library/Application Support/HPS-$VERSION"
[[ -d "$APP" && -f "$STATE/.hps-kit-$VERSION" ]] || { echo "먼저 INSTALL-$VERSION.command 또는 한 줄 설치 명령을 실행하세요."; exit 1; }
unset HPS_TEST_E2E HPS_TEST_TOKEN HPS_TEST_ISSUER_TOKEN HPS_TEST_COACH_NAME HPS_TEST_COACH_PERSONALITY HPS_DEV_RUNTIME HPS_DEV_PROVIDER HPS_DEV_TOKEN_FILE HPS_DEV_ISSUER_TOKEN_FILE HPS_DEV_MODEL HPS_DEV_EXECUTABLE
export VSCODE_CLI=1
EXTRA=()
if [[ "${HPS_KIT_INMEMORY_SECRETS:-0}" == 1 ]]; then EXTRA+=(--use-inmemory-secretstorage); fi
EXE=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Contents/Info.plist")
exec "$APP/Contents/MacOS/$EXE" --user-data-dir="$STATE" --extensions-dir="$STATE/extensions" ${EXTRA[@]+"${EXTRA[@]}"} --new-window --skip-welcome --skip-release-notes
