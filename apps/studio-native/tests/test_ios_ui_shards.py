"""iOS UI sharding: every case runs once, in its own shard, and the merged record says so.

Runs the real plan/merge code, the real ios-verify.sh shard mode (with Apple tools stubbed),
the real ios-collect.sh with the real journey collectors, and the approval push simctl hang
path. Planted defects (a missing shard, an unstarted case, a case in two shards, a failed
shard, an attachment collision) must each fail; a complete set must pass.
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


class WorkflowShardCount(unittest.TestCase):
    def test_planned_shard_count_equals_the_ui_matrix(self):
        workflow = (ROOT / '.github/workflows/studio-native-mobile.yml').read_text()
        planned = re.findall(r"^\s*IOS_UI_SHARDS: '([0-9]+)'$", workflow, re.M)
        matrix = re.findall(r'^\s*shard: \[([0-9, ]+)\]$', workflow, re.M)
        self.assertEqual(len(planned), 1)
        self.assertEqual(len(matrix), 1)
        self.assertEqual([int(x) for x in matrix[0].split(',')], list(range(1, int(planned[0]) + 1)))


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

    def run_shard(self, index, *, test_exit=0, products=1, bootstatus_exit=0):
        temp = tempfile.TemporaryDirectory(prefix='studio-ios-shard-'); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        scripts, ios, bin_dir, evidence = root / 'scripts', root / 'ios', root / 'bin', root / 'evidence'
        for directory in (scripts, ios, bin_dir, evidence):
            directory.mkdir()
        for name in ('ios-verify.sh', 'select-ios-simulator.py', 'ios-ui-shards.py', 'ios-sim-observe.py',
                     'verify-approval-push-simulator.py'):
            shutil.copyfile(NATIVE / 'scripts' / name, scripts / name)
        built = ios / 'DerivedData/Build/Products'; built.mkdir(parents=True)
        for number in range(products):
            (built / f'HPStudio_iphonesimulator{number}.xctestrun').write_text('fixture')
        plan = shards.plan({'AlphaTests': ['testA', 'testB', 'testC', 'testD']}, 2)
        (evidence / 'ios-ui-shard-plan.json').write_text(json.dumps(plan))
        stub = cleanup_suite.COMMAND_STUB.replace('if "test" in args:', 'if "test" in args or "test-without-building" in args:')
        self.assertNotEqual(stub, cleanup_suite.COMMAND_STUB)
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
                   STUB_BOOTSTATUS_EXIT=str(bootstatus_exit))
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
                          ('warm-up', 'xcrun simctl launch', 'exit 0'), ('warm-up', 'xcrun simctl terminate', 'exit 0')])
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
        # The same simctl commands as before, and the only new waits are two fixed 5 s sleeps.
        boot = [c['args'] for c in commands if c['command'] == 'xcrun' and c['args'][:2] in (['simctl', 'boot'], ['simctl', 'bootstatus'], ['simctl', 'launch'], ['simctl', 'terminate'])]
        # Shard 1 also launches the app after the suite for its screenshot; that launch is not timed.
        self.assertEqual([a[:2] for a in boot[:4]], [['simctl', 'boot'], ['simctl', 'bootstatus'], ['simctl', 'launch'], ['simctl', 'terminate']])
        self.assertEqual(boot[1][-1], '-b')
        self.assertEqual([c['args'] for c in commands if c['command'] == 'sleep'][:2], [['5'], ['5']])

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

    def take(self, table):
        outputs = {'ps': table, 'vm_stat': 'Pages free:                               4298.\n', 'sysctl': '{ 353.66 142.08 64.21 }\n'}
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(observe.push, 'bounded', side_effect=lambda args, limit=30: outputs[args[0]]):
            evidence = Path(directory)
            observe.take(evidence, self.DEVICE, step='boot', sample=1, full_table=True)
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

class CollectShell(unittest.TestCase):
    """The real ios-collect.sh with the real journey and sign-in collectors."""

    def run_collect(self, *, build='success', ui='success', shard_changes=None, plan=True):
        temp = tempfile.TemporaryDirectory(prefix='studio-ios-collect-'); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        native = root / 'apps/studio-native'
        (native / 'scripts').mkdir(parents=True); (native / 'ios').mkdir(); (native / 'evidence').mkdir()
        for name in ('ios-collect.sh', 'ios-ui-shards.py', 'collect-native-journeys.py', 'collect-signin-journey.py'):
            shutil.copyfile(NATIVE / 'scripts' / name, native / 'scripts' / name)
        (native / 'evidence/device-build.log').write_text('** BUILD SUCCEEDED **\n')
        doc = shards.plan(shards.discover(NATIVE / 'ios/UITests'), 3)
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
                   IOS_BUILD_RESULT=build, IOS_UI_RESULT=ui, IOS_SHARD_ARTIFACTS=str(artifacts))
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
        self.assertEqual(sorted(p.name for p in (evidence / 'shards').iterdir()), ['shard-1', 'shard-2', 'shard-3'])

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
