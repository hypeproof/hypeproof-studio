import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccuracyStore } from './accuracyEducation';

/** Immutable local records; atomic link keeps the first offer across extension-host windows. */
export class AccuracyEducationStore implements AccuracyStore {
  constructor(private readonly directory: string) {}
  private file(key: string): string { return path.join(this.directory, createHash('sha256').update(key).digest('hex') + '.json'); }
  get<T>(key: string): T | undefined {
    try { return JSON.parse(fs.readFileSync(this.file(key), 'utf8')) as T; }
    catch { return undefined; } // absent, unreadable or corrupt: treat as no record
  }
  async update(key: string, value: unknown): Promise<void> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      try { fs.linkSync(temporary, this.file(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}
