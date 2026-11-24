"""iOS UI gate and nightly sets (#4432 stage 3): every declared case is in exactly one set, each
workflow plans only its own set, and a nightly failure lands on one open issue.

Runs the real plan/merge code on the real suite and the shipped ios-ui-sets.json, the real
ios-collect.sh with the real journey collectors, and the real issue script against a fake API.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[1]
ROOT = NATIVE.parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_ios_ui_shards as base  # noqa: E402  (shard fixtures; a module import adds no test classes here)

shards = base.shards
SPEC = importlib.util.spec_from_file_location('journey_evidence', NATIVE / 'scripts/collect-native-journeys.py')
journey = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(journey)
ISSUE_SPEC = importlib.util.spec_from_file_location('nightly_issue', NATIVE / 'scripts/nightly-failure-issue.py')
issue = importlib.util.module_from_spec(ISSUE_SPEC); ISSUE_SPEC.loader.exec_module(issue)

SETS = NATIVE / 'scripts/ios-ui-sets.json'
GATE_WORKFLOW = ROOT / '.github/workflows/studio-native-mobile.yml'
NIGHTLY_WORKFLOW = ROOT / '.github/workflows/studio-native-mobile-nightly.yml'
VOICE = base.VOICE
PUSH = 'HPStudioUITests/StudioJourneyTests/testSystemApprovalPushOpensMatchingReadOnlyCard'
BROWSER = 'HPStudioUITests/StudioSignInBoundaryTests/testSystemBrowserOpensLiveSignInPageAndCancelReturnsToApp'
# The D2 gate set (core-set.md), minus the system browser sign-in case (chalk-po, 11-24).
KNOWN_GATE = {
    'HPStudioUITests/StudioShellTests/testFirstInstallExplainsAccountStorageWithoutASeparateForm',
    'HPStudioUITests/StudioJourneyTests/testFirstInstallSignInToFirstAnswerWithoutDesktop',
    'HPStudioUITests/StudioJourneyTests/testFirstUseLargeTextDarkAndKeyboardKeepComposerReachable',
    VOICE,
    'HPStudioUITests/StudioJourneyTests/testBackgroundStopsCaptureAndPreservesUnsentDraftAcrossRelaunch',
    PUSH,
    'HPStudioUITests/StudioJourneyTests/testFailedSendRetainsOutboxAndRetriesSameRequestAfterRelaunch',
    'HPStudioUITests/StudioJourneyTests/testEightyMessageWindowFollowsNewTailWithoutInterruptingReading',
    'HPStudioUITests/TeamEntryUITests/testTeamPushWarmAndColdOpenUseAuthorizedRequestAndPreserveDraft',
    'HPStudioUITests/TeamEntryUITests/testSignedInHomeOpensVerifiedInboxWithoutSettingsOrSendingDraft',
    'HPStudioUITests/TeamEntryUITests/testGitHubObservationsPreserveDraftAndSeparateStaleFailure',
}
# Shard budget: the 35-min job limit, at least 6 min left, and the slowest observed time before the
# first test (10.6-15.6 min, #4432 F21, the ios-ui matrix comment).
JOB_LIMIT_MIN, MARGIN_MIN, BEFORE_FIRST_TEST_MIN = 35, 6, 15.6


def shard_count(workflow):
    return int(re.findall(r"^\s*IOS_UI_SHARDS: '([0-9]+)'$", workflow.read_text(), re.M)[0])


def real_plan(selection, shard_total=None):
    workflow = GATE_WORKFLOW if selection == 'gate' else NIGHTLY_WORKFLOW
    return shards.plan(shards.discover(NATIVE / 'ios/UITests'), shard_total or shard_count(workflow), [VOICE],
                       shards.load_durations(NATIVE / 'scripts/ios-ui-durations.json'), selection, shards.load_sets(SETS))


def declared():
    return {f'HPStudioUITests/{c}/{t}' for c, tests in shards.discover(NATIVE / 'ios/UITests').items() for t in tests}


def planned(doc):
    return [case for row in doc['shards'] for case in row['cases']]


class KnownAnswer(unittest.TestCase):
    def test_gate_is_the_eleven_known_cases_nightly_the_other_57_and_together_all_68(self):
        gate, nightly = real_plan('gate'), real_plan('nightly')
        self.assertEqual(len(declared()), 68)
        self.assertEqual(set(shards.load_sets(SETS)), KNOWN_GATE)
        self.assertEqual((len(planned(gate)), len(set(planned(gate)))), (11, 11))
        self.assertEqual(set(planned(gate)), KNOWN_GATE)
        self.assertEqual((len(planned(nightly)), len(set(planned(nightly)))), (57, 57))
        self.assertEqual(set(planned(gate)) & set(planned(nightly)), set())
        self.assertEqual(set(planned(gate)) | set(planned(nightly)), declared())
        # Each plan excludes exactly the other set; the system browser case moved to the nightly set.
        self.assertEqual(set(gate['excluded']), set(planned(nightly)))
        self.assertEqual(set(nightly['excluded']), set(planned(gate)))
        self.assertIn(BROWSER, planned(nightly))
        self.assertEqual((gate['set'], nightly['set']), ('gate', 'nightly'))

    def test_gate_keeps_the_voice_row_after_its_shards_and_nightly_has_none(self):
        gate, nightly = real_plan('gate'), real_plan('nightly')
        *regular, voice = gate['shards']
        self.assertEqual((voice['index'], voice['dedicated'], voice['cases']), (shard_count(GATE_WORKFLOW) + 1, True, [VOICE]))
        self.assertEqual(gate['catch_all'], shard_count(GATE_WORKFLOW))
        self.assertIn(PUSH, planned({'shards': regular}))
        self.assertFalse(any(row['dedicated'] for row in nightly['shards']))
        self.assertEqual(nightly['shard_count'], shard_count(NIGHTLY_WORKFLOW))
        self.assertNotIn(VOICE, planned(nightly))

    def test_each_catch_all_shard_skips_the_other_set(self):
        for selection in ('gate', 'nightly'):
            with self.subTest(selection=selection):
                doc = real_plan(selection)
                last = doc['shards'][doc['catch_all'] - 1]
                skipped = {argument.split(':', 1)[1] for argument in last['xcodebuild_arguments']}
                self.assertTrue(all(argument.startswith('-skip-testing:') for argument in last['xcodebuild_arguments']))
                self.assertLessEqual(set(doc['excluded']), skipped)
                self.assertEqual(skipped & set(last['cases']), set())

    def test_every_shard_of_both_sets_fits_the_job_limit_with_six_minutes_left(self):
        for selection in ('gate', 'nightly'):
            doc = real_plan(selection)
            for row in doc['shards']:
                if row['dedicated']:
                    continue
                with self.subTest(selection=selection, shard=row['index']):
                    self.assertEqual(row['unmeasured_cases'], 1 if PUSH in row['cases'] else 0)
                    self.assertLessEqual(BEFORE_FIRST_TEST_MIN + row['estimated_seconds'] / 60, JOB_LIMIT_MIN - MARGIN_MIN)

    def test_fewer_nightly_shards_would_not_keep_six_minutes(self):
        # Why the nightly matrix has 5 shards and not 4.
        doc = real_plan('nightly', shard_count(NIGHTLY_WORKFLOW) - 1)
        self.assertGreater(max(BEFORE_FIRST_TEST_MIN + row['estimated_seconds'] / 60 for row in doc['shards']),
                           JOB_LIMIT_MIN - MARGIN_MIN)


class SetFile(unittest.TestCase):
    def write(self, document):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        path = Path(temp.name, 'sets.json'); path.write_text(json.dumps(document))
        return path

    def test_the_sets_file_is_read_strictly(self):
        for document in ({'schema': 'other', 'gate': ['x']}, {'schema': shards.SCHEMA_SETS, 'gate': []},
                         {'schema': shards.SCHEMA_SETS, 'gate': ['a', 'a']}, {'schema': shards.SCHEMA_SETS, 'gate': [1]}):
            with self.subTest(document=document), self.assertRaises(ValueError):
                shards.load_sets(self.write(document))

    def test_an_undeclared_gate_case_unknown_set_or_missing_file_is_refused(self):
        classes = {'AlphaTests': ['testA', 'testB', 'testC']}
        with self.assertRaisesRegex(ValueError, 'Gate case\\(s\\) not declared'):
            shards.plan(classes, 2, selection='gate', gate=['HPStudioUITests/AlphaTests/testRenamed'])
        with self.assertRaisesRegex(ValueError, 'Gate case\\(s\\) not declared'):
            shards.plan(classes, 2, selection='all', gate=['HPStudioUITests/AlphaTests/testRenamed'])
        with self.assertRaisesRegex(ValueError, 'needs the UI sets file'):
            shards.plan(classes, 2, selection='nightly')
        with self.assertRaisesRegex(ValueError, 'Unknown UI set'):
            shards.plan(classes, 2, selection='weekly', gate=['HPStudioUITests/AlphaTests/testA'])

    def test_without_a_set_the_plan_is_every_case_as_before(self):
        classes = shards.discover(NATIVE / 'ios/UITests')
        before = shards.plan(classes, 4, [VOICE])
        self.assertEqual((before['set'], before['excluded']), ('all', []))
        self.assertEqual(set(planned(before)), declared())

    def test_plan_reader_refuses_a_plan_that_excludes_a_planned_case(self):
        doc = shards.plan({'AlphaTests': ['testA', 'testB', 'testC', 'testD']}, 2, selection='gate',
                          gate=['HPStudioUITests/AlphaTests/testA', 'HPStudioUITests/AlphaTests/testB'])
        path = self.write(doc)
        self.assertEqual(shards.read_plan(path), doc)
        doc['excluded'].append(doc['shards'][0]['cases'][0])
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, 'excludes a planned case'):
            shards.read_plan(path)

    def test_build_plans_the_set_from_the_environment(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        command = script[script.index('python3 ../scripts/ios-ui-shards.py plan'):script.index('exit 0', script.index('python3 ../scripts/ios-ui-shards.py plan'))]
        self.assertIn('--set "${IOS_UI_SET:-all}" --sets ../scripts/ios-ui-sets.json', command)


class MergeExcluded(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.plan = shards.plan({'AlphaTests': ['testA', 'testB', 'testC'], 'BetaTests': ['testD', 'testE', 'testF']}, 2,
                                selection='gate', gate=['HPStudioUITests/AlphaTests/testA', 'HPStudioUITests/AlphaTests/testB',
                                                        'HPStudioUITests/BetaTests/testD'])

    def merge(self, extra=None):
        for row in self.plan['shards']:
            base.write_shard(self.root / 'shards', row['index'], row['cases'], extra=(extra or {}).get(row['index'], ''))
        return shards.merge(self.plan, self.root / 'shards', self.root / 'evidence')

    def test_positive_control_the_gate_set_alone_passes(self):
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'PASS', doc['problems'])
        self.assertEqual((doc['planned_cases'], doc['set'], doc['excluded_started']), (3, 'gate', []))

    def test_a_case_of_the_other_set_that_started_fails_even_in_the_catch_all(self):
        doc = self.merge({2: base.started('HPStudioUITests/BetaTests/testF')})
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(doc['excluded_started'], ['HPStudioUITests/BetaTests/testF'])
        self.assertEqual(doc['unplanned_in_last_shard'], [])

    def test_an_unparsed_case_is_still_accepted_in_the_catch_all(self):
        doc = self.merge({2: base.started('HPStudioUITests/AlphaTests/testUnparsed')})
        self.assertEqual(doc['verdict'], 'PASS', doc['problems'])
        self.assertEqual(doc['unplanned_in_last_shard'], ['HPStudioUITests/AlphaTests/testUnparsed'])


class JourneysBySet(unittest.TestCase):
    def collect(self, doc, log):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'build.log').write_text('** BUILD SUCCEEDED **\n')
            (root / 'sim.log').write_text(log)
            (root / 'plan.json').write_text(json.dumps(doc))
            return journey.collect(base.SHA, root / 'build.log', 0, root / 'sim.log', 0, root / 'plan.json')

    def test_a_set_passes_on_its_own_journeys_and_names_the_others_not_planned(self):
        for selection in ('gate', 'nightly'):
            with self.subTest(selection=selection):
                doc = real_plan(selection)
                result = self.collect(doc, ''.join(base.started(case) for case in planned(doc)))
                self.assertEqual(result['test_candidate_eligibility'], 'PASS')
                states = {case['test']: case['status'] for case in result['simulator_journeys']['cases']}
                own = {case.split('/', 1)[1].replace('/', '.') for case in planned(doc)}
                self.assertTrue(all(state == ('PASS' if test in own else 'NOT_PLANNED') for test, state in states.items()))
                self.assertEqual(result['simulator_journeys']['ui_set'], selection)
                self.assertEqual(len(result['simulator_journeys']['not_planned']), sum(1 for test in states if test not in own))
        self.assertEqual(self.collect(real_plan('nightly'), '')['os_speech_playback']['status'], 'NOT_PLANNED')

    def test_a_missing_planned_journey_or_an_unlisted_one_still_blocks(self):
        doc = real_plan('gate')
        log = ''.join(base.started(case) for case in planned(doc) if not case.endswith('testFirstInstallSignInToFirstAnswerWithoutDesktop'))
        result = self.collect(doc, log)
        self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')
        # A required journey the plan neither runs nor names as excluded is NOT_RUN, never NOT_PLANNED.
        name = 'HPStudioUITests/StudioJourneyTests/testLongHistoryRestoresLatestAcrossRelaunchConversationAndAccountSwitch'
        doc['excluded'].remove(name)
        result = self.collect(doc, ''.join(base.started(case) for case in planned(doc)))
        self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')
        self.assertIn('NOT_RUN', {case['status'] for case in result['simulator_journeys']['cases']})

    def test_without_a_plan_every_journey_is_required_as_before(self):
        doc = real_plan('gate')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'build.log').write_text('** BUILD SUCCEEDED **\n')
            (root / 'sim.log').write_text(''.join(base.started(case) for case in planned(doc)))
            result = journey.collect(base.SHA, root / 'build.log', 0, root / 'sim.log', 0)
        self.assertEqual(result['test_candidate_eligibility'], 'BLOCKED')
        self.assertEqual(result['simulator_journeys']['ui_set'], 'all')


class CollectBySet(unittest.TestCase):
    """The real ios-collect.sh with a gate or a nightly plan."""

    def run_collect(self, selection, *, voice='success', planted=None):
        temp = tempfile.TemporaryDirectory(prefix='studio-ios-collect-set-'); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        native = root / 'apps/studio-native'
        (native / 'scripts').mkdir(parents=True); (native / 'ios').mkdir(); (native / 'evidence').mkdir()
        for name in ('ios-collect.sh', 'ios-ui-shards.py', 'collect-native-journeys.py', 'collect-signin-journey.py'):
            shutil.copyfile(NATIVE / 'scripts' / name, native / 'scripts' / name)
        (native / 'evidence/device-build.log').write_text('** BUILD SUCCEEDED **\n')
        doc = real_plan(selection)
        (native / 'evidence/ios-ui-shard-plan.json').write_text(json.dumps(doc))
        artifacts = root / 'artifacts'
        for row in doc['shards']:
            extra = (planted or {}).get(row['index'], '')
            directory = base.write_shard(artifacts, row['index'], row['cases'], extra=extra)
            directory.rename(artifacts / f'studio-ios-ui-shard-{row["index"]}-77-2')
        env = dict(os.environ, GITHUB_SHA=base.SHA, NATIVE_SOURCE_HEAD=base.SHA, GITHUB_RUN_ID='77', GITHUB_RUN_ATTEMPT='2',
                   IOS_BUILD_RESULT='success', IOS_UI_RESULT='success', IOS_SHARD_ARTIFACTS=str(artifacts))
        env.pop('IOS_VOICE_RESULT', None)
        if voice is not None:
            env['IOS_VOICE_RESULT'] = voice
        result = subprocess.run(['bash', str(native / 'scripts/ios-collect.sh')], cwd=root, env=env,
                                capture_output=True, text=True, timeout=30)
        return result, native / 'evidence', doc

    def test_positive_control_gate_and_nightly_pass_on_their_own_cases(self):
        for selection, voice in (('gate', 'success'), ('nightly', None)):
            with self.subTest(selection=selection):
                result, evidence, _ = self.run_collect(selection, voice=voice)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                journeys = json.loads((evidence / 'native-journeys.json').read_text())
                self.assertEqual((journeys['simulator_journeys']['status'], journeys['simulator_journeys']['ui_set']), ('PASS', selection))
                self.assertEqual(json.loads((evidence / 'ios-ui-shards.json').read_text())['verdict'], 'PASS')

    def test_the_gate_still_requires_the_voice_job_and_nightly_does_not_read_it(self):
        for voice in ('failure', 'cancelled', None):
            with self.subTest(voice=voice):
                result, _, _ = self.run_collect('gate', voice=voice)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('iOS real-voice job result', result.stdout)
        result, _, _ = self.run_collect('nightly', voice='failure')
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_a_gate_case_that_ran_in_a_nightly_shard_fails_the_nightly_merge(self):
        result, evidence, doc = self.run_collect('nightly', voice=None, planted={doc_last(): base.started(VOICE)})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((evidence / 'ios-ui-shards.json').read_text())['excluded_started'], [VOICE])


def doc_last():
    return shard_count(NIGHTLY_WORKFLOW)


class Workflows(unittest.TestCase):
    def test_gate_workflow_plans_the_gate_set_and_nightly_the_nightly_set(self):
        gate, nightly = GATE_WORKFLOW.read_text(), NIGHTLY_WORKFLOW.read_text()
        self.assertEqual(re.findall(r"^\s*IOS_UI_SET: '(\w+)'$", gate, re.M), ['gate'])
        self.assertEqual(re.findall(r"^\s*IOS_UI_SET: '(\w+)'$", nightly, re.M), ['nightly'])
        matrix = re.findall(r'^\s*shard: \[([0-9, ]+)\]$', nightly, re.M)
        self.assertEqual(len(matrix), 1)
        self.assertEqual([int(x) for x in matrix[0].split(',')], list(range(1, shard_count(NIGHTLY_WORKFLOW) + 1)))

    def test_nightly_runs_only_on_schedule_or_dispatch_and_writes_only_issues_in_one_job(self):
        text = NIGHTLY_WORKFLOW.read_text()
        triggers = text[text.index('\non:\n') + 5:text.index('\npermissions:')]
        self.assertEqual(re.findall(r'^  ([a-z_]+):', triggers, re.M), ['schedule', 'workflow_dispatch'])
        self.assertIn('\npermissions:\n  contents: read\n', text)
        self.assertEqual(text.count('issues: write'), 1)
        report = base.PrebootCache.job_block(text, 'report')
        self.assertIn('      issues: write', report.splitlines())
        self.assertIn("    if: ${{ !cancelled() && needs.ios.result != 'success' }}", report.splitlines())
        self.assertIn('GITHUB_TOKEN: ${{ github.token }}', report)
        self.assertIn('run: python3 apps/studio-native/scripts/nightly-failure-issue.py', report)
        self.assertNotIn('secrets.', text)
        self.assertNotIn('continue-on-error: true\n        with:\n          name: studio-ios-test-products', text)
        self.assertNotIn('ios-voice', text)
        for job in ('ios-build', 'ios-ui'):
            with self.subTest(job=job):
                block = base.PrebootCache.job_block(text, job)
                self.assertIn('    runs-on: xcode-27', block.splitlines())
                self.assertIn('      DEVELOPER_DIR: /Applications/Xcode_27.2.app/Contents/Developer', block.splitlines())
        self.assertIn('    timeout-minutes: 35', base.PrebootCache.job_block(text, 'ios-ui').splitlines())

    def test_the_testflight_gate_and_acceptance_never_read_the_nightly_workflow(self):
        candidate = (NATIVE / 'scripts/verify-native-candidate.py').read_text()
        self.assertIn("WORKFLOW = '.github/workflows/studio-native-mobile.yml'", candidate)
        self.assertNotIn('nightly', candidate)
        self.assertNotIn('nightly', base.PrebootCache.job_block(GATE_WORKFLOW.read_text(), 'acceptance'))


class FakeIssues:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == 'GET':
            page = int(re.search(r'&page=([0-9]+)', path)[1])
            return self.pages[page - 1] if page <= len(self.pages) else []
        return {'number': 900}


def open_issue(number, *, user=issue.BOT, body=issue.MARKER, pull=False):
    row = {'number': number, 'user': {'login': user}, 'body': body}
    if pull:
        row['pull_request'] = {}
    return row


class NightlyIssue(unittest.TestCase):
    RESULTS = {'ios-build': 'success', 'ios-ui': 'failure', 'ios': 'failure'}

    def record(self, pages):
        fake = FakeIssues(pages)
        outcome = issue.record(fake, 'hypeproof/hypeproof-studio', 'https://example.test/run/1', base.SHA, self.RESULTS)
        return outcome, fake

    def test_first_failure_opens_one_issue_with_the_marker(self):
        outcome, fake = self.record([[]])
        self.assertEqual(outcome, {'action': 'opened', 'number': 900})
        posts = [call for call in fake.calls if call[0] == 'POST']
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][1], '/repos/hypeproof/hypeproof-studio/issues')
        self.assertEqual(posts[0][2]['title'], issue.TITLE)
        self.assertTrue(posts[0][2]['body'].startswith(issue.MARKER))
        self.assertIn('`ios-ui`: failure', posts[0][2]['body'])
        self.assertIn('creator=github-actions%5Bbot%5D', fake.calls[0][1])

    def test_a_later_failure_comments_on_the_open_issue_and_opens_none(self):
        outcome, fake = self.record([[open_issue(12, body='other'), open_issue(41), open_issue(30)]])
        self.assertEqual(outcome, {'action': 'commented', 'number': 30})
        posts = [call for call in fake.calls if call[0] == 'POST']
        self.assertEqual([call[1] for call in posts], ['/repos/hypeproof/hypeproof-studio/issues/30/comments'])
        self.assertIn(base.SHA, posts[0][2]['body'])

    def test_the_marker_counts_only_on_a_bot_issue_and_never_on_a_pull_request(self):
        outcome, _ = self.record([[open_issue(5, user='someone'), open_issue(6, pull=True)]])
        self.assertEqual(outcome['action'], 'opened')

    def test_the_open_issue_is_found_on_a_later_page(self):
        outcome, _ = self.record([[open_issue(n, body='other') for n in range(100)], [open_issue(500)]])
        self.assertEqual(outcome, {'action': 'commented', 'number': 500})

    def test_malformed_input_is_refused_before_any_call(self):
        fake = FakeIssues([[]])
        with self.assertRaises(ValueError):
            issue.record(fake, 'hypeproof/hypeproof-studio', 'u', 'local', self.RESULTS)
        with self.assertRaises(ValueError):
            issue.record(fake, 'hypeproof/hypeproof-studio', 'u', base.SHA, {'ios': 1})
        self.assertEqual(fake.calls, [])


if __name__ == '__main__':
    unittest.main()
