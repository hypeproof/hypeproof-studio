"""iOS UI sharding: every case runs once, in its own shard, and the merged record says so.

Runs the real plan/merge code, the real ios-verify.sh shard mode (with Apple tools stubbed),
the real ios-collect.sh with the real journey collectors, and the approval push simctl hang
path. Planted defects (a missing shard, an unstarted case, a case in two shards, a failed
shard, an attachment collision) must each fail; a complete set must pass.
"""
import contextlib
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1]
ROOT = NATIVE.parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_ios_cleanup as cleanup_suite  # noqa: E402  (reuse the shipped Apple-tool stubs)

SPEC = importlib.util.spec_from_file_location('ios_ui_shards', NATIVE / 'scripts/ios-ui-shards.py')
shards = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(shards)
PUSH_SPEC = importlib.util.spec_from_file_location('approval_push', NATIVE / 'scripts/verify-approval-push-simulator.py')
push = importlib.util.module_from_spec(PUSH_SPEC); PUSH_SPEC.loader.exec_module(push)

SHA = 'a' * 40
# The one case the iOS real-voice job runs instead of a shard (#4432).
VOICE = 'HPStudioUITests/StudioJourneyTests/testRealKoreanPlaybackCompletionReachesNextCaptureBoundary'


def started(case, outcome='passed'):
    _, cls, name = case.split('/')
    return (f"Test Case '-[HPStudioUITests.{cls} {name}]' started.\n"
            f"Test Case '-[HPStudioUITests.{cls} {name}]' {outcome} (1.000 seconds).\n")


def write_shard(root, index, cases, *, test_exit=0, attachment_exit=0, attachments=(), extra=''):
    directory = root / f'shard-{index}'
    directory.mkdir(parents=True)
    (directory / 'simulator-test.log').write_text(''.join(started(case) for case in cases) + extra)
    (directory / 'shard-result.json').write_text(json.dumps(
        {'shard': index, 'test_exit': test_exit, 'attachment_exit': attachment_exit}))
    export = directory / 'journey-attachments'; export.mkdir()
    rows = []
    for case, name in attachments:
        (export / name).write_bytes(b'png')
        rows.append({'testIdentifier': case.split('/', 1)[1] + '()', 'attachments': [{'exportedFileName': name}]})
    (export / 'manifest.json').write_text(json.dumps(rows))
    return directory


class PlanContracts(unittest.TestCase):
    def test_real_suite_assigns_every_declared_case_to_exactly_one_shard(self):
        declared = []
        for source in sorted((NATIVE / 'ios/UITests').glob('*.swift')):
            declared += re.findall(r'^\s*(?:@MainActor\s+)?func (test[A-Za-z0-9_]*)\(\)', source.read_text(), re.M)
        doc = shards.plan(shards.discover(NATIVE / 'ios/UITests'), 3)
        every = [case.rsplit('/', 1)[1] for row in doc['shards'] for case in row['cases']]
        self.assertEqual(sorted(every), sorted(declared))
        self.assertEqual(len(every), len(set(every)))
        sizes = [len(row['cases']) for row in doc['shards']]
        self.assertLessEqual(max(sizes) - min(sizes), 1)
        first, second, last = doc['shards']
        self.assertEqual(first['xcodebuild_arguments'], ['-only-testing:' + c for c in first['cases']])
        # The last shard skips the others instead of naming its own, so an unparsed case still runs.
        self.assertEqual(last['xcodebuild_arguments'],
                         ['-skip-testing:' + c for c in first['cases'] + second['cases']])

    def test_real_suite_with_the_voice_case_puts_every_case_in_exactly_one_place(self):
        declared = []
        for source in sorted((NATIVE / 'ios/UITests').glob('*.swift')):
            cls = None
            for line in source.read_text().splitlines():
                found = re.match(r'^\s*(?:final\s+)?class (\w+)\s*:\s*XCTestCase', line)
                cls = found[1] if found else cls
                test = re.match(r'^\s*(?:@MainActor\s+)?func (test[A-Za-z0-9_]*)\(\)', line)
                if test:
                    declared.append(f'HPStudioUITests/{cls}/{test[1]}')
        self.assertIn(VOICE, declared)
        doc = shards.plan(shards.discover(NATIVE / 'ios/UITests'), 4, [VOICE])
        self.assertEqual((doc['shard_count'], doc['catch_all']), (5, 4))
        every = [case for row in doc['shards'] for case in row['cases']]
        self.assertEqual(sorted(every), sorted(declared))
        self.assertEqual(len(every), len(set(every)))
        *regular, voice = doc['shards']
        self.assertEqual((voice['index'], voice['dedicated'], voice['cases']), (5, True, [VOICE]))
        self.assertEqual(voice['xcodebuild_arguments'], ['-only-testing:' + VOICE])
        self.assertEqual([row['dedicated'] for row in regular], [False] * 4)
        self.assertFalse(any(VOICE in row['cases'] for row in regular))
        sizes = [len(row['cases']) for row in regular]
        self.assertLessEqual(max(sizes) - min(sizes), 1)
        # The catch-all shard skips the other shards' cases and the voice case, and runs the rest.
        self.assertEqual(regular[-1]['xcodebuild_arguments'],
                         ['-skip-testing:' + c for row in regular[:-1] for c in row['cases']] + ['-skip-testing:' + VOICE])

    def test_build_plans_the_voice_case_and_a_dedicated_case_must_be_declared(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        self.assertEqual(re.findall(r'--dedicated (\S+)', script), [VOICE])
        with self.assertRaisesRegex(ValueError, 'not declared'):
            shards.plan({'AlphaTests': ['testA', 'testB']}, 2, ['HPStudioUITests/AlphaTests/testMissing'])

    def test_plan_reader_refuses_a_dedicated_row_before_the_catch_all(self):
        doc = shards.plan({'AlphaTests': ['testA', 'testB', 'testC']}, 2, ['HPStudioUITests/AlphaTests/testB'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'plan.json')
            path.write_text(json.dumps(doc))
            self.assertEqual(shards.read_plan(path), doc)
            doc['shards'][0]['dedicated'] = True
            path.write_text(json.dumps(doc))
            with self.assertRaisesRegex(ValueError, 'dedicated rows'):
                shards.read_plan(path)

    def test_discovery_reads_attributes_and_ignores_helpers(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'A.swift').write_text(
                'final class AlphaTests: XCTestCase {\n'
                '    @MainActor func testOne() throws {}\n'
                '    func testTwo() async {}\n'
                '    private func testHelper(_ value: Int) {}\n'
                '    func helper() {}\n'
                '}\nclass BetaTests: XCTestCase {\n    override func setUp() {}\n    func testThree() {}\n}\n')
            self.assertEqual(shards.discover(Path(directory)),
                             {'AlphaTests': ['testOne', 'testTwo'], 'BetaTests': ['testThree']})
            Path(directory, 'B.swift').write_text('final class AlphaTests: XCTestCase {}\n')
            with self.assertRaisesRegex(ValueError, 'declared twice'):
                shards.discover(Path(directory))



class PlanByDurations(unittest.TestCase):
    """ios-ui-shards.py plan --durations (#4432 F21): regular shards balanced by measured time; unmeasured cases by count."""
    CLASSES = {'AlphaTests': ['testA', 'testB', 'testC'], 'BetaTests': ['testD', 'testE', 'testF', 'testG']}
    T = 'HPStudioUITests'

    def case(self, name):
        return f'{self.T}/{"AlphaTests" if name in "ABC" else "BetaTests"}/test{name}'

    def test_longest_first_onto_the_least_loaded_shard_then_unmeasured_by_count(self):
        durations = {self.case(n): s for n, s in {'A': 100, 'B': 90, 'C': 50, 'D': 40, 'E': 10}.items()}
        doc = shards.plan(self.CLASSES, 2, (), durations)
        first, second = doc['shards']
        # Known answer, by hand: A->1 (100), B->2 (90), C->2 (140), D->1 (140), E->1 (tie, lowest shard; 150),
        # then F (unmeasured) -> 2 (fewer cases: 2 against 3), G -> 1 (3 and 3, lowest shard).
        self.assertEqual(first['cases'], [self.case(n) for n in 'ADEG'])
        self.assertEqual(second['cases'], [self.case(n) for n in 'BCF'])
        self.assertEqual((first['estimated_seconds'], second['estimated_seconds']), (150.0, 140.0))
        self.assertEqual((first['unmeasured_cases'], second['unmeasured_cases']), (1, 1))
        self.assertEqual((doc['balance'], doc['stale_durations']), ('durations', []))
        # The catch-all contract is unchanged: the last shard skips the others' cases.
        self.assertEqual(second['xcodebuild_arguments'], ['-skip-testing:' + c for c in first['cases']])
        self.assertEqual(first['xcodebuild_arguments'], ['-only-testing:' + c for c in first['cases']])

    def test_without_durations_the_plan_is_the_count_plan_as_before(self):
        doc = shards.plan(self.CLASSES, 3)
        self.assertEqual([row['cases'] for row in doc['shards']],
                         [[self.case('A'), self.case('D'), self.case('G')], [self.case('B'), self.case('E')], [self.case('C'), self.case('F')]])
        self.assertEqual(doc['balance'], 'count')
        self.assertFalse(any('estimated_seconds' in row for row in doc['shards']))

    def test_dedicated_cases_stay_in_their_row_and_stale_keys_are_reported_not_used(self):
        durations = {self.case('A'): 300, self.case('B'): 5, f'{self.T}/GoneTests/testOld': 999}
        doc = shards.plan(self.CLASSES, 2, [self.case('A')], durations)
        *regular, own = doc['shards']
        self.assertEqual((own['cases'], own['dedicated']), ([self.case('A')], True))
        every = [c for row in regular for c in row['cases']]
        self.assertEqual(sorted(every), sorted(self.case(n) for n in 'BCDEFG'))
        self.assertEqual(doc['stale_durations'], [f'{self.T}/GoneTests/testOld'])
        self.assertNotIn('GoneTests', json.dumps(regular))

    def test_the_durations_file_is_read_strictly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'd.json')
            for bad in ({'schema': 'other', 'cases': {}}, {'schema': shards.SCHEMA_DURATIONS, 'cases': {'x': 0}},
                        {'schema': shards.SCHEMA_DURATIONS, 'cases': {'x': True}}, {'schema': shards.SCHEMA_DURATIONS, 'cases': []}):
                path.write_text(json.dumps(bad))
                with self.assertRaises(ValueError):
                    shards.load_durations(path)

    def test_the_shipped_table_balances_the_real_suite_and_names_its_source_runs(self):
        table = NATIVE / 'scripts/ios-ui-durations.json'
        document = json.loads(table.read_text())
        self.assertTrue(document['source_runs'] and all(isinstance(run['run'], int) for run in document['source_runs']))
        durations = shards.load_durations(table)
        doc = shards.plan(shards.discover(NATIVE / 'ios/UITests'), 4, [VOICE], durations)
        *regular, voice = doc['shards']
        self.assertEqual((voice['cases'], voice['dedicated']), ([VOICE], True))
        every = [c for row in regular for c in row['cases']]
        self.assertEqual(len(every), len(set(every)))
        declared = {f'HPStudioUITests/{c}/{t}' for c, ts in shards.discover(NATIVE / 'ios/UITests').items() for t in ts}
        self.assertEqual(set(every) | {VOICE}, declared)
        estimates = [row['estimated_seconds'] for row in regular]
        self.assertLessEqual(max(estimates) - min(estimates), max(durations.values()))
        self.assertEqual(doc['stale_durations'], [])

    def test_the_build_plans_with_the_shipped_table(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        command = script[script.index('python3 ../scripts/ios-ui-shards.py plan'):script.index('exit 0', script.index('python3 ../scripts/ios-ui-shards.py plan'))]
        self.assertIn('--durations ../scripts/ios-ui-durations.json', command)
        self.assertIn('--dedicated ' + VOICE, command)

class WorkflowShardCount(unittest.TestCase):
    def test_planned_shard_count_equals_the_ui_matrix(self):
        workflow = (ROOT / '.github/workflows/studio-native-mobile.yml').read_text()
        planned = re.findall(r"^\s*IOS_UI_SHARDS: '([0-9]+)'$", workflow, re.M)
        matrix = re.findall(r'^\s*shard: \[([0-9, ]+)\]$', workflow, re.M)
        self.assertEqual(len(planned), 1)
        self.assertEqual(len(matrix), 1)
        self.assertEqual([int(x) for x in matrix[0].split(',')], list(range(1, int(planned[0]) + 1)))

    def test_voice_job_runs_the_row_after_the_shards_and_both_gates_require_it(self):
        text = (ROOT / '.github/workflows/studio-native-mobile.yml').read_text()
        voice_row = int(re.findall(r"^\s*IOS_UI_SHARDS: '([0-9]+)'$", text, re.M)[0]) + 1
        job = PrebootCache.job_block(text, 'ios-voice')
        shard_job = PrebootCache.job_block(text, 'ios-ui')
        self.assertIn(f'run: bash apps/studio-native/scripts/ios-verify.sh shard {voice_row}', job)
        self.assertIn(f'name: studio-ios-ui-shard-{voice_row}-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}', job)
        # The same runner, Xcode and job limit as a shard: no limit was raised to fit the settle wait.
        for line in ('    runs-on: xcode-27', '      DEVELOPER_DIR: /Applications/Xcode_27.2.app/Contents/Developer',
                     '    timeout-minutes: 35', '    needs: ios-build'):
            with self.subTest(line=line):
                self.assertIn(line, job.splitlines()); self.assertIn(line, shard_job.splitlines())
        self.assertNotIn('continue-on-error', job)
        ios_job, acceptance = PrebootCache.job_block(text, 'ios'), PrebootCache.job_block(text, 'acceptance')
        self.assertIn('    needs: [contract, ios-build, ios-ui, ios-voice]', ios_job.splitlines())
        self.assertIn('IOS_VOICE_RESULT: ${{ needs.ios-voice.result }}', ios_job)
        self.assertIn('ios-voice', re.search(r'^    needs: \[(.*)\]$', acceptance, re.M)[1].split(', '))
        self.assertIn('IOS_VOICE_RESULT: ${{ needs.ios-voice.result }}', acceptance)
        self.assertIn('[ "$IOS_VOICE_RESULT" != success ]', acceptance)


class MergeContracts(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.plan = shards.plan({'AlphaTests': ['testA', 'testB', 'testC'], 'BetaTests': ['testD', 'testE', 'testF']}, 3)
        self.cases = {row['index']: row['cases'] for row in self.plan['shards']}

    def merge(self):
        return shards.merge(self.plan, self.root / 'shards', self.root / 'evidence')

    def complete(self, changes=None, skip=None):
        changes = changes or {}
        for index, cases in self.cases.items():
            if index != skip:
                write_shard(self.root / 'shards', index, cases, **changes.get(index, {}))

    def test_positive_control_complete_shards_pass_with_one_merged_attachment_export(self):
        self.complete({1: {'attachments': [(self.cases[1][0], 'one.png')]},
                         3: {'attachments': [(self.cases[3][0], 'three.png')]}})
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'PASS', doc['problems'])
        self.assertEqual((doc['test_exit'], doc['attachment_exit'], doc['started_cases']), (0, 0, 6))
        manifest = json.loads((self.root / 'evidence/journey-attachments/manifest.json').read_text())
        self.assertEqual(len(manifest), 2)
        self.assertTrue((self.root / 'evidence/journey-attachments/three.png').is_file())
        log = (self.root / 'evidence/simulator-test.log').read_text()
        for case in sum(self.cases.values(), []):
            self.assertIn(case.rsplit('/', 1)[1] + "]' passed", log)

    def test_missing_shard_fails_with_did_not_run_exit(self):
        self.complete(skip=2)
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(doc['test_exit'], 125)
        self.assertEqual(doc['not_run'], sorted(self.cases[2]))

    def test_unstarted_case_fails_even_when_every_shard_exits_zero(self):
        self.cases[1] = self.cases[1][1:]
        self.complete()
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(len(doc['not_run']), 1)

    def test_case_in_two_shards_fails(self):
        self.cases[2] = self.cases[2] + [self.cases[1][0]]
        self.complete()
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(doc['misplaced'], [self.cases[1][0]])

    def test_failed_shard_keeps_its_exit_code(self):
        self.complete({2: {'test_exit': 65}})
        doc = self.merge()
        self.assertEqual((doc['verdict'], doc['test_exit']), ('FAIL', 65))

    def test_attachment_collision_is_refused(self):
        self.complete({1: {'attachments': [(self.cases[1][0], 'same.png')]},
                         2: {'attachments': [(self.cases[2][0], 'same.png')]}})
        with self.assertRaisesRegex(ValueError, 'exported by shards 1 and 2'):
            self.merge()

    def dedicated_plan(self):
        self.plan = shards.plan({'AlphaTests': ['testA', 'testB', 'testC'], 'BetaTests': ['testD', 'testE', 'testF']}, 3,
                                ['HPStudioUITests/BetaTests/testE'])
        self.cases = {row['index']: row['cases'] for row in self.plan['shards']}

    def test_positive_control_shards_and_the_voice_row_pass_together(self):
        self.dedicated_plan()
        self.complete()
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'PASS', doc['problems'])
        self.assertEqual((doc['shard_count'], doc['started_cases'], sorted(doc['shards'])), (4, 6, [1, 2, 3, 4]))

    def test_missing_voice_row_fails_with_did_not_run_exit(self):
        self.dedicated_plan()
        self.complete(skip=4)
        doc = self.merge()
        self.assertEqual((doc['verdict'], doc['test_exit']), ('FAIL', 125))
        self.assertEqual(doc['not_run'], ['HPStudioUITests/BetaTests/testE'])

    def test_voice_case_that_also_ran_in_a_shard_fails(self):
        self.dedicated_plan()
        self.cases[3] = self.cases[3] + ['HPStudioUITests/BetaTests/testE']
        self.complete()
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(doc['misplaced'], ['HPStudioUITests/BetaTests/testE'])

    def test_unplanned_case_is_accepted_in_the_catch_all_shard_not_the_voice_row(self):
        self.dedicated_plan()
        extra = started('HPStudioUITests/AlphaTests/testUnparsed')
        self.complete({3: {'extra': extra}})
        self.assertEqual(self.merge()['verdict'], 'PASS')
        shutil.rmtree(self.root / 'shards'); shutil.rmtree(self.root / 'evidence')
        self.complete({4: {'extra': extra}})
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'FAIL')
        self.assertEqual(doc['unplanned_outside_last_shard'], ['HPStudioUITests/AlphaTests/testUnparsed'])

    def test_unplanned_case_is_accepted_only_in_the_last_shard(self):
        extra = started('HPStudioUITests/AlphaTests/testUnparsed')
        self.complete({3: {'extra': extra}})
        doc = self.merge()
        self.assertEqual(doc['verdict'], 'PASS', doc['problems'])
        self.assertEqual(doc['unplanned_in_last_shard'], ['HPStudioUITests/AlphaTests/testUnparsed'])
        shutil.rmtree(self.root / 'shards'); shutil.rmtree(self.root / 'evidence')
        self.complete({1: {'extra': extra}})
        self.assertEqual(self.merge()['verdict'], 'FAIL')


