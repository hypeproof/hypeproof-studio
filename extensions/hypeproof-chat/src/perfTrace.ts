// CGP-AGENT-R-030 / REQ-CGP-AGENT-64 (REQ-STUDIO-PERF-TRACE): the "느려요 기록" performance trace.
//
// Pure: no vscode, no DOM, no Node imports, so tests run it directly. The host side
// (perfTraceHost.ts) owns the start click, the status bar pill, the local file and the send.
//
// What a trace holds is numbers only: per-turn timings bound to the turn's stream id, and
// periodic samples of extension-host memory and event-loop lag. No prompt, answer, file name,
// path or stream id is ever written, so a trace cannot carry a learner's words.

export const PERF_TRACE_FORMAT = "hps-perf-trace/1";
/** A recording stops by itself after ten minutes, so a forgotten pill cannot grow a file without bound. */
export const PERF_TRACE_MAX_MS = 10 * 60 * 1000;
export const PERF_TRACE_SAMPLE_MS = 1000;
export const PERF_TRACE_MAX_TURNS = 200;
export const PERF_TRACE_MAX_SAMPLES = Math.ceil(PERF_TRACE_MAX_MS / PERF_TRACE_SAMPLE_MS) + 1;
export const PERF_TRACE_NOTE_MAX = 1000;
/** The Service's report route caps `attachments` at 8,192 serialized characters; the summary keeps well under it. */
export const PERF_TRACE_SEND_MAX = 6000;

export type PerfTurnOutcome = "end" | "failed" | "stopped" | "error" | "open";
export type PerfTraceStop = "learner" | "limit" | "seat";

export interface PerfTurn { start_ms: number; first_chunk_ms: number | null; total_ms: number | null; chunks: number; outcome: PerfTurnOutcome }
export interface PerfSample { t_ms: number; rss_mb: number; heap_mb: number; loop_lag_ms: number }
export interface PerfTrace {
  format: typeof PERF_TRACE_FORMAT;
  started_at: string;
  duration_ms: number;
  stopped_by: PerfTraceStop;
  studio_version: string;
  os: string;
  turns: PerfTurn[];
  samples: PerfSample[];
  dropped_turns: number;
  note?: string;
}

/** The seat rule. Instructors first (their profile may be absent); otherwise a resolved, non-minor profile. Unknown fails closed. */
export function perfTraceSeatAllowed(seat: { instructor: boolean | null | undefined; hasProfile: boolean; minor: boolean }): boolean {
  if (seat.instructor === true) return true;
  return seat.hasProfile && !seat.minor;
}

const num = (v: number): number => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const mb = (bytes: number): number => (Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes / 104857.6) / 10 : 0);

/**
 * Records one trace. Every turn is keyed by the stream id the host already uses for the turn, so chunks
 * of an older turn never land on a newer one; the id itself is not kept in the output.
 */
export class PerfTraceRecorder {
  private readonly turns = new Map<string, PerfTurn>();
  private readonly order: PerfTurn[] = [];
  private readonly samples: PerfSample[] = [];
  private dropped = 0;
  constructor(private readonly startedAt: number) {}

  observe(msg: { type?: unknown; streamId?: unknown; failed?: unknown }, now: number): void {
    if (typeof msg?.type !== "string" || typeof msg.streamId !== "string" || !msg.streamId) return;
    const t = num(now - this.startedAt);
    const id = msg.streamId;
    if (msg.type === "streamStart") {
      if (this.turns.has(id)) return;
      if (this.order.length >= PERF_TRACE_MAX_TURNS) { this.dropped++; return; }
      const turn: PerfTurn = { start_ms: t, first_chunk_ms: null, total_ms: null, chunks: 0, outcome: "open" };
      this.turns.set(id, turn); this.order.push(turn);
      return;
    }
    const turn = this.turns.get(id);
    if (!turn || turn.outcome !== "open") return;
    if (msg.type === "streamChunk") {
      turn.chunks++;
      if (turn.first_chunk_ms === null) turn.first_chunk_ms = num(t - turn.start_ms);
      return;
    }
    const outcome: PerfTurnOutcome | null = msg.type === "streamEnd" ? (msg.failed ? "failed" : "end") : msg.type === "streamStopped" ? "stopped" : msg.type === "streamError" ? "error" : null;
    if (!outcome) return;
    turn.outcome = outcome; turn.total_ms = num(t - turn.start_ms);
  }

  sample(now: number, rssBytes: number, heapBytes: number, loopLagMs: number): void {
    if (this.samples.length >= PERF_TRACE_MAX_SAMPLES) return;
    this.samples.push({ t_ms: num(now - this.startedAt), rss_mb: mb(rssBytes), heap_mb: mb(heapBytes), loop_lag_ms: num(loopLagMs) });
  }

  finish(now: number, stoppedBy: PerfTraceStop, env: { studioVersion: string; os: string }): PerfTrace {
    return {
      format: PERF_TRACE_FORMAT,
      started_at: new Date(this.startedAt).toISOString(),
      duration_ms: num(now - this.startedAt),
      stopped_by: stoppedBy,
      studio_version: cleanNote(env.studioVersion).slice(0, 40),
      os: cleanNote(env.os).slice(0, 80),
      turns: this.order.map((turn) => ({ ...turn })),
      samples: this.samples.map((s) => ({ ...s })),
      dropped_turns: this.dropped,
    };
  }
}

