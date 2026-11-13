"""Two-source release controls, including the real CLI/shell; no provider writes."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

NATIVE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('workflow_gate', NATIVE / 'scripts/verify-native-candidate.py')
gate = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(gate)
APP, CONTROL, MAIN = 'a' * 40, 'b' * 40, 'c' * 40
SOURCE = {'checkout_sha': APP, 'native_tree': 'd' * 40, 'native_workflow': 'e' * 40}
ENV = {'GITHUB_REPOSITORY': gate.REPOSITORY, 'GITHUB_SHA': CONTROL, 'GITHUB_WORKFLOW_SHA': CONTROL,
       'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
       'GITHUB_WORKFLOW_REF': gate.REPOSITORY + '/' + gate.RELEASE_WORKFLOW + '@refs/heads/main',
       'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2', 'GITHUB_RUN_NUMBER': '19',
       'NATIVE_EXPECTED_SHA': APP, 'NATIVE_EXPECTED_WORKFLOW_SHA': CONTROL,
       'NATIVE_OPERATION_ID': 'native-source-3866', 'NATIVE_REQUEST_DIGEST': 'f' * 64}

def proofs(app=APP, control=CONTROL, main=MAIN):
    return [{'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': main}},
            {'status': 'identical' if app == control else 'ahead', 'base_commit': {'sha': app}, 'merge_base_commit': {'sha': app}},
            {'status': 'identical' if control == main else 'ahead', 'base_commit': {'sha': control}, 'merge_base_commit': {'sha': control}}]

def gate_document(source, env):
    identity = gate.release_identity(source, env, read=Mock(side_effect=proofs(source['checkout_sha'], env['GITHUB_SHA'], env['GITHUB_SHA'])))
    return {'schema': 'hps-native-release-gate/2', 'verdict': 'PASS',
            'release_checkout_sha': identity['source_sha'], 'source_head_sha': identity['source_sha'],
            'workflow_source_sha': identity['workflow_source_sha'],
            'release_run_id': identity['run_id'], 'release_run_attempt': identity['run_attempt'],
            'deployment_request': identity['deployment_request'],
            'native_tree': source['native_tree'], 'native_workflow': source['native_workflow'],
            'native_run_id': 100, 'native_run_attempt': 3, 'artifact_id': 456,
            'signing': 'NOT_RUN', 'deployment': 'NOT_RUN'}

class WorkflowSourceContracts(unittest.TestCase):
    def test_forward_main_churn_keeps_both_prepared_identities_and_exact_ci_source(self):
        read = Mock(side_effect=proofs())
        identity = gate.release_identity(SOURCE, ENV, read=read)
        self.assertEqual(identity['source_sha'], APP)
        self.assertEqual(identity['workflow_source_sha'], CONTROL)
        self.assertEqual(identity['deployment_request'], {
            'schema': 'hps-native-deployment-request/2', 'expected_sha': APP, 'workflow_sha': CONTROL,
            'operation_id': ENV['NATIVE_OPERATION_ID'], 'request_digest': ENV['NATIVE_REQUEST_DIGEST']})
        self.assertEqual([c.args[0] for c in read.call_args_list], [
            'repos/' + gate.REPOSITORY + '/git/ref/heads/main',
            'repos/' + gate.REPOSITORY + '/compare/' + APP + '...' + CONTROL,
            'repos/' + gate.REPOSITORY + '/compare/' + CONTROL + '...' + MAIN])
        with tempfile.TemporaryDirectory() as directory:
            result = {'schema': 'hps-native-release-gate/1', 'verdict': 'PASS', 'release_checkout_sha': APP, 'source_head_sha': APP}
            output = Path(directory) / 'gate.json'
            with patch.dict(os.environ, ENV, clear=True), patch.object(gate, 'repository_root', return_value=Path(directory)), \
                 patch.object(gate, 'source_identity', side_effect=[{**SOURCE, 'checkout_sha': CONTROL}, SOURCE]), \
                 patch.object(gate, 'api', side_effect=proofs() + proofs()), \
                 patch.object(gate, 'wait_for_candidate', return_value=result) as wait, \
                 patch.object(sys, 'argv', ['gate', 'gate', '--candidate-root', directory, '--output', str(output)]):
                gate.main()
            wait.assert_called_once_with(SOURCE, APP, 1500, 30)
            doc = json.loads(output.read_text())
            self.assertEqual((doc['schema'], doc['source_head_sha'], doc['workflow_source_sha']), ('hps-native-release-gate/2', APP, CONTROL))

    def test_partial_or_changed_workflow_and_untrusted_event_fail_before_provider_reads(self):
        changes = [('GITHUB_SHA', MAIN), ('GITHUB_WORKFLOW_SHA', MAIN), ('GITHUB_REF', 'refs/heads/topic'),
                   ('GITHUB_WORKFLOW_REF', 'fork/repo/' + gate.RELEASE_WORKFLOW + '@refs/heads/main'),
                   ('GITHUB_EVENT_NAME', 'pull_request'), ('NATIVE_EXPECTED_WORKFLOW_SHA', 'short'),
                   ('NATIVE_EXPECTED_SHA', MAIN)]
        changes += [(key, '') for key in ('NATIVE_EXPECTED_SHA', 'NATIVE_OPERATION_ID', 'NATIVE_REQUEST_DIGEST')]
        for key, value in changes:
            read = Mock()
            with self.subTest(key=key), self.assertRaises(gate.Refused):
                gate.release_identity(SOURCE, {**ENV, key: value}, read=read)
            read.assert_not_called()

    def test_unrelated_candidate_rewritten_main_malformed_proof_and_read_denial_fail_closed(self):
        for index, update in [(0, {'ref': 'refs/heads/topic'}), (0, {'object': {'type': 'tag', 'sha': MAIN}}),
                              (1, {'status': 'diverged'}), (2, {'status': 'behind'}),
                              (1, {'merge_base_commit': {'sha': MAIN}}), (2, {'base_commit': {'sha': APP}})]:
            rows = proofs(); rows[index].update(update)
            with self.subTest(index=index, update=update), self.assertRaises(gate.Refused):
                gate.verify_workflow_ancestry(APP, CONTROL, read=Mock(side_effect=rows))
        with self.assertRaisesRegex(gate.Refused, 'denied'):
            gate.verify_workflow_ancestry(APP, CONTROL, read=Mock(side_effect=gate.Refused('denied')))

    def test_v2_gate_cannot_relabel_workflow_source_attempt_or_v1_evidence(self):
        identity = gate.release_identity(SOURCE, ENV, read=Mock(side_effect=proofs()))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'gate.json'; doc = gate_document(SOURCE, ENV)
            path.write_text(json.dumps(doc))
            self.assertEqual(gate.verify_release_gate(path, SOURCE, identity)['native_run_id'], 100)
            for key, value in [('workflow_source_sha', MAIN), ('workflow_source_sha', None),
                               ('schema', 'hps-native-release-gate/1'), ('release_run_attempt', 1),
                               ('source_head_sha', CONTROL), ('deployment_request', None)]:
                path.write_text(json.dumps({**doc, key: value}))
                with self.subTest(key=key), self.assertRaises(gate.Refused):
                    gate.verify_release_gate(path, SOURCE, identity)

    def fixture(self, directory):
        temp = Path(directory); control = temp / 'control'; control.mkdir()
        def git(*args): return subprocess.check_output(['git', '-C', str(control), *args], text=True, stderr=subprocess.DEVNULL).strip()
        native = control / 'apps/studio-native'; scripts = native / 'scripts'; scripts.mkdir(parents=True)
        (native / 'ios').mkdir(); (native / 'ios/input.txt').write_text('reviewed app input')
        (scripts / 'verify-native-candidate.py').write_text("raise SystemExit('STALE CANDIDATE HELPER EXECUTED')\n")
        (control / '.github/workflows').mkdir(parents=True)
        (control / gate.WORKFLOW).write_text('native CI fixture')
        (control / '.gitignore').write_text('__pycache__/\napps/studio-native/evidence/\n')
        git('init', '-q'); git('add', '.')
        commit = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm']
        git(*commit, 'candidate'); app = git('rev-parse', 'HEAD')
        for name in ['verify-native-candidate.py', 'apple-upload.sh']: shutil.copyfile(NATIVE / 'scripts' / name, scripts / name)
        git('add', '.'); git(*commit, 'trusted control'); head = git('rev-parse', 'HEAD')
        candidate = temp / 'candidate'; git('worktree', 'add', '--detach', str(candidate), app)
        env = {**os.environ, **ENV, 'GITHUB_SHA': head, 'GITHUB_WORKFLOW_SHA': head,
               'NATIVE_EXPECTED_SHA': app, 'NATIVE_EXPECTED_WORKFLOW_SHA': head,
               'GITHUB_ACTIONS': 'true', 'RUNNER_TEMP': str(temp / 'runner'),
               'NATIVE_CANDIDATE_ROOT': str(candidate), 'FIXTURE_CONTROL': str(control)}
        bindir = temp / 'metadata-bin'; bindir.mkdir()
        gh = bindir / 'gh'; gh.write_text('''#!/usr/bin/env python3
import json,os,subprocess,sys
path=sys.argv[-1]
def git(*args): return subprocess.check_output(['git','-C',os.environ['FIXTURE_CONTROL'],*args],text=True).strip()
if path.endswith('/git/ref/heads/main'):
 result={'ref':'refs/heads/main','object':{'type':'commit','sha':git('rev-parse','HEAD')}}
else:
 a,b=path.split('/compare/')[1].split('...'); base=git('merge-base',a,b)
 result={'status':'identical' if a==b else ('ahead' if base==a else 'diverged'),'base_commit':{'sha':a},'merge_base_commit':{'sha':base}}
 if os.environ.get('REFUSE_ANCESTRY'):result['status']='diverged'
print(json.dumps(result))
'''); gh.chmod(0o755); env['PATH'] = str(bindir) + os.pathsep + env['PATH']
        path = temp / 'runner/native-release-gate/native-release-gate.json'; path.parent.mkdir(parents=True)
        path.write_text(json.dumps(gate_document(gate.source_identity(candidate), env)))
        return control, candidate, scripts, env, path

    def test_actual_cli_uses_trusted_control_with_old_candidate_helper_and_refuses_dirty_or_wrong_control(self):
        with tempfile.TemporaryDirectory() as directory:
            control, candidate, scripts, env, receipt = self.fixture(directory)
            command = [sys.executable, str(scripts / 'verify-native-candidate.py'), 'request', '--candidate-root', str(candidate),
                       '--release-gate', str(receipt), '--output', str(Path(directory) / 'preflight.json')]
            result = subprocess.run(command, cwd=directory, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            doc = json.loads((Path(directory) / 'preflight.json').read_text())
            self.assertEqual(doc['source_sha'], env['NATIVE_EXPECTED_SHA'])
            self.assertEqual(doc['workflow_source_sha'], env['GITHUB_SHA'])
            moved = subprocess.run(command, cwd=directory, env={**env, 'NATIVE_EXPECTED_WORKFLOW_SHA': APP}, capture_output=True, text=True)
            self.assertNotEqual(moved.returncode, 0); self.assertIn('Control checkout differs', moved.stderr)
            (candidate / 'apps/studio-native/ios/input.txt').write_text('uncommitted')
            dirty = subprocess.run(command, cwd=directory, env=env, capture_output=True, text=True)
            self.assertNotEqual(dirty.returncode, 0); self.assertIn('clean', dirty.stderr)

    def test_actual_upload_shell_rechecks_ancestry_before_signing_material(self):
        with tempfile.TemporaryDirectory() as directory:
            control, candidate, scripts, env, receipt = self.fixture(directory)
            result = subprocess.run(['bash', str(scripts / 'apple-upload.sh'), 'ios'], cwd=directory,
                                    env={**env, 'REFUSE_ANCESTRY': '1'}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0); self.assertIn('trusted main ancestry', result.stderr)
            self.assertNotIn('Missing deployment configuration', result.stderr)
            self.assertFalse((candidate / 'apps/studio-native/evidence').exists())
            self.assertEqual([p.name for p in Path(env['RUNNER_TEMP']).iterdir()], ['native-release-gate'])

    def fixture_repo(self, directory):
        _, candidate, scripts, env, _ = self.fixture(directory)
        return candidate, scripts, candidate / 'apps/studio-native/ios', env

    def test_actual_v2_upload_tail_retains_all_phase_failures_and_two_source_receipt(self):
        # Reuse the actual command-tail controls with real separate checkouts,
        # so signing remains stubbed but receipt provenance runs the real CLI.
        from test_native_deployment_contract import DeploymentContracts
        DeploymentContracts.test_actual_upload_tail_records_only_complete_command_success(self)

if __name__ == '__main__': unittest.main()
