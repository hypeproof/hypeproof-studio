#!/bin/bash
# Modes:
#   (none)          full local run: core tests, device build, then every UI case on one simulator.
#   build           CI stage 1: core tests, device build, and one simulator build-for-testing.
#                   No simulator is created. Products go to DerivedData for the shard jobs.
#   shard <i>       CI stage 2: run plan shard <i> with test-without-building on its own simulator.
#                   Needs DerivedData/Build/Products and ../evidence/ios-ui-shard-plan.json.
set -euo pipefail
mode=${1:-full}
shard_index=${2:-}
case "$mode" in
  full|build) ;;
  shard) [[ "$shard_index" =~ ^[1-9]$ ]] || { echo "usage: ios-verify.sh shard <index>" >&2; exit 2; } ;;
  *) echo "usage: ios-verify.sh [build | shard <index>]" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../ios"
mkdir -p ../evidence
xcodebuild -version | tee ../evidence/xcode-version.txt
sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)
if [ "${sdk%%.*}" -lt 27 ]; then echo "Xcode 27+ / iOS 27+ SDK is required for App Store Connect" >&2; exit 2; fi
build_status=0
if [ "$mode" != shard ]; then
printf 'native verification: Swift core tests\n'
swift test 2>&1 | tee ../evidence/swift-tests.log
printf 'native verification: iPhone device build\n'
xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Release -destination 'generic/platform=iOS' -derivedDataPath DerivedData-device CODE_SIGNING_ALLOWED=NO build 2>&1 | tee ../evidence/device-build.log || build_status=$?
if [ "$build_status" -ne 0 ]; then
  python3 ../scripts/collect-native-journeys.py --source-sha "${GITHUB_SHA:-$(git rev-parse HEAD)}" --build-log ../evidence/device-build.log --build-exit "$build_status" --simulator-log ../evidence/simulator-test.log --test-exit 125 --output ../evidence/native-journeys.json || true
  exit "$build_status"
fi
printf 'native verification: actual app and real Xcode push metadata controls\n'
python3 ../scripts/check-ios-push-metadata.py \
  --app-info DerivedData-device/Build/Products/Release-iphoneos/HPStudio.app/Info.plist \
  --evidence ../evidence/push-metadata.json
fi
if [ "$mode" = build ]; then
  # One simulator build for every shard, for the runner's architecture only: a generic
  # destination has no active architecture, so ARCHS names it. Simulator Keychain checks
  # require an actual app identity, so the products are ad-hoc signed as in the full run.
  printf 'native verification: iPhone simulator build-for-testing\n'
  xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build-for-testing 2>&1 | tee ../evidence/simulator-build.log
  python3 ../scripts/ios-ui-shards.py plan --ui-tests UITests --shards "${IOS_UI_SHARDS:-3}" --output ../evidence/ios-ui-shard-plan.json
  exit 0
