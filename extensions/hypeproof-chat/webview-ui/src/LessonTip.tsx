import { ChatIcon } from "./ChatDetails";
import type { LessonTip as Tip } from "./lessonTipModel";
import { LESSON_TIPS_OFF, LESSON_TIPS_OFF_SHORT, LESSON_TIPS_RESUME, LESSON_TIPS_SETTING, LESSON_TIPS_SETTING_HINT, LESSON_TIPS_STOP } from "../../src/lessonTips";
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
 * CGP-SHELL-R-019 — in a hinted step's tip place while tips are off, so turning them back on is never out of
 * reach (a lesson seat may have no settings dialog to open). Right after 팁 그만 보기 it is a status line that
 * says what happened (`announce`); afterwards it is one quiet line with no live region, so it is not re-read.
 */
export function LessonTipsOffNote(props: { onResume: () => void; announce: boolean }) {
  return (
    <div className="hps-lesson-tip hps-lesson-tips-off" data-announce={props.announce || undefined} {...(props.announce ? { role: "status" } : { role: "group", "aria-label": LESSON_TIPS_OFF_SHORT })}>
      <p className="hps-lesson-tip-text">{props.announce ? LESSON_TIPS_OFF : LESSON_TIPS_OFF_SHORT}</p>
      <button type="button" className="hps-lesson-tip-use" onClick={props.onResume}>{LESSON_TIPS_RESUME}</button>
    </div>
  );
}

/**
 * CGP-SHELL-R-019 — the lasting 팁 보기 switch in the chat's settings dialog of a lesson seat. Checked = this
 * learner's seat sees tips (config.lessonTips, the host's lessonTipsState()); a change goes to setLessonTips().
 */
export function LessonTipsSetting(props: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <fieldset className="hps-text-size hps-lesson-tips-setting">
      <legend>{LESSON_TIPS_SETTING}</legend>
      <label>
        <input type="checkbox" checked={props.on} onChange={(e) => props.onChange(e.target.checked)} aria-describedby="hps-lesson-tips-setting-hint" />
        <span>{LESSON_TIPS_SETTING}</span>
      </label>
      <p id="hps-lesson-tips-setting-hint" className="hps-lesson-tips-setting-hint">{LESSON_TIPS_SETTING_HINT}</p>
    </fieldset>
  );
}
