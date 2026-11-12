#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../ios"
mkdir -p ../evidence
xcodebuild -version | tee ../evidence/xcode-version.txt
sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)
if [ "${sdk%%.*}" -lt 26 ]; then echo "Xcode 26+ / iOS 26+ SDK is required for App Store Connect" >&2; exit 2; fi
swift test > ../evidence/swift-tests.log 2>&1
build_status=0
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Release -destination 'generic/platform=iOS' -derivedDataPath DerivedData-device CODE_SIGNING_ALLOWED=NO build > ../evidence/device-build.log 2>&1 || build_status=$?
if [ "$build_status" -ne 0 ]; then
  python3 ../scripts/collect-native-journeys.py --source-sha "${GITHUB_SHA:-$(git rev-parse HEAD)}" --build-log ../evidence/device-build.log --build-exit "$build_status" --simulator-log ../evidence/simulator-test.log --test-exit 125 --output ../evidence/native-journeys.json || true
  exit "$build_status"
fi
runtime=$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; sdk=sys.argv[1]; r=[x for x in json.load(sys.stdin)["runtimes"] if x["isAvailable"] and ".iOS-" in x["identifier"] and x["version"].split(".")[:2]==sdk.split(".")[:2]]; print(r[-1]["identifier"])' "$sdk")
device=$(xcrun simctl create "HP-Studio-${GITHUB_RUN_ID:-local}" com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$runtime")
trap 'xcrun simctl shutdown "$device" >/dev/null 2>&1 || true; xcrun simctl delete "$device" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
test_status=0
# Simulator Keychain checks require an actual app identity. No distribution key is used.
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Debug -destination "platform=iOS Simulator,id=$device" -derivedDataPath DerivedData -resultBundlePath ../evidence/Studio.xcresult -parallel-testing-enabled NO -destination-timeout 60 -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test > ../evidence/simulator-test.log 2>&1 || test_status=$?
sim_app=DerivedData/Build/Products/Debug-iphonesimulator/HPStudio.app
codesign -d --entitlements :- "$sim_app" > ../evidence/simulator-entitlements.plist 2> ../evidence/simulator-signature.log || true
journey_status=0
python3 ../scripts/collect-native-journeys.py --source-sha "${GITHUB_SHA:-$(git rev-parse HEAD)}" --build-log ../evidence/device-build.log --build-exit "$build_status" --simulator-log ../evidence/simulator-test.log --test-exit "$test_status" --output ../evidence/native-journeys.json || journey_status=$?
if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
if [ "$journey_status" -ne 0 ]; then exit "$journey_status"; fi
codesign --verify --strict "$sim_app" >> ../evidence/simulator-signature.log 2>&1
xcrun simctl launch "$device" ai.hypeproof.studio.mobile
sleep 2
xcrun simctl io "$device" screenshot ../evidence/native-iphone.png
printf '%s\n' "source=${GITHUB_SHA:-local}" "runtime=$runtime" "device=$device" "physical_iphone=NOT_RUN" "testflight=NOT_RUN_BY_THIS_CHECK" > ../evidence/identity.txt
