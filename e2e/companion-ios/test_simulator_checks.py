"""Ownership and failure controls; never invoke Xcode or simctl."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("simulator_checks", Path(__file__).with_name("simulator-checks.py"))
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)

PEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OWNED = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
METADATA = {
    "runtimes": [{"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-18-0", "version": "18.0", "isAvailable": True}],
    "devicetypes": [{"identifier": "type.iphone", "name": "iPhone 16", "productFamily": "iPhone", "minRuntimeVersion": 18 << 16},
                    {"identifier": "type.ipad", "name": "iPad Pro", "productFamily": "iPad", "minRuntimeVersion": 18 << 16}],
    "devices": {"existing": [{"udid": PEER, "name": "Jay iPhone", "isAvailable": True}]},
}


class FakeCommands:
    def __init__(self, fail_test=None, fail_create=None, fail_shutdown=False, fail_delete=False):
        self.calls = []
        self.created = []
        self.tests = 0
        self.fail_test, self.fail_create, self.fail_shutdown = fail_test, fail_create, fail_shutdown
        self.fail_delete = fail_delete

    def __call__(self, args, *, timeout, capture=False):
        self.calls.append((args, timeout))
        if args[:3] == ["xcrun", "simctl", "list"]:
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(METADATA))
        if args[:3] == ["xcrun", "simctl", "create"]:
            if len(self.created) == self.fail_create:
                raise subprocess.CalledProcessError(1, args)
            identifier = OWNED[len(self.created)]
            self.created.append(identifier)
            return subprocess.CompletedProcess(args, 0, stdout=identifier + "\n")
        if args[:2] == ["xcodebuild", "test"]:
            self.tests += 1
            if self.tests == self.fail_test:
                raise subprocess.TimeoutExpired(args, timeout)
        if args[:3] == ["xcrun", "simctl", "shutdown"] and self.fail_shutdown:
            raise subprocess.CalledProcessError(149, args)
        if args[:3] == ["xcrun", "simctl", "delete"] and self.fail_delete:
            raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 0, stdout="")


class OwnershipControls(unittest.TestCase):
    def assert_owned_only(self, fake):
        mutations = [args for args, _ in fake.calls if args[:2] == ["xcrun", "simctl"] and args[2] in ["shutdown", "delete"]]
        self.assertTrue(all(args[3] in fake.created for args in mutations))
        self.assertEqual({args[3] for args in mutations if args[2] == "delete"}, set(fake.created))
        self.assertFalse(any(PEER in str(args) for args, _ in fake.calls))
        self.assertTrue(all(0 < timeout <= 600 for _, timeout in fake.calls))

    def test_success_uses_fresh_owned_destinations_and_cleans_both(self):
        fake = FakeCommands()
        with tempfile.TemporaryDirectory() as directory:
            HARNESS.verify(Path(directory), run=fake)
            selected = json.loads((Path(directory) / "devices.json").read_text())
            self.assertEqual({value["udid"] for value in selected.values()}, set(OWNED))
        self.assert_owned_only(fake)
        tests = [args for args, _ in fake.calls if args[:2] == ["xcodebuild", "test"]]
        self.assertEqual(len(tests), 2)
        self.assertTrue(all(any(identifier in str(args) for identifier in OWNED) for args in tests))

    def test_timeout_cleans_only_created_device_and_never_starts_next(self):
        fake = FakeCommands(fail_test=1, fail_shutdown=True)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(subprocess.TimeoutExpired):
                HARNESS.verify(Path(directory), run=fake)
        self.assertEqual(fake.created, OWNED[:1])
        self.assert_owned_only(fake)

    def test_second_create_failure_still_cleans_first(self):
        fake = FakeCommands(fail_create=1)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(subprocess.CalledProcessError):
                HARNESS.verify(Path(directory), run=fake)
        self.assertEqual(fake.created, OWNED[:1])
        self.assert_owned_only(fake)

    def test_second_test_timeout_cleans_both_owned_devices(self):
        fake = FakeCommands(fail_test=2)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(subprocess.TimeoutExpired):
                HARNESS.verify(Path(directory), run=fake)
        self.assertEqual(fake.created, OWNED)
        self.assert_owned_only(fake)

    def test_delete_failure_is_reported_after_attempting_all_owned_cleanup(self):
        fake = FakeCommands(fail_delete=True)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "Owned simulator deletion failed"):
                HARNESS.verify(Path(directory), run=fake)
            receipts = json.loads((Path(directory) / "cleanup.json").read_text())
            self.assertEqual(len(receipts), 4)
            self.assertEqual(len([r for r in receipts if r["operation"] == "delete" and r["result"] == "CalledProcessError"]), 2)
        self.assert_owned_only(fake)

    def test_nonempty_output_preserves_prior_evidence_without_any_external_command(self):
        fake = FakeCommands()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            prior = {"devices.json": b'{"iphone":{"udid":"prior-device"}}\n',
                     "cleanup.json": b'[{"operation":"delete","result":"passed"}]\n'}
            for name, data in prior.items():
                (output / name).write_bytes(data)
            (output / "iphone.xcresult").mkdir()
            (output / "iphone.xcresult" / "Info.plist").write_bytes(b"prior-result-bundle")
            before = {str(path.relative_to(output)): path.read_bytes()
                      for path in output.rglob("*") if path.is_file()}
            with self.assertRaisesRegex(RuntimeError, "Evidence output must be empty"):
                HARNESS.verify(output, run=fake)
            after = {str(path.relative_to(output)): path.read_bytes()
                     for path in output.rglob("*") if path.is_file()}
            self.assertEqual(after, before)
            self.assertEqual(fake.calls, [])

    def test_unavailable_or_incompatible_runtime_fails_before_create(self):
        metadata = json.loads(json.dumps(METADATA))
        metadata["runtimes"][0]["version"] = "17.0"
        with self.assertRaises(RuntimeError):
            HARNESS.select_types(metadata)
        metadata["runtimes"][0]["isAvailable"] = False
        with self.assertRaises(RuntimeError):
            HARNESS.select_types(metadata)


if __name__ == "__main__":
    unittest.main()
