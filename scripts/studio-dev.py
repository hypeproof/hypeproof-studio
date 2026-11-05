#!/usr/bin/env python3
"""Build an isolated Studio development app on macOS arm64 or Windows."""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if os.name == 'nt':
    import msvcrt
else:
    import fcntl

REPO = Path(__file__).resolve().parents[1]
FORMAT = 'hps-studio-dev/1'
SOURCE_SCOPES = ['extensions/hypeproof-chat', 'scripts/studio-dev.py', 'scripts/studio-dev-vendor.mjs', 'config/service-packages.json']


def run(args, **kwargs):
    hidden_capture = os.name == 'nt' and not any(key in kwargs for key in ('stdout', 'stderr', 'capture_output'))
    if os.name == 'nt':
        kwargs.setdefault('creationflags', subprocess.CREATE_NO_WINDOW)
    if hidden_capture:
        kwargs.update(capture_output=True, text=True, encoding='utf-8')
    try:
        result = subprocess.run([str(x) for x in args], check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        if hidden_capture:
            sys.stderr.write((error.stdout or '') + (error.stderr or ''))
        raise
    if hidden_capture:
        sys.stdout.write(result.stdout or '')
        sys.stderr.write(result.stderr or '')
    return result


def is_mac_app(app):
    return app.suffix == '.app'


def app_resources(app):
    return app / ('Contents/Resources/app' if is_mac_app(app) else 'resources/app')


def default_base():
    if platform.system() == 'Windows':
        programs = Path(os.environ['LOCALAPPDATA']) / 'Programs'
        for name in ('HypeProof Studio', 'VSCodium'):
            candidate = programs / name
            if (candidate / 'resources/app/product.json').is_file():
                return candidate
        return programs / 'HypeProof Studio'
    return Path('/Applications/HypeProof Studio.app')


def resolve_cli(provider, explicit=None):
    found = str(explicit) if explicit else shutil.which(provider + ('.exe' if os.name == 'nt' else ''))
    found = found or shutil.which(provider)
    if found and os.name == 'nt' and Path(found).suffix.lower() != '.exe':
        # Resolve npm's native CLI without executing a shell shim or copying login files.
        package = Path(found).parent / 'node_modules' / ('@anthropic-ai/claude-code' if provider == 'claude' else '@openai/codex')
        candidates = [package / 'bin' / (provider + '.exe')]
        if provider == 'codex':
            target = 'aarch64' if platform.machine().lower() == 'arm64' else 'x86_64'
            triple = target + '-pc-windows-msvc'
            candidates += [package / 'vendor' / triple / 'codex/codex.exe',
                           package.parent / ('codex-win32-' + ('arm64' if target == 'aarch64' else 'x64')) / 'vendor' / triple / 'codex/codex.exe']
        found = next((str(p) for p in candidates if p.is_file()), None)
    if not found or not Path(found).is_file():
        raise RuntimeError('Install and log in to ' + provider + ' first. On Windows use a native .exe; --cli-executable can select it.')
    return str(Path(found).resolve())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_snapshot(repo):
    """Bind non-ignored build source bytes as well as Git identity, including stable dirty development trees."""
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=repo)
    commit = git('rev-parse', 'HEAD').decode().strip()
    # A separately checked-out Service is not a Studio input. Track all existing
    # source changes, but count untracked files only inside the declared scopes.
    status = git('status', '--porcelain=v1', '-z', '--untracked-files=no')
    untracked = git('ls-files', '-z', '--others', '--exclude-standard', '--', *SOURCE_SCOPES)
    names = set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *SOURCE_SCOPES).decode('utf-8').split('\0')) - {''}
    entries = []
    has_symlinks = False
    for name in sorted(names, key=lambda value: value.encode('utf-8')):
        file = repo / name
        if file.is_symlink():
            has_symlinks = True
            entries.append([name, 'symlink', os.readlink(file)])
        elif file.is_file():
            entries.append([name, 'file', sha(file)])
        elif not file.exists():
            entries.append([name, 'missing', ''])
        else:
            raise RuntimeError('Cannot bind non-file source input: ' + name)
    encoded = json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return {'format': 'hps-studio-source/1', 'sha': commit, 'dirty': bool(status or untracked),
            'scopes': SOURCE_SCOPES, 'inputs_sha256': hashlib.sha256(encoded).hexdigest(),
            'file_count': len(entries), 'has_symlinks': has_symlinks,
            'status_sha256': hashlib.sha256(status + b'\0' + untracked).hexdigest()}


def require_same_source(repo, expected):
    if source_snapshot(repo) != expected:
        raise RuntimeError('Source changed during preparation. Candidate not applied; prepare again from a stable checkout.')


def overlaps(a, b):
    a, b = a.resolve(), b.resolve()
    return a == b or a in b.parents or b in a.parents


