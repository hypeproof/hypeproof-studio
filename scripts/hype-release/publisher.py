"""Private producer input and live observation anchors; never a second publisher."""
from __future__ import annotations

import copy
import math
import struct

from core import digest, public_payload, require
import routing
import macos_signing

ALGORITHM = 'typed-double-v1'
MAX_SAFE = 2**53 - 1


def typed(value):
    if value is None:
        return ['z']
    if type(value) is bool:
        return ['b', value]
    if isinstance(value, str):
        value.encode('utf-8')  # Refuse unpaired surrogates instead of losing bytes.
        return ['s', value]
    if type(value) in {int, float}:
        require(not (type(value) is int and abs(value) > MAX_SAFE),
                'publisher anchor contains an unsafe integer')
        number = float(value)
        require(math.isfinite(number) and not (number.is_integer() and abs(number) > MAX_SAFE),
                'publisher anchor contains a non-finite or unsafe number')
        return ['n', struct.pack('>d', number).hex()]
    if isinstance(value, list):
        return ['a', [typed(item) for item in value]]
    require(isinstance(value, dict) and all(isinstance(key, str) for key in value), 'JSON publisher anchor required')
    return ['o', [[key, typed(value[key])] for key in sorted(value, key=lambda key: key.encode('utf-8'))]]


def typed_digest(value):
    return digest(typed(value))


def branch(candidate):
    return 'ops/release-state/' + digest({'repository': candidate['repository'], 'tag': candidate['tag']})[:32]


def view(state, registry, operation_id=None):
    """Include every verdict, role, capacity and budget; ignore only own receipt bookkeeping."""
    current, shared = copy.deepcopy(state), copy.deepcopy(registry)
    current.pop('revision', None)
    shared.pop('revision', None)
    if operation_id:
        operation = current.get('operations', {}).get(operation_id)
        require(operation and operation.get('kind') == 'publish-pass' and operation.get('status') in {'UNKNOWN', 'DONE'},
                'current bounded publication reservation required')
        for key in ('status', 'result', 'finishedAt'):
            operation.pop(key, None)
    return {'state': current, 'registry': shared}


def producer_input(state, policy, registry, operation_id=None):
    contract = routing.contract_for(state, policy)
    require(contract is not None, 'only enrolled release-candidate-ready work has producer input')
    shared, _ = registry.store.read()
    require(shared and shared.get('schema') == routing.SCHEMA, 'route this candidate before producing evidence')
    key = digest(state['candidate'])
    journal = shared['candidates'].get(key)
    require(journal and shared.get('activeCandidate') == key and type(journal.get('sequence')) is int,
            'activate the current verified RC before producing evidence')
    require(journal.get('policyDigest') == digest(policy) and journal.get('policySnapshot') == policy,
            'published routing policy differs; route and reconcile the current owner first')
    require(state.get('policyDigest') == digest(policy), 'candidate owner policy changed; reconcile or replace the candidate')
    working = copy.deepcopy(state)
    working['routing'] = copy.deepcopy(journal)
    working['routing']['tasks'] = copy.deepcopy(shared['tasks'])
    if journal.get('supersededBy'):
        working['supersededBy'] = journal['supersededBy']
    updated, plan = routing.evaluate(working, policy)
    rows = []
    by_check = {row['checkId']: row for row in plan.get('rows', [])}
    for required in contract['required']:
        result = by_check.get(required['checkId'])
        if not result:
            continue
        resolution = updated['routing']['resolutions'].get(result.get('resolution'))
        rows.append({'required': copy.deepcopy(required), 'observation': copy.deepcopy(state['checks'].get(required['checkId'])),
                     'observationDigest': result['observationDigest'], 'resolution': copy.deepcopy(resolution),
                     'resolutionDigest': typed_digest(resolution) if resolution else None, 'verdict': result['verdict']})
    if operation_id:
        require(plan['status'] == 'READY' and policy['routing']['mode'] == 'active', 'complete active effective PASS required for publication')
        macos_signing.require_official(state)
    anchor = {'schema': 'hps-publisher-anchor/1', 'algorithm': ALGORITHM,
              'repository': state['candidate']['repository'], 'candidateDigest': key,
              'operationId': operation_id, 'candidateBranch': branch(state['candidate']),
              'registryBranch': branch(routing.registry_candidate(state['candidate'])),
              'status': plan['status'], 'readinessDigest': plan['readinessDigest'],
              'viewDigest': typed_digest(view(state, shared, operation_id))}
    public_payload(state)
    public_payload(shared)
    return {'schema': 'hype-release-publisher-input/1', 'candidate': copy.deepcopy(state['candidate']),
            'state': copy.deepcopy(state), 'registry': shared, 'contract': contract, 'plan': plan,
            'effective': rows, 'anchor': anchor, 'channelSequence': journal['sequence'],
            'signingStatus': macos_signing.status(state)}
