// CGP-AGENT-R-016 / CGP-DS-R-029 — line-level diff of a lesson's instruction text, shown in the authoring
// confirm step (/authoring, 05 · 수업 버전 확정) against the newest confirmed version.
//
// The page has no module loader, so the whole kit lives inside ONE self-contained factory: index.ts serializes
// it with Function.prototype.toString() into the served HTML, and the tests import the very same function.
// Nothing inside the factory may reference module scope.

export type DiffRow =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string }
  | { kind: "fold"; count: number; lines: string[] };

export function instructionDiffKit() {
  /** CRLF/CR become LF and ONE trailing newline is dropped, so line endings never show up as a change. */
  function splitLines(text: unknown): string[] {
    const s = String(text ?? "").replace(/\r\n?/g, "\n");
    if (s === "") return [];
    return (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
  }

  /** Plain LCS line diff. Deletions come before additions inside a changed hunk. */
  function lineDiff(oldText: unknown, newText: unknown): DiffRow[] {
    const a = splitLines(oldText), b = splitLines(newText);
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
    const rows: DiffRow[] = a.slice(0, head).map((text) => ({ kind: "same", text }));
    if (x.length * y.length > 4_000_000) {
      // Too large for the table: show the middle as one replaced block rather than freezing the page.
      for (const text of x) rows.push({ kind: "del", text });
      for (const text of y) rows.push({ kind: "add", text });
    } else {
      const n = x.length, m = y.length, w = m + 1;
      const t = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
          t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && x[i] === y[j]) { rows.push({ kind: "same", text: x[i]! }); i++; j++; }
        else if (j >= m || (i < n && t[(i + 1) * w + j]! >= t[i * w + j + 1]!)) { rows.push({ kind: "del", text: x[i]! }); i++; }
        else { rows.push({ kind: "add", text: y[j]! }); j++; }
      }
    }
    for (const text of a.slice(a.length - tail)) rows.push({ kind: "same", text });
    return rows;
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

  /** The instruction text of a lesson: each step's title as a header line, then its 안내 (instructions) lines. */
  function instructionText(content: any): string {
    const steps = Array.isArray(content?.steps) ? content.steps : [];
    return steps
      .map((s: any, n: number) => {
        const body = splitLines(s?.instructions ?? "");
        return ["[" + (n + 1) + ". " + String(s?.title ?? "").trim() + "]", ...body].join("\n");
      })
      .join("\n");
  }

  /** One call for the page: rows to draw plus counts. */
  function instructionDiff(oldContent: any, newContent: any) {
    const rows = lineDiff(instructionText(oldContent), instructionText(newContent));
    return {
      rows: foldRows(rows),
      added: rows.filter((r) => r.kind === "add").length,
      removed: rows.filter((r) => r.kind === "del").length,
    };
  }

  return { splitLines, lineDiff, foldRows, instructionText, instructionDiff };
}

/**
 * The inline script the authoring page receives in place of its `/*@instruction-diff*\/` marker. The bundler's
 * keep-names pass inserts `__name(fn, "fn")` calls into the factory body; the wrapper binds that helper to an identity
 * function so the serialized source runs in the browser without the bundle's runtime.
 */
export const INSTRUCTION_DIFF_SCRIPT =
  "const instructionDiffKit=((__name)=>(" + instructionDiffKit.toString() + ")())((f)=>f);";
