// AE-15 / CGP-ART-R-002 / CGP-AGENT-R-026 (#673) — the review bar for the last coach turn's file changes.
// Drawn only from what the host measured (turnReviewView.ts); it never auto-dismisses: the next turn
// replaces it, or the learner closes it after a decision.

import type { TurnReviewView } from "../../src/turnReviewView";
import { turnReviewCount } from "../../src/turnReviewView";

export interface TurnReviewBarProps {
  view: TurnReviewView;
  onRevert: () => void;
  onKeep: () => void;
  onClose: () => void;
}

const EXTERNAL_NOTE = "웹에 올린 사이트, 브라우저, 명령 실행으로 작업 폴더 밖에서 바뀐 것은 되돌리지 않아요.";

function Group({ title, kind, items }: { title: string; kind: string; items: string[] }) {
  if (!items.length) return null;
  return <div className="hps-turn-review-group" data-kind={kind}>
    <strong>{title} {items.length}개</strong>
    <ul>{items.map((p) => <li key={p}><code>{p}</code></li>)}</ul>
  </div>;
}

function NotCovered({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <p className="hps-turn-review-note" data-testid="turn-review-not-covered">
    너무 크거나 보관할 수 없는 파일은 되돌리지 않아요: {items.join(", ")}
  </p>;
}

function failedTitle(view: TurnReviewView): string {
  if (view.failed?.length) return "일부 파일을 되돌리지 못했어요";
  if (view.tooLarge) return "작업 폴더에 파일이 너무 많아서 되돌리지 못했어요";
  if (!view.beforeRestoreKept && view.nothingChanged) return "지금 상태를 먼저 보관하지 못해서 되돌리지 않았어요";
  return "되돌리지 못했어요";
}

export function TurnReviewBar({ view, onRevert, onKeep, onClose }: TurnReviewBarProps) {
  const n = turnReviewCount(view);
  if (view.state === "restored") {
    return <section className="hps-turn-review" data-testid="turn-review" data-state="restored" role="status" aria-live="polite">
      <p className="hps-turn-review-title">이번 요청 전으로 되돌렸어요. 파일 {view.restoredCount ?? 0}개가 그대로 돌아온 것을 확인했어요.</p>
      {view.beforeRestoreKept && <p className="hps-turn-review-note">되돌리기 직전 상태도 따로 보관해 뒀어요.</p>}
      <NotCovered items={view.notCovered} />
      <p className="hps-turn-review-note">{EXTERNAL_NOTE}</p>
      <div className="hps-turn-review-actions"><button type="button" onClick={onClose}>확인</button></div>
    </section>;
  }
  if (view.state === "failed") {
    return <section className="hps-turn-review" data-testid="turn-review" data-state="failed" role="alert">
      {/* Each line states one measured fact: what failed, whether any file changed, whether 복구 직전 was kept. */}
      <p className="hps-turn-review-title">{failedTitle(view)}</p>
      {!!view.failed?.length && <ul className="hps-turn-review-failed">{view.failed.map((p) => <li key={p}><code>{p}</code></li>)}</ul>}
      {view.nothingChanged && <p className="hps-turn-review-note">작업 폴더의 파일은 하나도 바꾸지 않았어요.</p>}
      {view.beforeRestoreKept && <p className="hps-turn-review-note">되돌리기 직전 상태는 따로 보관해 뒀어요.</p>}
      <NotCovered items={view.notCovered} />
      <p className="hps-turn-review-note">{EXTERNAL_NOTE}</p>
      <div className="hps-turn-review-actions"><button type="button" onClick={onClose}>확인</button></div>
    </section>;
  }
  const busy = view.state === "restoring";
  return <section className="hps-turn-review" data-testid="turn-review" data-state={view.state} aria-label="이번에 바뀐 파일">
    <p className="hps-turn-review-title">AI가 이번에 바꾼 파일 {n}개</p>
    <details>
      <summary>바뀐 파일 보기</summary>
      <Group title="새로 만듦" kind="added" items={view.added} />
      <Group title="바뀜" kind="changed" items={view.changed} />
      <Group title="지움" kind="deleted" items={view.deleted} />
    </details>
    <p className="hps-turn-review-note">AI가 일하는 동안 내가 직접 고친 파일도 함께 셌어요.</p>
    <NotCovered items={view.notCovered} />
    <p className="hps-turn-review-note">되돌리면 이번 요청 전 상태로 돌아가요. 지금 상태도 따로 보관해 둬요. {EXTERNAL_NOTE}</p>
    {view.notice && <p className="hps-turn-review-note" role="status">{view.notice}</p>}
    <div className="hps-turn-review-actions">
      <button type="button" onClick={onRevert} disabled={busy}>{busy ? "되돌리는 중…" : "되돌리기"}</button>
      <button type="button" onClick={onKeep} disabled={busy}>이대로 둘게요</button>
    </div>
  </section>;
}
