"""Synthetic contract controls only: no native build, model, device or Foundry call."""
import hashlib
import importlib.util
import json
import os
import shutil
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
        for name in ("android-verify.sh", "android-environment.py"):
            (self.native / "scripts" / name).write_text("# synthetic delegated recipe\n")
        self.identity = patch.object(adapter, "source_identity", return_value=dict(SOURCE))
        self.identity.start()
        self.addCleanup(self.identity.stop)
        env = patch.dict(os.environ, {"ANDROID_SERIAL": "emulator-5554", "ANDROID_SDK_ROOT": "/synthetic/sdk"})
        env.start()
        self.addCleanup(env.stop)

    def command(self, platform, code=0, mutate=None):
        def execute(argv, workspace, log, timeout):
            if platform == "android":
                self.assertEqual(argv, [adapter.sys.executable, str(self.native / "scripts/android-emulator.py"),
                                       "--sdk-root", "/synthetic/sdk", "--work-dir", str(self.native / "evidence/foundry/android/work"),
                                       "--port", "5554", "--adb-port", "5047"])
            else:
                self.assertEqual(argv, ["/bin/bash", str(self.native / "scripts" / (platform + "-verify.sh"))])
            self.assertEqual(workspace, self.root)
            log.write_bytes(b"SYNTHETIC subprocess output\n")
            for relative in adapter.PLATFORMS[platform]["required"]:
                target = self.native / relative
                if relative.endswith((".app", "screenshots")):
                    target /= "synthetic-content.bin"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"SYNTHETIC native artifact, not a real application")
                if relative.endswith("bootstrap/receipt.json"):
                    target.write_text(json.dumps({"schema": "hps-android-bootstrap/1", "exit_code": code,
                                                  "phases": dict.fromkeys(("adb", "bootstrap", "verification", "cleanup"), "PASS")}))
                if relative.endswith("verification.json"):
                    target.write_text(json.dumps({"schema": "hps-android-verification/1", "exit_code": code,
                                                  "phases": dict.fromkeys(("build", "readiness", "instrumentation", "artifacts"), "PASS")}))
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
                if platform == "android":
                    for name in ("android-emulator.py", "android-environment.py"):
                        (native / "scripts" / name).write_text("# fixture\n")
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

    def test_android_recipe_pin_covers_entrypoint_and_delegated_verifier(self):
        before = adapter.recipe_record(self.root, "android")
        self.assertEqual(len(before["files"]), 3)
        (self.native / "scripts/android-verify.sh").write_text("# changed verifier\n")
        self.assertNotEqual(before["sha256"], adapter.recipe_record(self.root, "android")["sha256"])
        with patch.object(adapter, "invoke") as command:
            code, receipt = adapter.accept(self.root, "android", expected_script=before["sha256"])
        self.assertEqual(code, 2); command.assert_not_called()

    def test_unexpected_owned_adapter_exception_after_zero_exit_cannot_pass(self):
        with patch.object(adapter, "invoke", side_effect=self.command("android")), patch.object(adapter, "collect", side_effect=RuntimeError("synthetic final inventory failure")):
            code, receipt = adapter.accept(self.root, "android")
        self.assertEqual((code, receipt["verdict"]), (2, "FAIL"))
        self.assertEqual(receipt["command"]["exit_code"], 0)
        self.assertIn("inventory failure", self.receipt("android")["reason"])

    def test_child_zero_cannot_hide_failed_cleanup_receipt(self):
        def fail_cleanup():
            target = self.native / "evidence/android/bootstrap/receipt.json"
            proof = json.loads(target.read_text()); proof["phases"]["cleanup"] = "FAIL"
            target.write_text(json.dumps(proof))
        with patch.object(adapter, "invoke", side_effect=self.command("android", mutate=fail_cleanup)):
            code, receipt = adapter.accept(self.root, "android")
        self.assertEqual((code, receipt["verdict"]), (2, "FAIL"))
        self.assertIn("owned lifecycle did not pass", receipt["reason"])

    def test_subprocess_does_not_receive_provider_or_signing_secrets(self):
        process = Mock(pid=12345)
        process.wait.return_value = 0
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-secret", "APPLE_DISTRIBUTION_PASSWORD": "synthetic-secret"}), patch.object(adapter.subprocess, "Popen", return_value=process) as popen:
            result = adapter.invoke(["/bin/bash", "fixed-fixture.sh"], self.root, self.root / "synthetic.log", 1)
        self.assertEqual(result["exit_code"], 0)
        env = popen.call_args.kwargs["env"]
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("APPLE_DISTRIBUTION_PASSWORD", env)

    def test_subprocess_preserves_owned_adb_routing_and_sdk_environment(self):
        process = Mock(pid=12345)
        process.wait.return_value = 0
        routing = {"ADB_SERVER_SOCKET": "tcp:127.0.0.1:5058",
                   "ANDROID_ADB_SERVER_PORT": "5058", "ANDROID_SERIAL": "emulator-5586",
                   "ANDROID_HOME": "/synthetic/sdk", "ANDROID_SDK_ROOT": "/synthetic/sdk",
                   "JAVA_HOME": "/synthetic/java", "GRADLE_USER_HOME": "/synthetic/gradle"}
        with patch.dict(os.environ, routing, clear=True), patch.object(adapter.subprocess, "Popen", return_value=process) as popen:
            adapter.invoke(["/bin/bash", "fixed-fixture.sh"], self.root, self.root / "routing.log", 1)
        for key, value in routing.items():
            self.assertEqual(popen.call_args.kwargs["env"][key], value)

    def test_invalid_adb_routing_fails_before_subprocess(self):
        cases = [{"ADB_SERVER_SOCKET": value} for value in (
            "tcp:192.168.1.2:5058", "tcp:0.0.0.0:5058", "tcp:127.0.0.1:0",
            "tcp:localhost:65536", "tcp:localhost:abc", "localfilesystem:/tmp/adb", "")]
        cases += [{"ANDROID_ADB_SERVER_PORT": value} for value in ("", "0", "65536", "5x", " 5058")]
        cases += [{"ADB_SERVER_SOCKET": "tcp:127.0.0.1:5058", "ANDROID_ADB_SERVER_PORT": "5037"},
                  {"ANDROID_ADB_SERVER_ADDRESS": "192.168.1.2"}]
        for routing in cases:
            with self.subTest(routing=routing), patch.dict(os.environ, routing, clear=True), patch.object(adapter.subprocess, "Popen") as popen:
                with self.assertRaises(adapter.Refused):
                    adapter.invoke(["/bin/bash", "fixed-fixture.sh"], self.root, self.root / "refused.log", 1)
                popen.assert_not_called()
                self.assertFalse((self.root / "refused.log").exists())

    def test_adb_port_only_and_loopback_socket_forms(self):
        for routing in ({"ANDROID_ADB_SERVER_PORT": "5058"},
                        {"ADB_SERVER_SOCKET": "tcp:localhost:5058"}, {}):
            with self.subTest(routing=routing), patch.dict(os.environ, routing, clear=True):
                self.assertEqual(adapter.adb_environment(), routing)

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


