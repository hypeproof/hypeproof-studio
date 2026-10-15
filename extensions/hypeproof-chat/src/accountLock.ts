import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
/** SecretStorage is shared across windows. Refresh rotation needs an inter-process critical section. */
export function accountLock(directory: string): <T>(work: () => Promise<T>) => Promise<T> {
  const file = path.join(directory, 'account-session.lock');
  const recovery = file + '.recovery';
  return async function locked<T>(work: () => Promise<T>): Promise<T> {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const nonce = randomUUID();
    for (let attempt = 0; attempt < 300; attempt++) {
      if (fs.existsSync(recovery)) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
      let acquired = false;
      try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 }); acquired = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (acquired && fs.existsSync(recovery)) { fs.unlinkSync(file); continue; }
      if (acquired) {
        try { return await work(); }
        finally { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file); }
      }
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
              let recovering = false;
              try { fs.mkdirSync(recovery, {mode:0o700}); recovering = true; } catch { /* Another recovery owns the barrier. */ }
              if (recovering) {
                try { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).nonce === owner.nonce) fs.unlinkSync(file); }
                finally { fs.rmdirSync(recovery); }
              }
            }
          }
        }
      } catch { /* Another owner can release between reads; retry acquisition. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('계정 연결이 다른 창에서 갱신 중이에요. 잠시 뒤 다시 시도해 주세요.');
  };
}