def validate_paths(repo, base, state):
    if overlaps(state, base) or overlaps(state, repo):
        raise ValueError('State directory must be outside the checkout and installed app.')
    if state.is_symlink() or (hasattr(state, 'is_junction') and state.is_junction()):
        raise ValueError('State directory cannot be a symlink.')
    if state.exists() and any(state.iterdir()):
        marker = state / 'owner.json'
        if not marker.is_file() or json.loads(marker.read_text(encoding='utf-8')) != {'format': FORMAT, 'repo': str(repo.resolve())}:
            raise ValueError('Refusing to reuse a non-owned state directory.')


@contextmanager
def locked(state):
    with (state / 'build.lock').open('a+b') as handle:
        if os.name == 'nt':
            handle.write(b'0')
            handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise RuntimeError('Another development build owns this state directory.') from error
        else:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def app_running(app):
    if not is_mac_app(app):
        env = dict(os.environ, HPS_DEV_APP_PATH=str(app.resolve()))
        script = "$ErrorActionPreference='Stop'; $root=$env:HPS_DEV_APP_PATH.TrimEnd('\\')+'\\'; $matches=Get-CimInstance Win32_Process -Filter \"Name='HypeProof Studio.exe'\"; if (@($matches | Where-Object { -not $_.ExecutablePath }).Count) { throw 'Cannot inspect Studio executable paths' }; if (@($matches | Where-Object { $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase) }).Count) { exit 0 }; exit 1"
        check = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                               env=env, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    else:
        check = subprocess.run(['pgrep', '-f', re.escape(str(app)) + '/Contents/'], capture_output=True, text=True)
    if check.returncode not in (0, 1):
        raise RuntimeError('Cannot inspect processes; refusing to replace the development app.')
    return check.returncode == 0


def file_manifest(root):
    result = {}
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            result[str(p.relative_to(root))] = 'link:' + os.readlink(p)
        elif p.is_file():
            result[str(p.relative_to(root))] = sha(p)
    return result


def configure_copy(app, identifier, account_preview=False):
    root = app_resources(app)
    product_path = root / 'product.json'
    product = json.loads(product_path.read_text(encoding='utf-8'))
    product.update(nameShort='HypeProof Studio Dev', nameLong='HypeProof Studio Dev',
                   applicationName='hypeproof-studio-dev-' + identifier,
                   dataFolderName='.hypeproof-studio-dev-' + identifier,
                   darwinBundleIdentifier='ai.hypeproof.studio.dev.' + identifier,
                   urlProtocol='hypeproof-studio-dev-' + identifier)
    for key in ('updateUrl', 'downloadUrl'):
        product.pop(key, None)
    if not is_mac_app(app):
        product.update(win32AppUserModelId='HypeProof.Studio.Dev.' + identifier,
                       win32MutexName='hypeproof-studio-dev-' + identifier)
    product_path.write_text(json.dumps(product, indent=2), encoding='utf-8')
    if not is_mac_app(app):
        return
    info = app / 'Contents/Info.plist'
    data = plistlib.loads(info.read_bytes())
    # Keep CFBundleName, executable and package.json name: Electron locates its
    # shipped Helper apps by that name. Changing it causes a fatal launch error.
    data['CFBundleIdentifier'] = product['darwinBundleIdentifier']
    data['CFBundleDisplayName'] = 'HypeProof Studio Dev'
    if account_preview:
        data['CFBundleURLTypes'] = [{'CFBundleURLName': product['darwinBundleIdentifier'], 'CFBundleURLSchemes': [product['urlProtocol']]}]
    else:
        data.pop('CFBundleURLTypes', None)
    info.write_bytes(plistlib.dumps(data))


def register_account_protocol(app, state):
    """Register only this isolated account preview scheme, never the installed app's scheme."""
    settings = json.loads((state / 'user-data/User/settings.json').read_text(encoding='utf-8'))
    if not settings.get('hypeproofChat.accountsPreview'):
        return
    product = json.loads((app_resources(app) / 'product.json').read_text(encoding='utf-8'))
    scheme = product.get('urlProtocol', '')
    if not re.fullmatch(r'hypeproof-studio-dev-[a-f0-9]{12}', scheme):
        raise RuntimeError('Account preview protocol must belong to this isolated development app.')
    if is_mac_app(app):
        run(['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', '-f', app])
    elif os.name == 'nt':
        command = subprocess.list2cmdline([str(app / 'HypeProof Studio.exe'), '--user-data-dir=' + str(state / 'user-data'),
                                           '--extensions-dir=' + str(state / 'extensions'), '--open-url', '--']) + ' "%1"'
        key = 'HKCU\\Software\\Classes\\' + scheme
        run(['reg.exe', 'add', key, '/ve', '/d', 'URL:HypeProof Studio account preview', '/f'])
        run(['reg.exe', 'add', key, '/v', 'URL Protocol', '/d', '', '/f'])
        run(['reg.exe', 'add', key + '\\shell\\open\\command', '/ve', '/d', command, '/f'])


