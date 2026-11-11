// CGP-SHELL-R-024 / CGP-SHELL-D-023 (ADM-11) — the instructor changed this classroom seat's lesson settings. A system
// line in the chat stream (Panel background, no avatar), never a modal or a toast, and never a control: the composer
// stays as it is. It is announced once by role="status" while unseen; once the panel reported it on screen, the same
// line is drawn without a live region so a remount does not read it out again.
import { useEffect } from "react";
import { ChatIcon } from "./ChatDetails";
import { postToHost } from "./vscode";
import { LESSON_SETTINGS_CHANGE_COPY, type LessonSettingsNotice } from "../../src/lessonSettingsChange";
import "./lessonSettingsChange.css";

/** Tell the host the line was on screen. A hidden webview (collapsed panel) waits until it is shown. */
function useReportSeen(id: string, seen: boolean): void {
  useEffect(() => {
    if (seen || typeof document === "undefined") return;
    const visible = () => document.visibilityState !== "hidden";
    if (visible()) { postToHost({ type: "lessonSettingsChangeSeen", id }); return; }
    const onChange = () => {
      if (!visible()) return;
      document.removeEventListener("visibilitychange", onChange);
      postToHost({ type: "lessonSettingsChangeSeen", id });
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [id, seen]);
}

export function LessonSettingsChangeLine({ notice }: { notice: LessonSettingsNotice }) {
  useReportSeen(notice.id, notice.seen);
  const C = LESSON_SETTINGS_CHANGE_COPY;
  return <div className="hps-lesson-change" data-testid="lesson-settings-change" data-lesson-change={notice.id}
    {...(notice.seen ? {} : { role: "status", "aria-live": "polite" as const })}>
    <span className="hps-lesson-change-icon" aria-hidden="true"><ChatIcon kind="info" size={16} /></span>
    <p className="hps-lesson-change-text">{C.title}: {notice.items.map((item, i) => <span key={item.key} data-change-item={item.key}>
      {i > 0 && C.separator}{item.before !== undefined && item.after !== undefined ? `${item.label} ${item.before} → ${item.after}` : `${item.label} ${C.changed}`}
    </span>)}</p>
  </div>;
}
