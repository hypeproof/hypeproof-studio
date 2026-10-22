#!/usr/bin/env python3
"""Install canonical shared skills with content receipts; preserve local edits."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

NAMES = ('hype-release', 'hype-verify', 'hype-deliver', 'hypeproof-operator', 'hype-coordinate', 'hype-pr', 'hype-align')
RECEIPT = '.hypeproof-install.json'


def files(root):
    if root.is_symlink():
        raise ValueError('refuse symlink installation directory')
    result = {}
    if root.exists():
        for p in root.rglob('*'):
            if p.is_symlink(): raise ValueError('refuse symlink in managed skill')
            if p.is_file() and p.name != RECEIPT and '__pycache__' not in p.parts:
                result[str(p.relative_to(root))] = p.read_bytes()
    return result


def hashes(mapping):
    return {k: hashlib.sha256(v).hexdigest() for k, v in mapping.items()}


def bundle(source, name):
    result = files(source / 'skills' / name)
    if name == 'hype-release':
        result.update({'runtime/' + k: v for k, v in files(source / 'scripts/hype-release').items() if k.endswith(('.py', '.json'))})
    return result


def ancestor_links(path):
    return any(p.is_symlink() for p in [path, *path.parents])


def install(source, target, apply=False, adopt_revision=None):
    source, target = Path(source).resolve(), Path(target).absolute()
    if ancestor_links(target): raise ValueError('refuse installation through a symlink')
    revision = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    dirty = bool(subprocess.check_output(['git','-C',str(source),'status','--porcelain','--','skills', 'scripts/hype-release'],text=True).strip())
    planned = []
    for name in NAMES:
        dest = target / name
        desired = bundle(source, name)
        # An explicit adoption may replace a canonical symlink itself, never its target.
        # It still has to match every byte of the trusted revision below.
        linked = dest.is_symlink()
        current = files(dest.resolve()) if linked else files(dest)
        receipt = json.loads((dest/RECEIPT).read_text()) if (dest/RECEIPT).exists() else None
        clean = not linked and (not current or hashes(current) == hashes(desired) or receipt and hashes(current) == receipt['files'])
        revisions = [adopt_revision] if isinstance(adopt_revision, str) else (adopt_revision or [])
        for baseline in revisions:
            if clean: break
            # Adopt only bytes exactly matching an explicitly named canonical revision.
            old_paths = subprocess.check_output(['git','-C',str(source),'ls-tree','-r','--name-only',baseline,'--','skills/'+name],text=True).splitlines()
            old = {str(Path(p).relative_to('skills/'+name)): subprocess.check_output(['git','-C',str(source),'show',baseline+':'+p]) for p in old_paths}
            clean = bool(old) and hashes(old) == hashes(current)
        state = 'CURRENT' if not linked and hashes(current) == hashes(desired) and receipt and receipt.get('sourceRevision') == revision and receipt.get('workingTree') == dirty else 'UPDATE' if clean else 'LOCAL_CHANGES'
        planned.append((name, dest, desired, state))
    if apply and any(p[3] == 'LOCAL_CHANGES' for p in planned):
        raise ValueError('local edits or unmanaged copies detected; no skills changed. Compare before adopting a canonical revision')
    if apply:
        target.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.hypeproof-stage-',dir=target) as temporary:
            stage = Path(temporary)
            for name,dest,desired,state in planned:
                if state == 'CURRENT': continue
                prepared=stage/name;prepared.mkdir()
                for relative, content in desired.items():
                    out=prepared/relative;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(content)
                (prepared/RECEIPT).write_text(json.dumps({'schema':'hypeproof-skill-install/1','sourceRevision':revision,'workingTree':dirty,'files':hashes(desired)},indent=2)+'\n')
                # Preserve every prior version, and roll back on a failed replacement.
                backup=target/('.'+name+'.backup-'+hashlib.sha256(os.urandom(16)).hexdigest()[:12])
                if dest.exists(): dest.rename(backup)
                try: prepared.rename(dest)
                except OSError:
                    if backup.exists(): backup.rename(dest)
                    raise
    return {'sourceRevision':revision,'workingTree':dirty,'applied':apply,'skills':{n:s for n,_,_,s in planned}}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',default=str(Path(__file__).resolve().parents[2]))
    p.add_argument('--target',required=True,help='e.g. your existing Codex skills directory')
    p.add_argument('--apply',action='store_true');p.add_argument('--adopt-revision',action='append')
    a=p.parse_args()
    try:
        result=install(a.source,a.target,a.apply,a.adopt_revision);print(json.dumps(result,indent=2))
        if not a.apply and any(v!='CURRENT' for v in result['skills'].values()):raise SystemExit(1)
    except (ValueError,OSError,subprocess.SubprocessError) as e:
        print(json.dumps({'status':'BLOCKED','reason':str(e)}));raise SystemExit(2)
