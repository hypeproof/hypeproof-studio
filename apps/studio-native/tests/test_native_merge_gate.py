"""Real Git/CLI and workflow-shell controls; no native build, provider or GitHub call."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = 'apps/studio-native/scripts/native-merge-gate.py'
IDENTITY = 'apps/studio-native/scripts/verify-native-candidate.py'
WORKFLOW = '.github/workflows/studio-native-mobile.yml'
NATIVE = 'apps/studio-native/ios/App/Example.swift'
DESKTOP = 'extensions/hypeproof-chat/webview-ui/src/App.tsx'


def shell_step(name):
    lines = (ROOT / WORKFLOW).read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == '- name: ' + name)
    start = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == 'run: |') + 1
    end = start
    while end < len(lines) and (not lines[end].strip() or lines[end].startswith('          ')): end += 1
    return textwrap.dedent('\n'.join(lines[start:end]))


class GitFixture:
    def __init__(self, root, bootstrap=False):
        self.root = root; self.repo = root / 'repo'; self.repo.mkdir()
        self.temp = root / 'runner'; self.temp.mkdir()
        self.git('init', '-q', '-b', 'main')
        for key, value in [('user.name', 'Synthetic native gate'), ('user.email', 'fixture@example.invalid'),
                           ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]: self.git('config', key, value)
        for p in (IDENTITY, WORKFLOW): self.write(p, (ROOT / p).read_bytes())
        if not bootstrap: self.write(SCRIPT, (ROOT / SCRIPT).read_bytes())
        self.write(NATIVE, 'native baseline\n'); self.write(DESKTOP, 'desktop baseline\n')
        self.commit('base'); self.base = self.git('rev-parse', 'HEAD').strip()
        self.trusted = self.temp / 'native-merge-control'; self.trusted.mkdir()
        for p in (IDENTITY,) if bootstrap else (IDENTITY, SCRIPT):
            (self.trusted / Path(p).name).write_bytes(self.git_bytes('show', self.base + ':' + p))
        self.receipt = self.temp / 'native-merge-scope.json'
        self.candidate = self.temp / 'native-candidate.json'
        self.output = self.temp / 'acceptance.json'

    def git_bytes(self, *args):
        r = subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True)
        if r.returncode: raise AssertionError(r.stderr.decode())
        return r.stdout
    def git(self, *args): return self.git_bytes(*args).decode()
    def write(self, path, content):
        p = self.repo / path; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content if isinstance(content, bytes) else content.encode())
    def commit(self, message): self.git('add', '-A'); self.git('commit', '-qm', message)
    def merge(self, edits):
        self.git('checkout', '-qb', 'feature', self.base)
        for p, v in edits.items():
            if v is None: (self.repo / p).unlink()
            else: self.write(p, v)
        self.commit('candidate'); self.head = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', 'main'); self.git('merge', '--no-ff', '-qm', 'tested merge', self.head)
        self.checkout = self.git('rev-parse', 'HEAD').strip()
    def env(self):
        return dict(os.environ, RUNNER_TEMP=str(self.temp), GITHUB_OUTPUT=str(self.temp / 'output'),
                    GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='2', NATIVE_EVENT='pull_request',
                    NATIVE_BASE=self.base, NATIVE_HEAD=self.head, NATIVE_CHECKOUT=self.checkout)
    def states(self, **changes): return dict(scope='success', contract='success', ios='success', android='success', **changes)
    def cli(self, command, *, states=None, candidate=True, attempt=2, event='pull_request', base=None):
        args = ['python3', str(self.trusted / Path(SCRIPT).name), command, '--repo', str(self.repo),
                '--event', event, '--base', base or self.base, '--head', self.head, '--checkout', self.checkout,
                '--run-id', '123', '--attempt', str(attempt), '--receipt', str(self.receipt),
                '--output', str(self.receipt if command == 'scope' else self.output)]
        if command == 'verify':
            args += ['--results', json.dumps(self.states() if states is None else states)]
            if candidate: args += ['--candidate', str(self.candidate)]
        env = self.env(); env.pop('GITHUB_OUTPUT', None)
        return subprocess.run(args, cwd=self.repo, env=env, capture_output=True, text=True)
    def scope(self, **kwargs):
        r = self.cli('scope', **kwargs)
        if r.returncode: raise AssertionError(r.stderr)
        return json.loads(self.receipt.read_text())
    def candidate_identity(self):
        spec = importlib.util.spec_from_file_location('fixture_identity', self.trusted / Path(IDENTITY).name)
        identity = importlib.util.module_from_spec(spec); spec.loader.exec_module(identity)
        document = identity.identity_document(identity.source_identity(self.repo), self.head, 123, 2)
        self.candidate.write_text(json.dumps(document)); return document
    def workflow(self, name, **values):
        env = self.env(); env.update(NATIVE_SELECTED='true', NATIVE_RESULTS=json.dumps(self.states())); env.update(values)
        return subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', shell_step(name)], cwd=self.repo, env=env, capture_output=True, text=True)
    def download(self, selected=True):
        d = self.temp / 'native-merge-scope'; d.mkdir(exist_ok=True); shutil.copyfile(self.receipt, d / self.receipt.name)
        if selected:
            d = self.temp / 'native-merge-candidate'; d.mkdir(exist_ok=True); shutil.copyfile(self.candidate, d / self.candidate.name)


class NativeMergeGate(unittest.TestCase):
    def setUp(self): self.tmp = tempfile.TemporaryDirectory(); self.r = GitFixture(Path(self.tmp.name))
    def tearDown(self): self.tmp.cleanup()

    def test_native_success_executes_actual_workflow_join_with_current_identity(self):
        self.r.merge({NATIVE: 'native change\n'})
        run = self.r.workflow('Classify native scope from trusted base'); self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('run_native=true', (self.r.temp / 'output').read_text())
        self.r.candidate_identity(); self.r.download()
        run = self.r.workflow('Verify exact native scope and existing job results'); self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads((self.r.temp / 'native-merge-acceptance.json').read_text())
        self.assertEqual(result['native_execution'], 'PASS')
        self.assertEqual(result['scope']['checkout_sha'], self.r.checkout)
        self.assertEqual(result['scope']['source_head_sha'], self.r.head)
        self.assertNotEqual(self.r.head, self.r.checkout)
        self.assertEqual(result['release_authorization'], 'NOT_GRANTED')

    def test_proven_unrelated_skips_all_native_jobs_but_cannot_authorize_testflight(self):
        self.r.merge({DESKTOP: 'desktop change\n'})
        run = self.r.workflow('Classify native scope from trusted base'); self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('run_native=false', (self.r.temp / 'output').read_text()); self.r.download(False)
        states = dict(scope='success', contract='skipped', ios='skipped', android='skipped')
        run = self.r.workflow('Verify exact native scope and existing job results', NATIVE_SELECTED='false', NATIVE_RESULTS=json.dumps(states))
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads((self.r.temp / 'native-merge-acceptance.json').read_text()); self.assertEqual(result['native_execution'], 'NOT_RUN')
        spec = importlib.util.spec_from_file_location('release_gate', ROOT / IDENTITY)
        gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
        with self.assertRaises(gate.Refused): gate.verify_identity(result, gate.source_identity(self.r.repo), dict(head_sha=self.r.head, id=123, run_attempt=2))
        with self.assertRaises(gate.Refused): gate.select_artifact({'artifacts': []}, dict(id=123, run_attempt=2, head_sha=self.r.head))

    def test_native_pending_failure_cancellation_skipped_or_missing_never_pass(self):
        self.r.merge({NATIVE: 'change\n'}); self.r.scope(); self.r.candidate_identity()
        for job in ('scope', 'contract', 'ios', 'android'):
            for state in ('in_progress', 'queued', 'failure', 'cancelled', 'skipped', ''):
                with self.subTest(job=job, state=state):
                    states = self.r.states(); states[job] = state
                    self.assertNotEqual(self.r.cli('verify', states=states).returncode, 0)
        for job in ('scope', 'contract', 'ios', 'android'):
            missing = self.r.states(); del missing[job]
            self.assertNotEqual(self.r.cli('verify', states=missing).returncode, 0)
        self.r.candidate.unlink(); self.assertNotEqual(self.r.cli('verify').returncode, 0)

    def test_older_head_checkout_tree_or_run_attempt_cannot_supply_success(self):
        self.r.merge({NATIVE: 'change\n'}); self.r.scope(); document = self.r.candidate_identity()
        for key, value in [('source_head_sha', self.r.base), ('checkout_sha', self.r.head), ('native_tree', 'a' * 40), ('native_workflow', 'b' * 40), ('run_id', 124), ('run_attempt', 1)]:
            with self.subTest(field=key):
                self.r.candidate.write_text(json.dumps({**document, key: value})); self.assertNotEqual(self.r.cli('verify').returncode, 0)
        self.r.candidate.write_text(json.dumps(document)); self.assertNotEqual(self.r.cli('verify', attempt=3).returncode, 0)

    def test_scope_receipt_tamper_and_contradictory_execution_refused(self):
        self.r.merge({DESKTOP: 'change\n'}); original = self.r.scope()
        skipped = dict(scope='success', contract='skipped', ios='skipped', android='skipped')
        for key in ('decision', 'base_sha', 'source_head_sha', 'path_digest', 'classifier_blob', 'identity_blob'):
            with self.subTest(field=key):
                self.r.receipt.write_text(json.dumps({**original, key: 'forged'}))
                self.assertNotEqual(self.r.cli('verify', candidate=False, states=skipped).returncode, 0)
        self.r.receipt.write_text(json.dumps(original)); self.assertNotEqual(self.r.cli('verify', candidate=False).returncode, 0)
        self.r.receipt.unlink(); self.assertNotEqual(self.r.cli('verify', candidate=False, states=skipped).returncode, 0)

    def test_any_native_input_mixed_with_other_changes_keeps_full_native(self):
        # D3 (JY 2026-11-24): the native inputs are the app, its control scripts and workflows, and
        # the release casebook files the contract job's tests read. One of them in a mixed diff is FULL.
        for path in (NATIVE, SCRIPT, IDENTITY, WORKFLOW, '.github/workflows/studio-apple-testflight.yml',
                     '.github/workflows/release-cut.yml', '.github/workflows/verify-unified-release.yml',
                     'config/release-auto.json', 'config/release-platforms.json', 'scripts/release/select-cases.mjs',
                     'docs/operations/release-casebook/cases.yaml', 'apps/studio-native/android/app/build.gradle'):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as t:
                r = GitFixture(Path(t)); r.merge({path: 'changed\n', DESKTOP: 'changed desktop\n'})
                result = r.scope(); self.assertEqual((result['decision'], result['reason']), ('FULL', 'native_input_changed'))

    def test_known_answers_docs_chalk_app_and_workflow_pull_requests(self):
        # Before D3, the docs, Chalk, shared-metadata and other-workflow cases were FULL: only audited
        # desktop paths were excluded. None of them is read by the native app, its tests or the
        # contract job (counted on main 75f7c192), so they are now NOT_APPLICABLE.
        cases = [
            ('docs only', {'docs/unaudited.md': 'doc\n', 'docs/testing/other.md': 'doc\n'}, 'NOT_APPLICABLE'),
            ('Chalk only', {'chalk/src/index.ts': 'chalk\n', 'extensions/hypeproof-chat/src/chalk/x.ts': 'chalk\n'}, 'NOT_APPLICABLE'),
            ('desktop only', {DESKTOP: 'desktop\n'}, 'NOT_APPLICABLE'),
            ('shared metadata', {'config/traceability.json': '{}\n', 'package-lock.json': '{}\n', 'package.json': '{}\n'}, 'NOT_APPLICABLE'),
            ('another workflow', {'.github/workflows/pr-ci.yml': 'name: x\n'}, 'NOT_APPLICABLE'),
            ('app', {NATIVE: 'app\n'}, 'FULL'),
            ('app beside docs', {NATIVE: 'app\n', 'docs/unaudited.md': 'doc\n'}, 'FULL'),
            ('native workflow', {WORKFLOW: 'name: x\n'}, 'FULL'),
            ('TestFlight workflow', {'.github/workflows/studio-apple-testflight.yml': 'name: x\n'}, 'FULL'),
        ]
        for name, edits, decision in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as t:
                r = GitFixture(Path(t)); r.merge(edits); self.assertEqual(r.scope()['decision'], decision)

    def test_complete_diff_cannot_hide_native_change_behind_last_desktop_commit(self):
        self.r.git('checkout', '-qb', 'candidate', self.r.base)
        self.r.write(NATIVE, 'native first\n'); self.r.commit('native')
        self.r.write(DESKTOP, 'desktop last\n'); self.r.commit('desktop'); self.r.head = self.r.git('rev-parse', 'HEAD').strip()
        self.r.git('checkout', '-q', 'main'); self.r.git('merge', '--no-ff', '-qm', 'merge', self.r.head); self.r.checkout = self.r.git('rev-parse', 'HEAD').strip()
        result = self.r.scope(); self.assertEqual(result['decision'], 'FULL'); self.assertIn(NATIVE, [r['path'] for r in result['changes']])

    def test_missing_base_objects_and_main_never_exempt_native(self):
        self.r.merge({DESKTOP: 'change\n'})
        self.assertEqual(self.r.scope(base='0' * 40)['decision'], 'FULL')
        self.assertEqual(self.r.scope(event='push')['decision'], 'FULL')

    def test_native_deletion_move_and_special_files_are_not_exclusions(self):
        # A native file deleted or moved out of the app is a native change. Before D3 a desktop
        # deletion was FULL too; it reads no native input, so it is now NOT_APPLICABLE.
        for name, edits, decision in [('native deleted', {NATIVE: None}, 'FULL'),
                                      ('native moved out', {NATIVE: None, 'docs/moved.swift': 'native baseline\n'}, 'FULL'),
                                      ('desktop deleted', {DESKTOP: None, 'docs/moved.tsx': 'moved\n'}, 'NOT_APPLICABLE')]:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as t:
                r = GitFixture(Path(t)); r.merge(edits); self.assertEqual(r.scope()['decision'], decision)
        # A symlink outside the native inputs keeps full native, even one that names no native path.
        for target in ('apps/studio-native/ios/App', 'docs'):
            with self.subTest(symlink=target), tempfile.TemporaryDirectory() as t:
                r = GitFixture(Path(t)); r.git('checkout', '-qb', 'feature', r.base)
                (r.repo / 'link').symlink_to(target); r.commit('symlink'); r.head = r.git('rev-parse', 'HEAD').strip()
                r.git('checkout', '-q', 'main'); r.git('merge', '--no-ff', '-qm', 'tested merge', r.head)
                r.checkout = r.git('rev-parse', 'HEAD').strip()
                result = r.scope(); self.assertEqual((result['decision'], result['reason']), ('FULL', 'special_file_outside_native_inputs'))

    def test_approval_push_job_follows_the_same_scope(self):
        lines = (ROOT / WORKFLOW).read_text().splitlines()
        start = lines.index('  approval-push-simulator:')
        end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith('  ') and not lines[i].startswith('   ') and lines[i].endswith(':'))
        job = lines[start:end]
        self.assertIn('    needs: scope', job)
        condition = next(line for line in job if line.startswith('    if: '))
        for part in ("github.event_name == 'pull_request'", "needs.scope.result == 'success'", "needs.scope.outputs.run_native != 'false'"):
            self.assertIn(part, condition)

    def test_first_adoption_workflow_requires_all_three_jobs_and_current_receipt(self):
        with tempfile.TemporaryDirectory() as t:
            r = GitFixture(Path(t), bootstrap=True); r.merge({DESKTOP: 'change\n'})
            run = r.workflow('Classify native scope from trusted base'); self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('run_native=true', (r.temp / 'output').read_text()); r.candidate_identity(); r.download()
            run = r.workflow('Verify exact native scope and existing job results'); self.assertEqual(run.returncode, 0, run.stderr)
            for state in ('in_progress', 'failure', 'cancelled', 'skipped'):
                results = r.states(); results['ios'] = state
                self.assertNotEqual(r.workflow('Verify exact native scope and existing job results', NATIVE_RESULTS=json.dumps(results)).returncode, 0)


if __name__ == '__main__': unittest.main(verbosity=2)
