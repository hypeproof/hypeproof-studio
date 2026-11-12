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
import json,os,pathlib,signal,sys,time
s=pathlib.Path(os.environ['MOCK_STATE']); mode=os.environ['MOCK_MODE']
tool=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
with (s/'calls.jsonl').open('a') as f: f.write(json.dumps([tool,*args])+'\n')
if tool=='avdmanager':
 name=args[args.index('--name')+1]; p=pathlib.Path(os.environ['ANDROID_AVD_HOME'])/(name+'.avd');p.mkdir()
 (p/'config.ini').write_text('fixture=1\n')
elif tool=='emulator':
 (s/'name').write_text(args[args.index('-avd')+1]);(s/'pid').write_text(str(os.getpid()))
 def stop(*_):
  (s/'stopped').write_text('owned emulator terminated');sys.exit(0)
 signal.signal(signal.SIGTERM,stop)
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
 else:print('retained diagnostic fixture')
'''
VERIFY = r'''#!/bin/bash
printf 'started\n' >> "$MOCK_STATE/verification"
if [ "$MOCK_MODE" = verify_failure ]; then exit 23; fi
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
        self.temp.cleanup()

    def start(self, mode, boot=3, test=3):
        p = subprocess.Popen([sys.executable, str(self.native / "scripts/android-emulator.py"),
                              "--sdk-root", str(self.sdk), "--work-dir", str(self.root / "work"),
                              "--port", str(self.port), "--boot-timeout", str(boot),
                              "--test-timeout", str(test), "--poll-interval", ".01"],
                             env=dict(os.environ, MOCK_STATE=str(self.state), MOCK_MODE=mode,
                                      PYTHONDONTWRITEBYTECODE="1"), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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
        self.assertEqual((self.state / "verification").read_text(), "started\n")
        self.assertEqual(receipt["stable_focus_observations"], 3)
        self.assertTrue((self.state / "stopped").exists())
        self.assertIn(["adb", "-s", f"emulator-{self.port}", "shell", "input", "keyevent", "KEYCODE_WAKEUP"], calls)

    def test_absent_focus_blocks_tests_and_retains_observations(self):
        code, receipt, _ = self.finish(self.start("no_focus", boot=.7))
        self.assertEqual(code, 124)
        self.assertFalse(receipt["verification_started"])
        self.assertFalse((self.state / "verification").exists())
        self.assertTrue(list((self.native / "evidence/android/bootstrap").glob("readiness-*-window.txt")))

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


if __name__ == "__main__":
    unittest.main()
