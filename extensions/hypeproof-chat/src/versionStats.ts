// CGP-ART-R-013 / CGP-ART-D-013 — per test version: how many participant sessions opened it, and how many finished a
// task, in the last 7 days against the 7 days before. Types and pure rules only, shared by the host (publishSession.ts)
// and the webview (PublishPanel.tsx): no node or vscode imports.
//
// Every count is a reading of the Service's participant sessions (CR-23, recomputed from stored events on each
// evidence read) and keeps the ids it counted, so a tile opens exactly its sources (CR-27). Counts are of sessions,
// never people (CR-72), and no pseudonym or other participant identity is carried here (CR-65).

export const DAY_MS = 86_400_000;
export const WINDOW_MS = 7 * DAY_MS;

/** One participant session as the evidence read returns it; only what the counts and the source list need. */
export interface StatSession { session_id: string; at: number; product_version: string | null; tasks: Record<string, { started: boolean; completed: boolean }>; pages: number; clicks: number }
export interface StatSource { session_id: string; experiment_id: string; at: number; pages: number; clicks: number; completed: boolean }
export interface StatCount { last: number; prev: number; sources: StatSource[] }
export type VersionStats =
  | { state: "ok"; opened: StatCount; completed: StatCount }
  | { state: "empty" }
  /** The evidence of at least one experiment of this version could not be read: no number is shown. */
  | { state: "unknown" }
  /** The counts are still being read; the sharing state is drawn without waiting for them. */
  | { state: "loading" };

const finished = (s: Pick<StatSession, "tasks">) => Object.values(s.tasks ?? {}).some((t) => t?.completed === true);

/**
 * `experiments` are the version's experiments with their sessions (null = that read failed). A session belongs to the
 * version it records, or, when it records none, to its experiment's pinned version. Sessions are counted once by id.
 */
export function versionStats(versionId: string, experiments: Array<{ id: string; product_version_id: string; sessions: StatSession[] | null }>, now: number): VersionStats {
  if (experiments.some((e) => e.sessions === null)) return { state: "unknown" };
  const seen = new Set<string>(), mine: StatSource[] = [];
  for (const e of experiments) for (const s of e.sessions ?? []) {
    if ((s.product_version ?? e.product_version_id) !== versionId || seen.has(s.session_id) || !Number.isFinite(s.at)) continue;
    seen.add(s.session_id);
    mine.push({ session_id: s.session_id, experiment_id: e.id, at: s.at, pages: s.pages, clicks: s.clicks, completed: finished(s) });
  }
  const last = mine.filter((s) => s.at > now - WINDOW_MS && s.at <= now), prev = mine.filter((s) => s.at > now - 2 * WINDOW_MS && s.at <= now - WINDOW_MS);
  if (!last.length && !prev.length) return { state: "empty" };
  const newest = (a: StatSource, b: StatSource) => b.at - a.at || a.session_id.localeCompare(b.session_id);
  const done = (xs: StatSource[]) => xs.filter((s) => s.completed);
  return {
    state: "ok",
    opened: { last: last.length, prev: prev.length, sources: [...last].sort(newest) },
    completed: { last: done(last).length, prev: done(prev).length, sources: done(last).sort(newest) },
  };
}

/** The change against the week before, always in words with an arrow, never by colour alone (DES-ART-13). */
export function changeWords(c: Pick<StatCount, "last" | "prev">): { arrow: "▲" | "▼" | ""; text: string } {
  const d = c.last - c.prev;
  if (d > 0) return { arrow: "▲", text: `지난주보다 +${d}` };
  if (d < 0) return { arrow: "▼", text: `지난주보다 ${d}` };
  return { arrow: "", text: "지난주와 같아요" };
}

export const STATS_EMPTY = "아직 연 사람이 없어요";
export const STATS_UNKNOWN = "횟수를 확인하지 못했어요";
export const STATS_LOADING = "횟수 확인 중";
export const STAT_LABELS = { opened: "열어 본 횟수", completed: "끝까지 한 횟수" } as const;
