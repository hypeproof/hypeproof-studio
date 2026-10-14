// Diff guard: what one save changed (orchestrator spec §6.2). Pure and vscode-free.
//
// A4 keeps the file's content in a PreToolUse hook (Write, Edit, MultiEdit of an
// existing workspace file), archives it first for adults (adultArchive.ts), and
// reports `diffGuard(...).summary` through PostToolUse `additionalContext`.
// v1 never blocks (OWNER DECISION O-5): it states what changed and, for a
// rewrite, suggests going back and using Edit.
//
// How it compares:
// - Both versions are cut into small units: at line breaks and after every
//   `>`, `}` and `;`, so a page written on one long line still diffs by tag
//   and CSS rule. Whitespace inside a unit is normalised, so re-indenting is not
//   a change.
// - `changed_ratio` is the share of the existing content, by characters, that
//   did not survive the save. Adding a section changes nothing that existed;
//   regenerating the page changes most of it.
// - A change is inside the 정보블록 when it lies between the markers the
//   homepage harness writes (`<!-- 정보블록:시작 -->` … `<!-- 정보블록:끝 -->`,
//   svc-harness homepage-craft.md and homepage-sections.md).

export const INFO_BLOCK_START = "<!-- 정보블록:시작 -->";
export const INFO_BLOCK_END = "<!-- 정보블록:끝 -->";
/** PostToolUse `additionalContext` limit (spec §6.1, the same hook). */
export const DIFF_SUMMARY_MAX = 400;
/** More than half of the existing content replaced: a rewrite, not a partial edit. */
export const REWRITE_RATIO = 0.5;

/** Past this many comparisons the diff is estimated rather than exact (memory and time in a hook). */
const EXACT_DIFF_CELLS = 4_000_000;

const START_MARKER = /<!--\s*정보블록\s*:\s*시작\s*-->/g;
const END_MARKER = /<!--\s*정보블록\s*:\s*끝\s*-->/g;

export type DiffGuardVerdict = "unchanged" | "inside" | "partial" | "rewrite";

export interface DiffGuardInput {
  /** Workspace-relative path, for the summary. */
  path: string;
  before: string;
  after: string;
  /** Write, Edit or MultiEdit. */
  tool?: string;
  /** Where the previous version was archived (adultArchive), so the coach can restore it. */
  archivedPath?: string | null;
}

export interface DiffGuardResult {
  path: string;
  tool?: string;
  verdict: DiffGuardVerdict;
  /** 0..1: the share of the existing content, by characters, that did not survive the save. */
  changed_ratio: number;
  /** Existing lines that lost content, and lines of the new version that gained some. */
  changed_lines: number;
  added_lines: number;
  /** Every change between the 정보블록 markers; null when nothing changed or the file has no single, well-formed block. */
  inside_info_block: boolean | null;
  /** Sections the changes touched (`#id`, else `tag.class`; `정보블록`, `style`, `head`, `body`), in page order, at most 20. */
  touched_sections: string[];
  /** The touched sections whose changes lie outside the 정보블록 (all of them when there is no block), at most 20. */
  outside_sections: string[];
  touched_count: number;
  outside_count: number;
  archived_path?: string;
  /** The files were too large for the exact diff; ratio and places are estimates. */
  approximate: boolean;
  summary: string;
}

interface Unit {
  key: string;
  start: number;
  end: number;
  line: number;
  weight: number;
}

function units(text: string): Unit[] {
  const out: Unit[] = [];
  let start = 0;
  let line = 1;
  let unitLine = 1;
  const push = (end: number) => {
    const key = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (key) out.push({ key, start, end, line: unitLine, weight: key.length });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i);
      start = i + 1;
      line++;
      unitLine = line;
    } else if (ch === ">" || ch === "}" || ch === ";") {
      push(i + 1);
      start = i + 1;
      unitLine = line;
    }
  }
  push(text.length);
  return out;
}

interface Alignment {
  keptBefore: boolean[];
  keptAfter: boolean[];
  /** Offsets in `before` where content was inserted. */
  insertions: number[];
  approximate: boolean;
}

