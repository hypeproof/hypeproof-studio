import { validCompanionDesktopHandoff, validCompanionDesktopHandoffRecord, validCompanionExecutionReservation, type CompanionExecutionReservation, type CompanionDesktopHandoffCheckpoint, type CompanionDesktopHandoffRecord, type CompanionAuthoringRun, type CompanionAuthoringSendSource } from './companionDesktopHandoff.ts';
import { ATTEMPT_KEYS, validAttemptMeta } from './answerAttempts.ts';
import { shellLabel } from "./shellDisplay.ts";
import { storedDenialNotice } from "./denialNotice.ts";
import { isDownloadNoticeLabel } from "./browserDownloadNotice.ts";
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hostname } from 'node:os';
import { emptyActivityDraft, validActivityDraft } from './activityDraft.ts';
import { suggestTaskTitle } from './taskTitle.ts';
import type { RenameUndo } from './removalUndo.ts';
import { emptyVersions, joinVersions, splitVersions, validEditOf, type StoredVersions } from './editResend.ts';
import { appendVerdict, latestVerdicts, validVerdictEvent, type VerdictEvent, type VerdictMap } from './answerVerdict.ts';
import { validTaskAppearance, type TaskAppearance } from './taskAppearance.ts';
import { validTaskActivity } from './taskActivity.ts';
import type { ActivityDraft } from './activityDraft';
import { searchTasks, type TaskSearchResult } from './taskSearch.ts';
import type { ChatMessage } from './protocol';
import type {
  ArchivedTaskSummary, TaskDocument, TaskSummary, TaskSurfaceSelection, TaskWorkspaceErrorCode, TaskWorkspaceExpected, TaskWorkspaceView,
} from './taskWorkspaceContract';

/** Bounded local retained provenance. Full history refuses rotation; no automatic deletion. */
export const COMPANION_RETAINED_RUN_LIMIT = 16;
const terminalCompanionRun = (record: CompanionDesktopHandoffRecord) =>
  (record.authoringImport?.state === 'imported' && record.authoringImport.presented === true || record.authoringExecution?.state === 'bound')
  && (record.authoringRun?.state === 'completed' || record.authoringRun?.state === 'failed');

type TitleOrigin = NonNullable<TaskDocument['titleOrigin']>;

interface WorkspaceData {
  version: 1;
  scope: string;
  revision: number;
  activeTaskId: string;
  tasks: TaskDocument[];
}

/** CGP-CHAT-R-002 — the versions sidecar, `<scope>.versions.json`. Earlier builds never read it. */
interface VersionsData { version: 1; scope: string; tasks: Record<string, StoredVersions> }

/**
 * CGP-CHAT-R-005 — the answer-verdict sidecar, `<scope>.verdicts.json`: per task, the learner's
 * verdict events in order (latest per message wins). Earlier builds never read it, and the task
 * file is not touched by a verdict, so a downgrade only loses the drawn verdicts.
 */
interface VerdictsData { version: 1; scope: string; tasks: Record<string, VerdictEvent[]> }

/**
 * CGP-CHAT-R-025 — the archive sidecar, `<scope>.archive.json`: task id → the time it was archived.
 * Archiving never touches the task's transcript, draft, versions or verdicts; it only hides the task
 * from the list. Earlier builds never read this file, so a downgrade lists archived tasks again and
 * loses nothing.
 */
interface ArchiveData { version: 1; scope: string; tasks: Record<string, number> }

/**
 * CGP-KNOW-R-008 — the task appearance sidecar, `<scope>.appearance.json`: per task, the emoji and
 * colour ids the learner picked. Earlier builds never read it and the task file is not touched, so
 * a downgrade only loses the drawn marks; the strict task-file schema stays readable by them.
 */
interface AppearanceData { version: 1; scope: string; tasks: Record<string, TaskAppearance> }
/** CGP-KNOW-R-009 — one task as it moves between two personal activities' scopes. */
export interface MovedTask { task: TaskDocument; versions: StoredVersions | null; verdicts: VerdictEvent[] }

interface LockOwner { version: 1; host: string; pid: number; nonce: string; createdAt: number }
interface LockRecord { owner: LockOwner; dev: number; ino: number }
interface LockLease extends LockRecord { path: string }

export class TaskWorkspaceStoreError extends Error {
  readonly code: TaskWorkspaceErrorCode;
  constructor(code: TaskWorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'TaskWorkspaceStoreError';
    this.code = code;
  }
}

const fail = (code: TaskWorkspaceErrorCode, message: string): never => {
  throw new TaskWorkspaceStoreError(code, message);
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const codeOf = (error: unknown) => isRecord(error) ? error.code : undefined;
const hostIdentity = hash(hostname());
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function validOwner(value: unknown): value is LockOwner {
  return isRecord(value) && exactKeys(value, ['version', 'host', 'pid', 'nonce', 'createdAt']) && value.version === 1 &&
    typeof value.host === 'string' && /^[a-f0-9]{64}$/.test(value.host) &&
    typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 0x7fffffff &&
    typeof value.nonce === 'string' && uuid.test(value.nonce) && timestamp(value.createdAt);
}

function demonstrablyDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return codeOf(error) === 'ESRCH'; }
}

const sameLock = (a: LockRecord | undefined, b: LockRecord) => !!a &&
  a.dev === b.dev && a.ino === b.ino && a.owner.nonce === b.owner.nonce;

/**
 * The task file's message shape is exactly the one earlier builds accept (CGP-CHAT-R-002 keeps it:
 * an older build reading a file this build wrote must not call it corrupt). `editOf` is allowed only
 * on lines handed to the store and on the versions sidecar, never in the task file.
 */
function validMessage(value: unknown, allowEditOf = false): value is ChatMessage {
  if (!isRecord(value) || !exactKeys(value, ['id', 'role', 'content', 'createdAt', 'tool', 'citations', 'images', 'assistantName', 'toolMode', 'activity', ...(allowEditOf ? ['editOf', ...ATTEMPT_KEYS] : [])])) return false;
  if (!nonempty(value.id, 256) || typeof value.role !== 'string' || !['user', 'assistant', 'system', 'tool'].includes(value.role) ||
      typeof value.content !== 'string' || !timestamp(value.createdAt)) return false;
  if (value.assistantName !== undefined && typeof value.assistantName !== 'string') return false;
  // CGP-ART-R-020 — "AI가 한 일" entries: bounded, exact shape, no control or bidi characters.
  if (value.activity !== undefined && !validTaskActivity(value.activity)) return false;
  if (value.toolMode !== undefined && (value.role !== 'user' || !['auto', 'web-search'].includes(value.toolMode as string))) return false;
  // CGP-CHAT-R-002 — an edited resend names its group root; only a user line can be one.
  if (value.editOf !== undefined && (value.role !== 'user' || !validEditOf(value.editOf))) return false;
  if (ATTEMPT_KEYS.some(key => value[key] !== undefined) && (value.role !== 'user' || !validAttemptMeta(Object.fromEntries(ATTEMPT_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]))))) return false;
  if (value.images !== undefined && (!Array.isArray(value.images) || !value.images.every(image => typeof image === 'string' && image.startsWith('data:image/')))) return false;
  if (value.tool !== undefined && (!isRecord(value.tool) || !exactKeys(value.tool, ['icon', 'label', 'state', ...(allowEditOf ? ['shell', 'step', 'since'] : [])]) ||
      typeof value.tool.icon !== 'string' || typeof value.tool.label !== 'string' || typeof value.tool.state !== 'string' || !['running', 'done', 'error'].includes(value.tool.state))) return false;
  if (isRecord(value.tool) && value.tool.shell !== undefined) {
    const shell = value.tool.shell;
    if (!isRecord(shell) || !exactKeys(shell, ['purpose', 'command', 'folder', 'collapsed']) ||
      typeof shell.purpose !== 'string' || shell.purpose.length > 500 || typeof shell.command !== 'string' || shell.command.length > 2000 ||
      (shell.folder !== undefined && (typeof shell.folder !== 'string' || shell.folder.length > 2000)) || typeof shell.collapsed !== 'boolean') return false;
  }
  if (isRecord(value.tool) && ((value.tool.step !== undefined && typeof value.tool.step !== 'string') ||
    (value.tool.since !== undefined && !timestamp(value.tool.since)))) return false;
  if (value.citations !== undefined && (!Array.isArray(value.citations) || !value.citations.every(citation =>
    isRecord(citation) && exactKeys(citation, ['url', 'title', 'domain', 'tier', 'kind']) &&
    (citation.kind === undefined || typeof citation.kind === 'string' && citation.kind.length <= 64) &&
    typeof citation.url === 'string' && typeof citation.title === 'string' && typeof citation.domain === 'string' &&
    typeof citation.tier === 'number' && [1, 2, 3, 4].includes(citation.tier)))) return false;
  return true;
}

const validIncoming = (value: unknown): value is ChatMessage => validMessage(value, true);

function validVersions(value: unknown): value is StoredVersions {
  return isRecord(value) && exactKeys(value, ['hidden', 'groups', 'attempts', 'transcript']) && (value.transcript === undefined || (Array.isArray(value.transcript) && value.transcript.every(validIncoming))) && (value.attempts === undefined || (isRecord(value.attempts) && Object.entries(value.attempts).every(([key, meta]) => validEditOf(key) && validAttemptMeta(meta)))) && Array.isArray(value.hidden) && value.hidden.every(validIncoming) &&
    isRecord(value.groups) && Object.entries(value.groups).every(([id, root]) => validEditOf(id) && validEditOf(root));
}

function decodeVersions(text: string, scope: string): VersionsData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '버전 기록을 읽을 수 없습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) return fail('corrupt', '버전 기록의 무결성을 확인할 수 없습니다.');
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'tasks']) || data.version !== 1 || data.scope !== scope || !isRecord(data.tasks) ||
      !Object.values(data.tasks).every(validVersions)) return fail('corrupt', '버전 기록의 형식이 일치하지 않습니다.');
  return data as unknown as VersionsData;
}

function decodeVerdicts(text: string, scope: string): VerdictsData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '답변 선택 기록을 읽을 수 없습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) return fail('corrupt', '답변 선택 기록의 무결성을 확인할 수 없습니다.');
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'tasks']) || data.version !== 1 || data.scope !== scope || !isRecord(data.tasks) ||
      !Object.entries(data.tasks).every(([id, events]) => nonempty(id, 256) && Array.isArray(events) && events.every(validVerdictEvent))) return fail('corrupt', '답변 선택 기록의 형식이 일치하지 않습니다.');
  return data as unknown as VerdictsData;
}

function decodeArchive(text: string, scope: string): ArchiveData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '보관함 기록을 읽을 수 없습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) return fail('corrupt', '보관함 기록의 무결성을 확인할 수 없습니다.');
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'tasks']) || data.version !== 1 || data.scope !== scope || !isRecord(data.tasks) ||
      !Object.entries(data.tasks).every(([id, at]) => nonempty(id, 256) && timestamp(at))) return fail('corrupt', '보관함 기록의 형식이 일치하지 않습니다.');
  return data as unknown as ArchiveData;
}

