"""Actual bootstrap subprocess controls with a stateful SDK boundary, not Android acceptance."""
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
MOCK = r'''#!/usr/bin/env python3
import json,os,pathlib,signal,subprocess,sys,time
s=pathlib.Path(os.environ['MOCK_STATE']); mode=os.environ['MOCK_MODE']
def put(name,value,delay=0):
 # Readers see no file or the whole value, never an empty one (os.replace is atomic).
 t=s/(name+'.tmp');t.write_text(value);time.sleep(delay);os.replace(t,s/name)
tool=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
with (s/'calls.jsonl').open('a') as f: f.write(json.dumps([tool,*args])+'\n')
if tool=='avdmanager':
 name=args[args.index('--name')+1]; p=pathlib.Path(os.environ['ANDROID_AVD_HOME'])/(name+'.avd');p.mkdir()
 (p/'config.ini').write_text('fixture=1\n')
elif tool=='emulator':
 put('pid',str(os.getpid()));put('name',args[args.index('-avd')+1],float(os.environ.get('MOCK_NAME_DELAY','0')))
 def stop(*_):
  (s/'stopped').write_text('owned emulator terminated');sys.exit(0)
 signal.signal(signal.SIGTERM,stop)
 if mode in ['resistant_child','leader_already_exited']:
  child=subprocess.Popen([sys.executable,'-c',"import signal,time,pathlib,os; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(os.environ['MOCK_STATE'],'child-ready').touch(); time.sleep(60)"])
  (s/'child-pid').write_text(str(child.pid))
  while not (s/'child-ready').exists():time.sleep(.01)
  if mode=='leader_already_exited':sys.exit(7)
 if mode=='child_exit': time.sleep(.1);sys.exit(7)
 while True:time.sleep(.02)
elif tool=='adb':
 args=args[2:]
 if not (s/'name').exists():sys.exit(1)
 if args==['emu','avd','name']:print('foreign-avd' if mode=='foreign_serial' else (s/'name').read_text());print('OK')
 elif args==['shell','getprop','ro.kernel.qemu']:print('0' if mode=='not_emulator' else '1')
 elif args==['shell','getprop','sys.boot_completed']:
  if mode=='hung_adb':print('partial adb observation',flush=True);time.sleep(60)
  print('0' if mode=='boot_timeout' else '1')
 elif args==['shell','dumpsys','window']:
  n=int((s/'windows').read_text())+1 if (s/'windows').exists() else 1;(s/'windows').write_text(str(n))
  focus='Window{123 u0 launcher/.Home}'
  if mode=='no_focus' or (mode=='unstable' and n in [1,3]):focus='null'
  if mode=='foreign_anr':focus='Window{123 u0 Application Not Responding: com.google.android.apps.nexuslauncher}'
  if mode=='studio_anr':focus='Window{123 u0 Application Not Responding: ai.hypeproof.studio.mobile.preview}'
  print('mCurrentFocus='+focus+'\nisKeyguardShowing=false')
 elif args==['shell','dumpsys','power']:print('mWakefulness=Awake')
 elif args==['shell','getprop','ro.build.fingerprint']:print('fixture fingerprint')
 elif args==['shell','device_config','set_sync_disabled_for_tests','persistent']:
  if mode!='sync_not_disabled':(s/'sync').write_text('persistent')
 elif args==['shell','device_config','get_sync_disabled_for_tests']:print((s/'sync').read_text() if (s/'sync').exists() else 'none')
 elif args[:1]==['logcat'] and '-d' not in args:
  (s/'logcat-pid').write_text(str(os.getpid()))
  print('11-26 11:58:57.000 552 572 V WindowManager: stream line before tests',flush=True)
  if mode=='logcat_exits':sys.exit(3)
  while not (s/'verification').exists():time.sleep(.01)
  print('11-26 11:59:02.000 552 572 V WindowManager: stream line during tests',flush=True)
  while True:time.sleep(.02)
 elif args[:3]==['shell','pm','disable-user']:
  pkg=args[-1]
  if mode=='messaging_absent':print('Exception occurred while executing \'disable-user\':\njava.lang.IllegalArgumentException: Unknown package: '+pkg);sys.exit(255)
  elif mode=='disable_fails':print('Error: java.lang.SecurityException: Shell cannot change component state');sys.exit(1)
  else:print('Package '+pkg+' new state: disabled-user')
 else:print('retained diagnostic fixture')
'''
VERIFY = r'''#!/bin/bash
printf 'started %s\n' "$*" >> "$MOCK_STATE/verification"
if [ "$MOCK_MODE" = verify_failure ]; then exit 23; fi
if [ -f "$MOCK_STATE/native-ui.log" ]; then
  mkdir -p "$(dirname "$0")/../evidence/android"; cp "$MOCK_STATE/native-ui.log" "$(dirname "$0")/../evidence/android/native-ui.log"
fi
if [ "$MOCK_MODE" = verify_ui_failure ]; then sleep .3; exit 1; fi
if [ "$MOCK_MODE" = emulator_dies_in_test ]; then kill -TERM "$(cat "$MOCK_STATE/pid")"; sleep 2; fi
if [ "$MOCK_MODE" = interrupt_test ] || [ "$MOCK_MODE" = test_timeout ]; then sleep 60; fi
exit 0
'''


