// CGP-ART-R-013 / CGP-ART-D-013 — two stat tiles under one test version in the publish panel: sessions that opened it and
// sessions that finished a task, last 7 days, with the change against the 7 days before in words. Each tile opens the
// sessions it counted (CR-27); each source row opens that experiment's evidence. Styles are in styles.css (no CSS import:
// the classroom e2e bundles webview components with esbuild and reads styles.css itself).
//
// Nothing here identifies a participant: a source row shows when it opened, how many screens and presses, and whether a
// task was finished, never a pseudonym (CR-65). The numbers are counts of sessions, not people (CR-72).
import { useId, useState } from "react";
import { STAT_LABELS, STATS_EMPTY, STATS_LOADING, STATS_UNKNOWN, changeWords, type StatCount, type VersionStats } from "../../src/versionStats";

const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Tile(props: { kind: "opened" | "completed"; count: StatCount; open: boolean; onToggle(): void; listId: string }) {
  const change = changeWords(props.count), label = STAT_LABELS[props.kind];
  return (
    <button type="button" className="hps-stat-tile" data-testid={`stat-${props.kind}`} aria-expanded={props.open} aria-controls={props.listId} onClick={props.onToggle}
      aria-label={`${label} 지난 7일 ${props.count.last}번 · ${change.text} · 세션 보기`}>
      <span className="hps-stat-label">{label} · 지난 7일</span>
      <span className="hps-stat-value" data-testid={`stat-${props.kind}-value`}>{props.count.last}</span>
      <span className="hps-stat-change" data-testid={`stat-${props.kind}-change`}>{change.arrow && <span aria-hidden="true">{change.arrow} </span>}{change.text}</span>
    </button>
  );
}

export function VersionStatsTiles(props: { stats: VersionStats | undefined; onOpenEvidence?(experimentId: string): void }) {
  const [open, setOpen] = useState<"opened" | "completed" | null>(null);
  const listId = useId();
  const s = props.stats;
  if (!s) return null;
  if (s.state === "empty") return <p className="hps-stat-empty" data-testid="stat-empty">{STATS_EMPTY}</p>;
  if (s.state === "unknown") return <p className="hps-stat-empty" data-testid="stat-unknown">{STATS_UNKNOWN}</p>;
  // Quiet on purpose: no live region, so the count arriving a moment later is not announced as a change.
  if (s.state === "loading") return <p className="hps-stat-empty" data-testid="stat-loading">{STATS_LOADING}</p>;
  const shown = open ? s[open] : null;
  return (
    <div className="hps-stats" data-testid="version-stats">
      <div className="hps-stat-tiles">
        <Tile kind="opened" count={s.opened} open={open === "opened"} listId={listId} onToggle={() => setOpen(open === "opened" ? null : "opened")} />
        <Tile kind="completed" count={s.completed} open={open === "completed"} listId={listId} onToggle={() => setOpen(open === "completed" ? null : "completed")} />
      </div>
      <div id={listId} hidden={!shown}>
        {shown && (shown.sources.length
          ? <ul className="hps-stat-sources" aria-label={`${STAT_LABELS[open!]} · 지난 7일 세션`} data-testid="stat-sources">
              {shown.sources.map((x) => (
                <li key={x.session_id} data-session={x.session_id}>
                  <span>참가 세션 {x.session_id.slice(3, 9)} · {when(x.at)} · 화면 {x.pages} · 누름 {x.clicks}{x.completed ? " · 끝까지 함" : ""}</span>
                  {props.onOpenEvidence && <button type="button" onClick={() => props.onOpenEvidence!(x.experiment_id)}>실험 기록에서 보기</button>}
                </li>
              ))}
            </ul>
          : <p className="hps-stat-empty" data-testid="stat-sources-none">지난 7일에는 없어요.</p>)}
      </div>
    </div>
  );
}
