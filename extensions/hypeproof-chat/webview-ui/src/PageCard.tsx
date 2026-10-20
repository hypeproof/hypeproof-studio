// REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — one card under the coach turn that built or changed pages
// in the work folder. Drawn only from what the host measured (pageCardHost.ts): up to 3 rows plus
// "외 N개", each with 열기 (Studio preview) and 폴더에서 보기 (revealFileInOS). The host re-checks every press.

import { pageCardRows, PAGE_CARD_COPY, type PageCardView } from "../../src/pageCard";

export interface PageCardProps {
  view: PageCardView;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}

export function PageCard({ view, onOpen, onReveal }: PageCardProps) {
  const { rows, more } = pageCardRows(view);
  return (
    <div className="hps-page-card" role="group" aria-label={PAGE_CARD_COPY.title} data-testid="page-card">
      <p className="hps-page-card-title">{PAGE_CARD_COPY.title}</p>
      <ul>
        {rows.map((page) => (
          <li key={page.path} className="hps-page-card-row" data-kind={page.kind}>
            <span className="hps-page-card-name">
              <code>{page.path}</code>
              <span className="hps-page-card-kind">{page.kind === "added" ? PAGE_CARD_COPY.added : PAGE_CARD_COPY.changed}</span>
            </span>
            <span className="hps-page-card-actions">
              <button type="button" aria-label={`${page.path} ${PAGE_CARD_COPY.open}`} onClick={() => onOpen(page.path)}>{PAGE_CARD_COPY.open}</button>
              <button type="button" aria-label={`${page.path} ${PAGE_CARD_COPY.reveal}`} onClick={() => onReveal(page.path)}>{PAGE_CARD_COPY.reveal}</button>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="hps-page-card-more">{PAGE_CARD_COPY.more(more)}</p>}
      {view.notice && <p className="hps-page-card-notice" role="status">{view.notice}</p>}
    </div>
  );
}