const archivedIn = (archive: ArchiveData, taskId: string) => Object.prototype.hasOwnProperty.call(archive.tasks, taskId);

function decodeAppearance(text: string, scope: string): AppearanceData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '작업 아이콘 기록을 읽을 수 없습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) return fail('corrupt', '작업 아이콘 기록의 무결성을 확인할 수 없습니다.');
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'tasks']) || data.version !== 1 || data.scope !== scope || !isRecord(data.tasks) ||
      !Object.entries(data.tasks).every(([id, appearance]) => nonempty(id, 256) && validTaskAppearance(appearance))) return fail('corrupt', '작업 아이콘 기록의 형식이 일치하지 않습니다.');
  return data as unknown as AppearanceData;
}

function validDraft(value: unknown): value is ActivityDraft {
  return isRecord(value) && exactKeys(value, ['text', 'images', 'queued', 'imports', 'toolMode', 'queuedToolMode', 'queuedPaused', 'recovered', 'inlineEdit']) && validActivityDraft(value);
}

function validSurface(value: unknown): value is TaskSurfaceSelection | null {
  if (value === null) return true;
  if (!isRecord(value) || !exactKeys(value, ['url', 'pinned']) || typeof value.url !== 'string' || typeof value.pinned !== 'boolean') return false;
  try {
    const url = new URL(value.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validTask(value: unknown): value is TaskDocument {
  if (!isRecord(value) || !exactKeys(value, ['id', 'title', 'titleOrigin', 'createdAt', 'updatedAt', 'messageCount', 'messages', 'draft', 'sourceSelection', 'importedLegacy'])) return false;
  return nonempty(value.id, 256) && nonempty(value.title, 160) && timestamp(value.createdAt) && timestamp(value.updatedAt) &&
    (value.titleOrigin === undefined || ['default', 'automatic', 'manual'].includes(value.titleOrigin as string)) &&
    value.updatedAt >= value.createdAt && Array.isArray(value.messages) && value.messages.every(message => validMessage(message)) &&
    new Set(value.messages.map(message => message.id)).size === value.messages.length && value.messageCount === value.messages.length &&
    validDraft(value.draft) && validSurface(value.sourceSelection) && typeof value.importedLegacy === 'boolean';
}

function decode(text: string, scope: string): WorkspaceData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '작업 기록 파일을 읽을 수 없습니다. 원본을 보존했습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) {
    return fail('corrupt', '작업 기록의 무결성을 확인할 수 없습니다. 원본을 보존했습니다.');
  }
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'revision', 'activeTaskId', 'tasks']) || data.version !== 1 || data.scope !== scope ||
      !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || !Array.isArray(data.tasks) || !data.tasks.length ||
      !data.tasks.every(validTask) || new Set(data.tasks.map(task => task.id)).size !== data.tasks.length ||
      !data.tasks.some(task => task.id === data.activeTaskId)) {
    return fail('corrupt', '작업 기록의 형식이나 계정 범위가 일치하지 않습니다. 원본을 보존했습니다.');
  }
  return data as unknown as WorkspaceData;
}

function normalizedTitle(value: string): string {
  if (typeof value !== 'string') return fail('invalid', '작업 이름이 올바르지 않습니다.');
  const title = value.trim();
  if (!title || title.length > 160) return fail('invalid', '작업 이름은 1자에서 160자까지 입력할 수 있습니다.');
  return title;
}

/**
 * Full local task history, independent from the model's bounded context and telemetry retention.
 * One atomic snapshot is the commit boundary. Writers serialize in-process and use an exclusive
 * on-disk lock plus revision comparison across processes. Recovery requires a demonstrably
 * dead same-host owner and an atomically claimed owner lease; age is never authority.
 */
export class TaskWorkspaceStore {
  readonly scope: string;
  readonly filePath: string;
  readonly versionsPath: string;
  readonly verdictsPath: string;
  readonly archivePath: string;
  readonly appearancePath: string;
  private readonly directory: string;
  /** Optional handoff data uses the existing sidecar pattern, preserving older task-file readers. */
  private readonly companionHandoffPath: string;
  private readonly rootPath: string;
  /** The scope as given (before hashing), so a fresh read of the same store can be made. */
  private readonly scopeInput: string;
  private data?: WorkspaceData;
  /** Versions sidecar as last read or written. A missing or unreadable sidecar reads as no versions. */
  private versions: VersionsData;
  /** Answer-verdict sidecar as last read or written. A missing or unreadable one reads as no verdicts. */
  private verdicts: VerdictsData;
  /** Archive sidecar as last read or written. A missing or unreadable one reads as nothing archived. */
  private archive: ArchiveData;
  /** Appearance sidecar as last read or written. A missing or unreadable one reads as no marks. */
  private appearance: AppearanceData;
  private loadError?: TaskWorkspaceStoreError;
  private queue: Promise<void> = Promise.resolve();

  constructor(rootPath: string, scope: string) {
    if (!nonempty(rootPath, 4096) || !nonempty(scope, 16384)) fail('invalid', '작업 저장 범위가 필요합니다.');
    this.scope = hash(scope);
    this.scopeInput = scope;
    this.rootPath = rootPath;
    this.directory = join(rootPath, 'task-workspaces');
    this.filePath = join(this.directory, `${this.scope}.json`);
    this.companionHandoffPath = join(this.directory, `${this.scope}.companion-handoff.json`);
    this.versionsPath = join(this.directory, `${this.scope}.versions.json`);
    this.versions = { version: 1, scope: this.scope, tasks: {} };
    this.verdictsPath = join(this.directory, `${this.scope}.verdicts.json`);
    this.verdicts = { version: 1, scope: this.scope, tasks: {} };
    this.archivePath = join(this.directory, `${this.scope}.archive.json`);
    this.archive = { version: 1, scope: this.scope, tasks: {} };
    this.appearancePath = join(this.directory, `${this.scope}.appearance.json`);
    this.appearance = { version: 1, scope: this.scope, tasks: {} };
    this.load();
  }

