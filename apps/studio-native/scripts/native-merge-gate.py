#!/usr/bin/env python3
"""Classify native PR scope and join existing native results; no execution/dispatch."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

SELF = 'apps/studio-native/scripts/native-merge-gate.py'
IDENTITY = 'apps/studio-native/scripts/verify-native-candidate.py'
# Native inputs (D3, JY 2026-11-24): a pull request runs native only when it changes one of
# these. They are what the native app, its tests and the contract job read, counted on main
# 75f7c192 (docs/testing/native-merge-acceptance.md). Main and dispatch always run full native.
# This file and the identity module are under apps/studio-native/, so changing the policy
# runs full native.
NATIVE_PREFIXES = ('apps/studio-native/', 'scripts/release/', 'docs/operations/release-casebook/')
NATIVE_FILES = ('.github/workflows/studio-native-mobile.yml', '.github/workflows/studio-apple-testflight.yml',
                '.github/workflows/release-cut.yml', '.github/workflows/verify-unified-release.yml',
                'config/release-auto.json', 'config/release-platforms.json')
SCHEMA = 'hps-native-merge-scope/1'


def identity_helper():
    path = Path(__file__).with_name('verify-native-candidate.py')
    spec = importlib.util.spec_from_file_location('native_identity', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(repo, *args):
    r = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    if r.returncode:
        raise ValueError('complete Git object/diff unavailable')
    return r.stdout


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def read_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def diff(repo, before, after):
    parts = git(repo, 'diff', '--raw', '--no-abbrev', '--no-renames', '-z', before, after, '--').split(b'\0')
    if parts.pop() != b'' or len(parts) % 2:
        raise ValueError('incomplete diff')
    rows = []
    for index in range(0, len(parts), 2):
        fields = parts[index].decode('ascii').split()
        if len(fields) != 5:
            raise ValueError('unsupported diff record')
        old_mode, new_mode, old_oid, new_oid, status = fields
        path = parts[index + 1].decode('utf-8', errors='strict')
        if not path or path.startswith('/') or '\\' in path or any(p in ('', '.', '..') for p in path.split('/')) or any(ord(c) < 32 or ord(c) == 127 for c in path):
            raise ValueError('unsupported path')
        rows.append(dict(path=path, status=status, old_mode=old_mode, new_mode=new_mode,
                         old_oid=old_oid, new_oid=new_oid))
    return rows


def scope(repo, event, base, head, checkout, run_id, attempt):
    identity = identity_helper()
    for sha in (base, head, checkout): identity.sha(sha)
    identity.integer(run_id); identity.integer(attempt)
    source = identity.source_identity(repo)
    if source['checkout_sha'] != checkout:
        raise ValueError('checkout differs from workflow source')
    result = dict(schema=SCHEMA, event=event, base_sha=base, source_head_sha=head,
                  **source, run_id=run_id, run_attempt=attempt, decision='FULL',
                  reason='unproven_scope', classifier_blob=None, identity_blob=None,
                  merge_base=None, changes=[], merge_changes=[])
    try:
        for path, field in ((SELF, 'classifier_blob'), (IDENTITY, 'identity_blob')):
            result[field] = git(repo, 'rev-parse', base + ':' + path).decode().strip()
            if Path(__file__).with_name(Path(path).name).read_bytes() != git(repo, 'show', base + ':' + path):
                raise ValueError('gate is not trusted-base code')
        if event != 'pull_request':
            result['reason'] = 'main_or_dispatch_full_backstop'
            return result
        parents = git(repo, 'show', '-s', '--format=%P', checkout).decode().split()
        if parents != [base, head]:
            raise ValueError('tested checkout must be the exact base/head merge')
        common = git(repo, 'merge-base', '--all', base, head).decode().split()
        if len(common) != 1:
            raise ValueError('unique complete merge base required')
        result['merge_base'] = common[0]
        result['changes'] = diff(repo, common[0], head)
        result['merge_changes'] = diff(repo, base, checkout)
        result['path_digest'] = hashlib.sha256(canonical([result['changes'], result['merge_changes']])).hexdigest()
        if not result['changes'] or not result['merge_changes']:
            raise ValueError('empty diff is not an exclusion proof')
        for row in result['changes'] + result['merge_changes']:
            path = row['path']
            if path in NATIVE_FILES or path.startswith(NATIVE_PREFIXES):
                result['reason'] = 'native_input_changed'
                return result
            # Outside the native inputs, only plain files may be excluded; a symlink, submodule
            # or type change keeps full native.
            if (row['status'] not in ('A', 'M', 'D') or row['old_mode'] not in (':000000', ':100644', ':100755')
                    or row['new_mode'] not in ('000000', '100644', '100755')):
                result['reason'] = 'special_file_outside_native_inputs'
                return result
        result.update(decision='NOT_APPLICABLE', reason='no_native_input_changed')
    except (ValueError, OSError, UnicodeError) as error:
        result['reason'] = 'full_fallback:' + str(error)
    return result


def verify(repo, expected, receipt, results, candidate):
    if results.get('scope') != 'success' or receipt != expected:
        raise ValueError('missing, stale or unsuccessful scope evidence')
    selected = expected['decision'] != 'NOT_APPLICABLE'
    wanted = 'success' if selected else 'skipped'
    if set(results) != {'scope', 'contract', 'ios', 'android'} or any(results[job] != wanted for job in ('contract', 'ios', 'android')):
        raise ValueError('all selected native jobs must succeed; excluded jobs must be unrun')
    if selected:
        identity = identity_helper()
        source = identity.source_identity(repo)
        identity.verify_identity(candidate, source, dict(head_sha=expected['source_head_sha'],
                                 id=expected['run_id'], run_attempt=expected['run_attempt']))
        if candidate.get('checkout_sha') != expected['checkout_sha']:
            raise ValueError('native candidate belongs to another tested checkout')
    elif candidate is not None:
        raise ValueError('unrelated scope must not claim a native candidate')
    return dict(schema='hps-native-merge-acceptance/1', verdict='PASS' if selected else 'NOT_APPLICABLE',
                scope=expected, jobs=results, native_execution='PASS' if selected else 'NOT_RUN',
                release_authorization='NOT_GRANTED')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['scope', 'verify'])
    p.add_argument('--repo', default='.')
    for key in ('event', 'base', 'head', 'checkout', 'receipt', 'output'): p.add_argument('--' + key, required=True)
    p.add_argument('--run-id', required=True, type=int); p.add_argument('--attempt', required=True, type=int)
    p.add_argument('--results'); p.add_argument('--candidate')
    a = p.parse_args()
    expected = scope(a.repo, a.event, a.base, a.head, a.checkout, a.run_id, a.attempt)
    if a.command == 'scope':
        result = expected
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('run_native=' + ('false' if result['decision'] == 'NOT_APPLICABLE' else 'true') + '\n')
    else:
        result = verify(a.repo, expected, read_json(Path(a.receipt).read_bytes()), read_json(a.results),
                        read_json(Path(a.candidate).read_bytes()) if a.candidate else None)
    Path(a.output).write_bytes(canonical(result) + b'\n')
    print('Native execution ' + ('NOT RUN (proven unrelated)' if result.get('decision') == 'NOT_APPLICABLE' or result.get('verdict') == 'NOT_APPLICABLE' else result.get('decision', result.get('verdict'))))


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        raise SystemExit('native acceptance refused: ' + str(error))