def settings_for(existing, service, branch, account_preview=False):
    result = dict(existing)
    result.update({'update.mode': 'none', 'extensions.autoUpdate': False,
                   'extensions.autoCheckUpdates': False,
                   'window.title': '[DEV · ' + service + ' · ' + branch + '] ${activeEditorShort} — ${rootName}',
                   'hypeproofChat.proxyUrl': 'http://127.0.0.1:8787/v1' if service == 'local' else 'https://api.hypeproof-ai.xyz/v1'})
    if account_preview:
        if service != 'local':
            raise ValueError('Account preview requires the isolated local Service.')
        result.update({'hypeproofChat.accountsPreview': True, 'hypeproofChat.proxyUrl': 'http://127.0.0.1:8793/v1', 'hypeproofChat.siteBase': 'http://localhost:3193'})
    else:
        result['hypeproofChat.accountsPreview'] = False
    colors = dict(result.get('workbench.colorCustomizations', {}))
    colors.update({'titleBar.activeBackground': '#493262', 'titleBar.activeForeground': '#ffffff'})
    result['workbench.colorCustomizations'] = colors
    return result


def build(repo, stage):
    ext = repo / 'extensions/hypeproof-chat'
    # Bundlers resolve .js before .ts/.tsx. A previous emitting tsc run can
    # silently shadow edited source; never package an ambiguous source tree.
    for source in (ext / 'src', ext / 'webview-ui/src'):
        for js in source.rglob('*.js'):
            if js.with_suffix('.ts').exists() or js.with_suffix('.tsx').exists():
                raise RuntimeError(f'Shadowed TypeScript source: {js}. Move the generated JavaScript out of src before building.')
    esbuild = ext / 'node_modules/esbuild/lib/main.js'
    vite = ext / 'webview-ui/node_modules/vite/bin/vite.js'
    if not esbuild.exists() or not vite.exists():
        raise RuntimeError('Dependencies missing. Run npm ci in extensions/hypeproof-chat and its webview-ui directory.')
    stage.mkdir(parents=True, exist_ok=True)
    metadata = stage / 'bundle-inputs.json'
    run(['node', '-e', "const result=require('esbuild').buildSync({entryPoints:['src/extension.ts'],bundle:true,platform:'node',target:'node18',external:['vscode'],outfile:process.argv[1],metafile:true});require('fs').writeFileSync(process.argv[2],JSON.stringify(result.metafile))", stage / 'extension.js', metadata], cwd=ext)
    run(['node', vite, 'build', '--outDir', stage / 'webview', '--emptyOutDir'], cwd=ext / 'webview-ui')
    vendor = stage / 'vendor'
    if vendor.exists():
        shutil.rmtree(vendor)
    run(['node', repo / 'scripts/studio-dev-vendor.mjs', ext, vendor, stage / 'vendor-receipt.json'])
    result = json.loads(metadata.read_text(encoding='utf-8'))
    result['hps_sdk_vendor'] = json.loads((stage / 'vendor-receipt.json').read_text(encoding='utf-8'))
    return result


def check_runtime_dependencies(source, shipped, metadata):
    for name, version in source.get('dependencies', {}).items():
        if name in ('@anthropic-ai/claude-agent-sdk', 'zod') and name in metadata.get('hps_sdk_vendor', {}).get('packages', {}):
            continue
        if shipped.get('dependencies', {}).get(name) == version:
            continue
        bundled = any(p.replace('\\', '/').startswith('node_modules/' + name + '/') for p in metadata.get('inputs', {}))
        external = any(imp.get('external') and (imp['path'] == name or imp['path'].startswith(name + '/'))
                       for output in metadata.get('outputs', {}).values() for imp in output.get('imports', []))
        if not bundled or external:
            raise RuntimeError('Unbundled runtime dependency differs from base app: ' + name + '. Use a compatible base app; launcher does not package new SDK dependencies.')


INACTIVE_BACKUP = re.compile(r'previous-[0-9a-f]{32}\.inactive')


def discard_inactive(path):
    try:
        shutil.rmtree(path)
    except OSError as error:
        print(f'WARNING: could not remove previous development app {path.name}: {error}', file=sys.stderr, flush=True)
        return False
    return True


def prune_inactive(state, keep=None):
    for path in state.iterdir():
        if INACTIVE_BACKUP.fullmatch(path.name) and path.is_dir() and not path.is_symlink() and path != keep:
            discard_inactive(path)


CHALK_ID = 'hypeproof.hypeproof-chalk'
CHALK_ORIGIN = 'hypeproof/hypeproof-chalk'
NO_CHALK_HINT = 'Run again with --no-chalk (or HPS_DEV_CHALK=0) to build the Dev app without Chalk.'


