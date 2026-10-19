import type { CarryoverView } from "../../src/trialCarryoverHelpers";

/**
 * REQ-L12 ⑫ exception (ot-conversation-carryover). Drawn only when the host sends a view, which it
 * does only when the Service advertises carry-over on a pass that took over a trial's folder.
 * The offer waits for the learner: nothing is continued without "이어가기".
 * Once accepted, the trial conversation is shown read-only — no retry, edit or send controls.
 */
export function TrialCarryover(props: { view: CarryoverView | null | undefined; busy?: boolean; onDecide: (decision: "confirm" | "decline") => void }) {
  const { view } = props;
  if (!view) return null;
  if (view.status === "offer") {
    return (
      <section className="hps-carryover" aria-label="체험에서 하던 대화 이어가기">
        <p className="hps-carryover-title"><strong>체험에서 하던 대화 이어가기</strong></p>
        <p className="hps-carryover-body">
          「{view.fromName}」에서 나눈 대화를 이어서 할 수 있어요. 이어가면 체험 대화를 읽기 전용으로 보여 주고,
          줄인 내용을 이 대화에 남겨 코치가 읽게 해요. 이어가지 않으면 새 대화로 시작해요. 체험 대화는 그대로 남아요.
        </p>
        <div className="hps-carryover-actions">
          <button type="button" className="hp-cta-primary" disabled={props.busy} onClick={() => props.onDecide("confirm")}>이어가기</button>
          <button type="button" className="hp-cta-quiet" disabled={props.busy} onClick={() => props.onDecide("decline")}>새 대화로 시작하기</button>
        </div>
      </section>
    );
  }
  return (
    <details className="hps-carryover hps-carryover-transcript">
      <summary>「{view.fromName}」 체험 대화 보기 (읽기 전용)</summary>
      <ol className="hps-carryover-list" aria-readonly="true">
        {view.transcript.map((m, i) => (
          <li key={i} className={"hps-carryover-" + m.role}>
            <span className="hps-carryover-who">{m.role === "user" ? "나" : "코치"}</span>
            <span className="hps-carryover-text">{m.content}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
