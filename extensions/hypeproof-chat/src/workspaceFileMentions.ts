import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileAttachAllowed } from './fileAttachment.ts';
export interface MentionFile { path: string; bytes: number }
export interface MentionFiles { files: MentionFile[]; limited: boolean }
/** The served file-read grant enables attachment; the mention affordance is personal/adult only. */
export function fileMentionsAllowed(profile: { sdk_tools?: { read?: boolean }; activity_kind?: string; minor_cohort?: boolean } | null | undefined, instructor: boolean): boolean {
  return fileAttachAllowed(profile, instructor) && (profile?.activity_kind === 'personal' || profile?.minor_cohort === false);
}
/** VS Code's default files.exclude / search.exclude folders (dot names are skipped separately). They never use the visit budget. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'bower_components', 'CVS']);
/** Korean names stored decomposed (NFD, common on macOS) must match a composed (NFC) IME query; only the comparison is normalised. */
const comparable = (text: string): string => text.normalize('NFC').toLocaleLowerCase();
/** Names and sizes only. Selection still goes through readWorkspaceTextFile and its existing consent checks. */
export async function listMentionFiles(rootPath: string, query = '', limit = 100): Promise<MentionFiles> {
  const root = await fs.realpath(rootPath), files: MentionFile[] = [];
  const needle = comparable(query);let visited = 0, limited = false;
  const pending = [''];
  while (pending.length && !limited) {
    const relative = pending.shift()!, directory = path.join(root, relative);
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('workspace_changed');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const after = await fs.lstat(directory);
    if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || await fs.realpath(directory) !== directory) throw new Error('workspace_changed');
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && SKIPPED_FOLDERS.has(entry.name)) continue;
      if (++visited > 5000) { limited = true;break; }
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { pending.push(rel);continue; }
      if (!entry.isFile() || !comparable(rel).includes(needle)) continue;
      const full = path.join(root, rel), stat = await fs.lstat(full);
      if (stat.isSymbolicLink() || !stat.isFile() || await fs.realpath(full) !== full) throw new Error('workspace_changed');
      if (files.length >= limit) { limited = true;break; }
      files.push({ path: rel, bytes: stat.size });
    }
  }
  if (await fs.realpath(rootPath) !== root) throw new Error('workspace_changed');
  return { files, limited };
}
