// CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT) — "맞아요 / 고쳐야 해요" under a finished answer, and the
// reasons under "고쳐야 해요". Which answers get them and what is stored live in src/answerVerdict.ts;
// this file only draws them. No score, count or colour-only state: every state is a pressed text button.

import { useEffect, useState } from "react";
import {
  REASON_LABELS, VERDICT_LABELS, VERDICT_NOTE_MAX, VERDICT_REASONS,
  type AnswerVerdict, type VerdictReason, type VerdictState,
} from "../../src/answerVerdict";

export const REASONS_LABEL = "고쳐야 할 점";
export const NOTE_LABEL = `더 적을 말 (${VERDICT_NOTE_MAX}자까지, 안 적어도 돼요)`;
export const VERDICT_PRIVACY = "이 선택은 AI에게 보내지 않아요.";

/** The two verdict buttons, placed in the answer's action row. Pressing the pressed one removes it. */
export function VerdictButtons({ state, onChange }: { state?: VerdictState; onChange: (next: VerdictState | null) => void }) {
  const press = (verdict: AnswerVerdict) => onChange(state?.verdict === verdict ? null : { verdict });
  return <>
    {(["right", "fix"] as const).map((verdict) => <button
      key={verdict}
      type="button"
      className={`hps-answer-action hps-verdict hps-verdict-${verdict}`}
      aria-pressed={state?.verdict === verdict}
      title={VERDICT_PRIVACY}
      onClick={() => press(verdict)}
    >
      <span aria-hidden="true">{state?.verdict === verdict ? "✓ " : ""}</span>{VERDICT_LABELS[verdict]}
    </button>)}
  </>;
}

/**
 * Shown only while the answer's verdict is "고쳐야 해요": one optional reason, and under a reason an
 * optional note (saved with 저장, never sent to the model). Pressing the chosen reason clears it.
 */
export function VerdictReasons({ state, onChange }: { state: VerdictState; onChange: (next: VerdictState) => void }) {
  const [note, setNote] = useState(state.note ?? "");
  useEffect(() => { setNote(state.note ?? ""); }, [state.note, state.reason]);
  // A different reason keeps the saved note; clearing the reason clears it (a note belongs under a reason).
  const pick = (reason: VerdictReason) => onChange(state.reason === reason ? { verdict: "fix" } : { verdict: "fix", reason, ...(state.note ? { note: state.note } : {}) });
  const trimmed = note.trim();
  const save = () => { if (state.reason) onChange({ verdict: "fix", reason: state.reason, ...(trimmed ? { note: trimmed } : {}) }); };
  return <div className="hps-verdict-reasons" role="group" aria-label={REASONS_LABEL}>
    <div className="hps-verdict-reason-row">
      {VERDICT_REASONS.map((reason) => <button
        key={reason}
        type="button"
        className="hps-verdict-reason"
        aria-pressed={state.reason === reason}
        onClick={() => pick(reason)}
      >
        <span aria-hidden="true">{state.reason === reason ? "✓ " : ""}</span>{REASON_LABELS[reason]}
      </button>)}
    </div>
    {state.reason && <div className="hps-verdict-note">
      <textarea
        value={note}
        maxLength={VERDICT_NOTE_MAX}
        aria-label={NOTE_LABEL}
        placeholder={NOTE_LABEL}
        onChange={(e) => setNote(e.target.value.slice(0, VERDICT_NOTE_MAX))}
      />
      <div className="hps-verdict-note-actions">
        <span>{note.length}/{VERDICT_NOTE_MAX}</span>
        <button type="button" disabled={trimmed === (state.note ?? "")} onClick={save}>저장</button>
      </div>
    </div>}
    <p className="hps-verdict-privacy">{VERDICT_PRIVACY}</p>
  </div>;
}