class ShardShell(unittest.TestCase):
    """The real ios-verify.sh shard mode against stubbed Apple tools."""

    def run_shard(self, index, *, test_exit=0, products=1, bootstatus_exit=0, dedicated=(), test_output=''):
        temp = tempfile.TemporaryDirectory(prefix='studio-ios-shard-'); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        scripts, ios, bin_dir, evidence = root / 'scripts', root / 'ios', root / 'bin', root / 'evidence'
        for directory in (scripts, ios, bin_dir, evidence):
            directory.mkdir()
        for name in ('ios-verify.sh', 'select-ios-simulator.py', 'ios-ui-shards.py', 'ios-sim-observe.py',
                     'verify-approval-push-simulator.py'):
            shutil.copyfile(NATIVE / 'scripts' / name, scripts / name)
        # The stubbed device never settles; a 1 s copy of the seed's 900 s limit reaches the
        # timeout path in this temporary copy only. The shipped script keeps 900 s.
        helper = scripts / 'verify-approval-push-simulator.py'
        shipped = helper.read_text()
        self.assertIn('\nSEED_SETTLE_LIMIT = 900\n', shipped)
        helper.write_text(shipped.replace('\nSEED_SETTLE_LIMIT = 900\n', '\nSEED_SETTLE_LIMIT = 1\n'))
        built = ios / 'DerivedData/Build/Products'; built.mkdir(parents=True)
        for number in range(products):
            (built / f'HPStudio_iphonesimulator{number}.xctestrun').write_text('fixture')
        plan = shards.plan({'AlphaTests': ['testA', 'testB', 'testC', 'testD']}, 2, dedicated)
        (evidence / 'ios-ui-shard-plan.json').write_text(json.dumps(plan))
        stub = cleanup_suite.COMMAND_STUB.replace('if "test" in args:', 'if "test" in args or "test-without-building" in args:')
        self.assertNotEqual(stub, cleanup_suite.COMMAND_STUB)
        signal_line = '        if os.environ.get("STUB_TEST_SIGNAL"):'
        self.assertIn(signal_line, stub)
        stub = stub.replace(signal_line, '        sys.stdout.write(os.environ.get("STUB_TEST_OUTPUT", "")); sys.stdout.flush()\n' + signal_line)
        marker = '    elif args[:2] == ["simctl", "create"]:'
        self.assertIn(marker, stub)
        stub = stub.replace(marker, '    elif args[:2] == ["simctl", "bootstatus"]:\n'
                            '        raise SystemExit(int(os.environ.get("STUB_BOOTSTATUS_EXIT", "0")))\n' + marker)
        for command in ('xcrun', 'xcodebuild', 'swift', 'codesign', 'sleep'):
            path = bin_dir / command
            path.write_text(stub.replace('__PYTHON__', sys.executable)); path.chmod(0o755)
        (bin_dir / 'python3').write_text(cleanup_suite.PYTHON_STUB.replace('__PYTHON__', sys.executable))
        (bin_dir / 'python3').chmod(0o755)
        calls = root / 'calls.jsonl'
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'], GITHUB_SHA=SHA,
                   GITHUB_RUN_ID='shard-test', STUB_CALLS=str(calls), STUB_TIMEOUTS=str(root / 'timeouts.jsonl'),
                   STUB_DEVICE=cleanup_suite.DEVICE, STUB_CLEANUP='{}', STUB_TEST_EXIT=str(test_exit),
                   STUB_TEST_SIGNAL='', STUB_DESCENDANTS=str(root / 'descendants.txt'), STUB_CREATE_EXIT='',
                   STUB_BOOTSTATUS_EXIT=str(bootstatus_exit), STUB_TEST_OUTPUT=test_output)
        result = subprocess.run(['bash', str(scripts / 'ios-verify.sh'), 'shard', str(index)], cwd=root,
                                env=env, capture_output=True, text=True, timeout=20)
        commands = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result, commands, plan, evidence

    def test_shard_runs_only_prebuilt_products_with_its_own_cases_and_cleans_its_simulator(self):
        result, commands, plan, evidence = self.run_shard(1)
        self.assertEqual(result.returncode, 0, result.stderr)
        xcodebuild = [c['args'] for c in commands if c['command'] == 'xcodebuild' and c['args'] != ['-version']]
        self.assertEqual(len(xcodebuild), 1, xcodebuild)
        args = xcodebuild[0]
        self.assertEqual(args[-1], 'test-without-building')
        self.assertIn('-xctestrun', args)
        self.assertNotIn('-project', args)
        self.assertEqual([a for a in args if a.startswith('-only-testing:') or a.startswith('-skip-testing:')],
                         plan['shards'][0]['xcodebuild_arguments'])
        self.assertFalse(any(c['command'] == 'swift' for c in commands))
        simctl = [c['args'][:2] for c in commands if c['command'] == 'xcrun' and c['args'][:1] == ['simctl']]
        # Boot, then a system-app warm-up, before the test; owned cleanup after it.
        self.assertLess(simctl.index(['simctl', 'bootstatus']), simctl.index(['simctl', 'launch']))
        self.assertEqual(simctl[-2:], [['simctl', 'shutdown'], ['simctl', 'delete']])
        warm = next(c['args'] for c in commands if c['args'][:2] == ['simctl', 'launch'])
        self.assertEqual(warm[-1], 'com.apple.Preferences')
        self.assertEqual(json.loads((evidence / 'shard-result.json').read_text()),
                         {'shard': 1, 'test_exit': 0, 'attachment_exit': 0})

    def test_last_shard_skips_the_others_and_failure_is_recorded_and_returned(self):
        result, commands, plan, evidence = self.run_shard(2, test_exit=65)
        self.assertEqual(result.returncode, 65, result.stderr)
        args = next(c['args'] for c in commands if c['command'] == 'xcodebuild' and 'test-without-building' in c['args'])
        self.assertEqual([a for a in args if a.startswith('-skip-testing:')],
                         ['-skip-testing:' + case for case in plan['shards'][0]['cases']])
        self.assertEqual(json.loads((evidence / 'shard-result.json').read_text())['test_exit'], 65)

    def test_shard_records_boot_and_warm_up_timing_and_three_samples_without_changing_commands(self):
        result, commands, _, evidence = self.run_shard(1)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        # The stubbed simulator has no launchd_sim, so each boot reading says so instead of guessing.
        before_test = [r for r in rows if r['step'] != 'test']
        self.assertEqual([(r['step'], r['command'], r['outcome']) for r in before_test],
                         [('boot', 'xcrun simctl boot', 'exit 0'), ('boot', 'xcrun simctl bootstatus', 'exit 0'),
                          ('boot', 'observe', 'no device'), ('boot', 'observe', 'no device'), ('boot', 'observe', 'no device'),
                          ('warm-up', 'xcrun simctl launch', 'exit 0'), ('warm-up', 'xcrun simctl terminate', 'exit 0'),
                          # The poster burst wait (#4432 F21) adds one row; the stubbed device has no data directory.
                          ('warm-up', 'poster-wait', 'no device data')])
        self.assertEqual([r['sample'] for r in before_test if r['command'] == 'observe'], [1, 2, 3])
        self.assertTrue(all(isinstance(r['seconds'], float) for r in before_test if r['command'] != 'observe'))
        self.assertTrue(all(r['utc'].endswith('+00:00') for r in before_test))
        for name in ('simulator-ps.txt', 'simulator-vmstat.txt'):
            headers = [line.split(' sample ')[1].split()[0] for line in (evidence / name).read_text().splitlines()
                       if re.match(r'== boot sample \d ', line)]
            self.assertEqual(headers, ['1', '2', '3'], name)
        # The background sampler was started beside the test and is gone when the shard ends.
        self.assertTrue(all(r['command'] == 'observe' for r in rows if r['step'] == 'test'))
        alive = subprocess.run(['pgrep', '-f', f'ios-sim-observe.py watch --evidence ../evidence --device {cleanup_suite.DEVICE}'], capture_output=True)
        self.assertNotEqual(alive.returncode, 0, alive.stdout)
        watcher = subprocess.run(['pgrep', '-f', f'ios-sim-observe.py terminate-watch --evidence ../evidence --device {cleanup_suite.DEVICE}'], capture_output=True)
        self.assertNotEqual(watcher.returncode, 0, watcher.stdout)
        stall = subprocess.run(['pgrep', '-f', f'ios-sim-observe.py stall-watch --evidence ../evidence --device {cleanup_suite.DEVICE}'], capture_output=True)
        self.assertNotEqual(stall.returncode, 0, stall.stdout)
        # No "HPStudio main stall (ongoing)" in the log: no sample.
        self.assertFalse((evidence / 'stall-samples.txt').exists())
        # No "Failed to terminate" in the log: no capture, no spawn.
        self.assertFalse((evidence / 'terminate-diagnostics.txt').exists())
        self.assertFalse(any(c['args'][:2] == ['simctl', 'spawn'] for c in commands))
        # The same simctl commands as before, and the only new waits are two fixed 5 s sleeps.
        boot = [c['args'] for c in commands if c['command'] == 'xcrun' and c['args'][:2] in (['simctl', 'boot'], ['simctl', 'bootstatus'], ['simctl', 'launch'], ['simctl', 'terminate'])]
        # Shard 1 also launches the app after the suite for its screenshot; that launch is not timed.
        self.assertEqual([a[:2] for a in boot[:4]], [['simctl', 'boot'], ['simctl', 'bootstatus'], ['simctl', 'launch'], ['simctl', 'terminate']])
        self.assertEqual(boot[1][-1], '-b')
        self.assertEqual([c['args'] for c in commands if c['command'] == 'sleep'][:2], [['5'], ['5']])

    def test_failed_terminate_is_diagnosed_without_changing_the_test_or_its_exit(self):
        failure = ('<unknown>:0: error: -[HPStudioUITests.AlphaTests testA] : Failed to terminate '
                   'ai.hypeproof.studio.mobile:9784: Failed to terminate ai.hypeproof.studio.mobile:0\n')
        result, commands, plan, evidence = self.run_shard(1, test_exit=65, test_output=failure)
        self.assertEqual(result.returncode, 65, result.stderr)
        args = next(c['args'] for c in commands if c['command'] == 'xcodebuild' and 'test-without-building' in c['args'])
        self.assertEqual([a for a in args if a.startswith('-only-testing:') or a.startswith('-skip-testing:')],
                         plan['shards'][0]['xcodebuild_arguments'])
        for flag, value in (('-default-test-execution-time-allowance', '180'), ('-maximum-test-execution-time-allowance', '240')):
            self.assertEqual(args[args.index(flag) + 1], value)
        spawn = [c['args'] for c in commands if c['args'][:2] == ['simctl', 'spawn']]
        self.assertEqual([a[3:5] for a in spawn], [['launchctl', 'list'], ['log', 'show']], spawn)
        self.assertTrue(all(a[2] == cleanup_suite.DEVICE for a in spawn))
        self.assertIn('--last', spawn[1]); self.assertEqual(spawn[1][spawn[1].index('--last') + 1], '3m')
        # Diagnosed after the test, before the owned cleanup.
        test_at = commands.index(next(c for c in commands if 'test-without-building' in c['args']))
        shutdown_at = commands.index(next(c for c in commands if c['args'][:2] == ['simctl', 'shutdown']))
        self.assertTrue(all(test_at < commands.index(next(c for c in commands if c['args'] == a)) < shutdown_at for a in spawn))
        text = (evidence / 'terminate-diagnostics.txt').read_text()
        self.assertEqual(re.findall(r'^== terminate (\d+) (\S+) ', text, re.MULTILINE), [('1', 'ai.hypeproof.studio.mobile:9784')])
        row = next(json.loads(l) for l in (evidence / 'simulator-steps.jsonl').read_text().splitlines() if '"terminate"' in l)
        self.assertEqual((row['command'], row['pid'], row['launchctl'], row['log']), ('diagnose', 9784, 'absent', 'shown'))

    def test_voice_row_settles_and_probes_after_boot_and_before_its_one_case(self):
        result, commands, plan, evidence = self.run_shard(3, dedicated=['HPStudioUITests/AlphaTests/testD'], test_exit=65)
        # The test alone decides the job: its exit passes through after a settle timeout.
        self.assertEqual(result.returncode, 65, result.stderr)
        self.assertIn('voice: simulator settle timeout', result.stdout)
        self.assertIn('the test runs anyway', result.stdout)
        args = next(c['args'] for c in commands if c['command'] == 'xcodebuild' and 'test-without-building' in c['args'])
        self.assertEqual([a for a in args if a.startswith('-only-testing:') or a.startswith('-skip-testing:')],
                         ['-only-testing:HPStudioUITests/AlphaTests/testD'])
        # The same per-test limits as every shard.
        for flag, value in (('-default-test-execution-time-allowance', '180'), ('-maximum-test-execution-time-allowance', '240')):
            self.assertEqual(args[args.index(flag) + 1], value)
        rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        order = [(r['step'], r['command']) for r in rows if r['step'] != 'test' and r['command'] != 'observe']
        self.assertEqual(order[:2], [('boot', 'xcrun simctl boot'), ('boot', 'xcrun simctl bootstatus')])
        settle = order.index(('voice', 'settle'))
        self.assertLess(settle, order.index(('voice', 'speech-probe-build')))
        self.assertLess(order.index(('voice', 'speech-probe')), order.index(('warm-up', 'xcrun simctl launch')))
        settle_row = next(r for r in rows if r['command'] == 'settle')
        self.assertEqual((settle_row['outcome'], settle_row['limit']), ('timeout', 1))
        record = json.loads((evidence / 'voice-settle.json').read_text())
        self.assertEqual((record['settle']['outcome'], record['settle_limit']), ('timeout', 1))
        self.assertIn('outcome', record['speech_probe'])
        spawn = [c['args'] for c in commands if c['args'][:2] == ['simctl', 'spawn']]
        self.assertEqual(len(spawn), 1)
        self.assertLess(commands.index(next(c for c in commands if c['args'][:2] == ['simctl', 'spawn'])),
                        commands.index(next(c for c in commands if 'test-without-building' in c['args'])))

    def test_a_regular_shard_neither_settles_nor_probes(self):
        result, commands, _, evidence = self.run_shard(1, dedicated=['HPStudioUITests/AlphaTests/testD'])
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        self.assertFalse(any(r['step'] == 'voice' for r in rows))
        self.assertFalse(any(c['args'][:2] == ['simctl', 'spawn'] for c in commands))
        self.assertFalse((evidence / 'voice-settle.json').exists())

    def test_a_failed_bootstatus_still_fails_the_shard_and_is_recorded(self):
        result, commands, _, evidence = self.run_shard(1, bootstatus_exit=3)
        self.assertEqual(result.returncode, 3, result.stderr)
        rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        self.assertEqual(rows[-1]['outcome'], 'exit 3')
        self.assertFalse(any(c['command'] == 'xcodebuild' and 'test-without-building' in c['args'] for c in commands))

    def test_shard_refuses_unknown_index_and_ambiguous_products(self):
        result, commands, _, _ = self.run_shard(3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Shard 3 has no cases', result.stderr)
        result, commands, _, _ = self.run_shard(1, products=2)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Expected one .xctestrun', result.stderr)
        self.assertFalse(any(c['args'][:2] == ['simctl', 'create'] for c in commands))



OBSERVE_SPEC = importlib.util.spec_from_file_location('ios_sim_observe', NATIVE / 'scripts/ios-sim-observe.py')
observe = importlib.util.module_from_spec(OBSERVE_SPEC); OBSERVE_SPEC.loader.exec_module(observe)

# One `top -l 2 -stats pid,ppid,mem,cpu,threads,state,command` output: the first sample's %CPU is not over
# an interval, so only the second sample counts (its values differ on purpose).
HOST_TOP_HEADER = 'Processes: 512 total, 3 running, 509 sleeping, 2400 threads\nPhysMem: 6900M used (1900M wired), 80M unused.\n\n'
HOST_TOP_TABLE = 'PID    PPID  MEM   %CPU #TH   STATE    COMMAND\n'
HOST_TOP_OUTPUT = (HOST_TOP_HEADER + HOST_TOP_TABLE + '8208   1587  9M    0.0  4     sleeping HPStudio\n'
                   + HOST_TOP_HEADER + HOST_TOP_TABLE
                   + '8208   1587  812M  97.5 31    running  HPStudio\n'
                   + '8100   1587  420M+ 12.0 116/1 running  HPStudioUITests-\n'
                   + '1587   1500  31M   0.4  3     sleeping launchd_sim\n'
                   + '1600   1587  60M   3.0  8     sleeping SpringBoard\n'
                   + '1601   1587  40M   1.0  6     sleeping AccessibilityUIS\n'
                   + '90     1     51M-  6.0  12    sleeping logd\n'
                   + '700    1     2G    1.0  40    sleeping Google Chrome He\n'
                   + '701    1     12M   30.0 2     running  sample\n'
                   + '702    1     14M   0.0  1     stuck    Runner.Worker\n')
HOST_SYSCTL_OUTPUT = ('hw.memsize: 7516192768\nhw.ncpu: 3\nvm.swapusage: total = 1024.00M  used = 272.00M  free = 752.00M  (encrypted)\n'
                      'kern.memorystatus_level: 3\nvm.pagesize: 16384\n')
HOST_VM_STAT = ('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:      4848.\n'
                'Pages wired down:      125972.\nPages occupied by compressor:      99350.\nSwapouts:      0.\n')
HOST_OUTPUTS = {'sysctl': HOST_SYSCTL_OUTPUT, 'vm_stat': HOST_VM_STAT, 'top': HOST_TOP_OUTPUT}
SNAPSHOT_CALLS = [(observe.HOST_SYSCTL, 10), (['vm_stat'], 10), (observe.HOST_TOP['mem'], 20), (observe.HOST_TOP['cpu'], 20)]


class SimObserve(unittest.TestCase):
    """ios-sim-observe.py readings: device age, timeouts, and the background sampler."""
    DEVICE = 'C0E7C600-E107-428F-8A03-DEDB01894AEF'

    def table(self, age='04:45', children=3, runnable=2):
        lines = ['  PID  PPID STAT ELAPSED  %CPU %MEM COMMAND',
                 f' 4820     1 S    {age}  0.4  0.2 launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/{self.DEVICE}/data/var/run/launchd_bootstrap.plist']
        for index in range(children):
            lines.append(f' {5000 + index}  4820 {"Rs" if index < runnable else "Ss"}   {age}  1.0  0.1 /RuntimeRoot/usr/libexec/d{index} --flag')
        return '\n'.join(lines) + '\n'

    def test_elapsed_time_formats(self):
        self.assertEqual([observe.etime_seconds(v) for v in ('00:07', '04:45', '1:02:03', '2-01:00:00', 'x')],
                         [7, 285, 3723, 176400, None])

    def test_device_reading_counts_children_and_reads_age(self):
        self.assertEqual(observe.device_reading(self.table(), self.DEVICE), (3, 2, 285))
        self.assertIsNone(observe.device_reading(self.table().replace(self.DEVICE, 'OTHER'), self.DEVICE))

    def take(self, table, step='boot'):
        outputs = {'ps': table, 'vm_stat': 'Pages free:                               4298.\n', 'top': HOST_TOP_OUTPUT, 'pgrep': ''}
        def bounded(args, limit=30):
            if args[0] == 'sysctl':
                return '{ 353.66 142.08 64.21 }\n' if args[1] == '-n' else HOST_SYSCTL_OUTPUT
            return outputs[args[0]]
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(observe.push, 'bounded', side_effect=bounded) as called:
            evidence = Path(directory)
            observe.take(evidence, self.DEVICE, step=step, sample=1, full_table=True)
            self.commands = [call.args[0][0] for call in called.call_args_list]
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text())
            ps = (evidence / 'simulator-ps.txt').read_text()
        return row, ps

    def test_a_reading_records_age_wall_clock_load_and_free_memory(self):
        row, ps = self.take(self.table())
        self.assertEqual({k: row[k] for k in ('outcome', 'processes', 'runnable', 'device_age_seconds', 'free_pages', 'loadavg')},
                         {'outcome': 'sample', 'processes': 3, 'runnable': 2, 'device_age_seconds': 285,
                          'free_pages': 4298, 'loadavg': '{ 353.66 142.08 64.21 }'})
        self.assertTrue(row['utc'].endswith('+00:00'))
        self.assertIn('launchd_sim', ps)

    def daemon_table(self):
        runtime = '/Library/Developer/CoreSimulator/Volumes/iOS_23B/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.2.simruntime/Contents/Resources/RuntimeRoot'
        return self.table(children=0) + '\n'.join([
            f' 5101  4820 Rs      02:58  0.0  1.4 {runtime}/System/Library/PrivateFrameworks/AXAssetLoader.framework/Support/axassetsd',
            f' 5102  4820 Rs      01:59  0.0  1.1 {runtime}/System/Library/PrivateFrameworks/SiriTTSService.framework/sirittsd',
            f' 5103  4820 Ss      02:25 16.0  1.4 {runtime}/usr/libexec/mobileassetd',
            f' 5104  4820 Rs      02:38  0.5  1.0 {runtime}/System/Library/CoreServices/AccessibilityUIServer.app/AccessibilityUIServer -BSServiceDomains x',
            # A host process with the same name is not the device's.
            '  700     1 S       16:32  0.0  0.1 /System/Library/PrivateFrameworks/CoreSpeech.framework/corespeechd',
            # A name that only starts like a tracked daemon is not one.
            f' 5105  4820 Rs      01:00  0.0  1.0 {runtime}/usr/libexec/mobileassetd_helper',
        ]) + '\n'

    def test_speech_daemons_are_read_by_name_for_this_device_only(self):
        daemons = push.device_daemons(self.daemon_table(), self.DEVICE)
        self.assertEqual(set(daemons), set(push.SPEECH_DAEMONS))
        self.assertEqual(daemons['axassetsd'], [{'stat': 'Rs', 'etime': '02:58', 'cpu': 0.0}])
        self.assertEqual(daemons['sirittsd'], [{'stat': 'Rs', 'etime': '01:59', 'cpu': 0.0}])
        self.assertEqual(daemons['mobileassetd'], [{'stat': 'Ss', 'etime': '02:25', 'cpu': 16.0}])
        self.assertEqual(daemons['AccessibilityUIServer'], [{'stat': 'Rs', 'etime': '02:38', 'cpu': 0.5}])
        self.assertEqual((daemons['corespeechd'], daemons['assistantd']), ([], []))
        self.assertEqual(push.device_daemons(self.daemon_table(), 'OTHER'), {name: [] for name in push.SPEECH_DAEMONS})

    def test_a_sample_row_names_the_speech_daemons(self):
        row, _ = self.take(self.daemon_table())
        self.assertEqual(row['outcome'], 'sample')
        self.assertEqual(row['daemons']['axassetsd'][0]['stat'], 'Rs')
        self.assertEqual(row['daemons']['assistantd'], [])

    def test_a_ps_that_does_not_return_is_a_timeout_row_not_an_error(self):
        row, ps = self.take('<ps -axro pid,ppid,stat,etime,%cpu,%mem,command did not return within 30s>')
        self.assertEqual(row['outcome'], 'timeout')
        self.assertIn('did not return within 30s', row['detail'])
        self.assertNotIn('processes', row)
        self.assertNotIn('daemons', row)
        self.assertEqual(row['free_pages'], 4298)

    def test_watch_keeps_sampling_until_stopped_and_writes_test_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            child = subprocess.Popen([sys.executable, str(NATIVE / 'scripts/ios-sim-observe.py'), 'watch', '--evidence', str(evidence),
                                      '--device', self.DEVICE, '--interval', '0.2'])
            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    path = evidence / 'simulator-steps.jsonl'
                    if path.exists() and len(path.read_text().splitlines()) >= 2:
                        break
                    time.sleep(0.1)
            finally:
                child.terminate(); child.wait(timeout=10)
            rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        self.assertGreaterEqual(len(rows), 2)
        self.assertEqual({(r['step'], r['command']) for r in rows}, {('test', 'observe')})
        self.assertEqual([r['sample'] for r in rows[:2]], [1, 2])
        self.assertIn(rows[0]['outcome'], ('no device', 'timeout'))

