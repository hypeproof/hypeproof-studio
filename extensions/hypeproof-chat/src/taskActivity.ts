// CGP-ART-R-020 / CGP-ART-D-020 (REQ-STUDIO-TASK-ACTIVITY) — the "AI가 한 일" roll-up of one task.
//
// Every entry is one coach tool call that reached a successful tool_result in that task's turns:
// a file read, created or changed, a web page opened, or a web search. Nothing is inferred from
// prose, labels or the folder: a call that was refused, failed or never answered leaves no entry,
// so no count can exist without its event. Shared by host and webview; no imports.

export type TaskActivityVerb = "read" | "created" | "changed" | "web" | "search";

export interface TaskActivityFact {
  /** The tool call's id (SDK tool_use id or browser-loop call id). Dedupes live and persisted copies. */
  id: string;
  verb: TaskActivityVerb;
  /** Work-folder-relative POSIX path for files inside it; otherwise the cleaned path, URL or query. */
  target: string;
  /** The file is inside the task's work folder (the only files the turn review can show). */
  inside?: boolean;
}

export const TASK_ACTIVITY_VERBS: readonly TaskActivityVerb[] = ["read", "created", "changed", "web", "search"];
export const TASK_ACTIVITY_LABEL: Record<TaskActivityVerb, string> = {
  read: "읽음", created: "만듦", changed: "바꿈", web: "웹 페이지", search: "검색",
};
export const TASK_ACTIVITY_TARGET_MAX = 300;
/** Per persisted message; a turn with more successful calls keeps the first ones (the store stays bounded). */
export const TASK_ACTIVITY_FACTS_MAX = 500;
const ID_MAX = 256;

// C0/C1 controls, line/paragraph separators, bidi embeddings/overrides/isolates, zero-width and BOM.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** One display-safe line: NFC, unsafe characters shown as U+FFFD, capped. Empty when nothing is left. */
export function cleanActivityTarget(value: string): string {
  const text = value.normalize("NFC").replace(UNSAFE, "\ufffd").trim();
  return text.length > TASK_ACTIVITY_TARGET_MAX ? `${text.slice(0, TASK_ACTIVITY_TARGET_MAX - 1)}…` : text;
}

/** What the host knows about a file path at tool_use time (before the tool runs). */
export interface ActivityFileProbe {
  /** Work-folder-relative POSIX path, or null when the path is outside the folder (or no folder). */
  relative(filePath: string): string | null;
  /** The path names an existing entry right now (lstat; a dangling link counts). */
  exists(filePath: string): boolean;
}

type Candidate = Omit<TaskActivityFact, "id">;

const str = (input: unknown, key: string): string | null => {
  const v = (input as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === "string" && v.trim() ? v : null;
};

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i;

/** An http(s) page outside this machine; the learner's own loopback preview and about:blank are not "web pages". */
function webTarget(raw: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (LOOPBACK.test(url.hostname)) return null;
  url.username = ""; url.password = "";
  return cleanActivityTarget(url.href) || null;
}

function fileCandidate(verb: "read" | "created" | "changed", raw: string | null, probe: ActivityFileProbe): Candidate | null {
  if (!raw) return null;
  const rel = probe.relative(raw);
  const target = cleanActivityTarget(rel ?? raw);
  return target ? { verb, target, ...(rel !== null ? { inside: true } : {}) } : null;
}

/** The entry a tool call would make if it succeeds, or null when it is none of the five kinds. */
export function activityCandidate(name: string, input: unknown, probe: ActivityFileProbe): Candidate | null {
  const bare = name.replace(/^mcp__.+?__/, "");
  switch (name) {
    case "Read": return fileCandidate("read", str(input, "file_path"), probe);
    case "Write": {
      const file = str(input, "file_path");
      return file ? fileCandidate(probe.exists(file) ? "changed" : "created", file, probe) : null;
    }
    case "Edit": case "MultiEdit": return fileCandidate("changed", str(input, "file_path"), probe);
    case "NotebookEdit": return fileCandidate("changed", str(input, "notebook_path"), probe);
    case "WebFetch": { const t = webTarget(str(input, "url")); return t ? { verb: "web", target: t } : null; }
    case "WebSearch": { const q = str(input, "query"); const t = q && cleanActivityTarget(q); return t ? { verb: "search", target: t } : null; }
  }
  // The hypeproof MCP browser_open (SDK) and the browser loop's browser_navigate (proxy runtime).
  if (bare === "browser_open" || bare === "browser_navigate") {
    const t = webTarget(str(input, "url"));
    return t ? { verb: "web", target: t } : null;
  }
  return null;
}

/**
 * One turn's recorder. `use` remembers the candidate (its file existence is read before the tool
 * runs); only `result` with success turns it into an entry, once per call id.
 */
export class TaskActivityRecorder {
  private readonly pending = new Map<string, Candidate>();
  private readonly done = new Set<string>();
  readonly facts: TaskActivityFact[] = [];
  private readonly probe: ActivityFileProbe;
  constructor(probe: ActivityFileProbe) { this.probe = probe; }

  use(id: string, name: string, input: unknown): void {
    if (!id || id.length > ID_MAX || this.done.has(id) || this.pending.has(id)) return;
    let candidate: Candidate | null = null;
    try { candidate = activityCandidate(name, input, this.probe); } catch { candidate = null; }
    if (candidate) this.pending.set(id, candidate);
  }

  /** A refused call never runs; forget it so a later result for the id cannot count it. */
  deny(id: string): void { this.pending.delete(id); this.done.add(id); }

  result(id: string, isError: boolean): TaskActivityFact | null {
    const candidate = this.pending.get(id);
    this.pending.delete(id);
    if (!candidate || isError || this.done.has(id)) { this.done.add(id); return null; }
    this.done.add(id);
    if (this.facts.length >= TASK_ACTIVITY_FACTS_MAX) return null;
    const fact: TaskActivityFact = { id, ...candidate };
    this.facts.push(fact);
    return fact;
  }
}

export function validTaskActivityFact(value: unknown): value is TaskActivityFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["id", "verb", "target", "inside"].includes(k))) return false;
  return typeof v.id === "string" && v.id.length > 0 && v.id.length <= ID_MAX &&
    typeof v.verb === "string" && (TASK_ACTIVITY_VERBS as readonly string[]).includes(v.verb) &&
    typeof v.target === "string" && v.target.length > 0 && v.target.length <= TASK_ACTIVITY_TARGET_MAX && !/[\u0000-\u001f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(v.target) &&
    (v.inside === undefined || v.inside === true);
}

