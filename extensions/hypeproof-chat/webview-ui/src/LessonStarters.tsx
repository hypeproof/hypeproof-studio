// DEC-30 step 3 (CGP-KNOW-R-037 learner side, CGP-KNOW-D-037) — the lesson's starter sentences as wrapping compact
// chips above the composer. A chip is an editable suggestion: it puts its text into the draft (the caller's rule keeps
// a manual draft) and never sends. Plain buttons, so they are keyboard reachable in reading order; 44px targets and
// the 14px caption floor come from tokens (styles.css `.hps-lesson-starters`).

export const LESSON_STARTERS_LABEL = "이 수업의 시작 문장";
export const LESSON_STARTERS_HINT = "누르면 입력창에 들어가요. 고쳐서 보내세요.";

export function LessonStarters({ starters, onPick, disabled }: { starters: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (!starters.length) return null;
  return (
    <div className="hps-lesson-starters" role="group" aria-label={LESSON_STARTERS_LABEL} data-lesson-starters={starters.length}>
      <div className="hps-lesson-starters-hint">{LESSON_STARTERS_HINT}</div>
      <ul className="hps-lesson-starters-list">
        {starters.map((text, i) => (
          <li key={i}>
            <button type="button" className="hps-lesson-starter" disabled={disabled} onClick={() => onPick(text)}>{text}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
