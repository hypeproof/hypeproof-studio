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


COLLECT = importlib.util.spec_from_file_location('signin_collect', Path(__file__).parents[1] / 'scripts/collect-signin-journey.py')
collect = importlib.util.module_from_spec(COLLECT)
COLLECT.loader.exec_module(collect)
PASSED = f"Test Case '-[HPStudioUITests.StudioSignInBoundaryTests {collect.TEST}]' "

def journey_record(status='PARTIAL', **hops):
    value = {name: {'status': 'NOT_RUN'} for name in gate.REQUIRED_HOPS}
    value.update({name: {'status': 'PASS'} for name in collect.BROWSER_HOPS})
    value.update(hops)
    return {'schema': gate.SIGNIN_SCHEMA, 'repository': gate.REPOSITORY, 'source_head_sha': HEAD, 'run_id': 123,
            'run_attempt': 2, 'status': status, 'hops': value}

def with_journey(record):
    listing = artifacts()
    listing['artifacts'].append({'id': 789, 'name': 'studio-native-signin-journey-123-2', 'expired': False,
                                 'workflow_run': {'id': 123, 'head_sha': HEAD}})
    return Mock(side_effect=[{'workflow_runs': [RUN]}, listing, archive(document()),
                             archive(record, 'signin-journey.json'), {'workflow_runs': [RUN]}])

