import * as fs from 'node:fs';

/**
 * REQ-STUDIO-TRUST-OWN-FOLDERS - the record of folders Studio itself created. The core patch
 * (`hps-studio-folder-trust.patch`, `hpsStudioFolderRecordOf`) reads this key straight from the
 * extension's globalState and opens a listed folder without the Workspace Trust modal, but only while
 * `enabled` is true (setting `hypeproofChat.trustStudioFolders`, default off). A folder is listed only
 * when Studio made the directory (or it was already listed); a folder that existed before, or one the
 * learner opened, is never added. The key is the real path, so a same-named folder elsewhere does not match.
 */
export const STUDIO_FOLDERS_KEY = 'hypeproofChat.studioCreatedFolders';
const MAX_FOLDERS = 200;

export interface StudioFolderRecord { v: 1; enabled: boolean; folders: string[]; }

/** The saved record when well formed; anything else is an empty, disabled record. */
export function studioFolderRecordOf(saved: unknown): StudioFolderRecord {
  const r = (saved && typeof saved === 'object' ? saved : {}) as Partial<StudioFolderRecord>;
  const folders = Array.isArray(r.folders) ? r.folders.filter((p): p is string => typeof p === 'string' && p.length > 0) : [];
  return { v: 1, enabled: r.enabled === true, folders };
}

/** Add `realPath` (only when `created`, or already listed) and apply the flag. Returns a new record. */
export function withStudioFolder(saved: unknown, flag: boolean, realPath: string | undefined, created: boolean): StudioFolderRecord {
  const record = studioFolderRecordOf(saved);
  let folders = record.folders;
  if (realPath && created && !folders.includes(realPath)) folders = [...folders, realPath].slice(-MAX_FOLDERS);
  return { v: 1, enabled: flag, folders };
}

/** True when the directory is absent, so creating it makes Studio its creator. Call before any mkdir. */
export function directoryIsAbsent(dir: string): boolean {
  try { fs.lstatSync(dir); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

/** Real path of `dir`, or undefined when it cannot be resolved (then nothing is recorded). */
export function studioRealPath(dir: string): string | undefined {
  try { return fs.realpathSync(dir); } catch { return undefined; }
}

export interface StudioFolderStore { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> | void; }

/** Write the record. `created` is `dir` was absent before Studio prepared it. Never throws (a failure only means the normal prompt). */
export async function syncStudioFolderRecord(store: StudioFolderStore, flag: boolean, dir?: string, created = false): Promise<void> {
  try {
    const real = dir && created ? studioRealPath(dir) : undefined;
    const next = withStudioFolder(store.get(STUDIO_FOLDERS_KEY), flag, real, created);
    await store.update(STUDIO_FOLDERS_KEY, next);
  } catch { /* the folder simply keeps the normal trust prompt */ }
}
