"""Bounded issue creation and admission through the existing controller only."""
import json
import re
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from core import digest, public_payload, require, utc, now, money
import routing

def controller_cli():
    candidates = [Path(os.environ['HYPEPROOF_HARNESS'])] if os.environ.get('HYPEPROOF_HARNESS') else [Path(__file__).resolve().parents[2]]
    if not os.environ.get('HYPEPROOF_HARNESS'):
        proc = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                              capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            candidates.append(Path(proc.stdout.strip()).parent.parent / 'hypeproof-harness')
    for root in candidates:
        entry = root / 'scripts/loop/remediation_cli.py'
        if entry.is_file():
            proc = subprocess.run(['git', '-C', str(root), 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=10)
            require(proc.returncode == 0 and proc.stdout.strip().removesuffix('.git') in {
                'https://github.com/hypeproof/hypeproof-harness', 'git@github.com:hypeproof/hypeproof-harness'},
                'controller must come from the canonical Harness checkout')
            return entry
    require(False, 'canonical existing controller unavailable; configure HYPEPROOF_HARNESS, do not start a second solver')


def _controller(arguments):
    proc = subprocess.run([sys.executable, str(controller_cli()), *arguments], capture_output=True, text=True, timeout=90)
    value = json.loads(proc.stdout) if proc.stdout.strip() else {'status': 'BLOCKED', 'reason': 'controller did not return a receipt'}
    require(proc.returncode == 0, value.get('reason', 'controller admission failed; reconcile the existing queue'))
    return value


def envelope(task, policy, candidate):
    scope = policy['routing'].get('remediationScopes', {}).get(task['caseId'])
    require(scope, 'reviewed implementation scope missing; ask the responsible owner')
    require(type(scope.get('estimated_lines')) is int and 0 < scope['estimated_lines'] <= 400,
            'split remediation into a bounded existing-loop slice')
    brief = {k: scope[k] for k in ('title', 'next_action', 'requirements', 'positive_control', 'negative_control', 'implementation_paths')}
    brief['next_action'] += '\nExpected: ' + task['expected'] + '\nObserved: ' + task['observed'] + '\nEvidence: ' + task['evidence']
    value = {'schema': 'hype-release-remediation/1', 'repository': task['repository'], 'failureId': task['id'],
             'executorIdentity': task['executorIdentity'],
             'dispatchKey': task['dispatchKey'], 'estimated_lines': scope['estimated_lines'],
             'maxFixIterations': min(scope.get('maxFixIterations', 0), task['reservedInvocationLimit'] - 1),
             'originReleasePr': task['originReleasePr'], 'originCandidate': task['originCandidate'], 'brief': brief}
    value['resultSink'] = {'schema': 'hype-release-result-sink/1', 'stateRepository': candidate['repository'],
                           'candidate': candidate, 'policy': policy, 'policyDigest': digest(policy), 'taskId': task['id']}
    return public_payload(value)


def execution_allowance(policy, task):
    grants = policy['routing'].get('executionAllowances')
    if grants is None:
        return policy['routing'].get('executionAllowance') or {}
    require(isinstance(grants, dict) and grants and all(re.fullmatch(r'BB-\d{3}:(?:win32-x64|darwin-arm64)', key)
            and isinstance(value, dict) and isinstance(value.get('reservationId'), str) and value['reservationId']
            for key, value in grants.items()), 'reviewed case/platform executor grants required')
    identifiers = [value['reservationId'] for value in grants.values()]
    require(len(set(identifiers)) == len(identifiers), 'executor grants must have distinct included reservations')
    key = task['caseId'] + ':' + task['platform']
    require(key in grants, 'no reviewed executor grant for this failed case/platform')
    return grants[key]


def execution_request(state, policy, registry, task_id):
    task = next((t for t in registry.preview(state, policy)['remediations'] if t['id'] == task_id), None)
    require(task, 'no current failed item for this task')
    scope = policy['routing'].get('remediationScopes', {}).get(task['caseId'])
    require(scope, 'reviewed implementation scope missing')
    return {'taskId': task_id, 'scopeDigest': digest(scope),
            'allowanceDigest': digest(execution_allowance(policy, task))}


def remediate(state, policy, registry, github, task_id, controller=_controller):
    require(policy.get('routing', {}).get('mode') == 'active', 'shadow mode never creates an issue or admits development')
    task = next((t for t in registry.preview(state, policy)['remediations'] if t['id'] == task_id), None)
    require(task, 'no current failed item for this remediation')
    allowance = execution_allowance(policy, task)
    require(allowance.get('status') == 'CONFIRMED' and allowance.get('evidence') and allowance.get('resourceId')
            and allowance.get('reservationId') and allowance.get('paidFallback') is False,
            'confirmed reserved executor allowance required; unknown capacity is BLOCKED')
    require(utc(allowance.get('observedAt')) <= utc(now()) < utc(allowance.get('expiresAt')), 'executor allowance expired or from the future')
    require(type(allowance.get('maxInvocations')) is int and allowance['maxInvocations'] >= policy['routing']['maxFixAttempts'],
            'executor allowance does not cover the complete bounded invocation block')
    require(money(allowance.get('upperBoundUsd')) <= money(policy['budgetLimitUsd']), 'executor allowance exceeds release budget')
    request_binding = execution_request(state, policy, registry, task_id)
    operation = state.get('operations', {}).get('remediate-' + task_id)
    require(operation and operation.get('kind') == 'release-remediation' and operation.get('status') == 'UNKNOWN'
            and operation.get('request') == request_binding
            and operation.get('requestDigest') == digest({'kind': 'release-remediation', 'request': request_binding})
            and money(operation['reservedUsd']) >= money(allowance['upperBoundUsd']),
            'durable cumulative candidate budget reservation required before any executor side effect')
    plan = registry.update(state, policy)
    task = next((t for t in plan['remediations'] if t['id'] == task_id), None)
    require(task is not None, 'no current failed item for this remediation')
    probe = controller(['--probe'])  # no issue, budget reservation or model work without a live configured controller
    executor_identity = probe.get('executorIdentity', '')
    require(probe.get('status') == 'READY' and re.fullmatch(r'[a-f0-9]{64}', executor_identity), 'live executor identity missing')
    created_reservation = task['status'] == 'queued'
    if created_reservation:
        def reserve(working):
            reserved = routing.reserve_fix(working, policy, task_id, executor_identity)
            record = reserved['routing']['tasks'][task_id]
            require(not any(t.get('executionAllowance', {}).get('reservationId') == allowance['reservationId']
                            for key, t in reserved['routing']['tasks'].items() if key != task_id),
                    'executor reservation already belongs to another failure')
            record['executionAllowance'] = allowance
            return reserved
        plan = registry.update(state, policy, reserve)
        task = next(t for t in plan['remediations'] if t['id'] == task_id)
    require(task.get('executorIdentity') == executor_identity,
            'another controller owns this remediation; reconcile its work before transferring the lease')
    require(task['status'] in {'dispatch_unknown', 'issue_ready', 'admitted'}, 'task needs explicit reconciliation')
    request = envelope(task, policy, state['candidate'])
    marker = '<!-- hype-release-remediation:' + digest(request) + ' -->'
    matches = []
    for page in github.pages(f"repos/{task['repository']}/issues?state=all"):
        matches += [i for i in page if 'pull_request' not in i and marker in (i.get('body') or '')]
    require(len(matches) <= 1, 'duplicate remediation issues need reconciliation')
    if not matches:
        require(created_reservation, 'UNKNOWN issue creation; inspect provider records instead of replaying POST')
        claim = '<!-- hype-release-executor:' + task['dispatchKey'] + ':' + task['executorIdentity'] + ' -->'
        body = (marker + '\n' + claim + '\n\nClaimed by hypeproof-agent[bot] for branch `loop/release-' + task['dispatchKey'][:24] + '`.'
                + f"\n\nRelease PR: #{task['originReleasePr']}\nCandidate: {task['originCandidate']['sourceSha']}"
                + '\n\nExpected: ' + task['expected'] + '\nObserved: ' + task['observed'] + '\nEvidence: ' + task['evidence']
                + '\n\n## Acceptance criteria\n' + request['brief']['positive_control']
                + '\nNegative control: ' + request['brief']['negative_control']
                + '\n\nFix this bounded failure in a separate development PR. Preserve the checklist; do not change release-package bytes or use a release-record branch for product changes.')
        public_payload({'body': body})
        matches = [github.api(f"repos/{task['repository']}/issues", 'POST', {'title': request['brief']['title'], 'body': body, 'labels': ['wip']})]
    issue = matches[0]
    require(isinstance(issue, dict), 'UNKNOWN issue creation response; reconcile instead of replaying')
    require(issue.get('state') == 'open' and type(issue.get('number')) is int, 'remediation issue is closed or unavailable')
    request['issue'] = issue['number']

    def issue_receipt(working):
        record = working['routing']['tasks'][task_id]
        require(record['dispatchKey'] == task['dispatchKey'], 'dispatch identity changed')
        require(not record.get('issue') or record['issue'] == issue['number'], 'issue receipt changed')
        record.update(issue=issue['number'], status='issue_ready')
        return working
    registry.update(state, policy, issue_receipt)
    with tempfile.TemporaryDirectory(prefix='hype-release-admission-') as directory:
        path = Path(directory) / 'request.json'
        path.write_text(json.dumps(request, ensure_ascii=False), encoding='utf-8')
        receipt = controller(['--file', str(path)])
    require(receipt.get('action') in {'admitted', 'already_admitted'} and receipt.get('item'), 'missing controller admission receipt')

    def admitted(working):
        record = working['routing']['tasks'][task_id]
        record.update(status='admitted', executorReceipt=receipt)
        return working
    registry.update(state, policy, admitted)
    return {'status': 'ADMITTED', 'failureId': task_id, 'issue': issue['number'], 'receipt': receipt,
            'agentDispatched': receipt.get('agentDispatched', False)}


def reconcile_remediation(state, policy, registry, task_id, controller=_controller):
    task = registry.task(task_id)
    require(task and task.get('repository') == state['candidate']['repository'], 'task belongs to another product')
    require(task and task.get('executorIdentity') and task.get('dispatchKey'), 'no reserved remediation dispatch')
    receipt = controller(['--status-key', task['dispatchKey']])
    require(receipt.get('executorIdentity') == task['executorIdentity'] and receipt.get('dispatchKey') == task['dispatchKey']
            and receipt.get('issue') == task.get('issue'), 'controller receipt belongs to another dispatch')

    def record(working):
        current = working['routing']['tasks'][task_id]
        current['controllerStatus'] = receipt
        current['executorReceipt'] = {**current.get('executorReceipt', {}), 'agentDispatched': receipt.get('agentDispatched', False)}
        if receipt.get('state') in {'merged', 'merged_main_verified'}:
            require(receipt.get('mergeCommit'), 'merged status requires actual merge identity')
            current['status'] = 'merged_retest_required'
        elif receipt.get('state') in {'needs_human', 'parked', 'released', 'reverted'}:
            current['status'] = 'blocked'
            current['blockedReason'] = 'Existing executor stopped at ' + receipt['state'] + '; inspect its evidence and restore prerequisites or authorize the next bounded action.'
        return working
    updated_plan = registry.update(state, policy, record)
    return {'status': 'RECONCILED', 'receipt': receipt, 'plan': updated_plan}
