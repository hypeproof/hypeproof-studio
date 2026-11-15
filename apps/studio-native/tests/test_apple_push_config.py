"""Synthetic Apple-tool boundary controls; never signs or contacts a provider."""
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
ROOT = SCRIPTS.parents[2]
SPEC = importlib.util.spec_from_file_location('apple_push_config', SCRIPTS / 'apple-push-config.py')
PUSH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUSH)
TEAM = 'TESTTEAM01'
BUNDLE = 'ai.hypeproof.studio.mobile'


def profile():
    return {'UUID': 'synthetic-owned-profile', 'Name': 'Synthetic distribution',
            'TeamIdentifier': [TEAM], 'ExpirationDate': dt.datetime(2099, 1, 1),
            'Entitlements': {'application-identifier': TEAM + '.' + BUNDLE,
                             'com.apple.developer.team-identifier': TEAM,
                             'aps-environment': 'production', 'get-task-allow': False}}


# All external Apple/network programs are synthetic. The actual shell and helper
# execute; only absolute PlistBuddy and host-profile destinations are redirected.
TOOLS = r'''#!/usr/bin/env python3
import json, os, pathlib, plistlib, sys, zipfile
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['HPS_TEST_ROOT'])
with (root/'calls.jsonl').open('a') as log:
    log.write(json.dumps({'tool':name,'args':args})+'\n')
config = json.loads((root/'config.json').read_text())
profile = plistlib.loads((root/'profile.plist').read_bytes())
if name == 'uuidgen': print('synthetic-keychain-password')
elif name == 'security':
    if args[0] == 'cms':
        if 'embedded.mobileprovision' in args[-1]:
            profile.update(config.get('embedded_profile', {}))
        sys.stdout.buffer.write(plistlib.dumps(profile))
    elif args[0] == 'find-identity': print('1) SYNTHETIC_ID "Apple Distribution: Fixture"')
elif name == 'PlistBuddy':
    value = plistlib.loads(pathlib.Path(args[-1]).read_bytes())
    for part in args[1].removeprefix('Print :').split(':'):
        value = value[int(part)] if isinstance(value,list) else value[part]
    print(value)
elif name == 'curl': pathlib.Path(args[args.index('-o')+1]).write_bytes(b'synthetic-cert')
elif name == 'git':
    if args[0] == 'rev-parse': print('c'*40)
elif name == 'xcodebuild':
    if '-exportArchive' not in args:
        archive = pathlib.Path(args[args.index('-archivePath')+1]); archive.mkdir()
        (archive/'Info.plist').write_bytes(plistlib.dumps({}))
        settings = dict(x.split('=',1) for x in args if '=' in x and not x.startswith('-'))
        if 'CODE_SIGN_ENTITLEMENTS' in settings:
            assert plistlib.loads(pathlib.Path(settings['CODE_SIGN_ENTITLEMENTS']).read_bytes()) == {'aps-environment':'production'}
        (root/'archive-settings.json').write_text(json.dumps(settings))
    else:
        settings = json.loads((root/'archive-settings.json').read_text())
        out = pathlib.Path(args[args.index('-exportPath')+1]); out.mkdir()
        enabled = settings.get('INFOPLIST_KEY_HPSPushConfigured') == 'YES'
        info = {'CFBundleIdentifier': 'ai.hypeproof.studio.mobile',
                'HPSPushConfigured': config.get('app_configured', 'YES' if enabled else 'NO')}
        info.update(config.get('info', {}))
        with zipfile.ZipFile(out/'HPStudio.ipa','w') as archive:
            archive.writestr('Payload/HPStudio.app/Info.plist', plistlib.dumps(info))
            archive.writestr('Payload/HPStudio.app/embedded.mobileprovision', b'synthetic-profile')
            archive.writestr('Payload/HPStudio.app/HPStudio', b'synthetic-executable')
elif name == 'ditto':
    with zipfile.ZipFile(args[-2]) as archive: archive.extractall(args[-1])
elif name == 'codesign':
    if '--verify' in args: sys.exit(config.get('signature_exit',0))
    entitlements = dict(profile['Entitlements'])
    entitlements.update(config.get('signed', {}))
    sys.stdout.buffer.write(plistlib.dumps(entitlements))
elif name == 'xcrun': pass
else: raise AssertionError(name)
'''

VERIFIER = '''import json,os,pathlib,sys
p=pathlib.Path(os.environ['HPS_TEST_ROOT'])
with (p/'calls.jsonl').open('a') as f:f.write(json.dumps({'tool':'candidate-gate','args':sys.argv[1:]})+'\\n')
if os.environ.get('HPS_TEST_GATE_FAIL')=='1':sys.exit(2)
pathlib.Path(sys.argv[sys.argv.index('--output')+1]).write_text(json.dumps({'distribution':{'testflight_internal_only':True}}))
'''


