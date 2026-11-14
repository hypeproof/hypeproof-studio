import { ChatIcon } from "./ChatDetails";
import type { LessonTip as Tip } from "./lessonTipModel";
import { LESSON_TIPS_OFF, LESSON_TIPS_RESUME, LESSON_TIPS_STOP } from "../../src/lessonTips";
import "./lessonTip.css";

/**
 * CGP-CHAT-R-021 / CGP-CHAT-D-021 — one lesson tip row above the composer. The text is the
 * served step's hint, rendered as text (never markup). "입력창에 넣기" only prefills; the
 * close button hides the tip for this step.
 */
export function LessonTip(props: { tip: Tip; disabled: boolean; onUse: () => void; onDismiss: () => void; onStopTips?: () => void }) {
  const { tip } = props;
  return (
    <div className="hps-lesson-tip" role="note" aria-label="이 단계 도움말" data-lesson-tip={tip.stepId}>
      <span className="hps-lesson-tip-badge">도움말</span>
      <p className="hps-lesson-tip-text">{tip.text}</p>
      <button type="button" className="hps-lesson-tip-use" disabled={props.disabled} onClick={props.onUse}>입력창에 넣기</button>
      {/* CGP-SHELL-R-019 — a quiet action: every lesson tip stops until the learner turns them on again. */}
      {props.onStopTips && <button type="button" className="hps-lesson-tip-stop" onClick={props.onStopTips}>{LESSON_TIPS_STOP}</button>}
      <button type="button" className="hps-lesson-tip-dismiss" aria-label="이 단계 도움말 닫기" data-hp-tooltip="이 단계에서 닫기" onClick={props.onDismiss}>
        <ChatIcon kind="close" size={20} />
      </button>
    </div>
  );
}

/**
 * CGP-SHELL-R-019 — said once, in the tip's place, right after 팁 그만 보기: tips are off and how to get
 * them back. It stays until the learner presses 다시 켜기 or sends the next message.
 */
export function LessonTipsOffNote(props: { onResume: () => void }) {
  return (
    <div className="hps-lesson-tip hps-lesson-tips-off" role="status">
      <p className="hps-lesson-tip-text">{LESSON_TIPS_OFF}</p>
      <button type="button" className="hps-lesson-tip-use" onClick={props.onResume}>{LESSON_TIPS_RESUME}</button>
    </div>
  );
}
