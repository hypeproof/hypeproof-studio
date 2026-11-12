#!/usr/bin/env python3
"""Bind signed preview eligibility to successful native CI; no signing or writes."""
from __future__ import annotations
import argparse
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import zipfile

REPOSITORY = 'hypeproof/hypeproof-studio'
WORKFLOW = '.github/workflows/studio-native-mobile.yml'
ARTIFACT_PREFIX = 'studio-native-candidate'
SCHEMA = 'hps-native-candidate/1'

class Refused(ValueError):
    pass

def sha(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{40}', value):
        raise Refused('Expected a full Git SHA')
    return value

def integer(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise Refused('Expected a positive run identity')
    return value

def source_identity(root):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
    # Checkout must be pristine: identity names tracked source, never local edits.
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise Refused('Candidate checkout must be clean')
    return {'checkout_sha': sha(git('rev-parse', 'HEAD')),
            'native_tree': sha(git('rev-parse', 'HEAD:apps/studio-native')),
            'native_workflow': sha(git('rev-parse', 'HEAD:' + WORKFLOW))}

def identity_document(source, head, run_id, attempt):
    return {'schema': SCHEMA, 'repository': REPOSITORY, **source,
            'source_head_sha': sha(head), 'run_id': integer(run_id), 'run_attempt': integer(attempt)}

def select_run(payload, head):
    sha(head)
    runs = payload.get('workflow_runs')
    if not isinstance(runs, list):
        raise Refused('Malformed workflow run list')
    matches = []
    for run in runs:
        if run.get('head_sha') != head:
            continue
        if run.get('path', '').split('@')[0] != WORKFLOW or run.get('head_repository', {}).get('full_name') != REPOSITORY:
            raise Refused('Exact-head run has unexpected workflow or source repository')
        if run.get('event') not in ('pull_request', 'push', 'workflow_dispatch'):
            raise Refused('Unsupported native workflow event')
        integer(run.get('id')); integer(run.get('run_attempt'))
        matches.append(run)
    return max(matches, key=lambda run: run['id']) if matches else None

def artifact_name(run):
    return f"{ARTIFACT_PREFIX}-{integer(run['id'])}-{integer(run['run_attempt'])}"

def select_artifact(payload, run):
    artifacts = payload.get('artifacts')
    if not isinstance(artifacts, list):
        raise Refused('Malformed artifact list')
    matches = [a for a in artifacts if a.get('name') == artifact_name(run)]
    if len(matches) != 1 or matches[0].get('expired') is not False:
        raise Refused('Missing, duplicate or expired exact-attempt identity artifact')
    artifact = matches[0]
    integer(artifact.get('id'))
    origin = artifact.get('workflow_run', {})
    if origin.get('id') != run['id'] or origin.get('head_sha') != run['head_sha']:
        raise Refused('Artifact does not belong to selected exact-head run')
    return artifact

def read_identity_archive(data):
    if len(data) > 65536:
        raise Refused('Oversized identity archive')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) != 1 or entries[0].filename != 'native-candidate.json':
                raise Refused('Unexpected identity archive contents')
            entry = entries[0]
            mode = entry.external_attr >> 16
            if entry.file_size > 8192 or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or entry.flag_bits & 1:
                raise Refused('Unsafe identity archive member')
            value = json.loads(archive.read(entry))
            if not isinstance(value, dict):
                raise Refused('Invalid identity document')
            return value
    except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refused('Invalid identity archive') from exc

def verify_identity(document, expected, run):
    if document.get('schema') != SCHEMA or document.get('repository') != REPOSITORY:
        raise Refused('Unexpected native identity schema/repository')
    for field in ('native_tree', 'native_workflow'):
        if sha(document.get(field)) != expected[field]:
            raise Refused('Native CI source mismatch: ' + field)
    sha(document.get('checkout_sha'))  # PR checkout is a merge SHA, not run.head_sha.
    if document.get('source_head_sha') != run['head_sha'] or document.get('run_id') != run['id'] or document.get('run_attempt') != run['run_attempt']:
        raise Refused('Identity does not bind the selected run and attempt')

def api(path, binary=False):
    # gh follows GitHub artifact redirects without shell interpolation. Token is
    # read-only and confined to this gate; never logged or passed as an argument.
    for attempt in range(2):
        result = subprocess.run(['gh', 'api', path], capture_output=True, timeout=30)
        if result.returncode == 0:
            return result.stdout if binary else json.loads(result.stdout)
        # Only one transient-server retry. Denials/rate limits fail immediately.
        if attempt == 0 and re.search(rb'HTTP (502|503|504)\b', result.stderr):
            time.sleep(2)
            continue
        raise Refused('GitHub read failed; no permission or rate-limit fallback')
    raise Refused('GitHub read failed')

def wait_for_candidate(expected, head, timeout, interval, read=api, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + timeout
    base = 'repos/' + REPOSITORY + '/actions'
    while clock() < deadline:
        payload = read(base + '/workflows/studio-native-mobile.yml/runs?head_sha=' + sha(head) + '&per_page=100')
        run = select_run(payload, head)
        if run and run.get('status') == 'completed':
            if run.get('conclusion') != 'success':
                raise Refused('Exact-head native CI did not succeed')
            artifact = select_artifact(read(base + f"/runs/{run['id']}/artifacts?per_page=100"), run)
            document = read_identity_archive(read(base + f"/artifacts/{artifact['id']}/zip", binary=True))
            verify_identity(document, expected, run)
            # A rerun or a newer exact-head run can start while its old artifact
            # downloads. Re-read eligibility immediately before emitting PASS.
            latest = select_run(read(base + '/workflows/studio-native-mobile.yml/runs?head_sha=' + sha(head) + '&per_page=100'), head)
            if (latest is None or latest['id'] != run['id'] or latest['run_attempt'] != run['run_attempt']
                    or latest.get('status') != 'completed' or latest.get('conclusion') != 'success'):
                raise Refused('Native run eligibility changed during artifact verification')
            return {'schema': 'hps-native-release-gate/1', 'verdict': 'PASS',
                    'release_checkout_sha': expected['checkout_sha'], 'source_head_sha': head,
                    'native_run_id': run['id'], 'native_run_attempt': run['run_attempt'],
                    'artifact_id': artifact['id'], 'native_tree': expected['native_tree'],
                    'native_workflow': expected['native_workflow'], 'signing': 'NOT_RUN', 'deployment': 'NOT_RUN'}
        if run and run.get('status') not in ('queued', 'in_progress', 'waiting', 'requested', 'pending'):
            raise Refused('Unknown native run state')
        sleep(min(interval, max(0, deadline - clock())))
    raise Refused('Timed out waiting for successful exact-head native CI')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('identity', 'gate'))
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--timeout', type=int, default=1500)
    parser.add_argument('--interval', type=int, default=30)
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise Refused('Unexpected repository')
    if not 1 <= args.timeout <= 1800 or not 10 <= args.interval <= 60:
        raise Refused('Polling bounds exceeded')
    source = source_identity(Path.cwd())
    if args.mode == 'identity':
        result = identity_document(source, os.environ['NATIVE_SOURCE_HEAD'], int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT']))
    else:
        head = sha(os.environ['GITHUB_SHA'])
        if source['checkout_sha'] != head:
            raise Refused('Release checkout differs from triggering source')
        result = wait_for_candidate(source, head, args.timeout, args.interval)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f"{args.mode}: PASS; receipt {args.output}")

if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, KeyError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
