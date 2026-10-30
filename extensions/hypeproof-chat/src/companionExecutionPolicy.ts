/** Local host restriction, not a grant issuer or a wire contract. No production caller. */
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { relativeEscapes } from './workspaceRouting.ts';

export const COMPANION_EXECUTION_TOOLS = Object.freeze(['Read', 'Write', 'Edit'] as const);
type PolicyErrorCode = 'authority' | 'scope' | 'tool' | 'input' | 'sdk_required';
export class CompanionExecutionPolicyError extends Error {
  readonly code: PolicyErrorCode;
  constructor(code: PolicyErrorCode) {
    super(code === 'sdk_required' ? '이 휴대폰 요청은 준비된 컴퓨터의 SDK에서만 실행할 수 있어요.' : '휴대폰 요청의 승인 범위가 바뀌었거나 허용되지 않은 작업이에요.');
    this.name = 'CompanionExecutionPolicyError';
    this.code = code;
  }
}

export interface CompanionExecutionPolicy {
  readonly workspaceRoot: string;
  readonly artifactPath: string;
  /** Recheck immediately before SDK dispatch and after asynchronous approval. */
  assertCurrent(cwd: string | undefined): void;
  /** Throws on refusal. Does not replace the profile or host approval gates. */
  toolInput(tool: string, input: unknown, cwd: string | undefined): Record<string, unknown>;
}

/**
 * The owner supplies an already verified lease and immutable request binding through
 * isCurrent. It must include revocation, epoch, task, request and profile/folder scope;
 * a pairing or relay ACK cannot satisfy it. No authority/limit defaults are invented here.
 * Synchronous filesystem checks narrow the tool boundary, not an OS sandbox: a write
 * already dispatched to the SDK cannot be cancelled retroactively by this helper.
 */
export function createCompanionExecutionPolicy({ workspaceRoot, artifactPath, expiresAt, isCurrent, now = Date.now }: {
  workspaceRoot: string; artifactPath: string; expiresAt: number;
  isCurrent: () => boolean; now?: () => number;
}): CompanionExecutionPolicy {
  const authority = () => {
    try {
      const time = now();
      if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(time) || time >= expiresAt || isCurrent() !== true) throw Error();
    } catch { throw new CompanionExecutionPolicyError('authority'); }
  };
  authority();
  if (!isAbsolute(workspaceRoot) || !isAbsolute(artifactPath) || !/\.html?$/i.test(artifactPath)) throw new CompanionExecutionPolicyError('scope');
  let root: string, file: string;
  try { root = realpathSync(workspaceRoot); file = realpathSync(artifactPath); }
  catch { throw new CompanionExecutionPolicyError('scope'); }
  // Normalize a known workspace alias (e.g. macOS /var) but never a selected-file
  // or descendant-directory alias. The selected lexical path must be the real path.
  const lexicalFile = resolve(root, relative(resolve(workspaceRoot), resolve(artifactPath)));
  if (relativeEscapes(relative(root, file)) || root === file || lexicalFile !== file) throw new CompanionExecutionPolicyError('scope');
  const assertCurrent = (cwd: string | undefined) => {
    authority();
    try {
      if (!cwd || realpathSync(cwd) !== root || realpathSync(workspaceRoot) !== root || realpathSync(artifactPath) !== file
        || realpathSync(file) !== file || !/\.html?$/i.test(file)) throw Error();
      // Refuse a final symlink and hardlinks, including an alias outside the workspace.
      // An SDK atomic replacement at the same canonical path is allowed: do not pin its inode.
      for (const spelling of [artifactPath, file]) {
        const stat = lstatSync(spelling);
        if (!stat.isFile() || stat.nlink !== 1) throw Error();
      }
    } catch { throw new CompanionExecutionPolicyError('scope'); }
    authority();
  };
  assertCurrent(workspaceRoot);
  return Object.freeze({ workspaceRoot: root, artifactPath: file, assertCurrent,
    toolInput(tool: string, input: unknown, cwd: string | undefined) {
      assertCurrent(cwd);
      if (!(COMPANION_EXECUTION_TOOLS as readonly string[]).includes(tool)) throw new CompanionExecutionPolicyError('tool');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CompanionExecutionPolicyError('input');
      const value = input as Record<string, unknown>;
      const keys = tool === 'Read' ? ['file_path', 'offset', 'limit', 'pages', 'allow_large'] : tool === 'Write' ? ['file_path', 'content'] : ['file_path', 'old_string', 'new_string', 'replace_all'];
      if (Object.keys(value).some(key => !keys.includes(key)) || typeof value.file_path !== 'string' || !value.file_path
        || (tool === 'Write' && typeof value.content !== 'string')
        || (tool === 'Edit' && (typeof value.old_string !== 'string' || typeof value.new_string !== 'string'))) throw new CompanionExecutionPolicyError('input');
      try {
        const spelling = resolve(root, value.file_path);
        const fromOriginalRoot = relative(resolve(workspaceRoot), spelling);
        // The host may spell cwd through its known workspace alias. Normalize only
        // that prefix, never a model-selected symlink inside the workspace.
        const candidate = relativeEscapes(fromOriginalRoot) ? spelling : resolve(root, fromOriginalRoot);
        if (candidate !== file || realpathSync(spelling) !== file || !lstatSync(spelling).isFile()) throw Error();
      } catch { throw new CompanionExecutionPolicyError('scope'); }
      return { ...value, file_path: file };
    },
  });
}
