import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateEmailRecipe, type EmailRecipe } from './googleAutomation.ts';

export interface SharedRunnerConfig {
  readonly scriptId: string;
  readonly deploymentId: string;
  readonly versionNumber: number;
  readonly protocol: 'hps-email-v1';
  readonly releaseId: string;
}
const invalid = (): never => { throw new Error('Studio 공통 Google 실행기 설정을 운영자가 확인해야 해요.'); };
/** Only operator-provisioned extension resources may supply this value, never a workspace or model. */
export function validateSharedRunnerConfig(value: unknown): Readonly<SharedRunnerConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  const keys = ['scriptId', 'deploymentId', 'versionNumber', 'protocol', 'releaseId'];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) ||
      typeof v.scriptId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(v.scriptId) ||
      typeof v.deploymentId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(v.deploymentId) ||
      !Number.isSafeInteger(v.versionNumber) || Number(v.versionNumber) < 1 ||
      v.protocol !== 'hps-email-v1' || typeof v.releaseId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(v.releaseId)) return invalid();
  return Object.freeze({ scriptId: v.scriptId, deploymentId: v.deploymentId, versionNumber: Number(v.versionNumber), protocol: v.protocol, releaseId: v.releaseId });
}
export function loadSharedRunnerConfig(extensionPath: string): Readonly<SharedRunnerConfig> | null {
  let descriptor: number | undefined;
  const optionalStat = (path: string) => {
    try { return lstatSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  try {
    const root = realpathSync(extensionPath), directory = join(root, 'resources');
    const dir = optionalStat(directory);
    if (!dir) return null;
    if (!dir.isDirectory() || dir.isSymbolicLink() || (process.platform !== 'win32' && (dir.mode & 0o022))) return invalid();
    const file = join(directory, 'google-shared-runner.json'), before = optionalStat(file);
    if (!before) return null;
    if (!before.isFile() || before.isSymbolicLink() || before.size > 4096) return invalid();
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const current = fstatSync(descriptor);
    if (!current.isFile() || current.size > 4096 || before.ino !== current.ino || before.dev !== current.dev ||
        (process.platform !== 'win32' && ((current.mode & 0o022) || ![0, process.getuid?.()].includes(current.uid)))) return invalid();
    // Bound the read itself, including a concurrently growing resource.
    const bytes = Buffer.alloc(4097); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > 4096) return invalid();
    return validateSharedRunnerConfig(JSON.parse(bytes.subarray(0, length).toString('utf8')));
  } catch { return invalid(); }
  finally { if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve the sanitized configuration error. */ } } }
}
/** Explicit key order is shared with the runner; JSON object serialization order is otherwise not a contract. */
export function canonicalSharedRecipe(value: unknown): EmailRecipe {
  const r = validateEmailRecipe(value);
  return { schema: r.schema, title: r.title, description: r.description, category: r.category,
    subjectTemplate: r.subjectTemplate, bodyTemplate: r.bodyTemplate,
    columns: { email: r.columns.email, name: r.columns.name, document: r.columns.document, dueDate: r.columns.dueDate } };
}
export function sharedRecipeDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalSharedRecipe(value))).digest('hex');
}