class SignedInJourneyDistribution(unittest.TestCase):
    """Designed outcomes: who may receive a build, given the journey result for that exact source."""
    def test_external_needs_pass_internal_may_proceed_and_says_so_fail_blocks_both(self):
        external = gate.decide_distribution('external', 'PASS')
        self.assertEqual((external['testflight_internal_only'], external['external_distribution_eligible']), (False, True))
        for status in ('NOT_RUN', 'PARTIAL', 'FAIL'):
            with self.subTest(status=status), self.assertRaisesRegex(gate.Refused, 'External distribution requires|FAILED'):
                gate.decide_distribution('external', status)
        for status in ('NOT_RUN', 'PARTIAL'):
            internal = gate.decide_distribution('internal', status)
            with self.subTest(status=status):
                self.assertTrue(internal['testflight_internal_only'])
                self.assertFalse(internal['external_distribution_eligible'])
                self.assertIn('Internal testing only', internal['note'])
                self.assertEqual(internal['signed_in_journey'], status)
        with self.assertRaisesRegex(gate.Refused, 'FAILED'):
            gate.decide_distribution('internal', 'FAIL')
        for audience, status in (('public', 'PASS'), ('external', 'MAYBE')):
            with self.assertRaises(gate.Refused):
                gate.decide_distribution(audience, status)

    def test_default_audience_is_internal_and_garbage_is_refused(self):
        self.assertEqual(gate.distribution_audience({}), 'internal')
        self.assertEqual(gate.distribution_audience({'NATIVE_DISTRIBUTION_AUDIENCE': 'external'}), 'external')
        for value in ('EXTERNAL', 'all', 'internal\n'):
            with self.assertRaises(gate.Refused):
                gate.distribution_audience({'NATIVE_DISTRIBUTION_AUDIENCE': value})

    def test_verdict_is_pass_only_when_every_hop_passes_and_is_recomputed_from_hops(self):
        every = {name: {'status': 'PASS'} for name in gate.REQUIRED_HOPS}
        self.assertEqual(gate.journey_status(every), 'PASS')
        self.assertEqual(gate.journey_status({**every, gate.REQUIRED_HOPS[3]: {'status': 'NOT_RUN'}}), 'PARTIAL')
        self.assertEqual(gate.journey_status({**every, gate.REQUIRED_HOPS[0]: {'status': 'FAIL'}}), 'FAIL')
        self.assertEqual(gate.journey_status({}), 'NOT_RUN')
        for bad in ({'invented_hop': {'status': 'PASS'}}, {gate.REQUIRED_HOPS[0]: {'status': 'GREEN'}}, []):
            with self.assertRaises(gate.Refused):
                gate.journey_status(bad)

    def test_gate_and_collector_agree_on_the_hops(self):
        self.assertEqual(gate.REQUIRED_HOPS, collect.REQUIRED_HOPS)
        for hops in ({}, {n: {'status': 'PASS'} for n in collect.REQUIRED_HOPS},
                     {n: {'status': 'PASS'} for n in collect.BROWSER_HOPS}):
            self.assertEqual(gate.journey_status(hops), collect.overall(hops))

    def test_missing_journey_record_is_not_run_never_pass(self):
        read = Mock(side_effect=[{'workflow_runs': [RUN]}, artifacts(), archive(document()), {'workflow_runs': [RUN]}])
        result = gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=read)
        self.assertEqual(result['signed_in_journey']['status'], 'NOT_RUN')
        self.assertEqual(result['signed_in_journey']['unverified'], list(gate.REQUIRED_HOPS))

    def test_exact_run_record_is_read_and_unverified_hops_are_listed(self):
        result = gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=with_journey(journey_record()))
        journey = result['signed_in_journey']
        self.assertEqual(journey['status'], 'PARTIAL')
        self.assertEqual(journey['unverified'], list(collect.AUTHENTICATED_HOPS))
        self.assertEqual(journey['artifact_id'], 789)

    def test_record_for_another_source_run_or_with_a_forged_verdict_is_refused(self):
        for change in ({'source_head_sha': MERGE}, {'run_id': 124}, {'run_attempt': 1}, {'status': 'PASS'},
                       {'schema': 'other'}, {'repository': 'other/repo'}):
            with self.subTest(change=change), self.assertRaises(gate.Refused):
                gate.wait_for_candidate(SOURCE, HEAD, 10, 10, read=with_journey({**journey_record(), **change}))

    def test_upload_side_decision_is_recomputed_and_matches_the_requested_audience(self):
        partial = {'signed_in_journey': {'hops': journey_record()['hops']}}
        full = {'signed_in_journey': {'hops': {n: {'status': 'PASS'} for n in gate.REQUIRED_HOPS}}}
        external = {'NATIVE_DISTRIBUTION_AUDIENCE': 'external'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'gate.json'
            def decide(document, environ):
                path.write_text(json.dumps(document))
                return gate.release_distribution(path, environ)
            self.assertTrue(decide(partial, {})['testflight_internal_only'])
            self.assertTrue(decide({}, {})['testflight_internal_only'])  # legacy gate without a record: NOT_RUN
            self.assertFalse(decide(full, external)['testflight_internal_only'])
            for document in (partial, {}):
                with self.assertRaises(gate.Refused):
                    decide(document, external)
            # A gate admitted for one audience cannot be replayed for another.
            admitted = {**full, 'distribution': gate.decide_distribution('external', 'PASS')}
            with self.assertRaisesRegex(gate.Refused, 'differs'):
                decide(admitted, {})

class SigninCollector(unittest.TestCase):
    def lines(self, *events):
        return ''.join(PASSED + event + '\n' for event in events)

    def test_passing_browser_case_still_leaves_the_authenticated_hops_unverified(self):
        record = collect.collect(HEAD, 123, 2, self.lines('started.', 'passed (12.0 seconds).'), 0)
        self.assertEqual(record['status'], 'PARTIAL')
        self.assertEqual(record['unverified'], list(collect.AUTHENTICATED_HOPS))
        self.assertTrue(all('reason' in record['hops'][n] for n in collect.AUTHENTICATED_HOPS))
        self.assertEqual(gate.verify_signin_journey(record, RUN, 789)['status'], 'PARTIAL')

    def test_failed_absent_or_crashed_browser_case_is_never_a_pass(self):
        for log, code, expected in ((self.lines('started.', 'failed (3.0 seconds).'), 65, 'FAIL'),
                                    ('', 0, 'NOT_RUN'), ('', 65, 'NOT_RUN'),
                                    (self.lines('started.'), 65, 'FAIL'),
                                    (self.lines('started.', 'passed (1.0 seconds).'), 65, 'FAIL'),
                                    (self.lines('started.', 'skipped (0.1 seconds).'), 0, 'NOT_RUN')):
            with self.subTest(log=log, code=code):
                self.assertEqual(collect.collect(HEAD, 1, 1, log, code)['status'], expected)

    def test_identity_must_be_real(self):
        for args in (('short', 1, 1, '', 0), (HEAD, 0, 1, '', 0), (HEAD, 1, 1, '', 256)):
            with self.assertRaises(ValueError):
                collect.collect(*args)

if __name__ == '__main__':
    unittest.main()
