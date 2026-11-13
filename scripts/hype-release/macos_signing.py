"""Official Mac receipt binding inside the existing release state, not approval."""
from __future__ import annotations

import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path

from core import Blocked, digest, require

REPOSITORY = 'hypeproof/hypeproof-studio'
WORKFLOW = '.github/workflows/build-mac.yml'
TEAM = 'RZBNT9ZB67'
BUNDLE = 'ai.hypeproof.studio'
PACKAGE = 'HypeProof-Studio-darwin-arm64.zip'
RECEIPT = 'HypeProof-Studio-darwin-arm64.signing.json'
WORKFLOW_ARTIFACT = 'hypeproof-studio-macos-signing-receipt'
MAX_ARCHIVE = 1024**2


def validate(receipt, candidate, package, run):
    """Trust anchors come from this reviewed consumer and observed GitHub metadata."""
    require(isinstance(receipt, dict), 'Mac signing receipt object required')
    require(all(isinstance(receipt.get(key), dict) for key in
                ('provenance', 'signing', 'notarization', 'verification', 'artifact')),
            'typed Mac signing receipt sections required')
    require(receipt.get('schema') == 'hps-macos-release-signing/v1'
            and receipt.get('repository') == candidate['repository'] == REPOSITORY
            and receipt.get('source_sha') == candidate['sourceSha']
            and receipt.get('platform') == 'darwin-arm64'
            and receipt.get('bundle_id') == BUNDLE and receipt.get('team_id') == TEAM
            and receipt.get('bundle_version') == candidate['version'].removeprefix('v'),
            'Mac signing source/platform/bundle/team/version mismatch')
    require(receipt.get('release_eligible') is True, 'local or ineligible Mac signing receipt')
    require(re.fullmatch(r'[A-F0-9]{40}', str(receipt.get('certificate_sha1', ''))) is not None,
            'Developer ID certificate fingerprint required')
    provenance = receipt.get('provenance') or {}
    require(provenance.get('kind') == 'github-actions' and provenance.get('workflow') == WORKFLOW
            and type(provenance.get('run_id')) is int and provenance['run_id'] > 0
            and type(provenance.get('run_attempt')) is int and provenance['run_attempt'] > 0
            and provenance['run_id'] == run.get('id') and provenance['run_attempt'] == run.get('run_attempt'),
            'Mac signing workflow/run/attempt mismatch')
    require(run.get('path') == WORKFLOW and run.get('head_sha') == candidate['sourceSha']
            and run.get('head_branch') == candidate['tag'] and run.get('event') in {'push', 'workflow_dispatch'}
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'Mac signing requires the exact successful trusted build run')
    require(receipt.get('signing') == {'type': 'Developer ID Application', 'hardened_runtime': True, 'secure_timestamp': True}
            and all(type(receipt['signing'].get(key)) is bool for key in ('hardened_runtime', 'secure_timestamp')),
            'Developer ID runtime/timestamp verification required')
    notary = receipt.get('notarization') or {}
    require(notary.get('status') == 'Accepted'
            and re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', str(notary.get('submission_id', '')))
            and re.fullmatch(r'[a-f0-9]{64}', str(notary.get('submitted_archive_sha256', ''))),
            'Accepted notarization submission identity required')
    verification = receipt.get('verification') or {}
    require(all(verification.get(key) is True for key in ('codesign', 'stapler', 'gatekeeper')),
            'Mac codesign/stapler/Gatekeeper checks required')
    artifact = receipt.get('artifact') or {}
    require(artifact.get('name') == package.get('name') == PACKAGE
            and artifact.get('sha256') == package.get('sha256')
            and re.fullmatch(r'[a-f0-9]{64}', str(artifact.get('sha256', '')))
            and type(artifact.get('bytes')) is int and artifact['bytes'] > 0
            and artifact['bytes'] == package.get('size'), 'Mac receipt does not bind final ZIP bytes')
    return receipt


