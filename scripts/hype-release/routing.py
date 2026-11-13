"""Durable result routing. READY is input to a trusted publisher, never approval."""
from __future__ import annotations

import copy
import re
import delivery_coverage

from core import Blocked, digest, evidence_key, now, public_payload, require

SCHEMA = 'hype-release-routing/1'
PLATFORMS = {'win32-x64', 'darwin-arm64'}


def contract_for(state, policy):
    """The required matrix is operator policy, never supplied by an observation."""
    config = policy.get('routing', {})
    if config.get('enabled') is not True:
        return None
    contract = config['contract']
    if contract.get('event') != 'release-candidate-ready':
        return None
    require(contract.get('repository') == 'hypeproof/hypeproof-studio'
            and contract['repository'] == state['candidate']['repository'], 'product not enrolled')
    require(type(contract.get('releasePr')) is int and contract['releasePr'] > 0, 'release PR required')
    require(config.get('mode') in {'shadow', 'active'}, 'routing mode required')
    require(type(config.get('maxFixAttempts')) is int and 1 <= config['maxFixAttempts'] <= 3,
            'bounded fix attempts required')
    require(isinstance(config.get('resolvers'), list) and config['resolvers']
            and all(isinstance(actor, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', actor) for actor in config['resolvers'])
            and len(set(config['resolvers'])) == len(config['resolvers']),
            'explicit resolver roster required')
    cases, platforms, required = contract['caseIds'], contract['platforms'], contract['required']
    require(isinstance(cases, list) and cases and all(isinstance(x, str) for x in cases)
            and len(cases) == len(set(cases)) and all(re.fullmatch(r'BB-\d{3}', x) for x in cases),
            'nonempty unique candidate checklist required')
    require(isinstance(platforms, list) and set(platforms) == PLATFORMS and len(platforms) == 2, 'both required platforms must be present')
    applicability = contract.get('casePlatforms', {case: platforms for case in cases})
    require(isinstance(applicability, dict) and set(applicability) == set(cases)
            and all(isinstance(targets, list) and targets and all(isinstance(p, str) for p in targets)
                    and len(targets) == len(set(targets)) and set(targets) <= PLATFORMS for targets in applicability.values()),
            'trusted case applicability must cover every case with supported unique targets')
    matrix = {(case, platform) for case in cases for platform in applicability[case]}
    require({platform for _, platform in matrix} == PLATFORMS, 'required platform has no checklist coverage')
    require(len(required) == len(matrix) and {(r['id'], r['platform']) for r in required} == matrix,
            'required checklist/platform matrix is incomplete or duplicated')
    check_ids = set()
    for row in required:
        identity = row['identity']
        require(identity.get('kind') == 'installed-app' and identity.get('repository') == contract['repository']
                and identity.get('sourceSha') == state['candidate']['sourceSha'], 'required candidate identity changed')
        require(identity['os'] + '-' + identity['arch'] == row['platform'], 'required platform identity changed')
        require(identity['artifactSha256'] in {a['sha256'] for a in state['artifacts']}, 'required package not collected')
        require(isinstance(row.get('expected'), str) and row['expected'].strip() and row.get('checkId') ==
                f"desktop:{row['id']}:{row['platform']}:{evidence_key(identity)}", 'required check binding differs')
        require(row['checkId'] not in check_ids, 'duplicate required check')
        check_ids.add(row['checkId'])
    if config['mode'] == 'active' or 'deliveryCoverage' in contract:
        delivery_coverage.validate(contract.get('deliveryCoverage'), state['candidate'], matrix,
            {(row['id'], row['platform']): row['identity'] for row in required})
    return contract



def _journal(state, contract):
    journal = copy.deepcopy(state.get('routing') or {
        'schema': SCHEMA, 'contractDigest': digest(contract), 'questions': {}, 'resolutions': {}, 'tasks': {}, 'history': []})
    require(journal.get('schema') == SCHEMA and journal.get('contractDigest') == digest(contract),
            'routing contract changed; reconcile explicitly or create a replacement candidate')
    return journal


def candidate_order(candidate):
    match = re.fullmatch(r'v([0-9]+)\.([0-9]+)\.([0-9]+)-rc\.([1-9][0-9]*)', candidate.get('tag', ''))
    require(match, 'ordered RC identity required')
    return tuple(map(int, match.groups()))


def _observation(state, row):
    check = state['checks'].get(row['checkId'])
    if check:
        require(check.get('id') == row['checkId'] and check.get('identity') == row['identity']
                and check.get('identityKey') == evidence_key(row['identity'])
                and check.get('expected') == row['expected'], 'observation identity or acceptance differs')
        require(check.get('verdict') in {'PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'}
                and check.get('observed') and check.get('evidence'), 'incomplete observation')
    return check, digest({'required': row, 'check': check})


def evaluate(state, policy):
    contract = contract_for(state, policy)
    if contract is None:
        return state, {'status': 'NOT_APPLICABLE', 'publication': 'NOT_RUN', 'questions': [], 'remediations': []}
    if state.get('supersededBy'):
        return state, {'status': 'BLOCKED', 'reason': 'candidate superseded', 'publication': 'NOT_RUN',
                       'questions': [], 'remediations': []}
    result = copy.deepcopy(state)
    journal = _journal(state, contract)
    journal['policySnapshot'] = copy.deepcopy(policy)
    journal['policyDigest'] = digest(policy)
    failures = journal.setdefault('failures', {})
    # Migrate known current-candidate failures without recovering an old allowance.
    for failure_id, task in journal['tasks'].items():
        if task.get('originCandidate') == state['candidate']:
            failures.setdefault(failure_id, {'observationDigest': None, 'evidence': task['evidence']})
    rows, questions, tasks = [], [], []
    for required in contract['required']:
        check, observation_digest = _observation(state, required)
        verdict = check['verdict'] if check else 'BLOCKED'
        if verdict == 'NOT_RUN':
            verdict = 'BLOCKED'
        question_id = 'question-' + digest({'candidate': state['candidate'], 'contract': digest(contract),
                                            'observation': observation_digest})
        resolution = journal['resolutions'].get(question_id)
        if resolution:
            require(resolution['observationDigest'] == observation_digest and resolution['actor'] in policy['routing']['resolvers'],
                    'resolution authority changed')
            verdict = resolution['verdict']
        if verdict == 'BLOCKED':
            question = {'id': question_id, 'caseId': required['id'], 'platform': required['platform'],
                        'observationDigest': observation_digest, 'identity': required['identity'],
                        'reason': check['observed'] if check else 'Required installed-app observation missing',
                        'evidence': check['evidence'] if check else None,
                        'question': 'Observe this exact item and determine PASS/FAIL with attributable evidence, or identify what is still missing.',
                        'resolvers': policy['routing']['resolvers']}
            journal['questions'].setdefault(question_id, question)
            questions.append(question)
        if verdict == 'FAIL':
            observed = resolution['reason'] if resolution else check['observed']
            # Source/RC is intentionally excluded: a replacement RC cannot mint a new retry allowance.
            failure_id = 'failure-' + digest({'repository': contract['repository'], 'caseId': required['id'],
                'platform': required['platform'], 'testRevision': required['identity']['testRevision'],
                'acceptanceRevision': required['identity']['acceptanceRevision'], 'expected': required['expected'],
                'signature': (check or {}).get('failureSignature', 'acceptance-mismatch')})
            task = journal['tasks'].setdefault(failure_id, {
                'id': failure_id, 'caseId': required['id'], 'platform': required['platform'],
                'repository': contract['repository'], 'originReleasePr': contract['releasePr'],
                'originCandidate': copy.deepcopy(state['candidate']), 'identity': required['identity'],
                'expected': required['expected'], 'observed': observed,
                'evidence': resolution['evidence'] if resolution else check['evidence'],
                'status': 'queued', 'attempts': 0, 'receipts': []})
            failures.setdefault(failure_id, {'observationDigest': observation_digest,
                                             'evidence': resolution['evidence'] if resolution else check['evidence']})
            tasks.append(copy.deepcopy(task))
        rows.append({'checkId': required['checkId'], 'verdict': verdict, 'observationDigest': observation_digest,
                     'resolution': question_id if resolution else None})
    result['routing'] = journal
    for failure_id in failures:
        if failure_id in journal['tasks'] and failure_id not in {task['id'] for task in tasks}:
            tasks.append(copy.deepcopy(journal['tasks'][failure_id]))
    ready = all(row['verdict'] == 'PASS' for row in rows) and not failures
    plan = {'schema': SCHEMA, 'status': 'READY' if ready else 'NOT_READY',
            'candidate': state['candidate'], 'contractDigest': digest(contract), 'rows': rows,
            'questions': questions, 'remediations': tasks,
            'candidateFailures': copy.deepcopy(failures),
            'publication': ('SHADOW' if policy['routing']['mode'] == 'shadow' else 'PUBLISHER_VALIDATION_REQUIRED') if ready else 'NOT_RUN',
            'authority': 'routing-only; the trusted publisher revalidates machine gates and exact bytes'}
    plan['executionBlockers'] = [{'failureId': t['id'], 'status': 'BLOCKED', 'question': t['blockedReason'],
                                  'receipt': t.get('controllerStatus')} for t in tasks if t.get('status') == 'blocked']
    plan['readinessDigest'] = digest(plan)
    public_payload(result)
    return result, plan


def resolve(state, policy, actor, answer):
    updated, plan = evaluate(state, policy)
    require(plan['status'] not in {'NOT_APPLICABLE', 'BLOCKED'}, 'no current candidate question')
    require(actor in policy['routing']['resolvers'], 'actor is not an authorized human resolver')
    question = next((q for q in plan['questions'] if q['id'] == answer.get('questionId')), None)
    if question is None:
        old = updated['routing']['resolutions'].get(answer.get('questionId'))
        require(old and all(old.get(k) == v for k, v in answer.items()) and old['actor'] == actor,
                'question is stale, resolved or not current')
        return updated
    require(answer.get('observationDigest') == question['observationDigest'], 'answer names an old observation')
    require(answer.get('verdict') in {'PASS', 'FAIL'} and answer.get('reason') and answer.get('evidence')
            and answer.get('execution') == 'human-observed', 'attributed observation and PASS/FAIL determination required')
    resolution = {**copy.deepcopy(answer), 'actor': actor, 'recordedAt': now()}
    updated['routing']['resolutions'][question['id']] = resolution
    updated['routing']['history'].append({'event': 'human-resolution', **resolution})
    public_payload(updated)
    return evaluate(updated, policy)[0]


def reserve_fix(state, policy, task_id, executor_identity=None):
    updated, plan = evaluate(state, policy)
    task = updated.get('routing', {}).get('tasks', {}).get(task_id)
    require(task and task_id in {t['id'] for t in plan['remediations']}, 'no current failed item for this task')
    require(task['status'] == 'queued', 'dispatch is pending or already occurred; reconcile instead of replaying')
    require(task['attempts'] < policy['routing']['maxFixAttempts'], 'fix attempt allowance exhausted; human reconciliation required')
    task['reservedInvocationLimit'] = policy['routing']['maxFixAttempts'] - task['attempts']
    # Reserve the whole bounded invocation block conservatively. A controller
    # crash/new RC cannot recover unobserved capacity by minting another lease.
    task['attempts'] = policy['routing']['maxFixAttempts']
    task['status'] = 'dispatch_unknown'
    task['dispatchKey'] = digest({'failure': task_id, 'attempt': task['attempts']})
    if executor_identity:
        require(re.fullmatch(r'[a-f0-9]{64}', executor_identity), 'live executor binding required')
        task['executorIdentity'] = executor_identity
    return updated


class Registry:
    """One product-wide CAS store retains failure budgets across RCs and hosts.

    Reuses GitHubStore/LocalGitStore with the stable registry key instead of an
    individual RC tag. Observations still live in their original candidate store.
    """
    def __init__(self, store):
        self.store = store

    def task(self, task_id):
        registry, _ = self.store.read()
        require(registry and registry.get('schema') == SCHEMA, 'routing registry unavailable')
        return copy.deepcopy(registry['tasks'].get(task_id))

    def activate(self, state, policy):
        """Only the source-verified coordinator activates the newest RC, never a callback."""
        contract = contract_for(state, policy)
        require(contract is not None, 'only an enrolled RC can be activated')
        registry, revision = self.store.read()
        registry = copy.deepcopy(registry or {'schema': SCHEMA, 'revision': 0, 'candidates': {}, 'tasks': {}})
        require(registry.get('schema') == SCHEMA, 'unknown routing registry')
        key, previous = digest(state['candidate']), registry.get('activeCandidate')
        if previous and previous != key:
            prior = registry['candidates'][previous]
            require(candidate_order(state['candidate']) > candidate_order(prior['candidate']),
                    'older or changed same-tag RC cannot replace the active candidate')
            prior['supersededBy'] = key
        journal = registry['candidates'].get(key) or _journal(state, contract)
        require(journal['contractDigest'] == digest(contract) and not journal.get('supersededBy'),
                'reconcile changed/superseded candidate input instead of reactivating it')
        if not journal.get('sequence'):
            sequence = registry.get('channelSequence', 0) + 1
            require(sequence <= 2**53 - 1, 'channel sequence exhausted')
            registry['channelSequence'] = journal['sequence'] = sequence
        journal.update(candidate=copy.deepcopy(state['candidate']), policySnapshot=copy.deepcopy(policy), policyDigest=digest(policy))
        journal.pop('tasks', None)
        registry['candidates'][key] = journal
        registry['activeCandidate'] = key
        self.store.write(registry, revision)
        return {'status': 'ACTIVATED', 'candidateDigest': key, 'channelSequence': journal['sequence']}

    def preview(self, state, policy):
        registry, _ = self.store.read()
        working = copy.deepcopy(state)
        if registry:
            require(registry.get('schema') == SCHEMA, 'unknown routing registry')
            contract = contract_for(state, policy)
            if contract is None:
                return evaluate(state, policy)[1]
            working['routing'] = copy.deepcopy(registry['candidates'].get(digest(state['candidate'])) or _journal(state, contract))
            working['routing']['tasks'] = copy.deepcopy(registry['tasks'])
            if working['routing'].get('supersededBy'):
                working['supersededBy'] = working['routing']['supersededBy']
        return evaluate(working, policy)[1]

    def reserve_publication(self, state, operation_id, request, allowance):
        registry, revision = self.store.read()
        require(registry and registry.get('activeCandidate') == digest(state['candidate']),
                'only the current RC may reserve publisher capacity')
        reservations = registry.setdefault('publicationReservations', {})
        key = digest({'candidate': state['candidate'], 'operation': operation_id})
        record = {'candidateDigest': digest(state['candidate']), 'operationId': operation_id,
                  'requestDigest': digest(request), 'reservationId': allowance['reservationId']}
        require(not reservations.get(key) or reservations[key] == record, 'publisher capacity binding changed')
        require(not any(other.get('reservationId') == allowance['reservationId'] for identifier, other in reservations.items()
                        if identifier != key), 'included publisher reservation already consumed by another RC/operation')
        reservations[key] = record
        self.store.write(registry, revision)

    def update(self, state, policy, transition=None):
        registry, revision = self.store.read()
        registry = copy.deepcopy(registry or {'schema': SCHEMA, 'revision': 0, 'candidates': {}, 'tasks': {}})
        require(registry['schema'] == SCHEMA, 'unknown routing registry')
        key = digest(state['candidate'])
        working = copy.deepcopy(state)
        if key in registry['candidates']:
            working['routing'] = registry['candidates'][key]
            working['routing']['tasks'] = registry['tasks']
            if working['routing'].get('supersededBy'):
                working['supersededBy'] = working['routing']['supersededBy']
        else:
            contract = contract_for(state, policy)
            if contract is None:
                return evaluate(state, policy)[1]
            working['routing'] = _journal(state, contract)
            working['routing']['tasks'] = registry['tasks']
        if transition:
            working = transition(working)
        updated, plan = evaluate(working, policy)
        if 'routing' not in updated:
            return plan
        journal = updated['routing']
        registry['tasks'] = journal.pop('tasks')
        registry['candidates'][key] = journal
        self.store.write(registry, revision)
        return plan

    def supersede(self, state, replacement):
        require(replacement['repository'] == state['candidate']['repository'] and replacement != state['candidate'],
                'different replacement candidate in the same product required')
        registry, revision = self.store.read()
        require(registry and digest(state['candidate']) in registry['candidates'], 'route the original candidate first')
        journal = registry['candidates'][digest(state['candidate'])]
        target = digest(replacement)
        require(not journal.get('supersededBy') or journal['supersededBy'] == target, 'replacement already recorded')
        journal['supersededBy'] = target
        self.store.write(registry, revision)
        return {'status': 'SUPERSEDED', 'replacement': target, 'publication': 'NOT_RUN'}


def registry_candidate(candidate):
    return {'repository': candidate['repository'], 'tag': 'release-result-routing-v1'}
