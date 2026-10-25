// CGP-ART-R-020 / CGP-ART-D-020 (REQ-STUDIO-TASK-ACTIVITY): the task's "AI가 한 일" row.
// Counts come only from the entries summarizeTaskActivity takes from this task's messages (and the
// live turn): no entry, no chip. Each chip opens its own list; changed files that the current turn
// review covers open that review at the file (REQ-ART-02).

import { useState } from "react";
import { ChatIcon, type IconKind } from "./ChatDetails";
import {
  TASK_ACTIVITY_LABEL, TASK_ACTIVITY_VERBS, middleEllipsis, taskActivityTotal,
  type TaskActivitySummary, type TaskActivityVerb,
} from "../../src/taskActivity";
import "./taskActivity.css";

export const TASK_ACTIVITY_LIST_CAP = 20;

const ICON: Record<TaskActivityVerb, IconKind> = { read: "eye", created: "plus", changed: "pencil", web: "globe", search: "search" };

export interface TaskActivityProps {
  summary: TaskActivitySummary;
  /** Paths the open turn review lists (added + changed); only these get 바뀐 곳 보기. */
  reviewPaths: ReadonlySet<string>;
  onShowReview: (path: string) => void;
}

export function TaskActivity({ summary, reviewPaths, onShowReview }: TaskActivityProps) {
  const [open, setOpen] = useState<TaskActivityVerb | null>(null);
  const [all, setAll] = useState<TaskActivityVerb | null>(null);
  if (taskActivityTotal(summary) === 0) return null;
  const verbs = TASK_ACTIVITY_VERBS.filter((v) => summary[v].length > 0);
  const shown = open && summary[open].length > 0 ? open : null;
  const items = shown ? summary[shown] : [];
  const visible = shown && all === shown ? items : items.slice(0, TASK_ACTIVITY_LIST_CAP);
  const fileVerb = shown === "created" || shown === "changed";
  const unreviewable = fileVerb && items.some((it) => !(it.inside && reviewPaths.has(it.target)));
  return <section className="hps-task-activity" data-testid="task-activity" aria-labelledby="hps-task-activity-title">
    <p className="hps-task-activity-title" id="hps-task-activity-title">AI가 한 일</p>
    <div className="hps-task-activity-chips">
      {verbs.map((v) => <button key={v} type="button" className="hps-task-activity-chip" data-verb={v}
        aria-expanded={shown === v} aria-controls={shown === v ? "hps-task-activity-list" : undefined}
        onClick={() => { setOpen(shown === v ? null : v); setAll(null); }}>
        <ChatIcon kind={ICON[v]} size={16} />
        <span>{TASK_ACTIVITY_LABEL[v]} {summary[v].length}</span>
      </button>)}
    </div>
    {shown && <div className="hps-task-activity-panel">
      <ul id="hps-task-activity-list" className="hps-task-activity-list" aria-label={`${TASK_ACTIVITY_LABEL[shown]} 목록`}>
        {visible.map((it) => <li key={it.target} className="hps-task-activity-item">
          <span className="hps-task-activity-target" title={it.target}>
            <span aria-hidden="true">{middleEllipsis(it.target)}</span>
            <span className="hps-sr-only">{it.target}</span>
          </span>
          {fileVerb && it.inside && reviewPaths.has(it.target) &&
            <button type="button" className="hps-task-activity-review" aria-label={`${it.target} 바뀐 곳 보기`} onClick={() => onShowReview(it.target)}>바뀐 곳 보기</button>}
        </li>)}
      </ul>
      {items.length > visible.length && <button type="button" className="hps-task-activity-more" onClick={() => setAll(shown)}>더 보기 ({items.length - visible.length}개)</button>}
      {unreviewable && <p className="hps-task-activity-note">바뀐 곳은 마지막 요청에서 작업 폴더 안에 바뀐 파일만 볼 수 있어요.</p>}
    </div>}
  </section>;
}
