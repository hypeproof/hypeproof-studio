import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountLock } from './accountLock';
import { canonicalRecord, recordHash, validateIntent } from './personalRecordFixture';
import type { RecordIntent, RecordScope } from './personalRecordTypes';

/** Separate from task/history storage. No tokens, credentials or automatic upload loop. */
export class PersonalRecordStore {
  constructor(private readonly root: string) {}
  private directory(scope: RecordScope): string { return path.join(this.root, recordHash(canonicalRecord(scope))); }
  private async read(directory: string, scope: RecordScope): Promise<RecordIntent | undefined> {
    const file = path.join(directory, 'pending.json');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw Error('outbox_corrupt');
      const raw = await fs.readFile(file, 'utf8');
      let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw Error('outbox_corrupt'); }
      return validateIntent(parsed, scope);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  async load(scope: RecordScope): Promise<RecordIntent | undefined> {
    const directory = this.directory(scope);
    return accountLock(directory)(() => this.read(directory, scope));
  }
  async create(value: RecordIntent): Promise<void> {
    const intent = validateIntent(value, value.scope), directory = this.directory(intent.scope);
    await accountLock(directory)(async () => {
      if (await this.read(directory, intent.scope)) throw Error('pending_exists');
      const temporary = path.join(directory, 'pending.tmp-' + randomUUID());
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(intent), 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, path.join(directory, 'pending.json'));
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  }
  async acknowledged(scope: RecordScope, mutation: string, digest: string): Promise<void> {
    const directory = this.directory(scope);
    await accountLock(directory)(async () => {
      const existing = await this.read(directory, scope);
      if (existing && (existing.mutation_id !== mutation || existing.manifest_sha256 !== digest)) throw Error('outbox_changed');
      if (existing) await fs.unlink(path.join(directory, 'pending.json'));
    });
  }
}