/** Control, bidi, zero-width, BOM and line/paragraph separators are dropped; NFC; capped without splitting a surrogate pair. */
export function cleanNote(value: unknown, max = PERF_TRACE_NOTE_MAX): string {
  if (typeof value !== "string") return "";
  const cleaned = value.normalize("NFC").replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, "").trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? chars.slice(0, max).join("") : cleaned;
}

const pct = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : null);
const stats = (values: number[]) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return { n: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), max: s.length ? s[s.length - 1] : null }; };

/**
 * What 보내기 sends: aggregates plus as many of the latest turns as fit under PERF_TRACE_SEND_MAX characters.
 * The note does not go in here; it is the report's description, shown as its own item.
 */
export function perfTraceSummary(trace: PerfTrace): Record<string, unknown> {
  const turns = trace.turns;
  const base = {
    format: trace.format,
    duration_ms: trace.duration_ms,
    stopped_by: trace.stopped_by,
    turn_count: turns.length + trace.dropped_turns,
    first_chunk_ms: stats(turns.map((t) => t.first_chunk_ms ?? NaN)),
    total_ms: stats(turns.map((t) => t.total_ms ?? NaN)),
    loop_lag_ms: stats(trace.samples.map((s) => s.loop_lag_ms)),
    rss_mb_max: trace.samples.reduce((m, s) => Math.max(m, s.rss_mb), 0),
    heap_mb_max: trace.samples.reduce((m, s) => Math.max(m, s.heap_mb), 0),
    sample_count: trace.samples.length,
  };
  // Compact rows: [start, first chunk, total, chunks, outcome]; newest kept when trimming.
  const rows = turns.map((t) => [t.start_ms, t.first_chunk_ms, t.total_ms, t.chunks, t.outcome]);
  for (let keep = rows.length; keep >= 0; keep--) {
    const out = { ...base, turns: rows.slice(rows.length - keep), turns_omitted: rows.length - keep };
    if (JSON.stringify(out).length <= PERF_TRACE_SEND_MAX) return out;
  }
  return { ...base, turns: [], turns_omitted: rows.length };
}

export const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes.toLocaleString("ko-KR")} 바이트` : `${(Math.round(bytes / 102.4) / 10).toLocaleString("ko-KR")} KB`);

// ── Learner copy. The consent lines are also §8 of docs/session-log-consent.ko.md; a test keeps them identical. ──
export const PERF_TRACE_TITLE = "느려요 기록";
export const PERF_TRACE_START_QUESTION = "느려요 기록을 시작할까요?";
export const PERF_TRACE_START_BUTTON = "기록 시작";
export const PERF_TRACE_CONSENT_LINES: readonly string[] = [
  "1. ‘기록 시작’을 누른 뒤, 느렸던 일을 한 번 더 해 보세요.",
  "2. 아래 상태 표시줄의 ‘기록 중 · 멈추기’를 누르면 기록이 끝나요. 10분이 지나면 저절로 멈춰요.",
  "3. 기록은 이 컴퓨터에만 저장돼요. ‘보내기’를 직접 누르기 전에는 밖으로 나가지 않아요.",
  "",
  "기록하는 것: 답이 시작되고 끝나기까지 걸린 시간, 코치 기능이 멈칫한 시간과 메모리 사용량.",
  "기록하지 않는 것: 질문, AI의 답, 파일 이름과 내용.",
  "보내면 기록 요약과 내가 쓴 메모, 앱 버전·운영체제·프로필 이름이 문제 신고와 같은 길로 Studio 운영팀에 전달되고, 느린 원인을 찾는 데에만 써요. 광고, 외부 제공, AI 모델 학습에는 쓰지 않아요.",
];
export const PERF_TRACE_PILL = "$(record) 기록 중 · 멈추기";
export const PERF_TRACE_PILL_LABEL = "느려요 기록 중. 누르면 기록을 멈춰요.";
export const PERF_TRACE_NOTE_PROMPT = "무엇이 느렸는지 적어 주세요 (선택). 비워 두어도 돼요.";
export const PERF_TRACE_KEEP = "내 컴퓨터에만 두기";
export const PERF_TRACE_SEND = "보내기";
export const PERF_TRACE_NOTE_NONE = "느려요 기록 (메모 없음)";
export const PERF_TRACE_SEAT_REFUSED = "이 자리에서는 느려요 기록을 쓸 수 없어요. 성인 이용자와 강사만 쓸 수 있어요.";
export const PERF_TRACE_ALREADY = "이미 기록하고 있어요. 상태 표시줄의 ‘기록 중 · 멈추기’를 누르면 끝나요.";
export const PERF_TRACE_KEPT = "기록을 이 컴퓨터에만 두었어요. 아무것도 보내지 않았어요.";
export const perfTraceStoppedLine = (by: PerfTraceStop): string =>
  by === "limit" ? "10분이 지나 기록을 멈췄어요." : by === "seat" ? "이 자리에서는 기록을 이어 갈 수 없어서 멈췄어요." : "기록을 멈췄어요.";
export const perfTraceReview = (bytes: number, by: PerfTraceStop): { message: string; detail: string } => ({
  message: `${perfTraceStoppedLine(by)} 기록을 이 컴퓨터에 저장했어요 (${formatBytes(bytes)}).`,
  detail: "보내기를 누르기 전에는 밖으로 나가지 않아요. 보내기를 누르면 보낼 항목과 크기를 한 번 더 보여 드려요.",
});
