#!/usr/bin/env python3
"""Bind signed preview eligibility to successful native CI; no signing or writes."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import time
import zipfile

REPOSITORY = 'hypeproof/hypeproof-studio'
WORKFLOW = '.github/workflows/studio-native-mobile.yml'
RELEASE_WORKFLOW = '.github/workflows/studio-apple-testflight.yml'
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

def repository_root():
    # Resolve from this tracked script, never from the caller's shell directory.
    location = Path(__file__).resolve().parents[3]
    return Path(subprocess.check_output(['git', '-C', str(location), 'rev-parse', '--show-toplevel'], text=True).strip())

def deployment_request(environ, checkout):
    values = [environ.get(key, '') for key in ('NATIVE_EXPECTED_SHA', 'NATIVE_OPERATION_ID', 'NATIVE_REQUEST_DIGEST')]
    workflow = environ.get('NATIVE_EXPECTED_WORKFLOW_SHA', '')
    if not any(values) and not workflow:
        return None  # Existing push and manual dispatch remain supported.
    if not all(values):
        raise Refused('Deployment request fields must be supplied together')
    expected, operation, fingerprint = values
    sha(expected)
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', operation) or not re.fullmatch(r'[a-f0-9]{64}', fingerprint):
        raise Refused('Malformed deployment operation or request digest')
    if workflow:
        sha(workflow)
        if (expected != checkout or workflow != sha(environ.get('GITHUB_SHA'))
                or workflow != sha(environ.get('GITHUB_WORKFLOW_SHA'))
                or environ.get('GITHUB_REF') != 'refs/heads/main'
                or environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
                or environ.get('GITHUB_WORKFLOW_REF') != REPOSITORY + '/' + RELEASE_WORKFLOW + '@refs/heads/main'):
            raise Refused('Deployment workflow or candidate differs from the pinned main request')
        return {'schema': 'hps-native-deployment-request/2', 'expected_sha': expected,
                'workflow_sha': workflow, 'operation_id': operation, 'request_digest': fingerprint}
    if expected != checkout or expected != sha(environ.get('GITHUB_SHA')):
        raise Refused('Deployment request source differs from trigger or checkout')
    return {'schema': 'hps-native-deployment-request/1', 'expected_sha': expected,
            'operation_id': operation, 'request_digest': fingerprint}

def release_identity(source, environ, read=None):
    head = sha(environ.get('GITHUB_SHA'))
    request = deployment_request(environ, source['checkout_sha'])
    workflow = request.get('workflow_sha') if request else None
    if not workflow and source['checkout_sha'] != head:
        raise Refused('Release checkout differs from triggering source')
    if workflow:
        verify_workflow_ancestry(source['checkout_sha'], workflow, read=read)
    return {'source_sha': source['checkout_sha'],
            'run_id': integer(int(environ['GITHUB_RUN_ID'])),
            'run_attempt': integer(int(environ['GITHUB_RUN_ATTEMPT'])),
            'deployment_request': request,
            **({'workflow_source_sha': workflow} if workflow else {})}

def verify_release_gate(path, source, identity):
    # Failed-job-only reruns can retain a successful dependency from an older
    # attempt. Require the downloaded current-attempt artifact before signing,
    # then check it again when recording the upload observation.
    if path is None or path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise Refused('A regular current-attempt native release gate is required; rerun all jobs')
    document = json.loads(path.read_text())
    version = '2' if identity.get('workflow_source_sha') else '1'
    if not isinstance(document, dict) or document.get('schema') != 'hps-native-release-gate/' + version or document.get('verdict') != 'PASS':
        raise Refused('Native release gate must be a successful gate document')
    if document.get('workflow_source_sha') != identity.get('workflow_source_sha'):
        raise Refused('Native release gate belongs to another workflow source')
    for field in ('release_checkout_sha', 'source_head_sha'):
        if sha(document.get(field)) != identity['source_sha']:
            raise Refused('Native release gate source differs from upload source')
    if (integer(document.get('release_run_id')) != identity['run_id']
            or integer(document.get('release_run_attempt')) != identity['run_attempt']):
        raise Refused('Native release gate belongs to another run or attempt; rerun all jobs')
    if 'deployment_request' not in document or document['deployment_request'] != identity['deployment_request']:
        raise Refused('Native release gate deployment request differs from upload request')
    if document.get('signing') != 'NOT_RUN' or document.get('deployment') != 'NOT_RUN':
        raise Refused('Unexpected native release gate stage')
    for field in ('native_tree', 'native_workflow'):
        if sha(document.get(field)) != source[field]:
            raise Refused('Native release gate source mismatch: ' + field)
    return {**{field: integer(document.get(field)) for field in ('native_run_id', 'native_run_attempt', 'artifact_id')},
            **{field: document[field] for field in ('native_tree', 'native_workflow')}}

def upload_receipt(identity, package, archive_info, command_results, environ):
    # Only the trusted upload script supplies these command outcomes, after each
    # command has returned. This is an upload observation, not Apple availability.
    commands = json.loads(command_results.read_text())
    expected_commands = ('archive', 'export', 'validation', 'upload')
    if not isinstance(commands, dict) or set(commands) != set(expected_commands) or any(
            type(commands[name]) is not int or commands[name] != 0 for name in expected_commands):
        raise Refused('Successful archive, export, validation and upload outcomes required')
    if package.is_symlink() or not package.is_file() or package.suffix != '.ipa' or package.stat().st_size == 0:
        raise Refused('A nonempty regular IPA is required')
    info = plistlib.loads(archive_info.read_bytes()).get('ApplicationProperties', {})
    bundle, version, build = (info.get(key) for key in ('CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'))
    if bundle != 'ai.hypeproof.studio.mobile' or not isinstance(version, str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,2}', version):
        raise Refused('Unexpected archived app identity')
    run_number = integer(int(environ['GITHUB_RUN_NUMBER']))
    if build != f"{run_number}.{identity['run_attempt']}":
        raise Refused('Archived build number differs from this run attempt')
    digest = hashlib.sha256()
    with package.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    schema_version = '2' if identity.get('workflow_source_sha') else '1'
    return {'schema': 'hps-native-upload-receipt/' + schema_version, 'repository': REPOSITORY, **identity,
            'platform': 'ios', 'bundle_id': bundle, 'version': version, 'build': build,
            'package_sha256': digest.hexdigest(), 'package_size': package.stat().st_size,
            'commands': {name: {'exit_code': commands[name]} for name in expected_commands},
            'state': 'uploaded', 'apple_processing': 'NOT_OBSERVED', 'tester_availability': 'NOT_OBSERVED'}

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

def verify_workflow_ancestry(app_sha, workflow_sha, read=None):
    """Trusted GET proofs: candidate -> pinned workflow -> current main.

    Main may advance normally; it cannot replace either prepared identity.
    This does not certify source review or authorize a workflow dispatch.
    """
    app_sha, workflow_sha = sha(app_sha), sha(workflow_sha)
    read = api if read is None else read
    base = 'repos/' + REPOSITORY
    ref = read(base + '/git/ref/heads/main')
    if (not isinstance(ref, dict) or ref.get('ref') != 'refs/heads/main'
            or not isinstance(ref.get('object'), dict) or ref['object'].get('type') != 'commit'):
        raise Refused('Trusted main ref is not a commit')
    main = sha(ref['object'].get('sha'))
    for ancestor, descendant in ((app_sha, workflow_sha), (workflow_sha, main)):
        proof = read(base + '/compare/' + ancestor + '...' + descendant)
        expected_status = 'identical' if ancestor == descendant else 'ahead'
        if (not isinstance(proof, dict) or proof.get('status') != expected_status
                or not isinstance(proof.get('base_commit'), dict)
                or not isinstance(proof.get('merge_base_commit'), dict)
                or proof['base_commit'].get('sha') != ancestor
                or proof['merge_base_commit'].get('sha') != ancestor):
            raise Refused('Candidate/workflow is not in trusted main ancestry')
    return {'workflow_source_sha': workflow_sha, 'trusted_main_sha': main}

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
    parser.add_argument('mode', choices=('identity', 'gate', 'request', 'receipt'))
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--timeout', type=int, default=1500)
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--package', type=Path)
    parser.add_argument('--archive-info', type=Path)
    parser.add_argument('--command-results', type=Path)
    parser.add_argument('--release-gate', type=Path)
    parser.add_argument('--candidate-root', type=Path)
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise Refused('Unexpected repository')
    if not 1 <= args.timeout <= 1800 or not 10 <= args.interval <= 60:
        raise Refused('Polling bounds exceeded')
    control_root = repository_root()
    if os.environ.get('NATIVE_EXPECTED_WORKFLOW_SHA'):
        # Execute the reviewed control checkout, even when the app candidate
        # contains an older gate. Never alter GitHub's trigger variables.
        control = source_identity(control_root)
        if control['checkout_sha'] != sha(os.environ['NATIVE_EXPECTED_WORKFLOW_SHA']):
            raise Refused('Control checkout differs from pinned workflow source')
        if args.candidate_root is None:
            raise Refused('Separate explicit candidate root is required')
    source = source_identity(args.candidate_root.resolve() if args.candidate_root else control_root)
    if args.mode == 'identity':
        result = identity_document(source, os.environ['NATIVE_SOURCE_HEAD'], int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT']))
    else:
        identity = release_identity(source, os.environ)
        if args.mode == 'gate':
            result = wait_for_candidate(source, identity['source_sha'], args.timeout, args.interval)
            if identity.get('workflow_source_sha'):
                # Native CI polling can outlive a main rewrite. Recheck before
                # admitting the environment-protected signing job.
                verify_workflow_ancestry(identity['source_sha'], identity['workflow_source_sha'])
                result.update(schema='hps-native-release-gate/2',
                              workflow_source_sha=identity['workflow_source_sha'])
            result.update(deployment_request=identity['deployment_request'],
                          release_run_id=identity['run_id'], release_run_attempt=identity['run_attempt'])
        else:
            identity['native_gate'] = verify_release_gate(args.release_gate, source, identity)
            if args.mode == 'request':
                result = {'schema': 'hps-native-upload-preflight/1', 'repository': REPOSITORY, **identity}
            else:
                if not all((args.package, args.archive_info, args.command_results)):
                    raise Refused('Receipt requires package, archive info and command outcomes')
                result = upload_receipt(identity, args.package, args.archive_info, args.command_results, os.environ)
    # A rerun uses a fresh runner. Never overwrite an existing upload observation.
    with args.output.open('x' if args.mode == 'receipt' else 'w') as output:
        output.write(json.dumps(result, indent=2) + '\n')
    print(f"{args.mode}: PASS; receipt {args.output}")

if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, KeyError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
