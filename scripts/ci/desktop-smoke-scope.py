#!/usr/bin/env python3
"""Conservative desktop-smoke exclusion, executed from the immutable PR base."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

SCRIPT = 'scripts/ci/desktop-smoke-scope.py'
POLICY = 'config/desktop-smoke-scope.json'
WORKFLOW = '.github/workflows/pr-ci.yml'
TRACE = 'config/traceability.json'
SCHEMA = 'hps-desktop-smoke-scope/1'


class Refused(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise Refused('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    if result.returncode:
        raise Refused('git object or complete diff unavailable')
    return result.stdout


def blob(repo, sha, path):
    return git(repo, 'show', sha + ':' + path)


def oid(repo, sha, path):
    return git(repo, 'rev-parse', sha + ':' + path).decode().strip()


def path_ok(path):
    return (bool(path) and not path.startswith('/') and '\\' not in path
            and all(p not in ('', '.', '..') for p in path.split('/'))
            and not any(ord(c) < 32 or ord(c) == 127 for c in path))


def changes(repo, before, after):
    raw = git(repo, 'diff', '--raw', '--no-abbrev', '--no-renames', '-z', before, after, '--')
    if not raw:
        return []
    parts = raw.split(b'\0')
    if parts.pop() != b'' or len(parts) % 2:
        raise Refused('incomplete raw diff')
    rows = []
    for pos in range(0, len(parts), 2):
        fields = parts[pos].decode('ascii').split()
        path = parts[pos + 1].decode('utf-8', errors='strict')
        if len(fields) != 5 or not path_ok(path):
            raise Refused('unsupported diff record')
        old_mode, new_mode, old_oid, new_oid, status = fields
        if not re.fullmatch(r':[0-7]{6}', old_mode) or not re.fullmatch(r'[0-7]{6}', new_mode):
            raise Refused('unsupported diff mode')
        rows.append(dict(path=path, status=status, old_mode=old_mode[1:], new_mode=new_mode,
                         old_oid=old_oid, new_oid=new_oid))
    return rows


def load_policy(repo, base):
    policy = strict_json(blob(repo, base, POLICY))
    if set(policy) != {'schema', 'native_prefixes', 'native_files', 'docs_files', 'traceability_nodes'} or policy['schema'] != 'hps-desktop-smoke-policy/1':
        raise Refused('unsupported policy')
    for key in ('native_prefixes', 'native_files', 'docs_files'):
        if not isinstance(policy[key], list) or not policy[key] or len(set(policy[key])) != len(policy[key]):
            raise Refused('unsupported allowlist')
        for path in policy[key]:
            if not isinstance(path, str) or not path_ok(path.rstrip('/')) or any(c in path for c in '*?['):
                raise Refused('allowlist must use literal paths')
    if policy['traceability_nodes'] != ['ST-TEST-NATIVE-MOBILE']:
        raise Refused('unsupported native evidence node allowlist')
    if any(not p.endswith('/') for p in policy['native_prefixes']):
        raise Refused('native roots must end at a directory boundary')
    return policy


def excluded_path(path, policy):
    # A dependency manifest remains shared scope even under an otherwise native root.
    if Path(path).name in {'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'service-packages.json'}:
        return False
    return (path in policy['docs_files'] or path in policy['native_files']
            or any(path.startswith(prefix) for prefix in policy['native_prefixes']))


def native_trace_delta(repo, before, after, policy):
    """Only additive native evidence on audited nodes; shared links stay exact."""
    old, new = (strict_json(blob(repo, rev, TRACE)) for rev in (before, after))
    if not isinstance(old, dict) or not isinstance(new, dict):
        return False
    if {k: v for k, v in old.items() if k != 'nodes'} != {k: v for k, v in new.items() if k != 'nodes'}:
        return False
    def nodes(value):
        items = value.get('nodes')
        if not isinstance(items, list) or any(not isinstance(n, dict) or not isinstance(n.get('id'), str) for n in items):
            raise Refused('invalid trace nodes')
        indexed = {n['id']: n for n in items}
        if len(indexed) != len(items):
            raise Refused('duplicate trace node')
        return indexed
    a, b = nodes(old), nodes(new)
    if list(a) != list(b):
        return False
    changed = False
    for key, previous in a.items():
        current = b[key]
        if current == previous:
            continue
        changed = True
        if {k: v for k, v in previous.items() if k != 'sources'} != {k: v for k, v in current.items() if k != 'sources'}:
            return False
        if key not in policy['traceability_nodes']:
            return False
        before_links, after_links = previous.get('sources'), current.get('sources')
        if not isinstance(before_links, list) or not isinstance(after_links, list) or not before_links:
            return False
        # Preserve every original link, including this node's shared desktop tests.
        # Only additive, local native evidence mappings are outside desktop scope.
        encoded_before = [canonical(link) for link in before_links]
        encoded_after = [canonical(link) for link in after_links]
        if len(set(encoded_after)) != len(encoded_after):
            return False
        if [link for link in encoded_after if link in encoded_before] != encoded_before:
            return False
        additions = [link for link in after_links if canonical(link) not in encoded_before]
        if not additions or any(not isinstance(link, dict) or set(link) != {'path'}
                                or not isinstance(link['path'], str)
                                or not path_ok(link['path']) or not excluded_path(link['path'], policy) for link in additions):
            return False
    return changed


def classify(repo, event, base, head, checkout):
    for value in (base, head, checkout):
        if not re.fullmatch('[0-9a-f]{40}', value):
            raise Refused('full immutable source SHA required')
    if git(repo, 'rev-parse', 'HEAD').decode().strip() != checkout:
        raise Refused('checkout differs from expected source')
    result = dict(schema=SCHEMA, event=event, base_sha=base, head_sha=head, checkout_sha=checkout,
                  decision='FULL', reason='unproven_scope', merge_base_sha=None, classifier_blob=None,
                  policy_blob=None, changes=[], merge_changes=[])
    try:
        result['classifier_blob'] = oid(repo, base, SCRIPT)
        result['policy_blob'] = oid(repo, base, POLICY)
        # No candidate-edited classifier can certify its own exclusion, even if it returns zero paths.
        if Path(__file__).read_bytes() != blob(repo, base, SCRIPT):
            raise Refused('classifier is not the trusted-base bytes')
        if event != 'pull_request':
            result['reason'] = 'non_pr_full_backstop'
            return result
        for rev in (base, head, checkout):
            git(repo, 'cat-file', '-e', rev + '^{commit}')
        parents = git(repo, 'show', '-s', '--format=%P', checkout).decode().strip().split()
        if parents != [base, head]:
            raise Refused('tested source is not the event base/head merge')
        merge_bases = git(repo, 'merge-base', '--all', base, head).decode().split()
        if len(merge_bases) != 1:
            raise Refused('ambiguous merge base')
        result['merge_base_sha'] = merge_bases[0]
        result['changes'] = changes(repo, merge_bases[0], head)
        result['merge_changes'] = changes(repo, base, checkout)
        result['path_digest'] = digest([result['changes'], result['merge_changes']])
        policy = load_policy(repo, base)
        all_rows = result['changes'] + result['merge_changes']
        if not result['changes'] or not result['merge_changes']:
            result['reason'] = 'empty_diff_not_exclusion'
            return result
        for row in all_rows:
            if row['status'] not in ('A', 'M') or row['new_mode'] not in ('100644', '100755') or row['old_mode'] not in ('000000', '100644', '100755'):
                result['reason'] = 'deletion_rename_or_special_file'
                return result
            path = row['path']
            if path in (SCRIPT, POLICY, WORKFLOW):
                result['reason'] = 'scope_authority_changed'
                return result
            if path != TRACE and not excluded_path(path, policy):
                result['reason'] = 'unknown_or_desktop_input'
                return result
        for start, end, rows in ((merge_bases[0], head, result['changes']), (base, checkout, result['merge_changes'])):
            if any(row['path'] == TRACE for row in rows) and not native_trace_delta(repo, start, end, policy):
                result['reason'] = 'shared_traceability_delta'
                return result
        result.update(decision='NOT_APPLICABLE', reason='proven_native_or_audited_docs_only')
    except (Refused, ValueError, TypeError, KeyError, UnicodeError) as error:
        result['reason'] = 'full_fallback:' + str(error)
    return result


def verify(repo, event, base, head, checkout, receipt, scope_result, shards):
    if scope_result != 'success':
        raise Refused('scope producer did not succeed')
    expected = classify(repo, event, base, head, checkout)
    if receipt != expected:
        raise Refused('missing, stale or contradictory scope receipt')
    required = 'skipped' if expected['decision'] == 'NOT_APPLICABLE' else 'success'
    if shards != required:
        raise Refused('selected smoke shards did not succeed or excluded shards unexpectedly ran')
    return 'Desktop smoke NOT RUN (proven outside input scope)' if required == 'skipped' else 'All six desktop smoke shards passed'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['classify', 'verify'])
    p.add_argument('--repo', default='.')
    for name in ('event', 'base', 'head', 'checkout', 'receipt'):
        p.add_argument('--' + name, required=True)
    p.add_argument('--scope-result'); p.add_argument('--shards')
    args = p.parse_args()
    if args.command == 'classify':
        receipt = classify(args.repo, args.event, args.base, args.head, args.checkout)
        Path(args.receipt).write_bytes(canonical(receipt) + b'\n')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('run_smoke=' + ('false' if receipt['decision'] == 'NOT_APPLICABLE' else 'true') + '\n')
        print(receipt['decision'] + ': ' + receipt['reason'])
    else:
        print(verify(args.repo, args.event, args.base, args.head, args.checkout,
                     strict_json(Path(args.receipt).read_text()), args.scope_result, args.shards))


if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, ValueError) as error:
        raise SystemExit('desktop smoke scope refused: ' + str(error))
