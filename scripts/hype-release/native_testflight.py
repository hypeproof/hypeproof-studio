"""One native adapter: existing Studio gate and upload receipts, no signing logic."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import types
import zipfile

from core import Blocked, digest, require, settle
from operations import product_checkout, source_prs

KIND = 'native-testflight'
CI_FIELDS = ('native_tree', 'native_workflow', 'native_run_id', 'native_run_attempt', 'artifact_id')


def workflow_contract(root, candidate):
    # Use the repository's existing PyYAML dependency only for this native path.
    # Source SHA binds these bytes; this is target validation, not a new approval gate.
    try:
        import yaml
    except ImportError:
        raise Blocked('native preparation requires the Harness PyYAML dependency') from None
    try:
        workflow = yaml.safe_load((root / '.github/workflows' / candidate['workflow']).read_text())
    except yaml.YAMLError:
        raise Blocked('malformed native workflow') from None
    require(isinstance(workflow, dict) and isinstance(workflow.get('jobs'), dict), 'malformed native workflow jobs')
    # PyYAML's YAML 1.1 loader reads GitHub's unquoted `on` key as True.
    require(not ('on' in workflow and True in workflow), 'ambiguous native workflow event keys')
    events = workflow.get('on', workflow.get(True))
    dispatch = events.get('workflow_dispatch') if isinstance(events, dict) else None
    inputs = dispatch.get('inputs') if isinstance(dispatch, dict) else None
    require(isinstance(inputs, dict) and all(isinstance(inputs.get(key), dict)
            and inputs[key].get('type') == 'string'
            for key in ('expected_sha', 'operation_id', 'request_digest')),
            'native workflow_dispatch requires string inputs expected_sha, operation_id, request_digest')
    upload = workflow['jobs'].get('upload', {})
    require(isinstance(upload, dict) and isinstance(upload.get('strategy'), dict)
            and isinstance(upload['strategy'].get('matrix'), dict), 'malformed native upload strategy')
    require(upload.get('environment') == candidate['environment'] and
            upload.get('strategy', {}).get('matrix', {}).get('platform') == [candidate['platform']],
            'native workflow target environment/platform differs from candidate')


def prepare(github, actions, candidate, checkout):
    root = product_checkout(checkout, candidate)
    assert_ref(github, candidate)  # Confirm the official source before loading product code.
    workflow_contract(root, candidate)
    prs = source_prs(github, candidate, root)
    module_path = root / 'apps/studio-native/scripts/verify-native-candidate.py'
    require(module_path.is_file() and not module_path.is_symlink(), 'existing native candidate gate required')
    # Execute the exact product's gate, without creating __pycache__ in its clean checkout.
    gate = types.ModuleType('hype_release_product_native_gate')
    gate.__file__ = str(module_path)
    source_bytes = subprocess.check_output(['git', '-C', str(root), 'show',
        candidate['sourceSha'] + ':apps/studio-native/scripts/verify-native-candidate.py'])
    require(module_path.read_bytes() == source_bytes, 'native gate differs from exact tracked source')
    exec(compile(source_bytes, str(module_path), 'exec'), gate.__dict__)
    try:
        source = gate.source_identity(root)
        result = gate.wait_for_candidate(source, candidate['sourceSha'], timeout=1, interval=0,
                                         read=lambda path, binary=False: actions.api(path, binary=binary))
    except gate.Refused as error:
        raise Blocked('existing native candidate gate refused: ' + str(error)) from None
    require(result.get('schema') == 'hps-native-release-gate/1' and result.get('verdict') == 'PASS'
            and result.get('release_checkout_sha') == candidate['sourceSha']
            and result.get('source_head_sha') == candidate['sourceSha'], 'native gate source mismatch')
    assert_ref(github, candidate)
    return {'sourcePrs': prs, 'nativeGate': result}


def assert_ref(github, candidate):
    ref = github.api(f"repos/{candidate['repository']}/git/ref/heads/{candidate['ref']}")
    require(ref.get('object', {}).get('sha') == candidate['sourceSha']
            and ref['object'].get('type') == 'commit', 'native dispatch ref moved from exact candidate')


def request(candidate, operation_id, preparation):
    require(re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', operation_id), 'invalid operation ID')
    gate = preparation['nativeGate']
    return {'adapter': 'hps-native-testflight/1', 'operationId': operation_id,
            **{key: candidate[key] for key in ('repository', 'sourceSha', 'workflow', 'environment', 'platform', 'ref')},
            'nativeCI': {key: gate[key] for key in CI_FIELDS}}


def deployment_request(req, fingerprint):
    return {'schema': 'hps-native-deployment-request/1', 'expected_sha': req['sourceSha'],
            'operation_id': req['operationId'], 'request_digest': fingerprint}


def dispatch(github, actions, candidate, req, fingerprint):
    assert_ref(github, candidate)
    actions.api(f"repos/{req['repository']}/actions/workflows/{req['workflow']}/dispatches", 'POST',
                {'ref': req['ref'], 'inputs': {'expected_sha': req['sourceSha'],
                 'operation_id': req['operationId'], 'request_digest': fingerprint}})
    # A successful HTTP response proves no upload. Session.operation retains UNKNOWN.
    return None


def paged(actions, path, field):
    rows = []
    for page in range(1, 11):
        payload = actions.api(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        part = payload.get(field)
        require(isinstance(part, list), 'malformed Actions listing')
        rows.extend(part)
        if len(part) < 100:
            return rows
    raise Blocked('Actions listing exceeds bounded scan; preserve UNKNOWN')


def validate_run(run, req, title):
    require(type(run.get('id')) is int and run['id'] > 0 and
            type(run.get('run_attempt')) is int and run['run_attempt'] > 0 and
            type(run.get('run_number')) is int and run['run_number'] > 0, 'invalid native run identity')
    require(run.get('head_sha') == req['sourceSha'] and run.get('head_branch') == req['ref']
            and run.get('event') == 'workflow_dispatch' and run.get('display_title') == title
            and run.get('path') == '.github/workflows/' + req['workflow']
            and run.get('head_repository', {}).get('full_name') == req['repository'],
            'native run source/workflow/request mismatch')


def select_artifact(rows, name, run, req):
    matches = [a for a in rows if a.get('name') == name]
    require(len(matches) == 1, 'native artifact missing or ambiguous: ' + name)
    artifact = matches[0]
    origin = artifact.get('workflow_run', {})
    require(type(artifact.get('id')) is int and artifact['id'] > 0 and artifact.get('expired') is False
            and type(origin.get('id')) is int and origin.get('id') == run['id'] and origin.get('head_sha') == req['sourceSha'],
            'native artifact expired or belongs to another source/run')
    return artifact


def open_archive(path):
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise Blocked('invalid native artifact archive; preserve UNKNOWN') from None
    entries = archive.infolist()
    names = [entry.filename for entry in entries]
    require(len(entries) <= 500 and len(names) == len(set(names)), 'ambiguous or oversized native archive')
    for entry in entries:
        name = PurePosixPath(entry.filename)
        require(not name.is_absolute() and '..' not in name.parts and '\\' not in entry.filename
                and not stat.S_ISLNK(entry.external_attr >> 16), 'unsafe native archive member')
    require(sum(e.file_size for e in entries) <= 2 * 1024 ** 3, 'native archive exceeds expanded bound')
    return archive


def document(archive, name):
    matches = [e for e in archive.infolist() if e.filename == name]
    require(len(matches) == 1 and matches[0].file_size <= 1024 * 1024, 'native receipt missing or oversized')
    result = json.loads(archive.read(matches[0]))
    require(isinstance(result, dict), 'native receipt must be an object')
    return result


def observe(actions, req, fingerprint):
    try:
        return _observe(actions, req, fingerprint)
    except Blocked:
        raise
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile):
        raise Blocked('malformed native evidence; preserve UNKNOWN') from None


def settle_upload(state, operation_id, observation):
    """Register observe()'s verified IPA and DONE in one caller-owned CAS write.

    Artifact history is append-only: another run/attempt has its own identity,
    while a conflicting observation of the same upload is never a replacement.
    This records bytes/provenance only, not a package/device acceptance verdict.
    """
    operation = state['operations'][operation_id]
    req = operation['request']
    require(state['candidate'].get('kind') == KIND and operation['kind'] == KIND
            and operation['status'] == 'UNKNOWN', 'only uncertain native uploads can be collected')
    require(req['operationId'] == operation_id and req['repository'] == state['candidate']['repository']
            and req['sourceSha'] == state['candidate']['sourceSha']
            and operation['requestDigest'] == digest({'kind': KIND, 'request': req}),
            'native observation is for another candidate or operation')
    receipt = observation['receipt']
    require(observation['state'] == 'uploaded' and observation['sourceSha'] == req['sourceSha']
            and receipt['deployment_request'] == deployment_request(req, operation['requestDigest'])
            and receipt['repository'] == req['repository'] and receipt['source_sha'] == req['sourceSha']
            and receipt['run_id'] == observation['runId'] and receipt['run_attempt'] == observation['runAttempt'],
            'native observation does not bind the collected upload')
    artifact = {
        'id': f"native-{req['platform']}-ipa-{observation['runId']}-{observation['runAttempt']}",
        'name': 'HP-Studio-ios.ipa', 'sha256': receipt['package_sha256'], 'size': receipt['package_size'],
        'repository': req['repository'], 'sourceSha': req['sourceSha'], 'platform': req['platform'],
        'bundleId': receipt['bundle_id'], 'version': receipt['version'], 'build': receipt['build'],
        'provenance': {'kind': KIND, 'operationId': operation_id, 'requestDigest': operation['requestDigest'],
                       'runId': observation['runId'], 'runAttempt': observation['runAttempt'],
                       'gateArtifactId': observation['gateArtifactId'], 'uploadArtifactId': observation['uploadArtifactId'],
                       'nativeCI': req['nativeCI'], 'receiptDigest': digest(receipt)},
    }
    matches = [row for row in state['artifacts'] if row['id'] == artifact['id']]
    require(len(matches) <= 1 and (not matches or matches[0] == artifact),
            'verified native package identity conflicts with retained evidence')
    result = settle(state, operation_id, 'DONE', observation)
    if not matches:
        # settle deep-copies state/observation; copy the artifact as well so callers
        # cannot change recorded provenance by mutating the request afterwards.
        result['artifacts'].append(json.loads(json.dumps(artifact)))
    return result


def _observe(actions, req, fingerprint):
    require(fingerprint == digest({'kind': KIND, 'request': req}), 'operation request digest changed')
    base = f"repos/{req['repository']}/actions"
    title = f"studio-testflight:{req['operationId']}:{fingerprint}"
    runs = paged(actions, base + f"/workflows/{req['workflow']}/runs?head_sha={req['sourceSha']}", 'workflow_runs')
    matches = [r for r in runs if r.get('display_title') == title]
    require(len(matches) <= 1, 'ambiguous native request runs; never select latest')
    if not matches:
        return None
    run = actions.api(base + f"/runs/{matches[0]['id']}")
    validate_run(run, req, title)
    if run.get('status') != 'completed' or run.get('conclusion') != 'success':
        return None
    rows = paged(actions, base + f"/runs/{run['id']}/artifacts", 'artifacts')
    gate_artifact = select_artifact(rows, f"studio-native-release-gate-{run['id']}-{run['run_attempt']}", run, req)
    upload_artifact = select_artifact(rows, f"studio-testflight-ios-{req['sourceSha']}", run, req)
    expected = deployment_request(req, fingerprint)
    with tempfile.TemporaryDirectory(prefix='hype-native-reconcile-') as directory:
        gate_path, upload_path = (Path(directory) / name for name in ('gate.zip', 'upload.zip'))
        actions.artifact_zip(req['repository'], gate_artifact['id'], gate_path)
        actions.artifact_zip(req['repository'], upload_artifact['id'], upload_path)
        with open_archive(gate_path) as archive:
            gate = document(archive, 'native-release-gate.json')
        require(gate.get('schema') == 'hps-native-release-gate/1' and gate.get('verdict') == 'PASS'
                and gate.get('deployment_request') == expected and gate.get('release_run_id') == run['id']
                and gate.get('release_run_attempt') == run['run_attempt']
                and gate.get('release_checkout_sha') == req['sourceSha'] and gate.get('source_head_sha') == req['sourceSha']
                and all(gate.get(key) == value for key, value in req['nativeCI'].items()),
                'native gate is stale or does not bind this operation/attempt')
        require(all(type(gate.get(key)) is int and gate[key] > 0 for key in
                    ('release_run_id', 'release_run_attempt', 'native_run_id', 'native_run_attempt', 'artifact_id')),
                'native gate has invalid numeric identities')
        ci = actions.api(base + f"/runs/{gate['native_run_id']}")
        require(ci.get('id') == gate['native_run_id'] and ci.get('run_attempt') == gate['native_run_attempt']
                and ci.get('head_sha') == req['sourceSha'] and ci.get('status') == 'completed'
                and ci.get('conclusion') == 'success' and ci.get('path') == '.github/workflows/studio-native-mobile.yml'
                and ci.get('head_repository', {}).get('full_name') == req['repository'], 'native CI eligibility changed')
        with open_archive(upload_path) as archive:
            receipt = document(archive, 'upload-receipt.json')
            require(receipt.get('schema') == 'hps-native-upload-receipt/1'
                    and receipt.get('repository') == req['repository'] and receipt.get('source_sha') == req['sourceSha']
                    and receipt.get('run_id') == run['id'] and receipt.get('run_attempt') == run['run_attempt']
                    and receipt.get('deployment_request') == expected and receipt.get('platform') == req['platform']
                    and receipt.get('native_gate') == req['nativeCI']
                    and receipt.get('bundle_id') == 'ai.hypeproof.studio.mobile' and receipt.get('state') == 'uploaded'
                    and receipt.get('apple_processing') == 'NOT_OBSERVED' and receipt.get('tester_availability') == 'NOT_OBSERVED',
                    'upload receipt source/request/attempt/state mismatch')
            require(all(type(receipt.get(key)) is int and receipt[key] > 0 for key in ('run_id', 'run_attempt')),
                    'upload receipt has invalid numeric identities')
            require(receipt.get('commands') == {name: {'exit_code': 0} for name in ('archive', 'export', 'validation', 'upload')},
                    'upload receipt lacks successful command outcomes')
            require(all(type(row['exit_code']) is int for row in receipt['commands'].values()),
                    'upload command outcomes must be integer exit codes')
            require(isinstance(receipt.get('version'), str) and re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,2}', receipt['version'])
                    and receipt.get('build') == f"{run['run_number']}.{run['run_attempt']}"
                    and isinstance(receipt.get('package_sha256'), str) and re.fullmatch('[a-f0-9]{64}', receipt['package_sha256'])
                    and type(receipt.get('package_size')) is int and receipt['package_size'] > 0, 'upload package identity invalid')
            require('HP-Studio-ios.ipa' in archive.namelist(), 'upload artifact has no IPA')
            package = archive.getinfo('HP-Studio-ios.ipa')
            require(package.file_size == receipt['package_size'], 'IPA size differs from receipt')
            with archive.open(package) as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            require(actual == receipt['package_sha256'], 'IPA bytes differ from upload receipt')
    # Read again after downloads; a newly started attempt invalidates old receipts.
    latest = actions.api(base + f"/runs/{run['id']}")
    validate_run(latest, req, title)
    require(latest['run_attempt'] == run['run_attempt'] and latest.get('status') == 'completed'
            and latest.get('conclusion') == 'success', 'native run changed during receipt verification')
    latest_ci = actions.api(base + f"/runs/{gate['native_run_id']}")
    require(all(latest_ci.get(key) == ci.get(key) for key in
                ('id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'path', 'head_repository')),
            'native CI changed during receipt verification')
    final_runs = paged(actions, base + f"/workflows/{req['workflow']}/runs?head_sha={req['sourceSha']}", 'workflow_runs')
    final_matches = [row for row in final_runs if row.get('display_title') == title]
    require(len(final_matches) == 1 and final_matches[0].get('id') == run['id']
            and final_matches[0].get('run_attempt') == run['run_attempt'],
            'native request run set changed during receipt verification')
    return {'state': 'uploaded', 'sourceSha': req['sourceSha'], 'runId': run['id'], 'runAttempt': run['run_attempt'],
            'gateArtifactId': gate_artifact['id'], 'uploadArtifactId': upload_artifact['id'], 'receipt': receipt,
            'appleProcessing': 'NOT_OBSERVED', 'testerAvailability': 'NOT_OBSERVED',
            'simulatorJourney': 'NOT_RUN', 'signedInJourney': 'NOT_RUN', 'deviceAcceptance': 'NOT_RUN',
            'readiness': 'NOT_ESTABLISHED'}
