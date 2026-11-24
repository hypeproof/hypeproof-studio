#!/bin/bash
# CI stage 3 (any OS): merge the UI shard evidence, then write the journey and signed-in
# records exactly once, from every shard's log. Fails unless the build and every planned
# shard succeeded and every planned case started in its own shard.
# Inputs: IOS_BUILD_RESULT, IOS_UI_RESULT, IOS_VOICE_RESULT (job results; the real-voice job
# uploads the plan's dedicated row, the one after the shards, under the shard artifact name; a
# nightly plan has no such row and no voice job, #4432 stage 3), IOS_SHARD_ARTIFACTS (one folder per
# downloaded studio-ios-ui-shard-<i>-<run>-<attempt> artifact), and the build artifact already
# unpacked into apps/studio-native.
set -euo pipefail
cd "$(dirname "$0")/../ios"
mkdir -p ../evidence
source_sha=${GITHUB_SHA:-$(git rev-parse HEAD)}
plan=../evidence/ios-ui-shard-plan.json
shard_root=$(mktemp -d)
merge_status=0
test_status=125
attachment_status=125
if [ -f "$plan" ]; then
  # Artifact folders carry run/attempt in their names; the merge reads shard-<i>.
  for directory in "${IOS_SHARD_ARTIFACTS:-/nonexistent}"/studio-ios-ui-shard-*; do
    [ -d "$directory" ] || continue
    name=$(basename "$directory")
    index=${name#studio-ios-ui-shard-}
    index=${index%%-*}
    [[ "$index" =~ ^[1-9]$ ]] || { echo "Unexpected shard artifact $name" >&2; exit 2; }
    mv "$directory" "$shard_root/shard-$index"
  done
  python3 ../scripts/ios-ui-shards.py merge --plan "$plan" --shard-root "$shard_root" --evidence ../evidence || merge_status=$?
  # A merge that could not even write its record leaves both exits at 125 (did not run).
  if [ -f ../evidence/ios-ui-shards.json ]; then
    exits=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["test_exit"], d["attachment_exit"])' ../evidence/ios-ui-shards.json) || exits='125 125'
    read -r test_status attachment_status <<< "$exits"
  fi
  # Keep each shard's own logs and result bundle beside the merged layout. Its attachment
  # export is already merged into ../evidence/journey-attachments, so it is not copied twice.
  for directory in "$shard_root"/shard-*; do
    [ -d "$directory" ] || continue
    rm -rf "$directory/journey-attachments" "$directory/ios-ui-shard-plan.json"
    mkdir -p ../evidence/shards
    mv "$directory" "../evidence/shards/$(basename "$directory")"
  done
  # Shard 1 takes the post-suite launch screenshot; keep it where the single job put it.
  for name in native-iphone.png identity.txt; do
    if [ -f "../evidence/shards/shard-1/$name" ]; then cp "../evidence/shards/shard-1/$name" "../evidence/$name"; fi
  done
else
  echo "::error::No UI shard plan: the iOS build job did not finish (result ${IOS_BUILD_RESULT:-unknown})"
  : > ../evidence/simulator-test.log
fi
# The device build exit, as ios-verify.sh passed it: 0 only with Xcode's own success line.
build_status=1
if [ -f ../evidence/device-build.log ] && grep -qx '\*\* BUILD SUCCEEDED \*\*' ../evidence/device-build.log; then build_status=0; fi
# Only a nightly plan leaves out the real-voice row. Without a plan the build failed, and the voice job stays required.
ui_set=all
plan_arguments=()
if [ -f "$plan" ]; then
  ui_set=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("set", "all"))' "$plan") || ui_set=all
  plan_arguments=(--plan "$plan")
fi
journey_status=0
if [ ! -e ../evidence/native-journeys.json ]; then
  python3 ../scripts/collect-native-journeys.py --source-sha "$source_sha" --build-log ../evidence/device-build.log --build-exit "$build_status" --simulator-log ../evidence/simulator-test.log --test-exit "$test_status" --output ../evidence/native-journeys.json ${plan_arguments[@]+"${plan_arguments[@]}"} || journey_status=$?
else
  # The build job wrote it after a failed device build; that record stands.
  journey_status=1
fi
signin_status=0
python3 ../scripts/collect-signin-journey.py --source-sha "${NATIVE_SOURCE_HEAD:-$source_sha}" --run-id "${GITHUB_RUN_ID:-1}" --run-attempt "${GITHUB_RUN_ATTEMPT:-1}" --simulator-log ../evidence/simulator-test.log --test-exit "$test_status" --output ../evidence/signin-journey.json || signin_status=$?
printf 'signin_journey_collect_exit=%s\n' "$signin_status" >> ../evidence/attachment-export.log
if [ "${IOS_BUILD_RESULT:-}" != success ]; then echo "::error::iOS build job result: ${IOS_BUILD_RESULT:-unknown}"; exit 1; fi
if [ "${IOS_UI_RESULT:-}" != success ]; then echo "::error::iOS UI shard jobs result: ${IOS_UI_RESULT:-unknown}"; fi
if [ "$ui_set" != nightly ] && [ "${IOS_VOICE_RESULT:-}" != success ]; then echo "::error::iOS real-voice job result: ${IOS_VOICE_RESULT:-unknown}"; fi
if [ "$test_status" -ne 0 ]; then exit "$test_status"; fi
if [ "$merge_status" -ne 0 ]; then exit "$merge_status"; fi
if [ "$journey_status" -ne 0 ]; then exit "$journey_status"; fi
if [ "$attachment_status" -ne 0 ]; then exit "$attachment_status"; fi
if [ "${IOS_UI_RESULT:-}" != success ]; then exit 1; fi
if [ "$ui_set" != nightly ] && [ "${IOS_VOICE_RESULT:-}" != success ]; then exit 1; fi