class HostSnapshots(unittest.TestCase):
    """ios-sim-observe.py host snapshot (#4432 F21): who uses the runner's memory and CPU. Diagnostics only."""

    def snapshot(self, outputs, *, with_top=True):
        calls = []
        def run(args, limit):
            calls.append((args, limit))
            return outputs[args[0]]
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            host = observe.host_snapshot(evidence, step='test', sample=4, run=run, with_top=with_top)
            text = (evidence / observe.HOST_FILE).read_text()
        return host, calls, text

    def test_uptime_uses_the_macos_uptime_clock_and_falls_back_to_monotonic_elsewhere(self):
        # Runs on every platform: the clock is injected. On macOS UPTIME_CLOCK is CLOCK_UPTIME_RAW, the clock
        # of ProcessInfo.systemUptime in the app's stall lines; the Linux contract job has no such clock.
        self.assertEqual(observe.UPTIME_CLOCK, getattr(time, 'CLOCK_UPTIME_RAW', None))
        with mock.patch.object(observe.time, 'clock_gettime', return_value=12.3456) as gettime, \
             mock.patch.object(observe.time, 'monotonic', return_value=99.0):
            self.assertEqual(observe.uptime_ms(clock=8), 12345)
            gettime.assert_called_once_with(8)
            with mock.patch.object(observe, 'UPTIME_CLOCK', 8):
                self.assertEqual(observe.uptime_ms(), 12345)
            with mock.patch.object(observe, 'UPTIME_CLOCK', None):
                self.assertEqual(observe.uptime_ms(), 99000)
            self.assertEqual(gettime.call_count, 2)
        self.assertEqual(observe.MAXRSS_PER_MB, 1048576 if sys.platform == 'darwin' else 1024)

    def test_only_the_second_top_sample_is_read_and_names_keep_their_spaces(self):
        rows = observe.top_rows(HOST_TOP_OUTPUT)
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[0], {'pid': 8208, 'ppid': 1587, 'mem_mb': 812.0, 'cpu': 97.5, 'state': 'running', 'command': 'HPStudio'})
        self.assertEqual(rows[1]['mem_mb'], 420.0)
        self.assertEqual(next(r for r in rows if r['pid'] == 700)['command'], 'Google Chrome He')
        self.assertEqual(next(r for r in rows if r['pid'] == 700)['mem_mb'], 2048.0)
        self.assertEqual(observe.top_rows('<top -l 2 did not return within 20s>'), [])

    def test_processes_are_grouped_by_name_and_simulator_parent(self):
        groups = observe.group_sums(observe.top_rows(HOST_TOP_OUTPUT))
        self.assertEqual(groups['app'], {'mem_mb': 812.0, 'cpu': 97.5, 'processes': 1})
        self.assertEqual(groups['ui-runner'], {'mem_mb': 420.0, 'cpu': 12.0, 'processes': 1})
        # launchd_sim by name, SpringBoard because its parent is a launchd_sim.
        self.assertEqual(groups['simulator'], {'mem_mb': 91.0, 'cpu': 3.4, 'processes': 2})
        self.assertEqual(groups['ax']['processes'], 1)
        self.assertEqual(groups['logging'], {'mem_mb': 51.0, 'cpu': 6.0, 'processes': 1})
        self.assertEqual(groups['instruments'], {'mem_mb': 12.0, 'cpu': 30.0, 'processes': 1})
        self.assertEqual(groups['runner-agent']['processes'], 1)
        self.assertEqual(groups['other'], {'mem_mb': 2048.0, 'cpu': 1.0, 'processes': 1})

    def test_a_snapshot_runs_its_commands_one_at_a_time_and_records_size_memory_and_costs(self):
        host, calls, text = self.snapshot(HOST_OUTPUTS)
        self.assertEqual(calls, SNAPSHOT_CALLS)
        self.assertEqual((host['memsize'], host['ncpu'], host['total_pages'], host['memory_level']), (7516192768, 3, 458752, '3'))
        self.assertEqual((host['free_pages'], host['wired_pages'], host['compressor_pages'], host['swapouts']), (4848, 125972, 99350, 0))
        self.assertEqual(host['table'], 'top')
        self.assertEqual([c['command'] for c in host['costs']], ['sysctl', 'vm_stat', 'top -o mem', 'top -o cpu'])
        self.assertTrue(all(c['outcome'] == 'returned' and isinstance(c['ms'], int) and isinstance(c['cpu_ms'], int) for c in host['costs']))
        self.assertIsInstance(host['uptime_ms'], int)
        self.assertIn('8208 1587 812.0 97.5 running HPStudio', text)
        self.assertIn('hw.ncpu: 3', text)

    def test_a_top_that_does_not_return_is_one_line_and_the_next_command_still_runs(self):
        outputs = dict(HOST_OUTPUTS, top=None)
        def run(args, limit):
            if args[0] == 'top' and args[args.index('-o') + 1] == 'mem':
                return f'<{" ".join(args)} did not return within {limit}s>'
            return HOST_OUTPUTS[args[0]]
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            host = observe.host_snapshot(evidence, step='test', sample=1, run=lambda a, l: calls.append(a) or run(a, l))
            text = (evidence / observe.HOST_FILE).read_text()
        self.assertEqual([a[0] for a in calls], ['sysctl', 'vm_stat', 'top', 'top'])
        self.assertIn(f'did not return within {observe.HOST_TOP_LIMIT}s', text)
        self.assertEqual([c['outcome'] for c in host['costs']], ['returned', 'returned', 'timeout', 'returned'])
        # The CPU table alone still gives the groups; ps -c is not needed.
        self.assertEqual(host['table'], 'top')
        self.assertEqual(host['groups']['app']['processes'], 1)

    def test_ps_c_runs_only_when_both_tops_do_not_return(self):
        ps = '  PID  PPID    RSS  %CPU STAT COMM\n 8208  1587 831488  97.5 R    HPStudio\n   90     1  52224   6.0 Ss   logd\n'
        timeout = '<top did not return within 20s>'
        host, calls, text = self.snapshot({'sysctl': HOST_SYSCTL_OUTPUT, 'vm_stat': HOST_VM_STAT, 'top': timeout, 'ps': ps})
        self.assertEqual([a for a, _ in calls][-1], observe.HOST_PS)
        self.assertEqual(calls[-1][1], observe.HOST_PS_LIMIT)
        self.assertEqual(host['table'], 'ps -c')
        self.assertEqual(host['groups']['app'], {'mem_mb': 812.0, 'cpu': 97.5, 'processes': 1})
        everything = {'sysctl': '<sysctl did not return within 10s>', 'vm_stat': '<vm_stat did not return within 10s>',
                      'top': timeout, 'ps': '<ps did not return within 15s>'}
        host, calls, text = self.snapshot(everything)
        self.assertEqual(len(calls), 5)
        self.assertEqual((host['memsize'], host['free_pages'], host['groups']), (None, None, {}))
        self.assertEqual([c['outcome'] for c in host['costs']], ['timeout'] * 5)

    def test_boot_readings_record_the_runner_size_without_top(self):
        row, _ = SimObserve().take(SimObserve().table())
        self.assertEqual((row['host']['memsize'], row['host']['ncpu']), (7516192768, 3))
        self.assertEqual(row['host']['table'], 'none')
        self.assertEqual(row['host']['groups'], {})
        case = SimObserve(); case.take(case.table())
        self.assertNotIn('top', case.commands)
        self.assertEqual(case.commands[:3], ['ps', 'vm_stat', 'sysctl'])
        # The existing reading is unchanged and comes first; the watch readings add top.
        row, _ = case.take(case.table(), step='test')
        # The render reading (#4432 F21) comes after all of them; no render process listed, so no ps -p.
        self.assertEqual(case.commands, ['ps', 'vm_stat', 'sysctl', 'sysctl', 'top', 'top', 'pgrep'])
        self.assertEqual(row['host']['groups']['app']['processes'], 1)
        self.assertEqual([c['command'] for c in row['host']['costs']][:3], ['ps', 'vm_stat', 'sysctl loadavg'])
        self.assertIsInstance(row['uptime_ms'], int)