/** Longest common subsequence of units, after trimming the common head and tail. */
function align(a: Unit[], b: Unit[], beforeLength: number): Alignment {
  const keptBefore = new Array<boolean>(a.length).fill(true);
  const keptAfter = new Array<boolean>(b.length).fill(true);
  const insertions: number[] = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head].key === b[head].key) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail].key === b[b.length - 1 - tail].key) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  /** Where an insertion before middle unit i of `a` lands in `before`. */
  const at = (i: number) => (head + i < a.length ? a[head + i].start : beforeLength);

  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) keptBefore[head + i] = false;
    for (let j = 0; j < m; j++) keptAfter[head + j] = false;
    if (m > 0) insertions.push(at(0));
    return { keptBefore, keptAfter, insertions, approximate: false };
  }

  if (n * m > EXACT_DIFF_CELLS) {
    // Estimate: a unit survives when the other side still has one like it.
    const count = new Map<string, number>();
    for (let j = 0; j < m; j++) count.set(b[head + j].key, (count.get(b[head + j].key) ?? 0) + 1);
    for (let i = 0; i < n; i++) {
      const k = a[head + i].key;
      const c = count.get(k) ?? 0;
      if (c > 0) count.set(k, c - 1);
      else keptBefore[head + i] = false;
    }
    const left = new Map<string, number>();
    for (let i = 0; i < n; i++) left.set(a[head + i].key, (left.get(a[head + i].key) ?? 0) + 1);
    for (let j = 0; j < m; j++) {
      const k = b[head + j].key;
      const c = left.get(k) ?? 0;
      if (c > 0) left.set(k, c - 1);
      else keptAfter[head + j] = false;
    }
    // Places are unknown inside the middle: report both of its ends.
    insertions.push(at(0), at(n));
    return { keptBefore, keptAfter, insertions, approximate: true };
  }

  // lcs[i * (m + 1) + j] = LCS length of a-middle[i..] and b-middle[j..].
  const width = m + 1;
  const lcs = Math.min(n, m) < 0xffff ? new Uint16Array((n + 1) * width) : new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const ka = a[head + i].key;
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = ka === b[head + j].key
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[head + i].key === b[head + j].key) {
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      keptBefore[head + i] = false;
      i++;
    } else {
      keptAfter[head + j] = false;
      insertions.push(at(i));
      j++;
    }
  }
  return { keptBefore, keptAfter, insertions, approximate: false };
}

interface Region {
  label: string;
  start: number;
  end: number;
  /** An insertion at either edge is inside (the 정보블록's inner span, as `inBlock` counts it). */
  edges?: boolean;
}

const REGION_TAG = /<(\/?)(section|header|footer|nav|aside|article|main|head|style)\b([^>]*)>/gi;

/** Section-like elements of the page, with the offsets they span. */
function regions(text: string): Region[] {
  const out: Region[] = [];
  const open: Array<{ tag: string; label: string; start: number }> = [];
  for (const m of text.matchAll(REGION_TAG)) {
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].tag !== tag) continue;
        const [region] = open.splice(k, 1);
        out.push({ label: region.label, start: region.start, end: (m.index ?? 0) + m[0].length });
        break;
      }
      continue;
    }
    const attrs = m[3] ?? "";
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    const cls = /\bclass\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    const label = tag === "style" || tag === "head" ? tag : id ? `#${id}` : cls ? `${tag}.${cls}` : tag;
    open.push({ tag, label, start: m.index ?? 0 });
  }
  for (const region of open) out.push({ label: region.label, start: region.start, end: text.length });
  return out;
}

/** The innermost region holding a change: a span from its start, an insertion point strictly inside. */
function regionAt(all: Region[], offset: number, point: boolean): string {
  let best: Region | null = null;
  for (const r of all) {
    const inside = point
      ? r.edges ? r.start <= offset && offset <= r.end : r.start < offset && offset < r.end
      : r.start <= offset && offset < r.end;
    if (inside && (!best || r.end - r.start < best.end - best.start)) best = r;
  }
  return best ? best.label : "body";
}

/** The 정보블록's inner span, when the file has exactly one start and one end marker in order. */
function infoBlock(text: string): { start: number; end: number } | null {
  const starts = [...text.matchAll(START_MARKER)];
  const ends = [...text.matchAll(END_MARKER)];
  if (starts.length !== 1 || ends.length !== 1) return null;
  const start = (starts[0].index ?? 0) + starts[0][0].length;
  const end = ends[0].index ?? 0;
  return end >= start ? { start, end } : null;
}

/** At most `max` UTF-16 units, cut at a separator where possible and marked with "…". */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf(". "), head.lastIndexOf(" · "));
  return (cut > max / 2 ? head.slice(0, cut) : head) + "…";
}

function percent(ratio: number, approximate: boolean): string {
  const text = ratio > 0 && ratio < 0.005 ? "1% 미만" : `${Math.round(ratio * 100)}%`;
  return approximate ? `약 ${text}` : text;
}

/** The subject particle after a percentage: 「3%가」, 「1% 미만이」. */
function subject(text: string): string {
  return text + (text.endsWith("미만") ? "이" : "가");
}

const LIST_LIMIT = 20;

