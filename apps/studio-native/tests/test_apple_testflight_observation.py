"""Provider fixture evidence only; never Apple acceptance or physical installation."""
import copy
import base64
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('apple_observer',
    Path(__file__).resolve().parents[1] / 'scripts/apple-testflight-observation.py')
observer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observer)
NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)


def row(kind, id, **attributes):
    return {'data': {'type': kind, 'id': id, 'attributes': attributes}}


def fixture():
    upload = {'state': 'uploaded', 'sourceSha': 'a' * 40, 'runId': 123,
              'runAttempt': 1, 'uploadArtifactId': 456,
              'receipt': {'bundle_id': 'ai.hypeproof.studio.mobile', 'version': '0.2.0',
                          'build': '18.1', 'package_sha256': 'b' * 64, 'package_size': 123,
                          'apple_processing': 'NOT_OBSERVED', 'tester_availability': 'NOT_OBSERVED'}}
    responses = {
        '/v1/apps/42': row('apps', '42', bundleId='ai.hypeproof.studio.mobile'),
        '/v1/builds/b/app': row('apps', '42'),
        '/v1/builds/b': row('builds', 'b', version='18.1', processingState='VALID',
                            expired=False, expirationDate='2027-01-01T00:00:00Z'),
        '/v1/builds/b/preReleaseVersion': row('preReleaseVersions', 'v', version='0.2.0', platform='IOS'),
        '/v1/builds/b/buildBetaDetail': row('buildBetaDetails', 'd', internalBuildState='IN_BETA_TESTING'),
        '/v1/betaGroups/g': row('betaGroups', 'g', isInternalGroup=True),
        '/v1/betaGroups/g/app': row('apps', '42'),
        '/v1/betaGroups/g/relationships/builds?limit=200': {
            'data': [{'type': 'builds', 'id': 'b'}], 'links': {'next': None}},
    }
    return upload, responses


