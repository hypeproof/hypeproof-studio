/** Shared attempt/version navigation for CGP-CHAT-D64 and D65. Navigation never sends. */
export function AttemptPager({ index, count, onPage, label = `답변 ${index + 1}/${count}`,
  previousLabel = "이전 답변", nextLabel = "다음 답변", title, note }: {
  index: number; count: number; onPage: (index: number) => void;
  label?: string; previousLabel?: string; nextLabel?: string; title?: string; note?: string;
}) {
  return <div className="hps-version-pager" role="group" aria-label={label} data-hp-tooltip={title}>
    <button type="button" disabled={index === 0} onClick={() => onPage(index - 1)} aria-label={previousLabel}>‹</button>
    <span aria-live="polite">{index + 1}/{count}</span>
    <button type="button" disabled={index === count - 1} onClick={() => onPage(index + 1)} aria-label={nextLabel}>›</button>
    {note && <span className="hps-version-note">{note}</span>}
  </div>;
}
