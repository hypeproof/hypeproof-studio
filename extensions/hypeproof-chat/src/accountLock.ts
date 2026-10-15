import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
/** SecretStorage is shared across windows. Refresh rotation needs an inter-process critical section. */
export function accountLock(directory: string): <T>(work: () => Promise<T>) => Promise<T> {
  const file = path.join(directory, 'account-session.lock');
  const markerPrefix = 'account-session.recovery.';
  const alive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
  };
  // Every recovery barrier has a unique name carrying PID + nonce at mkdir time.
  // A crash cannot leave an unowned empty barrier, and cleaners never unlink a
  // newly created barrier: no other process reuses a dead owner's unique path.
  const recovering = (): boolean => {
    let active = false;
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(markerPrefix)) continue;
      const pid = Number(name.slice(markerPrefix.length).split('.')[0]);
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid account recovery marker');
      if (alive(pid)) active = true;
      else { try { fs.rmdirSync(path.join(directory, name)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    }
    return active;
  };
  return async function locked<T>(work: () => Promise<T>): Promise<T> {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const nonce = randomUUID();
    for (let attempt = 0; attempt < 300; attempt++) {
      if (recovering()) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
      let acquired = false;
      try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 }); acquired = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (acquired && recovering()) { fs.unlinkSync(file); continue; }
      if (acquired) {
        try { return await work(); }
        finally { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file); }
      }
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && !alive(owner.pid)) {
          const marker = path.join(directory, `${markerPrefix}${process.pid}.${nonce}`);
          fs.mkdirSync(marker, {mode:0o700});
          try { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).nonce === owner.nonce) fs.unlinkSync(file); }
          finally { fs.rmdirSync(marker); }
        }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('계정 연결이 다른 창에서 갱신 중이에요. 잠시 뒤 다시 시도해 주세요.');
  };
}