/** Compare the file before and after one save. Pure: the caller reads the files. */
export function diffGuard(input: DiffGuardInput): DiffGuardResult {
  const before = String(input.before ?? "");
  const after = String(input.after ?? "");
  const path = String(input.path ?? "");
  const a = units(before);
  const b = units(after);
  const { keptBefore, keptAfter, insertions, approximate } = align(a, b, before.length);

  const total = a.reduce((s, u) => s + u.weight, 0);
  const lost = a.reduce((s, u, i) => s + (keptBefore[i] ? 0 : u.weight), 0);
  const ratio = total > 0 ? lost / total : 0;
  const changedLines = new Set(a.filter((_, i) => !keptBefore[i]).map((u) => u.line)).size;
  const addedLines = new Set(b.filter((_, j) => !keptAfter[j]).map((u) => u.line)).size;

  // Every change as a place in `before`: removed spans, and insertion points.
  const changes: Array<{ start: number; end: number; point: boolean }> = [
    ...a.filter((_, i) => !keptBefore[i]).map((u) => ({ start: u.start, end: u.end, point: false })),
    ...insertions.map((p) => ({ start: p, end: p, point: true })),
  ];
  const block = infoBlock(before);
  const inBlock = (c: { start: number; end: number }) => !!block && c.start >= block.start && c.end <= block.end;
  // The block itself is a region too, so a change between its sections reads 정보블록.
  const all: Region[] = [...regions(before), ...(block ? [{ label: "정보블록", start: block.start, end: block.end, edges: true }] : [])];
  const touched: string[] = [];
  const outside: string[] = [];
  for (const c of [...changes].sort((x, y) => x.start - y.start)) {
    const label = regionAt(all, c.start, c.point);
    if (!touched.includes(label)) touched.push(label);
    if (!inBlock(c) && !outside.includes(label)) outside.push(label);
  }

  const changed = changes.length > 0;
  const inside = block && changed ? changes.every(inBlock) : null;
  const verdict: DiffGuardVerdict = !changed ? "unchanged" : inside ? "inside" : ratio > REWRITE_RATIO ? "rewrite" : "partial";

  const file = path || "index.html";
  const places = (list: string[]) => list.slice(0, 6).join(", ") + (list.length > 6 ? ` 외 ${list.length - 6}곳` : "");
  let summary: string;
  if (verdict === "unchanged") {
    summary = `저장 비교(${file}): 내용 변화 없음${before === after ? "" : "(공백·줄바꿈만 바뀜)"}.`;
  } else if (verdict === "inside") {
    summary = lost === 0
      ? `저장 비교(${file}): 정보블록 안만 바뀌었습니다(${places(touched)} · 기존 내용은 그대로, 새 줄 ${addedLines}개).`
      : `저장 비교(${file}): 정보블록 안만 바뀌었습니다(${places(touched)} · 기존 내용의 ${percent(ratio, approximate)} · 바뀐 줄 ${changedLines}개).`;
  } else {
    const where = block ? `정보블록 밖 ${outside.length}개 섹션: ${places(outside)}` : `바뀐 곳: ${places(touched)}`;
    const lines = `바뀐 줄 ${changedLines}개${addedLines ? ` · 새 줄 ${addedLines}개` : ""}`;
    summary = verdict === "rewrite"
      ? `저장 비교(${file}): 이번 저장은 기존 내용의 ${percent(ratio, approximate)}를 바꿨습니다(${where}). 부분 수정 요청이었다면 되돌리고 Edit 으로 고친 뒤 다시 확인하세요.`
      : lost === 0
        ? `저장 비교(${file}): 기존 내용은 그대로 두고 새 줄 ${addedLines}개를 더했습니다(${where}).`
        : `저장 비교(${file}): 기존 내용의 ${subject(percent(ratio, approximate))} 바뀌었습니다(${lines} · ${where}).`;
  }
  // The archived path is what lets the coach restore: it is kept whole and the
  // rest is cut. (A path too long to leave room stays in `archived_path` only.)
  const note = input.archivedPath && verdict !== "unchanged" ? ` 이전 버전: ${input.archivedPath}` : "";
  const archived = note.length <= DIFF_SUMMARY_MAX / 2 ? note : "";

  return {
    path,
    ...(input.tool ? { tool: input.tool } : {}),
    verdict,
    // Four decimals; a change that exists never rounds to 0.
    changed_ratio: ratio > 0 ? Math.max(0.0001, Math.round(ratio * 10000) / 10000) : 0,
    changed_lines: changedLines,
    added_lines: addedLines,
    inside_info_block: inside,
    touched_sections: touched.slice(0, LIST_LIMIT),
    outside_sections: outside.slice(0, LIST_LIMIT),
    touched_count: touched.length,
    outside_count: outside.length,
    ...(input.archivedPath ? { archived_path: input.archivedPath } : {}),
    approximate,
    summary: clamp(summary, DIFF_SUMMARY_MAX - archived.length) + archived,
  };
}