class AndroidEmulatorBootstrap(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = self.root / "native"
        scripts = self.native / "scripts"; scripts.mkdir(parents=True)
        for name in ("android-emulator.py", "android-environment.py"):
            shutil.copyfile(SCRIPTS / name, scripts / name)
        (scripts / "android-verify.sh").write_text(VERIFY)
        self.sdk = self.root / "sdk"
        for name in ("cmdline-tools/latest/bin/avdmanager", "emulator/emulator", "platform-tools/adb"):
            p = self.sdk / name; p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(MOCK); p.chmod(0o755)
        self.state = self.root / "state"; self.state.mkdir()
        self.children = []
        self.port = None
        for port in range(5554, 5682, 2):
            with socket.socket() as first, socket.socket() as second:
                try:
                    first.bind(("127.0.0.1", port)); second.bind(("127.0.0.1", port + 1))
                    self.port = port; break
                except OSError:
                    continue
        self.assertIsNotNone(self.port)

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate(); child.wait(timeout=8)
        if (self.state / "child-pid").exists():
            try: os.kill(int((self.state / "child-pid").read_text()), signal.SIGKILL)
            except ProcessLookupError: pass
        self.temp.cleanup()

    def start(self, mode, boot=3, test=3, name_delay=0):
        p = subprocess.Popen([sys.executable, str(self.native / "scripts/android-emulator.py"),
                              "--sdk-root", str(self.sdk), "--work-dir", str(self.root / "work"),
                              "--port", str(self.port), "--boot-timeout", str(boot),
                              "--test-timeout", str(test), "--poll-interval", ".01"],
                             env=dict(os.environ, MOCK_STATE=str(self.state), MOCK_MODE=mode,
                                      MOCK_NAME_DELAY=str(name_delay), PYTHONDONTWRITEBYTECODE="1"), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(p)
        return p

    def finish(self, process):
        stdout, stderr = process.communicate(timeout=10)
        path = self.native / "evidence/android/bootstrap/receipt.json"
        self.assertTrue(path.exists(), (stdout + stderr).decode())
        receipt = json.loads(path.read_text())
        calls = [json.loads(s) for s in (self.state / "calls.jsonl").read_text().splitlines()]
        self.assertFalse(any("82" in c or "KEYCODE_MENU" in c or "force-stop" in c for c in calls))
        self.assertTrue(receipt["emulator_reaped"])
        if (self.state / "pid").exists():
            with self.assertRaises(ProcessLookupError): os.kill(int((self.state / "pid").read_text()), 0)
        return process.returncode, receipt, calls

    def test_ready_requires_stable_focus_then_runs_existing_verifier_once(self):
        code, receipt, calls = self.finish(self.start("unstable"))
        self.assertEqual(code, 0)
        self.assertGreaterEqual(int((self.state / "windows").read_text()), 6)
        self.assertTrue(receipt["verification_started"])
        # The APKs were built before boot; the booted device only runs the device phase.
        self.assertEqual((self.state / "verification").read_text(), "started device\n")
        self.assertEqual(receipt["stable_focus_observations"], 3)
        self.assertTrue((self.state / "stopped").exists())
        self.assertIn(["adb", "-s", f"emulator-{self.port}", "shell", "input", "keyevent", "KEYCODE_WAKEUP"], calls)

    def test_device_config_sync_is_frozen_and_read_back_before_tests(self):
        code, receipt, calls = self.finish(self.start("unstable"))
        self.assertEqual(code, 0)
        self.assertEqual(receipt["device_config_sync_disabled"], "persistent")
        adb = [c[3:] for c in calls if c[:1] == ["adb"]]
        freeze = adb.index(["shell", "device_config", "set_sync_disabled_for_tests", "persistent"])
        self.assertLess(freeze, adb.index(["shell", "device_config", "get_sync_disabled_for_tests"]))
        self.assertLess(adb.index(["shell", "settings", "put", "global", "animator_duration_scale", "0.0"]), freeze)

    def test_unconfirmed_device_config_freeze_never_starts_tests(self):
        code, receipt, calls = self.finish(self.start("sync_not_disabled"))
        self.assertNotEqual(code, 0)
        self.assertEqual(receipt["device_config_sync_disabled"], "none")
        self.assertFalse(receipt["verification_started"])
        self.assertFalse((self.state / "verification").exists())

    def disabled(self, receipt):
        return [(r["package"], r["result"]) for r in receipt["disabled_packages"]]

    def test_messaging_is_disabled_after_first_observation_and_before_tests(self):
        code, receipt, calls = self.finish(self.start("unstable"))
        self.assertEqual(code, 0)
        self.assertEqual(self.disabled(receipt), [("com.google.android.apps.messaging", "disabled")])
        disable = ["adb", "-s", f"emulator-{self.port}", "shell", "pm", "disable-user", "--user", "0", "com.google.android.apps.messaging"]
        self.assertEqual(calls.count(disable), 1)
        window = ["adb", "-s", f"emulator-{self.port}", "shell", "dumpsys", "window"]
        # The first observation precedes the disable, so an existing ANR is never concealed.
        self.assertLess(calls.index(window), calls.index(disable))
        self.assertEqual(receipt["recipe"]["target"], "google_apis")

    def test_absent_messaging_is_recorded_and_tests_still_run(self):
        code, receipt, _ = self.finish(self.start("messaging_absent"))
        self.assertEqual(code, 0)
        self.assertEqual(self.disabled(receipt), [("com.google.android.apps.messaging", "not_installed")])
        self.assertTrue(receipt["verification_started"])

    def test_failed_disable_is_recorded_not_hidden_or_retried(self):
        code, receipt, calls = self.finish(self.start("disable_fails"))
        self.assertEqual(code, 0)
        [entry] = receipt["disabled_packages"]
        self.assertEqual((entry["result"], entry["exit_code"]), ("failed", 1))
        self.assertIn("SecurityException", entry["output"])
        self.assertEqual(sum(c[4:6] == ["pm", "disable-user"] for c in calls), 1)

    def test_foreign_anr_before_disable_still_blocks(self):
        code, receipt, calls = self.finish(self.start("foreign_anr"))
        self.assertEqual((code, receipt["reason"]), (2, "foreign_anr"))
        self.assertFalse(any("disable-user" in c for c in calls))

    def test_absent_focus_blocks_tests_and_retains_observations(self):
        code, receipt, _ = self.finish(self.start("no_focus", boot=.7))
        self.assertEqual(code, 124)
        self.assertFalse(receipt["verification_started"])
        self.assertFalse((self.state / "verification").exists())
        self.assertTrue(list((self.native / "evidence/android/bootstrap").glob("readiness-*-window.txt")))

    def test_slow_emulator_name_write_is_not_read_as_another_avd(self):
        # Run 45002166166 got 2 instead of 124: the fake emulator created the name file
        # before writing it, adb printed an empty name, and the bootstrap saw another AVD.
        # Hold the write open longer than any runner would; the outcome must not change.
        code, receipt, _ = self.finish(self.start("no_focus", boot=.7, name_delay=.2))
        self.assertEqual(code, 124)
        # The deadline ends either between polls or inside the adb call it bounds.
        self.assertTrue(receipt["reason"].startswith(("boot_or_focus_timeout", "command_timeout")), receipt["reason"])

    def test_anr_blocks_before_preparation_and_preserves_diagnostics(self):
        code, receipt, calls = self.finish(self.start("foreign_anr"))
        self.assertEqual(code, 2); self.assertEqual(receipt["reason"], "foreign_anr")
        self.assertFalse(any("keyevent" in c for c in calls))
        self.assertFalse((self.state / "verification").exists())
        self.assertTrue((self.native / "evidence/android/bootstrap/failure-screen.png").exists())

    def test_studio_anr_is_not_waived(self):
        code, receipt, _ = self.finish(self.start("studio_anr"))
        self.assertEqual(code, 2); self.assertEqual(receipt["reason"], "studio_anr")
        self.assertFalse(receipt["verification_started"])

    def test_boot_deadline_never_starts_tests(self):
        code, receipt, _ = self.finish(self.start("boot_timeout", boot=.4))
        self.assertEqual(code, 124); self.assertFalse(receipt["verification_started"])

    def test_emulator_exit_during_boot_never_starts_tests(self):
        code, receipt, _ = self.finish(self.start("child_exit"))
        self.assertEqual(code, 2); self.assertIn("emulator_exited", receipt["reason"])
        self.assertFalse(receipt["verification_started"])

    def test_hung_adb_is_bounded_and_partial_output_is_retained(self):
        code, receipt, _ = self.finish(self.start("hung_adb", boot=.6))
        self.assertEqual(code, 124); self.assertFalse(receipt["verification_started"])
        logs = list((self.native / "evidence/android/bootstrap").glob("command-timeout-*.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn("partial adb observation", logs[0].read_text())

    def test_another_avd_on_serial_is_never_prepared(self):
        code, receipt, calls = self.finish(self.start("foreign_serial"))
        self.assertEqual(code, 2); self.assertEqual(receipt["reason"], "serial_owned_by_another_avd")
        self.assertFalse(any(c[0] == "adb" and "shell" in c for c in calls))

    def test_non_emulator_cannot_be_prepared(self):
        code, receipt, calls = self.finish(self.start("not_emulator", boot=.4))
        self.assertNotEqual(code, 0); self.assertFalse(receipt["verification_started"])
        self.assertFalse(any("keyevent" in c for c in calls))

    def test_native_failure_is_preserved(self):
        code, receipt, _ = self.finish(self.start("verify_failure"))
        self.assertEqual(code, 23); self.assertEqual(receipt["state"], "native_verification_failed")

    def test_emulator_exit_during_tests_cannot_pass(self):
        code, receipt, _ = self.finish(self.start("emulator_dies_in_test"))
        self.assertEqual(code, 2); self.assertIn("emulator_exited", receipt["reason"])

    def test_test_timeout_reaps_owned_process(self):
        code, receipt, _ = self.finish(self.start("test_timeout", test=.2))
        self.assertEqual(code, 124); self.assertEqual(receipt["reason"], "native_verification_timeout")

    def test_term_preserves_failure_and_does_not_kill_peer(self):
        peer = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        self.children.append(peer)
        process = self.start("interrupt_test")
        deadline = time.monotonic() + 5
        while not (self.state / "verification").exists() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue((self.state / "verification").exists())
        process.send_signal(signal.SIGTERM)
        code, receipt, _ = self.finish(process)
        self.assertEqual(code, 143); self.assertEqual(receipt["reason"], "signal_15")
        self.assertIsNone(peer.poll())

    def test_busy_port_is_not_taken_over(self):
        with socket.socket() as peer:
            peer.bind(("127.0.0.1", self.port)); peer.listen()
            code, receipt, _ = self.finish(self.start("ready"))
        self.assertEqual(code, 2); self.assertFalse(receipt["verification_started"])
        self.assertFalse((self.state / "pid").exists())

    def assert_descendant_stopped(self):
        pid = int((self.state / "child-pid").read_text())
        status = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        # An orphan may briefly await the OS reaper; it must not remain runnable.
        self.assertTrue(not status or status.startswith("Z"), status)

    def test_term_resistant_descendant_is_stopped_after_leader_exits(self):
        code, _, _ = self.finish(self.start("resistant_child"))
        self.assertEqual(code, 0)
        self.assert_descendant_stopped()

    def test_already_exited_leader_does_not_skip_group_cleanup(self):
        code, receipt, _ = self.finish(self.start("leader_already_exited"))
        self.assertEqual(code, 2); self.assertFalse(receipt["verification_started"])
        self.assert_descendant_stopped()

    def test_logcat_streams_for_the_whole_verification_and_is_stopped(self):
        code, receipt, calls = self.finish(self.start("unstable"))
        self.assertEqual(code, 0)
        stream = (self.native / "evidence/android/bootstrap/logcat-stream.txt").read_text()
        self.assertIn("stream line before tests", stream)
        self.assertIn("stream line during tests", stream)
        record = receipt["logcat_stream"]
        self.assertEqual((record["file"], record["exited_before_end"], record["bytes"]), ("logcat-stream.txt", False, len(stream.encode())))
        self.assertIn(["adb", "-s", f"emulator-{self.port}", "logcat", "-v", "threadtime", "-b", "main", "-b", "system", "-b", "crash"], calls)
        with self.assertRaises(ProcessLookupError): os.kill(int((self.state / "logcat-pid").read_text()), 0)

    def test_early_logcat_exit_is_recorded_and_changes_no_result(self):
        code, receipt, _ = self.finish(self.start("logcat_exits"))
        self.assertEqual(code, 0)
        self.assertEqual(receipt["state"], "passed")
        self.assertEqual((receipt["logcat_stream"]["exited_before_end"], receipt["logcat_stream"]["exit_code"]), (True, 3))

    def test_compositing_loss_groups_failures_but_the_run_still_fails(self):
        shutil.copyfile(Path(__file__).parent / "fixtures/android-compositing-loss-45814588860.txt", self.state / "native-ui.log")
        code, receipt, _ = self.finish(self.start("verify_ui_failure"))
        self.assertEqual((code, receipt["state"]), (1, "native_verification_failed"))
        summary = receipt["device_compositing"]
        self.assertEqual((summary["state"], summary["failed_tests"], summary["same_cause_tests"], summary["other_failed_tests"]),
                         ("observed", 2, 2, []))
        self.assertEqual(summary["onset"]["test"], "QuestionJourneyTest#guestDictationAndBackgroundPreserveWordsWithoutAnAccountOrSend")
        detail = json.loads((self.native / "evidence/android/bootstrap/device-compositing.json").read_text())
        self.assertEqual(len(detail["same_cause_tests"]), 2)

    def test_other_ui_failure_is_not_grouped(self):
        (self.state / "native-ui.log").write_text("INSTRUMENTATION_STATUS: class=ai.hypeproof.studio.JourneyTest\n"
                                                  "INSTRUMENTATION_STATUS: test=t\nINSTRUMENTATION_STATUS: stack=java.lang.AssertionError: draft\n"
                                                  "INSTRUMENTATION_STATUS_CODE: -2\n")
        code, receipt, _ = self.finish(self.start("verify_ui_failure"))
        self.assertEqual(code, 1)
        self.assertEqual((receipt["device_compositing"]["state"], receipt["device_compositing"]["other_failed_tests"]),
                         ("not_observed", ["JourneyTest#t"]))
        self.assertFalse((self.native / "evidence/android/bootstrap/device-compositing.json").read_text() == "")

    def test_passing_run_writes_no_classification(self):
        code, receipt, _ = self.finish(self.start("unstable"))
        self.assertEqual(code, 0)
        self.assertNotIn("device_compositing", receipt)


if __name__ == "__main__":
    unittest.main()
