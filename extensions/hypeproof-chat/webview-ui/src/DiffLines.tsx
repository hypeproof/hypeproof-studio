import type { TurnFileReview } from "../../src/turnReviewView";

/** CGP-DS-R-029: literal markers and deletion semantics survive grayscale and forced colors. */
export function DiffLines({ lines, side }: { lines: NonNullable<TurnFileReview["lines"]>; side?: "before" | "after" }) {
  return <>{lines.filter(line => side === "before" ? line.kind !== "added" : side === "after" ? line.kind !== "removed" : true).map((line, i) =>
    <span key={i} className="hps-turn-diff-line" data-kind={line.kind}>
      <span className="hps-diff-marker" role={line.kind === "same" ? undefined : "img"} aria-label={line.kind === "added" ? "추가" : line.kind === "removed" ? "삭제" : undefined} aria-hidden={line.kind === "same" ? true : undefined}>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
      <code>{line.kind === "removed" ? <del>{line.text}</del> : line.text}</code>
    </span>)}</>;
}
