"""Actual helper -> actual prepare main -> separate held child cancellation; no builds."""
import contextlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

NATIVE = Path(__file__).resolve().parents[1]
HELPER = Path(os.environ.get("HPS_NATIVE_CONTROL_SOURCE", NATIVE / "scripts/ios-livekit-evaluation.py"))
PREPARE = Path(os.environ.get("HPS_PREPARE_CONTROL_SOURCE", NATIVE / "voice-evaluation/prepare-host.py"))


class NativeHelperCancellation(unittest.TestCase):
    def test_signal_and_timeout_reap_nested_prepare_child_and_preserve_receipt(self):
        modes = ("SIGTERM",) if os.environ.get("HPS_NATIVE_CONTROL_BASELINE") else ("SIGTERM", "SIGINT", "timeout")
        for mode in modes:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                lab = root / "voice-evaluation"
                lab.mkdir()
                (root / "app").mkdir()
                (root / "app/HPStudio").write_bytes(b"synthetic app identity; no native execution")
                (lab / "pins.json").write_text(json.dumps({"server_commit": "a" * 40,
                    "server_version": "1.13.11", "go_version": "1.26.11"}))
                child = lab / "held-compiler"
                child.write_text("#!" + sys.executable + "\nimport os,time,signal\nfrom pathlib import Path\n"
                    "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                    "Path(os.environ['HPS_NESTED_PID']).write_text(str(os.getpid()))\ntime.sleep(60)\n")
                child.chmod(0o700)
                # Only platform metadata/first compiler are substituted. Both
                # main functions, signal handlers, Popen groups and receipts are real.
                (lab / "prepare-host.py").write_text('''import argparse,importlib.util,os,sys
from pathlib import Path
Path(os.environ['HPS_PREPARE_PID']).write_text(str(os.getpid()))
spec=importlib.util.spec_from_file_location('real_prepare',os.environ['HPS_ACTUAL_PREPARE'])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.ROOT=Path(__file__).parent
m.platform.system=lambda:'Darwin';m.platform.machine=lambda:'arm64'
def metadata(argv,**kwargs):
 if '--find' in argv:return str(m.ROOT/'held-compiler')+'\\n'
 if '--show-sdk-path' in argv:return str(m.ROOT/'synthetic-sdk')+'\\n'
 return '[3,13,0]\\n'
m.subprocess.check_output=metadata
p=argparse.ArgumentParser();p.add_argument('--output');p.add_argument('--python')
a=p.parse_args();a.timeout_seconds=30;m.main(a)
''')
                driver = root / "driver.py"
                driver.write_text('''import importlib.util,sys
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('real_helper',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=Path(sys.argv[2]);m.__file__=str(r/'scripts/ios-livekit-evaluation.py');m.sys.platform='darwin'
if sys.argv[3]=='timeout':
 actual=m.command
 def bounded(argv,**kwargs):
  kwargs['timeout']=1.0
  return actual(argv,**kwargs)
 m.command=bounded
raise SystemExit(m.main(SimpleNamespace(source_sha='a'*40,device='11111111-1111-4111-8111-111111111111',
 app=str(r/'app'),evidence=str(r/'evidence'))))
''')
                env = dict(os.environ, HPS_NESTED_PID=str(root / "pid"), HPS_ACTUAL_PREPARE=str(PREPARE),
                           HPS_PREPARE_PID=str(root / "prepare-pid"))
                process = subprocess.Popen([sys.executable, str(driver), str(HELPER), str(root), mode],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                child_pid = prepare_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while not (root / "pid").exists():
                        self.assertIsNone(process.poll(), "helper exited before its nested owned stage")
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.01)
                    child_pid = int((root / "pid").read_text())
                    prepare_pid = int((root / "prepare-pid").read_text())
                    self.assertEqual(os.getpgid(child_pid), child_pid)
                    if mode != "timeout":
                        os.kill(process.pid, getattr(signal, mode))
                        time.sleep(.05)
                        if process.poll() is None and not os.environ.get("HPS_NATIVE_CONTROL_BASELINE"):
                            os.kill(process.pid, getattr(signal, mode))  # repeated cancellation must not break cleanup
                    try:
                        stdout, stderr = process.communicate(timeout=8 if os.environ.get("HPS_NATIVE_CONTROL_BASELINE") else 25)
                    except subprocess.TimeoutExpired:
                        def alive(pid):
                            try: os.kill(pid, 0); return True
                            except ProcessLookupError: return False
                        print(json.dumps({"mode": mode, "helper_alive": process.poll() is None,
                            "prepare_alive": alive(prepare_pid), "nested_child_alive": alive(child_pid),
                            "bounded_unwind": False}), flush=True)
                        self.fail("helper cancellation did not unwind within its bounded control window")
                    alive = True
                    try: os.kill(child_pid, 0)
                    except ProcessLookupError: alive = False
                    receipt = json.loads((root / "evidence/native-livekit.json").read_text())
                    print(json.dumps({"mode": mode, "helper_exit": process.returncode,
                        "nested_child_alive": alive, "receipt": receipt}), flush=True)
                    self.assertFalse(alive, "nested owned child survived helper cancellation")
                    self.assertEqual(process.returncode, 1)
                    self.assertEqual(receipt["status"], "FAIL")
                    self.assertEqual(receipt["failure"], "TimeoutExpired" if mode == "timeout" else "OwnedInterruption")
                    self.assertEqual(receipt["host"]["status"], "FAIL")
                    self.assertEqual(receipt["host"]["error_type"], "InterruptedError")
                    self.assertNotIn(str(root), json.dumps(receipt))
                    self.assertNotIn("python", receipt["host"])
                finally:
                    # The baseline negative can orphan only this recorded test child.
                    if child_pid is not None:
                        with contextlib.suppress(ProcessLookupError): os.killpg(child_pid, signal.SIGKILL)
                    if prepare_pid is not None:
                        # Candidate prepare owns a separate group; baseline shares
                        # the test helper group. Signal this recorded PID either way.
                        with contextlib.suppress(ProcessLookupError): os.kill(prepare_pid, signal.SIGKILL)
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                    if child_pid is not None:
                        deadline = time.monotonic() + 2
                        while time.monotonic() < deadline:
                            try: os.kill(child_pid, 0)
                            except ProcessLookupError: break
                            time.sleep(.01)


if __name__ == "__main__":
    unittest.main()
