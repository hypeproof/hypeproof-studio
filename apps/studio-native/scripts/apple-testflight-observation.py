"""Read-only Apple metadata observation; upload reconciliation remains canonical.

The caller supplies the existing release reconciler and a GET-only Apple reader.
No persisted JSON receipt is accepted as proof of upload. Workflow authentication
and publication must bind this output to their exact trusted source separately.
"""
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def identity(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9-]{1,100}', value),
            'invalid Apple resource identity')
    return value


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, 'timestamp needs timezone')
        return parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise Refused('invalid provider timestamp') from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('Apple redirect refused')


class AppleReader:
    """Fixed-origin GETs, no retries, response/body/time/call bounds, safe errors."""
    def __init__(self, token):
        require(isinstance(token, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', token),
                'missing Apple token')
        self._token = token
        self._remaining = 32
        self._opener = build_opener(NoRedirect())

    def __call__(self, path):
        parsed = urlsplit(path)
        require(not parsed.scheme and not parsed.netloc and not parsed.fragment
                and parsed.path.startswith('/v1/') and '..' not in parsed.path
                and '\\' not in path, 'invalid Apple read path')
        require(self._remaining > 0, 'Apple read budget exhausted')
        self._remaining -= 1
        request = Request('https://api.appstoreconnect.apple.com' + path,
                          headers={'Authorization': 'Bearer ' + self._token}, method='GET')
        try:
            with self._opener.open(request, timeout=15) as response:
                body = response.read(262145)
            require(len(body) <= 262144, 'Apple response too large')
            result = json.loads(body)
            require(isinstance(result, dict), 'invalid Apple response')
            return result
        except Refused:
            raise
        except Exception:
            # Never emit provider bodies, emails, bearer tokens or request headers.
            raise Refused('Apple metadata read failed; availability not established') from None


def resource(payload, kind, expected_id):
    value = payload.get('data')
    require(isinstance(value, dict) and value.get('type') == kind
            and value.get('id') == expected_id, 'Apple resource identity mismatch')
    return value


def attributes(value):
    result = value.get('attributes')
    require(isinstance(result, dict), 'missing Apple attributes')
    return result


def group_has_build(read, group_id, build_id):
    # Do not follow arbitrary provider URLs or treat partial pages as absence.
    path = f'/v1/betaGroups/{group_id}/relationships/builds?limit=200'
    seen, member_ids, found = set(), set(), False
    for _ in range(10):
        require(path not in seen, 'Apple pagination cycle')
        seen.add(path)
        page = read(path)
        rows = page.get('data')
        require(isinstance(rows, list), 'invalid group build relationship list')
        for row in rows:
            require(isinstance(row, dict) and row.get('type') == 'builds',
                    'invalid group build relationship')
            identity(row.get('id'))
            require(row['id'] not in member_ids, 'duplicate group build relationship')
            member_ids.add(row['id'])
            found = found or row['id'] == build_id
        require(isinstance(page.get('links'), dict), 'missing Apple pagination links')
        next_url = page['links'].get('next')
        if next_url is None:
            total = page.get('meta', {}).get('paging', {}).get('total')
            require(total is None or (type(total) is int and total == len(member_ids)),
                    'incomplete Apple relationship listing')
            return found
        require(isinstance(next_url, str), 'invalid Apple pagination')
        parsed = urlsplit(next_url)
        require(parsed.scheme == 'https' and parsed.netloc == 'api.appstoreconnect.apple.com'
                and parsed.path == f'/v1/betaGroups/{group_id}/relationships/builds'
                and not parsed.fragment, 'unsafe Apple pagination')
        path = parsed.path + '?' + parsed.query
    raise Refused('Apple pagination exceeds bounded scan')


def snapshot(read, app_id, build_id, group_id, receipt):
    app = resource(read(f'/v1/apps/{app_id}'), 'apps', app_id)
    require(attributes(app).get('bundleId') == receipt['bundle_id'], 'bundle mismatch')
    build = resource(read(f'/v1/builds/{build_id}'), 'builds', build_id)
    resource(read(f'/v1/builds/{build_id}/app'), 'apps', app_id)
    values = attributes(build)
    require(values.get('version') == receipt['build'], 'build number mismatch')
    version = read(f'/v1/builds/{build_id}/preReleaseVersion').get('data')
    require(isinstance(version, dict) and version.get('type') == 'preReleaseVersions',
            'invalid prerelease version')
    identity(version.get('id'))
    require(attributes(version).get('version') == receipt['version']
            and attributes(version).get('platform') == 'IOS', 'marketing version/platform mismatch')
    detail = read(f'/v1/builds/{build_id}/buildBetaDetail').get('data')
    require(isinstance(detail, dict) and detail.get('type') == 'buildBetaDetails',
            'invalid beta detail')
    identity(detail.get('id'))
    group = resource(read(f'/v1/betaGroups/{group_id}'), 'betaGroups', group_id)
    # Use the related app endpoint; Apple's default relationship can be link-only.
    resource(read(f'/v1/betaGroups/{group_id}/app'), 'apps', app_id)
    require(attributes(group).get('isInternalGroup') is True, 'not an internal group')
    require(type(values.get('expired')) is bool, 'missing expiration state')
    expiration = instant(values.get('expirationDate'))
    require(isinstance(values.get('processingState'), str)
            and isinstance(attributes(detail).get('internalBuildState'), str), 'missing processing state')
    return {'processing_state': values['processingState'],
            'internal_build_state': attributes(detail)['internalBuildState'],
            'expired': values['expired'], 'expiration_date': expiration.isoformat(),
            'group_contains_build': group_has_build(read, group_id, build_id)}


def observe(reconcile_upload, read, *, app_id, build_id, group_id, clock=None):
    """Reconcile upload before/after Apple reads; never mutate the upload receipt."""
    app_id, build_id, group_id = map(identity, (app_id, build_id, group_id))
    clock = clock or (lambda: datetime.now(timezone.utc))
    started = clock()
    upload = reconcile_upload()
    require(isinstance(upload, dict) and upload.get('state') == 'uploaded',
            'canonical upload reconciliation required')
    receipt = upload['receipt']
    apple_started = clock()
    first = snapshot(read, app_id, build_id, group_id, receipt)
    last = snapshot(read, app_id, build_id, group_id, receipt)
    apple_finished = clock()
    require(first == last, 'Apple state changed during observation')
    require(reconcile_upload() == upload, 'upload evidence changed during observation')
    now = clock()
    require(started <= apple_started <= apple_finished <= now <= started + timedelta(minutes=10),
            'observation time bound exceeded')
    available = (last['processing_state'] == 'VALID'
                 and last['internal_build_state'] == 'IN_BETA_TESTING'
                 and not last['expired'] and instant(last['expiration_date']) > now
                 and last['group_contains_build'])
    canonical = json.dumps(receipt, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    return {'schema': 'hps-native-testflight-observation/1',
            'source_sha': upload['sourceSha'], 'workflow_source_sha': upload.get('workflowSourceSha', upload['sourceSha']),
            'upload_run_id': upload['runId'], 'upload_run_attempt': upload['runAttempt'],
            'upload_artifact_id': upload['uploadArtifactId'],
            'receipt_sha256': hashlib.sha256(canonical).hexdigest(),
            'package_sha256': receipt['package_sha256'], 'package_size': receipt['package_size'],
            'bundle_id': receipt['bundle_id'], 'version': receipt['version'], 'build': receipt['build'],
            'app_id': app_id, 'apple_build_id': build_id, 'group_id': group_id,
            'observation_started_at': apple_started.isoformat(),
            'observed_at': apple_finished.isoformat(), 'reconciled_at': now.isoformat(),
            'valid_until': min(apple_started + timedelta(minutes=15), instant(last['expiration_date'])).isoformat(),
            **last, 'group_build_available': available,
            'target_tester_member': 'NOT_OBSERVED',
            'target_tester_invitation_accepted': 'NOT_OBSERVED', 'device_installed': 'NOT_OBSERVED'}


def collect(actions, request, request_digest, read, **target):
    """Production adapter: use the existing verifier, including IPA hash checks.

    Authentication remains owned by the protected caller. This adapter performs
    no release dispatch and accepts a release request, never a supplied receipt.
    """
    release_root = Path(__file__).resolve().parents[3] / 'scripts/hype-release'
    sys.path.insert(0, str(release_root))
    try:
        import native_testflight
        require(Path(native_testflight.__file__).resolve() == release_root / 'native_testflight.py',
                'unexpected native release verifier')
        return observe(lambda: native_testflight.observe(actions, request, request_digest),
                       read, **target)
    finally:
        sys.path.remove(str(release_root))


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')


def raw_es256(signature):
    """OpenSSL DER ECDSA -> JWT's fixed-width R || S representation."""
    require(8 <= len(signature) <= 72 and signature[0] == 0x30
            and signature[1] == len(signature) - 2, 'invalid ES256 signature')
    offset, result = 2, b''
    for _ in range(2):
        require(offset + 2 <= len(signature) and signature[offset] == 2, 'invalid ES256 integer')
        size = signature[offset + 1]
        value = signature[offset + 2:offset + 2 + size]
        require(1 <= size <= 33 and len(value) == size and not value[0] & 0x80
                and (size == 1 or value[0] != 0 or value[1] & 0x80), 'invalid ES256 integer')
        integer = int.from_bytes(value, 'big')
        require(0 < integer < 2 ** 256, 'invalid ES256 scalar')
        result += integer.to_bytes(32, 'big')
        offset += size + 2
    require(offset == len(signature), 'trailing ES256 signature bytes')
    return result


def apple_token(key_id, issuer, private_key, timestamp):
    require(isinstance(key_id, str) and re.fullmatch('[A-Z0-9]{10}', key_id), 'invalid Apple key ID')
    require(isinstance(issuer, str) and re.fullmatch('[a-fA-F0-9-]{36}', issuer), 'invalid Apple issuer')
    require(isinstance(private_key, str) and 0 < len(private_key) <= 8192, 'missing Apple private key')
    header = encoded(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}, separators=(',', ':')).encode())
    claims = encoded(json.dumps({'iss': issuer, 'iat': timestamp - 30, 'exp': timestamp + 600,
                                 'aud': 'appstoreconnect-v1'}, separators=(',', ':')).encode())
    payload = header + b'.' + claims
    # Neither key nor token enters argv, stdout or provider-error diagnostics.
    with tempfile.TemporaryDirectory(prefix='hps-apple-observe-') as directory:
        key = Path(directory) / 'key.p8'
        descriptor = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(private_key)
        result = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)],
                                input=payload, capture_output=True, timeout=15,
                                env={'PATH': os.defpath})
        require(result.returncode == 0, 'Apple token signing failed')
    return (payload + b'.' + encoded(raw_es256(result.stdout))).decode()