class RealGitSourceContract(unittest.TestCase):
    """Real temporary Git repositories, synthetic source; no build or device."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.source = self.root / adapter.NATIVE / "ios/App/Intent.swift"
        self.source.parent.mkdir(parents=True)
        self.source.write_text("// synthetic reviewed source\n")
        adapter.git(self.root, "init", "-q")
        adapter.git(self.root, "add", ".")
        adapter.git(self.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "-c", "commit.gpgsign=false", "commit", "-qm", "synthetic fixture")
        self.baseline = adapter.source_identity(self.root)

    def test_assume_unchanged_and_skip_worktree_refused(self):
        relative = str(self.source.relative_to(self.root))
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                adapter.git(self.root, "update-index", "--" + flag, relative)
                self.source.write_text("// unreviewed hidden mutation\n")
                with self.assertRaisesRegex(adapter.Refused, "index flags"):
                    adapter.source_identity(self.root)
                adapter.git(self.root, "update-index", "--no-" + flag, relative)
                self.source.write_text("// synthetic reviewed source\n")

    def test_info_exclude_cannot_hide_compiler_input(self):
        (self.root / ".git/info/exclude").write_text("Unreviewed.swift\n")
        self.source.with_name("Unreviewed.swift").write_text("// hidden compiler input\n")
        with self.assertRaisesRegex(adapter.Refused, "ignored native input"):
            adapter.source_identity(self.root)

    def test_independent_bytes_check_does_not_trust_diff(self):
        self.source.write_text("// changed bytes\n")
        with self.assertRaisesRegex(adapter.Refused, "bytes differ"):
            adapter.verify_native_index(self.root)

    def test_mode_check_ignores_core_filemode_shortcut(self):
        adapter.git(self.root, "config", "core.filemode", "false")
        self.source.chmod(0o755)
        with self.assertRaisesRegex(adapter.Refused, "mode differs"):
            adapter.source_identity(self.root)

    def test_ignored_build_roots_never_reach_native_invocation(self):
        native = self.root / adapter.NATIVE
        (native / ".gitignore").write_text("evidence/\n.build/\nDerivedData*/\n.gradle/\nbuild/\n")
        (native / "scripts").mkdir()
        for spec in adapter.PLATFORMS.values():
            (native / "scripts" / spec["script"]).write_text("# synthetic; never run\n")
        for name in ("android-verify.sh", "android-environment.py"):
            (native / "scripts" / name).write_text("# synthetic delegated recipe\n")
        adapter.git(self.root, "add", ".")
        adapter.git(self.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "-c", "commit.gpgsign=false", "commit", "-qm", "synthetic recipes")
        with tempfile.TemporaryDirectory() as outside:
            for platform in adapter.PLATFORMS:
                for relative in adapter.GENERATED_BUILD_ROOTS:
                    with self.subTest(platform=platform, relative=relative):
                        root = native / relative
                        root.mkdir(parents=True)
                        (root / "Build").symlink_to(outside, target_is_directory=True)
                        with patch.object(adapter, "invoke") as invoke:
                            code, receipt = adapter.accept(self.root, platform)
                        self.assertEqual(code, 2)
                        self.assertEqual(receipt["verdict"], "BLOCKED")
                        self.assertIn("existing output", receipt["reason"])
                        invoke.assert_not_called()
                        self.assertTrue((root / "Build").is_symlink())
                        shutil.rmtree(root)  # Only this temporary fixture's files.
                        shutil.rmtree(native / "evidence")

    def test_reviewed_staged_source_still_accepted(self):
        self.source.write_text("// reviewed new candidate\n")
        adapter.git(self.root, "add", str(self.source.relative_to(self.root)))
        candidate = adapter.source_identity(self.root)
        self.assertTrue(candidate["dirty"])
        self.assertNotEqual(candidate["candidate_tree"], self.baseline["candidate_tree"])
        self.assertEqual(candidate["verified_worktree_scope"], str(adapter.NATIVE))


if __name__ == "__main__":
    unittest.main()
