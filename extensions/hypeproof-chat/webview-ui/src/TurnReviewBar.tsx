// AE-15 / CGP-ART-R-002 / CGP-AGENT-R-026 (#673) — the review bar for the last coach turn's file changes.
// Drawn only from what the host measured (turnReviewView.ts); it never auto-dismisses: the next turn
// replaces it, or the learner closes it after a decision.

import { useEffect, useRef, useState } from "react";
import type { TurnReviewView, TurnFileReview } from "../../src/turnReviewView";
import { DiffLines } from "./DiffLines";
import { turnReviewCount } from "../../src/turnReviewView";

export interface TurnReviewBarProps {
  view: TurnReviewView;
  onRevert: (path?: string) => void;
  onKeep: () => void;
  onClose: () => void;
}

const EXTERNAL_NOTE = "웹에 올린 사이트, 브라우저, 명령 실행으로 작업 폴더 밖에서 바뀐 것은 되돌리지 않아요.";

function displayPath(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function FileReview({ file, busy, onRevert }: { file: TurnFileReview; busy: boolean; onRevert: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const rows = (side?: "before" | "after") => file.lines && <DiffLines lines={file.lines} side={side} />;
  return <li className="hps-turn-file">
    <code>{displayPath(file.path)}</code>
    <p>{file.lines ? `+${file.added}줄 추가 · −${file.removed}줄 삭제` : file.unavailable ?? "줄 수와 비교를 확인할 수 없어요."}</p>
    <div className="hps-turn-review-actions">
      {file.lines && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "전후 비교 접기" : "전후 비교 보기"}</button>}
      <button type="button" disabled={busy} aria-label={`${displayPath(file.path)} 되돌리기`} onClick={() => onRevert(file.path)}>이 파일 되돌리기</button>
    </div>
    {expanded && <div className="hps-turn-diff" aria-label={`${displayPath(file.path)} 전후 비교`}>
      <div className="hps-turn-unified"><strong>− 이전 · + 이후</strong>{rows()}</div>
      <div className="hps-turn-split"><div><strong>이전</strong>{rows("before")}</div><div><strong>이후</strong>{rows("after")}</div></div>
    </div>}
  </li>;
}

function Group({ title, kind, items, files, busy, onRevert }: { title: string; kind: string; items: string[]; files?: TurnFileReview[]; busy: boolean; onRevert: (path: string) => void }) {
  if (!items.length) return null;
  return <div className="hps-turn-review-group" data-kind={kind}>
    <strong>{title} {items.length}개</strong>
    <ul>{items.map(p => <FileReview key={p} file={files?.find(f => f.path === p) ?? { path: p }} busy={busy} onRevert={onRevert} />)}</ul>
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
  const sectionRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const abandon = (event: Event) => {
      if (event.target instanceof Node && !sectionRef.current?.contains(event.target)) {
        pendingFocus.current = null;
      }
    };
    document.addEventListener("focusin", abandon);
    document.addEventListener("pointerdown", abandon);
    return () => {
      document.removeEventListener("focusin", abandon);
      document.removeEventListener("pointerdown", abandon);
    };
  }, []);
  useEffect(() => {
    if (pendingFocus.current !== view.turnId) {
      pendingFocus.current = null;
      return;
    }
    if (view.state !== "restored" && view.state !== "failed" && view.state !== "open") return;
    pendingFocus.current = null;
    // Only continue the user's own keyboard path; unrelated results never take focus.
    if (document.activeElement === document.body || sectionRef.current?.contains(document.activeElement)) {
      confirmRef.current?.focus();
    }
  }, [view.turnId, view.state, view.added, view.changed, view.deleted]);
  const n = turnReviewCount(view);
  if (view.state === "restored") {
    return <section ref={sectionRef} className="hps-turn-review" data-testid="turn-review" data-state="restored" role="status" aria-live="polite">
      <p className="hps-turn-review-title">이번 요청 전으로 되돌렸어요. 파일 {view.restoredCount ?? 0}개가 그대로 돌아온 것을 확인했어요.</p>
      {view.beforeRestoreKept && <p className="hps-turn-review-note">되돌리기 직전 상태도 따로 보관해 뒀어요.</p>}
      <NotCovered items={view.notCovered} />
      <p className="hps-turn-review-note">{EXTERNAL_NOTE}</p>
      <div className="hps-turn-review-actions"><button ref={confirmRef} type="button" onClick={onClose}>확인</button></div>
    </section>;
  }
  if (view.state === "failed") {
    return <section ref={sectionRef} className="hps-turn-review" data-testid="turn-review" data-state="failed" role="alert">
      {/* Each line states one measured fact: what failed, whether any file changed, whether 복구 직전 was kept. */}
      <p className="hps-turn-review-title">{failedTitle(view)}</p>
      {!!view.failed?.length && <ul className="hps-turn-review-failed">{view.failed.map((p) => <li key={p}><code>{p}</code></li>)}</ul>}
      {view.nothingChanged && <p className="hps-turn-review-note">작업 폴더의 파일은 하나도 바꾸지 않았어요.</p>}
      {view.beforeRestoreKept && <p className="hps-turn-review-note">되돌리기 직전 상태는 따로 보관해 뒀어요.</p>}
      <NotCovered items={view.notCovered} />
      <p className="hps-turn-review-note">{EXTERNAL_NOTE}</p>
      <div className="hps-turn-review-actions"><button ref={confirmRef} type="button" onClick={onClose}>확인</button></div>
    </section>;
  }
  const busy = view.state === "restoring";
  return <section ref={sectionRef} className="hps-turn-review" data-testid="turn-review" data-state={view.state} aria-label="바뀐 것 · 이번 요청">
    <p className="hps-turn-review-title">이번 요청 동안 바뀐 파일 {n}개</p>
    <details key={view.turnId}>
      <summary>바뀐 파일 보기</summary>
      <Group title="새로 만듦" kind="added" items={view.added} files={view.files} busy={busy} onRevert={(path) => { pendingFocus.current = view.turnId; onRevert(path); }} />
      <Group title="바뀜" kind="changed" items={view.changed} files={view.files} busy={busy} onRevert={(path) => { pendingFocus.current = view.turnId; onRevert(path); }} />
      <Group title="지움" kind="deleted" items={view.deleted} files={view.files} busy={busy} onRevert={(path) => { pendingFocus.current = view.turnId; onRevert(path); }} />
    </details>
    <p className="hps-turn-review-note">AI가 일하는 동안 내가 직접 고친 파일도 함께 셌어요.</p>
    <NotCovered items={view.notCovered} />
    <p className="hps-turn-review-note">되돌리면 이번 요청 전 상태로 돌아가요. 지금 상태도 따로 보관해 둬요. {EXTERNAL_NOTE}</p>
    {view.notice && <p className="hps-turn-review-note" role="status">{view.notice}</p>}
    <div className="hps-turn-review-actions">
      <button ref={confirmRef} type="button" onClick={(event) => {
        pendingFocus.current = document.activeElement === event.currentTarget ? view.turnId : null;
        onRevert();
      }} disabled={busy}>{busy ? "되돌리는 중…" : "모두 되돌리기"}</button>
      <button type="button" onClick={onKeep} disabled={busy}>이대로 둘게요</button>
    </div>
  </section>;
}
