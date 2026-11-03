/** Task-bound notice lifecycle. No prompt, command, URL or answer enters a notice. */
import { createHash, randomUUID } from 'node:crypto';
import { finishNoticeApplies, finishNoticeKind, type FinishInput } from './finishNotice.ts';
export type TaskNoticeKind = 'done' | 'error' | 'approval' | 'browserApproval';
export type TaskNoticeInput = FinishInput & { scope: string };
export interface TaskNoticePorts {
 show(request: {id: string; task: string; kind: TaskNoticeKind}): PromiseLike<{clicked: boolean}>;
 hide(id: string): void;
 reveal(scope: string): PromiseLike<void> | void;
}
export class TaskNotifier {
 private recent = new Map<string, number>();
 private pending = new Map<string, {scope: string}>();
 private readonly ports: TaskNoticePorts;
 private readonly now: () => number;
 constructor(ports: TaskNoticePorts, now: () => number = Date.now) { this.ports = ports; this.now = now; }
 release(): void { for (const id of [...this.pending.keys()]) this.cancel(id); }
 private cancel(id: string): void {
  if (!this.pending.delete(id)) return;
  try { this.ports.hide(id); } catch { /* A disappearing shell must not fail a turn. */ }
 }
 private show(scope: string, kind: TaskNoticeKind): (() => void) | null {
  if (!scope) return null;
  const now = this.now(), task = createHash('sha256').update(scope).digest('hex');
  for (const [key, at] of this.recent) if (now - at >= 10_000) this.recent.delete(key);
  if (this.recent.has(task)) return null;
  // Only one foreground card; replacing it does not reset any task's cooldown.
  this.release();
  this.recent.set(task, now);
  const id = randomUUID(); this.pending.set(id, {scope});
  try {
   Promise.resolve(this.ports.show({id, task, kind})).then(async result => {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id);
    if (result?.clicked === true) await this.ports.reveal(pending.scope);
   }).catch(() => { this.pending.delete(id); });
  } catch { this.pending.delete(id); }
  return () => this.cancel(id);
 }
 turnEnded(input: TaskNoticeInput): 'done' | 'error' | null {
  const kind = finishNoticeKind(input);
  return kind && this.show(input.scope, kind) ? kind : null;
 }
 approvalStarted(input: Omit<TaskNoticeInput, 'status'>, browser = false): () => void {
  if (input.chatVisible || !finishNoticeApplies(input.seat, input.instructor)) return () => {};
  return this.show(input.scope, browser ? 'browserApproval' : 'approval') ?? (() => {});
 }
}
