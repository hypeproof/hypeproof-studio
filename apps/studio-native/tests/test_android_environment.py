"""Synthetic readiness controls; an observed ready state is not an application test pass."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("android_environment", Path(__file__).parents[1] / "scripts/android-environment.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
AWAKE = "POWER MANAGER\n  mWakefulness=Awake\n"
WINDOW = "  mCurrentFocus=Window{123 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}\n  isKeyguardShowing=false\n"


class AndroidEnvironment(unittest.TestCase):
    def test_awake_unlocked_focus_is_ready_only_for_starting_tests(self):
        self.assertEqual(module.inspect(WINDOW, AWAKE)["status"], "ready")

    def test_observed_ci_launcher_anr_remains_not_ready(self):
        # Exact foreground value from failed CI43137056162/1. No raw user data.
        window = WINDOW.replace("com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "Application Not Responding: com.google.android.apps.nexuslauncher")
        result = module.inspect(window, AWAKE)
        self.assertEqual((result["status"], result["reason"]), ("not_ready", "foreign_anr"))

    def test_studio_anr_is_not_misclassified_as_foreign_failure(self):
        for package in ["ai.hypeproof.studio.mobile", "ai.hypeproof.studio.mobile.preview"]:
            result = module.inspect(WINDOW.replace("com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "Application Not Responding: " + package), AWAKE)
            self.assertEqual((result["status"], result["reason"]), ("not_ready", "studio_anr"))

    def test_background_anr_text_cannot_override_current_foreground(self):
        self.assertEqual(module.inspect(WINDOW + "  oldWindow=Application Not Responding: old.package\n", AWAKE)["status"], "ready")

    def test_unknown_missing_or_null_state_never_passes(self):
        for window, power in [("", AWAKE), (WINDOW, ""), (WINDOW.replace("isKeyguardShowing", "unknownFormat"), AWAKE), ("mCurrentFocus=null\nisKeyguardShowing=false\n", AWAKE), ("mCurrentFocus=unrecognized\nisKeyguardShowing=false\n", AWAKE)]:
            self.assertEqual(module.inspect(window, power)["status"], "not_ready")

    def test_sleep_and_keyguard_are_distinct_preconditions(self):
        self.assertEqual(module.inspect(WINDOW, AWAKE.replace("Awake", "Asleep"))["reason"], "display_not_awake")
        self.assertEqual(module.inspect(WINDOW.replace("false", "true"), AWAKE)["reason"], "keyguard_showing")

    def test_foreground_error_dialog_is_not_ready(self):
        self.assertEqual(module.inspect(WINDOW.replace("com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "Application Error: fixture.package"), AWAKE)["reason"], "foreground_error_dialog")

    def script_case(self, ready, serial="emulator-5554", phase=None, prebuilt=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            scripts = root / "scripts"; scripts.mkdir()
            (root / "android").mkdir()
            commands = root / "commands"; commands.mkdir()
            for name in ["android-verify.sh", "android-environment.py"]:
                shutil.copyfile(Path(__file__).parents[1] / "scripts" / name, scripts / name)
            fixtures = {
                "gradle": "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$FIXTURE_GRADLE\"\nmkdir -p app/build/outputs/apk/debug app/build/outputs/apk/androidTest/debug\nprintf fixture-not-apk > app/build/outputs/apk/debug/app-debug.apk\nprintf fixture-not-apk > app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk\n",
                "git": "#!/bin/sh\ncase \"$*\" in *rev-parse*) printf '%s\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; esac\n",
                "sleep": "#!/bin/sh\nexit 0\n",
                "adb": """#!/usr/bin/env python3
import json,os,sys
args=sys.argv[3:]
with open(os.environ['FIXTURE_CALLS'],'a') as f:f.write(json.dumps(args)+'\\n')
if args==['shell','getprop','ro.kernel.qemu']:print('1')
elif args==['shell','dumpsys','window']:print(os.environ['FIXTURE_WINDOW'])
elif args==['shell','dumpsys','power']:print('  mWakefulness=Awake')
elif args[:3]==['shell','am','instrument']:print('OK (1 test)')
""",
            }
            for name, content in fixtures.items():
                file = commands / name; file.write_text(content); file.chmod(0o755)
            window = WINDOW if ready else WINDOW.replace("com.google.android.apps.nexuslauncher/.NexusLauncherActivity", "Application Not Responding: com.google.android.apps.nexuslauncher")
            calls = root / "calls.jsonl"; gradle = root / "gradle-calls"
            env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ["PATH"], ANDROID_SERIAL=serial, FIXTURE_CALLS=str(calls), FIXTURE_WINDOW=window, FIXTURE_GRADLE=str(gradle))
            if prebuilt:
                build = subprocess.run(["bash", str(scripts / "android-verify.sh"), "build"], env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
                gradle.unlink()
            result = subprocess.run(["bash", str(scripts / "android-verify.sh"), *([phase] if phase else [])], env=env, capture_output=True, text=True, timeout=15)
            observed = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            diagnostics = root / "evidence/android/failure-environment.json"
            self.gradle_runs = len(gradle.read_text().splitlines()) if gradle.exists() else 0
            return result, observed, json.loads(diagnostics.read_text()) if diagnostics.exists() else None

    def test_actual_shell_will_not_start_instrumentation_behind_foreign_anr(self):
        result, calls, diagnostic = self.script_case(False)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse(any(call[:3] == ["shell", "am", "instrument"] for call in calls))
        self.assertEqual(diagnostic["reason"], "foreign_anr")
        self.assertTrue(all("force-stop" not in call for call in calls))

    def test_ready_fixture_starts_instrumentation_once_without_retry(self):
        result, calls, diagnostic = self.script_case(True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sum(call[:3] == ["shell", "am", "instrument"] for call in calls), 1)
        self.assertIsNone(diagnostic)

    def test_physical_serial_is_refused_before_device_mutation(self):
        result, calls, _ = self.script_case(True, serial="physical-fixture-only")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])

    def test_build_phase_builds_once_and_never_touches_a_device(self):
        result, calls, diagnostic = self.script_case(True, serial="", phase="build")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.gradle_runs, 1)
        self.assertEqual(calls, [])
        self.assertIsNone(diagnostic)

    def test_device_phase_tests_prebuilt_apks_without_rebuilding(self):
        result, calls, _ = self.script_case(True, phase="device", prebuilt=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.gradle_runs, 0)
        self.assertEqual(sum(call[:3] == ["shell", "am", "instrument"] for call in calls), 1)

    def test_device_phase_refuses_missing_build_before_device_mutation(self):
        result, calls, _ = self.script_case(True, phase="device")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Prebuilt input missing", result.stderr)
        self.assertEqual((self.gradle_runs, calls), (0, []))

    def test_unknown_phase_is_refused(self):
        result, calls, _ = self.script_case(True, phase="install")
        self.assertEqual(result.returncode, 2)
        self.assertEqual((self.gradle_runs, calls), (0, []))

    def test_device_phase_still_blocks_on_foreign_anr(self):
        result, calls, diagnostic = self.script_case(False, phase="device", prebuilt=True)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse(any(call[:3] == ["shell", "am", "instrument"] for call in calls))
        self.assertEqual(diagnostic["reason"], "foreign_anr")


if __name__ == "__main__":
    unittest.main()