  private load(): void {
    try {
      const root = lstatSync(this.rootPath);
      if (!root.isDirectory() || root.isSymbolicLink()) fail('corrupt', '작업 저장 폴더의 위치를 확인해야 합니다.');
      const directory = lstatSync(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) fail('corrupt', '작업 저장 폴더의 위치를 확인해야 합니다.');
      const stat = lstatSync(this.filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
      this.data = decode(readFileSync(this.filePath, 'utf8'), this.scope);
      this.versions = this.readVersionsSync();
      this.verdicts = this.readVerdictsSync();
      this.archive = this.readArchiveSync();
      this.appearance = this.readAppearanceSync();
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return;
      this.loadError = error instanceof TaskWorkspaceStoreError ? error :
        new TaskWorkspaceStoreError('io', '작업 기록을 읽지 못했습니다. 원본을 보존했습니다.');
    }
  }

  /** A lost sidecar costs only the earlier versions; the conversation itself never depends on it. */
  private readVersionsSync(): VersionsData {
    try {
      const stat = lstatSync(this.versionsPath);
      if (stat.isFile() && !stat.isSymbolicLink()) return decodeVersions(readFileSync(this.versionsPath, 'utf8'), this.scope);
    } catch { /* missing or unreadable: no versions */ }
    return { version: 1, scope: this.scope, tasks: {} };
  }

  /** A lost verdict sidecar costs only the drawn verdicts; the spool still has every event. */
  private readVerdictsSync(): VerdictsData {
    try {
      const stat = lstatSync(this.verdictsPath);
      if (stat.isFile() && !stat.isSymbolicLink()) return decodeVerdicts(readFileSync(this.verdictsPath, 'utf8'), this.scope);
    } catch { /* missing or unreadable: no verdicts */ }
    return { version: 1, scope: this.scope, tasks: {} };
  }

  /** A lost archive sidecar only shows the archived tasks in the list again; their content is in the task file. */
  private readArchiveSync(): ArchiveData {
    try {
      const stat = lstatSync(this.archivePath);
      if (stat.isFile() && !stat.isSymbolicLink()) return decodeArchive(readFileSync(this.archivePath, 'utf8'), this.scope);
    } catch { /* missing or unreadable: nothing archived */ }
    return { version: 1, scope: this.scope, tasks: {} };
  }

  /** A lost appearance sidecar costs only the emoji and colour marks; titles and turns are in the task file. */
  private readAppearanceSync(): AppearanceData {
    try {
      const stat = lstatSync(this.appearancePath);
      if (stat.isFile() && !stat.isSymbolicLink()) return decodeAppearance(readFileSync(this.appearancePath, 'utf8'), this.scope);
    } catch { /* missing or unreadable: no marks */ }
    return { version: 1, scope: this.scope, tasks: {} };
  }

  getView(): TaskWorkspaceView {
    const activeTaskId = this.data?.activeTaskId ?? null;
    const summaries: TaskSummary[] = (this.data?.tasks ?? []).map(({ id, title, createdAt, updatedAt, messageCount }) => {
      // CGP-KNOW-R-008 — the learner's emoji and colour, if any, from the appearance sidecar.
      const appearance = this.loadError ? undefined : this.appearance.tasks[id];
      return { id, title, createdAt, updatedAt, messageCount, ...(appearance ? { appearance: clone(appearance) } : {}) };
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    // CGP-CHAT-R-025 — the open task always stays in the list (an interrupted archive leaves it
    // open and visible); every other archived task is listed only in 보관함, newest archive first.
    const hidden = (task: TaskSummary) => task.id !== activeTaskId && archivedIn(this.archive, task.id);
    const archived: ArchivedTaskSummary[] = summaries.filter(hidden).map(task => ({ ...task, archivedAt: this.archive.tasks[task.id] }))
      .sort((a, b) => b.archivedAt - a.archivedAt || a.id.localeCompare(b.id));
    return {
      scope: this.scope,
      revision: this.data?.revision ?? 0,
      activeTaskId,
      tasks: summaries.filter(task => !hidden(task)),
      archived,
      sourceSelection: clone(this.data?.tasks.find(task => task.id === this.data?.activeTaskId)?.sourceSelection ?? null),
      ...(this.loadError ? { error: { code: this.loadError.code, message: this.loadError.message } } : {}),
    };
  }

  /**
   * CGP-CHAT-R-026 — local search over this scope's tasks (visible conversation only); never touches disk or
   * network. null when the task file could not be read: "no match" would be a false answer.
   */
  search(query: string): TaskSearchResult[] | null {
    if (this.loadError || !this.data) return null;
    return searchTasks(this.data.tasks, query);
  }

  /**
   * CGP-KNOW-D-016 — where a coach turn's row is now: the task's title, the first visible row of that
   * turn (its assistant message, or a later segment `<id>#N` when the first was empty) and whether the
   * task is archived. Null when the task or the row is gone (cleared, edited away, moved, unreadable).
   */
  findTurnRow(taskId: string, messageId: string): { taskTitle: string; messageId: string; archived: boolean } | null {
    if (this.loadError || !this.data) return null;
    const task = this.data.tasks.find(value => value.id === taskId);
    const row = task?.messages.find(message => message.id === messageId || message.id.startsWith(`${messageId}#`));
    if (!task || !row) return null;
    return { taskTitle: task.title, messageId: row.id, archived: task.id !== this.data.activeTaskId && archivedIn(this.archive, task.id) };
  }
  getActiveTask(): TaskDocument | undefined { return this.getTask(this.data?.activeTaskId); }
  getTask(taskId: string | undefined): TaskDocument | undefined {
    if (this.loadError) throw this.loadError;
    const task = this.data?.tasks.find(value => value.id === taskId);
    return task ? clone(task) : undefined;
  }
  /** The full conversation, earlier versions included (joinVersions); the task file holds only the visible one. */
  getHistory(taskId = this.data?.activeTaskId): ChatMessage[] {
    const task = this.getTask(taskId);
    return task ? joinVersions(task.messages, taskId ? this.versions.tasks[taskId] : undefined) : [];
  }
  /** CGP-CHAT-R-005 — the learner's latest verdict per answer in this task. */
  getVerdicts(taskId = this.data?.activeTaskId): VerdictMap {
    if (this.loadError || !taskId) return {};
    return latestVerdicts(this.verdicts.tasks[taskId] ?? []);
  }
  /** Every verdict event of the task, oldest first (history is kept; latest wins for display). */
  getVerdictHistory(taskId = this.data?.activeTaskId): VerdictEvent[] {
    if (this.loadError || !taskId) return [];
    return clone(this.verdicts.tasks[taskId] ?? []);
  }
  getDraft(taskId = this.data?.activeTaskId): ActivityDraft { return this.getTask(taskId)?.draft ?? emptyActivityDraft(); }

  initialize(legacyMessages: ChatMessage[] = [], legacyDraft: ActivityDraft = emptyActivityDraft()): Promise<TaskWorkspaceView> {
    return this.mutate((data, versions) => {
      if (data) return data;
      if (!Array.isArray(legacyMessages) || !legacyMessages.every(validIncoming) || !validDraft(legacyDraft)) fail('invalid', '이전 작업 기록의 형식을 확인해야 합니다.');
      const now = Date.now();
      const task = this.newTask('새 작업', now);
      const split = splitVersions(this.mergeMessages([], legacyMessages));
      task.messages = split.visible;
      if (split.versions.transcript?.length || split.versions.hidden.length || Object.keys(split.versions.groups).length || Object.keys(split.versions.attempts ?? {}).length) versions.tasks[task.id] = split.versions;
      task.messageCount = task.messages.length;
      task.draft = clone(legacyDraft);
      task.importedLegacy = task.messages.length > 0 || !!task.draft.text || !!task.draft.queued || task.draft.images.length > 0 || !!task.draft.imports?.length || !!task.draft.recovered?.length;
      if (task.importedLegacy) { task.title = '이전 대화'; task.titleOrigin = 'manual'; }
      return { version: 1, scope: this.scope, revision: 0, activeTaskId: task.id, tasks: [task] };
    }).catch(error => {
      // Failed first import must not look like an empty, ready workspace.
      if (!this.data) this.loadError = error instanceof TaskWorkspaceStoreError ? error :
        new TaskWorkspaceStoreError('io', '작업 기록을 준비하지 못했습니다. 원본을 보존했습니다. 앱을 다시 열어 주세요.');
      throw error;
    });
  }

  /** Local handoff and explicitly reviewed draft import share this store's queue, lock and exact revision. */
  private companionHandoffOperation(expected: TaskWorkspaceExpected,
    change: (held: CompanionDesktopHandoffRecord | null, history: readonly CompanionDesktopHandoffRecord[]) => CompanionDesktopHandoffRecord | null,
    draftImport?: { draft: ActivityDraft; isCurrent(): boolean },
    isCurrent?: () => boolean, currentTaskRevision = false, rotatePrior?: {id:string;digest:string}): Promise<CompanionDesktopHandoffRecord | null> {
    const expectedAt = { ...expected };
    const commitCurrent = draftImport?.isCurrent ?? isCurrent;
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      await this.prepareDirectory();
      const lock = await this.acquireLock();
      try {
        const info = await lstat(this.filePath);
        if (!info.isFile() || info.isSymbolicLink()) fail('corrupt', '작업 기록의 위치를 확인해야 합니다.');
        const disk = decode(await readFile(this.filePath, 'utf8'), this.scope);
        if (JSON.stringify(disk) !== JSON.stringify(this.data)) fail('stale', '다른 창에서 작업이 바뀌었어요. 최신 작업에서 다시 확인해 주세요.');
        this.checkExpected(disk, currentTaskRevision ? {...expectedAt,revision:disk.revision} : expectedAt);
        let held: CompanionDesktopHandoffRecord | null = null;
        let history: CompanionDesktopHandoffRecord[] = [];
        try {
          const info = await lstat(this.companionHandoffPath);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) fail('corrupt', '이어갈 요청 기록을 확인할 수 없습니다.');
          const envelope: unknown = JSON.parse(await readFile(this.companionHandoffPath, 'utf8'));
          if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data)
            || envelope.data.scope !== this.scope || envelope.checksum !== hash(JSON.stringify(envelope.data)))
            return fail('corrupt', '이어갈 요청 기록의 범위나 형식을 확인할 수 없습니다.');
          const data = envelope.data;
          const validRecord = (record: unknown): record is CompanionDesktopHandoffRecord => validCompanionDesktopHandoffRecord(record)
            && record.digest === hash(JSON.stringify(record.checkpoint));
          if (data.version === 1 && exactKeys(data,['version','scope','record']) && info.size <= 16 * 1024 && validRecord(data.record)) {
            held = clone(data.record);
          } else if (data.version === 2 && exactKeys(data,['version','scope','record','history'])
            && (data.record === null || validRecord(data.record)) && Array.isArray(data.history)
            && data.history.length <= COMPANION_RETAINED_RUN_LIMIT && data.history.every(record=>validRecord(record)&&terminalCompanionRun(record))
            && new Set(data.history.map(record=>record.checkpoint.id)).size === data.history.length
            && !data.history.some(record=>data.record && record.checkpoint.id === (data.record as CompanionDesktopHandoffRecord).checkpoint.id)) {
            held = clone(data.record as CompanionDesktopHandoffRecord | null); history = clone(data.history);
          } else return fail('corrupt', '이어갈 요청 기록의 범위나 형식을 확인할 수 없습니다.');
        } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
        let next = change(held, history);
        if (rotatePrior) {
          if (!held || held.checkpoint.id !== rotatePrior.id || held.digest !== rotatePrior.digest || !terminalCompanionRun(held)
            || held.checkpoint.target.taskId !== expectedAt.taskId || !next
            || (next.authoringImport?.state !== 'prepared' && next.authoringExecution?.state !== 'prepared')
            || next.checkpoint.id === held.checkpoint.id || history.some(record=>record.checkpoint.id===next!.checkpoint.id)
            || history.length >= COMPANION_RETAINED_RUN_LIMIT)
            fail('stale','이전 휴대폰 요청의 실행 기록을 먼저 확인해 주세요. 보관 기록은 그대로 두었어요.');
          history = [...history, clone(held!)];
        }
        const encodeHandoff = (record: CompanionDesktopHandoffRecord | null) => {
          const data = history.length ? {version:2,scope:this.scope,record,history} : {version:1,scope:this.scope,record};
          const encoded = JSON.stringify({checksum:hash(JSON.stringify(data)),data});
          if (Buffer.byteLength(encoded) > 256 * 1024) fail('stale','보관한 휴대폰 요청이 가득 찼어요. 기존 기록은 그대로 두었어요.');
          return encoded;
        };
        if (draftImport && next?.authoringImport?.state !== 'imported') {
          const task = this.requireTask(disk, disk.activeTaskId);
          if (!draftImport.isCurrent() || JSON.stringify(task.draft) !== JSON.stringify(draftImport.draft)
            || task.draft.text || task.draft.images.length || task.draft.queued !== null || task.draft.inlineEdit
            || task.draft.recovered?.length || task.draft.imports?.length)
            fail('stale', '컴퓨터에 입력 중인 내용이 있어요. 기존 입력은 그대로 두었어요.');
        }
        if (JSON.stringify(next) !== JSON.stringify(held)) {
          if (next === null && !history.length) await unlink(this.companionHandoffPath);
          else {
            if (next !== null && !validCompanionDesktopHandoffRecord(next)) fail('invalid', '이어갈 요청을 확인해 주세요.');
            await this.writeAtomic(this.companionHandoffPath, encodeHandoff(next), lock.owner.nonce, commitCurrent);
          }
        }
        if (draftImport && next?.authoringImport?.state === 'prepared') {
          // Write-ahead receipt: interruption must never silently reimport a request after Send.
          if (!draftImport.isCurrent()) fail('stale', '현재 작업이 바뀌었어요. 요청을 다시 확인해 주세요.');
          const task = this.requireTask(disk, disk.activeTaskId);
          task.draft = { ...clone(draftImport.draft), text: next.checkpoint.reviewedIntent };
          disk.revision++;
          const encoded = JSON.stringify({ checksum: hash(JSON.stringify(disk)), data: disk });
          decode(encoded, this.scope);
          await this.writeAtomic(this.filePath, encoded, lock.owner.nonce, commitCurrent);
          this.data = disk;
          next = { ...next, authoringImport: { ...next.authoringImport, state: 'imported', revision: disk.revision } };
          await this.writeAtomic(this.companionHandoffPath, encodeHandoff(next), lock.owner.nonce, commitCurrent);
        }
        return next ? clone(next) : null;
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '이어갈 요청을 저장하거나 읽지 못했어요. 원래 입력은 그대로예요.');
      } finally { await this.releaseLock(lock); }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  readCompanionHandoff(expected: TaskWorkspaceExpected): Promise<CompanionDesktopHandoffRecord | null> {
    return this.companionHandoffOperation(expected, held => held);
  }
  /** Local write-ahead evidence only. The caller must already verify Service authority and native consent. */
  reserveCompanionExecution(checkpoint: CompanionDesktopHandoffCheckpoint, authority: CompanionExecutionReservation,
    expected: TaskWorkspaceExpected, isCurrent: () => boolean, prior?: {id:string;digest:string}): Promise<{record:CompanionDesktopHandoffRecord;created:boolean}> {
    if (!validCompanionDesktopHandoff(checkpoint) || !validCompanionExecutionReservation(authority)
      || Object.keys(authority).length !== 4 || checkpoint.target.taskId !== expected.taskId
      || checkpoint.run.state !== 'not_started')
      return Promise.reject(new TaskWorkspaceStoreError('invalid','실행할 요청과 허용 범위를 다시 확인해 주세요.'));
    const saved=clone(checkpoint), reservation=clone(authority);let created=false,replayed:CompanionDesktopHandoffRecord|undefined;
    return this.companionHandoffOperation({...expected},(held,history)=>{
      if (!isCurrent()) return fail('stale','휴대폰 실행 허용이 끝났어요. 자동으로 실행하지 않아요.');
      const existing=[held,...history].find(record=>record?.checkpoint.id===saved.id);
      if (existing) {
        const binding=existing.authoringExecution;
        if (!binding || prior || existing.digest!==hash(JSON.stringify(saved))
          || !['grantId','turnId','requestHash','authorityDigest'].every(key=>binding[key as keyof CompanionExecutionReservation]===reservation[key as keyof CompanionExecutionReservation]))
          return fail('stale','같은 요청 번호의 내용이나 실행 허용이 바뀌었어요.');
        // Retained replay cannot become current or dispatch again.
        replayed=clone(existing);
        return held;
      }
      if (saved.target.version!==expected.revision) return fail('stale','검토한 작업 버전이 바뀌었어요.');
      if ([held,...history].some(record=>record?.authoringRun?.turnId===reservation.turnId || record?.authoringExecution?.turnId===reservation.turnId))
        return fail('stale','이미 기록한 실행 번호예요. 다른 요청에 다시 쓰지 않아요.');
      if (held && !prior || !held && prior) return fail('stale','이전 휴대폰 요청을 먼저 확인해 주세요.');
      if (held && !['actorId','deviceId','pairingId','hostId','workspaceId','projectId','taskId'].every(key=>
        held.checkpoint.target[key as keyof typeof saved.target]===saved.target[key as keyof typeof saved.target]))
        return fail('stale','현재 연결과 작업이 바뀌었어요.');
      const draft=this.getDraft();
      if (draft.text || draft.images.length || draft.queued!==null || draft.inlineEdit || draft.imports?.length || draft.recovered?.length)
        return fail('stale','컴퓨터에서 작성 중인 입력을 그대로 두었어요. 휴대폰 요청은 실행하지 않아요.');
      created=true;
      return {checkpoint:saved,digest:hash(JSON.stringify(saved)),status:'pending',authoringExecution:{...reservation,state:'prepared'}};
    },undefined,isCurrent,false,prior?clone(prior):undefined).then(record=>({record:replayed??record!,created}));
  }
  /** Bind exact restore/turn before dispatch; no draft import or presented acknowledgement is fabricated. */
  bindCompanionExecutionRun(source: CompanionAuthoringSendSource, authority: CompanionExecutionReservation,
    run: CompanionAuthoringRun, expected: TaskWorkspaceExpected, isCurrent: () => boolean): Promise<void> {
    const saved=clone(source), reservation=clone(authority), binding=clone(run);
    return this.companionHandoffOperation({...expected},(held,history)=>{
      const execution=held?.authoringExecution;
      if (!isCurrent() || !held || !execution || execution.state!=='prepared' || held.authoringRun
        || !validCompanionExecutionReservation(reservation) || Object.keys(reservation).length!==4
        || !['grantId','turnId','requestHash','authorityDigest'].every(key=>execution[key as keyof CompanionExecutionReservation]===reservation[key as keyof CompanionExecutionReservation])
        || held.checkpoint.id!==saved.requestId || execution.requestHash!==saved.requestHash || held.checkpoint.target.taskId!==expected.taskId
        || saved.taskId!==expected.taskId || held.checkpoint.reviewedIntent!==saved.text
        || held.checkpoint.target.artifactId!==saved.artifactId || held.checkpoint.target.artifactVersion!==saved.artifactVersion
        || binding.beforeArtifactVersion!==saved.artifactVersion || binding.submittedHash!==hash(saved.text)
        || binding.turnId!==execution.turnId || binding.runtime!=='agent-sdk' || binding.state!=='outcome_unknown'
        || history.some(record=>record.authoringRun?.userMessageId===binding.userMessageId || record.authoringRun?.turnId===binding.turnId))
        return fail('stale','실행할 휴대폰 요청이나 허용 범위가 바뀌었어요. 자동으로 다시 실행하지 않아요.');
      const draft=this.getDraft();
      if (draft.text || draft.images.length || draft.queued!==null || draft.inlineEdit || draft.imports?.length || draft.recovered?.length)
        return fail('stale','새로 작성한 입력을 그대로 두었어요. 휴대폰 요청은 실행하지 않아요.');
      return {...held,authoringExecution:{...execution,state:'bound'},authoringRun:binding};
    },undefined,isCurrent).then(()=>undefined);
  }
  async retainedCompanionAuthoringRequest(expected: TaskWorkspaceExpected, id: string): Promise<CompanionDesktopHandoffRecord | null> {
    let retained: CompanionDesktopHandoffRecord | null = null;
    await this.companionHandoffOperation(expected,(held,history)=>{retained=clone(history.find(record=>record.checkpoint.id===id)??null);return held;});
    return retained;
  }
  /** Called only after the new request's explicit desktop consent and live draft check. */
  importNextCompanionAuthoringDraft(checkpoint: CompanionDesktopHandoffCheckpoint, requestHash: string,
    prior: {id:string;digest:string}, expected: TaskWorkspaceExpected, draft: ActivityDraft, isCurrent: () => boolean): Promise<CompanionDesktopHandoffRecord> {
    if (!validCompanionDesktopHandoff(checkpoint) || !/^[a-f0-9]{64}$/.test(requestHash)
      || checkpoint.target.taskId !== expected.taskId || checkpoint.target.version !== expected.revision)
      return Promise.reject(new TaskWorkspaceStoreError('invalid','현재 작업과 같은 요청만 가져올 수 있어요.'));
    const saved=clone(checkpoint), original=clone(draft), previous=clone(prior);
    return this.companionHandoffOperation({...expected},held=>{
      if (!isCurrent() || !held || !['actorId','deviceId','pairingId','hostId','workspaceId','projectId','taskId'].every(key=>
        held.checkpoint.target[key as keyof typeof saved.target]===saved.target[key as keyof typeof saved.target]))
        return fail('stale','현재 작업과 연결이 바뀌었어요. 기존 기록은 그대로 두었어요.');
      return {checkpoint:saved,digest:hash(JSON.stringify(saved)),status:'pending',authoringImport:{requestHash,state:'prepared'}};
    },{draft:original,isCurrent},undefined,false,previous).then(record=>record!);
  }
  stageCompanionHandoff(checkpoint: CompanionDesktopHandoffCheckpoint, expected: TaskWorkspaceExpected, authoringHash?: string, isCurrent?: () => boolean): Promise<CompanionDesktopHandoffRecord> {
    // Snapshot before a queued caller may mutate its input. Data itself grants no authority.
    if ((authoringHash !== undefined && !/^[a-f0-9]{64}$/.test(authoringHash)) || !validCompanionDesktopHandoff(checkpoint) || checkpoint.target.taskId !== expected.taskId || checkpoint.target.version !== expected.revision)
      return Promise.reject(new TaskWorkspaceStoreError('invalid', '현재 작업과 같은 요청만 보관할 수 있어요.'));
    const saved = clone(checkpoint), digest = hash(JSON.stringify(saved));
    return this.companionHandoffOperation({ ...expected }, (held,history) => {
      if (history.some(record=>record.checkpoint.id===saved.id)) return fail('stale','이미 보관한 휴대폰 요청이에요. 다시 가져오지 않아요.');
      if (held) {
        if (held.checkpoint.id === saved.id && held.digest === digest && held.authoringImport?.requestHash === authoringHash) return held;
        return fail('stale', '이미 보관한 이어갈 요청이 있어요. 기존 요청을 먼저 확인해 주세요.');
      }
      return { checkpoint: saved, digest, status: 'pending', ...(authoringHash ? {authoringImport: {requestHash: authoringHash, state: 'review' as const}} : {}) };
    }, undefined, isCurrent).then(record => record!);
  }
  /** Separate explicit desktop decision; DMC7 open/accept never implies draft import. */
  importCompanionAuthoringDraft(id: string, requestHash: string, expected: TaskWorkspaceExpected,
    draft: ActivityDraft, isCurrent: () => boolean): Promise<CompanionDesktopHandoffRecord> {
    const original = clone(draft);
    return this.companionHandoffOperation({ ...expected }, held => {
      if (!held || held.checkpoint.id !== id || held.authoringImport?.requestHash !== requestHash
        || held.checkpoint.target.taskId !== expected.taskId
        || (held.authoringImport.state === 'review' && held.checkpoint.target.version !== expected.revision))
        return fail('stale', '검토한 요청이 바뀌었어요.');
      if (held.authoringImport.state === 'imported') return held;
      if (held.authoringImport.state === 'prepared') return fail('stale', '초안 가져오기 결과를 확인해야 해요. 자동으로 다시 가져오지 않아요.');
      if (!isCurrent()) return fail('stale', '현재 작업이 바뀌었어요.');
      return { ...held, authoringImport: { requestHash, state: 'prepared' } };
    }, {draft: original, isCurrent}).then(record=>record!);
  }
  /** Persist the view ACK separately: saved text without a confirmed composer must remain uncertain. */
  presentCompanionAuthoringDraft(id: string, requestHash: string, expected: TaskWorkspaceExpected,
    isCurrent: () => boolean): Promise<void> {
    return this.companionHandoffOperation({...expected}, held=>{
      if (!isCurrent() || !held || held.checkpoint.id!==id || held.checkpoint.target.taskId!==expected.taskId
        || held.authoringImport?.requestHash!==requestHash || held.authoringImport.state!=='imported'
        || this.getDraft().text!==held.checkpoint.reviewedIntent) return fail('stale','가져온 입력을 다시 확인해야 해요.');
      return {...held,authoringImport:{...held.authoringImport,presented:true}};
    }, undefined, isCurrent).then(()=>undefined);
  }
  /** Capture before the ordinary composer clears. Edited text carries no automatic phone provenance. */
  captureCompanionAuthoringSend(expected: TaskWorkspaceExpected, submitted: string, userMessageId: string,
    draft: ActivityDraft): Promise<CompanionAuthoringSendSource | null> {
    const saved = clone(draft); let source: CompanionAuthoringSendSource | null = null;
    return this.companionHandoffOperation({...expected}, (held,history)=>{
      if (history.some(record=>record.authoringRun?.userMessageId===userMessageId)) return fail('stale','이미 보관한 휴대폰 요청의 보내기예요. 다시 실행하지 않아요.');
      if (held?.authoringRun?.userMessageId === userMessageId) return fail('stale','이 휴대폰 요청의 보내기는 이미 기록했어요. 자동으로 다시 실행하지 않아요.');
      if (!held || held.authoringImport?.state !== 'imported' || !held.authoringImport.presented
        || held.checkpoint.target.taskId !== expected.taskId || held.checkpoint.reviewedIntent !== saved.text
        || submitted !== saved.text.trim()
        || saved.images.length || saved.queued !== null || saved.inlineEdit || saved.imports?.length || saved.recovered?.length) return held;
      if (held.authoringRun) return fail('stale','이 휴대폰 요청의 실행 기록을 먼저 확인해 주세요.');
      // A React autosave/clear may already be queued ahead of this read. It does
      // not change the frozen Send; a different native draft or tool mode does.
      const current = this.getDraft();
      if ((current.text && current.text !== saved.text) || current.images.length || current.queued !== null
        || current.inlineEdit || current.imports?.length || current.recovered?.length || (current.toolMode??'auto')!==(saved.toolMode??'auto'))
        return fail('stale','현재 입력이 바뀌었어요. 휴대폰 요청의 보내기를 다시 확인해 주세요.');
      source = Object.freeze({requestId:held.checkpoint.id,requestHash:held.authoringImport.requestHash,taskId:held.checkpoint.target.taskId,
        text:submitted,artifactId:held.checkpoint.target.artifactId,artifactVersion:held.checkpoint.target.artifactVersion});
      return held;
    },undefined,undefined,true).then(()=>source);
  }
  /** Durable reservation BEFORE the existing runner. Any interrupted reservation remains unknown. */
  bindCompanionAuthoringRun(source: CompanionAuthoringSendSource, run: CompanionAuthoringRun,
    expected: TaskWorkspaceExpected, isCurrent: () => boolean): Promise<void> {
    const saved = clone(source), binding = clone(run);
    return this.companionHandoffOperation({...expected}, held=>{
      if (!isCurrent() || !held || held.checkpoint.id !== saved.requestId || held.authoringImport?.requestHash !== saved.requestHash
        || !held.authoringImport.presented || held.checkpoint.target.taskId !== expected.taskId || saved.taskId !== expected.taskId
        || held.checkpoint.reviewedIntent.trim() !== saved.text || held.checkpoint.target.artifactId !== saved.artifactId
        || held.checkpoint.target.artifactVersion !== saved.artifactVersion || binding.beforeArtifactVersion !== saved.artifactVersion
        || binding.submittedHash !== hash(saved.text) || binding.state !== 'outcome_unknown' || held.authoringRun)
        return fail('stale','검토한 휴대폰 요청이나 현재 작업이 바뀌었어요. 다시 확인해 주세요.');
      const draft = this.getDraft();
      if ((draft.text && draft.text !== held.checkpoint.reviewedIntent) || draft.images.length || draft.queued !== null || draft.inlineEdit || draft.imports?.length || draft.recovered?.length)
        return fail('stale','새로 작성한 입력은 그대로 두었어요. 휴대폰 요청의 보내기를 다시 확인해 주세요.');
      return {...held,authoringRun:binding};
    },undefined,isCurrent).then(()=>undefined);
  }
  finishCompanionAuthoringRun(source: CompanionAuthoringSendSource, turnId: string,
    result: Pick<CompanionAuthoringRun,'state'|'afterArtifactVersion'> & Partial<Pick<CompanionAuthoringRun,'runtime'>>, expected: TaskWorkspaceExpected,
    isCurrent: () => boolean): Promise<void> {
    const saved = clone(result);
    return this.companionHandoffOperation({...expected}, held=>{
      if (!isCurrent() || !held || held.checkpoint.id !== source.requestId
        || (held.authoringImport?.requestHash ?? held.authoringExecution?.requestHash) !== source.requestHash
        || held.checkpoint.target.taskId !== expected.taskId || held.authoringRun?.turnId !== turnId
        || (held.authoringRun.state !== 'outcome_unknown' && JSON.stringify({...held.authoringRun,...saved}) !== JSON.stringify(held.authoringRun)))
        return fail('stale','이 요청의 실행 결과를 확인하지 못했어요. 자동으로 다시 실행하지 않아요.');
      return {...held,authoringRun:{...held.authoringRun,...saved}};
    },undefined,isCurrent).then(()=>undefined);
  }
  acceptCompanionHandoff(id: string, digest: string, expected: TaskWorkspaceExpected, now = Date.now()): Promise<CompanionDesktopHandoffRecord> {
    return this.companionHandoffOperation({ ...expected }, held => {
      if (!held || held.checkpoint.id !== id || held.digest !== digest || held.checkpoint.target.taskId !== expected.taskId
        || held.checkpoint.target.version !== expected.revision || held.authoringExecution) return fail('stale', '이어갈 요청이나 작업 버전이 바뀌었어요. 다시 확인해 주세요.');
      if (held.status === 'accepted') return held;
      if (!timestamp(now)) return fail('invalid', '확인 시각을 확인해 주세요.');
      return { ...held, status: 'accepted', acceptedAt: now };
    }).then(record => record!);
  }

