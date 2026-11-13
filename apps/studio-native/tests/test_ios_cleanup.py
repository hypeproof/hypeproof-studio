"""Run the real iOS verification shell with isolated command stubs; no Apple tools."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "apps/studio-native/scripts/ios-verify.sh"
DEVICE = "4C2B394A-0154-4E81-B724-71BCEAD2916F"

COMMAND_STUB = r'''#!__PYTHON__
import json, os, pathlib, signal, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["STUB_CALLS"], "a") as log:
    log.write(json.dumps({"command": name, "args": args, "pid": os.getpid()}) + "\n")
if name == "xcodebuild":
    if args == ["-version"]:
        print("Xcode 26.3")
    if "test" in args:
        if os.environ.get("STUB_TEST_SIGNAL"):
            os.kill(os.getpid(), int(os.environ["STUB_TEST_SIGNAL"]))
        raise SystemExit(int(os.environ.get("STUB_TEST_EXIT", "0")))
elif name == "xcrun":
    if args == ["--sdk", "iphonesimulator", "--show-sdk-version"]:
        print("26.3")
    elif args[:3] == ["simctl", "list", "runtimes"]:
        print(json.dumps({"runtimes": [{"isAvailable": True, "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-3", "version": "26.3"}]}))
    elif args[:2] == ["simctl", "create"]:
        if os.environ.get("STUB_CREATE_EXIT"):
            raise SystemExit(int(os.environ["STUB_CREATE_EXIT"]))
        print(os.environ["STUB_DEVICE"])
    elif args[:2] in (["simctl", "shutdown"], ["simctl", "delete"]):
        behavior = json.loads(os.environ.get("STUB_CLEANUP", "{}" )).get(args[1], 0)
        if behavior in ("descendant_timeout", "descendant_exit"):
            subprocess.Popen([sys.executable, "-c", "import os,time;open(os.environ['STUB_DESCENDANTS'],'a').write(str(os.getpid())+chr(10));time.sleep(60)"])
            end = time.monotonic() + 1
            while not pathlib.Path(os.environ["STUB_DESCENDANTS"]).exists():
                if time.monotonic() > end:
                    raise SystemExit(8)
                time.sleep(0.01)
            if behavior == "descendant_exit":
                raise SystemExit(0)
            time.sleep(60)
        if isinstance(behavior, str) and behavior.startswith("interrupt_helper:"):
            os.kill(os.getppid(), int(behavior.split(":")[1]))
            time.sleep(60)
        if behavior == "timeout":
            time.sleep(60)  # the actual subprocess timeout must stop this owned child
        raise SystemExit(int(behavior))
'''

PYTHON_STUB = r'''#!__PYTHON__
import json, os, subprocess, sys
if len(sys.argv) == 3 and sys.argv[1] == "-":
    # Keep the shipped 30-second contract, but exercise its real timeout path in 250 ms.
    # This seam belongs only to the test's temporary PATH; production has no override.
    original_wait = subprocess.Popen.wait
    def wait(self, timeout=None):
        assert timeout in (30, 2), timeout
        if timeout == 30:
            with open(os.environ["STUB_TIMEOUTS"], "a") as log:
                log.write(json.dumps({"command": self.args, "requested_timeout": timeout}) + "\n")
            timeout = 0.25
        return original_wait(self, timeout=timeout)
    subprocess.Popen.wait = wait
    code = sys.stdin.read()
    sys.argv = sys.argv[1:]
    exec(compile(code, "<ios-cleanup>", "exec"), {"__name__": "__main__"})
else:
    os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
'''


class IosCleanupTest(unittest.TestCase):
    def run_script(self, *, device=DEVICE, cleanup=None, test_exit=0, create_exit=0, test_signal=0):
        temp = tempfile.TemporaryDirectory(prefix="studio-ios-cleanup-")
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        scripts, ios, bin_dir = root / "scripts", root / "ios", root / "bin"
        for directory in (scripts, ios, bin_dir):
            directory.mkdir()
        shutil.copyfile(SCRIPT, scripts / "ios-verify.sh")
        (scripts / "collect-native-journeys.py").write_text("raise SystemExit(0)\n")
        for command in ("xcrun", "xcodebuild", "swift", "codesign", "sleep"):
            path = bin_dir / command
            path.write_text(COMMAND_STUB.replace("__PYTHON__", sys.executable))
            path.chmod(0o755)
        (bin_dir / "python3").write_text(PYTHON_STUB.replace("__PYTHON__", sys.executable))
        (bin_dir / "python3").chmod(0o755)
        calls, timeouts = root / "calls.jsonl", root / "timeouts.jsonl"
        descendants = root / "descendants.txt"
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
                   GITHUB_SHA="a" * 40, GITHUB_RUN_ID="owned-cleanup-test",
                   STUB_CALLS=str(calls), STUB_TIMEOUTS=str(timeouts), STUB_DEVICE=device,
                   STUB_CLEANUP=json.dumps(cleanup or {}), STUB_TEST_EXIT=str(test_exit),
                   STUB_TEST_SIGNAL=str(test_signal) if test_signal else "",
                   STUB_DESCENDANTS=str(descendants),
                   STUB_CREATE_EXIT=str(create_exit) if create_exit else "")
        result = subprocess.run(["bash", str(scripts / "ios-verify.sh")], cwd=root,
                                env=env, capture_output=True, text=True, timeout=10)
        commands = [json.loads(line) for line in calls.read_text().splitlines()]
        cleanup_calls = [c for c in commands if c["command"] == "xcrun"
                         and c["args"][:2] in (["simctl", "shutdown"], ["simctl", "delete"])]
        requested = [json.loads(line) for line in timeouts.read_text().splitlines()] if timeouts.exists() else []
        cleanup_log = root / "evidence/simulator-cleanup.log"
        self.descendants = [int(pid) for pid in descendants.read_text().splitlines()] if descendants.exists() else []
        return result, cleanup_calls, requested, cleanup_log.read_text() if cleanup_log.exists() else ""

    def assert_stopped(self, pid):
        end = time.monotonic() + 2
        while time.monotonic() < end:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            # An orphan may await init's reap, but a zombie is no longer executing or holding output.
            stat = Path(f"/proc/{pid}/stat")
            try:
                if stat.exists() and stat.read_text().split(") ", 1)[1].startswith("Z "):
                    return
            except FileNotFoundError:
                return
            time.sleep(0.01)
        self.fail(f"owned process {pid} still running")

    def assert_owned(self, calls, requested):
        self.assertEqual([c["args"] for c in calls],
                         [["simctl", "shutdown", DEVICE], ["simctl", "delete", DEVICE]])
        self.assertEqual([c["command"] for c in requested],
                         [["xcrun", "simctl", "shutdown", DEVICE], ["xcrun", "simctl", "delete", DEVICE]])
        self.assertEqual([c["requested_timeout"] for c in requested], [30, 30])

    def test_success_cleans_only_created_device_and_logs_both_results(self):
        result, calls, requested, log = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_owned(calls, requested)
        for action in ("shutdown", "delete"):
            self.assertIn(f"{action} {DEVICE} started", result.stdout)
            self.assertIn(f"{action} completed exit=0", log)

    def test_each_timeout_stops_its_child_and_still_attempts_both_operations(self):
        for action in ("shutdown", "delete"):
            with self.subTest(action=action):
                result, calls, requested, log = self.run_script(cleanup={action: "timeout"})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_owned(calls, requested)
                self.assertIn(f"{action} timed out after 30s; stopping owned process group", log)
                timed_out = next(c for c in calls if c["args"][1] == action)
                self.assert_stopped(timed_out["pid"])

    def test_descendant_retaining_output_cannot_outlive_cleanup_or_hold_the_script(self):
        for behavior in ("descendant_timeout", "descendant_exit"):
            with self.subTest(behavior=behavior):
                result, calls, requested, log = self.run_script(cleanup={"shutdown": behavior})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_owned(calls, requested)
                self.assertEqual(len(self.descendants), 1)
                self.assert_stopped(self.descendants[0])
                self.assertIn("delete completed exit=0", log)

    def test_cleanup_failure_does_not_replace_success(self):
        result, calls, requested, log = self.run_script(cleanup={"shutdown": 7, "delete": 9})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_owned(calls, requested)
        self.assertIn("shutdown completed exit=7", log)
        self.assertIn("delete completed exit=9", log)

    def test_original_test_failure_survives_cleanup_timeout_and_failure(self):
        result, calls, requested, log = self.run_script(test_exit=23, cleanup={"shutdown": "timeout", "delete": 9})
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assert_owned(calls, requested)
        self.assertIn("shutdown timed out", log)
        self.assertIn("delete completed exit=9", log)

    def test_signalled_test_command_preserves_term_and_int_exit_status(self):
        for signum in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signum=signum):
                result, calls, requested, log = self.run_script(test_signal=signum)
                self.assertEqual(result.returncode, 128 + signum, result.stderr)
                self.assert_owned(calls, requested)
                self.assertIn(f"preserving original exit={128 + signum}", log)

    def test_cleanup_python_interruption_stops_owned_child_and_preserves_prior_failure(self):
        for signum in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signum=signum):
                result, calls, requested, log = self.run_script(test_exit=23, cleanup={"shutdown": f"interrupt_helper:{signum}"})
                self.assertEqual(result.returncode, 23, result.stderr)
                self.assertEqual([c["args"] for c in calls], [["simctl", "shutdown", DEVICE]])
                self.assertEqual(len(requested), 1)
                self.assert_stopped(calls[0]["pid"])
                self.assertIn(f"helper exit={128 + signum}; preserving original exit=23", log)

    def test_invalid_device_never_reaches_cleanup_commands(self):
        for value in ("all", "unavailable", "", DEVICE + " other-device"):
            with self.subTest(value=value):
                result, calls, requested, log = self.run_script(device=value)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((calls, requested), ([], []))
                self.assertIn("skipped invalid owned device UUID", log)

    def test_creation_failure_has_no_owned_device_to_clean(self):
        result, calls, requested, log = self.run_script(create_exit=17)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual((calls, requested, log), ([], [], ""))


if __name__ == "__main__":
    unittest.main()
