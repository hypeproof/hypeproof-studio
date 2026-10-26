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
  /** Recorded AI creation in this file lifetime, never the latest modification time. */
  createdAt?: number;
  /** CGP-KNOW-D-016 — how the current file lifetime began and what left the current bytes, for the info popover. */
  origin?: ProvenanceStep;
  last?: ProvenanceStep;
}

/** CGP-KNOW-D-016 — the coach turn behind an AI event: the task it ran in and the turn's first transcript row. */
export interface ProvenanceTurnRef { taskId: string; messageId: string }
/** One recorded event as the info popover needs it; `turn` only for AI events recorded with their task and row. */
export interface ProvenanceStep { kind: ProvenanceLabelKind; turn?: ProvenanceTurnRef }

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

// --- CGP-KNOW-D-016 (DES-KNOW-29 / REQ-KNOW-29): the info popover ------------------------------

/** A row value: a link to the turn, or plain text when there is no turn to open. */
export type ArtifactTurnLink =
  | { kind: "turn"; taskId: string; messageId: string; taskTitle: string }
  | { kind: "text"; text: string };

export interface ArtifactInfo {
  path: string;
  /** 종류 */
  type: string;
  /** 크기 */
  size: string;
  /** 만든 대화 */
  created: ArtifactTurnLink;
  /** 마지막으로 바꾼 대화 */
  changed: ArtifactTurnLink;
}

/** Where a turn's row is now: open in a listed task, in an archived task, or gone. */
export type TurnLookup = { taskTitle: string; messageId: string; archived: boolean } | null;

export const ARTIFACT_INFO_TEXT = {
  noRecord: "기록 없음",
  missing: "대화를 찾을 수 없어요. 대화 기록이 지워졌거나 다른 곳으로 옮겨졌을 수 있어요.",
  noPlace: "대화를 찾을 수 없어요. 이 기록에는 대화 위치가 남아 있지 않아요.",
  archived: (title: string) => `대화가 보관한 작업 ‘${title}’에 있어요. 보관함에서 다시 열면 볼 수 있어요.`,
  outside: (label: string) => `기록된 대화가 없어요 (${label})`,
  unknownSize: "알 수 없어요",
} as const;

const TYPE_NAMES: Record<string, string> = {
  html: "웹페이지 (HTML)", htm: "웹페이지 (HTML)", css: "스타일 (CSS)", js: "자바스크립트 (JS)", mjs: "자바스크립트 (JS)", cjs: "자바스크립트 (JS)",
  ts: "타입스크립트 (TS)", tsx: "타입스크립트 (TSX)", jsx: "자바스크립트 (JSX)", json: "데이터 (JSON)", csv: "표 (CSV)", md: "글 (Markdown)", txt: "글 (텍스트)",
  py: "파이썬 코드 (PY)", pdf: "PDF 문서", png: "그림 (PNG)", jpg: "그림 (JPG)", jpeg: "그림 (JPEG)", gif: "그림 (GIF)", webp: "그림 (WEBP)", svg: "그림 (SVG)",
  mp3: "소리 (MP3)", wav: "소리 (WAV)", mp4: "동영상 (MP4)", webm: "동영상 (WEBM)", zip: "압축 파일 (ZIP)",
};

/** 종류 from the file name only (no content sniffing); an unknown extension is named by its letters. */
export function artifactTypeLabel(filePath: string): string {
  const name = filePath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (TYPE_NAMES[ext]) return TYPE_NAMES[ext];
  return /^[a-z0-9]{1,10}$/.test(ext) ? `${ext.toUpperCase()} 파일` : "파일";
}

/** 크기 in the units a learner reads; null (not measurable) says so. */
export function artifactSizeLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return ARTIFACT_INFO_TEXT.unknownSize;
  if (bytes < 1024) return `${bytes}바이트`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}${units[unit]}`;
}

/**
 * The popover's rows for one listed file. A link only for an AI event recorded with its task and row
 * that the task store still holds; everything else is plain text that says why there is no link.
 */
export function artifactInfo(entry: ArtifactProvenanceEntry, size: number | null, lookup: (ref: ProvenanceTurnRef) => TurnLookup): ArtifactInfo {
  const step = (s: ProvenanceStep | undefined): ArtifactTurnLink => {
    // 기록 없음 rows (unconfirmed window, bytes nobody recorded) claim no turn at all.
    if (!s || entry.kind === "none" || s.kind === "none" || s.kind === "unknown") return { kind: "text", text: ARTIFACT_INFO_TEXT.noRecord };
    if (s.kind !== "ai_created" && s.kind !== "ai_changed") return { kind: "text", text: ARTIFACT_INFO_TEXT.outside(PROVENANCE_LABELS[s.kind].label) };
    if (!s.turn) return { kind: "text", text: ARTIFACT_INFO_TEXT.noPlace };
    const found = lookup(s.turn);
    if (!found) return { kind: "text", text: ARTIFACT_INFO_TEXT.missing };
    if (found.archived) return { kind: "text", text: ARTIFACT_INFO_TEXT.archived(found.taskTitle) };
    return { kind: "turn", taskId: s.turn.taskId, messageId: found.messageId, taskTitle: found.taskTitle };
  };
  return { path: entry.path, type: artifactTypeLabel(entry.path), size: artifactSizeLabel(size), created: step(entry.origin), changed: step(entry.last) };
}