  /** Explicit local discard may remove an old revision's record, but only under CURRENT task/store CAS. */
  discardCompanionHandoff(id: string, digest: string, expected: TaskWorkspaceExpected): Promise<void> {
    const at = { ...expected };
    return this.companionHandoffOperation(at, held => {
      if (!held || held.checkpoint.id !== id || held.digest !== digest || held.checkpoint.target.taskId !== at.taskId)
        return fail('stale', '지우려는 보관 요청이 바뀌었어요. 최신 작업에서 다시 확인해 주세요.');
      if (held.authoringExecution || held.authoringImport && held.authoringImport.state !== 'review')
        return fail('stale', '가져온 요청의 기록은 실행 결과와 확인하기 전까지 보존해야 해요.');
      return null;
    }).then(() => undefined);
  }

  create(title: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      const task = this.newTask(normalizedTitle(title), Date.now());
      current.tasks.push(task);
      current.activeTaskId = task.id;
      return current;
    });
  }

  select(taskId: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate((data, _versions, archive) => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      this.requireTask(current, taskId);
      // CGP-CHAT-R-025 — an archived task opens only through 보관함's 다시 열기.
      if (taskId !== current.activeTaskId && archivedIn(archive, taskId)) fail('not_found', '보관한 작업입니다. 보관함에서 다시 열어 주세요.');
      current.activeTaskId = taskId;
      return current;
    });
  }

  /**
   * CGP-CHAT-R-025 — hide the open task from the list. Only the archive sidecar records it: the
   * transcript, draft, earlier versions and verdicts stay exactly as they are. The most recently
   * updated listed task opens next; with none left, a new empty task does.
   */
  archiveTask(taskId: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate((data, _versions, archive) => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      if (taskId !== current.activeTaskId) fail('stale', '열린 작업이 바뀌었습니다. 현재 작업에서 다시 시도해 주세요.');
      this.requireTask(current, taskId);
      archive.tasks[taskId] = Date.now();
      const next = current.tasks.filter(task => !archivedIn(archive, task.id))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0];
      if (next) current.activeTaskId = next.id;
      else {
        const task = this.newTask('새 작업', Date.now());
        current.tasks.push(task);
        current.activeTaskId = task.id;
      }
      return current;
    });
  }

  /** CGP-CHAT-R-025 — 다시 열기: back in the list, and open. The task's content was never changed. */
  restoreTask(taskId: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate((data, _versions, archive) => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      this.requireTask(current, taskId);
      if (!archivedIn(archive, taskId)) fail('not_found', '보관함에서 이 작업을 찾을 수 없습니다. 보관함을 다시 열어 주세요.');
      delete archive.tasks[taskId];
      current.activeTaskId = taskId;
      return current;
    });
  }

  rename(taskId: string, title: string): Promise<TaskWorkspaceView> {
    return this.renameWithUndo(taskId, title).then(result => result.view);
  }
  /**
   * CGP-CHAT-R-029 — rename and keep what it replaced, so 되돌리기 can put the exact prior title and its
   * origin back (an automatic or default title then keeps following the conversation). The list keeps
   * ordering by last activity: the draft flush around a rename and its undo is activity too.
   * `undo` is null when nothing changed.
   */
  async renameWithUndo(taskId: string, title: string): Promise<{ view: TaskWorkspaceView; undo: RenameUndo<TitleOrigin> | null }> {
    let undo: RenameUndo<TitleOrigin> | null = null;
    const view = await this.updateTask(taskId, task => {
      const before = { title: task.title, titleOrigin: task.titleOrigin };
      task.title = normalizedTitle(title); task.titleOrigin = 'manual';
      if (before.title !== task.title || before.titleOrigin !== 'manual')
        undo = { taskId, renamedTo: task.title, title: before.title, titleOrigin: before.titleOrigin };
    });
    return { view, undo };
  }
  /** Put a rename back, only while the task still carries exactly that rename (nothing renamed it since). */
  undoRename(undo: RenameUndo<TitleOrigin>): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      const current = this.requireData(data);
      if (undo.taskId !== current.activeTaskId) fail('stale', '다른 작업의 이름은 되돌릴 수 없어요.');
      const task = this.requireTask(current, undo.taskId);
      if (task.title !== undo.renamedTo || task.titleOrigin !== 'manual') fail('stale', '이름이 이미 바뀌어서 되돌리지 못했어요.');
      task.title = undo.title;
      if (undo.titleOrigin === undefined) delete task.titleOrigin; else task.titleOrigin = undo.titleOrigin;
      task.updatedAt = Math.max(Date.now(), task.updatedAt);
      return current;
    });
  }
  /** A captured system notice may finish after selection changes; it never edits another task's content. */
  appendDenial(taskId: string, message: ChatMessage): Promise<TaskWorkspaceView> {
    if (!validIncoming(message) || message.role !== 'tool' || message.content !== '' || message.tool?.state !== 'error' || !storedDenialNotice(message.tool.label))
      return Promise.reject(new TaskWorkspaceStoreError('invalid', '차단 안내 형식이 올바르지 않습니다.'));
    return this.appendSystemLine(taskId, { id: message.id, role: 'tool', content: '', createdAt: message.createdAt, tool: { icon: '🔒', label: message.tool.label, state: 'error' } });
  }

  /** CGP-KNOW-R-021 — a browser download line, written outside any turn like a denial notice. */
  appendDownloadNotice(taskId: string, message: ChatMessage): Promise<TaskWorkspaceView> {
    if (!validIncoming(message) || message.role !== 'tool' || message.content !== '' || !message.tool || !isDownloadNoticeLabel(message.tool.label, message.tool.state))
      return Promise.reject(new TaskWorkspaceStoreError('invalid', '다운로드 안내 형식이 올바르지 않습니다.'));
    return this.appendSystemLine(taskId, { id: message.id, role: 'tool', content: '', createdAt: message.createdAt, tool: { icon: '📄', label: message.tool.label, state: message.tool.state } });
  }

  private appendSystemLine(taskId: string, safe: ChatMessage): Promise<TaskWorkspaceView> {
    return this.mutate((data, versions) => {
      const current = this.requireData(data);
      const task = this.requireTask(current, taskId);
      const transcript = versions.tasks[taskId]?.transcript;
      if (transcript && !transcript.some(m => m.id === safe.id)) transcript.push(safe);
      if (!task.messages.some(m => m.id === safe.id)) task.messages.push(safe);
      task.messageCount = task.messages.length;
      task.updatedAt = Math.max(Date.now(), task.updatedAt);
      return current;
    });
  }

  append(taskId: string, messages: ChatMessage[], isCurrent?: () => boolean): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, (task, versions) => {
      if (!Array.isArray(messages) || !messages.every(validIncoming)) fail('invalid', '저장할 대화 형식이 올바르지 않습니다.');
      // CGP-CHAT-R-002 — merge into the full conversation, then store the visible part in the task
      // file and the superseded turns in the sidecar.
      const split = splitVersions(this.mergeMessages(joinVersions(task.messages, versions.tasks[taskId]), messages.map(message => message.tool?.shell ? {
        ...message, tool: { icon: message.tool.icon, label: shellLabel(message.tool.shell), state: message.tool.state },
      } : message)));
      task.messages = split.visible;
      if (split.versions.transcript?.length || split.versions.hidden.length || Object.keys(split.versions.groups).length || Object.keys(split.versions.attempts ?? {}).length) versions.tasks[taskId] = split.versions;
      else delete versions.tasks[taskId];
      task.messageCount = task.messages.length;
      if (task.titleOrigin === 'default' || task.titleOrigin === 'automatic') {
        const title = suggestTaskTitle(task.messages);
        if (title) { task.title = title; task.titleOrigin = 'automatic'; }
      }
    }, isCurrent);
  }
  saveDraft(taskId: string, draft: ActivityDraft): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => {
      if (!validDraft(draft)) fail('invalid', '저장할 초안 형식이 올바르지 않습니다.');
      task.draft = clone(draft);
    });
  }
  /** Explicitly fork the displayed work; never merge it over another writer's changes. */
  recoverDraft(taskId: string, draft: ActivityDraft): Promise<TaskWorkspaceView> {
    const current = this.requireData(this.data);
    if (taskId !== current.activeTaskId || !validDraft(draft)) return Promise.reject(new TaskWorkspaceStoreError('stale', '현재 작업의 입력을 다시 확인해 주세요.'));
    const original = clone(this.requireTask(current, taskId));
    return this.mutate(data => {
      const latest = this.requireData(data);
      const recovered = this.newTask(`${original.title.slice(0, 150)} · 복구`, Date.now());
      recovered.messages = original.messages;
      recovered.messageCount = recovered.messages.length;
      recovered.sourceSelection = original.sourceSelection;
      recovered.draft = clone(draft);
      if (recovered.draft.queued !== null) recovered.draft.queuedPaused = true;
      latest.tasks.push(recovered);
      latest.activeTaskId = recovered.id;
      return latest;
    }, true);
  }
  clearHistory(taskId: string): Promise<TaskWorkspaceView> {
    const cleared = this.updateTask(taskId, (task, versions) => { task.messages = []; task.messageCount = 0; delete versions.tasks[taskId]; });
    // CGP-CHAT-R-005 — the answers are gone, so are their drawn verdicts (the spool keeps the events).
    return cleared.then(view => this.mutateVerdicts(taskId, () => null).then(() => view));
  }
  /**
   * CGP-CHAT-R-005 — append one verdict event for an answer of the ACTIVE task, under the same lock
   * as the task file, writing only the verdict sidecar. Resolves the task's latest verdicts.
   */
  recordVerdict(taskId: string, event: VerdictEvent): Promise<VerdictMap> {
    if (!validVerdictEvent(event)) return Promise.reject(new TaskWorkspaceStoreError('invalid', '저장할 답변 선택 형식이 올바르지 않습니다.'));
    return this.mutateVerdicts(taskId, history => appendVerdict(history, clone(event)));
  }
  /**
   * CGP-KNOW-R-008 — set (or, with null, clear) the ACTIVE task's emoji/colour under the task lock,
   * writing only the appearance sidecar. Neither the title nor `updatedAt` changes, so the task does
   * not jump to the top of the list for a cosmetic choice.
   */
  setAppearance(taskId: string, appearance: TaskAppearance | null): Promise<TaskWorkspaceView> {
    if (appearance !== null && !validTaskAppearance(appearance)) return Promise.reject(new TaskWorkspaceStoreError('invalid', '고를 수 있는 아이콘과 색이 아닙니다.'));
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      const current = this.requireData(this.data);
      if (taskId !== current.activeTaskId) fail('stale', '다른 작업의 저장 요청입니다. 현재 작업에서 다시 시도해 주세요.');
      this.requireTask(current, taskId);
      try {
        await this.prepareDirectory();
        const lock = await this.acquireLock();
        try {
          const disk = await this.readAppearanceLocked(lock.owner.nonce);
          const next = clone(disk);
          if (appearance) next.tasks[taskId] = { ...(appearance.emoji ? { emoji: appearance.emoji } : {}), ...(appearance.colour ? { colour: appearance.colour } : {}) };
          else delete next.tasks[taskId];
          if (JSON.stringify(next) !== JSON.stringify(disk)) {
            const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
            decodeAppearance(content, this.scope);
            await this.writeAtomic(this.appearancePath, content, lock.owner.nonce);
          }
          this.appearance = next;
          return this.getView();
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '아이콘과 색을 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  saveSurface(taskId: string, selection: TaskSurfaceSelection | null): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => {
      if (!validSurface(selection)) fail('invalid', '저장할 출처 주소가 올바르지 않습니다.');
      task.sourceSelection = clone(selection);
    });
  }

  /** CGP-KNOW-R-009 — the same scope read again from disk now, independent of this instance's memory. */
  reread(): TaskWorkspaceStore { return new TaskWorkspaceStore(this.rootPath, this.scopeInput); }

  /**
   * CGP-KNOW-R-009 — one task exactly as this scope stores it (task document with its draft, the
   * versions sidecar entry and the verdict events), for a move to another personal activity.
   */
  exportTask(taskId: string): MovedTask {
    const task = this.getTask(taskId) ?? fail('not_found', '이 작업을 찾을 수 없습니다. 작업 목록을 다시 열어 주세요.');
    return { task, versions: this.versions.tasks[taskId] ? clone(this.versions.tasks[taskId]) : null, verdicts: clone(this.verdicts.tasks[taskId] ?? []) };
  }

  /**
   * CGP-KNOW-R-009 — receive a task moved from another scope. The moved task joins the list as it
   * is (same id, title, transcript, draft, versions and verdicts); this scope's active task does not
   * change. Only a scope that already has a task file receives: one that was never opened would
   * otherwise skip its first-open import of older history. A task id this scope already holds is
   * accepted only when it is the identical task (a retry after a half-done move); anything else is
   * refused and nothing is written. Order: versions, verdicts, then the task file (the commit point),
   * so a task that is present always has its sidecar entries; an interrupted receive leaves at most
   * sidecar entries for a task id the list does not hold, which the next receive overwrites.
   */
  receiveTask(moved: MovedTask): Promise<TaskWorkspaceView> {
    if (!isRecord(moved) || !validTask(moved.task) || (moved.versions !== null && !validVersions(moved.versions)) ||
        !Array.isArray(moved.verdicts) || !moved.verdicts.every(validVerdictEvent)) {
      return Promise.reject(new TaskWorkspaceStoreError('invalid', '옮길 작업의 형식을 확인할 수 없습니다.'));
    }
    const incoming = clone(moved);
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      try {
        await this.prepareDirectory();
        const lock = await this.acquireLock();
        try {
          let disk: WorkspaceData;
          try {
            const stat = await lstat(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
            disk = decode(await readFile(this.filePath, 'utf8'), this.scope);
          } catch (error) {
            if (codeOf(error) === 'ENOENT') fail('not_initialized', '옮길 활동을 한 번 연 뒤에 다시 시도해 주세요.');
            throw error;
          }
          const diskVersions = await this.readVersionsLocked(lock.owner.nonce);
          const diskVerdicts = await this.readVerdictsLocked(lock.owner.nonce);
          const existing = disk.tasks.find(task => task.id === incoming.task.id);
          if (existing) {
            const same = JSON.stringify(existing) === JSON.stringify(incoming.task) &&
              JSON.stringify(diskVersions.tasks[existing.id] ?? null) === JSON.stringify(incoming.versions) &&
              JSON.stringify(diskVerdicts.tasks[existing.id] ?? []) === JSON.stringify(incoming.verdicts);
            if (!same) fail('invalid', '옮길 활동에 같은 작업이 이미 있어요. 작업 목록을 확인해 주세요.');
            this.data = disk; this.versions = diskVersions; this.verdicts = diskVerdicts;
            return this.getView();
          }
          // A sidecar entry for an id the list does not hold is left over (an interrupted receive or
          // release); the incoming task replaces it, and an incoming task without one clears it.
          const versions = clone(diskVersions);
          if (incoming.versions) versions.tasks[incoming.task.id] = incoming.versions;
          else delete versions.tasks[incoming.task.id];
          const verdicts = clone(diskVerdicts);
          if (incoming.verdicts.length) verdicts.tasks[incoming.task.id] = incoming.verdicts;
          else delete verdicts.tasks[incoming.task.id];
          const next: WorkspaceData = { ...disk, revision: disk.revision + 1, tasks: [...disk.tasks, incoming.task] };
          if (JSON.stringify(versions) !== JSON.stringify(diskVersions)) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(versions)), data: versions });
            decodeVersions(sidecar, this.scope);
            await this.writeAtomic(this.versionsPath, sidecar, lock.owner.nonce);
          }
          this.versions = versions;
          if (JSON.stringify(verdicts) !== JSON.stringify(diskVerdicts)) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(verdicts)), data: verdicts });
            decodeVerdicts(sidecar, this.scope);
            await this.writeAtomic(this.verdictsPath, sidecar, lock.owner.nonce);
          }
          this.verdicts = verdicts;
          const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
          decode(content, this.scope);
          await this.writeAtomic(this.filePath, content, lock.owner.nonce);
          this.data = next;
          return this.getView();
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '작업을 옮기지 못했습니다. 원래 기록은 그대로 있어요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  /**
   * CGP-KNOW-R-009 — undo a receive when the move cannot finish (the copy did not read back, or the
   * source could not let go). Only the exact task that was received is removed, and only while it is
   * not the open task here; anything else is left alone and reported as not withdrawn.
   */
  async withdrawTask(moved: MovedTask): Promise<boolean> {
    const current = this.data;
    const task = current?.tasks.find(value => value.id === moved?.task?.id);
    if (!current || !task || current.activeTaskId === task.id || current.tasks.length < 2 || JSON.stringify(task) !== JSON.stringify(moved.task)) return false;
    await this.mutate(data => {
      const latest = this.requireData(data);
      latest.tasks = latest.tasks.filter(value => value.id !== task.id);
      return latest;
    });
    await this.dropSidecarEntries(task.id);
    return true;
  }

  /**
   * CGP-KNOW-R-009 — take a task out of this scope after another scope received it. Refused when
   * the list changed since the learner chose (expected). Moving the open task opens the most
   * recently changed remaining one; moving the only task leaves a new empty one. Order: the task
   * file first (the commit point), then the task's versions entry, then its verdict events. A
   * failed task-file write leaves the task with all its earlier versions; a failure after it only
   * leaves unreachable sidecar entries behind, which a later receive of the same id overwrites.
   */
  async releaseTask(taskId: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    const view = await this.mutate(data => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      this.requireTask(current, taskId);
      current.tasks = current.tasks.filter(task => task.id !== taskId);
      if (!current.tasks.length) current.tasks.push(this.newTask('새 작업', Date.now()));
      if (current.activeTaskId === taskId) {
        current.activeTaskId = [...current.tasks].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0].id;
      }
      return current;
    });
    await this.dropSidecarEntries(taskId);
    return view;
  }

  /** CGP-KNOW-R-009 — after a task left the task file: drop its versions, then its verdicts (best effort). */
  private async dropSidecarEntries(taskId: string): Promise<void> {
    await this.mutate((data, versions) => { delete versions.tasks[taskId]; return this.requireData(data); }).catch(() => {});
    await this.dropVerdicts(taskId).catch(() => {});
  }

  private dropVerdicts(taskId: string): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.prepareDirectory();
      const lock = await this.acquireLock();
      try {
        const disk = await this.readVerdictsLocked(lock.owner.nonce);
        if (!disk.tasks[taskId]) { this.verdicts = disk; return; }
        const next = clone(disk);
        delete next.tasks[taskId];
        const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
        decodeVerdicts(content, this.scope);
        await this.writeAtomic(this.verdictsPath, content, lock.owner.nonce);
        this.verdicts = next;
      } finally {
        await this.releaseLock(lock);
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  /**
   * REQ-STUDIO-MISSING-TASK-FOLDER — carry another scope's tasks (messages, drafts, earlier versions
   * and verdicts) into this scope when the activity moves to a new folder (the scope names the
   * folder). The source — the store the learner is working in now — is only read: it is never
   * changed or deleted. For a task both scopes hold (a move back to a folder used before, or a retry
   * after a half-done move) the source's copy wins. This scope's copy of that task, with its versions
   * and verdicts, is first written to a backup file next to the store
   * (`<scope>.<task>.pre-rebind-<ts>[-n].json`, created exclusively, never overwritten); if that
   * copy holds turns the source does not, it also stays visible as its own task, "<name> · 이전".
   * Tasks only this scope holds are kept. The source's active task becomes the active one.
   * One lock covers the whole carry. Order: backups, versions sidecar, task file (the commit
   * point), then the verdict sidecar, so a failed carry never leaves the target's verdicts changed.
   */
  adoptFrom(source: TaskWorkspaceStore): Promise<TaskWorkspaceView> {
    if (source.scope === this.scope) return Promise.resolve(this.getView());
    if (source.loadError) return Promise.reject(source.loadError);
    const from = clone(source.requireData(source.data));
    const fromVersions = clone(source.versions.tasks);
    const fromVerdicts = clone(source.verdicts.tasks);
    const fromArchive = clone(source.archive.tasks);
    const fromAppearance = clone(source.appearance.tasks);
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      try {
        await this.prepareDirectory();
        const lock = await this.acquireLock();
        try {
          let disk: WorkspaceData | undefined;
          try {
            const stat = await lstat(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
            disk = decode(await readFile(this.filePath, 'utf8'), this.scope);
          } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
          const diskVersions = await this.readVersionsLocked(lock.owner.nonce);
          const diskVerdicts = await this.readVerdictsLocked(lock.owner.nonce);
          const diskArchive = await this.readArchiveLocked(lock.owner.nonce);
          const archive = clone(diskArchive);
          const diskAppearance = await this.readAppearanceLocked(lock.owner.nonce);
          const appearance = clone(diskAppearance);
          const tasks = clone(disk?.tasks ?? []);
          const versions = clone(diskVersions);
          const verdicts = clone(diskVerdicts);
          const stamp = Date.now();
          for (const task of from.tasks) {
            const at = tasks.findIndex(existing => existing.id === task.id);
            if (at >= 0) {
              const old = tasks[at];
              await this.writeRebindBackup({ version: 1, scope: this.scope, replacedAt: stamp, task: old,
                versions: diskVersions.tasks[old.id] ?? null, verdicts: diskVerdicts.tasks[old.id] ?? [] }, old.id, stamp);
              const moving = new Set(joinVersions(task.messages, fromVersions[task.id]).map(message => message.id));
              if (joinVersions(old.messages, diskVersions.tasks[old.id]).some(message => !moving.has(message.id))) {
                // Turns made only here stay visible beside the moved task, never only in the backup.
                const kept: TaskDocument = { ...old, id: randomUUID(), title: `${old.title.slice(0, 150)} · 이전`, titleOrigin: 'manual' };
                tasks.push(kept);
                if (diskVersions.tasks[old.id]) versions.tasks[kept.id] = clone(diskVersions.tasks[old.id]);
                if (diskVerdicts.tasks[old.id]?.length) verdicts.tasks[kept.id] = clone(diskVerdicts.tasks[old.id]);
                if (diskAppearance.tasks[old.id]) appearance.tasks[kept.id] = clone(diskAppearance.tasks[old.id]);
              }
              tasks[at] = task;
            } else tasks.push(task);
            if (fromVersions[task.id]) versions.tasks[task.id] = fromVersions[task.id]; else delete versions.tasks[task.id];
            if (fromVerdicts[task.id]?.length) verdicts.tasks[task.id] = fromVerdicts[task.id]; else delete verdicts.tasks[task.id];
            // CGP-CHAT-R-025 — an archived task stays archived in the new folder, a listed one stays listed.
            if (Object.prototype.hasOwnProperty.call(fromArchive, task.id)) archive.tasks[task.id] = fromArchive[task.id]; else delete archive.tasks[task.id];
            if (fromAppearance[task.id]) appearance.tasks[task.id] = fromAppearance[task.id]; else delete appearance.tasks[task.id];
          }
          const next: WorkspaceData = { version: 1, scope: this.scope, revision: (disk?.revision ?? 0) + 1, activeTaskId: from.activeTaskId, tasks };
          if (JSON.stringify(versions) !== JSON.stringify(diskVersions)) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(versions)), data: versions });
            decodeVersions(sidecar, this.scope);
            await this.writeAtomic(this.versionsPath, sidecar, lock.owner.nonce);
          }
          await this.writeArchive(archive, diskArchive, lock.owner.nonce);
          this.archive = archive;
          const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
          decode(content, this.scope);
          await this.writeAtomic(this.filePath, content, lock.owner.nonce);
          this.data = next;
          this.versions = versions;
          if (JSON.stringify(verdicts) !== JSON.stringify(diskVerdicts)) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(verdicts)), data: verdicts });
            decodeVerdicts(sidecar, this.scope);
            await this.writeAtomic(this.verdictsPath, sidecar, lock.owner.nonce);
          }
          this.verdicts = verdicts;
          // After the commit point, like the verdicts: a failed carry never changes the target's marks.
          if (JSON.stringify(appearance) !== JSON.stringify(diskAppearance)) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(appearance)), data: appearance });
            decodeAppearance(sidecar, this.scope);
            await this.writeAtomic(this.appearancePath, sidecar, lock.owner.nonce);
          }
          this.appearance = appearance;
          return this.getView();
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '작업을 옮기지 못했습니다. 원래 기록은 그대로 있어요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  /** One backup file, created exclusively: an existing name (same millisecond) takes the next suffix. */
  private async writeRebindBackup(backup: unknown, taskId: string, stamp: number): Promise<void> {
    for (let n = 0; n < 1000; n++) {
      const target = join(this.directory, `${this.scope}.${taskId}.pre-rebind-${stamp}${n ? `-${n}` : ''}.json`);
      let file;
      try { file = await open(target, 'wx', 0o600); }
      catch (error) { if (codeOf(error) === 'EEXIST') continue; throw error; }
      try { await file.writeFile(JSON.stringify(backup), 'utf8'); await file.sync(); }
      finally { await file.close(); }
      return;
    }
    fail('io', '작업을 옮기기 전 보관 파일을 만들지 못했습니다.');
  }

  private newTask(title: string, now: number): TaskDocument {
    return { id: randomUUID(), title, titleOrigin: title === '새 작업' ? 'default' : 'manual', createdAt: now, updatedAt: now, messageCount: 0,
      messages: [], draft: emptyActivityDraft(), sourceSelection: null, importedLegacy: false };
  }
  private mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const merged = existing.map(message => clone(message));
    const positions = new Map(merged.map((message, index) => [message.id, index]));
    for (const message of incoming) {
      const position = positions.get(message.id);
      if (position === undefined) { positions.set(message.id, merged.length); merged.push(clone(message)); }
      else merged[position] = clone(message);
    }
    return merged;
  }
  private requireData(data: WorkspaceData | undefined): WorkspaceData {
    return data ?? fail('not_initialized', '작업 저장소를 먼저 준비해야 합니다.');
  }
  private requireTask(data: WorkspaceData, taskId: string): TaskDocument {
    return data.tasks.find(task => task.id === taskId) ?? fail('not_found', '이 작업을 찾을 수 없습니다. 작업 목록을 다시 열어 주세요.');
  }
  private checkExpected(data: WorkspaceData, expected: TaskWorkspaceExpected): void {
    if (!expected || data.activeTaskId !== expected.taskId || data.revision !== expected.revision) fail('stale', '작업이 변경되었습니다. 최신 화면에서 다시 선택해 주세요.');
  }
  private updateTask(taskId: string, update: (task: TaskDocument, versions: VersionsData) => void, isCurrent?: () => boolean): Promise<TaskWorkspaceView> {
    return this.mutate((data, versions) => {
      const current = this.requireData(data);
      if (taskId !== current.activeTaskId) fail('stale', '다른 작업의 저장 요청입니다. 현재 작업에서 다시 시도해 주세요.');
      const task = this.requireTask(current, taskId);
      update(task, versions);
      task.updatedAt = Math.max(Date.now(), task.updatedAt);
      return current;
    }, false, isCurrent);
  }

  private async readLock(path: string): Promise<LockRecord | undefined> {
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink()) fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.');
      let owner: unknown;
      try { owner = JSON.parse(await readFile(path, 'utf8')); }
      catch { return fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.'); }
      const after = await lstat(path);
      if (!validOwner(owner)) return fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.');
      if (before.dev !== after.dev || before.ino !== after.ino) fail('locked', '작업 저장 잠금이 변경되었습니다. 다시 시도해 주세요.');
      return { owner, dev: after.dev, ino: after.ino };
    } catch (error) { if (codeOf(error) === 'ENOENT') return undefined; throw error; }
  }

  private async recoverDeadLock(lockPath: string): Promise<void> {
    const original = await this.readLock(lockPath);
    if (!original) return;
    if (original.owner.host !== hostIdentity || !demonstrablyDead(original.owner.pid)) fail('locked', '다른 창에서 작업을 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
    const ownerName = `${basename(lockPath)}.owner-${original.owner.nonce}-${original.owner.pid}`;
    const reclaimPrefix = `${basename(lockPath)}.reclaim-${original.owner.nonce}-`;
    const leases: Array<{ path: string; pid: number }> = [];
    for (const name of await readdir(this.directory)) {
      if (name === ownerName) leases.push({ path: join(this.directory, name), pid: original.owner.pid });
      else if (name.startsWith(reclaimPrefix)) {
        const suffix = name.slice(reclaimPrefix.length);
        const separator = suffix.indexOf('-');
        const pid = Number(suffix.slice(0, separator));
        if (separator < 1 || !Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff || !uuid.test(suffix.slice(separator + 1))) {
          fail('locked', '작업 저장 잠금의 복구 상태를 확인해야 합니다.');
        }
        leases.push({ path: join(this.directory, name), pid });
      }
    }
    if (leases.length !== 1 || !demonstrablyDead(leases[0].pid)) fail('locked', '작업 저장 잠금의 복구를 다른 창에서 확인하고 있습니다.');
    const lease = leases[0];
    if (!sameLock(await this.readLock(lease.path), original)) fail('locked', '작업 저장 잠금의 소유자가 일치하지 않습니다.');
    // Renaming one existing lease is an atomic claim: two recoverers cannot both win.
    // A crashed recoverer leaves its PID in the new name, so recovery itself can resume.
    const claimPath = `${lockPath}.reclaim-${original.owner.nonce}-${process.pid}-${randomUUID()}`;
    try { await rename(lease.path, claimPath); }
    catch (error) { if (codeOf(error) === 'ENOENT') fail('locked', '다른 창에서 작업 기록을 복구하고 있습니다.'); throw error; }
    let removed = false;
    try {
      if (!sameLock(await this.readLock(lockPath), original) || !demonstrablyDead(original.owner.pid)) fail('locked', '작업 저장 잠금이 변경되었습니다. 다시 시도해 주세요.');
      await unlink(lockPath);
      removed = true;
      await unlink(`${this.filePath}.tmp-${original.owner.nonce}`).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
      await unlink(`${this.versionsPath}.tmp-${original.owner.nonce}`).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
      await unlink(`${this.verdictsPath}.tmp-${original.owner.nonce}`).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
      await unlink(`${this.archivePath}.tmp-${original.owner.nonce}`).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
    } finally {
      if (removed) await unlink(claimPath);
      else await rename(claimPath, lease.path);
    }
  }

  private async acquireLock(): Promise<LockLease> {
    const lockPath = `${this.filePath}.lock`;
    const owner: LockOwner = { version: 1, host: hostIdentity, pid: process.pid, nonce: randomUUID(), createdAt: Date.now() };
    const path = `${lockPath}.owner-${owner.nonce}-${owner.pid}`;
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
      finally { await handle.close(); }
      const stat = await lstat(path);
      try { await link(path, lockPath); }
      catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error;
        await this.recoverDeadLock(lockPath);
        try { await link(path, lockPath); }
        catch (retryError) {
          if (codeOf(retryError) === 'EEXIST') fail('locked', '다른 창에서 작업을 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
          throw retryError;
        }
      }
      return { owner, path, dev: stat.dev, ino: stat.ino };
    } catch (error) {
      await unlink(path).catch(cleanup => { if (codeOf(cleanup) !== 'ENOENT') throw cleanup; });
      throw error;
    }
  }

  private async releaseLock(lease: LockLease): Promise<void> {
    const lockPath = `${this.filePath}.lock`;
    if (!sameLock(await this.readLock(lockPath), lease)) fail('locked', '작업 저장 잠금이 변경되어 다른 창의 잠금을 보존했습니다.');
    await unlink(lockPath);
    await unlink(lease.path);
  }

  /** Atomic write of one file under the held lock: temporary file, fsync, rename. */
  private async writeAtomic(target: string, content: string, nonce: string, isCurrent?: () => boolean): Promise<void> {
    const temporaryPath = `${target}.tmp-${nonce}`;
    try {
      const temporary = await open(temporaryPath, 'wx', 0o600);
      try { await temporary.writeFile(content, 'utf8'); await temporary.sync(); }
      finally { await temporary.close(); }
      // Last synchronous admission check: there is no await between this lease and rename dispatch.
      // An OS rename already dispatched cannot be cancelled by later invalidation.
      if (isCurrent && isCurrent() !== true) fail('stale', '현재 작업이 바뀌었어요. 저장 상태를 다시 확인해 주세요.');
      await rename(temporaryPath, target);
    } finally {
      await unlink(temporaryPath).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
    }
  }

  /** The sidecar on disk, read under the lock. An unreadable one is set aside (kept, never overwritten). */
  private async readVersionsLocked(nonce: string): Promise<VersionsData> {
    const empty: VersionsData = { version: 1, scope: this.scope, tasks: {} };
    let text: string;
    try {
      const stat = await lstat(this.versionsPath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '버전 기록 파일의 위치를 확인해야 합니다.');
      text = await readFile(this.versionsPath, 'utf8');
    } catch (error) { if (codeOf(error) === 'ENOENT') return empty; throw error; }
    try { return decodeVersions(text, this.scope); }
    catch { await rename(this.versionsPath, `${this.versionsPath}.unreadable-${nonce}`); return empty; }
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('io', '작업 저장 폴더의 위치를 확인해야 합니다.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail('io', '작업 저장 폴더의 위치를 확인해야 합니다.');
    await chmod(this.directory, 0o700);
  }

  /** The verdict sidecar on disk, read under the lock. An unreadable one is set aside (kept, never overwritten). */
  private async readVerdictsLocked(nonce: string): Promise<VerdictsData> {
    const empty: VerdictsData = { version: 1, scope: this.scope, tasks: {} };
    let text: string;
    try {
      const stat = await lstat(this.verdictsPath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '답변 선택 기록 파일의 위치를 확인해야 합니다.');
      text = await readFile(this.verdictsPath, 'utf8');
    } catch (error) { if (codeOf(error) === 'ENOENT') return empty; throw error; }
    try { return decodeVerdicts(text, this.scope); }
    catch { await rename(this.verdictsPath, `${this.verdictsPath}.unreadable-${nonce}`); return empty; }
  }

  /** The archive sidecar on disk, read under the lock. An unreadable one is set aside (kept, never overwritten). */
  private async readArchiveLocked(nonce: string): Promise<ArchiveData> {
    const empty: ArchiveData = { version: 1, scope: this.scope, tasks: {} };
    let text: string;
    try {
      const stat = await lstat(this.archivePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '보관함 기록 파일의 위치를 확인해야 합니다.');
      text = await readFile(this.archivePath, 'utf8');
    } catch (error) { if (codeOf(error) === 'ENOENT') return empty; throw error; }
    try { return decodeArchive(text, this.scope); }
    catch { await rename(this.archivePath, `${this.archivePath}.unreadable-${nonce}`); return empty; }
  }

  /** Writes the archive sidecar when it changed (validated before the atomic replace). */
  private async writeArchive(next: ArchiveData, disk: ArchiveData, nonce: string): Promise<void> {
    if (JSON.stringify(next) === JSON.stringify(disk)) return;
    const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
    decodeArchive(sidecar, this.scope);
    await this.writeAtomic(this.archivePath, sidecar, nonce);
  }

  /** The appearance sidecar on disk, read under the lock. An unreadable one is set aside (kept, never overwritten). */
  private async readAppearanceLocked(nonce: string): Promise<AppearanceData> {
    const empty: AppearanceData = { version: 1, scope: this.scope, tasks: {} };
    let text: string;
    try {
      const stat = await lstat(this.appearancePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 아이콘 기록 파일의 위치를 확인해야 합니다.');
      text = await readFile(this.appearancePath, 'utf8');
    } catch (error) { if (codeOf(error) === 'ENOENT') return empty; throw error; }
    try { return decodeAppearance(text, this.scope); }
    catch { await rename(this.appearancePath, `${this.appearancePath}.unreadable-${nonce}`); return empty; }
  }

  /**
   * Read-modify-write of one task's verdict events. Only the active task of a loaded store may be
   * changed; `null` from `change` removes the task's entry. The task file itself is never written.
   */
  private mutateVerdicts(taskId: string, change: (history: VerdictEvent[]) => VerdictEvent[] | null): Promise<VerdictMap> {
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      const current = this.requireData(this.data);
      if (taskId !== current.activeTaskId) fail('stale', '다른 작업의 저장 요청입니다. 현재 작업에서 다시 시도해 주세요.');
      this.requireTask(current, taskId);
      try {
        await this.prepareDirectory();
        const lock = await this.acquireLock();
        try {
          const disk = await this.readVerdictsLocked(lock.owner.nonce);
          const next = clone(disk);
          const events = change(next.tasks[taskId] ?? []);
          if (events && events.length) next.tasks[taskId] = events;
          else delete next.tasks[taskId];
          if (JSON.stringify(next) !== JSON.stringify(disk)) {
            const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
            decodeVerdicts(content, this.scope);
            await this.writeAtomic(this.verdictsPath, content, lock.owner.nonce);
          }
          this.verdicts = next;
          return latestVerdicts(next.tasks[taskId] ?? []);
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '답변에 남긴 선택을 저장하지 못했습니다. 다시 시도해 주세요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  private mutate(change: (data: WorkspaceData | undefined, versions: VersionsData, archive: ArchiveData) => WorkspaceData, recoverFromDisk = false, isCurrent?: () => boolean): Promise<TaskWorkspaceView> {
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      if (isCurrent && !isCurrent()) fail('stale', '현재 작업이 바뀌었어요.');
      try {
        await this.prepareDirectory();
        const lock = await this.acquireLock();
        try {
          let disk: WorkspaceData | undefined;
          try {
            const stat = await lstat(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
            disk = decode(await readFile(this.filePath, 'utf8'), this.scope);
          } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
          if (!recoverFromDisk && ((disk?.revision ?? 0) !== (this.data?.revision ?? 0) || JSON.stringify(disk) !== JSON.stringify(this.data))) fail('stale', '다른 창에서 기록이 변경되었습니다. 작업을 다시 열어 주세요.');
          const base = recoverFromDisk ? disk : this.data;
          const diskVersions = await this.readVersionsLocked(lock.owner.nonce);
          const versions = clone(diskVersions);
          const diskArchive = await this.readArchiveLocked(lock.owner.nonce);
          const archive = clone(diskArchive);
          if (isCurrent && !isCurrent()) fail('stale', '현재 작업이 바뀌었어요.');
          const next = change(base ? clone(base) : undefined, versions, archive);
          const versionsChanged = JSON.stringify(versions) !== JSON.stringify(diskVersions);
          // CGP-CHAT-R-025 — the archive sidecar is written before the task file: a crash between them
          // leaves the archived task open, and the open task always stays in the list.
          await this.writeArchive(archive, diskArchive, lock.owner.nonce);
          this.archive = archive;
          if (this.data && JSON.stringify(next) === JSON.stringify(this.data) && !versionsChanged) { this.versions = diskVersions; return this.getView(); }
          // The sidecar is written first: a crash between the two writes leaves the earlier version
          // visible in the task file and a duplicate in the sidecar, which joinVersions ignores.
          if (versionsChanged) {
            const sidecar = JSON.stringify({ checksum: hash(JSON.stringify(versions)), data: versions });
            decodeVersions(sidecar, this.scope);
            await this.writeAtomic(this.versionsPath, sidecar, lock.owner.nonce, isCurrent);
          }
          this.versions = versions;
          if (this.data && JSON.stringify(next) === JSON.stringify(this.data)) return this.getView();
          next.revision = (base?.revision ?? 0) + 1;
          const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
          decode(content, this.scope);
          await this.writeAtomic(this.filePath, content, lock.owner.nonce, isCurrent);
          this.data = next;
          return this.getView();
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '작업을 저장하지 못했습니다. 기록을 다시 확인한 뒤 재시도해 주세요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
}