export function validTaskActivity(value: unknown): value is TaskActivityFact[] {
  return Array.isArray(value) && value.length > 0 && value.length <= TASK_ACTIVITY_FACTS_MAX && value.every(validTaskActivityFact);
}

export interface TaskActivityItem { target: string; inside: boolean }
export type TaskActivitySummary = Record<TaskActivityVerb, TaskActivityItem[]>;

/**
 * The task's roll-up: entries carried by its messages plus live ones not yet persisted, one per
 * call id, then one row per distinct target within each verb (first-seen order). Malformed
 * entries are ignored, never counted.
 */
export function summarizeTaskActivity(messages: readonly { activity?: unknown }[], live: readonly unknown[] = []): TaskActivitySummary {
  const out: TaskActivitySummary = { read: [], created: [], changed: [], web: [], search: [] };
  const ids = new Set<string>();
  const seen = new Set<string>();
  const take = (f: unknown) => {
    if (!validTaskActivityFact(f) || ids.has(f.id)) return;
    ids.add(f.id);
    const key = `${f.verb}\u0000${f.target}`;
    const row = out[f.verb].find((r) => r.target === f.target);
    if (row) { if (f.inside) row.inside = true; return; }
    if (seen.has(key)) return;
    seen.add(key);
    out[f.verb].push({ target: f.target, inside: f.inside === true });
  };
  for (const m of messages) if (Array.isArray(m.activity)) for (const f of m.activity) take(f);
  for (const f of live) take(f);
  return out;
}

export function taskActivityTotal(s: TaskActivitySummary): number {
  return TASK_ACTIVITY_VERBS.reduce((n, v) => n + s[v].length, 0);
}

/** Grapheme clusters (ZWJ emoji, flags, combining marks, jamo sequences stay whole); code points where Intl.Segmenter is missing. */
function graphemes(text: string): string[] {
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return Array.from(text);
  return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (x) => x.segment);
}

/** Middle ellipsis for long names: keeps the start and the file name end, never cutting inside a grapheme. */
export function middleEllipsis(text: string, max = 48): string {
  const chars = graphemes(text);
  if (chars.length <= max) return text;
  const tail = Math.ceil((max - 1) / 2), head = max - 1 - tail;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/**
 * CGP-ART-D-020: the longest middle-ellipsized form (at most `max` characters) that `fits` on one line.
 * Without a measurer it falls back to `max`. Below `min` characters the name keeps `min` and wraps,
 * because a shorter cut no longer names the file.
 */
export function fitMiddleEllipsis(text: string, fits: ((shown: string) => boolean) | null, max = 48, min = 12): string {
  const capped = middleEllipsis(text, max);
  if (!fits || fits(capped)) return capped;
  let lo = min, hi = Math.min(max, graphemes(text).length) - 1, best = middleEllipsis(text, min);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, shown = middleEllipsis(text, mid);
    if (fits(shown)) { best = shown; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/**
 * The turn's entries ride on the last line it leaves in the task's history (persisted with the task,
 * never sent to the model). A turn that left no line gets one empty system line that only carries them.
 */
export function withTaskActivity<M extends { id: string; role: string; content: string; createdAt: number; activity?: TaskActivityFact[] }>(
  items: M[], facts: readonly TaskActivityFact[], messageId: string,
): M[] {
  if (facts.length === 0) return items;
  const activity = facts.slice(0, TASK_ACTIVITY_FACTS_MAX).map((f) => ({ ...f }));
  if (items.length === 0) return [{ id: `${messageId}#activity`, role: "system", content: "", createdAt: Date.now(), activity } as M];
  const last = items.length - 1;
  return items.map((m, i) => (i === last ? { ...m, activity } : m));
}
