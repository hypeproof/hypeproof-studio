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
import json,os,pathlib,signal,socket,subprocess,sys,time
s=pathlib.Path(os.environ['MOCK_STATE']); mode=os.environ['MOCK_MODE']
tool=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
with (s/'calls.jsonl').open('a') as f: f.write(json.dumps([tool,*args])+'\n')
if args in [['version'],['-version']]:print('synthetic SDK fixture 1');sys.exit(0)
if tool=='adb' and args[:1]==['-L']:
 if mode=='adb_early_exit':sys.exit(7)
 assert args[1].startswith('tcp:') and args[1].count(':')==1 and args[2:]==['nodaemon','server']
 port=int(args[1].split(':')[1]);listener=socket.socket()
 listener.bind(('0.0.0.0' if mode=='adb_wildcard' else '127.0.0.1',port));listener.listen()
 (s/'adb-pid').write_text(str(os.getpid()));(s/'adb-port').write_text(str(port))
 while True:time.sleep(.02)
if tool=='avdmanager':
 name=args[args.index('--name')+1]; p=pathlib.Path(os.environ['ANDROID_AVD_HOME'])/(name+'.avd');p.mkdir()
 (p/'config.ini').write_text('fixture=1\n')
elif tool=='emulator':
 assert os.environ['ANDROID_ADB_SERVER_PORT']==(s/'adb-port').read_text()
 assert os.environ['ADB_SERVER_SOCKET']=='tcp:127.0.0.1:'+(s/'adb-port').read_text()
 (s/'name').write_text(args[args.index('-avd')+1]);(s/'pid').write_text(str(os.getpid()))
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
 assert os.environ['ADB_SERVER_SOCKET']=='tcp:127.0.0.1:'+(s/'adb-port').read_text()
 assert os.environ['ANDROID_ADB_SERVER_PORT']==(s/'adb-port').read_text()
 os.kill(int((s/'adb-pid').read_text()),0)
 args=args[2:]
 if not (s/'name').exists():sys.exit(1)
 if mode=='failed_test_hung_diagnostics' and (s/'verification').exists():
  print('partial failure diagnostic',flush=True);time.sleep(60)
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
if [ "$MOCK_MODE" = verify_failure ] || [ "$MOCK_MODE" = failed_test_hung_diagnostics ]; then exit 23; fi
if [ "$MOCK_MODE" = emulator_dies_in_test ]; then kill -TERM "$(cat "$MOCK_STATE/pid")"; sleep 2; fi
if [ "$MOCK_MODE" = adb_dies_in_test ]; then kill -TERM "$(cat "$MOCK_STATE/adb-pid")"; sleep 2; fi
if [ "$MOCK_MODE" = native_and_adb_fail ]; then kill -TERM "$(cat "$MOCK_STATE/adb-pid")"; exit 23; fi
if [ "$MOCK_MODE" = native_term ]; then kill -TERM $$; fi
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
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); self.adb_port = sock.getsockname()[1]

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate(); child.wait(timeout=8)
        if (self.state / "child-pid").exists():
            try: os.kill(int((self.state / "child-pid").read_text()), signal.SIGKILL)
            except ProcessLookupError: pass
        self.temp.cleanup()

    def start(self, mode, boot=3, test=3, routing=None, injection=None, adapter_timeout=None, adapter_source=None):
        entry = self.native / "scripts/android-emulator.py"
        if injection:
            driver = self.root / "inject.py"
            driver.write_text("import importlib.util\ns=importlib.util.spec_from_file_location('bootstrap'," + repr(str(entry)) + ")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n" + injection + "\nraise SystemExit(m.main())\n")
            entry = driver
        if adapter_timeout:
            driver = self.root / "adapter-driver.py"
            driver.write_text("import importlib.util,pathlib,sys\ns=importlib.util.spec_from_file_location('adapter'," + repr(str(adapter_source or SCRIPTS / 'foundry-native-acceptance.py')) + ")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr=m.invoke([sys.executable," + repr(str(entry)) + ",*sys.argv[1:]],pathlib.Path(" + repr(str(self.root)) + "),pathlib.Path(" + repr(str(self.root / 'outer.log')) + ")," + str(adapter_timeout) + ")\nraise SystemExit(r['exit_code'])\n")
            entry = driver
        env = dict(os.environ, MOCK_STATE=str(self.state), MOCK_MODE=mode, PYTHONDONTWRITEBYTECODE="1")
        for key in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_PORT", "ANDROID_ADB_SERVER_ADDRESS"):
            env.pop(key, None)
        env.update(routing or {})
        p = subprocess.Popen([sys.executable, str(entry),
                              "--sdk-root", str(self.sdk), "--work-dir", str(self.root / "work"),
                              "--adb-port", str(self.adb_port),
                              "--port", str(self.port), "--boot-timeout", str(boot),
                              "--test-timeout", str(test), "--poll-interval", ".01"],
                             env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(p)
        return p

    def finish(self, process, timeout=10):
        stdout, stderr = process.communicate(timeout=timeout)
        path = self.native / "evidence/android/bootstrap/receipt.json"
        self.assertTrue(path.exists(), (stdout + stderr).decode())
        receipt = json.loads(path.read_text())
        path = self.state / "calls.jsonl"
        calls = [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []
        self.assertFalse(any("82" in c or "KEYCODE_MENU" in c or "force-stop" in c for c in calls))
        self.assertTrue(receipt["emulator_reaped"])
        self.assertTrue(receipt["adb_server_reaped"])
        if (self.state / "adb-pid").exists():
            with self.assertRaises(ProcessLookupError): os.kill(int((self.state / "adb-pid").read_text()), 0)
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
        self.assertEqual(receipt["adb_listener"]["address"], "127.0.0.1")
        self.assertEqual(receipt["adb_listener"]["pid"], receipt["adb_server_pid"])
        self.assertTrue(all(value == "PASS" for value in receipt["phases"].values()))
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

    def test_private_adb_busy_port_is_refused_without_touching_peer(self):
        with socket.socket() as peer:
            peer.bind(("127.0.0.1", self.adb_port)); peer.listen()
            code, receipt, calls = self.finish(self.start("ready"))
            self.assertEqual(peer.getsockname()[1], self.adb_port)
        self.assertEqual(code, 2); self.assertEqual(calls, [])
        self.assertEqual(receipt["phases"]["bootstrap"], "NOT_RUN")

    def test_conflicting_route_refuses_before_any_sdk_command(self):
        code, receipt, calls = self.finish(self.start("ready", routing={"ADB_SERVER_SOCKET": "tcp:127.0.0.1:5037"}))
        self.assertEqual(code, 2); self.assertEqual(calls, [])
        self.assertEqual(receipt["reason"], "conflicting_adb_server_socket")

    def test_dead_or_nonloopback_server_never_launches_emulator(self):
        for mode in ("adb_early_exit", "adb_wildcard"):
            with self.subTest(mode=mode):
                if (self.native / "evidence").exists(): shutil.rmtree(self.native / "evidence")
                code, receipt, calls = self.finish(self.start(mode))
                self.assertEqual(code, 2); self.assertFalse((self.state / "pid").exists())
                self.assertEqual(receipt["phases"]["verification"], "NOT_RUN")

    def test_adb_exit_during_verification_cannot_pass_or_relaunch(self):
        code, receipt, calls = self.finish(self.start("adb_dies_in_test"))
        self.assertEqual(code, 2); self.assertEqual(receipt["reason"], "adb_server_exited")
        self.assertEqual(sum(c[:2] == ["adb", "-L"] for c in calls), 1)

    def test_unexpected_exception_after_child_success_is_terminal_failure(self):
        injection = """original=m.Bootstrap.verify
def fail(self):
 result=original(self)
 assert result==0
 self.receipt['child_returned_zero']=True
 raise RuntimeError('synthetic outer exception after native PASS')
m.Bootstrap.verify=fail"""
        code, receipt, _ = self.finish(self.start("ready", injection=injection))
        self.assertEqual(code, 2); self.assertEqual(receipt["state"], "failed")
        self.assertTrue(receipt["child_returned_zero"])
        self.assertEqual(receipt["phases"]["verification"], "FAIL")
        self.assertEqual((self.state / "verification").read_text(), "started\n")

    def test_cleanup_exception_after_pass_preserves_verification_but_fails_aggregate(self):
        injection = """original=m.stop_owned
def fail(process):
 original(process)
 if process is not None and '-L' in process.args:
  raise OSError('synthetic cleanup proof failure')
m.stop_owned=fail"""
        code, receipt, _ = self.finish(self.start("ready", injection=injection))
        self.assertEqual(code, 2); self.assertEqual(receipt["state"], "cleanup_failed")
        self.assertEqual(receipt["verification_exit_code"], 0)
        self.assertEqual(receipt["phases"]["verification"], "PASS")
        self.assertEqual(receipt["phases"]["cleanup"], "FAIL")

    def test_native_failure_survives_verifier_cleanup_failure(self):
        injection = """original=m.stop_owned
def fail(process):
 original(process)
 if process is not None and any(str(arg).endswith('android-verify.sh') for arg in process.args):
  raise OSError('synthetic verifier cleanup failure')
m.stop_owned=fail"""
        code, receipt, _ = self.finish(self.start("verify_failure", injection=injection))
        self.assertEqual(code, 23)
        self.assertEqual(receipt["verification_exit_code"], 23)
        self.assertEqual(receipt["phases"]["cleanup"], "FAIL")
        self.assertIn("verifier", receipt["cleanup_errors"])
        self.assertTrue(receipt["verifier_reaped"])

    def test_observed_native_failure_survives_adb_exit(self):
        code, receipt, _ = self.finish(self.start("native_and_adb_fail"))
        self.assertEqual(code, 23)
        self.assertEqual(receipt["verification_exit_code"], 23)
        self.assertEqual(receipt["reason"], "adb_server_exited")

    def test_native_signal_records_raw_status_and_normalized_aggregate(self):
        code, receipt, _ = self.finish(self.start("native_term"))
        self.assertEqual(code, 143)
        self.assertEqual(receipt["verification_exit_code"], -15)
        self.assertEqual(receipt["exit_code"], 143)

    def test_adapter_timeout_waits_for_bootstrap_with_hung_diagnostics_and_preserves_peer(self):
        # invoke intentionally sanitizes the environment; inject only these two
        # synthetic SDK controls into its test-owned subprocess environment.
        script = SCRIPTS / "foundry-native-acceptance.py"
        copy = self.root / "adapter-fixture.py"
        copy.write_text(script.read_text().replace('"PATH", "HOME", "TMPDIR"', '"MOCK_STATE", "MOCK_MODE", "PATH", "HOME", "TMPDIR"'))
        peer = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        self.children.append(peer)
        code, receipt, _ = self.finish(self.start("failed_test_hung_diagnostics", adapter_timeout=2, adapter_source=copy), timeout=20)
        self.assertEqual(code, 124)
        self.assertEqual(receipt["verification_exit_code"], 23)
        self.assertEqual(receipt["exit_code"], 23)
        self.assertEqual(receipt["phases"]["cleanup"], "PASS")
        self.assertIsNone(peer.poll())

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


if __name__ == "__main__":
    unittest.main()
