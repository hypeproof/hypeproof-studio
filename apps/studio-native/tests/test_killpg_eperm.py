"""A timed-out child whose process group has already exited must not turn into an OSError.

On macOS `os.killpg` gives EPERM when only the unreaped group leader is left, and ESRCH when
the group is gone (run 44990830847, fixed in verify-approval-push-simulator.py by #4446).
check-ios-push-metadata.py and android-emulator.py stop their owned groups the same way.
ios-verify.sh's cleanup helper is covered in test_ios_cleanup.py.
"""
import errno
import importlib.util
from pathlib import Path
import signal
import subprocess
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1]
EPERM = PermissionError(errno.EPERM, "Operation not permitted")
ESRCH = ProcessLookupError(errno.ESRCH, "No such process")


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, NATIVE / "scripts" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


metadata = load("check_ios_push_metadata", "check-ios-push-metadata.py")
android = load("android_emulator", "android-emulator.py")


class MetadataControlTimeout(unittest.TestCase):
    def timed_out_child(self):
        child = mock.Mock(pid=4242)
        child.wait.side_effect = [subprocess.TimeoutExpired("xcodebuild", 180), -9]
        return child

    def run_control(self, child, killpg_error, tmp):
        with mock.patch.object(metadata.subprocess, "Popen", return_value=child), \
             mock.patch.object(metadata.os, "killpg", side_effect=killpg_error) as killpg:
            with self.assertRaises(metadata.MetadataError) as raised:
                metadata.run(["xcodebuild"], Path(tmp) / "control.log")
        killpg.assert_called_once_with(4242, signal.SIGKILL)
        return raised.exception

    def test_an_exited_group_still_reports_the_timeout(self):
        import tempfile
        for error in (EPERM, ESRCH):
            with self.subTest(error=error.errno), tempfile.TemporaryDirectory() as tmp:
                child = self.timed_out_child()
                raised = self.run_control(child, error, tmp)
                self.assertEqual(str(raised), "xcode_control_timed_out")
                child.kill.assert_called_once_with()
                self.assertEqual(child.wait.call_count, 2)

    def test_a_leader_that_is_also_gone_still_reports_the_timeout(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            child = self.timed_out_child()
            child.kill.side_effect = ESRCH
            self.assertEqual(str(self.run_control(child, EPERM, tmp)), "xcode_control_timed_out")

    def test_a_live_group_is_killed_without_the_fallback(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            child = self.timed_out_child()
            self.assertEqual(str(self.run_control(child, None, tmp)), "xcode_control_timed_out")
            child.kill.assert_not_called()

    def test_other_errors_are_not_hidden(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            child = self.timed_out_child()
            with mock.patch.object(metadata.subprocess, "Popen", return_value=child), \
                 mock.patch.object(metadata.os, "killpg", side_effect=OSError(errno.EINVAL, "Invalid argument")):
                with self.assertRaises(OSError) as raised:
                    metadata.run(["xcodebuild"], Path(tmp) / "control.log")
            self.assertNotIsInstance(raised.exception, metadata.MetadataError)


class AndroidStopOwned(unittest.TestCase):
    def test_an_exited_group_ends_the_wait_at_once_and_the_leader_is_reaped(self):
        for error in (EPERM, ESRCH):
            with self.subTest(error=error.errno):
                process = mock.Mock(pid=4242)
                with mock.patch.object(android.os, "killpg", side_effect=error) as killpg:
                    android.stop_owned(process)
                self.assertEqual([c.args for c in killpg.call_args_list],
                                 [(4242, signal.SIGTERM), (4242, 0), (4242, signal.SIGKILL)])
                process.wait.assert_called_once_with(timeout=5)

    def test_other_errors_are_not_hidden(self):
        process = mock.Mock(pid=4242)
        with mock.patch.object(android.os, "killpg", side_effect=OSError(errno.EINVAL, "Invalid argument")):
            with self.assertRaises(OSError):
                android.stop_owned(process)


if __name__ == "__main__":
    unittest.main()