fi
shard_arguments=()
xctestrun=
if [ "$mode" = shard ]; then
  # The plan and products come from the build job; refuse to run a shard against anything else.
  while IFS= read -r argument; do shard_arguments+=("$argument"); done < <(python3 ../scripts/ios-ui-shards.py arguments --plan ../evidence/ios-ui-shard-plan.json --index "$shard_index")
  [ "${#shard_arguments[@]}" -gt 0 ] || { echo "Shard $shard_index has no cases" >&2; exit 2; }
  xctestruns=(DerivedData/Build/Products/*.xctestrun)
  [ "${#xctestruns[@]}" -eq 1 ] && [ -f "${xctestruns[0]}" ] || { echo "Expected one .xctestrun from build-for-testing" >&2; exit 2; }
  xctestrun=${xctestruns[0]}
fi
# Use only a phone advertised by an installed matching runtime.
selection=$(xcrun simctl list runtimes --json | python3 ../scripts/select-ios-simulator.py "$sdk")
read -r device_type runtime <<< "$selection"

device=$(xcrun simctl create "HP-Studio-${GITHUB_RUN_ID:-local}" "$device_type" "$runtime")
cleanup_simulator() {
  local original_status=$1 cleanup_status=0
  trap - EXIT
  # Only the simulator this invocation created; neither cleanup may consume the job's
  # remaining time indefinitely or replace the build/test result.
  python3 - "$device" <<'PY' || cleanup_status=$?
import os
import signal
import subprocess
import sys
import uuid

device = sys.argv[1]
def interrupted(signum, _frame):
    print(f"simulator cleanup: interrupted by signal {signum}", flush=True)
    raise SystemExit(128 + signum)

for signum in (signal.SIGTERM, signal.SIGINT):
    signal.signal(signum, interrupted)

with open("../evidence/simulator-cleanup.log", "w", buffering=1) as evidence:
    def log(message):
        print(f"simulator cleanup: {message}", flush=True)
        print(f"simulator cleanup: {message}", file=evidence, flush=True)

    def stop_owned(child):
        # start_new_session gives this command its own process group. Stop any remaining
        # descendants too; they must not hold an output pipe or outlive this cleanup.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            log("owned child did not reap within 2s after SIGKILL")

    try:
        if str(uuid.UUID(device)).lower() != device.lower():
            raise ValueError("noncanonical UUID")
    except ValueError:
        log("skipped invalid owned device UUID")
    else:
        for action in ("shutdown", "delete"):
            log(f"{action} {device} started (limit 30s)")
            try:
                child = subprocess.Popen(["xcrun", "simctl", action, device],
                                         start_new_session=True, stdout=evidence, stderr=subprocess.STDOUT)
                try:
                    result = child.wait(timeout=30)
                    log(f"{action} completed exit={result}")
                except subprocess.TimeoutExpired:
                    log(f"{action} timed out after 30s; stopping owned process group")
                finally:
                    stop_owned(child)
            except OSError as error:
                log(f"{action} cleanup error: {error}")
PY
  printf 'simulator cleanup: helper exit=%s; preserving original exit=%s\n' "$cleanup_status" "$original_status" || true
  printf 'simulator cleanup: helper exit=%s; preserving original exit=%s\n' "$cleanup_status" "$original_status" >> ../evidence/simulator-cleanup.log || true
  exit "$original_status"
}
trap 'cleanup_simulator "$?"' EXIT
printf 'native verification: simulator boot\n'
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
# Warm the booted simulator with a system app, never the app under test: the first UI case
# must still see a fresh install. A cold first launch has stalled the first case before.
printf 'native verification: simulator warm-up\n'
xcrun simctl launch "$device" com.apple.Preferences > /dev/null
xcrun simctl terminate "$device" com.apple.Preferences || true
test_status=0
# Simulator Keychain checks require an actual app identity. No distribution key is used.
common_test=(-destination "platform=iOS Simulator,id=$device" -resultBundlePath ../evidence/Studio.xcresult -parallel-testing-enabled NO -destination-timeout 60 -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240)
if [ "$mode" = shard ]; then
  printf 'native verification: iPhone simulator journeys, shard %s\n' "$shard_index"
  xcodebuild -xctestrun "$xctestrun" "${common_test[@]}" "${shard_arguments[@]}" test-without-building 2>&1 | tee ../evidence/simulator-test.log || test_status=$?
else
  printf 'native verification: iPhone simulator journeys\n'
  xcodebuild -project HPStudio.xcodeproj -scheme HPStudio -configuration Debug -derivedDataPath DerivedData "${common_test[@]}" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test 2>&1 | tee ../evidence/simulator-test.log || test_status=$?
fi
# Export the actual per-journey screenshots, including failed attempts, so review
# does not substitute the unrelated post-suite relaunch image for first use.
attachment_status=0
xcrun xcresulttool export attachments --path ../evidence/Studio.xcresult --output-path ../evidence/journey-attachments > ../evidence/attachment-export.log 2>&1 || attachment_status=$?
printf 'attachment_export_exit=%s\n' "$attachment_status" >> ../evidence/attachment-export.log
sim_app=DerivedData/Build/Products/Debug-iphonesimulator/HPStudio.app
codesign -d --entitlements :- "$sim_app" > ../evidence/simulator-entitlements.plist 2> ../evidence/simulator-signature.log || true
if [ "$mode" = shard ]; then
  # Journey and sign-in records are written once, by the ios job, from every shard's log.
  printf '{"shard": %s, "test_exit": %s, "attachment_exit": %s}\n' "$shard_index" "$test_status" "$attachment_status" > ../evidence/shard-result.json
  if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
  if [ "$attachment_status" -ne 0 ]; then exit "$attachment_status"; fi
  codesign --verify --strict "$sim_app" >> ../evidence/simulator-signature.log 2>&1
  if [ "$shard_index" = 1 ]; then
    xcrun simctl launch "$device" ai.hypeproof.studio.mobile
    sleep 2
    xcrun simctl io "$device" screenshot ../evidence/native-iphone.png
  fi
  printf '%s\n' "source=${GITHUB_SHA:-local}" "runtime=$runtime" "device=$device" "shard=$shard_index" "physical_iphone=NOT_RUN" "testflight=NOT_RUN_BY_THIS_CHECK" > ../evidence/identity.txt
  exit 0
fi
journey_status=0
python3 ../scripts/collect-native-journeys.py --source-sha "${GITHUB_SHA:-$(git rev-parse HEAD)}" --build-log ../evidence/device-build.log --build-exit "$build_status" --simulator-log ../evidence/simulator-test.log --test-exit "$test_status" --output ../evidence/native-journeys.json || journey_status=$?
# Hop-by-hop signed-in journey record for this exact source. Always written, never fatal here:
# a failing case already fails the suite above, and PARTIAL/NOT_RUN only restricts external distribution.
signin_status=0
python3 ../scripts/collect-signin-journey.py --source-sha "${NATIVE_SOURCE_HEAD:-${GITHUB_SHA:-$(git rev-parse HEAD)}}" --run-id "${GITHUB_RUN_ID:-1}" --run-attempt "${GITHUB_RUN_ATTEMPT:-1}" --simulator-log ../evidence/simulator-test.log --test-exit "$test_status" --output ../evidence/signin-journey.json || signin_status=$?
printf 'signin_journey_collect_exit=%s\n' "$signin_status" >> ../evidence/attachment-export.log
if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
if [ "$journey_status" -ne 0 ]; then exit "$journey_status"; fi
if [ "$attachment_status" -ne 0 ]; then exit "$attachment_status"; fi
codesign --verify --strict "$sim_app" >> ../evidence/simulator-signature.log 2>&1
xcrun simctl launch "$device" ai.hypeproof.studio.mobile
sleep 2
xcrun simctl io "$device" screenshot ../evidence/native-iphone.png
printf '%s\n' "source=${GITHUB_SHA:-local}" "runtime=$runtime" "device=$device" "physical_iphone=NOT_RUN" "testflight=NOT_RUN_BY_THIS_CHECK" > ../evidence/identity.txt