class ObservationTests(unittest.TestCase):
    def observe(self, upload=None, responses=None, reconcile=None, read=None, clock=None):
        default_upload, default_responses = fixture()
        return observer.observe(reconcile or (lambda: copy.deepcopy(upload or default_upload)),
            read or (responses or default_responses).__getitem__, app_id='42', build_id='b',
            group_id='g', clock=clock or (lambda: NOW))

    def test_exact_build_in_group_does_not_claim_tester_or_installation(self):
        upload, responses = fixture()
        original = copy.deepcopy(upload)
        reconcile = Mock(return_value=upload)
        result = self.observe(responses=responses, reconcile=reconcile)
        self.assertTrue(result['group_build_available'])
        self.assertEqual(result['target_tester_member'], 'NOT_OBSERVED')
        self.assertEqual(result['target_tester_invitation_accepted'], 'NOT_OBSERVED')
        self.assertEqual(result['device_installed'], 'NOT_OBSERVED')
        self.assertEqual(result['valid_until'], (NOW + timedelta(minutes=15)).isoformat())
        self.assertEqual(upload, original)
        self.assertEqual(reconcile.call_count, 2)

    def test_uploaded_only_and_unknown_states_never_become_available(self):
        for path, key, value in [
            ('/v1/builds/b', 'processingState', 'PROCESSING'),
            ('/v1/builds/b', 'processingState', 'FUTURE_UNKNOWN'),
            ('/v1/builds/b', 'expired', True),
            ('/v1/builds/b', 'expirationDate', '2026-11-17T00:00:00Z'),
            ('/v1/builds/b/buildBetaDetail', 'internalBuildState', 'READY_FOR_BETA_TESTING'),
            ('/v1/builds/b/buildBetaDetail', 'internalBuildState', 'FUTURE_UNKNOWN'),
        ]:
            with self.subTest(key=key, value=value):
                upload, responses = fixture()
                responses[path]['data']['attributes'][key] = value
                self.assertFalse(self.observe(upload, responses)['group_build_available'])
        upload, responses = fixture()
        responses['/v1/betaGroups/g/relationships/builds?limit=200']['data'] = []
        self.assertFalse(self.observe(upload, responses)['group_build_available'])

    def test_cross_app_version_platform_group_and_malformed_expiry_rejected(self):
        cases = [('/v1/apps/42', 'bundleId', 'another.bundle'),
                 ('/v1/builds/b', 'version', '18.2'),
                 ('/v1/builds/b/preReleaseVersion', 'version', '0.3.0'),
                 ('/v1/builds/b/preReleaseVersion', 'platform', 'MAC_OS'),
                 ('/v1/betaGroups/g', 'isInternalGroup', False),
                 ('/v1/builds/b', 'expired', 'false'),
                 ('/v1/builds/b', 'expirationDate', '2027-01-01')]
        for path, key, value in cases:
            with self.subTest(key=key):
                upload, responses = fixture()
                responses[path]['data']['attributes'][key] = value
                with self.assertRaises(observer.Refused): self.observe(upload, responses)
        for path in ['/v1/builds/b/app', '/v1/betaGroups/g/app']:
            upload, responses = fixture()
            responses[path]['data']['id'] = 'other-app'
            with self.assertRaises(observer.Refused): self.observe(upload, responses)

    def test_incomplete_unsafe_and_cyclic_pages_are_not_availability(self):
        for metadata in [{'meta': {'paging': {'total': 2}}}, {'links': None}]:
            upload, responses = fixture()
            responses['/v1/betaGroups/g/relationships/builds?limit=200'].update(metadata)
            with self.assertRaises(observer.Refused): self.observe(upload, responses)
        for url in ['https://evil.invalid/v1/builds',
                    'https://api.appstoreconnect.apple.com/v1/betaGroups/other/relationships/builds',
                    'https://api.appstoreconnect.apple.com/v1/betaGroups/g/relationships/builds?limit=200']:
            upload, responses = fixture()
            responses['/v1/betaGroups/g/relationships/builds?limit=200']['links']['next'] = url
            with self.assertRaises(observer.Refused): self.observe(upload, responses)
        upload, responses = fixture()
        first = responses['/v1/betaGroups/g/relationships/builds?limit=200']
        second = '/v1/betaGroups/g/relationships/builds?cursor=2'
        first['links']['next'] = 'https://api.appstoreconnect.apple.com' + second
        responses[second] = {'data': [], 'links': {'next': None}}
        read = Mock(side_effect=responses.__getitem__)
        self.assertTrue(self.observe(upload, read=read)['group_build_available'])
        self.assertEqual(sum(call.args[0] == second for call in read.call_args_list), 2)

    def test_mid_observation_revocation_and_upload_attempt_change_refused(self):
        upload, responses = fixture()
        calls = 0
        def read(path):
            nonlocal calls
            calls += 1
            result = copy.deepcopy(responses[path])
            if calls > 8 and path == '/v1/builds/b':
                result['data']['attributes']['expired'] = True
            return result
        with self.assertRaises(observer.Refused): self.observe(upload, read=read)
        changed = {**upload, 'runAttempt': 2}
        with self.assertRaises(observer.Refused):
            self.observe(reconcile=Mock(side_effect=[upload, changed]))
        with self.assertRaises(observer.Refused):
            self.observe(clock=Mock(side_effect=[NOW, NOW, NOW, NOW + timedelta(minutes=11)]))
        with self.assertRaises(observer.Refused): self.observe(reconcile=lambda: None)

    def test_slow_reconciliation_cannot_refresh_older_apple_observation(self):
        result = self.observe(clock=Mock(side_effect=[NOW, NOW, NOW + timedelta(minutes=1),
                                                     NOW + timedelta(minutes=9)]))
        self.assertEqual(result['observed_at'], (NOW + timedelta(minutes=1)).isoformat())
        self.assertEqual(result['reconciled_at'], (NOW + timedelta(minutes=9)).isoformat())
        self.assertEqual(result['valid_until'], (NOW + timedelta(minutes=15)).isoformat())

    def test_transport_has_no_redirect_write_or_error_body_disclosure(self):
        reader = observer.AppleReader('private.jwt.token')
        reader._opener = Mock()
        reader._opener.open.side_effect = RuntimeError('private.jwt.token user@example.com')
        with self.assertRaisesRegex(observer.Refused, '^Apple metadata read failed; availability not established$'):
            reader('/v1/apps/42')
        request = reader._opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(reader._opener.open.call_args.kwargs['timeout'], 15)
        for path in ['https://evil.invalid', '//evil.invalid/v1/apps', '/v1/../secrets']:
            with self.assertRaises(observer.Refused): reader(path)
        reader._remaining = 0
        with self.assertRaises(observer.Refused): reader('/v1/apps/42')
        with self.assertRaises(observer.Refused): observer.NoRedirect().redirect_request(None)

    def test_workflow_only_context_rejects_wrong_source_ref_and_request_target(self):
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': 'hypeproof/hypeproof-studio',
               'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
               'GITHUB_WORKFLOW_REF': 'hypeproof/hypeproof-studio/.github/workflows/studio-testflight-observe.yml@refs/heads/main',
               'GITHUB_SHA': 'a' * 40, 'OBSERVE_EXPECTED_SHA': 'a' * 40,
               'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
               'OBSERVE_RELEASE_REQUEST': json.dumps({'repository': 'hypeproof/hypeproof-studio',
                   'workflow': 'studio-apple-testflight.yml', 'platform': 'ios', 'ref': 'main'})}
        _, context = observer.workflow_context(env)
        self.assertEqual(context['run_attempt'], 2)
        for field, value in [('GITHUB_REF', 'refs/heads/attacker'), ('GITHUB_EVENT_NAME', 'pull_request'),
                             ('OBSERVE_EXPECTED_SHA', 'b' * 40), ('GITHUB_RUN_ID', '0'),
                             ('GITHUB_WORKFLOW_REF', 'untrusted'), ('OBSERVE_RELEASE_REQUEST', '{}')]:
            with self.subTest(field=field), self.assertRaises(observer.Refused):
                observer.workflow_context({**env, field: value})

    def test_actions_reader_refuses_write_scope_and_never_uses_ambient_credentials(self):
        with patch.dict(os.environ, {'GH_TOKEN': 'ambient-human-token', 'APP_STORE_CONNECT_PRIVATE_KEY': 'private'}):
            reader = observer.WorkflowActions('workflow-only-token')
            with patch.object(observer, 'bounded_command', return_value=b'{}') as run:
                reader.api('repos/hypeproof/hypeproof-studio/actions/runs/123')
                call = run.call_args
                self.assertEqual(call.args[0][0:4], ['gh', 'api', '--method', 'GET'])
                self.assertEqual(call.args[1]['GH_TOKEN'], 'workflow-only-token')
                self.assertNotIn('APP_STORE_CONNECT_PRIVATE_KEY', call.args[1])
                for path in ['repos/hypeproof/other/actions/runs',
                             'repos/hypeproof/hypeproof-studio/issues/1',
                             'repos/hypeproof/hypeproof-studio/actions/../issues']:
                    with self.assertRaises(observer.Refused): reader.api(path)
                self.assertEqual(run.call_count, 1)

    def test_response_limits_stop_real_reader_before_excess_bytes_are_written(self):
        args = [sys.executable, '-c', 'import sys; sys.stdout.write("x" * 10000)']
        sink = io.BytesIO()
        with self.assertRaises(observer.Refused):
            observer.bounded_command(args, {}, limit=100, output=sink)
        self.assertLessEqual(len(sink.getvalue()), 100)
        with self.assertRaises(observer.Refused): observer.bounded_command(args, {}, limit=100)
        self.assertEqual(observer.bounded_command([sys.executable, '-c', 'print("ok", end="")'],
                                                  {}, limit=2), b'ok')
        with self.assertRaises(observer.Refused):
            observer.bounded_command([sys.executable, '-c', 'import time; time.sleep(10)'],
                                     {}, limit=100, timeout=0.05)

    def test_real_openssl_token_signature_and_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = subprocess.check_output(['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout'])
            token = observer.apple_token('ABC1234567', '12345678-1234-1234-1234-123456789abc',
                                         private.decode(), 1000)
            header, payload, signature = token.split('.')
            def decode(value): return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
            self.assertEqual(json.loads(decode(header))['alg'], 'ES256')
            self.assertEqual(json.loads(decode(payload)), {'iss': '12345678-1234-1234-1234-123456789abc',
                                                         'iat': 970, 'exp': 1600, 'aud': 'appstoreconnect-v1'})
            raw = decode(signature)
            self.assertEqual(len(raw), 64)
            integers = []
            for part in (raw[:32], raw[32:]):
                value = part.lstrip(b'\x00')
                if value[0] & 0x80: value = b'\x00' + value
                integers.append(b'\x02' + bytes([len(value)]) + value)
            body = b''.join(integers)
            (root / 'signature').write_bytes(b'\x30' + bytes([len(body)]) + body)
            public = subprocess.check_output(['openssl', 'pkey', '-pubout'], input=private)
            (root / 'public.pem').write_bytes(public)
            check = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(root / 'public.pem'),
                                    '-signature', str(root / 'signature')], input=(header + '.' + payload).encode(),
                                    capture_output=True)
            self.assertEqual(check.returncode, 0)
            for bad in [b'', b'\x30\x00', b'\x30\x06\x02\x01\x80\x02\x01\x01']:
                with self.assertRaises(observer.Refused): observer.raw_es256(bad)


if __name__ == '__main__':
    unittest.main()
