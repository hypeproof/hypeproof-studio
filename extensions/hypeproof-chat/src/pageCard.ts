// REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — the card under a coach turn that built or changed a page
// in the work folder. Shared by host and webview: no imports, so the webview can take it without
// pulling Node modules. The host decides which rows exist (pageCardHost.ts); this file only says
// what a page path is and how many rows are drawn.

export type PageCardKind = "added" | "changed";

export interface PageCardPresentation {
  versionId: string;
  title: string;
  status: 'verified' | 'unchecked' | 'previous';
  thumbnail: {state:'loading'} | {state:'failed'} | {state:'ready';dataUrl:string};
}

export interface PageCardPage {
  /** Work-folder-relative path with "/" separators, as the turn-end scan reports it. */
  path: string;
  kind: PageCardKind;
  presentation?: PageCardPresentation;
}

export interface PageCardView {
  /** The coach turn (stream id) whose folder diff produced the card. */
  turnId: string;
  /** The last transcript item of that turn; the card is drawn right after it. */
  anchorId: string;
  pages: PageCardPage[];
  /** A one-line refusal for the last press (the page moved, became a link, left the folder). */
  notice?: string;
}

export const PAGE_CARD_MAX_ROWS = 3;

export const PAGE_CARD_COPY = {
  // Neutral on purpose: the turn diff also counts Studio's own writes (실행) and the learner's edits during the turn,
  // and provenance (artifactProvenance.ts) labels learner edits inside a turn as the AI's, so it cannot clear a row as AI.
  title: "이번 답에서 바뀐 페이지",
  added: "새로 만듦",
  changed: "바뀜",
  open: "열기",
  reveal: "폴더에서 보기",
  more: (n: number) => `외 ${n}개`,
  refused: "이 페이지를 열 수 없어요. 작업 폴더 안에 그대로 있는지 확인해 주세요.",
} as const;

/** A work-folder-relative .html/.htm path: no climb, no absolute or drive path, no hidden segment. */
export function isPagePath(rel: string): boolean {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) return false;
  return /\.html?$/i.test(rel);
}

/** Page candidates from a turn's folder diff, added before changed, each path once. Deleted pages have nothing to open. */
export function pageCandidates(changes: { added: readonly string[]; changed: readonly string[] }): PageCardPage[] {
  const seen = new Set<string>();
  const out: PageCardPage[] = [];
  for (const [kind, list] of [["added", changes.added], ["changed", changes.changed]] as const) {
    for (const p of list) {
      if (seen.has(p) || !isPagePath(p)) continue;
      seen.add(p);
      out.push({ path: p, kind });
    }
  }
  return out;
}

/** The rows drawn (at most PAGE_CARD_MAX_ROWS) and how many more pages the "외 N개" line counts. */
export function pageCardRows(view: Pick<PageCardView, "pages">): { rows: PageCardPage[]; more: number } {
  return { rows: view.pages.slice(0, PAGE_CARD_MAX_ROWS), more: Math.max(0, view.pages.length - PAGE_CARD_MAX_ROWS) };
}