class RenderAndGroups(unittest.TestCase):
    """ios-sim-observe.py (#4432 F21): the simulator's render processes and poster/widget extensions get their
    own groups, and every watch reading records SimRenderServer's RSS and the test it falls in."""
    DEVICE = SimObserve.DEVICE
    # Run 45263058705 shard 3, 21:17:55: SimRenderServer was the biggest process and its parent is launchd.
    TOP = (HOST_TOP_HEADER + HOST_TOP_TABLE + HOST_TOP_HEADER + HOST_TOP_TABLE
           + '1691   1     1837M 1.4  12    sleeping SimRenderServer\n'
           + '1623   1     102M  0.0  9     sleeping SimMetalHost\n'
           + '1587   1500  31M   0.4  3     sleeping launchd_sim\n'
           + '1600   1587  116M  3.0  8     sleeping SpringBoard\n'
           + '1807   1587  37M   0.1  5     running  PosterBoard\n'
           + '3300   1587  60M   79.0 7     running  EmojiPosterExten\n'
           + '3301   1587  55M   81.0 7     running  AegirPoster\n'
           + '3462   1587  20M   45.2 4     running  SleepWidgetExten\n'
           + '3463   1587  15M   9.3  4     running  HealthMedication\n'
           + '8208   1587  56M   18.3 31    running  HPStudio\n')

    def test_render_processes_are_simulator_and_poster_and_widget_extensions_are_springboard_ext(self):
        groups = observe.group_sums(observe.top_rows(self.TOP))
        # SimRenderServer + SimMetalHost by name, launchd_sim by name, SpringBoard and HealthMedication by parent.
        self.assertEqual(groups['simulator'], {'mem_mb': 2101.0, 'cpu': 14.1, 'processes': 5})
        self.assertEqual(groups['springboard-ext'], {'mem_mb': 172.0, 'cpu': 205.3, 'processes': 4})
        self.assertEqual(groups['app'], {'mem_mb': 56.0, 'cpu': 18.3, 'processes': 1})
        self.assertNotIn('other', groups, 'Nothing in this table is unknown.')
        self.assertEqual(observe.process_group({'command': 'SimRenderServer', 'ppid': 1}, set()), 'simulator')
        self.assertEqual(observe.process_group({'command': 'MercuryPoster', 'ppid': 1}, set()), 'springboard-ext')
        self.assertEqual(observe.process_group({'command': 'Google Chrome He', 'ppid': 1}, set()), 'other')

    def render(self, outputs):
        calls = []
        def run(args, limit):
            calls.append((args, limit))
            return outputs[args[0]]
        return observe.render_reading(run=run), calls

    # `top -l 1 -pid 167 -pid 90 -stats pid,mem` on macOS: the summary lines, a blank line, then the table.
    RENDER_TOP = ('Processes: 612 total, 3 running, 609 sleeping, 3046 threads\nNetworks: packets: 1/1G in, 1/1G out.\n'
                  'Disks: 1/1G read, 1/1G written.\n\nPID   MEM \n2342  1638M\n2346  115M+\n')

    def test_render_reading_reads_the_named_pids_only_with_top_mem(self):
        reading, calls = self.render({'pgrep': '2342 SimRenderServer\n2346 SimMetalHost\n', 'top': self.RENDER_TOP})
        self.assertEqual(calls, [(observe.RENDER_PGREP, 10), (['top', '-l', '1', '-pid', '2342', '-pid', '2346', '-stats', 'pid,mem'], 10)])
        self.assertEqual(reading['processes'], [{'pid': 2342, 'name': 'SimRenderServer', 'mem_mb': 1638.0},
                                                {'pid': 2346, 'name': 'SimMetalHost', 'mem_mb': 115.0}])
        self.assertEqual([c['command'] for c in reading['costs']], ['pgrep render', 'top render'])
        self.assertEqual(observe.RENDER_PGREP, ['pgrep', '-lx', 'SimRenderServer|SimMetalHost'])

    def test_the_event_row_is_read_from_top_mem_not_ps_rss(self):
        # Run 45275644733 shard 2 at 22:19-22:20: ps RSS said 9.5 MB for SimRenderServer :2342, top MEM 1638 MB.
        # The reading must report 1638 and must not run ps at all.
        reading, calls = self.render({'pgrep': '2342 SimRenderServer\n', 'ps': ' 2342 9728\n',
                                      'top': 'PID   MEM\n2342  1638M\n'})
        self.assertEqual(reading['processes'], [{'pid': 2342, 'name': 'SimRenderServer', 'mem_mb': 1638.0}])
        self.assertNotIn('ps', [args[0] for args, _ in calls])
        self.assertEqual(observe.mem_mb('9728K'), 9.5, 'The same RSS in top units would read 9.5 MB.')

    def test_a_render_command_that_does_not_return_leaves_no_rows_and_its_outcome(self):
        reading, calls = self.render({'pgrep': '<pgrep -lx SimRenderServer|SimMetalHost did not return within 10s>'})
        self.assertEqual((reading['processes'], len(calls)), ([], 1))
        self.assertEqual(reading['costs'][0]['outcome'], 'timeout')
        reading, calls = self.render({'pgrep': '1691 SimRenderServer\n', 'top': '<top -l 1 did not return within 10s>'})
        self.assertEqual(reading['processes'], [])
        self.assertEqual([c['outcome'] for c in reading['costs']], ['returned', 'timeout'])
        reading, calls = self.render({'pgrep': ''})
        self.assertEqual((reading['processes'], len(calls)), ([], 1))
        # A top row for a pid pgrep did not name, a row before the table header and a MEM value top did not
        # print as a size are not taken.
        reading, _ = self.render({'pgrep': '1691 SimRenderServer\n1692 SimMetalHost\n',
                                  'top': '1691 5M\nPID MEM\n1691 2048K\n77 9G\n1692 n/a\n'})
        self.assertEqual(reading['processes'], [{'pid': 1691, 'name': 'SimRenderServer', 'mem_mb': 2.0}])

    LOG = ("Test Case '-[HPStudioUITests.TeamEntryUITests testFirst]' started.\n"
           "    t =     0.18s     Launch ai.hypeproof.studio.mobile\n"
           "    t =    61.26s Type 'X' into \"teamOutcomeResult\" TextView\n"
           "Test Case '-[HPStudioUITests.TeamEntryUITests testFirst]' passed (89.861 seconds).\n"
           "Test Case '-[HPStudioUITests.TeamEntryUITests testSecond]' started.\n")

    def current(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'simulator-test.log'
            path.write_text(text)
            return observe.current_test(path)

    def test_current_test_is_the_last_started_test_and_its_own_last_step(self):
        self.assertEqual(self.current(self.LOG), ('testSecond', None), "The previous test's step time is not this test's.")
        self.assertEqual(self.current(self.LOG + '    t =     4.12s         Setting up automation session\n'
                                      + '    t =    12.50s Tap "linkDesktop" Button\n'), ('testSecond', 12.5))
        self.assertEqual(self.current(self.LOG.split("Test Case '-[HPStudioUITests.TeamEntryUITests testSecond]")[0]), ('testFirst', 61.26))
        self.assertEqual(self.current(''), (None, None))
        self.assertEqual(observe.current_test(Path('/nonexistent/simulator-test.log')), (None, None))
        self.assertEqual(observe.current_test(None), (None, None))
        # Only the tail is read: a start older than LOG_TAIL_BYTES is not found.
        self.assertEqual(self.current(self.LOG + 'x' * (observe.LOG_TAIL_BYTES + 10)), (None, None))

    def take(self, step, log_text=None):
        outputs = {'ps': SimObserve().table(), 'vm_stat': 'Pages free:   4298.\n', 'top': self.TOP, 'pgrep': '1691 SimRenderServer\n'}
        def bounded(args, limit=30):
            if args[0] == 'sysctl':
                return '{ 1.0 1.0 1.0 }\n' if args[1] == '-n' else HOST_SYSCTL_OUTPUT
            if args[0] == 'top' and '-pid' in args:
                return 'PID  MEM\n1691  980M\n'
            return outputs[args[0]]
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe.push, 'bounded', side_effect=bounded) as called:
            evidence = Path(directory)
            log = None
            if log_text is not None:
                log = evidence / 'simulator-test.log'
                log.write_text(log_text)
            observe.take(evidence, self.DEVICE, step=step, sample=1, full_table=False, log=log)
            commands = [call.args[0][0] for call in called.call_args_list]
            return json.loads((evidence / 'simulator-steps.jsonl').read_text()), commands

    def test_watch_rows_carry_the_render_rss_and_the_test_they_fall_in(self):
        row, commands = self.take('test', self.LOG + '    t =    68.17s Find the NavigationBar (Element at index 1)\n')
        self.assertEqual(row['host']['render'], [{'pid': 1691, 'name': 'SimRenderServer', 'mem_mb': 980.0}])
        self.assertIsInstance(row['host']['render_uptime_ms'], int)
        self.assertGreaterEqual(row['host']['render_uptime_ms'], row['uptime_ms'])
        self.assertEqual((row['test'], row['test_t']), ('testSecond', 68.17))
        self.assertEqual(commands[-2:], ['pgrep', 'top'], 'The render reading comes after every existing reading.')
        self.assertEqual(row['host']['groups']['simulator']['processes'], 5)
        row, _ = self.take('test')
        self.assertNotIn('test', row, 'Without --log the row names no test.')
        self.assertEqual(row['host']['render'][0]['mem_mb'], 980.0)

    def test_boot_readings_take_no_render_reading(self):
        row, commands = self.take('boot', self.LOG)
        self.assertNotIn('pgrep', commands)
        self.assertNotIn('render', row['host'])
        self.assertNotIn('test', row)

    def test_the_shard_passes_the_test_log_to_the_watch(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        self.assertIn('ios-sim-observe.py watch --evidence ../evidence --device "$device" --interval 60 --log ../evidence/simulator-test.log &', script)
        self.assertEqual(observe.main.__code__.co_filename, observe.__file__)


class PosterProbe(unittest.TestCase):
    """ios-sim-observe.py posters (#4432 F21 2a): what the simulator's wallpaper is made of. Records only, from files
    and the host process table: no simctl spawn and no simulator-steps.jsonl row (ShardShell keeps both exact)."""
    DEVICE = SimObserve.DEVICE

    def device(self, root, *, poster=True, still=False):
        library = root / self.DEVICE / 'data/Library'
        if poster:
            base = library / 'Application Support/PosterBoard/Extensions'
            for provider in ('com.apple.EmojiPoster.EmojiPosterExtension', 'com.apple.MercuryPoster'):
                (base / provider / 'configurations').mkdir(parents=True)
                (base / provider / 'configurations' / 'one.plist').write_text('x')
        if still:
            (library / 'SpringBoard').mkdir(parents=True)
            (library / 'SpringBoard/LockBackground.cpbitmap').write_text('x')
        library.mkdir(parents=True, exist_ok=True)
        return library

    def runtime(self, base):
        runtime = base / 'iOS 27.2.simruntime/Contents/Resources/RuntimeRoot'
        for folder, names in (('LaunchDaemons', ['com.apple.PosterBoard.plist', 'com.apple.backboardd.plist']),
                              ('LaunchAgents', ['com.apple.wallpaper.agent.plist'])):
            (runtime / 'System/Library' / folder).mkdir(parents=True)
            for name in names:
                (runtime / 'System/Library' / folder / name).write_text('x')
        return runtime

    def table(self, runtime):
        return ('  PID  PPID STAT ELAPSED  %CPU %MEM COMMAND\n'
                f' 2350     1 S    10:00  0.4  0.2 launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/{self.DEVICE}/data/var/run/launchd_bootstrap.plist\n'
                f' 2472  2350 S    09:00  0.1  0.5 {runtime}/System/Library/PrivateFrameworks/PosterBoardServices.framework/PosterBoard\n'
                f' 2354  2350 S    09:00  3.0  1.0 {runtime}/System/Library/CoreServices/SpringBoard.app/SpringBoard\n'
                f' 9000  8999 S    09:00  9.0  1.0 {runtime}/Applications/EmojiPoster.app/PlugIns/EmojiPosterExtension.appex/EmojiPosterExtension\n')

    def probe(self, *, table=None, present=True, **device):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'Devices'
            if present:
                self.device(root, **device)
            runtime = self.runtime(base)
            output = self.table(runtime) if table is None else table
            calls = []
            def run(args, limit):
                calls.append((args, limit))
                return output
            evidence = base / 'evidence'; evidence.mkdir()
            kind = observe.poster_probe(evidence, self.DEVICE, run=run, root=root)
            text = (evidence / observe.POSTER_FILE).read_text()
            self.assertFalse((evidence / 'simulator-steps.jsonl').exists(), 'The probe adds no step row.')
        return kind, text, calls

    def test_a_poster_wallpaper_names_its_providers_directories_and_jobs(self):
        kind, text, calls = self.probe()
        self.assertEqual(kind, 'poster')
        self.assertIn('com.apple.EmojiPoster.EmojiPosterExtension\ncom.apple.MercuryPoster\n', text)
        self.assertIn('Application Support/PosterBoard files 2\n', text)
        # Running: this device's PosterBoard only; SpringBoard does not match and the poster under another parent is not this device's.
        running = text.split('-- running poster/wallpaper processes of this device (host ps)\n')[1].split('\n-- ')[0]
        self.assertEqual(running, '2472 PosterBoard')
        self.assertIn('System/Library/LaunchDaemons/com.apple.PosterBoard.plist\nSystem/Library/LaunchAgents/com.apple.wallpaper.agent.plist\n', text)
        self.assertNotIn('backboardd', text)
        self.assertEqual(calls, [(observe.PS, observe.push.DIAGNOSTIC_LIMIT)], 'Only the host process table is read; no simctl.')

    def test_wallpaper_kind_from_file_names(self):
        self.assertEqual(self.probe(poster=False, still=True)[0], 'still')
        self.assertEqual(self.probe(poster=True, still=True)[0], 'both')
        self.assertEqual(self.probe(poster=False, still=False)[0], 'unknown')
        self.assertIn('-- still wallpaper files\nSpringBoard/LockBackground.cpbitmap\n', self.probe(poster=False, still=True)[1])

    def test_missing_device_data_and_a_ps_timeout_are_recorded_not_raised(self):
        kind, text, _ = self.probe(present=False, table='<ps -axro pid,ppid did not return within 30s>')
        self.assertEqual(kind, 'unknown')
        self.assertIn('stopped: no device data directory', text)
        self.assertIn('<ps -axro pid,ppid did not return within 30s>', text)
        self.assertIn('(runtime not found)\n<none>', text)

    def test_the_walk_is_bounded_by_entries_and_time_and_does_not_follow_links(self):
        with tempfile.TemporaryDirectory() as directory:
            library = self.device(Path(directory) / 'Devices')
            (library / 'loop').symlink_to(library)
            (library / 'loopPoster').symlink_to(library / 'Application Support')
            files = observe.poster_files(library)
            self.assertIsNone(files['stopped'])
            self.assertNotIn('loopPoster', files['dirs'], 'A symlinked directory is neither counted nor walked.')
            with mock.patch.object(observe, 'POSTER_WALK_ENTRIES', 3):
                self.assertEqual(observe.poster_files(library)['stopped'], 'entry limit 3')
            ticks = iter([0, 0, 11, 11, 11])
            self.assertEqual(observe.poster_files(library, clock=lambda: next(ticks, 99))['stopped'], f'time limit {observe.POSTER_WALK_LIMIT}s')
            big = library / 'Wallpaper'; big.mkdir()
            for index in range(5):
                (big / f'f{index}').write_text('x')
            with mock.patch.object(observe, 'POSTER_COUNT_LIMIT', 3):
                self.assertEqual(observe.poster_files(library)['dirs']['Wallpaper'], '>=3')

    def test_the_command_never_fails_the_shard_and_runs_only_in_shard_mode_after_warm_up(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe, 'poster_probe', side_effect=RuntimeError('boom')):
            self.assertEqual(observe.main(['posters', '--evidence', directory, '--device', self.DEVICE]), 0)
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        line = 'python3 ../scripts/ios-sim-observe.py posters --evidence ../evidence --device "$device" || echo "::warning::poster probe not recorded"'
        self.assertIn(line, script)
        warm = script.index('timed warm-up xcrun simctl terminate "$device" com.apple.Preferences || true')
        block = script[warm:script.index(line)]
        self.assertIn('if [ "$mode" = shard ]; then', block)
        self.assertLess(script.index(line), script.index('test_status=0'), 'The probe runs before the tests.')

class ApprovalPushWatch(unittest.TestCase):
    """verify-approval-push-simulator.py run (#4432): the shards' host watch beside the focused test, and one more
    reading after a failure. Records only; the job's steps, limits and checkpoint are unchanged."""
    DEVICE = SimObserve.DEVICE

    def test_the_watch_is_the_shards_watch_on_this_device_and_test_log(self):
        with mock.patch.object(push.subprocess, 'Popen') as popen:
            watcher = push.start_watch(Path('/e'), self.DEVICE, Path('/e/xcodebuild.log'))
        args, kwargs = popen.call_args
        self.assertEqual(args[0], [sys.executable, str(push.OBSERVE_SCRIPT), 'watch', '--evidence', '/e', '--device', self.DEVICE,
                                   '--interval', '60', '--log', '/e/xcodebuild.log'])
        self.assertTrue(kwargs['start_new_session'])
        self.assertIs(watcher, popen.return_value)
        self.assertTrue(push.OBSERVE_SCRIPT.is_file())
        with mock.patch.object(push.subprocess, 'Popen', side_effect=OSError('no python')):
            self.assertIsNone(push.start_watch(Path('/e'), self.DEVICE, Path('/e/x.log')))

    def test_stopping_a_missing_or_finished_watch_does_nothing(self):
        with mock.patch.object(push, 'stop_group') as stop:
            push.stop_watch(None)
            finished = mock.Mock(); finished.poll.return_value = 0
            push.stop_watch(finished)
            stop.assert_not_called()
            running = mock.Mock(); running.poll.return_value = None
            push.stop_watch(running)
            stop.assert_called_once_with(running)

    def test_the_failure_reading_is_bounded_by_the_sum_of_its_command_limits(self):
        with mock.patch.object(push, 'bounded', return_value='') as bounded:
            push.one_reading(Path('/e'), self.DEVICE, Path('/e/xcodebuild.log'))
        args, kwargs = bounded.call_args
        self.assertEqual(args[0][1:], [str(push.OBSERVE_SCRIPT), 'once', '--evidence', '/e', '--device', self.DEVICE, '--log', '/e/xcodebuild.log'])
        commands = (3 * push.DIAGNOSTIC_LIMIT + observe.HOST_SYSCTL_LIMIT + 2 * observe.HOST_TOP_LIMIT + observe.HOST_PS_LIMIT
                    + 2 * observe.RENDER_LIMIT)
        self.assertEqual(commands, 175)
        self.assertEqual(kwargs['limit'], push.WATCH_READING_LIMIT)
        self.assertGreaterEqual(push.WATCH_READING_LIMIT, commands)

    def test_run_starts_the_watch_before_the_test_and_reads_once_after_the_notification_log(self):
        source = (NATIVE / 'scripts/verify-approval-push-simulator.py').read_text()
        body = source[source.index('def run(evidence):'):source.index('def cleanup(evidence):')]
        self.assertLess(body.index('watcher = start_watch(evidence, device, log)'), body.index('process = subprocess.Popen(command'))
        failure = body[body.index('except Exception:'):body.index('finally:')]
        self.assertLess(failure.index('stop_watch(watcher)'), failure.index('simulator-notifications.log'))
        self.assertLess(failure.index('simulator-notifications.log'), failure.index('one_reading(evidence, device, log)'))
        self.assertLess(failure.index('one_reading(evidence, device, log)'), failure.index('raise'))
        self.assertIn('stop_watch(watcher)', body[body.index('finally:'):])
        self.assertIn('deadline = time.monotonic() + 540', body, 'The checkpoint limit is unchanged.')

    def test_once_takes_one_test_reading_with_the_test_it_falls_in(self):
        log = RenderAndGroups.LOG + '    t =    19.39s Wait for ai.hypeproof.studio.mobile to become Running Background\n'
        outputs = {'ps': SimObserve().table(), 'vm_stat': 'Pages free:   4298.\n', 'top': HOST_TOP_OUTPUT, 'pgrep': ''}
        def bounded(args, limit=30):
            if args[0] == 'sysctl':
                return '{ 1.0 1.0 1.0 }\n' if args[1] == '-n' else HOST_SYSCTL_OUTPUT
            return outputs[args[0]]
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe.push, 'bounded', side_effect=bounded):
            evidence = Path(directory)
            (evidence / 'xcodebuild.log').write_text(log)
            self.assertEqual(observe.main(['once', '--evidence', directory, '--device', self.DEVICE, '--log', str(evidence / 'xcodebuild.log')]), 0)
            rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['step'], rows[0]['sample'], rows[0]['test'], rows[0]['test_t']), ('test', 0, 'testSecond', 19.39))
        self.assertIn('render', rows[0]['host'])