def chalk_mode(with_chalk, no_chalk):
    flag = os.environ.get('HPS_DEV_CHALK')
    if flag not in (None, '', '0', '1'):
        raise ValueError('HPS_DEV_CHALK must be 0 or 1.')
    if with_chalk and no_chalk:
        raise ValueError('Use only one of --with-chalk and --no-chalk.')
    if no_chalk or (not with_chalk and flag == '0'):
        return 'off'
    if with_chalk or flag == '1':
        return 'on'
    return 'auto'


def main_checkout(repo):
    common = subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=repo, text=True, encoding='utf-8').strip()
    return Path(common).parent


def chalk_checkout(repo):
    """Return (checkout, None) for a verified Chalk checkout, else (None, reason)."""
    explicit = os.environ.get('HPS_CHALK_CHECKOUT')
    path = Path(explicit) if explicit else main_checkout(repo).parent / 'hypeproof-chalk'
    if not (path / 'package.json').is_file():
        return None, f'no Chalk checkout at {path}'
    try:
        top = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=path, text=True, encoding='utf-8', stderr=subprocess.DEVNULL).strip()
        origin = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=path, text=True, encoding='utf-8', stderr=subprocess.DEVNULL).strip()
    except subprocess.CalledProcessError:
        return None, f'{path} is not a git checkout'
    if Path(top).resolve() != path.resolve() or not re.search(r'[:/]' + re.escape(CHALK_ORIGIN) + r'(\.git)?/?$', origin):
        return None, f'{path} is not a checkout of {CHALK_ORIGIN}'
    manifest = json.loads((path / 'package.json').read_text(encoding='utf-8'))
    if f"{manifest.get('publisher')}.{manifest.get('name')}" != CHALK_ID:
        return None, f'{path} package.json is not {CHALK_ID}'
    return path.resolve(), None


def chalk_cli(app):
    return app_resources(app) / ('bin/hypeproof-studio' if is_mac_app(app) else 'bin/hypeproof-studio.cmd')


def chalk_cli_args(state):
    user_data = state / 'user-data'
    user_data.mkdir(parents=True, exist_ok=True)
    return ['--extensions-dir=' + str(state / 'extensions'), '--user-data-dir=' + str(user_data)]


def remove_chalk(state, app):
    """Uninstall Chalk through the app CLI; fall back to deleting its folders only if that fails."""
    cli = chalk_cli(app)
    if cli.is_file():
        try:
            with (state / 'chalk-build.log').open('a', encoding='utf-8') as out:
                run([cli, *chalk_cli_args(state), '--uninstall-extension', CHALK_ID], stdout=out, stderr=subprocess.STDOUT)
            return
        except subprocess.CalledProcessError:
            pass
    for old in (state / 'extensions').glob(CHALK_ID + '-*'):
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)


def chalk_failure(step, log):
    return RuntimeError(f'Chalk {step} failed; see {log}. {NO_CHALK_HINT}')


