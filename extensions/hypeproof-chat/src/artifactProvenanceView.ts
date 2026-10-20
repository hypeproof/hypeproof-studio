// REQ-STUDIO-ARTIFACT-PROVENANCE — the provenance list as the webview receives it. Pure and
// dependency-free, so both the host (artifactProvenance.ts) and the webview import it.

export type ProvenanceEventKind = "ai_created" | "ai_changed" | "studio_created" | "studio_changed" | "learner_uploaded" | "unknown" | "removed";
/** The labels a learner sees. */
export type ProvenanceLabelKind = Exclude<ProvenanceEventKind, "removed"> | "none";

/** Text plus a shape symbol per label; the text alone carries the meaning, never the colour. */
export const PROVENANCE_LABELS: Record<ProvenanceLabelKind, { label: string; symbol: string }> = {
  ai_created: { label: "AI가 만듦", symbol: "✦" },
  ai_changed: { label: "AI가 고침", symbol: "↻" },
  studio_created: { label: "Studio가 만듦", symbol: "▣" },
  studio_changed: { label: "Studio가 고침", symbol: "▤" },
  learner_uploaded: { label: "내가 올림", symbol: "⇡" },
  unknown: { label: "기록 없음", symbol: "○" },
  none: { label: "기록 없음", symbol: "○" },
};

export interface ArtifactProvenanceEntry {
  path: string;
  kind: ProvenanceLabelKind;
  label: string;
  symbol: string;
  /** Labels oldest to newest, consecutive repeats folded, at most PROVENANCE_HISTORY_STEPS; empty for 기록 없음 without events. */
  history: string[];
  /** Time of the latest event, absent when none. */
  at?: number;
}

export interface ArtifactProvenanceView {
  entries: ArtifactProvenanceEntry[];
  /** Files not listed because of PROVENANCE_VIEW_CAP. */
  more: number;
  /** Nothing has been observed in this folder yet. */
  unobserved: boolean;
  /** The last window was not measured (folder over the scan cap, a new session, a pull): every entry reads 기록 없음. */
  unconfirmed: boolean;
}

/** "AI가 만듦 → Studio가 고침"; empty when there is only one step. */
export function provenanceHistoryText(entry: Pick<ArtifactProvenanceEntry, "history">): string {
  return entry.history.length > 1 ? entry.history.join(" → ") : "";
}
