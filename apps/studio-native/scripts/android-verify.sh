#!/usr/bin/env bash
set -euo pipefail
native_root="$(cd "$(dirname "$0")/.." && pwd)"
evidence="$native_root/evidence/android"
mkdir -p "$evidence"
cd "$native_root/android"
gradle --no-daemon --max-workers=2 --console=plain :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest > "$evidence/build.log" 2>&1
if [[ -z "${ANDROID_SERIAL:-}" || "$ANDROID_SERIAL" != emulator-* ]]; then
  echo 'Android UI tests require ANDROID_SERIAL pointing to a disposable emulator.' >&2
  exit 2
fi
if [[ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]]; then
  echo 'Refusing to replace records on a physical device.' >&2
  exit 2
fi
# Gradle may leave a freshly booted emulator asleep or behind its keyguard.
# Only the disposable emulator verified above may be prepared this way.
capture_failure() {
  status=$?
  trap - EXIT
  if [[ "$status" != 0 ]]; then
    adb -s "$ANDROID_SERIAL" shell dumpsys window > "$evidence/failure-window.txt" 2>&1 || true
    adb -s "$ANDROID_SERIAL" shell dumpsys power > "$evidence/failure-power.txt" 2>&1 || true
    adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$evidence/failure-screen.png" 2>/dev/null || true
    python3 "$native_root/scripts/android-environment.py" --window "$evidence/failure-window.txt" --power "$evidence/failure-power.txt" --output "$evidence/failure-environment.json" || true
  fi
  exit "$status"
}
trap capture_failure EXIT
adb -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_WAKEUP
adb -s "$ANDROID_SERIAL" shell wm dismiss-keyguard
adb -s "$ANDROID_SERIAL" shell settings put system screen_off_timeout 1800000
{
  git -C "$native_root" rev-parse HEAD
  git -C "$native_root" diff --name-only
  hostname
  adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.release
  adb -s "$ANDROID_SERIAL" shell getprop ro.build.fingerprint
  sha256sum app/build/outputs/apk/debug/app-debug.apk
} > "$evidence/identity.txt"
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk > "$evidence/install.log"
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >> "$evidence/install.log"
# Observe readiness after installs and before instrumentation. A booted emulator
# can still have a foreign ANR dialog stealing focus. Preserve each observation;
# never dismiss a dialog, retry a failed test, or turn a failed run into PASS.
ready=0
for attempt in 1 2 3 4 5 6; do
  adb -s "$ANDROID_SERIAL" shell dumpsys window > "$evidence/readiness-$attempt-window.txt"
  adb -s "$ANDROID_SERIAL" shell dumpsys power > "$evidence/readiness-$attempt-power.txt"
  if python3 "$native_root/scripts/android-environment.py" --window "$evidence/readiness-$attempt-window.txt" --power "$evidence/readiness-$attempt-power.txt" --output "$evidence/readiness-$attempt.json"; then
    ready=1
    break
  fi
  if [[ "$attempt" != 6 ]]; then sleep 2; fi
done
if [[ "$ready" != 1 ]]; then
  echo 'Disposable emulator is not ready; instrumentation was not started. Inspect the retained readiness and failure evidence.' >&2
  exit 2
fi
adb -s "$ANDROID_SERIAL" shell am instrument -w -r ai.hypeproof.studio.mobile.preview.test/androidx.test.runner.AndroidJUnitRunner > "$evidence/native-ui.log" 2>&1
python3 - "$evidence/native-ui.log" <<'PY'
import re,sys
log=open(sys.argv[1]).read()
result=re.search(r'OK \((\d+) tests?\)',log)
if not result or int(result.group(1))==0 or re.search(r'INSTRUMENTATION_STATUS_CODE: -\d+',log):
    print(log[-12000:]);sys.exit('Native Android tests did not all execute successfully')
print(result.group(0))
PY
adb -s "$ANDROID_SERIAL" pull /sdcard/Android/data/ai.hypeproof.studio.mobile.preview/files/evidence "$evidence/screenshots"
echo "Android native checks passed; evidence: $evidence"