def collect(github, candidate, assets, package, directory, run_id=None):
    """Compare release receipt to immutable Actions bytes, never self-asserted JSON."""
    directory = Path(directory)
    rows = [a for a in assets if a['name'] == RECEIPT]
    require(len(rows) == 1 and 0 < rows[0]['size'] <= 65536, 'one bounded official Mac signing receipt required')
    asset = rows[0]
    github.download(REPOSITORY, asset, directory / RECEIPT)
    raw = (directory / RECEIPT).read_bytes()
    require(len(raw) == asset['size'] and asset.get('digest') == 'sha256:' + hashlib.sha256(raw).hexdigest(),
            'Mac receipt download differs from release asset identity')
    try:
        receipt = json.loads(raw)
    except (ValueError, UnicodeError):
        require(False, 'invalid Mac signing receipt JSON')
    provenance = receipt.get('provenance') if isinstance(receipt, dict) else None
    require(isinstance(provenance, dict), 'typed Mac signing provenance required')
    claimed_run = provenance.get('run_id')
    require(type(claimed_run) is int and claimed_run > 0 and (run_id is None or claimed_run == run_id),
            'Mac receipt run differs from collected build')
    run = github.api(f'repos/{REPOSITORY}/actions/runs/{claimed_run}')
    validate(receipt, candidate, package, run)
    artifacts = []
    for page in range(1, 11):
        value = github.api(f'repos/{REPOSITORY}/actions/runs/{claimed_run}/artifacts?per_page=100&page={page}')
        rows = value['artifacts']; artifacts.extend(rows)
        if len(rows) < 100: break
        require(page < 10, 'Mac workflow artifact history exceeds bound')
    matches = [a for a in artifacts if a['name'] == WORKFLOW_ARTIFACT and not a.get('expired')]
    require(len(matches) == 1, 'one unexpired trusted Mac workflow artifact required')
    workflow_asset = matches[0]
    require(type(workflow_asset.get('id')) is int and workflow_asset['id'] > 0
            and type(workflow_asset.get('size_in_bytes')) is int and 0 < workflow_asset['size_in_bytes'] <= MAX_ARCHIVE
            and workflow_asset.get('workflow_run', {}).get('id') == claimed_run
            and workflow_asset['workflow_run'].get('head_sha') == candidate['sourceSha']
            and re.fullmatch(r'sha256:[a-f0-9]{64}', str(workflow_asset.get('digest', ''))),
            'Mac workflow artifact source/digest mismatch')
    # Reruns must not reuse a previous attempt's artifact with a self-edited receipt.
    require(run.get('run_started_at') and workflow_asset.get('created_at')
            and run['run_started_at'] <= workflow_asset['created_at'] <= run['updated_at'],
            'Mac workflow artifact is stale for the current attempt')
    with tempfile.TemporaryDirectory(prefix='hps-mac-proof-') as temporary:
        archive = Path(temporary) / 'workflow.zip'
        github.artifact_zip(REPOSITORY, workflow_asset['id'], archive)
        require(archive.is_file() and not archive.is_symlink() and 0 < archive.stat().st_size <= MAX_ARCHIVE,
                'Mac Actions receipt archive exceeds bound')
        with archive.open('rb') as stream:
            require('sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest() == workflow_asset['digest'],
                    'Mac Actions archive digest mismatch')
        try:
            with zipfile.ZipFile(archive) as zipped:
                require(zipped.namelist() == [RECEIPT], 'trusted Mac artifact must contain only the final receipt')
                require(zipped.getinfo(RECEIPT).file_size == len(raw) and zipped.read(RECEIPT) == raw,
                        'release Mac signing receipt differs from trusted workflow bytes')
        except zipfile.BadZipFile:
            require(False, 'invalid Mac workflow artifact archive')
    return {'schema': 'hype-release-macos-evidence/1', 'status': 'official', 'receipt': receipt,
            'receiptDigest': digest(receipt), 'receiptAsset': {'id': asset['id'], 'name': RECEIPT,
                'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)},
            'workflowArtifact': {key: workflow_asset[key] for key in ('id', 'name', 'digest', 'created_at')},
            'run': {**{key: run[key] for key in ('id', 'run_attempt', 'path', 'head_sha', 'head_branch', 'event',
                'status', 'conclusion', 'run_started_at', 'updated_at')}, 'repository': {'full_name': REPOSITORY}}}


def require_official(state):
    evidence = state.get('macSigning') or {}
    require(evidence.get('schema') == 'hype-release-macos-evidence/1' and evidence.get('status') == 'official',
            'legacy Mac evidence is readable but cannot authorize official publication; collect official signing evidence')
    packages = [a for a in state['artifacts'] if a.get('name') == PACKAGE]
    require(len(packages) == 1, 'one collected final Mac ZIP required')
    validate(evidence.get('receipt'), state['candidate'], packages[0], evidence.get('run') or {})
    require(evidence.get('receiptDigest') == digest(evidence['receipt']), 'stored Mac signing receipt changed')
    asset, workflow = evidence.get('receiptAsset') or {}, evidence.get('workflowArtifact') or {}
    require(asset.get('name') == RECEIPT and type(asset.get('id')) is int and asset['id'] > 0
            and type(asset.get('size')) is int and 0 < asset['size'] <= 65536
            and re.fullmatch(r'[a-f0-9]{64}', str(asset.get('sha256', '')))
            and workflow.get('name') == WORKFLOW_ARTIFACT and type(workflow.get('id')) is int and workflow['id'] > 0
            and re.fullmatch(r'sha256:[a-f0-9]{64}', str(workflow.get('digest', ''))),
            'stored Mac signing artifact identities required')
    return evidence


def verify_remote(github, state, release):
    evidence = require_official(state)
    package = next(a for a in state['artifacts'] if a.get('name') == PACKAGE)
    remote = [a for a in release['assets'] if a['name'] == PACKAGE]
    require(release.get('tag_name') == state['candidate']['tag'] and len(remote) == 1
            and remote[0].get('digest') == 'sha256:' + package['sha256'] and remote[0]['size'] == package['size']
            and ('assetId' not in package or remote[0]['id'] == package['assetId']),
            'remote final Mac ZIP changed or belongs to another candidate')
    with tempfile.TemporaryDirectory(prefix='hps-mac-recheck-') as temporary:
        current = collect(github, state['candidate'], release['assets'], package, temporary, evidence['run']['id'])
    require(current == evidence, 'official Mac evidence changed; preserve old evidence and reconcile')
    return current


def status(state):
    mac = 'legacy'
    if state.get('macSigning'):
        try:
            require_official(state)
            mac = 'official'
        except Blocked:
            mac = 'invalid'
    return {'darwin-arm64': mac,
            'ios': 'NOT_EVALUATED', 'scope': 'Mac signing only; not installed-app, human acceptance or TestFlight shipment'}
