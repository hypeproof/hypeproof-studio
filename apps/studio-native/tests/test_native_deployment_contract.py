"""Deployment identity and actual upload-tail controls; no Apple/network/signing calls."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

NATIVE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('deployment_gate', NATIVE / 'scripts/verify-native-candidate.py')
gate = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(gate)
HEAD = 'a' * 40
ENV = {'GITHUB_REPOSITORY': gate.REPOSITORY, 'GITHUB_SHA': HEAD, 'GITHUB_RUN_ID': '123',
       'GITHUB_RUN_ATTEMPT': '2', 'GITHUB_RUN_NUMBER': '19', 'GITHUB_ACTIONS': 'true',
       'NATIVE_EXPECTED_SHA': HEAD, 'NATIVE_OPERATION_ID': 'testflight-19', 'NATIVE_REQUEST_DIGEST': 'd' * 64}
SOURCE = {'checkout_sha': HEAD, 'native_tree': 'b' * 40, 'native_workflow': 'c' * 40}

class DeploymentContracts(unittest.TestCase):
    def test_legacy_inputs_are_optional_but_partial_request_is_refused(self):
        self.assertIsNone(gate.deployment_request({}, HEAD))
        names = ['NATIVE_EXPECTED_SHA', 'NATIVE_OPERATION_ID', 'NATIVE_REQUEST_DIGEST']
        for mask in range(1, 7):
            env = {key: ENV[key] for i, key in enumerate(names) if mask & (1 << i)}
            with self.subTest(mask=mask), self.assertRaises(gate.Refused): gate.deployment_request(env, HEAD)

    def test_malformed_or_moved_request_is_refused(self):
        for name, value in [('NATIVE_EXPECTED_SHA', HEAD + '\n'), ('NATIVE_EXPECTED_SHA', 'b' * 40),
                            ('NATIVE_OPERATION_ID', 'x\n'), ('NATIVE_OPERATION_ID', 'x' * 101),
                            ('NATIVE_OPERATION_ID', '$(echo unsafe)'), ('NATIVE_REQUEST_DIGEST', 'd' * 63),
                            ('NATIVE_REQUEST_DIGEST', 'D' * 64), ('GITHUB_SHA', 'b' * 40)]:
            with self.subTest(name=name, value=value), self.assertRaises(gate.Refused):
                gate.release_identity(SOURCE, {**ENV, name: value})
        with self.assertRaises(gate.Refused): gate.release_identity({**SOURCE, 'checkout_sha': 'b' * 40}, ENV)

    def test_gate_artifact_carries_request_run_and_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'gate.json'
            result = {'schema': 'hps-native-release-gate/1', 'verdict': 'PASS', 'release_checkout_sha': HEAD}
            with patch.dict(os.environ, ENV, clear=True), patch.object(gate, 'source_identity', return_value=SOURCE), \
                 patch.object(gate, 'repository_root', return_value=Path(directory)), \
                 patch.object(gate, 'wait_for_candidate', return_value=result) as wait, \
                 patch.object(sys, 'argv', ['verify-native-candidate.py', 'gate', '--output', str(output)]):
                gate.main()
            actual = json.loads(output.read_text())
            self.assertEqual(actual['deployment_request'], gate.deployment_request(ENV, HEAD))
            self.assertEqual((actual['release_run_id'], actual['release_run_attempt']), (123, 2))
            wait.assert_called_once_with(SOURCE, HEAD, 1500, 30)

    def fixture_repo(self, directory):
        root = Path(directory) / 'repo'; scripts = root / 'apps/studio-native/scripts'; scripts.mkdir(parents=True)
        for name in ['verify-native-candidate.py', 'apple-upload.sh']: shutil.copyfile(NATIVE / 'scripts' / name, scripts / name)
        ios = scripts.parent / 'ios'; ios.mkdir(); (ios / 'placeholder').write_text('fixture')
        (root / '.github/workflows').mkdir(parents=True)
        (root / gate.WORKFLOW).write_text('fixture native workflow')
        (root / '.gitignore').write_text('__pycache__/\napps/studio-native/evidence/\n')
        def git(*args): return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()
        git('init', '-q'); git('add', '.')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
        head = git('rev-parse', 'HEAD')
        env = {**os.environ, **ENV, 'GITHUB_SHA': head, 'NATIVE_EXPECTED_SHA': head, 'RUNNER_TEMP': str(Path(directory) / 'runner')}
        Path(env['RUNNER_TEMP']).mkdir()
        return root, scripts, ios, env

    def test_real_cli_finds_repo_from_script_for_external_and_nested_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            root, scripts, ios, env = self.fixture_repo(directory)
            for index, cwd in enumerate([Path(directory), ios]):
                output = Path(directory) / f'preflight-{index}.json'
                p = subprocess.run([sys.executable, str(scripts / 'verify-native-candidate.py'), 'request', '--output', str(output)], cwd=cwd, env=env, capture_output=True, text=True)
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual(json.loads(output.read_text())['source_sha'], env['GITHUB_SHA'])

    def test_actual_shell_rejects_wrong_sha_before_any_signing_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root, scripts, ios, env = self.fixture_repo(directory)
            env['NATIVE_EXPECTED_SHA'] = 'e' * 40
            p = subprocess.run(['bash', str(scripts / 'apple-upload.sh'), 'ios'], cwd=directory, env=env, capture_output=True, text=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn('differs from trigger or checkout', p.stderr)
            self.assertFalse((root / 'apps/studio-native/evidence').exists())
            self.assertEqual(list(Path(env['RUNNER_TEMP']).iterdir()), [])

    def make_receipt_inputs(self, root):
        package = root / 'fixture.ipa'; package.write_bytes(b'synthetic IPA bytes')
        info = root / 'archive.plist'; info.write_bytes(plistlib.dumps({'ApplicationProperties': {
            'CFBundleIdentifier': 'ai.hypeproof.studio.mobile', 'CFBundleShortVersionString': '0.2.0', 'CFBundleVersion': '19.2'}}))
        outcomes = root / 'outcomes.json'; outcomes.write_text(json.dumps(dict.fromkeys(['archive', 'export', 'validation', 'upload'], 0)))
        return package, info, outcomes

    def test_receipt_binds_bytes_and_identity_but_never_claims_available(self):
        with tempfile.TemporaryDirectory() as directory:
            package, info, outcomes = self.make_receipt_inputs(Path(directory))
            identity = gate.release_identity(SOURCE, ENV)
            actual = gate.upload_receipt(identity, package, info, outcomes, ENV)
            self.assertEqual(actual['package_sha256'], hashlib.sha256(package.read_bytes()).hexdigest())
            self.assertEqual(actual['package_size'], package.stat().st_size)
            self.assertEqual(actual['deployment_request'], identity['deployment_request'])
            self.assertEqual(actual['commands']['upload'], {'exit_code': 0})
            self.assertEqual(actual['state'], 'uploaded')
            self.assertEqual(actual['apple_processing'], 'NOT_OBSERVED')
            self.assertEqual(actual['tester_availability'], 'NOT_OBSERVED')
            self.assertNotIn('PRIVATE', json.dumps(actual))
            legacy = gate.upload_receipt({**identity, 'deployment_request': None}, package, info, outcomes, ENV)
            self.assertIsNone(legacy['deployment_request'])

    def test_missing_failed_or_uncertain_outcomes_cannot_emit_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            package, info, outcomes = self.make_receipt_inputs(Path(directory))
            identity = gate.release_identity(SOURCE, ENV)
            for key in ['archive', 'export', 'validation', 'upload']:
                for value in [1, None, False, '0']:
                    commands = dict.fromkeys(['archive', 'export', 'validation', 'upload'], 0); commands[key] = value
                    outcomes.write_text(json.dumps(commands))
                    with self.subTest(key=key, value=value), self.assertRaises(gate.Refused): gate.upload_receipt(identity, package, info, outcomes, ENV)
            outcomes.write_text('{}')
            with self.assertRaises(gate.Refused): gate.upload_receipt(identity, package, info, outcomes, ENV)

    def test_other_build_empty_package_or_symlink_cannot_emit_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); package, info, outcomes = self.make_receipt_inputs(root)
            identity = gate.release_identity(SOURCE, ENV)
            with self.assertRaises(gate.Refused): gate.upload_receipt(identity, package, info, outcomes, {**ENV, 'GITHUB_RUN_NUMBER': '20'})
            link = root / 'link.ipa'; link.symlink_to(package)
            with self.assertRaises(gate.Refused): gate.upload_receipt(identity, link, info, outcomes, ENV)
            package.write_bytes(b'')
            with self.assertRaises(gate.Refused): gate.upload_receipt(identity, package, info, outcomes, ENV)

    def test_actual_upload_tail_records_only_complete_command_success(self):
        # Execute the unchanged archive/export/validate/upload/receipt tail with
        # synthetic tools. Signing setup is deliberately not executed by this test.
        tail = (NATIVE / 'scripts/apple-upload.sh').read_text().split("destination='generic/platform=iOS'", 1)[1]
        for failure in ['', 'archive', 'export', 'validation', 'upload']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root, scripts, ios, env = self.fixture_repo(directory)
                temp = Path(directory); private = temp / 'private'; private.mkdir(); commands = temp / 'bin'; commands.mkdir()
                fake = '''#!/usr/bin/env python3
import json,os,pathlib,plistlib,sys
args=sys.argv[1:]
phase=('export' if '-exportArchive' in args else 'archive') if pathlib.Path(sys.argv[0]).name=='xcodebuild' else ('validation' if '--validate-app' in args else 'upload')
with open(os.environ['CALLS'],'a') as f:f.write(phase+'\\n')
if phase==os.environ['FAIL_PHASE']:sys.exit(47)
if phase=='archive':
 p=pathlib.Path(args[args.index('-archivePath')+1]);p.mkdir();(p/'Info.plist').write_bytes(plistlib.dumps({'ApplicationProperties':{'CFBundleIdentifier':'ai.hypeproof.studio.mobile','CFBundleShortVersionString':'0.2.0','CFBundleVersion':'19.2'}}))
if phase=='export':
 p=pathlib.Path(args[args.index('-exportPath')+1]);p.mkdir();(p/'fixture.ipa').write_bytes(b'synthetic package')
print('fixture command completed')
'''
                for name in ['xcodebuild', 'xcrun']: p = commands / name; p.write_text(fake); p.chmod(0o755)
                evidence = root / 'apps/studio-native/evidence/apple-ios'; evidence.mkdir(parents=True)
                env.update(PATH=str(commands) + os.pathsep + env['PATH'], FAIL_PHASE=failure, CALLS=str(temp / 'calls'),
                           APPLE_DEVELOPER_TEAM_ID='fixture', APP_STORE_CONNECT_KEY_ID='fixture', APP_STORE_CONNECT_ISSUER_ID='fixture',
                           private=str(private), evidence=str(evidence), platform='ios', identity='fixture', profile_name='fixture')
                p = subprocess.run(['bash', '-c', "set -euo pipefail\ndestination='generic/platform=iOS'" + tail], cwd=ios, env=env, capture_output=True, text=True)
                receipt = evidence / 'upload-receipt.json'
                if failure:
                    self.assertEqual(p.returncode, 47, p.stdout + p.stderr); self.assertFalse(receipt.exists())
                    self.assertEqual((temp / 'calls').read_text().splitlines()[-1], failure)
                else:
                    self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                    value = json.loads(receipt.read_text()); self.assertEqual(value['state'], 'uploaded')
                    self.assertEqual((temp / 'calls').read_text().splitlines(), ['archive', 'export', 'validation', 'upload'])
                    self.assertEqual(value['source_sha'], env['GITHUB_SHA'])

    def test_workflow_keeps_existing_gates_and_optional_correlation(self):
        workflow = (NATIVE.parents[1] / '.github/workflows/studio-apple-testflight.yml').read_text()
        self.assertIn("studio-testflight:{0}:{1}", workflow)
        for key in ['expected_sha', 'operation_id', 'request_digest']:
            self.assertIn(key + ':', workflow); self.assertIn('${{ inputs.' + key + ' }}', workflow)
        for preserved in ["branches: ['release/studio-unified-preview']", 'needs: native-candidate',
                          'environment: apple-native-preview', 'platform: [ios]', 'cancel-in-progress: false']:
            self.assertIn(preserved, workflow)
        self.assertEqual(workflow.count('required: false'), 3)

if __name__ == '__main__': unittest.main()