def package_chalk(checkout, state):
    if not (checkout / 'node_modules').is_dir():
        raise RuntimeError(f'Chalk checkout has no node_modules. Run npm ci in {checkout}. {NO_CHALK_HINT}')
    dist = checkout / 'dist'
    dist.mkdir(exist_ok=True)
    for old in dist.glob('*.vsix'):
        old.unlink()
    log = state / 'chalk-build.log'
    with log.open('w', encoding='utf-8') as out:
        try:
            run([shutil.which('npm') or 'npm', 'run', 'vsix'], cwd=checkout, stdout=out, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError:
            raise chalk_failure('npm run vsix', log) from None
    packages = sorted(dist.glob('*.vsix'))
    if len(packages) != 1:
        raise RuntimeError(f'Chalk build must leave exactly one vsix; found {len(packages)} in {dist}. {NO_CHALK_HINT}')
    return packages[0]


def engine_satisfied(engine, version):
    """Check a VS Code engines range against the app's product.json version.

    Only the forms Chalk uses are supported: '>=X.Y.Z', '^X.Y.Z' (major > 0) and 'X.Y.Z'.
    Anything else raises, so a rule this code does not know cannot pass silently.
    """
    match = re.fullmatch(r'\s*(\^|>=)?\s*(\d+)\.(\d+)\.(\d+)\s*', engine)
    if not match or (match.group(1) == '^' and match.group(2) == '0'):
        raise ValueError(f'unsupported engines.vscode range: {engine!r}')
    want = tuple(int(part) for part in match.group(2, 3, 4))
    current = re.fullmatch(r'\s*(\d+)\.(\d+)\.(\d+)\s*', version)
    if not current:
        raise ValueError(f'unsupported app version: {version!r}')
    have = tuple(int(part) for part in current.groups())
    if match.group(1) == '>=':
        return have >= want
    if match.group(1) == '^':
        return have[0] == want[0] and have >= want
    return have == want


def check_chalk_engine(app, checkout):
    product = json.loads((app_resources(app) / 'product.json').read_text(encoding='utf-8'))
    engine = json.loads((checkout / 'package.json').read_text(encoding='utf-8')).get('engines', {}).get('vscode', '')
    version = product.get('version', '')
    if not engine or not engine_satisfied(engine, version):
        raise RuntimeError(f"Chalk requires VS Code '{engine}', but the Dev app product.json version is '{version}'. {NO_CHALK_HINT}")


def install_chalk(app, state, vsix, checkout):
    cli = chalk_cli(app)
    if not cli.is_file():
        raise RuntimeError(f'Dev app CLI not found: {cli}. {NO_CHALK_HINT}')
    check_chalk_engine(app, checkout)
    remove_chalk(state, app)
    log = state / 'chalk-build.log'
    with log.open('a', encoding='utf-8') as out:
        try:
            run([cli, *chalk_cli_args(state), '--install-extension', vsix, '--force'], stdout=out, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError:
            raise chalk_failure('install', log) from None


def chalk_record(checkout, vsix):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=checkout, text=True, encoding='utf-8').strip()
    return {'commit': git('rev-parse', 'HEAD'), 'dirty': bool(git('status', '--porcelain', '--', '.', ':!dist')),
            'ref': git('branch', '--show-current') or 'detached', 'vsix_sha256': sha(vsix)}


def plan_chalk(repo, state, app, mode):
    """Check and pack Chalk before the Studio build, so its errors come first. Return a plan or None."""
    if mode == 'off':
        remove_chalk(state, app)
        print('NOTE: Chalk extension removed from the Dev app (--no-chalk).', flush=True)
        return None
    checkout, reason = chalk_checkout(repo)
    if checkout is None:
        if mode == 'on':
            raise RuntimeError(f'{reason}. Set HPS_CHALK_CHECKOUT to a Chalk checkout. {NO_CHALK_HINT}')
        remove_chalk(state, app)
        print('NOTE: Chalk checkout not found; Dev app runs without the Chalk extension.', flush=True)
        return None
    return {'checkout': checkout, 'vsix': package_chalk(checkout, state)}


def prepare(repo, base, state, service, account_preview=False, chalk='auto'):
    app = state / ('HypeProof Studio Dev.app' if is_mac_app(base) else 'HypeProof Studio Dev')
    if app_running(app):
        raise RuntimeError('Save your work and quit only the development app before applying changes. It will not be killed.')
    chalk_plan = plan_chalk(repo, state, app, chalk)
    source_before = source_snapshot(repo)
    stage = state / 'build'
    metadata = build(repo, stage)
    require_same_source(repo, source_before)
    before = file_manifest(base)
    candidate = state / ('candidate-' + uuid.uuid4().hex + ('.app' if is_mac_app(base) else ''))
    if is_mac_app(base):
        run(['/usr/bin/ditto', base, candidate])
    else:
        shutil.copytree(base, candidate, symlinks=True)
    target = app_resources(candidate) / 'extensions/hypeproof-chat'
    if not target.is_dir():
        raise RuntimeError('Installed base app has no bundled hypeproof-chat extension.')
    ext = repo / 'extensions/hypeproof-chat'
    source_manifest = json.loads((ext / 'package.json').read_text(encoding='utf-8'))
    shipped_manifest = json.loads((target / 'package.json').read_text(encoding='utf-8'))
    check_runtime_dependencies(source_manifest, shipped_manifest, metadata)
    if '@anthropic-ai/claude-agent-sdk' in {**source_manifest.get('devDependencies', {}), **source_manifest.get('dependencies', {})}:
        if not metadata.get('hps_sdk_vendor') or not (stage / 'vendor').is_dir():
            raise RuntimeError('Current SDK vendor stage is required; stale shell SDK cannot be retained.')
        shutil.rmtree(target / 'dist/vendor', ignore_errors=True)
        shutil.copytree(stage / 'vendor', target / 'dist/vendor')
    shutil.copy2(stage / 'extension.js', target / 'dist/extension.js')
    shutil.rmtree(target / 'webview-ui/dist')
    shutil.copytree(stage / 'webview', target / 'webview-ui/dist')
    # The manifest references current icons/themes as well as compiled code.
    if (ext / 'media').is_dir():
        shutil.copytree(ext / 'media', target / 'media', dirs_exist_ok=True)
    shutil.copy2(ext / 'package.json', target / 'package.json')
    configure_copy(candidate, hashlib.sha256(str(repo).encode()).hexdigest()[:12], account_preview=account_preview)
    if is_mac_app(base):
        run(['codesign', '--force', '--deep', '--sign', '-', candidate])
        run(['codesign', '--verify', '--deep', candidate])
    chalk_entry = None
    try:
        if chalk_plan is not None:
            install_chalk(candidate, state, chalk_plan['vsix'], chalk_plan['checkout'])
            chalk_entry = chalk_record(chalk_plan['checkout'], chalk_plan['vsix'])
    except Exception:
        shutil.rmtree(candidate, ignore_errors=True)
        raise
    if before != file_manifest(base):
        raise RuntimeError('Installed app changed during preparation. Candidate not applied.')
    # Check again before switching: an app opened during build must not be replaced.
    if app_running(app):
        raise RuntimeError('Development app opened during build; candidate left unapplied.')
    require_same_source(repo, source_before)
    backup = None
    if app.exists():
        backup = state / ('previous-' + uuid.uuid4().hex + '.inactive')
        app.rename(backup)
    try:
        candidate.rename(app)
    except Exception:
        if backup is not None:
            backup.rename(app)
        raise
    kept_backup = backup if backup is not None and not discard_inactive(backup) else None
    prune_inactive(state, keep=kept_backup)
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=repo, text=True, encoding='utf-8').strip()
    user = state / 'user-data/User'
    user.mkdir(parents=True, exist_ok=True)
    settings = user / 'settings.json'
    existing = json.loads(settings.read_text(encoding='utf-8')) if settings.exists() else {}
    settings.write_text(json.dumps(settings_for(existing, service, branch, account_preview), ensure_ascii=False, indent=2), encoding='utf-8')
    workspace = state / 'workspace'
    workspace.mkdir(exist_ok=True)
    receipt = {'format': FORMAT, 'source': str(repo), 'source_sha': source_before['sha'],
               'source_dirty': source_before['dirty'], 'source_binding': source_before,
               'branch': branch, 'app': str(app), 'platform': platform.system(),
               'service': service, 'official_app_unchanged': True, 'extension_sha256': sha(app_resources(app) / 'extensions/hypeproof-chat/dist/extension.js'),
               'sdk_vendor': metadata.get('hps_sdk_vendor'), 'chalk': chalk_entry,
               'previous_app': str(kept_backup) if kept_backup else None, 'prepared_at': time.time()}
    (state / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False, indent=2), flush=True)
    return app