class PosterTrigger(unittest.TestCase):
    """ios-sim-observe.py posters --when end (#4432 F21 step 1): the poster record again at the end of the shard, and
    the names of the poster update task's schedule state under the device data. Files only; never fails the shard."""
    DEVICE = SimObserve.DEVICE

    def data(self, root):
        data = root / self.DEVICE / 'data'
        (data / 'Library/BackgroundTasks').mkdir(parents=True)
        (data / 'Library/BackgroundTasks/com.apple.springboard.posterboardupdate.prewarm.plist').write_bytes(b'x' * 7)
        (data / 'private/var/db/dasd').mkdir(parents=True)
        (data / 'private/var/db/dasd/store.db').write_bytes(b'y' * 12)
        (data / 'Library/Preferences').mkdir(parents=True)
        (data / 'Library/Preferences/com.apple.other.plist').write_text('z')
        (data / 'Library/dasdLink').symlink_to(data / 'private')
        return data

    def test_schedule_names_with_sizes_and_links_listed_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            data = self.data(Path(directory))
            found = observe.schedule_files(data)
        self.assertIsNone(found['stopped'])
        self.assertEqual(sorted(found['matches']), [
            ('Library/BackgroundTasks', 'dir 1 files'),
            ('Library/BackgroundTasks/com.apple.springboard.posterboardupdate.prewarm.plist', '7'),
            ('Library/dasdLink', str(len(str(data / 'private')))),
            ('private/var/db/dasd', 'dir 1 files'),
        ])
        self.assertNotIn('Library/dasdLink/var', [path for path, _ in found['matches']], 'A link is not followed.')

    def test_the_schedule_walk_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            data = self.data(Path(directory))
            with mock.patch.object(observe, 'SCHEDULE_WALK_ENTRIES', 2):
                self.assertEqual(observe.schedule_files(data)['stopped'], 'entry limit 2')
            ticks = iter([0, 0, 11])
            self.assertEqual(observe.schedule_files(data, clock=lambda: next(ticks, 99))['stopped'], f'time limit {observe.SCHEDULE_WALK_LIMIT}s')
            with mock.patch.object(observe, 'SCHEDULE_WALK_DEPTH', 2):
                self.assertNotIn('private/var/db/dasd', [p for p, _ in observe.schedule_files(data)['matches']])
            with mock.patch.object(observe, 'SCHEDULE_ROWS', 1):
                self.assertEqual(len(observe.schedule_files(data)['matches']), 1)

    def test_the_end_record_names_itself_and_lists_the_schedule_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'Devices'
            self.data(root)
            evidence = Path(directory) / 'evidence'; evidence.mkdir()
            with mock.patch('builtins.print') as printed:
                observe.poster_probe(evidence, self.DEVICE, run=lambda a, l: '', root=root, when='end')
            text = (evidence / observe.POSTER_FILE).read_text()
            self.assertFalse((evidence / 'simulator-steps.jsonl').exists())
        self.assertRegex(text.splitlines()[0], r'^== poster probe \S+ \S+ \(end\)$')
        section = text.split('-- schedule state names (posterboardupdate|dasd|BackgroundTask) under data/')[1].split('\n-- ')[0]
        self.assertIn('Library/BackgroundTasks/com.apple.springboard.posterboardupdate.prewarm.plist 7', section)
        self.assertIn('private/var/db/dasd dir 1 files', section)
        self.assertIn('schedule walk', text.split('-- costs')[1])
        self.assertIn('poster probe (end): ', printed.call_args[0][0])
        self.assertIn('4 schedule state names', printed.call_args[0][0])

    def test_the_command_passes_when_and_never_fails(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe, 'poster_probe') as probe:
            self.assertEqual(observe.main(['posters', '--evidence', directory, '--device', self.DEVICE, '--when', 'end']), 0)
            self.assertEqual(probe.call_args.kwargs['when'], 'end')
            self.assertEqual(observe.main(['posters', '--evidence', directory, '--device', self.DEVICE]), 0)
            self.assertEqual(probe.call_args.kwargs['when'], 'start')
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe, 'poster_probe', side_effect=RuntimeError('boom')):
            self.assertEqual(observe.main(['posters', '--evidence', directory, '--device', self.DEVICE, '--when', 'end']), 0)

    def test_the_shard_takes_the_end_record_after_the_test_and_its_terminate_scan(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        line = 'python3 ../scripts/ios-sim-observe.py posters --evidence ../evidence --device "$device" --when end || echo "::warning::poster probe not recorded"'
        self.assertEqual(script.count(line), 1)
        test = script.index('test-without-building 2>&1 | tee ../evidence/simulator-test.log || test_status=$?')
        scan = script.index('terminate-scan --evidence ../evidence')
        self.assertLess(test, scan); self.assertLess(scan, script.index(line))
        self.assertLess(script.index(line), script.index("printf 'native verification: iPhone simulator journeys\\n'"), 'Shard mode only.')

    def library(self, root):
        """Known answer: store 2 files at 02:51 and 1 at 02:39, Caches/com.apple.EmojiPoster... 1 at 02:51,
        an unrelated cache 1 at 02:51 (not counted), a link into the store (not followed)."""
        library = root / self.DEVICE / 'data/Library'
        store = library / observe.MTIME_STORE / '61/Extensions/com.apple.EmojiPoster.EmojiPosterExtension'
        store.mkdir(parents=True)
        cache = library / 'Caches/com.apple.EmojiPoster.EmojiPosterExtension'; cache.mkdir(parents=True)
        other = library / 'Caches/com.apple.other'; other.mkdir(parents=True)
        at = lambda hh, mm: datetime(2026, 11, 24, hh, mm, 30, tzinfo=timezone.utc).timestamp()
        for path, stamp in [(store / 'a', at(2, 51)), (store / 'b', at(2, 51)), (store / 'c', at(2, 39)),
                            (cache / 'd', at(2, 51)), (other / 'e', at(2, 51))]:
            path.write_text('x'); os.utime(path, (stamp, stamp))
        (cache / 'storeLink').symlink_to(library / observe.MTIME_STORE)
        return library

    def test_mtimes_are_counted_by_minute_for_the_store_and_poster_caches_only(self):
        with tempfile.TemporaryDirectory() as directory:
            found = observe.poster_mtimes(self.library(Path(directory)))
        self.assertIsNone(found['stopped'])
        self.assertEqual(found['minutes'], {'2026-11-24T02:39': [1, 0], '2026-11-24T02:51': [2, 1]})
        self.assertIsNone(found['earlier'])

    def test_the_mtime_walk_is_bounded_and_folds_older_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            library = self.library(Path(directory))
            with mock.patch.object(observe, 'MTIME_ROWS', 1):
                found = observe.poster_mtimes(library)
            self.assertEqual(found['minutes'], {'2026-11-24T02:51': [2, 1]})
            self.assertEqual((found['first'], found['earlier']), ('2026-11-24T02:51', [1, 0]))
            with mock.patch.object(observe, 'MTIME_WALK_ENTRIES', 2):
                self.assertEqual(observe.poster_mtimes(library)['stopped'], 'entry limit 2')
            ticks = iter([0, 0, 11])
            self.assertEqual(observe.poster_mtimes(library, clock=lambda: next(ticks, 99))['stopped'], f'time limit {observe.MTIME_WALK_LIMIT}s')
            with mock.patch.object(observe, 'MTIME_WALK_DEPTH', 2):
                self.assertEqual(observe.poster_mtimes(library)['minutes'], {'2026-11-24T02:51': [0, 1]})

    def test_only_the_end_record_has_the_mtime_table_and_no_step_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'Devices'
            self.library(root)
            evidence = Path(directory) / 'evidence'; evidence.mkdir()
            with mock.patch('builtins.print') as printed:
                observe.poster_probe(evidence, self.DEVICE, run=lambda a, l: '', root=root, when='start')
                start = (evidence / observe.POSTER_FILE).read_text()
                observe.poster_probe(evidence, self.DEVICE, run=lambda a, l: '', root=root, when='end')
            text = (evidence / observe.POSTER_FILE).read_text()
            self.assertFalse((evidence / 'simulator-steps.jsonl').exists())
        self.assertNotIn('-- poster file mtimes', start)
        self.assertNotIn('mtime walk', start)
        end = text[len(start):]
        section = end.split('-- poster file mtimes by UTC minute')[1].split('\n-- ')[0].splitlines()
        self.assertEqual(section[1:], ['minute store caches', '2026-11-24T02:39 1 0', '2026-11-24T02:51 2 1'])
        self.assertIn('mtime walk', end.split('-- costs')[1])
        self.assertIn('; file mtimes in 2 minutes', printed.call_args[0][0])

    def test_without_device_data_the_end_record_says_so(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            with mock.patch('builtins.print'):
                observe.poster_probe(evidence, self.DEVICE, run=lambda a, l: '', root=evidence / 'none', when='end')
            text = (evidence / observe.POSTER_FILE).read_text()
        self.assertIn('0 entries, stopped: no device data directory)\nminute store caches\n<none>\n', text)



class PosterWait(unittest.TestCase):
    """ios-sim-observe.py poster-wait (#4432 F21): before the tests, wait for the boot's poster burst to end,
    at most POSTER_WAIT_LIMIT s after boot; never fails the shard."""
    DEVICE = SimObserve.DEVICE
    BOOT = datetime(2026, 11, 24, 5, 40, 23, tzinfo=timezone.utc).timestamp()

    def setup_device(self, root, evidence, *, fresh=0, old=0, boot_row=True):
        caches = root / self.DEVICE / 'data/Library/Caches'
        poster = caches / 'com.apple.EmojiPoster.EmojiPosterExtension'; poster.mkdir(parents=True)
        other = caches / 'com.apple.other'; other.mkdir()
        for i in range(fresh):
            f = poster / f'new{i}'; f.write_text('x'); os.utime(f, (self.BOOT + 200, self.BOOT + 200))
        for i in range(old):
            f = poster / f'old{i}'; f.write_text('x'); os.utime(f, (self.BOOT - 600, self.BOOT - 600))
        for i in range(40):
            f = other / f'o{i}'; f.write_text('x'); os.utime(f, (self.BOOT + 200, self.BOOT + 200))
        (caches / 'com.apple.LinkPoster').symlink_to(poster)
        if boot_row:
            row = {'step': 'boot', 'command': 'xcrun simctl boot', 'outcome': 'exit 0', 'seconds': 3.0,
                   'utc': datetime.fromtimestamp(self.BOOT + 3, timezone.utc).isoformat(timespec='seconds')}
            (evidence / 'simulator-steps.jsonl').write_text(json.dumps(row) + '\n')

    def run_wait(self, *, fresh=0, old=0, render_mb=(150.0,), start_age=200, boot_row=True, data=True):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root, evidence = Path(temp.name) / 'Devices', Path(temp.name) / 'evidence'; evidence.mkdir()
        if data:
            self.setup_device(root, evidence, fresh=fresh, old=old, boot_row=boot_row)
        now = [self.BOOT + start_age]; sleeps = []; readings = iter(render_mb)
        last = [render_mb[-1]]
        def render():
            value = next(readings, last[0])
            return {'processes': [] if value is None else [{'pid': 1, 'name': 'SimRenderServer', 'mem_mb': value}], 'costs': []}
        def sleep(seconds): sleeps.append(seconds); now[0] += seconds
        with mock.patch('builtins.print') as printed:
            outcome = observe.poster_wait(evidence, self.DEVICE, root=root, clock=lambda: now[0], wall=lambda: now[0],
                                          sleep=sleep, render=render)
        rows = [json.loads(l) for l in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        text = (evidence / observe.POSTER_WAIT_FILE).read_text()
        warned = any('::warning::poster burst not seen before tests' in str(c) for c in printed.call_args_list)
        return outcome, rows[-1], sleeps, text, warned

    def test_ends_when_the_burst_has_run_and_render_memory_is_back(self):
        outcome, row, sleeps, text, warned = self.run_wait(fresh=40, old=5, render_mb=(2505.0, 900.0, 300.0))
        self.assertEqual(outcome, 'burst over')
        self.assertEqual(sleeps, [10, 10])
        self.assertEqual((row['step'], row['command'], row['outcome'], row['readings']), ('warm-up', 'poster-wait', 'burst over', 3))
        # Only the poster cache's files written since boot: not the 5 older ones, the other cache or the link.
        self.assertEqual(row['poster_cache_files'], 40)
        self.assertEqual((row['simrenderserver_mb'], row['peak_mb'], row['seconds'], row['since_boot']), (300.0, 2505.0, 20.0, 220.0))
        self.assertTrue(row['utc'].endswith('+00:00'))
        self.assertFalse(warned)
        self.assertIn('-- burst over: waited 20.0s, since boot 220.0s, 40 poster cache files', text)

    def test_without_the_burst_it_stops_at_the_limit_after_boot_and_warns(self):
        outcome, row, sleeps, text, warned = self.run_wait(fresh=29, render_mb=(150.0,), start_age=200)
        self.assertEqual(outcome, 'limit')
        self.assertTrue(warned)
        # Readings at 200, 210, ..., 540 s after boot: the limit counts from the boot, not from the call.
        self.assertEqual(row['readings'], 35); self.assertEqual(row['since_boot'], 540.0)
        self.assertLessEqual(row['since_boot'], observe.POSTER_WAIT_LIMIT)
        self.assertEqual(len(sleeps), 34)

    def test_burst_files_with_render_still_high_or_unread_do_not_end_the_wait(self):
        outcome, row, _, _, warned = self.run_wait(fresh=40, render_mb=(2505.0,), start_age=500)
        self.assertEqual((outcome, row['readings']), ('limit', 5)); self.assertTrue(warned)
        outcome, row, _, _, _ = self.run_wait(fresh=40, render_mb=(None,), start_age=500)
        self.assertEqual(outcome, 'limit'); self.assertIsNone(row['simrenderserver_mb'])

    def test_called_after_the_limit_it_reads_once_and_goes_on(self):
        outcome, row, sleeps, _, warned = self.run_wait(fresh=0, start_age=600)
        self.assertEqual((outcome, row['readings'], sleeps), ('limit', 1, [])); self.assertTrue(warned)

    def test_no_device_data_or_no_boot_row_never_waits_or_fails(self):
        outcome, row, sleeps, _, warned = self.run_wait(data=False)
        self.assertEqual((outcome, row['readings'], sleeps, row['since_boot']), ('no device data', 0, [], None)); self.assertTrue(warned)
        outcome, row, sleeps, _, _ = self.run_wait(fresh=40, render_mb=(300.0,), boot_row=False, start_age=300)
        # Without the boot row the wait counts from this call: the files written 100 s earlier do not count.
        self.assertEqual((outcome, row['since_boot'], row['poster_cache_files']), ('limit', None, 0))

    def test_the_command_never_fails_the_shard(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(observe, 'poster_wait', side_effect=RuntimeError('boom')):
            self.assertEqual(observe.main(['poster-wait', '--evidence', directory, '--device', self.DEVICE]), 0)

    def test_the_shard_waits_after_the_poster_probe_and_before_the_test(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        line = 'python3 ../scripts/ios-sim-observe.py poster-wait --evidence ../evidence --device "$device" || echo "::warning::poster wait not recorded"'
        self.assertEqual(script.count(line), 1)
        probe = script.index('ios-sim-observe.py posters --evidence ../evidence --device "$device" ||')
        test = script.index('test-without-building 2>&1 | tee ../evidence/simulator-test.log')
        self.assertLess(probe, script.index(line)); self.assertLess(script.index(line), test)
        shard_block = script[script.index('if [ "$mode" = shard ]; then\n  # Is the wallpaper a poster'):script.index('test_status=0')]
        self.assertIn(line, shard_block, 'Shard mode only.')
        self.assertEqual(observe.POSTER_WAIT_LIMIT, 540)

class BoundaryVerdicts(unittest.TestCase):
    """ios-sim-observe.py boundary-verdict (#4432 F21): runner-ax, app, unknown, and host saturated."""
    START, DEADLINE = 100_000, 110_000

    def wait(self, polls, count=1):
        lines = [observe.POLLS_HEADER,
                 f'key active_history_reads; count {count}; wait start {self.START}; deadline {self.DEADLINE}; result 2; ended 112000']
        lines += [f'poll {a} {b} {c}' for a, b, c in polls] + ['dropped 0']
        return observe.parse_polls('\n'.join(lines) + '\n')

    def fast(self, value=0):
        return [(self.START + 1000 * i, 40, value) for i in range(11)]

    def test_runner_ax_when_a_read_saw_the_value_only_after_the_deadline(self):
        # Run 45149803423 shape: the value was there, the read took 11.5 s.
        wait = self.wait([(self.START, 30, 0), (self.START + 1000, 11_500, 1)])
        self.assertEqual(observe.classify_wait(wait, [])[0], 'runner-ax')
        self.assertIn('after the deadline', observe.classify_wait(wait, [])[1])

    def test_runner_ax_when_one_read_took_five_seconds(self):
        wait = self.wait([(self.START, 30, 0), (self.START + 1000, 5000, 0), (self.START + 6100, 30, 0)])
        self.assertEqual(observe.classify_wait(wait, []), ('runner-ax', 'one trace read took 5000 ms'))
        # Just under the limit is not runner-ax, and not fast either: unknown.
        self.assertEqual(observe.classify_wait(self.wait([(self.START, 4999, 0)] + self.fast()[5:]), [])[0], 'unknown')

    def test_app_when_a_main_stall_overlaps_even_if_a_read_was_slow(self):
        wait = self.wait([(self.START, 30, 0), (self.START + 1000, 11_500, 1)])
        spans = observe.stall_spans('HPStudio main stall: 3026 ms from uptime 104000 ms; 1 slow\n'
                                    'HPStudio main stall (ongoing): 3034 ms since uptime 200000 ms; pid 7\n')
        self.assertEqual(spans, [(104000, 107026), (200000, 203034)])
        self.assertEqual(observe.classify_wait(wait, spans)[0], 'app')
        # A stall that ended before the wait started does not count.
        self.assertEqual(observe.classify_wait(wait, [(90_000, 99_999)])[0], 'runner-ax')

    def test_app_when_every_read_was_fast_and_none_saw_the_value(self):
        self.assertEqual(observe.classify_wait(self.wait(self.fast()), []),
                         ('app', '11 fast reads up to the deadline, none saw 1'))

    def test_unknown_without_reads_or_with_a_gap_or_a_late_read_below_the_count(self):
        self.assertEqual(observe.classify_wait(None, []), ('unknown', 'no trace reads recorded'))
        self.assertEqual(observe.classify_wait(self.wait([]), [])[0], 'unknown')
        gap = [p for p in self.fast() if not 3000 < p[0] - self.START < 7000]
        self.assertEqual(observe.classify_wait(self.wait(gap), [])[0], 'unknown')
        self.assertEqual(observe.classify_wait(self.wait([(self.START + 9000, 3000, 0)]), [])[0], 'unknown')
        self.assertIsNone(observe.parse_polls('request-boundary polls v2\nkey a; count 1\n'))
        self.assertIsNone(observe.parse_polls('any other attachment'))

    def host(self, uptime, *, free=50_000, swapouts=0, slow=False):
        return {'step': 'test', 'command': 'observe', 'uptime_ms': uptime,
                'host': {'uptime_ms': uptime, 'total_pages': 458752, 'free_pages': free, 'swapouts': swapouts,
                         'costs': [{'command': 'ps', 'ms': 31_000 if slow else 200, 'outcome': 'timeout' if slow else 'returned'}]}}

    def test_host_saturated_needs_two_markers_near_the_wait(self):
        wait = self.wait(self.fast())
        quiet = [self.host(50_000), self.host(110_000)]
        self.assertEqual(observe.saturation(wait, quiet), [])
        one = [self.host(50_000), self.host(110_000, free=4000)]
        self.assertEqual(observe.saturation(wait, one), ['free memory under 1%'])
        two = [self.host(50_000), self.host(155_000, free=4000, swapouts=17_432)]
        self.assertEqual(observe.saturation(wait, two), ['free memory under 1%', 'swapouts rose', 'watch readings 90 s or more apart'])
        slow = [self.host(60_000), self.host(111_000, slow=True)]
        self.assertEqual(observe.saturation(wait, slow), ['a snapshot command took 10 s or did not return'])
        # Snapshots far from the wait say nothing about it.
        self.assertEqual(observe.saturation(wait, [self.host(500_000, free=10), self.host(600_000, free=10, swapouts=9)]), [])

    def test_the_command_writes_one_verdict_per_polls_attachment(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory); attachments = evidence / 'journey-attachments'; attachments.mkdir()
            late = '\n'.join([observe.POLLS_HEADER, f'key active_history_reads; count 1; wait start {self.START}; deadline {self.DEADLINE}; result 2; ended 112000',
                              f'poll {self.START} 30 0', f'poll {self.START + 1000} 11500 1', 'dropped 0']) + '\n'
            (attachments / 'request-boundary-active_history_reads-polls_0_A.txt').write_text(late)
            (attachments / 'other-screen.png').write_bytes(b'\x89PNG')
            (attachments / 'manifest.json').write_text('[]')
            rows = [self.host(50_000), self.host(155_000, free=4000, swapouts=17_432)]
            (evidence / 'simulator-steps.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows))
            log = evidence / 'simulator-test.log'; log.write_text('Test Case started\n')
            lines = observe.boundary_verdicts(evidence, log)
            written = (evidence / observe.VERDICT_FILE).read_text()
            verdict = json.loads((evidence / 'simulator-steps.jsonl').read_text().splitlines()[-1])
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith('request-boundary verdict: active_history_reads runner-ax; host saturated ('), lines[0])
        self.assertEqual(written, lines[0] + '\n')
        self.assertEqual((verdict['step'], verdict['verdict'], verdict['saturated'], verdict['reads']), ('boundary', 'runner-ax', True, 2))
        # One marker alone is not saturation.
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory); attachments = evidence / 'journey-attachments'; attachments.mkdir()
            (attachments / 'polls.txt').write_text(late)
            rows = [self.host(50_000), self.host(110_000, free=4000)]
            (evidence / 'simulator-steps.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows))
            lines = observe.boundary_verdicts(evidence, evidence / 'none.log')
        self.assertEqual(lines, ['request-boundary verdict: active_history_reads runner-ax (read from uptime 101000 saw 1 but returned '
                                 '2500 ms after the deadline; host: free memory under 1%)'])
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(observe.boundary_verdicts(Path(directory), Path(directory) / 'none.log'), [])
            self.assertEqual((Path(directory) / observe.VERDICT_FILE).read_text(), 'no request-boundary polls attachment\n')

    def test_the_ui_test_writes_the_format_the_verdict_reads(self):
        source = (NATIVE / 'ios/UITests/StudioShellTests.swift').read_text()
        self.assertIn(f'"{observe.POLLS_HEADER}"', source)
        wait = re.search(r'"(key \\\(key\); count .*?)"\]', source)
        self.assertIsNotNone(wait)
        rendered = re.sub(r'\\\((key)\)', 'active_history_reads', wait[1])
        rendered = re.sub(r'\\\([^)]*\)\)?', '7', rendered)
        self.assertRegex(rendered, observe.POLLS_WAIT)
        poll = re.search(r'"(poll \\\(.*?)"', source)[1]
        self.assertRegex(re.sub(r'\\\([^)]*\)', '7', poll), observe.POLL_ROW)
        self.assertIn('static let capacity = 64', source)
        # No AX query is added: the wait reads node.value once per evaluation, as before.
        body = source[source.index('private func waitForTraceCount'):source.index('func testPersonalQuestionReadyAndSendWhileDesktopListIsHeld')]
        self.assertEqual(body.count('node.value as?'), 1)
        self.assertEqual(body.count('app.'), 0)
        # The wait itself is unchanged: one 10 s XCTWaiter and the same assertion.
        self.assertIn('let result = XCTWaiter.wait(for: [observed], timeout: 10)', source)
        self.assertIn('XCTAssertEqual(result, .completed, "Observe the actual request boundary before judging readiness.")', source)

    def test_the_shard_runs_the_verdict_after_the_attachment_export_and_ignores_its_exit(self):
        script = (NATIVE / 'scripts/ios-verify.sh').read_text()
        line = 'python3 ../scripts/ios-sim-observe.py boundary-verdict --evidence ../evidence --log ../evidence/simulator-test.log || true'
        self.assertIn(line, script)
        self.assertLess(script.index('xcrun xcresulttool export attachments'), script.index(line))


class StallSamples(unittest.TestCase):
    """ios-sim-observe.py stall-watch (#4432 F11): diagnostics only."""

    def line(self, length, start, pid=None):
        named = '' if pid is None else f'; pid {pid}'
        return (f'<unknown>:0: warning: -[HPStudioUITests.TeamEntryUITests testA] : HPStudio main stall (ongoing): '
                f'{length} ms since uptime {start} ms{named}; outstanding ping {length} ms; 0 slow pings answered; render changes: none\n')

    DEVICE = SimObserve.DEVICE
    OTHER = 'FFFFFFFF-0000-4000-8000-000000000000'

    def app(self, pid, device):
        return f'{pid} /Users/runner/Library/Developer/CoreSimulator/Devices/{device}/data/Containers/Bundle/Application/AB12/HPStudio.app/HPStudio\n'

    def table(self):
        # Another shard's newer app, this device's two apps, and this device's UI test runner.
        return ('  1 /sbin/launchd\n' + self.app(4242, self.DEVICE) + self.app(4100, self.DEVICE) + self.app(9999, self.OTHER)
                + f'5000 /Users/runner/Library/Developer/CoreSimulator/Devices/{self.DEVICE}/data/Containers/Bundle/Application/CD34/HPStudioUITests-Runner.app/HPStudioUITests-Runner\n')

    def scan(self, evidence, text, ps=None, sample_out=''):
        log = evidence / 'simulator-test.log'; log.write_text(text)
        calls = []
        def run(args, limit):
            calls.append((args, limit))
            if args[0] == 'ps':
                return self.table() if ps is None else ps
            if args[0] in HOST_OUTPUTS:
                return HOST_OUTPUTS[args[0]]
            Path(args[args.index('-file') + 1]).write_text('Call graph:\n    main-thread\n')
            return sample_out
        return observe.scan_stall(evidence, self.DEVICE, log, run=run), calls

    def test_only_this_devices_app_is_chosen(self):
        self.assertEqual(observe.app_pid(self.table(), self.DEVICE), 4242)
        self.assertEqual(observe.app_pid(self.table(), self.OTHER), 9999)
        self.assertIsNone(observe.app_pid(self.app(9999, self.OTHER), self.DEVICE))
        self.assertIsNone(observe.app_pid(f'5000 /x/CoreSimulator/Devices/{self.DEVICE}/y/HPStudioUITests-Runner.app/HPStudioUITests-Runner\n', self.DEVICE))

    def test_the_20_and_40_second_lines_are_not_new_stalls(self):
        text = self.line(10034, 1572426) + self.line(40012, 1572426) + 'HPStudio main stall: 50112 ms from uptime 1572426 ms\n' + self.line(10483, 1662585)
        self.assertEqual(observe.stall_starts(text), ['1572426', '1662585'])
        self.assertEqual(observe.stall_starts('HPStudio main stall: 3163 ms from uptime 1499916 ms\n'), [])

    def test_each_stall_is_sampled_once_with_bounded_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, self.line(10034, 1572426) + self.line(20019, 1572426))
            self.assertEqual(taken, 1)
            self.assertEqual(calls, [(['ps', '-axo', 'pid=,command='], 10),
                                     (['sample', '4242', '1', '-mayDie', '-file', str(evidence / 'stall-sample-1.txt')], 30)]
                             + SNAPSHOT_CALLS)
            self.assertEqual(self.scan(evidence, self.line(40012, 1572426)), (0, []))
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text())
            self.assertIn('main-thread', (evidence / 'stall-sample-1.txt').read_text())
            header = (evidence / 'stall-samples.txt').read_text()
        self.assertEqual({k: row[k] for k in ('step', 'command', 'sample', 'start', 'pid', 'pid_from', 'outcome')},
                         {'step': 'stall', 'command': 'sample', 'sample': 1, 'start': 1572426, 'pid': 4242, 'pid_from': 'ps', 'outcome': 'sampled'})
        self.assertRegex(header, r'^== stall 1 start 1572426 \S+ pid 4242 sampled\n')

    def test_the_pid_the_app_names_is_sampled_without_ps(self):
        # Run 45132515641: ps -axo did not return within 10 s during a stall. The app's own pid needs no ps.
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, self.line(3012, 1572426, pid=31337) + self.line(10034, 1572426, pid=31337))
            self.assertEqual(taken, 1)
            self.assertEqual(calls, [(['sample', '31337', '1', '-mayDie', '-file', str(evidence / 'stall-sample-1.txt')], 30)]
                             + SNAPSHOT_CALLS)
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text())
        self.assertEqual((row['pid'], row['pid_from'], row['outcome']), (31337, 'line', 'sampled'))

    def test_a_pid_that_is_not_valid_falls_back_to_ps(self):
        self.assertEqual(observe.stall_pids(self.line(3000, 7, pid=0) + self.line(3000, 8, pid=99999999999)
                                            + self.line(3000, 9, pid='12x') + self.line(3000, 10, pid=55) + self.line(10000, 10, pid=66)),
                         {'10': 55})
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, self.line(3000, 7, pid=0))
            self.assertEqual(taken, 1)
            self.assertEqual([args[0] for args, _ in calls], ['ps', 'sample', 'sysctl', 'vm_stat', 'top', 'top'])
            self.assertEqual(calls[1][0][1], '4242')

    def test_no_app_process_and_a_hung_sample_are_recorded_not_raised(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            # Only another device's app on the host: nothing is sampled.
            self.assertEqual(self.scan(evidence, self.line(10034, 1), ps=self.app(9999, self.OTHER))[0], 1)
            log = evidence / 'simulator-test.log'; log.write_text(self.line(10034, 2))
            hung = observe.scan_stall(evidence, self.DEVICE, log, run=lambda args, limit: self.table() if args[0] == 'ps' else '<sample did not return within 30s>')
            self.assertEqual(hung, 1)
            log.write_text(self.line(10034, 3))
            self.assertEqual(observe.scan_stall(evidence, self.DEVICE, log, run=lambda args, limit: '<ps did not return within 10s>'), 1)
            rows = [json.loads(l) for l in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
        self.assertEqual([(r['pid'], r['outcome']) for r in rows], [(None, 'no process'), (4242, 'timeout'), (None, 'ps timeout')])

    def test_samples_stop_at_the_per_shard_cap(self):
        text = ''.join(self.line(10000, start) for start in (1, 2, 3, 4, 5))
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, text)
            self.assertEqual(taken, observe.STALL_CAPTURES)
            self.assertEqual(len(calls), (2 + len(SNAPSHOT_CALLS)) * observe.STALL_CAPTURES)
            self.assertEqual(self.scan(evidence, text), (0, []))

    def loop_line(self, length, start, passes, pid=None):
        named = '' if pid is None else f'; pid {pid}'
        return (f'<unknown>:0: warning: -[HPStudioUITests.TeamEntryUITests testB] : HPStudio main stall (ongoing): '
                f'{length} ms since uptime {start} ms{named}; outstanding ping {length} ms; 0 slow pings answered; '
                f'render changes: make.github+1@876009 pub.github+1@876035 probe.detail.dismiss+{passes}@879505 '
                f'body.github+{passes}@879506 body.detail+{passes}@879513; why: TeamGitHubScreen.@self+80 '
                f'(print window 161 of 175 lines, other 0); log: off (print active)\n')

    def sampled_starts(self, evidence):
        return [int(start) for start in observe.captured_stalls(evidence)]

    def test_the_last_capture_is_kept_for_a_loop(self):
        # Run 45179328976: three short stalls (no render changes, 3-8 s) took every capture before the loop.
        short = ''.join(self.line(3005, start) for start in (1, 2, 3))
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            self.assertEqual(self.scan(evidence, short)[0], 2)
            self.assertEqual(self.sampled_starts(evidence), [1, 2])
            self.assertEqual(self.scan(evidence, short + self.loop_line(3086, 876428, 304))[0], 1)
            self.assertEqual(self.sampled_starts(evidence), [1, 2, 876428])
            self.assertEqual(self.scan(evidence, short + self.loop_line(3086, 876428, 304) + self.loop_line(3000, 9, 500)), (0, []))

    def test_a_short_stall_passed_over_is_taken_when_it_reaches_10_s(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            text = ''.join(self.line(3005, start) for start in (1, 2, 3))
            self.assertEqual(self.scan(evidence, text)[0], 2)
            self.assertEqual(self.scan(evidence, text)[0], 0)
            self.assertEqual(self.scan(evidence, text + self.line(10012, 3))[0], 1)
            self.assertEqual(self.sampled_starts(evidence), [1, 2, 3])

    def test_loops_take_every_capture_in_order(self):
        text = ''.join(self.loop_line(3000, start, 150) for start in (1, 2, 3, 4))
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            self.assertEqual(self.scan(evidence, text)[0], observe.STALL_CAPTURES)
            self.assertEqual(self.sampled_starts(evidence), [1, 2, 3])

    def test_the_loop_mark_counts_only_body_render_changes(self):
        self.assertEqual(observe.LOOP_PASSES, 100)
        self.assertEqual(observe.LONG_STALL_MS, 10_000)
        self.assertEqual(observe.stall_priority(self.loop_line(3000, 1, 99) + self.loop_line(3000, 2, 100) + self.line(9999, 3)
                                                + self.line(10000, 4)),
                         {'1': False, '2': True, '3': False, '4': True})
        # Large counts outside "render changes" (why, log) or on other keys do not mark a loop.
        other = (self.line(3000, 5).replace('render changes: none', 'render changes: pub.text+900@1 focus.text+400@2')
                 .rstrip('\n') + '; why: TeamGitHubScreen.@self+290; log: shape[w]+2016 body.planted+900@3\n')
        self.assertEqual(observe.stall_priority(other), {'5': False})
        # A later line of the same stall keeps an earlier mark.
        self.assertEqual(observe.stall_priority(self.loop_line(3000, 6, 300)
                                                + self.line(3500, 6).replace('render changes: none', 'render changes: body.detail+2@1')),
                         {'6': True})

    def test_a_missing_log_takes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(observe.scan_stall(Path(directory), self.DEVICE, Path(directory) / 'none.log',
                                                run=lambda *_: self.fail('no command without a log')), 0)


class TerminateDiagnostics(unittest.TestCase):
    """ios-sim-observe.py terminate-watch/terminate-scan (#4432 F6): diagnostics only."""
    DEVICE = SimObserve.DEVICE

    def line(self, pid, test='testA'):
        return (f'<unknown>:0: error: -[HPStudioUITests.AlphaTests {test}] : Failed to terminate '
                f'ai.hypeproof.studio.mobile:{pid}: Failed to terminate ai.hypeproof.studio.mobile:0\n')

    def scan(self, evidence, text, outputs):
        log = evidence / 'simulator-test.log'; log.write_text(text)
        calls = []
        def run(args, limit):
            calls.append((args, limit))
            return outputs[args[4]]
        taken = observe.scan_terminate(evidence, self.DEVICE, log, run=run)
        return taken, calls

    def test_the_inner_zero_pid_is_not_a_second_failure(self):
        self.assertEqual(observe.terminate_failures(self.line(9784) + 'Test Case passed\n' + self.line(30189)),
                         [('ai.hypeproof.studio.mobile', '9784'), ('ai.hypeproof.studio.mobile', '30189')])
        self.assertEqual(observe.terminate_failures("Test Case '-[A testB]' passed\n"), [])

    def test_a_launch_stuck_at_its_terminate_step_counts_with_that_pid(self):
        # Run 45116092106 shard 1: the launch hung at "Terminate …:18637", then the allowance ran out.
        hung = ('    t =     0.05s     Launch ai.hypeproof.studio.mobile\n'
                '    t =     0.05s         Terminate ai.hypeproof.studio.mobile:18637\n'
                "Test Case '-[HPStudioUITests.TeamEntryUITests testA]' exceeded execution time allowance of 3 minutes.\n"
                "<unknown>:0: error: -[HPStudioUITests.TeamEntryUITests testA] : Application 'ai.hypeproof.studio.mobile' does not have a process ID\n")
        self.assertEqual(observe.terminate_failures(hung), [('ai.hypeproof.studio.mobile', '18637')])
        # A launch whose terminate step succeeded is not a failure, and no step means no pid to use.
        self.assertEqual(observe.terminate_failures('    t =     0.05s         Terminate ai.hypeproof.studio.mobile:18637\n'), [])
        self.assertEqual(observe.terminate_failures(hung.split('\n', 2)[2]), [])
        # The same pid reported both ways is one failure.
        self.assertEqual(observe.terminate_failures(hung + self.line(18637)), [('ai.hypeproof.studio.mobile', '18637')])

    def test_each_failure_is_captured_once_with_bounded_commands(self):
        listing = 'PID\tStatus\tLabel\n-\t0\tUIKitApplication:ai.hypeproof.studio.mobile[1a2b][rb-legacy]\n412\t0\tcom.apple.other\n'
        outputs = {'launchctl': listing, 'log': 'runningboardd: [app<ai.hypeproof.studio.mobile>:9784] termination reported\n'}
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, self.line(9784), outputs)
            self.assertEqual(taken, 1)
            self.assertEqual([(a[4:7] if a[4] == 'log' else a[4:6], limit) for a, limit in calls],
                             [(['launchctl', 'list'], 30), (['log', 'show', '--last'], 60)])
            self.assertIn('process IN {"runningboardd", "SpringBoard", "testmanagerd"}', calls[1][0])
            # The same log again: nothing new.
            self.assertEqual(self.scan(evidence, self.line(9784), outputs), (0, []))
            text = (evidence / 'terminate-diagnostics.txt').read_text()
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text())
        self.assertIn('UIKitApplication:ai.hypeproof.studio.mobile[1a2b][rb-legacy]', text)
        self.assertNotIn('com.apple.other', text)
        self.assertIn('termination reported', text)
        self.assertEqual({k: row[k] for k in ('step', 'command', 'sample', 'pid', 'launchctl', 'log', 'log_lines')},
                         {'step': 'terminate', 'command': 'diagnose', 'sample': 1, 'pid': 9784,
                          'launchctl': 'listed', 'log': 'shown', 'log_lines': 1})

    def test_a_command_that_does_not_return_is_recorded_not_raised(self):
        outputs = {'launchctl': '<xcrun simctl spawn x launchctl list did not return within 30s>',
                   'log': '<xcrun simctl spawn x log show did not return within 60s>'}
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            self.assertEqual(self.scan(evidence, self.line(9784), outputs)[0], 1)
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text())
        self.assertEqual((row['launchctl'], row['log']), ('timeout', 'timeout'))

    def test_captures_stop_at_the_per_shard_cap(self):
        outputs = {'launchctl': '', 'log': ''}
        text = ''.join(self.line(pid, f'test{pid}') for pid in (101, 102, 103, 104, 105))
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            taken, calls = self.scan(evidence, text, outputs)
            self.assertEqual(taken, observe.TERMINATE_CAPTURES)
            self.assertEqual(len(calls), 2 * observe.TERMINATE_CAPTURES)
            self.assertEqual(self.scan(evidence, text, outputs), (0, []))
            row = json.loads((evidence / 'simulator-steps.jsonl').read_text().splitlines()[0])
        self.assertEqual(row['launchctl'], 'absent')

    def test_a_missing_log_takes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(observe.scan_terminate(Path(directory), self.DEVICE, Path(directory) / 'none.log',
                                                    run=lambda *_: self.fail('no command without a log')), 0)

    def test_a_stopped_watcher_stops_its_running_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory); log = evidence / 'simulator-test.log'; log.write_text(self.line(9784))
            bin_dir = evidence / 'bin'; bin_dir.mkdir()
            # A capture command that never returns by itself; it records its pid first.
            (bin_dir / 'xcrun').write_text(f'#!{sys.executable}\nimport os,time\nopen(os.environ["HANG_PID"],"w").write(str(os.getpid()))\ntime.sleep(120)\n')
            (bin_dir / 'xcrun').chmod(0o755)
            env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'], HANG_PID=str(evidence / 'hang.pid'))
            child = subprocess.Popen([sys.executable, str(NATIVE / 'scripts/ios-sim-observe.py'), 'terminate-watch', '--evidence', str(evidence),
                                      '--device', self.DEVICE, '--log', str(log), '--interval', '0.2'], env=env)
            deadline = time.monotonic() + 20
            while not (evidence / 'hang.pid').exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            hung = int((evidence / 'hang.pid').read_text())
            child.terminate(); child.wait(timeout=10)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    os.kill(hung, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            else:
                os.kill(hung, 9); self.fail('the capture command outlived its stopped watcher')


class CollectShell(unittest.TestCase):
    """The real ios-collect.sh with the real journey and sign-in collectors."""

    def run_collect(self, *, build='success', ui='success', voice='success', shard_changes=None, plan=True):
        temp = tempfile.TemporaryDirectory(prefix='studio-ios-collect-'); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        native = root / 'apps/studio-native'
        (native / 'scripts').mkdir(parents=True); (native / 'ios').mkdir(); (native / 'evidence').mkdir()
        for name in ('ios-collect.sh', 'ios-ui-shards.py', 'collect-native-journeys.py', 'collect-signin-journey.py'):
            shutil.copyfile(NATIVE / 'scripts' / name, native / 'scripts' / name)
        (native / 'evidence/device-build.log').write_text('** BUILD SUCCEEDED **\n')
        doc = shards.plan(shards.discover(NATIVE / 'ios/UITests'), 3, [VOICE])
        if plan:
            (native / 'evidence/ios-ui-shard-plan.json').write_text(json.dumps(doc))
        artifacts = root / 'artifacts'
        for row in doc['shards']:
            changes = (shard_changes or {}).get(row['index'], {})
            if changes == 'missing':
                continue
            directory = write_shard(artifacts, row['index'], row['cases'], **changes)
            directory.rename(artifacts / f'studio-ios-ui-shard-{row["index"]}-77-2')
        env = dict(os.environ, GITHUB_SHA=SHA, NATIVE_SOURCE_HEAD=SHA, GITHUB_RUN_ID='77', GITHUB_RUN_ATTEMPT='2',
                   IOS_BUILD_RESULT=build, IOS_UI_RESULT=ui, IOS_VOICE_RESULT=voice, IOS_SHARD_ARTIFACTS=str(artifacts))
        result = subprocess.run(['bash', str(native / 'scripts/ios-collect.sh')], cwd=root, env=env,
                                capture_output=True, text=True, timeout=30)
        return result, native / 'evidence'

    def test_positive_control_complete_shards_produce_passing_journeys_and_signin_record(self):
        result, evidence = self.run_collect()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        journeys = json.loads((evidence / 'native-journeys.json').read_text())
        self.assertEqual(journeys['simulator_journeys']['status'], 'PASS')
        self.assertEqual(journeys['test_candidate_eligibility'], 'PASS')
        signin = json.loads((evidence / 'signin-journey.json').read_text())
        self.assertEqual(signin['hops']['cancel_returns_to_app']['status'], 'PASS')
        self.assertEqual((signin['run_id'], signin['run_attempt']), (77, 2))
        # Exactly one attachment manifest, as the release evidence reader requires.
        manifests = list(evidence.rglob('journey-attachments/manifest.json'))
        self.assertEqual(manifests, [evidence / 'journey-attachments/manifest.json'])
        self.assertEqual(sorted(p.name for p in (evidence / 'shards').iterdir()), ['shard-1', 'shard-2', 'shard-3', 'shard-4'])
        self.assertIn("testRealKoreanPlaybackCompletionReachesNextCaptureBoundary]' passed", (evidence / 'simulator-test.log').read_text())

    def test_missing_voice_artifact_fails_and_journeys_are_not_a_pass(self):
        result, evidence = self.run_collect(shard_changes={4: 'missing'}, voice='failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((evidence / 'ios-ui-shards.json').read_text())['not_run'], [VOICE])
        self.assertNotEqual(json.loads((evidence / 'native-journeys.json').read_text())['simulator_journeys']['status'], 'PASS')

    def test_voice_job_failure_fails_the_ios_job_even_with_complete_evidence(self):
        result, _ = self.run_collect(voice='failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('iOS real-voice job result: failure', result.stdout)
        result, _ = self.run_collect(voice='cancelled')
        self.assertNotEqual(result.returncode, 0)

    def test_missing_shard_fails_and_journeys_are_not_a_pass(self):
        result, evidence = self.run_collect(shard_changes={2: 'missing'}, ui='failure')
        self.assertNotEqual(result.returncode, 0)
        journeys = json.loads((evidence / 'native-journeys.json').read_text())
        self.assertNotEqual(journeys['simulator_journeys']['status'], 'PASS')
        self.assertEqual(json.loads((evidence / 'ios-ui-shards.json').read_text())['verdict'], 'FAIL')

    def test_failed_shard_exit_fails_the_ios_job(self):
        result, evidence = self.run_collect(shard_changes={3: {'test_exit': 65}}, ui='failure')
        self.assertEqual(result.returncode, 65, result.stdout)

    def test_shard_job_failure_without_other_evidence_still_fails(self):
        result, _ = self.run_collect(ui='failure')
        self.assertNotEqual(result.returncode, 0)

    def test_build_failure_without_plan_records_not_run_and_fails(self):
        result, evidence = self.run_collect(build='failure', plan=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No UI shard plan', result.stdout)
        journeys = json.loads((evidence / 'native-journeys.json').read_text())
        self.assertEqual(journeys['simulator_journeys']['exit_code'], 125)


class ApprovalPushHang(unittest.TestCase):
    def test_stuck_simctl_keeps_its_limit_records_diagnostics_and_fails_by_step(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            bin_dir = evidence / 'bin'; bin_dir.mkdir()
            xcrun = bin_dir / 'xcrun'
            xcrun.write_text(f'#!{sys.executable}\nimport time\ntime.sleep(30)\n'); xcrun.chmod(0o755)
            seen = []
            with mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}), \
                 mock.patch.object(push, 'bounded', side_effect=lambda args, limit=30: seen.append(args) or 'ok'):
                with self.assertRaisesRegex(push.SimctlHang, 'bootstatus did not return within 0.3s during boot'):
                    push.simctl(evidence, 'boot', ['bootstatus', 'X', '-b'], timeout=0.3, capture=False)
            rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
            self.assertEqual((rows[0]['step'], rows[0]['outcome'], rows[0]['limit']), ('boot', 'timeout', 0.3))
            report = (evidence / 'simctl-hang-boot.txt').read_text()
            self.assertIn('sample of the stuck simctl', report)
            self.assertIn('host CoreSimulator log', report)
            self.assertTrue(any(args[0] == 'sample' for args in seen))

    def test_returning_simctl_is_timed_and_not_diagnosed(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            bin_dir = evidence / 'bin'; bin_dir.mkdir()
            xcrun = bin_dir / 'xcrun'
            xcrun.write_text(f'#!{sys.executable}\nprint("ok")\n'); xcrun.chmod(0o755)
            with mock.patch.dict(os.environ, {'PATH': str(bin_dir) + os.pathsep + os.environ['PATH']}):
                self.assertEqual(push.simctl(evidence, 'warm-up', ['launch', 'X', 'com.apple.Preferences'], timeout=5), 'ok')
            self.assertFalse(list(evidence.glob('simctl-hang-*')))
            self.assertEqual(json.loads((evidence / 'simulator-steps.jsonl').read_text())['outcome'], 'exit 0')

    DEVICE = 'C0E7C600-E107-428F-8A03-DEDB01894AEF'

    def ps(self, children, runnable, device=None):
        device = device or self.DEVICE
        lines = ['    1     0 Ss   /sbin/launchd',
                 f' 4820     1 S    launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/{device}/data/var/run/launchd_bootstrap.plist',
                 ' 3041     1 R    /Library/.../CoreSimulatorService']
        for index in range(children):
            lines.append(f' {5000 + index}  4820 {"Rs" if index < runnable else "Ss"}   /RuntimeRoot/usr/libexec/d{index}')
        return '\n'.join(lines) + '\n'

    def test_device_activity_counts_only_the_owned_launchd_sim_children(self):
        self.assertEqual(push.device_activity(self.ps(5, 2), self.DEVICE), (5, 2))
        other = self.ps(5, 2, device='11111111-1111-1111-1111-111111111111')
        self.assertIsNone(push.device_activity(other, self.DEVICE))
        self.assertIsNone(push.device_activity('<ps unavailable>', self.DEVICE))

    def test_recorded_hang_host_reads_as_its_real_counts(self):
        # The process table from run 44874729460, reduced to the columns the observation reads.
        report = Path(__file__).with_name('fixtures') / 'approval-push-processes-44874729460.txt'
        self.assertEqual(push.device_activity(report.read_text(), self.DEVICE), (198, 43))  # 3 CPUs

    def test_observe_records_a_fixed_count_and_never_fails_or_waits_for_a_condition(self):
        # A host that never settles and a ps that cannot be read: still three rows, no error, no hang file.
        outputs = iter([self.ps(250, 180), '<ps -axo did not return within 30s>', self.ps(260, 170)])
        sleeps = []
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(push, 'bounded', side_effect=lambda args, limit=30: next(outputs)), \
             mock.patch.object(push.time, 'sleep', side_effect=sleeps.append):
            evidence = Path(directory)
            push.observe(evidence, self.DEVICE)
            rows = [json.loads(line) for line in (evidence / 'simulator-steps.jsonl').read_text().splitlines()]
            self.assertFalse(list(evidence.glob('simctl-hang-*')))
        self.assertEqual([(row['command'], row['processes'], row['runnable']) for row in rows],
                         [('observe', 250, 180), ('observe', None, None), ('observe', 260, 170)])
        self.assertEqual(sleeps, [push.OBSERVE_INTERVAL] * (push.OBSERVE_SAMPLES - 1))

    def test_boot_observes_after_bootstatus_and_before_the_warm_up_launch(self):
        order = []
        def simctl(evidence, step, args, **_):
            order.append(args[0])
            if args[0] == 'create':
                return self.DEVICE
            if args[0] == 'list' and 'devices' in args:
                return json.dumps({'devices': {'r': [{'udid': self.DEVICE, 'dataPath': '/data'}]}})
            return '{}'
        outputs = iter(['26.5', 'type runtime'])
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(push, 'simctl', side_effect=simctl), \
             mock.patch.object(push, 'observe', side_effect=lambda evidence, device: order.append(f'observe {device}')), \
             mock.patch.object(push.subprocess, 'check_output', side_effect=lambda *a, **k: next(outputs)):
            push.boot(Path(directory))
        self.assertEqual(order, ['list', 'create', 'list', 'boot', 'bootstatus', f'observe {self.DEVICE}', 'launch', 'terminate'])

    def run_warm_up(self, hang=(), error=()):
        """warm_up with simctl stubbed: `hang` commands raise SimctlHang, `error` ones exit 1."""
        calls = []
        def simctl(evidence, step, args, *, timeout, check=True, **_):
            calls.append((step, args[0], args[-1], timeout, check))
            if args[0] in hang:
                raise push.SimctlHang(f'simctl {args[0]} did not return within {timeout}s during {step}')
            if args[0] in error and check:
                raise subprocess.CalledProcessError(1, ['xcrun', 'simctl', *args])
            return ''
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(push, 'simctl', side_effect=simctl), \
             contextlib.redirect_stdout(out):
            push.warm_up(Path(directory), self.DEVICE)
        return calls, out.getvalue()

    def test_warm_up_launches_and_terminates_preferences_with_unchanged_limits(self):
        calls, out = self.run_warm_up()
        self.assertEqual(calls, [('warm-up', 'launch', 'com.apple.Preferences', 60, True),
                                 ('warm-up', 'terminate', 'com.apple.Preferences', 30, False)])
        self.assertIn('Simulator booted and warmed up.', out)
        self.assertNotIn('::warning::', out)

    def test_a_hung_warm_up_is_a_warning_and_the_xcuitest_still_decides(self):
        # Runs 44998769449, 45007325327, 45009736395: launch hit 60 s and Preferences never started.
        for hang in (('launch',), ('terminate',), ('launch', 'terminate')):
            with self.subTest(hang=hang):
                calls, out = self.run_warm_up(hang=hang)
                self.assertEqual([c[1] for c in calls], ['launch', 'terminate'])
                self.assertEqual(out.count('::warning::warm-up: simctl '), len(hang))
                self.assertIn('the XCUITest runs and decides the job', out)
                self.assertIn('warm-up did not finish', out)

    def test_a_warm_up_launch_that_returns_an_error_still_fails(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_warm_up(error=('launch',))
        calls, _ = self.run_warm_up(error=('terminate',))  # terminate keeps check=False
        self.assertEqual([c[1] for c in calls], ['launch', 'terminate'])

    def test_a_hung_bootstatus_still_fails_boot_before_the_warm_up(self):
        def simctl(evidence, step, args, **_):
            if args[0] == 'bootstatus':
                raise push.SimctlHang('simctl bootstatus did not return within 240s during boot')
            if args[0] == 'create':
                return self.DEVICE
            if args[0] == 'list' and 'devices' in args:
                return json.dumps({'devices': {'r': [{'udid': self.DEVICE, 'dataPath': '/data'}]}})
            return '{}'
        outputs = iter(['26.5', 'type runtime'])
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(push, 'simctl', side_effect=simctl), \
             mock.patch.object(push, 'warm_up') as warm, \
             mock.patch.object(push.subprocess, 'check_output', side_effect=lambda *a, **k: next(outputs)):
            with self.assertRaises(push.SimctlHang):
                push.boot(Path(directory))
        warm.assert_not_called()

    def test_cleanup_without_a_created_simulator_calls_nothing(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(push, 'simctl') as call:
            push.cleanup(Path(directory))
            call.assert_not_called()



class PrebootCache(unittest.TestCase):
    """The once-booted simulator cache (#4432): restore, adopt or fall back, and seed."""
    DEVICE = 'C0E7C600-E107-428F-8A03-DEDB01894AEF'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.evidence = base / 'evidence'; self.evidence.mkdir()
        self.devices = base / 'Devices'; self.devices.mkdir()
        self.seed = base / 'seed'
        patcher = mock.patch.object(push, 'devices_root', return_value=self.devices)
        patcher.start(); self.addCleanup(patcher.stop)

    def rows(self):
        path = self.evidence / 'simulator-steps.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def make_seed(self, schema=None, plist=True):
        source = Path(self.tmp.name) / 'source' / self.DEVICE
        (source / 'data').mkdir(parents=True)
        if plist:
            (source / 'device.plist').write_text('<plist/>')
        (source / 'data/marker').write_text('booted once')
        self.seed.mkdir()
        subprocess.run(['tar', '-C', str(source.parent), '-cf', str(self.seed / 'device.tar'), self.DEVICE], check=True)
        (self.seed / 'seed.json').write_text(json.dumps({'schema': schema or push.SEED_SCHEMA, 'device': self.DEVICE}))

    def test_restore_without_a_cache_records_a_miss_and_leaves_no_state(self):
        push.restore(self.evidence, self.seed)
        self.assertEqual([(r['command'], r['outcome']) for r in self.rows()], [('cache', 'miss')])
        self.assertIsNone(push.load_state(self.evidence))

    def test_restore_unpacks_the_device_into_the_device_set(self):
        self.make_seed()
        push.restore(self.evidence, self.seed)
        self.assertEqual((self.devices / self.DEVICE / 'data/marker').read_text(), 'booted once')
        row = self.rows()[-1]
        self.assertEqual((row['outcome'], row['device']), ('restored', self.DEVICE))
        self.assertIn('service_running_before', row)
        self.assertEqual(push.load_state(self.evidence), {'restored': self.DEVICE})

    def test_restore_rejects_unknown_schema_existing_folder_and_incomplete_archive(self):
        cases = {'unknown seed schema': dict(schema='other/1'), 'device folder already exists': {}, 'tar exit 0': dict(plist=False)}
        for reason, options in cases.items():
            with self.subTest(reason=reason):
                shutil.rmtree(self.seed, ignore_errors=True); shutil.rmtree(Path(self.tmp.name) / 'source', ignore_errors=True)
                for child in self.devices.iterdir(): shutil.rmtree(child)
                (self.evidence / 'simulator-steps.jsonl').unlink(missing_ok=True)
                self.make_seed(**options)
                if reason == 'device folder already exists':
                    (self.devices / self.DEVICE).mkdir()
                push.restore(self.evidence, self.seed)
                row = self.rows()[-1]
                self.assertEqual((row['outcome'], row['reason']), ('rejected', reason))
                self.assertIsNone(push.load_state(self.evidence))
                if reason == 'tar exit 0':
                    self.assertFalse((self.devices / self.DEVICE).exists())

    def run_boot(self, listed):
        """Run boot with a restored device; `listed` is the row CoreSimulatorService reports, or None."""
        push.state_path(self.evidence).write_text(json.dumps({'restored': self.DEVICE}))
        (self.devices / self.DEVICE).mkdir()
        calls = []
        def simctl(evidence, step, args, **_):
            calls.append(args[0] if args[0] != 'list' else 'list devices')
            if args[0] == 'list':
                return json.dumps({'devices': {'r': [listed] if listed else []}})
            return ''
        def create(evidence, step):
            calls.append('create')
            push.state_path(evidence).write_text(json.dumps({'device': 'NEW', 'data': '/new'}))
            return 'NEW', 'type', 'runtime'
        with mock.patch.object(push, 'simctl', side_effect=simctl), mock.patch.object(push, 'create_device', side_effect=create), \
             mock.patch.object(push, 'observe', side_effect=lambda evidence, device: calls.append(f'observe {device}')):
            push.boot(self.evidence)
        return calls

    def row(self, **changes):
        value = {'udid': self.DEVICE, 'state': 'Shutdown', 'isAvailable': True, 'dataPath': '/restored'}
        value.update(changes); return value

    def test_boot_adopts_a_restored_device_the_service_lists_as_shut_down(self):
        calls = self.run_boot(self.row())
        self.assertEqual(calls, ['list devices', 'boot', 'bootstatus', f'observe {self.DEVICE}', 'launch', 'terminate'])
        self.assertEqual(push.load_state(self.evidence), {'device': self.DEVICE, 'data': '/restored', 'restored': self.DEVICE})
        self.assertEqual(self.rows()[-1]['outcome'], 'accepted')

    def test_boot_falls_back_to_a_new_device_when_the_restored_one_is_not_usable(self):
        cases = {'not listed by CoreSimulatorService': (None, ['list devices', 'create']),
                 'listed but unavailable: runtime missing': (self.row(isAvailable=False, availabilityError='runtime missing'), ['list devices', 'delete', 'create']),
                 'listed in state Booted': (self.row(state='Booted'), ['list devices', 'delete', 'create'])}
        for reason, (listed, before_boot) in cases.items():
            with self.subTest(reason=reason):
                for child in self.devices.iterdir(): shutil.rmtree(child)
                (self.evidence / 'simulator-steps.jsonl').unlink(missing_ok=True)
                calls = self.run_boot(listed)
                self.assertEqual(calls, before_boot + ['boot', 'bootstatus', 'observe NEW', 'launch', 'terminate'])
                self.assertEqual([(r['outcome'], r['reason']) for r in self.rows()], [('rejected', reason)])
                self.assertEqual(push.load_state(self.evidence)['device'], 'NEW')
                if listed is None:
                    self.assertFalse((self.devices / self.DEVICE).exists())

    def run_seed(self, settle):
        folder = self.devices / self.DEVICE
        def create(evidence, step):
            (folder / 'data').mkdir(parents=True); (folder / 'device.plist').write_text('<plist/>')
            push.state_path(evidence).write_text(json.dumps({'device': self.DEVICE, 'data': str(folder / 'data')}))
            return self.DEVICE, 'iPhone', 'iOS-26-5'
        calls = []
        with mock.patch.object(push, 'create_device', side_effect=create), \
             mock.patch.object(push, 'simctl', side_effect=lambda evidence, step, args, **_: calls.append(args[0]) or ''), \
             mock.patch.object(push, 'wait_settled', side_effect=settle), \
             mock.patch.object(push, 'speech_probe', side_effect=lambda evidence, device: calls.append(f'speech-probe {device}') or {'outcome': 'exit 0', 'call_milliseconds': 87}):
            push.seed(self.evidence, self.seed)
        return calls

    def test_seed_archives_a_settled_shut_down_device_and_cleans_up(self):
        calls = self.run_seed(lambda evidence, device: (321.0, (240, 2)))
        # The probe runs on the settled, still booted device, before it is shut down and archived.
        self.assertEqual(calls, ['boot', 'bootstatus', f'speech-probe {self.DEVICE}', 'shutdown', 'shutdown', 'delete'])
        meta = json.loads((self.seed / 'seed.json').read_text())
        self.assertEqual(meta['speech_probe'], {'outcome': 'exit 0', 'call_milliseconds': 87})
        self.assertEqual((meta['schema'], meta['device'], meta['settle_seconds'], meta['settled_runnable']), (push.SEED_SCHEMA, self.DEVICE, 321.0, 2))
        self.assertEqual(meta['archive_bytes'], (self.seed / 'device.tar').stat().st_size)
        listing = subprocess.run(['tar', '-tf', str(self.seed / 'device.tar')], capture_output=True, text=True, check=True).stdout
        self.assertIn(f'{self.DEVICE}/device.plist', listing)
        self.assertFalse((self.seed / 'device.tar.partial').exists())

    def test_seed_that_never_settles_saves_nothing_and_still_cleans_up(self):
        def never(evidence, device):
            raise push.SimctlHang('seed simulator first-boot work did not settle within 900s')
        with self.assertRaises(push.SimctlHang):
            calls = self.run_seed(never)
        self.assertFalse((self.seed / 'seed.json').exists())
        self.assertFalse((self.seed / 'device.tar').exists())
        self.assertIsNone(push.load_state(self.evidence))

    def fake_xcrun(self, spawn, build='touch "$out"'):
        """An xcrun that answers the SDK version, builds by `build` and runs `simctl spawn` by `spawn`."""
        path = Path(self.tmp.name) / 'xcrun'
        log = Path(self.tmp.name) / 'xcrun.log'
        path.write_text('#!/bin/bash\n'
                        f'echo "$*" >> "{log}"\n'
                        'if [ "$3" = --show-sdk-version ]; then echo 26.5; exit 0; fi\n'
                        'if [ "$3" = swiftc ]; then out="${@: -1}"; ' + build + '; exit $?; fi\n'
                        'if [ "$1 $2" = "simctl spawn" ]; then ' + spawn + '; fi\n')
        path.chmod(0o755)
        return str(path), log

    def probe(self, spawn, build='touch "$out"', limit=5):
        xcrun, log = self.fake_xcrun(spawn, build)
        diagnosed = []
        with mock.patch.object(push, 'diagnose', side_effect=lambda evidence, step, pid, label='': diagnosed.append((step, label))):
            started = time.monotonic()
            result = push.speech_probe(self.evidence, self.DEVICE, build_limit=5, limit=limit, xcrun=xcrun)
            elapsed = time.monotonic() - started
        return result, log.read_text(), diagnosed, elapsed

    def test_speech_probe_records_the_call_on_the_settled_device(self):
        reply = '{"ko_KR":[{"identifier":"com.apple.voice.compact.ko-KR.Yuna","quality":1}],"milliseconds":87,"voices":68}'
        result, log, diagnosed, _ = self.probe(f"echo 'probe log line'; echo '{reply}'")
        self.assertEqual(result, {'outcome': 'exit 0', 'seconds': result['seconds'], 'call_milliseconds': 87, 'voices': 68})
        build, probe = [r for r in self.rows() if r['command'].startswith('speech-probe')]
        self.assertEqual((build['command'], build['outcome'], build['limit']), ('speech-probe-build', 'exit 0', 5))
        self.assertEqual((probe['outcome'], probe['voices'], probe['ko_KR'][0]['quality']), ('exit 0', 68, 1))
        self.assertIn('daemons_before', probe); self.assertIn('daemons_after', probe)
        self.assertIn(f'-target {os.uname().machine}-apple-ios26.5-simulator', log)
        self.assertIn(f'simctl spawn {self.DEVICE} {self.evidence / "ios-speech-probe"}', log)
        self.assertEqual(diagnosed, [])

    def test_speech_probe_that_does_not_build_is_recorded_and_never_spawned(self):
        result, log, _, _ = self.probe('echo spawned', build='echo "error: no such module" >&2; false')
        self.assertEqual(result, {'outcome': 'build exit 1'})
        self.assertEqual([(r['command'], r['outcome']) for r in self.rows()], [('speech-probe-build', 'exit 1')])
        self.assertIn('no such module', self.rows()[0]['detail'])
        self.assertNotIn('simctl spawn', log)

    def test_speech_probe_that_does_not_return_stops_at_its_own_bound_and_never_raises(self):
        result, _, diagnosed, elapsed = self.probe('sleep 30', limit=1)
        self.assertEqual(result['outcome'], 'timeout')
        self.assertLess(elapsed, 15)
        row = self.rows()[-1]
        self.assertEqual((row['command'], row['outcome'], row['limit']), ('speech-probe', 'timeout', 1))
        self.assertIn('daemons_at_limit', row)
        self.assertEqual(diagnosed, [('speech-probe', 'speech probe')])

    def test_speech_probe_error_is_a_row_not_a_failed_seed(self):
        result = push.speech_probe(self.evidence, self.DEVICE, xcrun=str(Path(self.tmp.name) / 'missing-xcrun'))
        self.assertEqual(result['outcome'], 'error')
        self.assertEqual(self.rows()[-1]['outcome'], 'error')

    def seed_ps(self, runnable, cpu_busy='9.0'):
        """A CPU-sorted PS_TABLE: one busy host process, the device's launchd_sim and 3 device children."""
        lines = ['  PID  PPID STAT ELAPSED  %CPU %MEM COMMAND',
                 f'  900     1 R       10:00 {cpu_busy}  1.0 /usr/libexec/hostbusy',
                 f' 4820     1 S       04:00  0.4  0.2 launchd_sim /Users/runner/Library/Developer/CoreSimulator/Devices/{self.DEVICE}/data/var/run/launchd_bootstrap.plist']
        for index in range(3):
            stat = 'Rs' if index < runnable else 'Ss'
            lines.append(f' {5000 + index}  4820 {stat}      03:00  0.0  0.1 /RuntimeRoot/usr/libexec/{"sirittsd" if index == 0 else f"d{index}"}')
        return '\n'.join(lines) + '\n'

    def test_seed_wait_writes_tables_about_once_a_minute_and_at_the_end(self):
        tables = iter([self.seed_ps(3), self.seed_ps(3), self.seed_ps(2), self.seed_ps(0), self.seed_ps(0), self.seed_ps(0)])
        # Readings at 0, 30, 61, 90, 125 and 130 s: the clock moves only when the seed sleeps.
        now, steps = [0], iter([30, 31, 29, 35, 5])
        with mock.patch.object(push, 'bounded', side_effect=lambda args, limit=30: next(tables)), \
             mock.patch.object(push.time, 'monotonic', side_effect=lambda: now[0]), \
             mock.patch.object(push.time, 'sleep', side_effect=lambda _: now.__setitem__(0, now[0] + next(steps))), \
             mock.patch.object(push.os, 'cpu_count', return_value=1):
            seconds, activity = push.wait_settled(self.evidence, self.DEVICE, limit=900, interval=5, table_every=60)
        self.assertEqual((seconds, activity), (130, (3, 0)))
        observe = [r for r in self.rows() if r['command'] == 'observe']
        self.assertEqual([(r['processes'], r['runnable']) for r in observe], [(3, 3), (3, 3), (3, 2), (3, 0), (3, 0), (3, 0)])
        self.assertEqual(observe[0]['daemons']['sirittsd'], [{'stat': 'Rs', 'etime': '03:00', 'cpu': 0.0}])
        ps = (self.evidence / 'simulator-ps.txt').read_text()
        # The first reading, each first one at least 60 s after the last table (61 s, 125 s), and the settled one.
        self.assertEqual(re.findall(r'^== seed sample (\d+) ', ps, re.M), ['1', '3', '5', '6'])
        self.assertIn('hostbusy', ps)
        self.assertEqual(re.findall(r'^-- runnable device processes: (\d+)$', ps, re.M), ['3', '2', '0', '0'])
        first = ps.split('== seed sample 3 ')[0]
        self.assertNotIn('/usr/libexec/hostbusy', first.split('-- runnable')[1])
        self.assertIn('/RuntimeRoot/usr/libexec/sirittsd', first.split('-- runnable')[1])

    def test_settle_rule_used_by_the_seed(self):
        self.assertTrue(push.is_settled([(200, 9), (207, 1), (207, 3), (207, 0)], cpus=3))
        self.assertFalse(push.is_settled([(207, 0), (207, 0)], cpus=3))
        self.assertFalse(push.is_settled([(205, 0), (206, 0), (207, 0)], cpus=3))
        self.assertFalse(push.is_settled([(207, 0), (207, 4), (207, 0)], cpus=3))
        self.assertFalse(push.is_settled([(207, 0), None, (207, 0)], cpus=3))

    def test_cache_key_names_the_runner_image_and_xcode(self):
        environ = {'ImageOS': 'macos26', 'ImageVersion': '20261115.1', 'DEVELOPER_DIR': '/Applications/Xcode_26.5.app/Contents/Developer'}
        key = push.cache_key(environ)
        self.assertTrue(key.startswith('ios-sim-preboot-v1-macos26-20261115.1-'), key)
        self.assertIn('-Xcode_26.5.app-', key)
        self.assertNotEqual(key, push.cache_key({**environ, 'ImageVersion': '20261122.1'}))

    @staticmethod
    def job_block(text, name):
        """The lines of one top-level job; the contract job runs without PyYAML, so this reads text."""
        lines = text.splitlines()
        first = lines.index(f'  {name}:')
        rest = next((i for i in range(first + 1, len(lines)) if re.match(r'^  [A-Za-z0-9_-]+:$', lines[i])), len(lines))
        return '\n'.join(lines[first:rest])

    def test_workflow_restores_before_any_simctl_or_build_and_seeds_only_off_pull_requests(self):
        text = (ROOT / '.github/workflows/studio-native-mobile.yml').read_text()
        push_job, seed_job = self.job_block(text, 'approval-push-simulator'), self.job_block(text, 'ios-sim-seed')
        self.assertLess(push_job.index('verify-approval-push-simulator.py restore'), push_job.index('verify-approval-push-simulator.py build'))
        self.assertLess(push_job.index('actions/cache/restore@'), push_job.index('verify-approval-push-simulator.py restore'))
        self.assertIn("    if: github.event_name != 'pull_request'\n", seed_job + '\n')
        # Same runner, Xcode, key command and path, so the seed's entry is the one the push job asks for.
        for line in ('    runs-on: macos-26', '      DEVELOPER_DIR: /Applications/Xcode_26.5.app/Contents/Developer',
                     '        run: python3 apps/studio-native/scripts/verify-approval-push-simulator.py cache-key',
                     '          path: ${{ runner.temp }}/ios-sim-preboot', '          key: ${{ steps.preboot.outputs.key }}'):
            with self.subTest(line=line):
                self.assertIn(line, push_job.splitlines()); self.assertIn(line, seed_job.splitlines())
        self.assertIn('lookup-only: true', seed_job)
        # The seed's process tables and hang files go up with its rows.
        for path in ('sim-seed-run/simulator-steps.jsonl', 'sim-seed-run/simctl-hang-*.txt', 'sim-seed-run/simulator-ps.txt'):
            self.assertIn(f'apps/studio-native/evidence/{path}', seed_job)
        self.assertNotIn('ios-sim-seed', self.job_block(text, 'acceptance'))


if __name__ == '__main__':
    unittest.main()
