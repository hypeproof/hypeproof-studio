// CGP-ART-R-020 (REQ-STUDIO-TASK-ACTIVITY) — host side of the "AI가 한 일" roll-up. One recorder per
// running turn, bound at turn start to the task, activity and work folder it began in; every runtime
// (agent SDK, local runtimes, the proxy browser loop) reports its tool events through `note`.
// Node only (fs/path); the webview imports taskActivity.ts, never this file.

import * as fs from "node:fs";
import * as path from "node:path";
import { TaskActivityRecorder, withTaskActivity, type ActivityFileProbe, type TaskActivityFact } from "./taskActivity.ts";

/** Resolve paths like the kernel: symlinks followed (the folder's too), `..` applied after resolution. */
export function workFolderProbe(cwd: string | undefined | null): ActivityFileProbe {
  let root: string | null = null;
  try { root = cwd ? fs.realpathSync(cwd) : null; } catch { root = null; }
  const base = cwd ?? root ?? path.parse(process.cwd()).root;
  const resolveReal = (file: string): string => {
    // The deepest existing ancestor is resolved (links followed); the parts that do not exist yet are appended.
    let at = path.resolve(base, file);
    const rest: string[] = [];
    for (;;) {
      try { return path.join(fs.realpathSync(at), ...rest.reverse()); } catch { /* walk up */ }
      const up = path.dirname(at);
      if (up === at) return path.resolve(base, file);
      rest.push(path.basename(at));
      at = up;
    }
  };
  return {
    relative: (file) => {
      if (!root) return null;
      const rel = path.relative(root, resolveReal(file));
      return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : null;
    },
    exists: (file) => { try { fs.lstatSync(path.resolve(base, file)); return true; } catch { return false; } },
  };
}

export type TaskActivityEvent =
  | { kind: "use"; id: string; name: string; input: unknown }
  | { kind: "deny"; id: string }
  | { kind: "result"; id: string; isError: boolean };

export interface TaskActivityFactMessage {
  type: "taskActivityFact"; streamId: string; fact: TaskActivityFact; activityId?: string; taskId?: string;
}

interface Turn { recorder: TaskActivityRecorder; signal: AbortSignal; activityId?: string; taskId?: string }

export class TaskActivityTurns {
  private readonly turns = new Map<string, Turn>();

  begin(streamId: string, args: { signal: AbortSignal; cwd?: string | null; activityId?: string; taskId?: string; probe?: ActivityFileProbe }): void {
    this.turns.set(streamId, {
      recorder: new TaskActivityRecorder(args.probe ?? workFolderProbe(args.cwd)),
      signal: args.signal,
      ...(args.activityId ? { activityId: args.activityId } : {}),
      ...(args.taskId ? { taskId: args.taskId } : {}),
    });
  }

  /**
   * One tool event. Returns the message to post when it made an entry (a successful result only).
   * After a stop the turn's saved record is already frozen, so a late result is not shown either.
   */
  note(streamId: string, event: TaskActivityEvent): TaskActivityFactMessage | null {
    const turn = this.turns.get(streamId);
    if (!turn || turn.signal.aborted) return null;
    if (event.kind === "use") { turn.recorder.use(event.id, event.name, event.input); return null; }
    if (event.kind === "deny") { turn.recorder.deny(event.id); return null; }
    const fact = turn.recorder.result(event.id, event.isError);
    return fact ? { type: "taskActivityFact", streamId, fact, ...(turn.activityId ? { activityId: turn.activityId } : {}), ...(turn.taskId ? { taskId: turn.taskId } : {}) } : null;
  }

  /** The turn's history lines with its entries on the last one (see withTaskActivity). */
  attach<M extends { id: string; role: string; content: string; createdAt: number; activity?: TaskActivityFact[] }>(streamId: string, items: M[], messageId: string): M[] {
    return withTaskActivity(items, this.turns.get(streamId)?.recorder.facts ?? [], messageId);
  }

  end(streamId: string): void { this.turns.delete(streamId); }
}
