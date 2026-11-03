// CGP-AGENT-R-016 / CGP-DS-R-029 — line-level diff of a lesson's instruction text, shown in the authoring
// confirm step (/authoring, 05 · 수업 버전 확정) against the newest confirmed version.
//
// The page has no module loader, so the whole kit lives inside ONE self-contained factory: index.ts serializes
// it with Function.prototype.toString() into the served HTML, and the tests import the very same function.
// Nothing inside the factory may reference module scope.

/** `ws` marks a removed/added pair whose lines differ only in whitespace. */
export type DiffRow =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string; ws?: boolean }
  | { kind: "del"; text: string; ws?: boolean }
  | { kind: "fold"; count: number; lines: string[] };

export type InstructionDiff =
  | { skipped: false; rows: DiffRow[]; added: number; removed: number }
  | { skipped: true; rows: []; added: null; removed: null; limit: number };

export function instructionDiffKit() {
  /** Edit distance beyond which the page stops diffing line by line (memory is O(D²)). */
  const MAX_EDITS = 2000;

  /**
   * CRLF/CR become LF, ONE trailing newline is dropped and text is NFC-normalised, so line endings and
   * composed/decomposed Hangul never show up as a change.
   */
  function splitLines(text: unknown): string[] {
    const s = String(text ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
    if (s === "") return [];
    return (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
  }

  /**
   * Myers O((n+m)·D) shortest edit script on the part between the common prefix and suffix. Returns null when the
   * script needs more than `maxEdits` edits.
   */
  function myers(x: string[], y: string[], maxEdits: number): DiffRow[] | null {
    const n = x.length, m = y.length, lim = Math.min(n + m, maxEdits), off = lim + 1;
    const v = new Int32Array(2 * lim + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= lim && found < 0; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let i = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
        let j = i - k;
        while (i < n && j < m && x[i] === y[j]) { i++; j++; }
        v[off + k] = i;
        if (i >= n && j >= m) { found = d; break; }
      }
    }
    if (found < 0) return null;
    const out: DiffRow[] = [];
    let i = n, j = m;
    for (let d = found; d > 0; d--) {
      const p = trace[d]!, at = (k: number) => p[k + d + 1]!, k = i - j;
      const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const pi = at(pk), pj = pi - pk;
      while (i > pi && j > pj) { out.push({ kind: "same", text: x[i - 1]! }); i--; j--; }
      if (i === pi) { out.push({ kind: "add", text: y[j - 1]! }); j--; }
      else { out.push({ kind: "del", text: x[i - 1]! }); i--; }
    }
    while (i > 0 && j > 0) { out.push({ kind: "same", text: x[i - 1]! }); i--; j--; }
    return out.reverse();
  }

  /** Within each changed hunk: removals first, then additions; pairs that differ only in whitespace get `ws`. */
  function tidy(rows: DiffRow[]): DiffRow[] {
    const out: DiffRow[] = [];
    const squash = (t: string) => t.replace(/\s+/g, " ").trim();
    let k = 0;
    while (k < rows.length) {
      if (rows[k]!.kind === "same") { out.push(rows[k]!); k++; continue; }
      let end = k;
      while (end < rows.length && rows[end]!.kind !== "same") end++;
      const dels = rows.slice(k, end).filter((r) => r.kind === "del") as { kind: "del"; text: string; ws?: boolean }[];
      const adds = rows.slice(k, end).filter((r) => r.kind === "add") as { kind: "add"; text: string; ws?: boolean }[];
      for (let p = 0; p < Math.min(dels.length, adds.length); p++)
        if (squash(dels[p]!.text) === squash(adds[p]!.text)) { dels[p] = { ...dels[p]!, ws: true }; adds[p] = { ...adds[p]!, ws: true }; }
      out.push(...dels, ...adds);
      k = end;
    }
    return out;
  }

  /** Line diff; null when the texts differ by more than `maxEdits` lines (the caller says so, never a fake replace). */
  function lineDiff(oldText: unknown, newText: unknown, maxEdits = MAX_EDITS): DiffRow[] | null {
    const a = splitLines(oldText), b = splitLines(newText);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const middle = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail), maxEdits);
    if (!middle) return null;
    return tidy([
      ...a.slice(0, head).map((text): DiffRow => ({ kind: "same", text })),
      ...middle,
      ...a.slice(a.length - tail).map((text): DiffRow => ({ kind: "same", text })),
    ]);
  }

  /**
   * Rows to draw. Identical texts draw nothing. An unchanged run longer than `keep` lines keeps one line of context
   * next to each change and folds the rest into a single "변경 없음 N줄" row.
   */
  function foldRows(rows: DiffRow[], keep = 3): DiffRow[] {
    if (!rows.some((r) => r.kind === "add" || r.kind === "del")) return [];
    const out: DiffRow[] = [];
    let k = 0;
    while (k < rows.length) {
      const row = rows[k]!;
      if (row.kind !== "same") { out.push(row); k++; continue; }
      let end = k;
      while (end < rows.length && rows[end]!.kind === "same") end++;
      const run = rows.slice(k, end);
      if (run.length <= keep) out.push(...run);
      else {
        const before = k > 0 ? 1 : 0, after = end < rows.length ? 1 : 0;
        out.push(...run.slice(0, before));
        const hidden = run.slice(before, run.length - after).map((r) => (r as { text: string }).text);
        out.push({ kind: "fold", count: hidden.length, lines: hidden });
        out.push(...run.slice(run.length - after));
      }
      k = end;
    }
    return out;
  }

  /**
   * The instruction text of a lesson: each step's title as a header line, then its 안내 (instructions) lines. The
   * header carries no ordinal, so inserting a step does not show every later header as changed.
   */
  function instructionText(content: any): string {
    const steps = Array.isArray(content?.steps) ? content.steps : [];
    return steps
      .map((s: any) => ["[단계] " + String(s?.title ?? "").trim(), ...splitLines(s?.instructions ?? "")].join("\n"))
      .join("\n");
  }

  /** One call for the page: rows to draw plus counts, or `skipped` when the change is too large to show by line. */
  function instructionDiff(oldContent: any, newContent: any, maxEdits = MAX_EDITS): InstructionDiff {
    const rows = lineDiff(instructionText(oldContent), instructionText(newContent), maxEdits);
    if (!rows) return { skipped: true, rows: [], added: null, removed: null, limit: maxEdits };
    return {
      skipped: false,
      rows: foldRows(rows),
      added: rows.filter((r) => r.kind === "add").length,
      removed: rows.filter((r) => r.kind === "del").length,
    };
  }

  /** Stable field comparison: object property order is not a content change; array order is. */
  function canonical(value: any, key = ""): any {
    if (typeof value === "string") return key === "instructions" ? splitLines(value).join("\n") : value.replace(/\r\n?/g, "\n").normalize("NFC");
    if (Array.isArray(value)) return value.map(item => canonical(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], key)]));
    return value;
  }
  function groupedChanges(before: any, after: any) {
    const groups = [
      { label: "이름·소개", keys: ["title", "audience", "objective", "duration_minutes", "assistant", "audience_tier"] },
      { label: "모델·기능", keys: ["model", "features"] },
      { label: "지시문", keys: ["steps"] },
      { label: "자료", keys: ["starter", "prerequisites", "plan_ref"] },
      { label: "승인 방식", keys: ["approval", "approval_preset"] },
      { label: "수업 기준", keys: ["learning"] },
    ];
    const names: Record<string,string> = {title:"제목",audience:"대상",objective:"목표",duration_minutes:"수업 시간",assistant:"AI 이름·소개",audience_tier:"대상 단계",model:"모델·처리 수준",features:"사용 기능",steps:"단계 안내",starter:"시작 자료",prerequisites:"선수 조건",plan_ref:"강의안 자료",approval:"승인 방식",approval_preset:"승인 프리셋",learning:"미션·완료 조건"};
    const known = new Set(groups.flatMap(g => g.keys));
    groups.push({label:"기타 설정",keys:[...new Set([...Object.keys(before ?? {}),...Object.keys(after ?? {})])].filter(key => !known.has(key)).sort()});
    return groups.map(g => ({label:g.label,fields:g.keys.filter(key => JSON.stringify(canonical(before?.[key])) !== JSON.stringify(canonical(after?.[key]))).map(key => ({key,label:Object.hasOwn(names,key) ? names[key] : key,before:before?.[key],after:after?.[key]}))})).filter(g => g.fields.length);
  }

  return { splitLines, lineDiff, foldRows, instructionText, instructionDiff, groupedChanges, MAX_EDITS };
}

/**
 * The inline script the authoring page receives in place of its `/*@instruction-diff*\/` marker. The bundler's
 * keep-names pass inserts `__name(fn, "fn")` calls into the factory body; the wrapper binds that helper to an identity
 * function so the serialized source runs in the browser without the bundle's runtime.
 */
export const INSTRUCTION_DIFF_SCRIPT =
  "const instructionDiffKit=((__name)=>(" + instructionDiffKit.toString() + ")())((f)=>f);";