def _clear_stale_ipc_socket(user_data: Path) -> None:
    """Remove VS Code single-instance IPC sockets left by a dead process.

    VS Code uses a UNIX socket named after the product version (e.g. "0.1.-main")
    in the user-data directory for single-instance coordination.  If a previous
    run exited abnormally the socket file is left behind.  On the next launch VS
    Code finds it, tries to hand focus to the old instance, fails, and exits.

    Safe-guard: if code.lock names a living PID the old instance is still running
    — do NOT remove the socket and abort instead of silently stealing focus.
    """
    lock_file = user_data / 'code.lock'
    if lock_file.exists():
        try:
            locked_pid = int(lock_file.read_text().strip())
        except (ValueError, OSError):
            locked_pid = None
        if locked_pid:
            try:
                os.kill(locked_pid, 0)
                # PID is alive — another Dev instance is running
                raise RuntimeError(
                    f'Another Dev instance (PID {locked_pid}) is already running '
                    f'with this state dir. Stop it before launching a new one.')
            except ProcessLookupError:
                pass  # PID is dead — stale lock, continue

    # Remove every file whose name ends with "-main" (VS Code IPC socket pattern).
    removed = []
    for p in user_data.glob('*-main'):
        if p.is_socket():
            p.unlink()
            removed.append(p.name)
    if removed:
        print(f'Warning: removed stale IPC socket(s) from user-data: {removed}',
              file=sys.stderr, flush=True)


