"""Real process cancellation at the actual helper's first owned stage, without installs."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(os.environ.get('HPS_PREPARE_CONTROL_SOURCE', Path(__file__).with_name('prepare-host.py')))


class PrepareCancellation(unittest.TestCase):
    def test_signal_unwinds_actual_main_and_reaps_owned_stage(self):
        signals = (signal.SIGTERM,) if os.environ.get('HPS_PREPARE_BASELINE') else (signal.SIGTERM, signal.SIGINT)
        for cancel_signal in signals:
            with self.subTest(signal=cancel_signal.name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                child = root / 'held-compiler'
                child.write_text('#!' + sys.executable + '\nimport os,time\n'
                                 'from pathlib import Path\n'
                                 'Path(os.environ["HPS_HELD_PID"]).write_text(str(os.getpid()))\n'
                                 'time.sleep(60)\n')
                child.chmod(0o700)
                (root / 'pins.json').write_text(json.dumps({'server_commit': 'a' * 40,
                    'server_version': '1.13.11', 'go_version': '1.26.11'}))
                # Only metadata is synthetic. main(), its Popen, signal handler,
                # real held child/group, failure receipt and reap are production code.
                driver = root / 'driver.py'
                driver.write_text('''import importlib.util,sys
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('prepare_host',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=Path(sys.argv[2]);m.ROOT=r
m.platform.system=lambda:'Darwin';m.platform.machine=lambda:'arm64'
def metadata(argv,**kwargs):
 if '--find' in argv:return str(r/'held-compiler')+'\\n'
 if '--show-sdk-path' in argv:return str(r/'synthetic-sdk')+'\\n'
 return '[3,13,0]\\n'
m.subprocess.check_output=metadata
m.main(SimpleNamespace(output=str(r/'host'),python=sys.executable,timeout_seconds=30))
''')
                env = dict(os.environ, HPS_HELD_PID=str(root / 'pid'))
                process = subprocess.Popen([sys.executable, str(driver), str(SOURCE), str(root)],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                child_pid = None
                try:
                    deadline = time.monotonic() + 5
                    while not (root / 'pid').exists():
                        self.assertIsNone(process.poll(), 'helper exited before the controlled stage')
                        self.assertLess(time.monotonic(), deadline, 'controlled stage did not start')
                        time.sleep(.01)
                    child_pid = int((root / 'pid').read_text())
                    self.assertEqual(os.getpgid(child_pid), child_pid)
                    os.kill(process.pid, cancel_signal)
                    stdout, stderr = process.communicate(timeout=12)
                    alive = True
                    try: os.kill(child_pid, 0)
                    except ProcessLookupError: alive = False
                    receipt_path = root / 'host/host.json'
                    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
                    print(json.dumps({'signal': cancel_signal.name, 'exit': process.returncode,
                        'owned_child_alive': alive, 'receipt': receipt,
                        'stderr_type': 'InterruptedError' if b'InterruptedError' in stderr else 'other'}), flush=True)
                    self.assertFalse(alive, 'owned stage survived helper cancellation')
                    self.assertNotEqual(process.returncode, 0)
                    self.assertEqual(receipt['status'], 'FAIL')
                    self.assertEqual(receipt['error_type'], 'InterruptedError')
                finally:
                    # The old-source negative may leave this test-created group.
                    # Reap only its recorded child, never any shared process.
                    if child_pid is not None:
                        try: os.killpg(child_pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                    if child_pid is not None:
                        deadline = time.monotonic() + 2
                        alive = True
                        while time.monotonic() < deadline:
                            try: os.kill(child_pid, 0)
                            except ProcessLookupError: alive = False; break
                            time.sleep(.01)
                        print(json.dumps({'test_owned_cleanup': True, 'child_alive_after_cleanup': alive}), flush=True)


if __name__ == '__main__':
    unittest.main()
