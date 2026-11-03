// Region D's completion line — the SX-14 gate and the SX-55 task flow, as the host decided them.
//
// Moved out of ChatPanel.tsx so it can be rendered and audited on its own: ChatPanel holds
// `learningState` in a hook that a server render never fills, so region D was only ever
// checked by reading its source.
//
// It recomputes nothing (design §정보 구조 "호스트·웹뷰·워커의 경계"). The host judged the
// gate, read the phase from the task's record and sends both down as `learningState`; this
// draws them.

import type { LearningStatePayload } from "../../src/learningStateHelpers";
import { ChatIcon } from "./ChatDetails";

export function CompletionGate(props: { learning: LearningStatePayload; onSubmit: () => void }) {
  const { learning } = props;
  // SX-55 — once submitted, there is nothing left to press. A state line, not a badge and not a
  // celebration (SX-29), with an icon AND words (SX-50).
  const submitted = learning.phase === "submitted" || learning.phase === "reflected";
  return (
    <div className="hp-complete">
      {submitted ? (
        <p className="hp-complete-done" role="status" data-task-phase={learning.phase}>
          <span className="hp-mark"><ChatIcon kind="check-square" size={16} /></span>
          <span>이 과제를 제출했어요</span>
        </p>
      ) : (
        // SX-14 — the reason it is disabled is visible **next to the button**. There is no
        // bypass button. **Not a Primary**: there is one emphasized button on screen and that
        // slot belongs to region A's "지금 할 행동" (SX-01·SX-04). Completion is pressed
        // **after** those actions are done, so it has no reason to catch the eye first.
        <button type="button" className="hp-cta-quiet" data-task-phase={learning.phase} disabled={!learning.complete.ok} onClick={props.onSubmit}>
          이 과제 완료하기
        </button>
      )}
      {!submitted && !learning.complete.ok && learning.complete.reasons.length > 0 && (
        <ul className="hp-complete-why">
          {learning.complete.reasons.map((reason) => (
            <li key={reason}><ChatIcon kind="square" size={16} /> {reason}</li>
          ))}
        </ul>
      )}
      {!learning.declared && <p className="hp-complete-note">이 단계는 따로 정해 둔 완료 조건이 없어요.</p>}
      {learning.notice ? (
        <p className="hp-complete-notice" role="alert">
          {learning.notice}
        </p>
      ) : null}
    </div>
  );
}
