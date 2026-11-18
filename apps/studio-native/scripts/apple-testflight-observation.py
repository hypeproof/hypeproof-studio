"""Read-only Apple metadata observation; upload reconciliation remains canonical.

The caller supplies the existing release reconciler and a GET-only Apple reader.
No persisted JSON receipt is accepted as proof of upload. Workflow authentication
and publication must bind this output to their exact trusted source separately.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
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


def relationship(value, name, kind, expected_id):
    data = value.get('relationships', {}).get(name, {}).get('data')
    require(data == {'type': kind, 'id': expected_id}, 'Apple relationship mismatch')


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
