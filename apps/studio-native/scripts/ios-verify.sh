#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../ios"
mkdir -p ../evidence
swift test > ../evidence/swift-tests.log 2>&1
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Release -destination 'generic/platform=iOS' -derivedDataPath DerivedData-device CODE_SIGNING_ALLOWED=NO build > ../evidence/device-build.log 2>&1
runtime=$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["isAvailable"] and ".iOS-" in x["identifier"]]; print(sorted(r,key=lambda x:tuple(map(int,x["version"].split("."))))[-1]["identifier"])')
device=$(xcrun simctl create "HP-Studio-${GITHUB_RUN_ID:-local}" com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$runtime")
trap 'xcrun simctl shutdown "$device" >/dev/null 2>&1 || true; xcrun simctl delete "$device" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Debug -destination "platform=iOS Simulator,id=$device" -derivedDataPath DerivedData -resultBundlePath ../evidence/Studio.xcresult -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test > ../evidence/simulator-test.log 2>&1
xcrun simctl io "$device" screenshot ../evidence/native-iphone.png
printf '%s\n' "source=${GITHUB_SHA:-local}" "runtime=$runtime" "device=$device" "physical_iphone=NOT_RUN" "testflight=BLOCKED_NO_MEMBERSHIP" > ../evidence/identity.txt
