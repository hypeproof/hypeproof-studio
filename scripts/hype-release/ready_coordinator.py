"""One deterministic RC cycle, invoked by the existing controller only."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import subprocess
import uuid

from core import (Blocked, canonical, digest, evidence_key, initial, policy_contract,
                  public_payload, record_check, require, reserve, settle)
from release import Session
from transport import GitHub, GitHubStore, file_hash, safe_name
import publication_service as publication
import publisher
import routing
import routing_service
import macos_signing


def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))


def source_identity(event):
    semantic = {key: event.get(key) for key in ('status', 'event', 'candidate', 'releasePr', 'releaseHead', 'workflowHead', 'config')}
    release = event.get('release') or {}
    semantic['release'] = {key: release.get(key) for key in ('id', 'tag_name', 'draft', 'prerelease')}
    semantic['release']['assets'] = sorted(({key: a.get(key) for key in ('id', 'name', 'size', 'digest')}
        for a in release.get('assets', [])), key=lambda a: (a['name'], str(a['id'])))
    return semantic


def write(root, name, value):
    root = Path(root).resolve(); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / (name + '-' + digest(value)[:24] + '.json')
    require(not path.is_symlink(), 'linked private context refused')
    if path.exists(): require(read(path) == value, 'private context conflict')
    else:
        with path.open('x', encoding='utf-8') as stream: stream.write(canonical(value))
        os.chmod(path, 0o600)
    return path


def current_input(host, value):
    """Stable locator across the reserve transition; the native bridge freezes its bytes."""
    path = host.root / 'publisher-current.json'
    require(not path.is_symlink(), 'linked native input refused')
    temporary = write(host.root, 'publisher-version', value)
    import shutil
    staged = host.root / 'publisher-current.next'
    require(not staged.is_symlink(), 'linked input staging refused')
    shutil.copyfile(temporary, staged); os.chmod(staged, 0o600); os.replace(staged, path)
    return host.native(path)


def reserve_native(registry, state, operation_id, request, quote):
    shared, revision = registry.store.read()
    require(shared.get('activeCandidate') == state['candidateDigest'] and quote.get('reservationId'), 'current reserved native capacity required')
    key = digest({'candidate': state['candidateDigest'], 'operation': operation_id})
    reservations = shared.setdefault('nativeReservations', {})
    value = {'requestDigest': digest(request), 'reservationId': quote['reservationId']}
    require(not reservations.get(key) or reservations[key] == value, 'native capacity reservation changed')
    require(not any(v['reservationId'] == value['reservationId'] for k, v in reservations.items() if k != key), 'native capacity already belongs to another RC/platform')
    reservations[key] = value
    registry.store.write(shared, revision)


class ProductGitHub(GitHub):
    def __init__(self, harness): self.wrapper = Path(harness) / 'scripts/agent-identity/with-agent-identity.sh'
    def api(self, path, method='GET', data=None):
        if method == 'GET': return super().api(path, method, data)
        require(path.startswith('repos/hypeproof/hypeproof-studio/'), 'product write outside enrolled repository')
        args = [str(self.wrapper), 'gh', 'api', '--method', method, path]
        if data is not None: args += ['--input', '-']
        env = {**os.environ, 'HYPEPROOF_AGENT_REPOSITORY': 'hypeproof/hypeproof-studio'}
        env.pop('HYPEPROOF_AGENT_WORKFLOWS', None)
        result = subprocess.run(args, input=canonical(data) if data is not None else None,
                                env=env, capture_output=True, text=True, encoding='utf-8', timeout=120)
        require(result.returncode == 0, 'product App write uncertain; preserve UNKNOWN and reconcile')
        return json.loads(result.stdout) if result.stdout.strip() else None


class NativeHost:
    """A pinned native process with explicit shared-path mapping; no host override."""
    def __init__(self, config, candidate, product):
        self.config, self.product = config, product
        self.root = Path(config['sharedRoot']).resolve() / digest(candidate)
        self.native_root = PureWindowsPath(config['nativeRoot']) / digest(candidate)
        require(not Path(config['sharedRoot']).is_symlink() and str(self.root) not in {'/', '/tmp'}, 'durable owned native share required')
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / 'runs').mkdir(exist_ok=True)
        (self.root / 'packages').mkdir(exist_ok=True)
        template = copy.deepcopy(config['request'])
        require(template.get('target') == 'win32-x64', 'Mac requires its own actual native bridge; Windows cannot provide it')
        require(Path(config['python']).is_file() and file_hash(config['python']) == template['runtime']['python']['sha256'], 'native interpreter pin differs')
        self.request = {**template, 'schema': 'hype-release-native-bridge/1', 'event': 'release-candidate-ready', 'mode': 'active',
            'repository': candidate['repository'], 'releasePr': product['contract']['releasePr'],
            'releaseHead': product['contract']['releaseHead'], 'candidateSha': candidate['sourceSha'], 'rcTag': candidate['tag'],
            'configDigest': digest(product['config']), 'productContext': self.native(write(self.root, 'product', product)),
            'packages': self.native(self.root / 'packages'), 'evidenceRoot': str(self.native_root), 'runRoot': str(self.native_root / 'runs')}

    def native(self, path): return str(self.native_root / Path(path).resolve().relative_to(self.root))
    def local(self, path):
        relative = PureWindowsPath(path).relative_to(self.native_root)
        require('..' not in relative.parts, 'native result outside owned share')
        result = self.root.joinpath(*relative.parts)
        for parent in [result, *result.parents]:
            require(not parent.is_symlink(), 'linked native result refused')
            if parent == self.root: break
        return result

    def call(self, command, additions=None, recover=False):
        value = {**self.request, **(additions or {})}
        request_file = write(self.root, command, value)
        suffix = uuid.uuid4().hex if command == 'inspect' else digest(value)[:24]
        output = self.root / (command + '-' + suffix + '-result.json')
        if not output.exists():
            require(not recover, 'UNKNOWN native execution has no complete receipt; inspect original runner, never relaunch')
            cli = str(PureWindowsPath(value['harness']['root']) / 'scripts/hype-release/native_bridge.py')
            result = subprocess.run([self.config['python'], cli, command, '--request', self.native(request_file), '--output', self.native(output)],
                                    capture_output=True, text=True, encoding='utf-8', timeout=1800)
            if not output.is_file():
                try: response = json.loads(result.stdout)
                except ValueError: response = {}
                raise Blocked(response.get('reason', 'native bridge has no complete receipt; preserve UNKNOWN'))
            require(result.returncode in {0, 2}, 'native process failed; inspect original receipt')
        require(not output.is_symlink(), 'linked native response refused')
        response = read(output)
        require(response.get('status') in {'PROBED', 'PLANNED', 'OBSERVED', 'ATTESTED'}, 'native prerequisite remains BLOCKED')
        return response


def required_policy(base, product, probes):
    policy = policy_contract(copy.deepcopy(base))
    cfg, contract = product['config'], product['contract']
    require(policy.get('routing', {}).get('enabled') is True and policy['routing'].get('mode') == cfg['mode'] == 'active', 'reviewed active enrollment required')
    required = []
    for case in contract['checklist']['cases']:
        for target in cfg.get('casePlatforms', {}).get(case['id'], contract['platforms']):
            identity = probes[target]['identity']
            require(identity['sourceSha'] == contract['candidate'] and identity['artifactSha256'] == next(a['sha256'] for a in contract['artifacts'] if a['target'] == target)
                    and identity['os'] + '-' + identity['arch'] == target and identity['testRevision'] == cfg['harnessTestRevision']
                    and identity['acceptanceRevision'] == contract['checklist']['checklistRevision'], 'native probe identity differs from frozen product')
            required.append({'id': case['id'], 'platform': target, 'identity': copy.deepcopy(identity),
                             'checkId': f"desktop:{case['id']}:{target}:{evidence_key(identity)}", 'expected': '\n'.join(case['expect'])})
    policy['routing']['contract'] = {'event': 'release-candidate-ready', 'repository': contract['repository'],
        'releasePr': contract['releasePr'], 'caseIds': [c['id'] for c in contract['checklist']['cases']],
        'platforms': contract['platforms'], 'casePlatforms': {c['id']: cfg.get('casePlatforms', {}).get(c['id'], contract['platforms']) for c in contract['checklist']['cases']},
        'required': required}
    return policy


class Coordinator:
    def __init__(self, config, github=None, studio_call=publication.studio_call, host_factory=NativeHost, gate=lambda action: None):
        self.config, self.github, self.studio, self.host_factory, self.gate = config, github, studio_call, host_factory, gate

    def product(self, command, value):
        return self.studio(self.config['studio'], self.config['studioRevision'], command, value, self.config.get('node', 'node'))

    def sense(self):
        if self.config.get('enabled') is not True: return {'status': 'NOT_APPLICABLE', 'reason': 'release coordinator disabled'}
        require(self.config.get('repository') == 'hypeproof/hypeproof-studio', 'only Studio is enrolled')
        return self.product('discover', {})

    def quote(self, kind, state, request):
        fingerprint = digest({'kind': kind, 'request': request})
        path = Path(self.config['quoteDirectory']) / (fingerprint + '.json')
        require(path.is_file() and not path.is_symlink(), 'fresh exact provider capacity quote missing; restore quota observation, never assume free capacity')
        quote = read(path)
        require(quote.get('requestDigest') == fingerprint and quote.get('candidateDigest') == state['candidateDigest'], 'provider capacity receipt identifies another effect')
        return quote

    def start(self, event):
        self.gate('start')
        fresh = self.sense()
        require(fresh.get('status') == 'RELEASE_CANDIDATE_READY' and source_identity(fresh) == source_identity(event), 'release source changed since SENSE; rediscover before effects')
        github = self.github
        require(github is not None, 'authenticated product transport required')
        candidate = event['candidate']
        root = Path(self.config['root']).resolve() / digest(candidate)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        packages = root / 'packages'; packages.mkdir(exist_ok=True)
        require(sum(a['size'] for a in event['release']['assets']) <= 2 * 1024**3, 'RC download exceeds bounded local capacity')
        # Fixed accepted RC assets; no source or mutable PR body supplies bytes.
        for asset in event['release']['assets']:
            if asset['name'].endswith('.zip') or asset['name'] in {'unified-acceptance.json', macos_signing.RECEIPT}:
                github.download(candidate['repository'], asset, packages / safe_name(asset['name']))
        registry = routing.Registry(GitHubStore(github, candidate['repository'], routing.registry_candidate(candidate)))
        shared, _ = registry.store.read()
        journal = (shared or {}).get('candidates', {}).get(digest(candidate), {})
        sequence = journal.get('sequence') or (shared or {}).get('channelSequence', 0) + 1
        product = self.product('prepare', {'pr': event['releasePr'], 'packages': str(packages), 'sequence': sequence})
        require(product['contract']['candidate'] == candidate['sourceSha'] and product['contract']['releaseHead'] == event['releaseHead'], 'prepared product changed')
        mac_packages = [a for a in product['contract']['artifacts'] if a['name'] == macos_signing.PACKAGE]
        require(len(mac_packages) == 1, 'official Mac package missing from prepared contract')
        signing = macos_signing.collect(github, candidate, event['release']['assets'], mac_packages[0], packages)
        hosts, probes = {}, {}
        for target in product['contract']['platforms']:
            require(target in self.config.get('hosts', {}), target + ' native host is not onboarded')
            host = self.host_factory(self.config['hosts'][target], candidate, product)
            for artifact in product['contract']['artifacts']:
                # Native share receives only the exact immutable packages/receipt.
                src = packages / artifact['name']; dst = host.root / 'packages' / artifact['name']
                if not dst.exists():
                    import shutil
                    shutil.copyfile(src, dst)
                require(file_hash(dst) == artifact['sha256'], 'native shared package differs')
            for receipt_name in ('unified-acceptance.json', macos_signing.RECEIPT):
                receipt = packages / receipt_name
                if receipt.exists():
                    import shutil
                    target_receipt = host.root / 'packages' / receipt_name
                    if not target_receipt.exists(): shutil.copyfile(receipt, target_receipt)
                    require(file_hash(target_receipt) == file_hash(receipt), 'native accepted receipt changed')
            hosts[target], probes[target] = host, host.call('probe')
        base_policy = read(self.config['policy'])
        policy = required_policy(base_policy, product, probes)
        actor = github.actor()
        session = Session(GitHubStore(github, candidate['repository'], candidate), policy, actor, candidate, github)
        if not session.state:
            state = initial(candidate, policy, actor)
            state['artifacts'] = [{k: a[k] for k in ('name', 'sha256', 'size')} for a in product['contract']['artifacts']]
            state['macSigning'] = signing
            session.save(state)
        session.own()
        require(session.state.get('macSigning') == signing, 'candidate signing evidence changed; preserve existing state')
        activated = registry.activate(session.state, policy)
        require(activated['channelSequence'] == sequence, 'concurrent channel activation; rediscover before native effects')
        registry.update(session.state, policy)
        observations = {}
        def save_context():
            context = {'candidate': candidate, 'policy': policy, 'basePolicyDigest': digest(base_policy), 'configDigest': digest(self.config),
                       'product': product, 'packages': str(packages), 'observations': observations, 'event': event}
            public_payload(context)
            immutable = write(root, 'context', context)
            pointer, staged = root / 'current.json', root / 'current.next'
            require(not pointer.is_symlink() and not staged.is_symlink(), 'linked controller context refused')
            staged.write_bytes(immutable.read_bytes()); os.chmod(staged, 0o600); os.replace(staged, pointer)
            index = Path(self.config['root']) / 'active-context.json'
            require(not index.is_symlink(), 'linked active context refused')
            indexed = write(index.parent, 'active-index', {'candidateDigest': digest(candidate), 'context': str(pointer)})
            next_index = index.with_suffix('.next')
            require(not next_index.is_symlink(), 'linked active staging refused')
            next_index.write_bytes(indexed.read_bytes()); os.chmod(next_index, 0o600); os.replace(next_index, index)
            return pointer
        for target, host in hosts.items():
            operation_id = 'native-' + digest({'candidate': candidate, 'target': target})[:32]
            exported = publisher.producer_input(session.state, policy, registry)
            additions = {'publisherInput': current_input(host, exported), 'policyDigest': digest(policy),
                         'operationId': operation_id, 'probeReceipt': probes[target]['receipt'], 'probeDigest': probes[target]['probeDigest']}
            plan = host.call('plan', additions)
            request = plan['effectRequest']
            op = session.state['operations'].get(operation_id)
            if not op:
                quote = self.quote('native-observe', session.state, request)
                state, _, _ = reserve(session.state, policy, actor, operation_id, 'native-observe', request, quote)
                reserve_native(registry, session.state, operation_id, request, quote)
                session.save(state)  # Before the native GUI/model boundary.
                exported = publisher.producer_input(session.state, policy, registry)
                additions['publisherInput'] = current_input(host, exported)
                require(host.call('plan', additions)['effectRequest'] == request, 'native reserved request changed after CAS save')
                additions.update(effectRequest=request, capacity=quote)
                observation = host.call('observe', additions)
                session.save(settle(session.state, operation_id, 'DONE', observation))
            else:
                require(op['request'] == request, 'native request changed; preserve original lease')
                additions.update(effectRequest=request, capacity=op['quote'])
                if op['status'] == 'DONE': observation = op['result']
                else:
                    additions['observationReceipt'] = str(host.native_root / ('bridge-observe-' + plan['requestDigest']) / 'receipt.json')
                    observation = host.call('inspect', additions)
                if op['status'] == 'UNKNOWN': session.save(settle(session.state, operation_id, 'DONE', observation))
            require(observation.get('status') == 'OBSERVED' and observation['requestDigest'] == plan['requestDigest'], 'native result receipt mismatch')
            additions['observationReceipt'] = observation['receipt']
            observation = host.call('inspect', additions)
            checks = host.local(observation['checks'])
            for required in policy['routing']['contract']['required']:
                if required['platform'] != target: continue
                path = checks / (required['id'] + '.json')
                require(not path.is_symlink(), 'linked native check refused')
                raw = path.read_bytes(); recorded = observation['checkFiles'][required['id']]
                require(len(raw) == recorded['size'] and hashlib.sha256(raw).hexdigest() == recorded['sha256'], 'native validated check changed before import')
                check = json.loads(raw)
                require(check['identity'] == required['identity'] and check['expected'] == required['expected'], 'native exported claim differs')
                session.save(record_check(session.state, check))
            registry.update(session.state, policy)
            observations[target] = {'receipt': observation, 'request': additions}
            save_context()  # A later host blocker must not hide an already observed FAIL.
            plan = registry.preview(session.state, policy)
            if plan.get('remediations'):
                return {'status': 'OBSERVED', 'context': str(root / 'current.json'), 'plan': plan,
                        'nativeCollection': 'PAUSED_FOR_FIX'}
        pointer = save_context()
        return {'status': 'OBSERVED', 'context': str(pointer), 'plan': registry.update(session.state, policy)}

    def record(self, context_path):
        self.gate('start')
        context = read(context_path); event = context['event']
        candidate, policy, product = context['candidate'], context['policy'], context['product']
        github = self.github
        session = Session(GitHubStore(github, candidate['repository'], candidate), policy, github.actor(), candidate, github)
        session.own()
        registry = routing.Registry(GitHubStore(github, candidate['repository'], routing.registry_candidate(candidate)))
        shared, _ = registry.store.read()
        journal = (shared or {}).get('candidates', {}).get(session.state['candidateDigest'], {})
        if journal.get('supersededBy'): return {'status': 'SUPERSEDED', 'replacement': journal['supersededBy'], 'publication': 'NOT_RUN'}
        publication_id = 'publish-' + session.state['candidateDigest'][:32]
        pending = session.state['operations'].get(publication_id)
        if session.state.get('stablePublished'): return {'status': 'PUBLISHED', 'receipt': session.state['publicationReceipt']}
        if pending and pending['status'] == 'DONE': return publication.observe_publication(session, publication_id, github)
        if pending and pending.get('result', {}).get('dispatchAttempted'):
            return publication.observe_dispatch(session, publication_id, github)
        require(source_identity(self.sense()) == source_identity(event), 'source changed since native execution; old result cannot publish')
        require(digest(self.config) == context['configDigest'] and digest(read(self.config['policy'])) == context['basePolicyDigest'],
                'controller/operator policy changed; reconcile current owner before effects')
        plan = registry.update(session.state, policy)
        fixes = []
        for task in plan.get('remediations', []):
            self.gate('start')
            request = routing_service.execution_request(session.state, policy, registry, task['id'])
            operation_id = 'remediate-' + task['id']
            operation = session.state['operations'].get(operation_id)
            if not operation:
                result = session.operation(operation_id, 'release-remediation', request,
                    self.quote('release-remediation', session.state, request),
                    lambda: routing_service.remediate(session.state, policy, registry, github, task['id']))
            elif operation['status'] == 'DONE': result = routing_service.reconcile_remediation(session.state, policy, registry, task['id'])
            else: result = {'status': 'BLOCKED', 'reason': 'uncertain development admission requires existing read-only reconciliation'}
            fixes.append(result)
        if plan['status'] != 'READY': return {'status': 'NOT_READY', 'plan': plan, 'fixes': fixes, 'humanQuestions': plan.get('questions', [])}
        self.gate('merge')  # Existing auto/propose-only/kill/freeze controls apply.
        operation_id = 'publish-' + session.state['candidateDigest'][:32]
        operation = session.state['operations'].get(operation_id)
        if not operation:
            capacity = read(self.config['publicationCapacity'])
            require(capacity.get('schema') == 'hps-release-capacity/1', 'original existing-engine capacity required')
            session.save({**session.state, 'publicationCapacity': capacity})
            request = publication.execution_request(session.state, policy, registry, product, event['workflowHead'])
            publication.begin(session, registry, product, event['workflowHead'], operation_id,
                              self.quote('publish-pass', session.state, request))
            exported = publisher.producer_input(session.state, policy, registry, operation_id)
            root = Path(context_path).parent
            input_path = write(root, 'publisher', exported)
            packets = []
            for target, observation in context['observations'].items():
                host = self.host_factory(self.config['hosts'][target], candidate, product)
                additions = observation['request']
                additions['publisherInput'] = current_input(host, exported)
                additions.update(observationReceipt=observation['receipt']['receipt'], native=self.config['hosts'][target]['native'])
                packet = host.call('attest', additions)
                packets.append(str(host.local(packet['packet'])))
            output = root / ('bundle-' + exported['anchor']['viewDigest'])
            self.product('assemble', {'input': str(input_path), 'product': product, 'packages': context['packages'],
                'packets': packets, 'store': self.config['engineStore'], 'attestor': self.config['attestor'],
                'key': self.config['attestorKey'], 'out': str(output)})
            verified = self.product('verify', {'product': product, 'packages': context['packages'], 'directory': str(output)})
            publication.prepare_upload(session, registry, output, verified['bundleDigest'], publication.PrivateGitHub(self.config['harness']))
            return publication.dispatch(session, registry, operation_id, github)
        if operation['status'] == 'UNKNOWN':
            result = operation.get('result') or {}
            require(result.get('evidenceCommit'), 'UNKNOWN publisher preparation; inspect original producer/provider, never replay')
            if not result.get('privateUploaded'): publication.observe_upload(session, operation_id, publication.PrivateGitHub(self.config['harness']))
            if result.get('dispatchAttempted'): return publication.observe_dispatch(session, operation_id, github)
            return publication.dispatch(session, registry, operation_id, github)
        return publication.observe_publication(session, operation_id, github)
