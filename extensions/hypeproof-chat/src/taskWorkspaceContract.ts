import type { ActivityDraft } from './activityDraft';
import type { ChatMessage } from './protocol';
import type { TaskAppearance } from './taskAppearance';

/** Persisted task data belongs to the host; this contract is also safe for the webview. */
export interface TaskSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** CGP-KNOW-R-008 — set only in a view; it lives in the appearance sidecar, never in the task file. */
  appearance?: TaskAppearance;
}

/** CGP-CHAT-R-025 — a task listed only in 보관함. */
export interface ArchivedTaskSummary extends TaskSummary { archivedAt: number }

export interface TaskSurfaceSelection { url: string; pinned: boolean }

export interface TaskDocument extends TaskSummary {
  /** Absent on old snapshots: preserve the existing name because its origin is unknown. */
  titleOrigin?: 'default' | 'automatic' | 'manual';
  messages: ChatMessage[];
  draft: ActivityDraft;
  sourceSelection: TaskSurfaceSelection | null;
  importedLegacy: boolean;
}

export type TaskWorkspaceErrorCode = 'corrupt' | 'io' | 'locked' | 'stale' | 'invalid' | 'not_found' | 'not_initialized';
export interface TaskWorkspaceError { code: TaskWorkspaceErrorCode; message: string }

export interface TaskWorkspaceView {
  /** A digest of the host's account/activity scope, never the raw identifier. */
  scope: string;
  revision: number;
  activeTaskId: string | null;
  /** Listed tasks. The open task is always among them, even when it is archived. */
  tasks: TaskSummary[];
  /** CGP-CHAT-R-025 — archived tasks other than the open one, newest archive first. Absent on older views. */
  archived?: ArchivedTaskSummary[];
  sourceSelection: TaskSurfaceSelection | null;
  error?: TaskWorkspaceError;
}

/** A delayed navigation request must not switch away from a newer task/view. */
export interface TaskWorkspaceExpected { taskId: string | null; revision: number }