def bounded_command(args, env, *, limit, output=None, timeout=180):
    """Stop our own reader process before an oversized response reaches storage."""
    deadline = time.monotonic() + timeout
    content, size = bytearray(), 0
    with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, env=env) as process:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), 'Actions read timed out')
                    chunk = os.read(process.stdout.fileno(), min(65536, limit - size + 1))
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= limit, 'Actions response exceeds enforced byte bound')
                    if output is None:
                        content.extend(chunk)
                    else:
                        output.write(chunk)
            require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0,
                    'Actions observation read failed')
            return bytes(content)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


class WorkflowActions:
    """Only the workflow's explicit read-only token; no local account fallback."""
    def __init__(self, token):
        require(isinstance(token, str) and token, 'missing workflow Actions token')
        self._env = {'PATH': os.environ.get('PATH', os.defpath), 'GH_TOKEN': token,
                     'GH_HOST': 'github.com', 'GH_PROMPT_DISABLED': '1'}
        self._remaining = 60

    def _run(self, path, output=None):
        require(isinstance(path, str) and re.fullmatch(
            r'repos/hypeproof/hypeproof-studio/actions/[A-Za-z0-9_./?=&-]+', path)
            and '..' not in path, 'outside read-only Studio Actions scope')
        require(self._remaining > 0, 'Actions observation read budget exhausted')
        self._remaining -= 1
        return bounded_command(['gh', 'api', '--method', 'GET', path], self._env,
                               output=output, limit=1024 ** 3 if output else 16 * 1024 * 1024)

    def api(self, path):
        body = self._run(path)
        require(len(body) <= 16 * 1024 * 1024, 'Actions response exceeds bound')
        return json.loads(body)

    def artifact_zip(self, repo, artifact_id, destination):
        require(repo == 'hypeproof/hypeproof-studio' and type(artifact_id) is int and artifact_id > 0,
                'invalid Actions artifact identity')
        with Path(destination).open('xb') as output:
            self._run(f'repos/{repo}/actions/artifacts/{artifact_id}/zip', output)
        require(0 < Path(destination).stat().st_size <= 1024 ** 3, 'Actions artifact exceeds bound')


