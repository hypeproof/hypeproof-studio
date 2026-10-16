import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SendRecord } from './googleAutomation';

export function automationNamespace(service: string, verifiedActivityId: string): string {
  if (!/^[a-f0-9]{64}$/.test(verifiedActivityId)) throw new Error('활동 연결을 다시 확인해 주세요.');
  return createHash('sha256').update(JSON.stringify([new URL(service).origin, verifiedActivityId])).digest('hex');
}
const busy = () => new Error('다른 창에서 Google 연결 또는 메일 작업을 진행 중이에요. 완료된 뒤 다시 확인해 주세요.');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function validateRecords(value: unknown): Record<string, SendRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('메일 전송 기록을 읽지 못했어요. 다시 보내기 전에 기록을 확인해 주세요.');
  const result: Record<string, SendRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    const row = raw as SendRecord;
    if (!/^[a-f0-9]{64}$/.test(key) || !row || !/^[a-f0-9]{64}$/.test(row.id) || !['sending','sent','unknown','failed'].includes(row.status)) throw new Error('메일 전송 기록이 손상됐어요. 다시 보내기 전에 기록을 확인해 주세요.');
    // Only hashes and state are durable. Provider messages and recipient content never enter this file.
    result[key] = { id: row.id, status: row.status };
  }
  return result;
}
export function createAutomationLedger(storageRoot: string, namespace: string) {
  if (!/^[a-f0-9]{64}$/.test(namespace)) throw new Error('활동 연결을 다시 확인해 주세요.');
  const directory = join(storageRoot, 'email-automation', namespace);
  const file = join(directory, 'ledger.json'), lock = join(directory, 'send.lock'), barrier = join(directory, 'recover.lock');
  const prepare = () => fs.mkdir(directory, { recursive: true, mode: 0o700 });
  async function exists(path: string) { try { await fs.stat(path); return true; } catch (error) { if (missing(error)) return false; throw error; } }
  async function load(): Promise<Record<string, SendRecord>> {
    try { return validateRecords(JSON.parse(await fs.readFile(file, 'utf8'))); }
    catch (error) { if (missing(error)) return {}; throw new Error('메일 전송 기록을 읽지 못했어요. 다시 보내기 전에 기록을 확인해 주세요.'); }
  }
  async function save(records: Record<string, SendRecord>): Promise<void> {
    const clean = validateRecords(records); await prepare();
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(clean)); await handle.sync(); await handle.close(); handle = undefined;
      await fs.rename(temporary, file);
    } finally { await handle?.close(); await fs.unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
  }
  async function withLock<T>(work: () => Promise<T>): Promise<T> {
    await prepare(); const nonce = randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await exists(barrier)) throw busy();
      let own = false;
      try { await fs.writeFile(lock, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 }); own = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (own) {
        try { if (await exists(barrier)) throw busy(); return await work(); }
        finally { const owner = JSON.parse(await fs.readFile(lock, 'utf8')); if (owner.nonce === nonce) await fs.unlink(lock); }
      }
      let owner: { pid: number; nonce: string };
      try { owner = JSON.parse(await fs.readFile(lock, 'utf8')); } catch { throw busy(); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.nonce !== 'string') throw busy();
      let dead = false;
      try { process.kill(owner.pid, 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw busy();
      // Serialize recovery, and recheck identity so a new process's lock is never removed.
      try { await fs.mkdir(barrier, { mode: 0o700 }); } catch { throw busy(); }
      try { if (await exists(lock)) { const latest = JSON.parse(await fs.readFile(lock, 'utf8')); if (latest.nonce === owner.nonce && latest.pid === owner.pid) await fs.unlink(lock); } }
      finally { await fs.rmdir(barrier); }
    }
    throw busy();
  }
  return { load, save, withLock };
}
