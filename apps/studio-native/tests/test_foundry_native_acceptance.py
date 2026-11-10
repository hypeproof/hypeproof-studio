"""Synthetic contract controls only: no native build, model, device or Foundry call."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    "native_acceptance", Path(__file__).parents[1] / "scripts/foundry-native-acceptance.py")
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)
SOURCE = {"head": "a" * 40, "candidate_tree": "b" * 40,
          "patch_sha256": hashlib.sha256(b"").hexdigest(), "patch_format": "synthetic",
          "dirty": False, "changed_paths": []}


class AcceptanceContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.native = self.root / adapter.NATIVE
        (self.native / "scripts").mkdir(parents=True)
        for spec in adapter.PLATFORMS.values():
            (self.native / "scripts" / spec["script"]).write_text("# synthetic recipe, never executed\n")
        self.identity = patch.object(adapter, "source_identity", return_value=dict(SOURCE))
        self.identity.start()
        self.addCleanup(self.identity.stop)
        env = patch.dict(os.environ, {"ANDROID_SERIAL": "emulator-5554"})
        env.start()
        self.addCleanup(env.stop)

    def command(self, platform, code=0, mutate=None):
        def execute(argv, workspace, log, timeout):
            self.assertEqual(argv, ["/bin/bash", str(self.native / "scripts" / (platform + "-verify.sh"))])
            self.assertEqual(workspace, self.root)
            log.write_bytes(b"SYNTHETIC subprocess output\n")
            for relative in adapter.PLATFORMS[platform]["required"]:
                target = self.native / relative
                if relative.endswith((".app", "screenshots")):
                    target /= "synthetic-content.bin"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"SYNTHETIC native artifact, not a real application")
            if mutate:
                mutate()
            return {"exit_code": code, "timed_out": code == 124, "elapsed_seconds": 0.01}
        return execute

    def receipt(self, platform):
        return json.loads((self.native / "evidence/foundry" / platform /
                           "foundry-native-acceptance.json").read_text())

    def test_fixed_platform_success_records_exact_bytes_and_no_delivery_claim(self):
        for platform in adapter.PLATFORMS:
            # Each platform needs a separate fresh candidate; no stale cross-run output.
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                native = root / adapter.NATIVE
                (native / "scripts").mkdir(parents=True)
                (native / "scripts" / (platform + "-verify.sh")).write_text("# fixture\n")
                old_root, old_native = self.root, self.native
                self.root, self.native = root, native
                try:
                    with patch.object(adapter, "invoke", side_effect=self.command(platform)):
                        code, receipt = adapter.accept(root, platform, SOURCE["head"], SOURCE["patch_sha256"])
                    self.assertEqual((code, receipt["verdict"]), (0, "PASS"))
                    self.assertEqual(receipt["actual_foundry_execution"], "NOT_RUN")
                    self.assertIsNone(receipt["foundry_binding"]["versions"])
                    for name in ["deployment", "upload", "physical_device", "human_acceptance"]:
                        self.assertEqual(receipt[name], "NOT_RUN")
                    for item in receipt["artifacts"] + [receipt["command"]["log"]]:
                        data = (root / item["path"]).read_bytes()
                        self.assertEqual(item["sha256"], hashlib.sha256(data).hexdigest())
                        self.assertEqual(item["size"], len(data))
                finally:
                    self.root, self.native = old_root, old_native

    def test_pin_mismatch_stops_before_execution_and_retains_blocked_receipt(self):
        with patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "android", "c" * 40)
        self.assertEqual(code, 2)
        self.assertEqual(receipt["verdict"], "BLOCKED")
        self.assertIn("SHA mismatch", self.receipt("android")["reason"])
        command.assert_not_called()

    def test_staged_patch_requires_exact_reviewed_digest(self):
        source = dict(SOURCE, dirty=True, changed_paths=["apps/studio-native/ios/App.swift"])
        with patch.object(adapter, "source_identity", return_value=source), patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "ios", expected_patch="c" * 64)
        self.assertEqual(code, 2)
        self.assertIn("patch SHA256 mismatch", receipt["reason"])
        command.assert_not_called()

    def test_failure_and_timeout_keep_command_log_and_cannot_silently_retry(self):
        with patch.object(adapter, "invoke", side_effect=self.command("android", 124)) as command:
            code, receipt = adapter.accept(self.root, "android")
            self.assertEqual((code, receipt["verdict"]), (124, "FAIL"))
            self.assertTrue(receipt["command"]["timed_out"])
            before = (self.native / "evidence/foundry/android/foundry-native-acceptance.json").read_bytes()
            with self.assertRaises(FileExistsError):
                adapter.accept(self.root, "android")
            self.assertEqual(command.call_count, 1)
            self.assertEqual(before, (self.native / "evidence/foundry/android/foundry-native-acceptance.json").read_bytes())

    def test_missing_output_cannot_pass_even_if_script_returns_zero(self):
        def remove():
            (self.native / "android/app/build/outputs/apk/debug/app-debug.apk").unlink()
        with patch.object(adapter, "invoke", side_effect=self.command("android", mutate=remove)):
            code, receipt = adapter.accept(self.root, "android")
        self.assertNotEqual(code, 0)
        self.assertEqual(receipt["verdict"], "FAIL")
        self.assertIn("missing", receipt["reason"])

    def test_artifact_symlink_is_rejected_without_reading_target(self):
        outside = Path(self.tmp.name) / "outside-artifact"
        outside.write_bytes(b"do not read as a candidate artifact")
        def replace():
            target = self.native / "android/app/build/outputs/apk/debug/app-debug.apk"
            target.unlink()
            target.symlink_to(outside)
        with patch.object(adapter, "invoke", side_effect=self.command("android", mutate=replace)):
            code, receipt = adapter.accept(self.root, "android")
        self.assertNotEqual(code, 0)
        self.assertIn("Symlink", receipt["reason"])
        self.assertEqual(receipt["verdict"], "FAIL")

    def test_source_change_during_build_fails(self):
        with patch.object(adapter, "source_identity", side_effect=[dict(SOURCE), dict(SOURCE, head="c" * 40)]), patch.object(adapter, "invoke", side_effect=self.command("macos")):
            code, receipt = adapter.accept(self.root, "macos")
        self.assertNotEqual(code, 0)
        self.assertIn("changed during", receipt["reason"])

    def test_stale_evidence_is_refused(self):
        (self.native / "evidence/android").mkdir(parents=True)
        (self.native / "evidence/android/native-ui.log").write_text("old success")
        with patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "android")
        self.assertEqual(code, 2)
        self.assertIn("existing output", receipt["reason"])
        command.assert_not_called()

    def test_physical_android_is_refused_before_build(self):
        with patch.dict(os.environ, {"ANDROID_SERIAL": "physical-device"}), patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "android")
        self.assertEqual(code, 2)
        self.assertIn("disposable emulator", receipt["reason"])
        command.assert_not_called()

    def test_recipe_pin_mismatch_stops_execution(self):
        with patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "ios", expected_script="f" * 64)
        self.assertEqual(code, 2)
        self.assertIn("recipe SHA256 mismatch", receipt["reason"])
        command.assert_not_called()

    def test_subprocess_does_not_receive_provider_or_signing_secrets(self):
        process = Mock(pid=12345)
        process.wait.return_value = 0
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-secret", "APPLE_DISTRIBUTION_PASSWORD": "synthetic-secret"}), patch.object(adapter.subprocess, "Popen", return_value=process) as popen:
            result = adapter.invoke(["/bin/bash", "fixed-fixture.sh"], self.root, self.root / "synthetic.log", 1)
        self.assertEqual(result["exit_code"], 0)
        env = popen.call_args.kwargs["env"]
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("APPLE_DISTRIBUTION_PASSWORD", env)

    def test_subprocess_timeout_signals_only_its_owned_process_group(self):
        process = Mock(pid=12345)
        process.wait.side_effect = [adapter.subprocess.TimeoutExpired("fixture", 1), 0]
        with patch.object(adapter.subprocess, "Popen", return_value=process), patch.object(adapter.os, "killpg") as kill:
            result = adapter.invoke(["/bin/bash", "fixed-fixture.sh"], self.root, self.root / "timeout.log", 1)
        self.assertEqual(result["exit_code"], 124)
        self.assertTrue(result["timed_out"])
        self.assertTrue(all(call.args[0] == process.pid for call in kill.call_args_list))


class SourceContract(unittest.TestCase):
    def test_untracked_unstaged_and_out_of_scope_candidates_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            base = [str(root).encode(), b"a" * 40]
            cases = [base + [b"new.py\0", b""], base + [b"", b"edited.py\0"],
                     base + [b"", b"", b"patch", b"other/path.py\0"],
                     base + [b"", b"", b"patch", b"apps/studio-native/scripts/ios-verify.sh\0"],
                     base + [b"", b"", b"patch", b"apps/studio-native/ios/App/key.p8\0"]]
            for responses in cases:
                with self.subTest(responses=responses), patch.object(adapter, "git", side_effect=responses):
                    with self.assertRaises(adapter.Refused):
                        adapter.source_identity(root)


if __name__ == "__main__":
    unittest.main()