def launch(app, state, local_runtime=None, cdp_port=None, inmemory_secrets=False):
    executable = (app / 'Contents/MacOS' / plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleExecutable']) if is_mac_app(app) else app / 'HypeProof Studio.exe'
    env = dict(os.environ)
    # Tests from another Studio window must not override this copy's local identity.
    for key in list(env):
        if key.startswith('HPS_TEST_'):
            env.pop(key)
    # The launcher already has the developer shell environment. VS Code's
    # second interactive-shell probe can hang on startup hooks.
    env['VSCODE_CLI'] = '1'
    for key in ('HPS_DEV_RUNTIME', 'HPS_DEV_PROVIDER', 'HPS_DEV_MODEL', 'HPS_DEV_EXECUTABLE'):
        env.pop(key, None)
    if local_runtime:
        env.update(HPS_DEV_RUNTIME='1', HPS_DEV_PROVIDER=local_runtime['provider'],
                   HPS_DEV_MODEL=local_runtime['model'], HPS_DEV_EXECUTABLE=local_runtime['executable'])
    # Never import the globally shared dev-stack token implicitly.
    env['HPS_DEV_TOKEN_FILE'] = str(state / 'local-participant-token.txt')
    # HPS_DEV_ISSUER_TOKEN_FILE: forwarded from the caller when set (review-pr.sh writes it).
    # dict(os.environ) above already carries it; no explicit override needed.
    if os.name != 'nt':
        # POSIX only: Windows keeps the single-instance handle in a named pipe, not in
        # user-data, and os.kill(pid, 0) there sends CTRL_C_EVENT instead of probing.
        _clear_stale_ipc_socket(state / 'user-data')
    cmd = [str(executable),
           '--user-data-dir=' + str(state / 'user-data'), '--extensions-dir=' + str(state / 'extensions'),
           '--new-window', '--skip-welcome', '--skip-release-notes', str(state / 'workspace')]
    if cdp_port is not None:
        # Chromium binds --remote-debugging-port to 127.0.0.1 by default; no address flag needed.
        cmd += [f'--remote-debugging-port={cdp_port}']
    if inmemory_secrets:
        # The copy is ad-hoc signed, so the OS keychain would ask for the login password before it
        # hands over the shared "Safe Storage" item. Secrets then live only for this process; the
        # local participant code is read again from the state directory at every launch.
        cmd += ['--use-inmemory-secretstorage']
    options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    with (state / 'app.log').open('a', encoding='utf-8') as log:
        process = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, **options)
    time.sleep(3)
    if process.poll() is not None:
        raise RuntimeError('Development app exited during startup. Inspect app.log; launch is not verified.')
    print('Development process started: ' + str(process.pid) + '. Inspect the window; this is not an AI smoke test.')


def setup_local_participant(repo, state):
    base = 'http://127.0.0.1:8787'
    def request(method, path, body=None, authorization=None):
        headers = {'content-type': 'application/json'}
        if authorization:
            headers['authorization'] = authorization
        req = Request(base + path, method=method, headers=headers,
                      data=json.dumps(body).encode('utf-8') if body is not None else None)
        try:
            with urlopen(req, timeout=15) as response:
                return json.load(response)
        except (HTTPError, URLError) as error:
            raise RuntimeError('Local Service request failed: ' + path + '. Start the local Worker and check its admin configuration.') from error
    health = request('GET', '/v1/health')
    if health.get('service') != 'hypeproof-studio-api' or health.get('env') != 'dev':
        raise RuntimeError('--setup-local requires a development Service on 127.0.0.1:8787.')
    vars_path = Path(os.environ.get('HPS_SERVICE_DEV_VARS', str(state / 'service.dev.vars')))
    variables = {}
    if vars_path.is_file():
        for line in vars_path.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                name, value = line.split('=', 1)
                variables[name.strip()] = value.strip().strip('"').strip("'")
    password = os.environ.get('HPS_ADMIN_PASSWORD') or variables.get('HPS_ADMIN_PASSWORD')
    if not password:
        raise RuntimeError('Set local HPS_ADMIN_PASSWORD in the environment or HPS_SERVICE_DEV_VARS before --setup-local.')
    auth = 'Basic ' + base64.b64encode((':' + password).encode('utf-8')).decode('ascii')
    cohort, profile = 'homepage-practice', 'homepage-practice-s1'
    user = 'dev-' + hashlib.sha256(str(repo.resolve()).encode()).hexdigest()[:12]
    detail = request('GET', '/admin/cohorts/' + cohort, authorization=auth)
    now = datetime.now(timezone.utc)
    active = detail.get('session')
    if active and datetime.fromisoformat(active['ends_at'].replace('Z', '+00:00')) > now:
        if active.get('profile_id') != profile:
            raise RuntimeError('An existing local activity uses another profile; it was not replaced.')
    else:
        request('POST', '/admin/cohorts/' + cohort + '/session',
                {'profile_id': profile, 'starts_at': now.isoformat(), 'ends_at': (now + timedelta(hours=4)).isoformat()}, auth)
    request('POST', '/admin/cohorts/' + cohort + '/roster/append', {'users': [user]}, auth)
    issued = request('POST', '/admin/tokens/issue', {'u': user, 'c': cohort, 'p': profile, 'hours': 4}, auth)
    token = issued.get('token')
    if not isinstance(token, str) or not token:
        raise RuntimeError('Local Service did not issue a participant code.')
    request('GET', '/v1/profile', authorization='Bearer ' + token)
    token_file = state / 'local-participant-token.txt'
    token_file.write_text(token, encoding='utf-8')
    token_file.chmod(0o600)
    print('Prepared local developer activity and participant code. The code is not printed or forwarded to the AI CLI.')


