#!/usr/bin/env python3
"""Read-only failed Studio native CI evidence. Never produces release eligibility."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import subprocess
import types
import uuid
import zipfile

from core import Blocked, require
from transport import NativeGitHub, file_hash

REPOSITORY = 'hypeproof/hypeproof-studio'
WORKFLOW = '.github/workflows/studio-native-mobile.yml'
VERIFIER = 'apps/studio-native/scripts/verify-native-candidate.py'
MAX_ARCHIVE = 1024 ** 3
MAX_EXPANDED = 2 * 1024 ** 3
MAX_SELECTED = 256 * 1024 ** 2
MAX_MEMBER = 128 * 1024 ** 2
MAX_JSON = 2 * 1024 ** 2
MAX_DIRECTORY = 2 * 1024 ** 2
FAILED = {'failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'}


def sha(value):
    require(isinstance(value, str) and re.fullmatch('[a-f0-9]{40}', value), 'full lowercase Git SHA required')
    return value


def positive(value):
    require(type(value) is int and value > 0, 'positive integer identity required')
    return value


def instant(value):
    require(isinstance(value, str), 'REST timestamp required')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(result.tzinfo is not None, 'timestamp timezone required')
        return result
    except ValueError:
        raise Blocked('malformed REST timestamp') from None


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, timeout=30)
    require(result.returncode == 0, 'required local Studio Git object unavailable; fetch separately')
    return result.stdout


class TrustedVerifier:
    """Load only an operator-pinned origin/main object, never failed PR code."""
    def __init__(self, root, revision):
        self.root = Path(root)
        sha(revision)
        remote = git(root, 'remote', 'get-url', 'origin').decode().strip().removesuffix('.git')
        require(remote in {'https://github.com/' + REPOSITORY, 'git@github.com:' + REPOSITORY},
                'canonical Studio origin required')
        require(git(root, 'rev-parse', 'origin/main').decode().strip() == revision,
                'verifier SHA must match the separately trusted local origin/main')
        source = git(root, 'show', revision + ':' + VERIFIER)
        self.provenance = {'source_sha': revision, 'path': VERIFIER,
                           'sha256': hashlib.sha256(source).hexdigest()}
        self.module = types.ModuleType('hype_release_trusted_native_identity')
        self.module.__file__ = str(self.root / VERIFIER)
        exec(compile(source, str(self.root / VERIFIER), 'exec'), self.module.__dict__)
        require(self.module.REPOSITORY == REPOSITORY and self.module.WORKFLOW == WORKFLOW,
                'unexpected trusted native verifier contract')

    def verify(self, data, run):
        try:
            value = self.module.read_identity_archive(data)
            # Exactly the existing native gate's tree/workflow contract. The
            # checkout SHA can name an ephemeral PR merge absent from local Git.
            head = sha(run.get('head_sha'))
            expected = {key: sha(git(self.root, 'rev-parse', head + ':' + path).decode().strip())
                        for key, path in [('native_tree', 'apps/studio-native'), ('native_workflow', WORKFLOW)]}
            self.module.verify_identity(value, expected, run)
            return value
        except self.module.Refused:
            raise Blocked('trusted native identity verification refused') from None


def validate_run(value, run_id, attempt, head):
    require(isinstance(value, dict), 'REST run object required')
    require({'id', 'run_attempt', 'head_sha'} <= value.keys(), 'REST run schema required; gh-view is not REST')
    require(positive(value.get('id')) == run_id and positive(value.get('run_attempt')) == attempt
            and value.get('head_sha') == head, 'REST run/head/attempt mismatch (gh-view schema is not REST)')
    require(value.get('path', '').split('@')[0] == WORKFLOW
            and value.get('head_repository', {}).get('full_name') == REPOSITORY
            and value.get('repository', {}).get('full_name') == REPOSITORY,
            'native run workflow/repository mismatch')
    require(value.get('event') in {'pull_request', 'push', 'workflow_dispatch'}
            and value.get('status') == 'completed' and value.get('conclusion') in FAILED,
            'terminal failed native run required; no success gate is changed')
    return value


def rows(payload, key):
    require(isinstance(payload, dict) and isinstance(payload.get(key), list)
            and type(payload.get('total_count')) is int
            and payload['total_count'] == len(payload[key]) <= 100,
            'bounded complete REST ' + key + ' page required')
    require(all(isinstance(row, dict) for row in payload[key]), 'malformed REST rows')
    return payload[key]


def select_job(jobs, name, run):
    matches = [job for job in jobs if job.get('name') == name]
    require(len(matches) == 1, 'one exact native job required')
    job = matches[0]
    positive(job.get('id'))
    require(positive(job.get('run_id')) == run['id'] and type(job.get('run_attempt')) is int
            and job['run_attempt'] == run['run_attempt'] and job.get('head_sha') == run['head_sha']
            and job.get('status') == 'completed', 'native job source/attempt mismatch')
    return job


def in_job_window(artifact, job):
    return instant(job.get('started_at')) <= instant(artifact.get('created_at')) <= instant(job.get('completed_at'))


def select_artifact(artifacts, name, run, job):
    matches = [row for row in artifacts if row.get('name') == name and in_job_window(row, job)]
    require(len(matches) == 1, 'missing or ambiguous exact native artifact')
    value = matches[0]
    positive(value.get('id'))
    origin = value.get('workflow_run', {})
    require(value.get('expired') is False and origin.get('id') == run['id']
            and origin.get('head_sha') == run['head_sha'], 'foreign or expired artifact')
    require(type(value.get('size_in_bytes')) is int and 0 < value['size_in_bytes'] <= MAX_ARCHIVE
            and isinstance(value.get('digest'), str) and re.fullmatch('sha256:[a-f0-9]{64}', value['digest']),
            'bounded artifact size and provider SHA-256 required')
    return value


def private_dir(path):
    require(os.name == 'posix', 'private evidence storage currently requires a POSIX host')
    require(not path.is_symlink(), 'symlink output directory refused')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    require(path.is_dir() and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0,
            'managed evidence directory must be owned by this user with no group/other access')
    return path


def write_bytes(path, data):
    # Exclusive publication: an older receipt or incomplete file is never overwritten.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
        out.write(data)


def write_json(path, value):
    write_bytes(path, (json.dumps(value, indent=2, sort_keys=True) + '\n').encode())


def archive_bytes(actions, artifact, cache, supplied):
    path = supplied.get(artifact['id'], cache / (str(artifact['id']) + '.zip'))
    require(not path.is_symlink(), 'symlink archive refused')
    reused = path.exists()
    if not reused:
        require(artifact['id'] not in supplied, 'supplied archive missing; no replacement download')
        # Transport retains its exclusive create and bounded read. Failure leaves partial bytes.
        actions.artifact_zip(REPOSITORY, artifact['id'], path)
        os.chmod(path, 0o600)
    if artifact['id'] not in supplied:
        require(path.is_file() and path.stat().st_uid == os.getuid()
                and stat.S_IMODE(path.stat().st_mode) & 0o077 == 0,
                'managed cached archive must be private; preserve unknown or partial file')
    require(path.is_file() and path.stat().st_size == artifact['size_in_bytes']
            and 'sha256:' + file_hash(path) == artifact['digest'],
            'archive bytes do not match provider identity; preserved, not overwritten or downloaded again')
    return path, {'id': artifact['id'], 'name': artifact['name'], 'path': str(path),
                  'sha256': artifact['digest'][7:], 'size': artifact['size_in_bytes'], 'reused': reused}


def member_path(name):
    require(isinstance(name, str) and name and len(name) <= 1024
            and '\\' not in name and ':' not in name and not any(ord(c) < 32 for c in name),
            'unsafe archive member path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in {'', '.', '..'} for part in name.rstrip('/').split('/')),
            'unsafe archive member path')
    return path


def archive_index(archive):
    entries = archive.infolist()
    require(len(entries) <= 20000, 'too many archive members')
    index, expanded = {}, 0
    for item in entries:
        member_path(item.filename)
        require(item.filename not in index and not item.flag_bits & 1
                and stat.S_IFMT(item.external_attr >> 16) in {0, stat.S_IFREG, stat.S_IFDIR},
                'duplicate, encrypted or nonregular archive member')
        require(stat.S_IFMT(item.external_attr >> 16) != stat.S_IFDIR or item.is_dir(),
                'directory mode on a file member')
        require(item.file_size >= 0 and item.file_size <= MAX_EXPANDED, 'oversized archive member')
        expanded += item.file_size
        index[item.filename] = item
    require(expanded <= MAX_EXPANDED, 'expanded archive exceeds bound')
    return index


def preflight_zip(path):
    # ZipFile eagerly allocates the central directory before infolist() bounds
    # can run. Bound its bytes independently of the untrusted declared count.
    size = path.stat().st_size
    require(22 <= size <= MAX_ARCHIVE, 'archive size outside bound')
    with path.open('rb') as stream:
        stream.seek(max(0, size - 65557))
        tail = stream.read(65557)
    offset = tail.rfind(b'PK\x05\x06')
    require(offset >= 0 and len(tail) - offset >= 22, 'ZIP end record missing')
    _, disk, start_disk, disk_count, count, length, start, comment = struct.unpack_from('<4s4H2LH', tail, offset)
    end = size - len(tail) + offset
    require(offset + 22 + comment == len(tail), 'ambiguous ZIP end record')
    require(disk == start_disk == 0 and disk_count == count and 0 < count <= 20000
            and length != 0xffffffff and start != 0xffffffff
            and tail[max(0, offset - 20):offset - 16] != b'PK\x06\x07',
            'ZIP64, multidisk or excessive entry count refused')
    require(0 < length <= MAX_DIRECTORY and start + length == end,
            'central directory exceeds bound or has ambiguous layout')


def read_json(archive, index, name):
    require(name in index and index[name].file_size <= MAX_JSON, 'missing or oversized evidence JSON')
    return json.loads(archive.read(index[name]))


def select_evidence(archive, index, checkout, platform):
    # Only producer-owned log/receipt names, never arbitrary app bundles/xcresult contents.
    logs = {'simulator-test.log', 'device-build.log', 'swift-tests.log', 'attachment-export.log',
            'simulator-cleanup.log', 'native-ui.log', 'verification.log', 'build.log', 'receipt.json'}
    selected = {name for name in index if name.startswith('evidence/') and '/journey-attachments/' not in name
                and '.xcresult/' not in name and PurePosixPath(name).name in logs}
    if platform != 'ios':
        return selected, [], 'PARTIAL', 'Android logs only; no XCTest attachment manifest'
    documents = [name for name in index if name.endswith('/native-journeys.json')]
    manifests = [name for name in index if name.endswith('/journey-attachments/manifest.json')]
    if not documents or not manifests:
        return selected, [], 'PARTIAL', 'Journey receipt or attachment manifest absent; build/setup may have failed'
    require(len(documents) == len(manifests) == 1, 'ambiguous journey evidence')
    journey = read_json(archive, index, documents[0])
    require(isinstance(journey, dict) and journey.get('schema') == 'hps-native-journey-evidence/1'
            and journey.get('source_sha') == checkout, 'journey source/schema mismatch')
    cases = journey.get('simulator_journeys', {}).get('cases')
    require(isinstance(cases, list) and all(isinstance(case, dict) for case in cases), 'malformed journey cases')
    failed = [case.get('test') for case in cases if case.get('status') == 'FAIL']
    require(all(isinstance(case, str) and re.fullmatch(r'[A-Za-z0-9_]+\.[A-Za-z0-9_]+', case) for case in failed)
            and len(set(failed)) == len(failed), 'malformed failed case identity')
    manifest = read_json(archive, index, manifests[0])
    require(isinstance(manifest, list) and len(manifest) <= 1000
            and all(isinstance(row, dict) for row in manifest), 'malformed attachment manifest')
    selected.update([documents[0], manifests[0]])
    attached = []
    for case in failed:
        identifier = case.replace('.', '/') + '()'
        matches = [row for row in manifest if row.get('testIdentifier') == identifier]
        require(len(matches) <= 1, 'ambiguous failed-case manifest')
        if not matches:
            continue
        attachments = matches[0].get('attachments')
        require(isinstance(attachments, list) and len(attachments) <= 500, 'malformed case attachments')
        for item in attachments:
            require(isinstance(item, dict), 'malformed case attachment')
            name = item.get('exportedFileName')
            require(len(member_path(name).parts) == 1, 'attachment must be a flat exported filename')
            path = str(PurePosixPath(manifests[0]).parent / name)
            require(path in index, 'manifest attachment absent from archive')
            selected.add(path)
        if attachments:
            attached.append(case)
    complete = bool(failed) and set(attached) == set(failed)
    return selected, failed, 'COLLECTED' if complete else 'PARTIAL', (
        'Failed-case attachments selected; not interpreted or acceptance' if complete
        else 'No failed case or missing failed-case attachments; preserve logs for diagnosis')


def extract(path, destination, checkout, platform):
    preflight_zip(path)
    with zipfile.ZipFile(path) as archive:
        index = archive_index(archive)
        selected, failed, status, note = select_evidence(archive, index, checkout, platform)
        require(len(selected) <= 1000 and sum(index[name].file_size for name in selected) <= MAX_SELECTED,
                'selected evidence exceeds bound')
        private_dir(destination)
        files = []
        for name in sorted(selected):
            info = index[name]
            require(not info.is_dir() and info.file_size <= MAX_MEMBER, 'selected member exceeds bound')
            relative = member_path(name)
            parent = destination
            for part in relative.parts[:-1]:
                parent = private_dir(parent / part)
            target = parent / relative.name
            # Read only bounded selected members; ZipFile verifies CRC. Never extractall or execute.
            data = archive.read(info)
            require(len(data) == info.file_size, 'truncated selected member')
            write_bytes(target, data)
            files.append({'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        return {'status': status, 'note': note, 'failed_cases': failed, 'files': files}


def collect(actions, verifier, *, run_id, attempt, head, platform, output, supplied=None):
    positive(run_id); positive(attempt); sha(head)
    require(platform in {'ios', 'android'}, 'native platform required')
    root = private_dir(Path(output).absolute())
    namespace = private_dir(private_dir(root / ('run-' + str(run_id))) / ('attempt-' + str(attempt)))
    cache = private_dir(namespace / 'archives')
    executions = private_dir(namespace / 'collections')
    execution = executions / uuid.uuid4().hex
    execution.mkdir(mode=0o700)
    result = {'schema': 'hype-native-failure-evidence/1', 'status': 'FAILED', 'repository': REPOSITORY,
              'run_id': run_id, 'run_attempt': attempt, 'source_head_sha': head, 'platform': platform,
              'verifier': verifier.provenance, 'collection': str(execution), 'archives': [],
              'release_eligibility': 'NOT_EVALUATED', 'physical_acceptance': 'NOT_RUN'}
    write_json(execution / 'started.json', {**result, 'status': 'COLLECTING',
               'observed_at': datetime.now(timezone.utc).isoformat()})
    try:
        base = f'repos/{REPOSITORY}/actions/runs/{run_id}'
        run = validate_run(actions.api(base), run_id, attempt, head)
        write_json(execution / 'run-rest.json', run)
        jobs_payload = actions.api(base + f'/attempts/{attempt}/jobs?per_page=100')
        jobs = rows(jobs_payload, 'jobs')
        write_json(execution / 'jobs-rest.json', jobs_payload)
        contract = select_job(jobs, 'contract', run)
        job = select_job(jobs, platform, run)
        require(job.get('conclusion') in FAILED, 'selected platform did not fail')
        artifacts_payload = actions.api(base + '/artifacts?per_page=100')
        artifacts = rows(artifacts_payload, 'artifacts')
        write_json(execution / 'artifacts-rest.json', artifacts_payload)
        identity_artifact = select_artifact(artifacts, f'studio-native-candidate-{run_id}-{attempt}', run, contract)
        require(identity_artifact['size_in_bytes'] <= 65536, 'oversized candidate identity archive')
        prefix = 'studio-ios-unsigned-' if platform == 'ios' else 'studio-android-preview-'
        platform_names = [row.get('name') for row in artifacts if isinstance(row.get('name'), str)
                          and re.fullmatch(re.escape(prefix) + '[a-f0-9]{40}', row['name'])
                          and in_job_window(row, job)]
        require(len(platform_names) == 1, 'missing or ambiguous platform artifact')
        artifact = select_artifact(artifacts, platform_names[0], run, job)
        require(set(supplied or {}) <= {identity_artifact['id'], artifact['id']},
                'unrecognized supplied archive ID; no replacement download')
        identity_path, record = archive_bytes(actions, identity_artifact, cache, supplied or {})
        result['archives'].append(record)
        identity = verifier.verify(identity_path.read_bytes(), run)
        result['tested_checkout_sha'] = identity['checkout_sha']
        result['source_binding'] = 'Expected-head native tree/workflow match CI identity; full merge ancestry NOT_EVALUATED'
        result['native_tree'] = identity['native_tree']
        result['native_workflow'] = identity['native_workflow']
        write_json(execution / 'native-candidate.json', identity)
        require(artifact['name'] == prefix + identity['checkout_sha'], 'platform archive tested checkout mismatch')
        path, record = archive_bytes(actions, artifact, cache, supplied or {})
        result['archives'].append(record)
        result.update(extract(path, private_dir(execution / 'selected'), identity['checkout_sha'], platform))
        # A rerun during collection invalidates this observation, without deleting old bytes.
        validate_run(actions.api(base), run_id, attempt, head)
        result['provider_operations'] = 'GET_ONLY'
    except Exception as error:
        result['status'] = 'FAILED'
        # Never serialize provider bodies, subprocess argv, tokens or attachment contents.
        result['error_type'] = type(error).__name__
        result['reason'] = str(error) if isinstance(error, Blocked) else 'Collection failed; original files preserved'
    finally:
        write_json(execution / 'receipt.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--attempt', required=True, type=int)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--studio-repo', required=True, type=Path)
    parser.add_argument('--verifier-sha', required=True, help='separately trusted local origin/main SHA, never PR code')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--archive', action='append', default=[], metavar='ID=PATH',
                        help='reuse an existing archive only after provider digest/size match; no replacement download')
    args = parser.parse_args(argv)
    actions = None
    try:
        supplied = {}
        for entry in args.archive:
            identifier, path = entry.split('=', 1)
            identifier = positive(int(identifier))
            require(identifier not in supplied, 'duplicate supplied archive ID')
            supplied[identifier] = Path(path).absolute()
        verifier = TrustedVerifier(args.studio_repo, args.verifier_sha)
        actions = NativeGitHub([REPOSITORY], actions=True)
        result = collect(actions, verifier, run_id=args.run_id, attempt=args.attempt, head=args.expected_head,
                         platform=args.platform, output=args.output, supplied=supplied)
        print(json.dumps({key: result[key] for key in ('status', 'collection', 'release_eligibility')}))
        return 0 if result['status'] == 'COLLECTED' else 2
    except Exception:
        print(json.dumps({'status': 'FAILED', 'reason': 'Preflight refused; no automatic fallback or replay'}))
        return 2
    finally:
        if actions is not None:
            actions.close()


if __name__ == '__main__':
    raise SystemExit(main())
