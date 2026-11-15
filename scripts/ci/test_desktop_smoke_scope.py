#!/usr/bin/env python3
"""Exercise actual trusted-base CLI and workflow shells against complete Git merges."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = 'scripts/ci/desktop-smoke-scope.py'
POLICY = 'config/desktop-smoke-scope.json'
WORKFLOW = '.github/workflows/pr-ci.yml'
TRACE = 'config/traceability.json'
NATIVE = 'apps/studio-native/ios/App/Example.swift'
DESKTOP = 'extensions/hypeproof-chat/webview-ui/src/App.tsx'
DOC = 'docs/testing/native-mobile-growth.md'


def shell_step(name):
    lines = (ROOT / WORKFLOW).read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == '- name: ' + name)
    start = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == 'run: |') + 1
    end = start
    while end < len(lines) and (not lines[end].strip() or lines[end].startswith('          ')):
        end += 1
    return textwrap.dedent('\n'.join(lines[start:end]))


class Repository:
    def __init__(self, root, bootstrap=False):
        self.root = root
        self.repo = root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        self.git('config', 'user.name', 'Synthetic scope control')
        self.git('config', 'core.autocrlf', 'false')
        self.write(NATIVE, 'native baseline\n')
        self.write(DESKTOP, 'desktop baseline\n')
        self.write(DOC, 'native instructions\n')
        self.trace = dict(schema='test/1', nodes=[dict(id='ST-TEST-NATIVE-MOBILE', owner='existing', stage='test',
            depends_on=['existing-requirement'], sources=[{'path': NATIVE}, {'path': DESKTOP}])])
        self.write(TRACE, json.dumps(self.trace))
        if not bootstrap:
            self.write(SCRIPT, (ROOT / SCRIPT).read_bytes())
            self.write(POLICY, (ROOT / POLICY).read_bytes())
        self.commit('trusted base')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.temp = root / 'runner'; self.temp.mkdir()
        self.receipt = self.temp / 'desktop-smoke-scope.json'
        self.trusted = self.temp / 'desktop-smoke-scope.py'
        if not bootstrap:
            self.trusted.write_text(self.git('show', self.base + ':' + SCRIPT))

    def git(self, *args):
        r = subprocess.run(['git', '-C', str(self.repo), *args], text=True, capture_output=True)
        if r.returncode: raise AssertionError(r.stderr)
        return r.stdout

    def write(self, name, value):
        p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(value if isinstance(value, bytes) else value.encode())

    def commit(self, message):
        self.git('add', '-A'); self.git('commit', '-qm', message)

    def merge(self, edits):
        self.git('checkout', '-qb', 'feature', self.base)
        for path, value in edits.items():
            if value is None: (self.repo / path).unlink()
            else: self.write(path, value)
        self.commit('candidate')
        self.head = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', 'main')
        self.git('merge', '--no-ff', '-qm', 'actual tested merge', self.head)
        self.checkout = self.git('rev-parse', 'HEAD').strip()

    def cli(self, command, *args, event='pull_request', base=None, head=None):
        return subprocess.run(['python3', str(self.trusted), command, '--repo', str(self.repo),
            '--event', event, '--base', base or self.base, '--head', head or self.head,
            '--checkout', self.checkout, '--receipt', str(self.receipt), *args], text=True, capture_output=True)

    def classify(self, **kwargs):
        r = self.cli('classify', **kwargs)
        if r.returncode: raise AssertionError(r.stderr)
        return json.loads(self.receipt.read_text())

    def workflow(self, step, **values):
        env = dict(os.environ, RUNNER_TEMP=str(self.temp), GITHUB_OUTPUT=str(self.temp / 'output'),
                   SCOPE_EVENT='pull_request', SCOPE_BASE=self.base, SCOPE_HEAD=self.head,
                   SCOPE_CHECKOUT=self.checkout, SCOPE_RESULT='success', SHARDS='skipped')
        env.update(values)
        return subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', shell_step(step)],
                              cwd=self.repo, env=env, text=True, capture_output=True)

    def download_receipt(self):
        target = self.temp / 'desktop-smoke-scope'; target.mkdir(exist_ok=True)
        shutil.copyfile(self.receipt, target / self.receipt.name)


class ScopeControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.r = Repository(Path(self.tmp.name))
    def tearDown(self): self.tmp.cleanup()

    def verify(self, shards, scope='success', **kwargs):
        return self.r.cli('verify', '--scope-result', scope, '--shards', shards, **kwargs)

    def test_native_exclusion_and_real_workflow_aggregate(self):
        self.r.merge({NATIVE: 'native change\n'})
        run = self.r.workflow('Classify complete source diff with trusted base')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('run_smoke=false', (self.r.temp / 'output').read_text())
        self.r.download_receipt()
        run = self.r.workflow('Validate scope and every selected smoke shard')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn('NOT RUN', run.stdout)
        # Missing receipt must not turn the always-running aggregate green.
        (self.r.temp / 'desktop-smoke-scope' / self.r.receipt.name).unlink()
        self.assertNotEqual(self.r.workflow('Validate scope and every selected smoke shard').returncode, 0)

    def test_audited_docs_only(self):
        self.r.merge({DOC: 'updated native instructions\n'})
        self.assertEqual(self.r.classify()['decision'], 'NOT_APPLICABLE')
        self.assertEqual(self.verify('skipped').returncode, 0)

    def test_complete_diff_includes_an_earlier_desktop_commit(self):
        self.r.git('checkout', '-qb', 'intermediate', self.r.base)
        self.r.write(DESKTOP, 'earlier desktop change\n'); self.r.commit('not the last commit')
        earlier = self.r.git('rev-parse', 'HEAD').strip()
        self.r.write(NATIVE, 'last commit native only\n'); self.r.commit('native')
        self.r.head = self.r.git('rev-parse', 'HEAD').strip()
        self.r.git('checkout', '-q', 'main'); self.r.git('merge', '--no-ff', '-qm', 'merge', self.r.head)
        self.r.checkout = self.r.git('rev-parse', 'HEAD').strip()
        receipt = self.r.classify()
        self.assertEqual(receipt['decision'], 'FULL')
        self.assertIn(DESKTOP, [p['path'] for p in receipt['changes']])
        self.assertNotEqual(earlier, self.r.base)
        self.assertNotEqual(self.verify('skipped').returncode, 0)
        self.assertEqual(self.verify('success').returncode, 0)

    def test_unknown_mixed_infrastructure_manifest_and_self_exclusion_run_full(self):
        edits = [DESKTOP, 'docs/unaudited.md', 'scripts/shared.sh', 'package-lock.json',
                 'apps/studio-native/package.json', '.github/workflows/other.yml', SCRIPT, POLICY, WORKFLOW]
        for index, path in enumerate(edits):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as tmp:
                r = Repository(Path(tmp)); r.merge({path: 'changed candidate authority\n', NATIVE: 'changed\n'})
                self.assertEqual(r.classify()['decision'], 'FULL')

    def test_native_workflow_is_explicitly_audited(self):
        self.r.merge({'.github/workflows/studio-native-mobile.yml': 'native contract only\n'})
        self.assertEqual(self.r.classify()['decision'], 'NOT_APPLICABLE')

    def test_deletion_cross_scope_rename_and_symlink_run_full(self):
        for kind in ('delete', 'rename', 'symlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                r = Repository(Path(tmp))
                if kind == 'symlink':
                    r.git('checkout', '-qb', 'link', r.base)
                    (r.repo / NATIVE).unlink(); (r.repo / NATIVE).symlink_to('../../../../package.json')
                    r.commit('link'); r.head = r.git('rev-parse', 'HEAD').strip()
                    r.git('checkout', '-q', 'main'); r.git('merge', '--no-ff', '-qm', 'merge', r.head)
                    r.checkout = r.git('rev-parse', 'HEAD').strip()
                else: r.merge({NATIVE: None, **({DESKTOP: 'moved native\n'} if kind == 'rename' else {})})
                self.assertEqual(r.classify()['decision'], 'FULL')

    def test_native_evidence_links_can_extend_the_existing_shared_node(self):
        changed = copy.deepcopy(self.r.trace)
        changed['nodes'][0]['sources'].append({'path': 'apps/studio-native/tests/new.py'})
        self.r.merge({TRACE: json.dumps(changed), NATIVE: 'new native control\n'})
        self.assertEqual(self.r.classify()['decision'], 'NOT_APPLICABLE')

    def test_trace_shared_metadata_removal_schema_or_unsafe_links_run_full(self):
        for kind in ('owner', 'dependency', 'remove', 'shared', 'escape', 'schema', 'duplicate-key'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                r = Repository(Path(tmp)); changed = copy.deepcopy(r.trace)
                node = changed['nodes'][0]
                if kind == 'owner': node['owner'] = 'someone-else'
                elif kind == 'dependency': node['depends_on'] = []
                elif kind == 'remove': node['sources'].pop()
                elif kind in ('shared', 'escape'):
                    node['sources'].append({'path': DESKTOP + '.new' if kind == 'shared' else 'apps/studio-native/../../shared.sh'})
                elif kind == 'schema': changed['schema'] = 'other'
                raw = json.dumps(changed)
                if kind == 'duplicate-key': raw = raw[:-1] + ', "nodes": []}'
                r.merge({TRACE: raw}); self.assertEqual(r.classify()['decision'], 'FULL')

    def test_main_missing_objects_and_non_merge_checkout_do_not_exclude(self):
        self.r.merge({NATIVE: 'changed\n'})
        self.assertEqual(self.r.classify(event='push')['decision'], 'FULL')
        self.assertEqual(self.r.classify(base='0' * 40)['decision'], 'FULL')
        self.assertEqual(self.r.classify(head=self.r.base)['decision'], 'FULL')

    def test_receipt_cannot_be_replayed_or_have_its_decision_or_sources_forged(self):
        self.r.merge({NATIVE: 'changed\n'}); original = self.r.classify()
        for field in ('base_sha', 'head_sha', 'checkout_sha', 'path_digest', 'classifier_blob', 'policy_blob', 'decision', 'changes'):
            with self.subTest(field=field):
                tampered = dict(original); tampered[field] = [] if field == 'changes' else 'forged'
                self.r.receipt.write_text(json.dumps(tampered))
                self.assertNotEqual(self.verify('skipped').returncode, 0)
        self.r.receipt.write_text(json.dumps(original))
        self.assertNotEqual(self.verify('skipped', head=self.r.base).returncode, 0)

    def test_an_actual_new_push_cannot_reuse_the_previous_merge_receipt(self):
        self.r.merge({NATIVE: 'first push\n'}); self.r.classify()
        self.r.git('checkout', '-q', 'feature')
        self.r.write(NATIVE, 'new push\n'); self.r.commit('new head')
        self.r.head = self.r.git('rev-parse', 'HEAD').strip()
        self.r.git('checkout', '-q', 'main')
        self.r.git('reset', '--hard', self.r.base)  # owned temporary fixture only
        self.r.git('merge', '--no-ff', '-qm', 'new tested merge', self.r.head)
        self.r.checkout = self.r.git('rev-parse', 'HEAD').strip()
        self.assertNotEqual(self.verify('skipped').returncode, 0)
        self.assertEqual(self.r.classify()['decision'], 'NOT_APPLICABLE')
        self.assertEqual(self.verify('skipped').returncode, 0)

    def test_non_successful_or_contradictory_results_never_pass(self):
        self.r.merge({NATIVE: 'changed\n'}); self.r.classify()
        for shards in ('failure', 'cancelled', '', 'success'):
            self.assertNotEqual(self.verify(shards).returncode, 0)
        for scope in ('failure', 'cancelled', '', 'skipped'):
            self.assertNotEqual(self.verify('skipped', scope).returncode, 0)
        self.r.classify(event='push')
        for shards in ('failure', 'cancelled', '', 'skipped'):
            self.assertNotEqual(self.verify(shards, event='push').returncode, 0)

    def test_first_adoption_workflow_requires_full_success_and_exact_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = Repository(Path(tmp), bootstrap=True); r.merge({NATIVE: 'changed\n'})
            run = r.workflow('Classify complete source diff with trusted base')
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('run_smoke=true', (r.temp / 'output').read_text())
            r.download_receipt()
            self.assertEqual(r.workflow('Validate scope and every selected smoke shard', SHARDS='success').returncode, 0)
            self.assertNotEqual(r.workflow('Validate scope and every selected smoke shard').returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