def workflow_context(env):
    require(env.get('GITHUB_ACTIONS') == 'true'
            and env.get('GITHUB_REPOSITORY') == 'hypeproof/hypeproof-studio'
            and env.get('GITHUB_REF') == 'refs/heads/main'
            and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and env.get('GITHUB_WORKFLOW_REF') ==
                'hypeproof/hypeproof-studio/.github/workflows/studio-testflight-observe.yml@refs/heads/main',
            'observation requires the trusted main workflow')
    sha = env.get('GITHUB_SHA', '')
    require(re.fullmatch('[a-f0-9]{40}', sha), 'invalid observation source')
    require(env.get('OBSERVE_EXPECTED_SHA') == sha, 'observation workflow source moved')
    for field in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
        require(re.fullmatch('[1-9][0-9]*', env.get(field, '')), 'invalid observation run identity')
    request_text = env.get('OBSERVE_RELEASE_REQUEST', '')
    require(len(request_text) <= 16384, 'release request too large')
    request = json.loads(request_text)
    require(isinstance(request, dict) and request.get('repository') == 'hypeproof/hypeproof-studio'
            and request.get('workflow') == 'studio-apple-testflight.yml'
            and request.get('platform') == 'ios' and request.get('ref') == 'main',
            'unexpected release request target')
    return request, {'repository': env['GITHUB_REPOSITORY'], 'source_sha': sha,
                     'run_id': int(env['GITHUB_RUN_ID']), 'run_attempt': int(env['GITHUB_RUN_ATTEMPT']),
                     'workflow': '.github/workflows/studio-testflight-observe.yml'}


