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


FIXTURE = Path(__file__).parent / "fixtures/android-compositing-loss-45814588860.txt"
LOST = ("ai.hypeproof.studio.UiSync$DeviceFocusLost: device focus lost (device state, not a product result): {test}: "
        "Espresso found no root with window focus [at failure, before teardown: WM mCurrentFocus=Window{{ac7efa7 u0 app.pkg/app.Main}}; "
        "mFocusedApp=ActivityRecord{{dc57819 u0 app.pkg/app.Main t23}} | InputDispatcher FocusedWindows: <none> | "
        "FocusRequests: displayId=0, name='ac7efa7 app.pkg/app.Main' result='{request}' | "
        "app input windows: 7: name={name} app.pkg/app.Main, id=460, displayId=0, inputConfig={config}, alpha={alpha}]")


def run(*tests):
    """`am instrument -r` output; each test is (name, code, first stack line or None)."""
    lines = []
    for number, (name, code, stack) in enumerate(tests, 1):
        head = ["INSTRUMENTATION_STATUS: class=ai.hypeproof.studio.JourneyTest", f"INSTRUMENTATION_STATUS: current={number}",
                f"INSTRUMENTATION_STATUS: test={name}"]
        lines += head + ["INSTRUMENTATION_STATUS_CODE: 1"] + head
        if stack is not None:
            lines += ["INSTRUMENTATION_STATUS: stack=" + stack, "\tat ai.hypeproof.studio.UiSync$1.evaluate(UiSync.java:481)"]
        lines.append(f"INSTRUMENTATION_STATUS_CODE: {code}")
    return "\n".join(lines) + "\n"


def lost(test, request="NOT_VISIBLE", name="ac7efa7", config="NOT_VISIBLE", alpha="0"):
    return LOST.format(test=test, request=request, name=name, config=config, alpha=alpha)


class CompositingLoss(unittest.TestCase):
    """Reporting only: the classification never changes a test result or the exit code."""

    def test_real_run_45814588860_excerpt_is_observed_from_test_7(self):
        result = module.compositing_loss(FIXTURE.read_text())
        self.assertEqual(result["state"], "observed")
        self.assertEqual(result["onset"], {"test": "QuestionJourneyTest#guestDictationAndBackgroundPreserveWordsWithoutAnAccountOrSend",
                                           "window": "ai.hypeproof.studio.mobile.preview/ai.hypeproof.studio.QuestionActivity"})
        self.assertEqual(result["same_cause_tests"], ["QuestionJourneyTest#guestDictationAndBackgroundPreserveWordsWithoutAnAccountOrSend",
                                                      "QuestionJourneyTest#deniedLoginAndCorruptGuestFileRemainLocalAndIntact"])
        self.assertEqual((result["failed_tests"], result["other_failed_tests"]), (2, []))

    def test_passing_run_is_not_observed(self):
        result = module.compositing_loss(run(("a", 0, None), ("b", 0, None)))
        self.assertEqual((result["state"], result["failed_tests"], result["same_cause_tests"]), ("not_observed", 0, []))

    def test_each_part_of_the_signature_is_required(self):
        for stack in [lost("t", alpha="1"), lost("t", alpha="0.5"), lost("t", request="OK"),
                      lost("t", config="NOT_FOCUSABLE"), lost("t", name="b701fe1"),
                      lost("t").replace("device focus lost (device state, not a product result)", "assertion failed"),
                      lost("t").split(" | app input windows:")[0] + "]",
                      # The pre-#4448 message (run 44994131331) has only the focus after teardown.
                      "ai.hypeproof.studio.UiSync$DeviceFocusLost: device focus lost (device state, not a product result): t: Espresso found no root "
                      "with window focus [mCurrentFocus=Window{562be39 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}]"]:
            with self.subTest(stack=stack[-90:]):
                result = module.compositing_loss(run(("t", -2, stack)))
                self.assertEqual((result["state"], result["other_failed_tests"]), ("not_observed", ["JourneyTest#t"]))

    def test_not_visible_among_other_flags_matches(self):
        result = module.compositing_loss(run(("t", -2, lost("t", config="NOT_VISIBLE | NOT_FOCUSABLE"))))
        self.assertEqual(result["same_cause_tests"], ["JourneyTest#t"])

    def test_other_failures_stay_separate_before_and_after_onset(self):
        result = module.compositing_loss(run(("early", -2, "java.lang.AssertionError: draft changed"),
                                             ("onset", -2, lost("onset")), ("pass", 0, None),
                                             ("later", -1, "java.lang.IllegalStateException: boom"),
                                             ("same", -2, lost("same"))))
        self.assertEqual(result["onset"]["test"], "JourneyTest#onset")
        self.assertEqual(result["same_cause_tests"], ["JourneyTest#onset", "JourneyTest#same"])
        self.assertEqual(result["other_failed_tests"], ["JourneyTest#early", "JourneyTest#later"])
        self.assertEqual(result["failed_tests"], 4)

    def test_ignored_and_assumption_results_are_not_failures(self):
        result = module.compositing_loss(run(("ignored", -3, None), ("assumed", -4, lost("assumed"))))
        self.assertEqual((result["failed_tests"], result["state"]), (0, "not_observed"))


if __name__ == "__main__":
    unittest.main()
