"""stop_group never turns a recorded simctl timeout into a crash (run 44990830847).

In that run `simctl bootstatus` hit its 240 s limit, then `os.killpg` raised PermissionError
(EPERM) and the job failed with that error instead of the timeout. A group that has already
exited (ESRCH, or EPERM on macOS) must leave the timeout row and the SimctlHang in place.
"""
import errno
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('approval_push_stop', NATIVE / 'scripts/verify-approval-push-simulator.py')
push = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(push)


class StopGroup(unittest.TestCase):
    def stopped(self, error):
        child = mock.Mock(pid=4242)
        with mock.patch.object(push.os, 'killpg', side_effect=error) as killpg:
            push.stop_group(child)
        killpg.assert_called_once_with(4242, push.signal.SIGKILL)
        return child

    def test_eperm_from_an_exited_group_is_tolerated_and_the_leader_is_killed_and_reaped(self):
        child = self.stopped(PermissionError(errno.EPERM, 'Operation not permitted'))
        child.kill.assert_called_once_with()
        child.wait.assert_called_once_with(timeout=5)

    def test_esrch_from_a_gone_group_is_tolerated_and_the_leader_is_reaped(self):
        child = self.stopped(ProcessLookupError(errno.ESRCH, 'No such process'))
        child.kill.assert_called_once_with()
        child.wait.assert_called_once_with(timeout=5)

    def test_a_leader_that_is_also_gone_is_tolerated(self):
        child = mock.Mock(pid=4242)
        child.kill.side_effect = ProcessLookupError(errno.ESRCH, 'No such process')
        with mock.patch.object(push.os, 'killpg', side_effect=PermissionError(errno.EPERM, 'Operation not permitted')):
            push.stop_group(child)
        child.wait.assert_called_once_with(timeout=5)

    def test_a_live_group_is_killed_without_the_fallback(self):
        child = mock.Mock(pid=4242)
        with mock.patch.object(push.os, 'killpg') as killpg:
            push.stop_group(child)
        killpg.assert_called_once_with(4242, push.signal.SIGKILL)
        child.kill.assert_not_called()

    def test_a_simctl_timeout_with_eperm_still_records_the_timeout_and_fails_by_step(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            bin_dir = evidence / 'bin'; bin_dir.mkdir()
            xcrun = bin_dir / 'xcrun'
            xcrun.write_text(f'#!{sys.executable}\nimport time\ntime.sleep(30)\n'); xcrun.chmod(0o755)
            real_killpg = os.killpg
            def eperm(pid, sig):
                # The real call fails as in run 44990830847; the stuck stub is still stopped
                # by the fallback, so the test leaves nothing running.
                raise PermissionError(errno.EPERM, 'Operation not permitted')
            with mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}), \
                 mock.patch.object(push, 'bounded', return_value='ok'), \
                 mock.patch.object(push.os, 'killpg', side_effect=eperm):
                with self.assertRaisesRegex(push.SimctlHang, 'bootstatus did not return within 0.3s during boot'):
                    push.simctl(evidence, 'boot', ['bootstatus', 'X', '-b'], timeout=0.3, capture=False)
            rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
            self.assertEqual([(r['step'], r['command'], r['outcome'], r['limit']) for r in rows],
                             [('boot', 'bootstatus', 'timeout', 0.3)])
            self.assertTrue((evidence / 'simctl-hang-boot.txt').is_file())
            self.assertIs(os.killpg, real_killpg)

    def test_other_errors_are_not_hidden(self):
        child = mock.Mock(pid=4242)
        with mock.patch.object(push.os, 'killpg', side_effect=OSError(errno.EINVAL, 'Invalid argument')):
            with self.assertRaises(OSError):
                push.stop_group(child)


if __name__ == '__main__':
    unittest.main()