def main():
    request, provenance = workflow_context(os.environ)
    root = Path(__file__).resolve().parents[3]
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain',
                                     '--untracked-files=no'], text=True).strip()
    require(head == provenance['source_sha'] and not dirty, 'observation checkout differs from trusted source')
    token = apple_token(os.environ.get('APP_STORE_CONNECT_KEY_ID'), os.environ.get('APP_STORE_CONNECT_ISSUER_ID'),
                        os.environ.pop('APP_STORE_CONNECT_PRIVATE_KEY', None), int(datetime.now(timezone.utc).timestamp()))
    actions = WorkflowActions(os.environ.pop('GH_TOKEN', None))
    result = collect(actions, request, os.environ.get('OBSERVE_REQUEST_DIGEST'), AppleReader(token),
                     app_id=os.environ.get('OBSERVE_APP_ID'), build_id=os.environ.get('OBSERVE_BUILD_ID'),
                     group_id=os.environ.get('OBSERVE_GROUP_ID'))
    result['observation_run'] = provenance
    # Exclusive output: a failed rerun cannot leave or relabel a stale observation.
    output = Path(os.environ['RUNNER_TEMP']) / 'testflight-observation.json'
    with output.open('x') as stream:
        json.dump(result, stream, sort_keys=True, indent=2)
        stream.write('\n')
    print('Read-only TestFlight observation saved; tester and device acceptance remain unobserved.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No traceback can accidentally reveal secret material or provider bodies.
        print('TestFlight observation refused; no availability evidence published.', file=sys.stderr)
        sys.exit(1)