class UploadBoundary(unittest.TestCase):
    def run_upload(self, enabled='true', config=None, profile_data=None, gate_fail=False, platform='ios'):
        temporary = tempfile.TemporaryDirectory(prefix='apple-push-test-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        control = root/'control'; control.mkdir()
        app = root/'candidate/apps/studio-native/ios'; app.mkdir(parents=True)
        (app/'App').mkdir()
        (app/'App/HPStudio-Push.entitlements.example').write_bytes(
            (ROOT/'apps/studio-native/ios/App/HPStudio-Push.entitlements.example').read_bytes())
        # Optional exact old script is supplied only to this test process for the
        # source-negative run; neither the production shell nor helper accepts it.
        script = Path(os.environ.get('HPS_TEST_UPLOAD_SOURCE', SCRIPTS/'apple-upload.sh')).read_text()
        script = script.replace('/usr/libexec/PlistBuddy', 'PlistBuddy')
        script = script.replace('$HOME/Library/', '$HPS_TEST_PROFILE_HOME/Library/')
        (control/'apple-upload.sh').write_text(script)
        shutil.copyfile(SCRIPTS/'apple-push-config.py', control/'apple-push-config.py')
        (control/'verify-native-candidate.py').write_text(VERIFIER)
        tools = root/'bin'; tools.mkdir()
        for name in ('uuidgen','security','PlistBuddy','curl','git','xcodebuild','ditto','codesign','xcrun'):
            path = tools/name; path.write_text(TOOLS); path.chmod(0o755)
        (root/'profile.plist').write_bytes(plistlib.dumps(profile_data or profile()))
        (root/'config.json').write_text(json.dumps(config or {}))
        (root/'runner').mkdir()
        env = dict(os.environ, PATH=str(tools)+os.pathsep+os.environ['PATH'],
                   HPS_TEST_ROOT=str(root), HPS_TEST_PROFILE_HOME=str(root/'owned-home'),
                   GITHUB_ACTIONS='true', NATIVE_CANDIDATE_ROOT=str(root/'candidate'),
                   RUNNER_TEMP=str(root/'runner'), GITHUB_RUN_NUMBER='1', GITHUB_RUN_ATTEMPT='1',
                   APPLE_DISTRIBUTION_P12=base64.b64encode(b'synthetic').decode(),
                   APPLE_DISTRIBUTION_PASSWORD='synthetic', APPLE_PROFILE=base64.b64encode(b'synthetic').decode(),
                   APP_STORE_CONNECT_PRIVATE_KEY='synthetic', APP_STORE_CONNECT_KEY_ID='SYNTHETIC',
                   APP_STORE_CONNECT_ISSUER_ID='synthetic', APPLE_DEVELOPER_TEAM_ID=TEAM,
                   HPS_TEST_GATE_FAIL='1' if gate_fail else '0')
        env.pop('HPS_IOS_PUSH_ENABLED', None)
        if enabled is not None: env['HPS_IOS_PUSH_ENABLED'] = enabled
        result = subprocess.run(['bash',str(control/'apple-upload.sh'),platform], env=env,
                                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
        calls = [json.loads(x) for x in (root/'calls.jsonl').read_text().splitlines()] if (root/'calls.jsonl').exists() else []
        return root, result, calls

    def assert_no_upload(self, result, calls):
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(x['tool']=='xcrun' for x in calls))
        self.assertFalse(any(x['tool']=='candidate-gate' and x['args'][0]=='receipt' for x in calls))

    def test_enabled_export_is_verified_before_validation_and_upload(self):
        for value in ('YES', True):
            with self.subTest(plist_value=value):
                root, result, calls = self.run_upload(config={'app_configured': value})
                self.assertEqual(result.returncode, 0, result.stderr)
                settings = json.loads((root/'archive-settings.json').read_text())
                self.assertEqual(settings['HPS_APNS_ENVIRONMENT'], 'production')
                self.assertEqual(settings['INFOPLIST_KEY_HPSPushConfigured'], 'YES')
                self.assertIn('CODE_SIGN_ENTITLEMENTS', settings)
                receipt = json.loads((root/'candidate/apps/studio-native/evidence/apple-ios/push-configuration.json').read_text())
                self.assertEqual(receipt['stage'], 'export_verified')
                self.assertEqual(receipt['provider_acceptance'], 'NOT_RUN')
                package = root/'candidate/apps/studio-native/evidence/apple-ios/HP-Studio-ios.ipa'
                self.assertEqual(receipt['package_sha256'], hashlib.sha256(package.read_bytes()).hexdigest())
                verification = next(i for i,x in enumerate(calls) if x['tool']=='codesign' and '--verify' in x['args'])
                uploads = [i for i,x in enumerate(calls) if x['tool']=='xcrun' and '--upload-app' in x['args']]
                self.assertEqual(len(uploads), 1)
                self.assertLess(verification, uploads[0])
                self.assertEqual(calls[0]['tool'], 'candidate-gate')
                self.assertFalse(list((root/'runner').glob('hp-apple-*')))
                self.assertFalse(list((root/'owned-home').rglob('*.mobileprovision')))

    def test_disabled_keeps_current_archive_settings(self):
        for flag in (None, '', 'false'):
            with self.subTest(flag=flag):
                p = profile(); p['Entitlements'].pop('aps-environment')
                root, result, calls = self.run_upload(enabled=flag, profile_data=p)
                self.assertEqual(result.returncode, 0, result.stderr)
                settings = json.loads((root/'archive-settings.json').read_text())
                self.assertFalse(any(x in settings for x in ('CODE_SIGN_ENTITLEMENTS','HPS_APNS_ENVIRONMENT','INFOPLIST_KEY_HPSPushConfigured')))
                self.assertFalse(any(x['tool']=='codesign' for x in calls))
                self.assertEqual(sum(x['tool']=='xcrun' and '--upload-app' in x['args'] for x in calls),1)

    def test_wrong_profile_stops_before_archive(self):
        for key, value in [('application-identifier', TEAM+'.other.app'),
                           ('aps-environment','development'),
                           ('com.apple.developer.team-identifier','OTHER'), ('get-task-allow',True)]:
            with self.subTest(key=key):
                p = profile(); p['Entitlements'][key] = value
                root, result, calls = self.run_upload(profile_data=p)
                self.assert_no_upload(result, calls)
                self.assertFalse(any(x['tool']=='xcodebuild' for x in calls))
                self.assertFalse(list((root/'runner').glob('hp-apple-*')))

    def test_bad_export_never_reaches_upload_or_receipt(self):
        for config in ({'signature_exit':1}, {'signed':{'aps-environment':'development'}},
                       {'signed':{'application-identifier':TEAM+'.other.app'}},
                       {'signed':{'com.apple.developer.team-identifier':'OTHER'}},
                       {'signed':{'get-task-allow':True}}, {'info':{'CFBundleIdentifier':'other.app'}},
                       {'app_configured':False}, {'app_configured':'true'}, {'app_configured':1},
                       {'embedded_profile':{'UUID':'another-profile'}}):
            with self.subTest(config=config):
                root, result, calls = self.run_upload(config=config)
                self.assert_no_upload(result, calls)
                self.assertTrue(any(x['tool']=='xcodebuild' and '-exportArchive' in x['args'] for x in calls))
                self.assertFalse(list((root/'runner').glob('hp-apple-*')))

    def test_request_gate_and_flag_refuse_before_signing(self):
        for options in ({'gate_fail':True}, {'enabled':'YES'}, {'platform':'macos'}):
            with self.subTest(options=options):
                _, result, calls = self.run_upload(**options)
                self.assert_no_upload(result, calls)
                self.assertFalse(any(x['tool']=='security' for x in calls))


class HelperBoundary(unittest.TestCase):
    def test_unsafe_or_ambiguous_ipa_refused_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'test.ipa'
            cases = [('../escape', b'x', None), ('/absolute', b'x', None),
                     ('Payload/Second.app/Info.plist', b'x', None),
                     ('Payload/Test.app/link', b'../../escape', stat.S_IFLNK | 0o777)]
            for name, data, mode in cases:
                with self.subTest(name=name):
                    with zipfile.ZipFile(path,'w') as archive:
                        archive.writestr('Payload/Test.app/Info.plist', b'x')
                        archive.writestr('Payload/Test.app/embedded.mobileprovision', b'x')
                        entry = zipfile.ZipInfo(name)
                        if mode: entry.external_attr = mode << 16
                        archive.writestr(entry, data)
                    with self.assertRaises(ValueError): PUSH.inspect_ipa(path)

    def test_mac_path_aliases_refused_before_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'alias.ipa'
            with zipfile.ZipFile(path, 'w') as archive:
                for name in ('Payload/', 'Payload/Test.app/'):
                    archive.writestr(name, b'')
                archive.writestr('Payload/Test.app/Info.plist', b'x')
                archive.writestr('Payload/Test.app/embedded.mobileprovision', b'x')
                archive.writestr('Payload/Test.app/Other.txt', b'x')
            self.assertEqual(PUSH.inspect_ipa(path), 'Payload/Test.app')
            for aliases in [('payload/Test.app/Info.plist',),
                            ('payload/Test.app/Other.txt',),
                            ('Payload/Test.app/caf\u00e9', 'Payload/Test.app/cafe\u0301')]:
                with self.subTest(aliases=aliases):
                    with zipfile.ZipFile(path, 'w') as archive:
                        archive.writestr('Payload/Test.app/Info.plist', b'x')
                        archive.writestr('Payload/Test.app/embedded.mobileprovision', b'x')
                        for name in aliases: archive.writestr(name, b'x')
                    with self.assertRaises(ValueError): PUSH.inspect_ipa(path)

    def test_profile_expiry_and_distribution_are_enforced(self):
        for update in ({'ExpirationDate':dt.datetime(2000,1,1)}, {'TeamIdentifier':['OTHER']},
                       {'ProvisionedDevices':['synthetic']}, {'ProvisionsAllDevices':True}):
            with self.subTest(update=update):
                p = profile(); p.update(update)
                with self.assertRaises(ValueError): PUSH.validate_profile(p, TEAM)


if __name__ == '__main__': unittest.main()
