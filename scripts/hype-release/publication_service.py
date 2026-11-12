"""Bounded automatic PASS delivery through Studio's existing trusted publisher.

The candidate CAS reserves each effect before it happens. Unknown uploads or
dispatches are observed by their immutable identities, never blindly replayed.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from core import canonical, digest, require, reserve, settle, utc, now
import publisher
import macos_signing

EVIDENCE_REPOSITORY = 'hypeproof/hypeproof-studio-releases'
WORKFLOW = 'release-promote.yml'
SHA = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')


def studio_call(checkout, revision, command, value, node='node'):
    root = Path(checkout).resolve()
    require(SHA.fullmatch(revision), 'exact reviewed Studio source revision required')
    def git(*args):
        result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, encoding='utf-8', timeout=20)
        require(result.returncode == 0, 'reviewed Studio checkout unavailable')
        return result.stdout.strip()
    require(git('remote', 'get-url', 'origin').removesuffix('.git') in {
        'https://github.com/hypeproof/hypeproof-studio', 'git@github.com:hypeproof/hypeproof-studio'}, 'official Studio origin required')
    require(git('rev-parse', 'HEAD') == revision and not git('status', '--porcelain', '--untracked-files=all', '--',
            'scripts/release', 'config/release-automation.json'), 'reviewed Studio source changed')
    # Status trusts index flags. Compare tracked working bytes to immutable blobs
    # too, so assume-unchanged/skip-worktree cannot replace the reviewed verifier.
    tracked = subprocess.run(['git', '-C', str(root), 'ls-tree', '-rz', revision, '--',
                              'scripts/release', 'config/release-automation.json',
                              'e2e/unified-release/artifact.mjs', 'package.json', 'package-lock.json'],
                             capture_output=True, timeout=20, check=True).stdout
    for entry in tracked.split(b'\0'):
        if not entry: continue
        header, name = entry.split(b'\t', 1)
        mode, kind, sha = header.split()
        path = root / name.decode('utf-8')
        require(mode in {b'100644', b'100755'} and kind == b'blob' and path.is_file() and not path.is_symlink(),
                'regular reviewed Studio source required')
        for parent in path.parents:
            if parent == root: break
            require(not parent.is_symlink(), 'linked Studio source parent refused')
        expected = subprocess.run(['git', '-C', str(root), 'cat-file', 'blob', sha.decode()],
                                  capture_output=True, check=True, timeout=20).stdout
        require(path.read_bytes() == expected, 'reviewed Studio source bytes differ from immutable commit')
    result = subprocess.run([node, str(Path(__file__).with_name('studio_adapter.mjs')), str(root), command],
                            input=canonical(value), capture_output=True, text=True, encoding='utf-8', timeout=180)
    require(result.returncode == 0, 'official Studio adapter refused input; inspect private diagnostics, preserve reservation')
    return json.loads(result.stdout)


def execution_request(state, policy, registry, product, workflow_head):
    macos_signing.require_official(state)
    current = publisher.producer_input(state, policy, registry)
    contract = product['contract']
    require(current['plan']['status'] == 'READY' and policy['routing']['mode'] == 'active'
            and product['config']['mode'] == 'active', 'active complete effective PASS required')
    require(contract['repository'] == state['candidate']['repository'] == 'hypeproof/hypeproof-studio'
            and contract['candidate'] == state['candidate']['sourceSha'] and contract['rcTag'] == state['candidate']['tag']
            and contract['releasePr'] == current['contract']['releasePr'] and SHA.fullmatch(workflow_head),
            'current product contract and default-branch workflow identity required')
    # Contract fields are JSON without non-integral values (sizes, PR IDs only).
    # The signed full bundle digest is obtained from the official JS producer.
    request = {'repository': contract['repository'], 'releasePr': contract['releasePr'],
               'releaseHead': contract['releaseHead'], 'candidateSha': contract['candidate'], 'rcTag': contract['rcTag'],
               'readinessDigest': current['plan']['readinessDigest'], 'contractDigest': digest(contract),
               'workflow': WORKFLOW, 'workflowHead': workflow_head,
               'allowanceDigest': digest(policy['routing'].get('publicationAllowance'))}
    request['dispatchKey'] = digest(request)
    return request


def begin(session, registry, product, workflow_head, operation_id, quote):
    request = execution_request(session.state, session.policy, registry, product, workflow_head)
    allowance = session.policy['routing'].get('publicationAllowance') or {}
    require(allowance.get('status') == 'CONFIRMED' and allowance.get('paidFallback') is False
            and allowance.get('resourceId') and allowance.get('reservationId') and allowance.get('evidence')
            and allowance.get('maxInvocations') == 1,
            'confirmed capacity covering one private upload and trusted publication dispatch required')
    require(quote.get('upperBoundUsd') == allowance.get('upperBoundUsd'), 'quote must cover the complete configured effect block')
    require(utc(allowance.get('observedAt')) <= utc(now()) < utc(allowance.get('expiresAt')),
            'publication capacity is expired or from the future')
    state, operation, duplicate = reserve(session.state, session.policy, session.actor, operation_id,
                                          'publish-pass', request, quote)
    if duplicate:
        return {'duplicate': True, **operation['result']}
    registry.reserve_publication(session.state, operation_id, request, allowance)
    session.save(state)
    return publisher.producer_input(session.state, session.policy, registry, operation_id)


class PrivateGitHub:
    """Every private evidence request gets a distinct one-repository App token."""
    def __init__(self, harness):
        self.wrapper = Path(harness) / 'scripts/agent-identity/with-agent-identity.sh'
        require(self.wrapper.is_file(), 'canonical App wrapper required')

    def api(self, path, method='GET', data=None):
        require(path.startswith(f'repos/{EVIDENCE_REPOSITORY}/') or path == f'repos/{EVIDENCE_REPOSITORY}',
                'private transport path outside fixed repository')
        args = [str(self.wrapper), 'gh', 'api', '--method', method, path]
        if data is not None: args += ['--input', '-']
        env = {**os.environ, 'HYPEPROOF_AGENT_REPOSITORY': EVIDENCE_REPOSITORY}
        env.pop('HYPEPROOF_AGENT_WORKFLOWS', None)
        proc = subprocess.run(args, input=canonical(data) if data is not None else None, env=env,
                              text=True, encoding='utf-8', capture_output=True, timeout=120)
        require(proc.returncode == 0, 'private App request uncertain; preserve reserved operation and reconcile immutable commit')
        return json.loads(proc.stdout) if proc.stdout.strip() else None


def _files(directory, bundle):
    root = Path(directory).resolve()
    require(not Path(directory).is_symlink(), 'linked bundle root refused')
    body = bundle['body']
    records = {file['sha256']: file for file in body.get('attachments', [])}
    candidate = body['state']['candidates'][body['intent']['candidateId']]
    for test in body['policy']['requiredTests']:
        file = candidate['evidence'][test['id']]['body']['file']
        records[file['sha256']] = file
    require(records and len(records) <= 1000, 'bounded complete proof files required')
    paths = [('bundle.json', root / 'bundle.json')]
    total = 0
    for sha, record in sorted(records.items()):
        require(HASH.fullmatch(sha) and type(record['size']) is int and 0 < record['size'] <= 25 * 1024 * 1024,
                'bounded content-addressed proof required')
        path = root / 'blobs' / sha
        require(not (root / 'blobs').is_symlink() and path.is_file() and not path.is_symlink(), 'regular proof bytes required')
        raw = path.read_bytes(); total += len(raw)
        require(len(raw) == record['size'] and hashlib.sha256(raw).hexdigest() == sha, 'proof bytes differ from signed bundle')
        paths.append(('blobs/' + sha, path))
    require(total <= 100 * 1024 * 1024 and paths[0][1].stat().st_size <= 5 * 1024 * 1024, 'private transfer exceeds bounded capacity')
    return paths


def prepare_upload(session, registry, directory, bundle_digest, private):
    """Prepare an immutable Git commit, persist its identity, then update one ref.

    Unreferenced blobs/trees are not publication. A lost ref response leaves the
    saved commit as the sole reconciliation target; a second upload is refused.
    """
    operation_id = next((key for key, op in session.state['operations'].items()
                         if op['kind'] == 'publish-pass' and op['status'] == 'UNKNOWN'), None)
    require(operation_id, 'durable publish-pass reservation required before private upload')
    operation = session.state['operations'][operation_id]
    require(not operation.get('result'), 'private upload already prepared; observe it instead of replaying')
    bundle_path = Path(directory) / 'bundle.json'
    require(bundle_path.is_file() and not bundle_path.is_symlink(), 'regular signed bundle required')
    bundle = json.loads(bundle_path.read_text(encoding='utf-8'))
    anchor = publisher.producer_input(session.state, session.policy, registry, operation_id)['anchor']
    require(bundle['body'].get('publisherAnchor') == anchor and HASH.fullmatch(bundle_digest), 'assembled bundle is stale for current CAS')
    contract = bundle['body']['contract']
    request = operation['request']
    require(digest(contract) == request['contractDigest'] and contract['releasePr'] == request['releasePr'], 'bundle names another product contract')
    files = _files(directory, bundle)
    info = private.api(f'repos/{EVIDENCE_REPOSITORY}')
    require(info.get('private') is True and re.fullmatch(r'[A-Za-z0-9._/-]+', info.get('default_branch', '')),
            'fixed evidence repository must remain private')
    branch = info['default_branch']
    base = private.api(f'repos/{EVIDENCE_REPOSITORY}/git/ref/heads/{branch}')['object']['sha']
    require(SHA.fullmatch(base), 'exact private base commit required')
    tree = private.api(f'repos/{EVIDENCE_REPOSITORY}/git/commits/{base}')['tree']['sha']
    entries = []
    prefix = f"blackbox/machine/{request['releasePr']}/"
    state = copy.deepcopy(session.state)
    state['operations'][operation_id]['result'] = {
        'uploadAttempted': True, 'phase': 'PRIVATE_WRITES_STARTED', 'bundleDigest': bundle_digest,
        'dispatchKey': request['dispatchKey'], 'privateBranch': branch, 'privateBase': base}
    session.save(state)  # Even a lost blob/tree/commit response must never replay writes.
    for name, path in files:
        blob = private.api(f'repos/{EVIDENCE_REPOSITORY}/git/blobs', 'POST',
                           {'content': base64.b64encode(path.read_bytes()).decode(), 'encoding': 'base64'})
        entries.append({'path': prefix + name, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    created = private.api(f'repos/{EVIDENCE_REPOSITORY}/git/trees', 'POST', {'base_tree': tree, 'tree': entries})
    commit = private.api(f'repos/{EVIDENCE_REPOSITORY}/git/commits', 'POST',
                         {'message': 'release: immutable machine evidence ' + request['dispatchKey'],
                          'tree': created['sha'], 'parents': [base]})['sha']
    require(SHA.fullmatch(commit), 'private commit response uncertain; reconcile provider records')
    prepared = {'uploadAttempted': True, 'bundleDigest': bundle_digest, 'evidenceCommit': commit, 'dispatchKey': request['dispatchKey'],
                'privateBranch': branch, 'privateBase': base, 'privateUploaded': False, 'dispatchAttempted': False}
    state = copy.deepcopy(session.state)
    state['operations'][operation_id]['result'] = prepared
    session.save(state)  # Persist before the only branch update.
    private.api(f'repos/{EVIDENCE_REPOSITORY}/git/refs/heads/{branch}', 'PATCH', {'sha': commit, 'force': False})
    return observe_upload(session, operation_id, private)


def observe_upload(session, operation_id, private):
    op = session.state['operations'][operation_id]
    receipt = op.get('result') or {}
    require(op['status'] == 'UNKNOWN' and SHA.fullmatch(receipt.get('evidenceCommit', '')),
            'prepared immutable upload receipt required')
    compare = private.api(f"repos/{EVIDENCE_REPOSITORY}/compare/{receipt['evidenceCommit']}...{receipt['privateBranch']}")
    require(compare.get('status') in {'identical', 'ahead'}, 'UNKNOWN private ref update; no automatic replay')
    state = copy.deepcopy(session.state)
    state['operations'][operation_id]['result']['privateUploaded'] = True
    session.save(state)
    return state['operations'][operation_id]['result']


def dispatch(session, registry, operation_id, github):
    op = session.state['operations'][operation_id]
    require(op['kind'] == 'publish-pass' and op['status'] == 'UNKNOWN', 'pending bounded publisher operation required')
    publisher.producer_input(session.state, session.policy, registry, operation_id)
    request, receipt = op['request'], op.get('result') or {}
    require(receipt.get('privateUploaded') is True and receipt.get('dispatchAttempted') is False, 'observe pending dispatch instead of replaying')
    current = github.api(f"repos/{request['repository']}/commits/main")
    require(current['sha'] == request['workflowHead'], 'publisher code changed; reconcile reserved operation')
    workflow = github.api(f"repos/{request['repository']}/actions/workflows/{WORKFLOW}")
    require(workflow.get('state') == 'active' and workflow.get('path') == '.github/workflows/' + WORKFLOW,
            'existing trusted workflow is not active')
    macos_signing.verify_remote(github, session.state, github.release(request['repository'], session.candidate['tag']))
    state = copy.deepcopy(session.state)
    state['operations'][operation_id]['result']['dispatchAttempted'] = True
    session.save(state)  # Mark attempt before POST; timeout is observation-only.
    github.api(f"repos/{request['repository']}/actions/workflows/{WORKFLOW}/dispatches", 'POST',
               {'ref': 'main', 'inputs': {'pr': str(request['releasePr']),
                'machine_evidence_commit': receipt['evidenceCommit'], 'machine_dispatch_key': request['dispatchKey']}})
    return observe_dispatch(session, operation_id, github)


def observe_dispatch(session, operation_id, github):
    op = session.state['operations'][operation_id]
    if op['status'] == 'DONE': return op['result']
    request, receipt = op['request'], op.get('result') or {}
    require(receipt.get('dispatchAttempted') is True, 'no recorded dispatch attempt to observe')
    name = f"release-promote-{request['releasePr']}-{request['dispatchKey']}"
    matches = []
    page = 1
    while True:
        runs = github.api(f"repos/{request['repository']}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100&page={page}")['workflow_runs']
        matches += [run for run in runs if run.get('event') == 'workflow_dispatch'
                    and run.get('head_sha') == request['workflowHead'] and run.get('head_branch') == 'main'
                    and run.get('display_title') == name and run.get('actor', {}).get('login') == 'hypeproof-agent[bot]']
        if len(runs) < 100: break
        require(page < 10, 'dispatch observation exceeded bounded history; reconcile provider records')
        page += 1
    require(len(matches) == 1, 'UNKNOWN dispatch: one exact App-authored parent run must be observed; do not replay POST')
    result = {**receipt, 'runId': matches[0]['id'], 'runUrl': matches[0]['html_url'], 'publication': 'NOT_RUN'}
    session.save(settle(session.state, operation_id, 'DONE', result))
    return result


def observe_publication(session, operation_id, github):
    op = session.state['operations'][operation_id]
    require(op['kind'] == 'publish-pass' and op['status'] == 'DONE', 'observed publisher dispatch required')
    request, receipt = op['request'], op['result']
    run = github.api(f"repos/{request['repository']}/actions/runs/{receipt['runId']}")
    require(run.get('conclusion') == 'success' and run.get('head_sha') == request['workflowHead'],
            'publisher parent run is incomplete or failed')
    release = github.release(request['repository'], session.candidate['version'])
    require(release.get('draft') is False and release.get('prerelease') is False
            and release.get('published_at') and release.get('tag_name') == session.candidate['version'],
            'formal release not observed')
    tag = github.api(f"repos/{request['repository']}/git/ref/tags/{session.candidate['version']}")['object']
    for _ in range(8):
        if tag.get('type') == 'commit': break
        require(tag.get('type') == 'tag' and SHA.fullmatch(tag.get('sha', '')), 'formal tag identity unavailable')
        tag = github.api(f"repos/{request['repository']}/git/tags/{tag['sha']}")['object']
    require(tag.get('type') == 'commit' and tag.get('sha') == request['candidateSha'], 'formal release tag names another candidate')
    remote = {a['name']: a for a in release.get('assets', [])}
    for artifact in session.state['artifacts']:
        require(artifact['name'] in remote and remote[artifact['name']]['size'] == artifact['size']
                and remote[artifact['name']].get('digest') == 'sha256:' + artifact['sha256'],
                'formal release package bytes differ from this candidate')
    signing = macos_signing.require_official(session.state)['receiptAsset']
    require(signing['name'] in remote and remote[signing['name']]['size'] == signing['size']
            and remote[signing['name']].get('digest') == 'sha256:' + signing['sha256'],
            'formal release signing receipt differs from collected immutable evidence')
    # A workflow dispatch/PR merge alone never completes this candidate.
    state = copy.deepcopy(session.state)
    state['stablePublished'] = True
    state['publicationReceipt'] = {'operationId': operation_id, 'runId': run['id'], 'releaseId': release['id'],
                                   'releaseUrl': release['html_url'], 'publishedAt': release['published_at']}
    session.save(state)
    return state['publicationReceipt']
