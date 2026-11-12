"""Synthetic gate contracts only: no GitHub call, native build or signing."""
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock
import zipfile

SPEC = importlib.util.spec_from_file_location('native_gate', Path(__file__).parents[1] / 'scripts/verify-native-candidate.py')
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
HEAD, MERGE = 'a' * 40, 'b' * 40
SOURCE = {'checkout_sha': HEAD, 'native_tree': 'c' * 40, 'native_workflow': 'd' * 40}
RUN = {'id': 123, 'run_attempt': 2, 'head_sha': HEAD, 'path': gate.WORKFLOW,
       'head_repository': {'full_name': gate.REPOSITORY}, 'event': 'pull_request',
       'status': 'completed', 'conclusion': 'success'}

def archive(document, name='native-candidate.json', mode=stat.S_IFREG | 0o600):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as file:
        entry = zipfile.ZipInfo(name)
        entry.external_attr = mode << 16
        file.writestr(entry, json.dumps(document))
    return out.getvalue()

def document(**extra):
    value = gate.identity_document({**SOURCE, 'checkout_sha': MERGE}, HEAD, 123, 2)
    return {**value, **extra}

def artifacts(**extra):
    return {'artifacts': [{'id': 456, 'name': gate.artifact_name(RUN), 'expired': False,
                           'workflow_run': {'id': 123, 'head_sha': HEAD}, **extra}]}

class GateContracts(unittest.TestCase):
    def test_successful_pr_merge_proves_same_native_source_without_equal_checkout_sha(self):
        read = Mock(side_effect=[{'workflow_runs': [RUN]}, artifacts(), archive(document()), {'workflow_runs': [RUN]}])
        result = gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=read)
        self.assertEqual(result['verdict'], 'PASS')
        self.assertEqual(result['native_run_attempt'], 2)
        self.assertEqual(result['signing'], 'NOT_RUN')
        self.assertIn('/runs/123/artifacts?', read.call_args_list[1].args[0])
        self.assertTrue(read.call_args_list[2].kwargs['binary'])

    def test_rerun_new_run_or_failure_during_artifact_download_blocks_pass(self):
        for changed in ({**RUN, 'run_attempt': 3, 'status': 'in_progress'},
                        {**RUN, 'id': 124}, {**RUN, 'conclusion': 'failure'}):
            read = Mock(side_effect=[{'workflow_runs': [RUN]}, artifacts(), archive(document()), {'workflow_runs': [changed]}])
            with self.subTest(changed=changed), self.assertRaisesRegex(gate.Refused, 'eligibility changed'):
                gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=read)

    def test_never_reuses_other_head_or_older_success_over_latest_failure(self):
        old = {**RUN, 'id': 120}
        failed = {**RUN, 'conclusion': 'failure'}
        wrong = {**RUN, 'id': 999, 'head_sha': MERGE}
        self.assertEqual(gate.select_run({'workflow_runs': [old, wrong, failed]}, HEAD), failed)
        with self.assertRaisesRegex(gate.Refused, 'did not succeed'):
            gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=Mock(return_value={'workflow_runs': [old, failed]}))

    def test_fork_wrong_workflow_and_invalid_run_identity_are_rejected(self):
        for extra in ({'path': '.github/workflows/other.yml'}, {'head_repository': {'full_name': 'other/fork'}},
                      {'event': 'workflow_run'}, {'run_attempt': 0}):
            with self.subTest(extra=extra), self.assertRaises(gate.Refused):
                gate.select_run({'workflow_runs': [{**RUN, **extra}]}, HEAD)

    def test_source_or_run_attempt_mismatch_cannot_pass(self):
        for extra in ({'native_tree': 'f' * 40}, {'native_workflow': 'e' * 40}, {'source_head_sha': MERGE},
                      {'run_id': 124}, {'run_attempt': 1}, {'schema': 'other'}, {'checkout_sha': 'short'}):
            with self.subTest(extra=extra), self.assertRaises(gate.Refused):
                gate.verify_identity(document(**extra), SOURCE, RUN)

    def test_missing_expired_stale_or_other_run_artifacts_fail_closed(self):
        for payload in ({'artifacts': []}, artifacts(expired=True), artifacts(name='studio-native-candidate-123-1'),
                        artifacts(workflow_run={'id': 124, 'head_sha': HEAD}),
                        {'artifacts': artifacts()['artifacts'] * 2}):
            with self.subTest(payload=payload), self.assertRaises(gate.Refused):
                gate.select_artifact(payload, RUN)

    def test_archive_traversal_symlink_extra_content_and_size_are_rejected(self):
        bad = [archive(document(), '../native-candidate.json'), archive(document(), mode=stat.S_IFLNK | 0o777),
               archive({'data': 'x' * 9000}), b'x' * 65537, b'not-a-zip']
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as file:
            file.writestr('native-candidate.json', '{}')
            file.writestr('extra', 'bad')
        bad.append(out.getvalue())
        for data in bad:
            with self.subTest(length=len(data)), self.assertRaises(gate.Refused):
                gate.read_identity_archive(data)

    def test_missing_or_in_progress_ci_reaches_bounded_timeout(self):
        for runs in ([], [{**RUN, 'status': 'in_progress', 'conclusion': None}]):
            now = [0]
            def sleep(seconds): now[0] += seconds
            read = Mock(return_value={'workflow_runs': runs})
            with self.assertRaisesRegex(gate.Refused, 'Timed out'):
                gate.wait_for_candidate(SOURCE, HEAD, 25, 10, read=read, clock=lambda: now[0], sleep=sleep)
            self.assertEqual(now[0], 25)
            self.assertEqual(read.call_count, 3)

    def test_read_retries_transient_server_once_but_not_denial_or_rate_limit(self):
        transient = Mock(returncode=1, stderr=b'HTTP 503', stdout=b'')
        good = Mock(returncode=0, stdout=b'{}')
        with patch.object(gate.subprocess, 'run', side_effect=[transient, good]) as run, patch.object(gate.time, 'sleep') as sleep:
            self.assertEqual(gate.api('synthetic'), {})
            self.assertEqual(run.call_count, 2)
            sleep.assert_called_once_with(2)
        for error in (b'HTTP 403 rate limit', b'HTTP 429', b'HTTP 404'):
            with patch.object(gate.subprocess, 'run', return_value=Mock(returncode=1, stderr=error)) as run, self.assertRaises(gate.Refused):
                gate.api('synthetic')
            self.assertEqual(run.call_count, 1)

    def test_real_git_source_identity_and_dirty_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'apps/studio-native').mkdir(parents=True)
            source = root / 'apps/studio-native/source.txt'
            source.write_text('synthetic native source')
            (root / '.gitignore').write_text('__pycache__/\n')
            workflow = root / gate.WORKFLOW
            workflow.parent.mkdir(parents=True)
            workflow.write_text('synthetic workflow')
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL, text=True).strip()
            git('init', '-q'); git('add', '.')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
            identity = gate.source_identity(root)
            self.assertEqual(identity['native_tree'], git('rev-parse', 'HEAD:apps/studio-native'))
            self.assertEqual(identity['native_workflow'], git('rev-parse', 'HEAD:' + gate.WORKFLOW))
            cache = root / 'apps/studio-native/__pycache__'
            cache.mkdir()
            (cache / 'synthetic.pyc').write_bytes(b'synthetic ignored cache')
            self.assertEqual(gate.source_identity(root), identity)
            source.write_text('edited without commit')
            with self.assertRaisesRegex(gate.Refused, 'clean'):
                gate.source_identity(root)

if __name__ == '__main__':
    unittest.main()
