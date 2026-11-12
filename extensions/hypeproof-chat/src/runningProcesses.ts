import { shellText, SHELL_PURPOSE_MAX } from './shellPresentation';
/**
 * `folder` is present only when the host knows where the process runs. A `preview` entry is the live
 * server behind the preview tab; it carries the place it serves (`folder`, already in words, never ".")
 * and its loopback `address`.
 */
export interface RunningProcess { id: string; purpose: string; folder?: string; kind?: 'preview'; address?: string; state: 'running' | 'stopping' | 'unknown' | 'stopped' | 'done' | 'error' }
/** How long a settled entry stays visible before it leaves the "실행 중인 것" list. */
export const PROCESS_FINAL_MS = 10_000;
type Schedule = (run: () => void, ms: number) => void;
const defaultSchedule: Schedule = (run, ms) => { const timer = setTimeout(run, ms); (timer as { unref?: () => void }).unref?.(); };
/** Owned handles only: webviews never supply a PID, command, root or SDK session. */
export class RunningProcesses {
  private entries = new Map<string, { view: RunningProcess; stop?: () => Promise<void> }>();
  // No TypeScript parameter properties: tests load this file with node --experimental-strip-types.
  private readonly changed: () => void;
  private readonly schedule: Schedule;
  constructor(changed: () => void, schedule: Schedule = defaultSchedule) { this.changed = changed; this.schedule = schedule; }
  list(): RunningProcess[] { return [...this.entries.values()].map(e => ({ ...e.view })); }
  add(id: string, purpose: unknown, folder: string | undefined, stop?: () => Promise<void>, preview?: { address?: string }): void {
    const prior = this.entries.get(id);
    this.entries.set(id, { view: { id, purpose: shellText(purpose, '백그라운드 실행', SHELL_PURPOSE_MAX), ...(folder !== undefined ? { folder } : {}),
      ...(preview ? { kind: 'preview' as const, ...(preview.address ? { address: preview.address } : {}) } : {}),
      state: prior?.view.state === 'stopping' ? 'stopping' : stop ? 'running' : 'unknown' }, stop });
    this.changed();
  }
  /** Drop an entry without claiming how it ended (e.g. the SDK marked it as housekeeping). */
  remove(id: string): void { if (this.entries.delete(id)) this.changed(); }
  finish(id: string, state: 'stopped' | 'done' | 'error'): void {
    const e = this.entries.get(id); if (!e) return;
    e.view.state = state; e.stop = undefined; this.changed();
    this.expire(id, e);
  }
  unavailable(prefix: string): void {
    for (const [id, e] of this.entries) if (id.startsWith(prefix) && (e.view.state === 'running' || e.view.state === 'stopping')) { e.view.state = 'unknown'; e.stop = undefined; this.expire(id, e); }
    this.changed();
  }
  /** A settled state is shown briefly, then the entry leaves the list (unless it was re-added). */
  private expire(id: string, entry: { view: RunningProcess }): void {
    this.schedule(() => {
      const current = this.entries.get(id);
      if (current === entry && current.view.state !== 'running' && current.view.state !== 'stopping') this.remove(id);
    }, PROCESS_FINAL_MS);
  }
  async stop(id: unknown): Promise<void> {
    if (typeof id !== 'string') return;
    const e = this.entries.get(id);
    if (!e?.stop || e.view.state !== 'running') return;
    e.view.state = 'stopping'; this.changed();
    try { await e.stop(); } catch { if (e.view.state === 'stopping') { e.view.state = 'running'; this.changed(); } }
    // A resolved request is NOT exit evidence. Only finish() acknowledges exit.
  }
}
/** Events belong to this query, not whichever task happens to be open later. */
export class SdkProcesses {
  private ids = new Map<string, string>();
  private runs = new Map<string, string>();
  private ended = new Set<string>();
  private readonly registry: RunningProcesses;
  private readonly prefix: string;
  private readonly stopTask?: (id: string) => Promise<void>;
  constructor(registry: RunningProcesses, prefix: string, stopTask?: (id: string) => Promise<void>) { this.registry = registry; this.prefix = prefix; this.stopTask = stopTask; }
  observe(event: Record<string, unknown>): void {
    if (event.type !== 'system') return;
    if (event.subtype === 'background_tasks_changed' && Array.isArray(event.tasks)) {
      const live = new Set<string>();
      for (const task of event.tasks) {
        if (!task || task.task_type !== 'local_bash' || typeof task.task_id !== 'string') continue;
        // SDK: ambient tasks are not activity; hosts exclude them from activity indicators.
        if (task.ambient === true) {
          const shown = this.ids.get(task.task_id);
          if (shown) { this.registry.remove(shown); this.ended.add(shown); this.ids.delete(task.task_id); }
          continue;
        }
        const run = typeof task.run_id === 'string' ? task.run_id : '';
        if (this.runs.has(task.task_id) && run < this.runs.get(task.task_id)!) { const current = this.ids.get(task.task_id); if (current) live.add(current); continue; }
        const key = `${this.prefix}${task.task_id}:${run}`;
        live.add(key);
        if (this.ended.has(key)) continue;
        const previous = this.ids.get(task.task_id);
        if (previous && previous !== key) { this.registry.finish(previous, 'done'); this.ended.add(previous); }
        this.runs.set(task.task_id, run); this.ids.set(task.task_id, key);
        // A background shell's folder is not reported by the SDK, so none is claimed.
        this.registry.add(key, task.description, undefined, this.stopTask ? () => this.stopTask!(task.task_id) : undefined);
      }
      for (const key of this.ids.values()) if (!live.has(key)) { if (!this.ended.has(key)) this.registry.finish(key, 'done'); this.ended.add(key); }
    }
    if (event.subtype === 'task_notification' && typeof event.task_id === 'string') {
      const key = this.ids.get(event.task_id);
      if (!key || (typeof event.run_id === 'string' && !key.endsWith(`:${event.run_id}`))) return;
      if (event.status === 'stopped' || event.status === 'completed' || event.status === 'failed') {
        this.registry.finish(key, event.status === 'stopped' ? 'stopped' : event.status === 'failed' ? 'error' : 'done'); this.ended.add(key);
      }
    }
  }
  close(): void { this.registry.unavailable(this.prefix); }
}

/**
 * The place a preview server serves, in words: the whole work folder by its name, a folder inside it,
 * or 작업 폴더 밖. Never "." (Jay 2026-10-29: "폴더: ." told him nothing).
 */
export function previewServedPlace(folder: string, workFolderName: string | undefined): string {
  if (folder === '.') return workFolderName ? `작업 폴더 전체 (${workFolderName})` : '작업 폴더 전체';
  if (folder === '작업 폴더 밖' || folder === '폴더 확인 불가') return folder;
  return `작업 폴더/${folder}`;
}
/** `http://127.0.0.1:43299/` → `127.0.0.1:43299`; anything else is not shown. */
export function previewAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { const u = new URL(url); return /^(?:127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) && u.port ? `${u.hostname}:${u.port}` : undefined; } catch { return undefined; }
}
