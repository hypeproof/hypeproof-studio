// CGP-ART-R-020 / CGP-ART-D-020 (REQ-STUDIO-TASK-ACTIVITY): the task's "AI가 한 일" row.
// Counts come only from the entries summarizeTaskActivity takes from this task's messages (and the
// live turn): no entry, no chip. Each chip opens its own list; changed files that the current turn
// review covers open that review at the file (REQ-ART-02).

import { useLayoutEffect, useRef, useState } from "react";
import { ChatIcon, type IconKind } from "./ChatDetails";
import {
  TASK_ACTIVITY_HINT, TASK_ACTIVITY_LABEL, TASK_ACTIVITY_VERBS, fitMiddleEllipsis, taskActivityChipText, middleEllipsis, taskActivityTotal,
  type TaskActivitySummary, type TaskActivityVerb,
} from "../../src/taskActivity";
import "./taskActivity.css";

export const TASK_ACTIVITY_LIST_CAP = 20;

const ICON: Record<TaskActivityVerb, IconKind> = { read: "eye", created: "plus", changed: "pencil", web: "globe", search: "search" };

let measureCanvas: HTMLCanvasElement | null = null;

/** One-line test for `el`'s own width and font; null when the element has no layout (e.g. jsdom). */
function lineFits(el: HTMLElement): ((shown: string) => boolean) | null {
  const width = el.clientWidth;
  if (!width) return null;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return null;
  const st = getComputedStyle(el);
  ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
  return (shown) => ctx.measureText(shown).width <= width - 1;
}

/** CGP-ART-D-020: the name is middle-ellipsized to the width it has, refitted on resize; assistive tech reads it whole. */
function TargetName({ target }: { target: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(() => middleEllipsis(target));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setShown(fitMiddleEllipsis(target, lineFits(el)));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  return <span ref={ref} className="hps-task-activity-target" title={target}>
    <span aria-hidden="true">{shown}</span>
    <span className="hps-sr-only">{target}</span>
  </span>;
}

export interface TaskActivityProps {
  summary: TaskActivitySummary;
  /** Paths the open turn review lists (added + changed); only these get 바뀐 곳 보기. */
  reviewPaths: ReadonlySet<string>;
  onShowReview: (path: string) => void;
  /** #3221 part 2 — 'PDF로 저장' for an HTML page the AI made or changed in the work folder. */
  onSavePdf?: (path: string) => void;
}

const HTML_PAGE = /\.html?$/i;

export function TaskActivity({ summary, reviewPaths, onShowReview, onSavePdf }: TaskActivityProps) {
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
    <p className="hps-task-activity-hint" id="hps-task-activity-hint">{TASK_ACTIVITY_HINT}</p>
    <div className="hps-task-activity-chips">
      {verbs.map((v) => <button key={v} type="button" className="hps-task-activity-chip" data-verb={v}
        aria-expanded={shown === v} aria-controls={shown === v ? "hps-task-activity-list" : undefined}
        aria-describedby="hps-task-activity-hint"
        onClick={() => { setOpen(shown === v ? null : v); setAll(null); }}>
        <ChatIcon kind={ICON[v]} size={16} />
        <span>{taskActivityChipText(v, summary[v].length)}</span>
        <span className="hps-task-activity-chevron" aria-hidden="true"><ChatIcon kind={shown === v ? "chevron-up" : "chevron-down"} size={16} /></span>
      </button>)}
    </div>
    {shown && <div className="hps-task-activity-panel">
      <ul id="hps-task-activity-list" className="hps-task-activity-list" aria-label={`${TASK_ACTIVITY_LABEL[shown]} 목록`}>
        {visible.map((it) => <li key={it.target} className="hps-task-activity-item">
          <TargetName target={it.target} />
          {fileVerb && it.inside && reviewPaths.has(it.target) &&
            <button type="button" className="hps-task-activity-review" aria-label={`${it.target} 바뀐 곳 보기`} onClick={() => onShowReview(it.target)}>바뀐 곳 보기</button>}
          {fileVerb && it.inside && onSavePdf && HTML_PAGE.test(it.target) &&
            <button type="button" className="hps-task-activity-pdf" aria-label={`${it.target} PDF로 저장`} onClick={() => onSavePdf(it.target)}>PDF로 저장</button>}
        </li>)}
      </ul>
      {items.length > visible.length && <button type="button" className="hps-task-activity-more" onClick={() => setAll(shown)}>더 보기 ({items.length - visible.length}개)</button>}
      {unreviewable && <p className="hps-task-activity-note">바뀐 곳은 마지막 요청에서 작업 폴더 안에 바뀐 파일만 볼 수 있어요.</p>}
    </div>}
  </section>;
}
