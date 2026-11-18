#!/usr/bin/env python3
"""Prepare a pinned Darwin lab host in a new private task directory, never globally."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main(args):
    def interrupted(_signum, _frame):
        # Give the owned stage's exception handler time to reap its separate group.
        # Repeated outer signals must not interrupt that bounded cleanup again.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise InterruptedError('owned_host_preparation_interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    os.umask(0o077)
    if platform.system() != 'Darwin':
        raise ValueError('This source-build helper is for Darwin; Linux uses the pinned release archive.')
    arch = {'arm64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine())
    if arch is None:
        raise ValueError('Unsupported Darwin architecture')
    output = Path(args.output).absolute()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    pins = json.loads((ROOT / 'pins.json').read_text())
    result = {'status': 'FAIL', 'system': platform.system(), 'arch': arch,
              'source_commit': pins['server_commit'], 'server_version': pins['server_version'],
              'go_version': pins['go_version'], 'steps': []}
    started = time.monotonic()
    if not 1 <= args.timeout_seconds <= 900:
        raise ValueError('Host preparation deadline must be 1..900 seconds')
    deadline = started + args.timeout_seconds
    def remaining():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError('Host preparation deadline expired')
        return seconds
    env = dict(os.environ, GOENV='off', GOTOOLCHAIN='local', CGO_ENABLED='1', GOOS='darwin', GOARCH=arch,
               GOFLAGS='', GOWORK='off', GOPROXY='https://proxy.golang.org', GOSUMDB='sum.golang.org',
               GOPRIVATE='', GONOPROXY='', GONOSUMDB='', GOMAXPROCS='2',
               GOPATH=str(output/'gopath'), GOMODCACHE=str(output/'gomod'), GOCACHE=str(output/'gocache'))
    def run(stage, command, *, cwd=None, timeout=600):
        begin = time.monotonic()
        with (output / (stage + '.log')).open('x') as log:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=min(timeout, remaining()))
            except BaseException as primary:
                try:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        with contextlib.suppress(ProcessLookupError):
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                    except BaseException as cleanup_error:
                        primary.add_note('owned_stage_cleanup_failed:' + type(cleanup_error).__name__)
                except BaseException as cleanup_error:
                    primary.add_note('owned_stage_cleanup_failed:' + type(cleanup_error).__name__)
                raise
        result['steps'].append({'stage': stage, 'exit': process.returncode,
                                'seconds': round(time.monotonic()-begin, 3)})
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
    try:
        if shutil.disk_usage(output).free < 4 * 1024**3:
            raise RuntimeError('At least 4 GiB free task storage is required')
        python = str(Path(args.python).resolve())
        version = subprocess.check_output([python, '-c', 'import sys,json; print(json.dumps(list(sys.version_info[:3])))'], text=True)
        if tuple(json.loads(version)) < (3, 12):
            raise RuntimeError('Use an existing Python >=3.12 for the pinned SDK dependencies')
        # The pinned go-osstat Darwin CPU implementation requires cgo/Mach headers.
        clang = subprocess.check_output(['/usr/bin/xcrun', '--find', 'clang'], text=True).strip()
        sdk = subprocess.check_output(['/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
        env.update(CC=clang, SDKROOT=sdk, CGO_CFLAGS='', CGO_CPPFLAGS='', CGO_CXXFLAGS='', CGO_LDFLAGS='')
        run('clang-version', [clang, '--version'])
        result.update(cgo_enabled=True, clang=clang, sdk=sdk,
                      clang_version=(output/'clang-version.log').read_text().strip())
        toolchain = pins['go_archives']['darwin-' + arch]
        archive = output / 'go.tar.gz'
        with urllib.request.urlopen(toolchain['url'], timeout=min(60, remaining())) as response, archive.open('xb') as target:
            size = 0
            while block := response.read(1024 * 1024):
                remaining()
                size += len(block)
                if size > toolchain['size']:
                    raise RuntimeError('Go download exceeded pinned size')
                target.write(block)
        if size != toolchain['size'] or sha(archive) != toolchain['sha256']:
            raise RuntimeError('Go archive identity mismatch')
        with tarfile.open(archive) as tar:
            members = tar.getmembers()
            if len(members) > 50000 or sum(m.size for m in members) > 2 * 1024**3:
                raise RuntimeError('Go archive expansion exceeds bound')
            if any((not m.name.startswith('go/') and not (m.name == 'go' and m.isdir()))
                   or '..' in Path(m.name).parts for m in members):
                raise RuntimeError('Go archive path outside toolchain')
            tar.extractall(output, filter='data')
        go = str(output/'go/bin/go')
        env['GOROOT'] = str(output/'go')
        env['PATH'] = str(output/'go/bin') + os.pathsep + os.environ.get('PATH', '')
        run('go-version', [go, 'version'])
        source = output/'server-source'
        run('source-init', ['git', 'init', '-q', str(source)])
        run('source-fetch', ['git', '-C', str(source), '-c', 'credential.helper=', 'fetch', '--depth=1',
                             'https://github.com/livekit/livekit.git', pins['server_commit']], timeout=120)
        run('source-checkout', ['git', '-C', str(source), 'checkout', '-q', '--detach', 'FETCH_HEAD'])
        actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != pins['server_commit']:
            raise RuntimeError('LiveKit source identity mismatch')
        module_hashes = {name: sha(source/name) for name in ('go.mod', 'go.sum')}
        server = output/'livekit-server'
        # wire_gen.go is committed at the pinned revision; do not run mutable generators/tidy.
        run('server-build', [go, 'build', '-mod=readonly', '-buildvcs=false', '-trimpath', '-p=2',
                              '-o', str(server), './cmd/server'], cwd=source, timeout=900)
        run('modules-verify', [go, 'mod', 'verify'], cwd=source)
        if module_hashes != {name: sha(source/name) for name in module_hashes}:
            raise RuntimeError('Pinned Go module files changed')
        run('server-version', [str(server), '--version'])
        if (output/'server-version.log').read_text().strip() != 'livekit-server version ' + pins['server_version']:
            raise RuntimeError('Built server version mismatch')
        run('server-libraries', ['/usr/bin/otool', '-L', str(server)])
        run('venv', [python, '-m', 'venv', str(output/'venv')])
        venv = output/'venv/bin/python'
        run('python-dependencies', [str(venv), '-m', 'pip', '--isolated', 'install', '--no-cache-dir',
                                    '--only-binary=:all:', '--index-url', 'https://pypi.org/simple',
                                    '-r', str(ROOT/'host-requirements.txt')])
        run('python-check', [str(venv), '-m', 'pip', 'check'])
        run('python-freeze', [str(venv), '-m', 'pip', 'freeze'])
        result.update(status='PASS', server=str(server), python=str(venv), server_sha256=sha(server),
                      go_archive_sha256=sha(archive), module_hashes=module_hashes,
                      linked_libraries_sha256=sha(output/'server-libraries.log'),
                      requirements_sha256=sha(ROOT/'host-requirements.txt'),
                      dependencies_sha256=sha(output/'python-freeze.log'))
    except BaseException as error:
        result.update(error_type=type(error).__name__)
        raise
    finally:
        result['seconds'] = round(time.monotonic()-started, 3)
        with (output/'host.json').open('x') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--timeout-seconds', type=int, default=600)
    main(parser.parse_args())