def stamp(repo):
    ext = repo / 'extensions/hypeproof-chat'
    files = [p for root in (ext / 'src', ext / 'webview-ui/src') for p in root.rglob('*') if p.is_file()]
    files += [ext / 'package.json', ext / 'webview-ui/package.json', ext / 'webview-ui/vite.config.ts']
    return tuple((str(p), p.stat().st_mtime_ns) for p in sorted(files))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'run', 'watch', 'status'])
    parser.add_argument('--base-app', type=Path)
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--service', choices=['local', 'live'], default='local')
    parser.add_argument('--account-preview', action='store_true', help='Use the isolated account Service (8793) and Lab (3193); production accounts stay disabled.')
    parser.add_argument('--cdp-port', type=int, default=None,
                        help='Open CDP remote debugging port on 127.0.0.1 only. Default: off.')
    parser.add_argument('--provider', choices=['claude', 'codex', 'service'],
                        default='codex' if platform.system() == 'Windows' else 'claude',
                        help='Development funding: local Codex subscription (Windows default), Claude Code subscription (macOS default), or Service API.')
    parser.add_argument('--cli-executable', type=Path, help='Explicit installed native Claude Code or Codex CLI.')
    parser.add_argument('--setup-local', action='store_true', help='Prepare a developer activity/code through an already running local development Service.')
    parser.add_argument('--inmemory-secrets', action='store_true', help='Launch with --use-inmemory-secretstorage: no OS keychain access (scripts/cr-dev-kit.sh).')
    parser.add_argument('--with-chalk', action='store_true', help='Install the Chalk extension from the sibling hypeproof-chalk checkout; fail when it is missing. Env: HPS_DEV_CHALK=1.')
    parser.add_argument('--no-chalk', action='store_true', help='Do not install Chalk and remove an installed copy. Env: HPS_DEV_CHALK=0.')
    args = parser.parse_args()
    mode = chalk_mode(args.with_chalk, args.no_chalk)
    if not (platform.system() == 'Windows' or (platform.system() == 'Darwin' and platform.machine() == 'arm64')):
        raise RuntimeError('This development launcher supports macOS arm64 and Windows only.')
    if args.setup_local and args.service != 'local':
        raise ValueError('--setup-local cannot change a live Service.')
    if args.account_preview and (args.service != 'local' or args.setup_local):
        raise ValueError('--account-preview requires --service local and cannot mint a classroom code with --setup-local.')
    args.base_app = args.base_app or default_base()
    state_parent = Path(os.environ['LOCALAPPDATA']) / 'HypeProofStudioDev' if platform.system() == 'Windows' else Path.home() / 'Library/Application Support/HypeProof Studio Development'
    state = args.state_dir or state_parent / hashlib.sha256(str(REPO).encode()).hexdigest()[:12]
    validate_paths(REPO, args.base_app, state)
    state = state.resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    (state / 'owner.json').write_text(json.dumps({'format': FORMAT, 'repo': str(REPO.resolve())}), encoding='utf-8')
    if args.action == 'status':
        print((state / 'receipt.json').read_text(encoding='utf-8') if (state / 'receipt.json').exists() else 'No prepared development app.')
    elif args.action == 'watch':
        previous = None
        while True:
            current = stamp(REPO)
            if current != previous:
                try:
                    with locked(state):
                        build(REPO, state / 'build')
                    print('Built. Save and quit the development app, then run again to apply.', flush=True)
                except subprocess.CalledProcessError:
                    print('Build failed; running app unchanged.', flush=True)
                previous = current
            time.sleep(1)
    else:
        local_runtime = None
        if args.provider != 'service':
            if args.service != 'local':
                raise ValueError('Local subscription mode requires --service local. Use --provider service for production Service.')
            executable = resolve_cli(args.provider, args.cli_executable)
            try:
                checked = run(['node', REPO / 'scripts/local-runtime-probe.mjs', args.provider, executable], capture_output=True, text=True, encoding='utf-8')
            except subprocess.CalledProcessError as error:
                raise RuntimeError((error.stderr or '').strip() or 'Local CLI login check failed.') from None
            local_runtime = json.loads(checked.stdout)
            local_runtime['executable'] = executable
            print('Development connection: ' + local_runtime['label'] + ' / ' + local_runtime['model'], flush=True)
        with locked(state):
            if args.setup_local:
                setup_local_participant(REPO, state)
            app = prepare(REPO, args.base_app.resolve(), state, args.service, args.account_preview, mode)
            if args.action == 'run':
                if args.account_preview:
                    register_account_protocol(app, state)
                launch(app, state, local_runtime, cdp_port=args.cdp_port, inmemory_secrets=args.inmemory_secrets)


if __name__ == '__main__':
    if os.name == 'nt':
        # Windows redirected output otherwise uses the legacy ANSI code page.
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Studio dev: ' + str(error), file=sys.stderr)
        sys.exit(1)
