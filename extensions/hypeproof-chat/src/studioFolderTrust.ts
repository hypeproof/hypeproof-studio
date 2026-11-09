import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * REQ-STUDIO-TRUST-OWN-FOLDERS - the record of folders Studio itself created. The core patch
 * (`hps-studio-folder-trust.patch`, `hpsStudioFolderRecordOf`) reads this key straight from the
 * extension's globalState. The record alone grants nothing: the core also reads the user-local setting
 * `hypeproofChat.trustStudioFolders` (default off) itself, checks the extension is enabled, honours the
 * learner's "Don't Trust", and requires the folder's creation time to match `birth` below.
 * A folder is listed only when this code made the leaf directory (non-recursive mkdir succeeded);
 * a folder that existed before, or one the learner opened, is never added. The key is the real path.
 */
export const STUDIO_FOLDERS_KEY = 'hypeproofChat.studioCreatedFolders';
const MAX_FOLDERS = 200;

export interface StudioFolder { path: string; birth: number; }
export interface StudioFolderRecord { v: 2; folders: StudioFolder[]; }

/** The saved record when well formed; anything else is an empty record. */
export function studioFolderRecordOf(saved: unknown): StudioFolderRecord {
  const r = (saved && typeof saved === 'object' ? saved : {}) as { v?: unknown; folders?: unknown };
  const folders = r.v === 2 && Array.isArray(r.folders)
    ? (r.folders as Partial<StudioFolder>[]).filter((f): f is StudioFolder => !!f && typeof f.path === 'string' && f.path.length > 0 && typeof f.birth === 'number' && f.birth > 0)
        .map(f => ({ path: f.path, birth: f.birth }))
    : [];
  return { v: 2, folders };
}

/** Add `created` (replacing an older entry for the same path). Returns a new record. */
export function withStudioFolder(saved: unknown, created: StudioFolder | undefined): StudioFolderRecord {
  const record = studioFolderRecordOf(saved);
  if (!created) return record;
  return { v: 2, folders: [...record.folders.filter(f => f.path !== created.path), created].slice(-MAX_FOLDERS) };
}

/**
 * Create the leaf folder `dir` itself, non-recursively, so success means Studio made it (no check-then-create
 * race). Parents are created as usual. Returns the real path and creation time only on that success; an
 * existing folder, a symlink or any failure returns undefined and the folder is never recorded.
 */
export function createStudioFolder(dir: string): StudioFolder | undefined {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { fs.mkdirSync(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    throw error;
  }
  try {
    const real = fs.realpathSync(dir);
    const stat = fs.lstatSync(real);
    if (!stat.isDirectory()) return undefined;
    return { path: real, birth: stat.birthtime.getTime() };
  } catch { return undefined; }
}

/** Make the folder (see `createStudioFolder`) then run `prepare`. Returns the creation entry, or undefined when the folder was not made by this call. */
export function prepareStudioFolder(dir: string, prepare: () => void): StudioFolder | undefined {
  const created = createStudioFolder(dir);
  prepare();
  return created;
}

export interface StudioFolderStore { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> | void; }

/** Record `created` (only what `prepareStudioFolder` returned). Never throws (a failure only means the normal prompt). */
export async function syncStudioFolderRecord(store: StudioFolderStore, created?: StudioFolder): Promise<void> {
  if (!created) return;
  try { await store.update(STUDIO_FOLDERS_KEY, withStudioFolder(store.get(STUDIO_FOLDERS_KEY), created)); }
  catch { /* the folder simply keeps the normal trust prompt */ }
}
