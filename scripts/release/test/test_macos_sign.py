#!/usr/bin/env python3
"""Portable process-level Apple-tool controls; NOT actual notarization evidence."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "macos-sign.py"
spec = importlib.util.spec_from_file_location("macos_sign", SCRIPT)
sign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sign)
TEAM = "A1B2C3D4E5"
CERT = "A" * 40
SOURCE = "1" * 40

# These mock executables consume the real CLI arguments and persist invocation
# order across processes. The production orchestration is not stubbed out.
TOOLS = r'''#!/usr/bin/env python3
import json, os, pathlib, shutil, signal, stat, sys, zipfile
tool = pathlib.Path(sys.argv[0]).name
a = sys.argv[1:]
with open(os.environ['MOCK_LOG'], 'a') as f: f.write(json.dumps([tool, *a]) + '\n')
def fail(message):
    print(message, file=sys.stderr); sys.exit(1)
if os.environ.get('MOCK_FAIL') == tool + ':' + (a[0] if a else ''): fail('injected failure')
if tool == 'security':
    if a[0] == 'list-keychains':
        state = pathlib.Path(os.environ['MOCK_SEARCH_LIST'])
        counter = state.with_suffix('.count')
        count = int(counter.read_text()) + 1 if counter.exists() else 1
        counter.write_text(str(count))
        if str(count) == os.environ.get('MOCK_SEARCH_FAIL_AT'): fail('search-list operation unavailable')
        if '-s' in a: state.write_text(json.dumps(a[a.index('-s')+1:]))
        else:
            for item in json.loads(state.read_text()): print(json.dumps(item))
        sys.exit(0)
    if a[0] == 'create-keychain': pathlib.Path(a[-1]).touch()
    if a[0] == 'delete-keychain': pathlib.Path(a[-1]).unlink()
    kind = os.environ.get('MOCK_CERT_KIND', 'Developer ID Application')
    print('  1) ' + 'A'*40 + ' "' + kind + ': Fixture (' + os.environ.get('MOCK_TEAM', 'A1B2C3D4E5') + ')"')
elif tool == 'file':
    print('compiled Java class data' if a[-1].endswith('.class') else 'Mach-O 64-bit arm64 executable')
elif tool == 'codesign':
    if '--display' in a:
        print('Authority=Developer ID Application: Fixture (A1B2C3D4E5)\nTeamIdentifier=' + os.environ.get('MOCK_CODE_TEAM', 'A1B2C3D4E5'))
        if not os.environ.get('MOCK_NO_RUNTIME'): print('CodeDirectory flags=0x10000(runtime)\nTimestamp=Nov 12, 2026 at 12:00:00')
    elif '--sign' in a:
        state = pathlib.Path(os.environ['MOCK_SEARCH_LIST'])
        if a[a.index('--keychain')+1] not in json.loads(state.read_text()):
            fail('The specified item could not be found in the keychain.')
        if os.environ.get('MOCK_CONCURRENT_KEYCHAIN'):
            state.write_text(json.dumps([os.environ['MOCK_CONCURRENT_KEYCHAIN'], *json.loads(state.read_text())]))
        if os.environ.get('MOCK_CONCURRENT_SEARCH'):
            state.write_text(json.dumps([a[a.index('--keychain')+1], *json.loads(os.environ['MOCK_CONCURRENT_SEARCH'])]))
        if os.environ.get('MOCK_SIGNAL'):
            os.kill(os.getppid(), getattr(signal, os.environ['MOCK_SIGNAL'])); sys.exit(0)
        p = pathlib.Path(a[-1])
        if p.is_dir():
            marker = p / '_CodeSignature' / 'CodeResources'; marker.parent.mkdir(exist_ok=True)
            marker.write_text('signed fixture')
    elif os.environ.get('MOCK_BAD_CHAIN'): fail('a sealed resource is missing or invalid / requirement failed')
elif tool == 'xcrun':
    if a[0] == 'clang': pathlib.Path(a[-1]).write_bytes(b'\xcf\xfa\xed\xfe' + b'probe fixture')
    elif a[0] == '--find': print('/usr/bin/' + a[1])
    elif a[:2] == ['notarytool', 'history']: print('{}')
    elif a[:2] == ['notarytool', 'submit']:
        if os.environ.get('MOCK_SUBMIT_AMBIGUOUS'): fail('network interrupted after upload')
        print(json.dumps({'id':'12345678-1234-1234-1234-123456789abc'}))
    elif a[:2] == ['notarytool', 'wait']:
        if os.environ.get('MOCK_WAIT_TIMEOUT'): fail('timeout waiting; submission remains in progress')
        print(json.dumps({'id':a[2], 'status':os.environ.get('MOCK_NOTARY_STATUS', 'Accepted')}))
    elif a[:2] == ['stapler', 'staple']:
        (pathlib.Path(a[-1])/'Contents'/'ticket').write_text('fixture ticket')
    elif a[:2] == ['stapler', 'validate']:
        if not (pathlib.Path(a[-1])/'Contents'/'ticket').is_file(): fail('missing ticket')
elif tool == 'spctl': print('accepted\nsource=' + os.environ.get('MOCK_GATEKEEPER', 'Notarized Developer ID'))
elif tool == 'ditto':
    if '-c' in a:
        app, out = map(pathlib.Path, a[-2:])
        with zipfile.ZipFile(out, 'w') as z:
            for p in sorted(app.rglob('*')):
                if p.is_dir() and not p.is_symlink(): continue
                name = str(p.relative_to(app.parent))
                entry = zipfile.ZipInfo(name); entry.create_system = 3; entry.external_attr = p.lstat().st_mode << 16
                z.writestr(entry, os.readlink(p).encode() if p.is_symlink() else p.read_bytes())
    else:
        archive, target = map(pathlib.Path, a[-2:])
        with zipfile.ZipFile(archive) as z:
            for e in z.infolist():
                p = target/e.filename; p.parent.mkdir(parents=True, exist_ok=True)
                mode = e.external_attr >> 16
                if stat.S_ISLNK(mode): p.symlink_to(z.read(e).decode())
                else: p.write_bytes(z.read(e)); p.chmod(mode & 0o777)
'''


class SigningControls(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ["security", "file", "codesign", "xcrun", "spctl", "ditto", "uuidgen"]:
            tool = self.bin / name
            tool.write_text(TOOLS)
            tool.chmod(0o755)
        self.log = self.root / "invocations.jsonl"
        self.keychain = self.root / "isolated.keychain-db"
        self.keychain.touch()
        self.search_state = self.root / "search-list.json"
        self.original_search = ["/fixture/login.keychain-db", "/fixture/Unrelated Keychain.keychain-db",
                                "/fixture/third.keychain-db"]
        self.search_state.write_text(json.dumps(self.original_search))
        self.app = self.root / "HypeProof Studio.app"
        (self.app / "Contents/Resources/app").mkdir(parents=True)
        (self.app / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": "ai.hypeproof.studio", "CFBundleShortVersionString": "2026.1112.1"}))
        (self.app / "Contents/Resources/app/product.json").write_text(json.dumps({"commit": SOURCE}))
        self.native("Contents/MacOS/Electron")
        self.native("Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework")
        (self.app / "Contents/Frameworks/Electron Framework.framework/Versions/Current").symlink_to("A")
        self.native("Contents/Frameworks/Studio Helper (Plugin).app/Contents/MacOS/Plugin")
        self.native("Contents/Frameworks/Studio Helper (Renderer).app/Contents/MacOS/Renderer")
        self.native("Contents/Resources/app/extensions/chat/dist/vendor/runtime")
        self.native("Contents/Resources/app/extensions/chat/dist/vendor/addon.node")
        self.native("Contents/Resources/app/Thing.class", magic=b"\xca\xfe\xba\xbe")
        self.args = argparse.Namespace(identity=CERT, team_id=TEAM, keychain=str(self.keychain),
            notary_profile="fixture", app=str(self.app), source_sha=SOURCE,
            output=str(self.root/"dist"), evidence=str(self.root/"evidence"), notary_timeout="1s")
        environment = {k:v for k,v in os.environ.items() if not k.startswith(("MOCK_", "GITHUB_"))}
        environment.update(PATH=str(self.bin)+os.pathsep+os.environ["PATH"], MOCK_LOG=str(self.log),
                           MOCK_SEARCH_LIST=str(self.search_state))
        self.env = patch.dict(os.environ, environment, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        self.platform = patch.object(sign.sys, "platform", "darwin")
        self.platform.start(); self.addCleanup(self.platform.stop)

    def native(self, relative, magic=b"\xcf\xfa\xed\xfe"):
        p = self.app / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(magic+b"fixture")
        p.chmod(0o755)

    def release(self):
        with contextlib.redirect_stdout(io.StringIO()):
            sign.release(self.args)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def receipt(self):
        return Path(self.args.output)/sign.RECEIPT

    def test_complete_release_signs_inside_out_and_binds_final_archive(self):
        os.environ.update(GITHUB_ACTIONS="true", GITHUB_REPOSITORY="hypeproof/hypeproof-studio", GITHUB_RUN_ID="43226628056", GITHUB_RUN_ATTEMPT="2",
                          GITHUB_WORKFLOW_REF="hypeproof/hypeproof-studio/.github/workflows/build-mac.yml@refs/tags/v2026.1112.1-rc.1")
        self.release()
        commands = [c for c in self.calls() if c[0] == "codesign" and "--sign" in c]
        self.assertGreaterEqual(len(commands), 10)
        self.assertEqual(commands[-1][-1], str(self.app))
        paths = [Path(c[-1]) for c in commands]
        for child in paths:
            for parent in paths:
                if parent != child and parent in child.parents:
                    self.assertLess(paths.index(child), paths.index(parent))
        for command in commands:
            self.assertNotIn("--deep", command)
            self.assertIn("--timestamp", command)
            self.assertIn("runtime", command)
            if command[-1].endswith(".node"):
                self.assertNotIn("--entitlements", command)
        self.assertFalse(any(c[-1].endswith(".class") for c in commands))
        receipt = sign.read_json(self.receipt())
        self.assertEqual(receipt["artifact"]["sha256"], sign.sha256(Path(self.args.output)/sign.ASSET))
        self.assertNotEqual(receipt["artifact"]["sha256"], receipt["notarization"]["submitted_archive_sha256"])
        self.assertTrue(receipt["release_eligible"])
        self.assertEqual(receipt["provenance"]["run_attempt"], 2)
        original = self.receipt().read_bytes()
        with self.assertRaisesRegex(sign.SigningError, "already exists"):
            self.release()
        self.assertEqual(self.receipt().read_bytes(), original)

    def test_missing_self_signed_app_store_and_wrong_team_fail_before_signing(self):
        for identity, kind, team in [("-", "Developer ID Application", TEAM), (CERT, "Self Signed", TEAM),
                                     (CERT, "Apple Distribution", TEAM), (CERT, "Developer ID Application", "Z9Y8X7W6V5")]:
            with self.subTest(identity=identity, kind=kind, team=team):
                self.args.identity = identity
                os.environ.update(MOCK_CERT_KIND=kind, MOCK_TEAM=team)
                with self.assertRaises(sign.SigningError): self.release()
        self.assertFalse(any(c[0] == "codesign" for c in self.calls()))

    def test_invalid_signature_runtime_or_gatekeeper_cannot_make_receipt(self):
        for variable, value in [("MOCK_BAD_CHAIN", "1"), ("MOCK_NO_RUNTIME", "1"), ("MOCK_CODE_TEAM", "WRONG"), ("MOCK_GATEKEEPER", "Developer ID")]:
            with self.subTest(variable=variable), tempfile.TemporaryDirectory() as scratch:
                self.args.evidence = str(Path(scratch)/"evidence")
                self.args.output = str(Path(scratch)/"dist")
                with patch.dict(os.environ, {variable: value}):
                    with self.assertRaises(sign.SigningError): self.release()
                self.assertFalse(self.receipt().exists())
                self.assertFalse((Path(self.args.output)/sign.ASSET).exists())

    def test_wait_timeout_resumes_same_submission_without_resigning_or_reupload(self):
        with patch.dict(os.environ, {"MOCK_WAIT_TIMEOUT": "1"}):
            with self.assertRaisesRegex(sign.SigningError, "timeout"): self.release()
        self.assertFalse(self.receipt().exists())
        before = len([c for c in self.calls() if "--sign" in c and str(self.app) in c[-1]])
        self.release()
        self.assertEqual(len([c for c in self.calls() if "--sign" in c and str(self.app) in c[-1]]), before)
        self.assertEqual(len([c for c in self.calls() if c[:3] == ["xcrun", "notarytool", "submit"]]), 1)
        self.assertFalse(sign.read_json(self.receipt())["release_eligible"])

    def test_invalid_notary_never_staples_or_packages_and_tamper_prevents_resume(self):
        with patch.dict(os.environ, {"MOCK_NOTARY_STATUS": "Invalid"}):
            with self.assertRaisesRegex(sign.SigningError, "not Accepted"): self.release()
        self.assertFalse(any(c[:3] == ["xcrun", "stapler", "staple"] for c in self.calls()))
        (self.app/"Contents/changed.txt").write_text("mutation")
        with self.assertRaisesRegex(sign.SigningError, "changed since checkpoint"): self.release()
        self.assertFalse(self.receipt().exists())

    def test_ambiguous_submit_cannot_automatically_upload_twice(self):
        with patch.dict(os.environ, {"MOCK_SUBMIT_AMBIGUOUS": "1"}):
            with self.assertRaisesRegex(sign.SigningError, "network interrupted"): self.release()
        with self.assertRaisesRegex(sign.SigningError, "ambiguous prior submission"): self.release()
        self.assertEqual(len([c for c in self.calls() if c[:3] == ["xcrun", "notarytool", "submit"]]), 1)

    def test_archive_tamper_and_source_or_provenance_mismatch_fail_closed(self):
        self.args.source_sha = "2"*40
        with self.assertRaisesRegex(sign.SigningError, "source stamp mismatch"): self.release()
        self.args.source_sha = SOURCE
        with patch.dict(os.environ, {"GITHUB_ACTIONS":"true", "GITHUB_REPOSITORY":"someone/fork"}):
            with self.assertRaisesRegex(sign.SigningError, "actual run identity"): self.release()
        with patch.dict(os.environ, {"MOCK_WAIT_TIMEOUT":"1"}):
            with self.assertRaises(sign.SigningError): self.release()
        (Path(self.args.evidence)/"submitted.zip").write_text("tampered")
        with self.assertRaisesRegex(sign.SigningError, "digest changed"): self.release()

    def test_escaping_symlink_refused_before_signature_mutation(self):
        (self.app/"Contents/escape").symlink_to(self.root)
        with self.assertRaisesRegex(sign.SigningError, "symlink escapes"): self.release()
        self.assertFalse(any("--sign" in c and str(self.app) in c[-1] for c in self.calls()))

    def test_real_preflight_flow_catches_unusable_key_before_notary_or_app_and_restores_list(self):
        with patch.dict(os.environ, {"MOCK_FAIL": "codesign:--force"}):
            with self.assertRaisesRegex(sign.SigningError, "codesign --force failed"):
                self.release()
        self.assertEqual(json.loads(self.search_state.read_text()), self.original_search)
        self.assertFalse(any(c[:2] == ["xcrun", "notarytool"] for c in self.calls()))
        self.assertFalse(any("--sign" in c and str(self.app) in c[-1] for c in self.calls()))
        probes = [Path(c[-1]) for c in self.calls() if c[:2] == ["xcrun", "clang"]]
        self.assertEqual(len(probes), 1)
        self.assertFalse(probes[0].parent.exists())
        self.assertFalse(self.receipt().exists())

    def test_search_scope_preserves_existing_and_concurrent_unrelated_entries(self):
        with patch.dict(os.environ, {"MOCK_CONCURRENT_KEYCHAIN": "/fixture/new-peer.keychain-db"}):
            sign.preflight(self.args)
        self.assertEqual(json.loads(self.search_state.read_text()),
                         ["/fixture/new-peer.keychain-db", *self.original_search])
        self.search_state.write_text(json.dumps(self.original_search))
        concurrent = [self.original_search[2], self.original_search[0]]
        with patch.dict(os.environ, {"MOCK_CONCURRENT_SEARCH": json.dumps(concurrent)}):
            sign.preflight(self.args)
        self.assertEqual(json.loads(self.search_state.read_text()), concurrent)
        already_listed = [str(self.keychain), *self.original_search]
        self.search_state.write_text(json.dumps(already_listed))
        self.log.unlink()
        sign.preflight(self.args)
        self.assertEqual(json.loads(self.search_state.read_text()), already_listed)
        self.assertFalse(any(c[:2] == ["security", "list-keychains"] and "-s" in c for c in self.calls()))

    def test_cleanup_read_or_write_failure_blocks_preflight_success_and_notary(self):
        for operation in (4, 5):  # fresh-list read, then removal write
            with self.subTest(operation=operation):
                self.log.unlink(missing_ok=True)
                self.search_state.with_suffix('.count').unlink(missing_ok=True)
                self.search_state.write_text(json.dumps(self.original_search))
                with patch.dict(os.environ, {"MOCK_SEARCH_FAIL_AT": str(operation)}):
                    with self.assertRaisesRegex(sign.SigningError, "search-list operation unavailable"):
                        sign.preflight(self.args)
                self.assertIn(str(self.keychain), json.loads(self.search_state.read_text()))
                self.assertFalse(any(c[:2] == ["xcrun", "notarytool"] for c in self.calls()))

    def test_actual_cli_term_and_int_restore_search_list_and_fail_without_submission(self):
        for number, name in [(15, "SIGTERM"), (2, "SIGINT")]:
            with self.subTest(signal=name):
                self.log.unlink(missing_ok=True)
                env = dict(os.environ, MOCK_SIGNAL=name)
                code = ("import importlib.util,sys; "
                        f"s=importlib.util.spec_from_file_location('sign',{str(SCRIPT)!r}); "
                        "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
                        "m.sys.platform='darwin'; sys.exit(m.main())")
                result = subprocess.run([sys.executable, "-c", code, "preflight", "--identity", CERT,
                    "--team-id", TEAM, "--keychain", str(self.keychain), "--notary-profile", "fixture"],
                    env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 128 + number, result.stderr)
                self.assertEqual(json.loads(self.search_state.read_text()), self.original_search)
                self.assertFalse(any(c[:2] == ["xcrun", "notarytool"] for c in self.calls()))

    def test_policy_and_workflow_keep_legacy_out_of_official_lane(self):
        policies = {p.stem:plistlib.loads(p.read_bytes()) for p in sign.ENTITLEMENTS.glob("*.plist")}
        self.assertNotIn("com.apple.security.get-task-allow", repr(policies))
        self.assertNotIn("com.apple.security.cs.disable-library-validation", policies["app"])
        self.assertEqual(set(policies["jit"]), {"com.apple.security.cs.allow-jit"})
        workflow = (sign.ROOT/".github/workflows/build-mac.yml").read_text()
        self.assertIn("run: bash scripts/release/import-macos-signing.sh", workflow)
        self.assertNotIn("run: bash scripts/sign-mac.sh", workflow)
        self.assertNotIn("MACOS_CERT_P12:", workflow)
        self.assertLess(workflow.index("run: bash scripts/release/import-macos-signing.sh"), workflow.index("- name: Choose build path"))
        self.assertLess(workflow.index("run: bash scripts/stamp-mac-app.sh"), workflow.index("python3 scripts/release/macos-sign.py release"))
        self.assertIn("dist/HypeProof-Studio-darwin-arm64.signing.json", workflow)
        self.assertIn('"${HPS_SIGNING_KEYCHAIN:-}" == "$RUNNER_TEMP/hps-developer-id.keychain-db"', workflow)

    def test_import_rejects_missing_credentials_and_existing_keychain_without_mutating_it(self):
        script = sign.ROOT / "scripts/release/import-macos-signing.sh"
        env = dict(os.environ, RUNNER_TEMP=str(self.root), GITHUB_ENV=str(self.root/"github-env"),
                   MACOS_DEVELOPER_ID_P12="Zml4dHVyZQ==", MACOS_DEVELOPER_ID_PASSWORD="fixture-only",
                   MACOS_DEVELOPER_ID_SHA1=CERT, MACOS_TEAM_ID=TEAM, MACOS_NOTARY_KEY_P8="fixture-key",
                   MACOS_NOTARY_KEY_ID="fixture", MACOS_NOTARY_ISSUER_ID="fixture")
        missing = dict(env); missing.pop("MACOS_DEVELOPER_ID_P12")
        result = subprocess.run(["bash", str(script)], env=missing, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuration missing", result.stdout)
        self.assertEqual(self.calls(), [])
        existing = self.root/"hps-developer-id.keychain-db"
        existing.write_text("owned by another run")
        result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(existing.read_text(), "owned by another run")
        self.assertEqual(self.calls(), [])
        existing.unlink()
        env["MOCK_FAIL"] = "security:import"
        result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(existing.exists())
        self.assertEqual(list(self.root.glob("hps-signing-import.*")), [])
        self.assertNotIn("fixture-only", result.stdout+result.stderr)
        self.assertFalse((self.root/"github-env").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
