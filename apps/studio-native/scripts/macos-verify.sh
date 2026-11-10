#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../ios"
mkdir -p ../evidence/macos
evidence="$PWD/../evidence/macos"
git rev-parse HEAD > "$evidence/source.txt"
xcodebuild -version > "$evidence/xcode-version.txt"
# This produces a real Mac Catalyst .app. Signing/TestFlight acceptance is separate.
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -derivedDataPath DerivedData-macos CODE_SIGNING_ALLOWED=NO \
  build > "$evidence/build.log" 2>&1
app="$PWD/DerivedData-macos/Build/Products/Release-maccatalyst/HPStudio.app"
test -d "$app"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" > "$evidence/bundle-id.txt"
test "$(cat "$evidence/bundle-id.txt")" = ai.hypeproof.studio.mobile
file "$app/Contents/MacOS/HPStudio" > "$evidence/executable.txt"
ditto -c -k --keepParent "$app" "$evidence/HP-Studio-macOS-unsigned.zip"
