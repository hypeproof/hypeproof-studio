// CGP-SHELL-R-032 / CGP-SHELL-D-031 (classroom-admin ADM-01 roster CSV) — roster import on /console.
//
// The instructor pastes or uploads a CSV, sees a preview table, and only then sends the valid handles to the
// Service's existing `POST /admin/cohorts/:id/roster/append` (body `{ users }`, answer `{ ok, size, added }`).
// That endpoint merges server-side, is idempotent, and validates the whole request before it writes, so every
// row's result is read from one answer: in `added` = 추가됨, sent but not in `added` = 이미 있음, a refused or
// unreadable answer = 실패 with its reason. Nothing here guesses a result the answer does not state.
//
// The page has no module loader, so the whole kit lives inside ONE self-contained factory: index.ts serializes
// it with Function.prototype.toString() into the served HTML, and the tests import the very same function.
// Nothing inside the factory may reference module scope.

export type RosterRow = {
  line: number;
  handle: string;
  name: string;
  ok: boolean;
  reason?: string;
};

export type RosterPreview =
  | { ok: false; error: string }
  | { ok: true; rows: RosterRow[]; valid: number; invalid: number; hasName: boolean };

export type RowResult = { state: "added" | "exists" | "failed"; reason?: string };

export function rosterCsvKit() {
  /** One class, not a school: the register row caps an import at 200 rows. */
  const MAX_ROWS = 200;
  /** 200 rows of a 64-character handle and a short name fit easily; anything larger is not a roster. */
  const MAX_BYTES = 64 * 1024;
  /** The handle rule the existing single-add form states: lowercase letters, digits, hyphen. */
  const HANDLE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const MAX_NAME = 40;
  /** A cell a spreadsheet would run as a formula (CSV injection). Such a row is shown as text and never sent. */
  const FORMULA = /^[=+\-@\t\r]/;
  const CONTROL = /[\u0000-\u001f\u007f]/;
  /** Format characters (zero-width, bidi controls, BOM, …): invisible, so they must not hide a formula or reorder a name. */
  const FORMAT = /\p{Cf}/gu;
  /** What a spreadsheet would see first: compatibility forms folded (＝ → =), format characters removed, leading space dropped. */
  const formulaView = (c: string) => c.normalize("NFKC").replace(FORMAT, "").trimStart();
  const COLUMNS = ["handle", "name"];

  /** RFC 4180 records with the physical line each starts on. BOM, CRLF/LF/CR and quoted "" are handled. */
  function parseRecords(text: string): { ok: true; records: { line: number; cells: string[] }[] } | { ok: false; error: string } {
    let s = String(text ?? "");
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const records: { line: number; cells: string[] }[] = [];
    let cells: string[] = [], cell = "", quoted = false, wasQuoted = false, line = 1, start = 1, i = 0;
    const endCell = () => { cells.push(wasQuoted ? cell : cell.trim()); cell = ""; wasQuoted = false; };
    const endRecord = () => { endCell(); records.push({ line: start, cells }); cells = []; };
    while (i < s.length) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        if (ch === "\r" || ch === "\n") { line++; if (ch === "\r" && s[i + 1] === "\n") { cell += "\n"; i += 2; continue; } }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell.trim() === "" && !wasQuoted) { quoted = true; wasQuoted = true; cell = ""; i++; continue; }
      if (ch === '"' && wasQuoted) return { ok: false, error: line + "번째 줄: 따옴표가 닫힌 뒤에 글자가 더 있어요." };
      if (ch === ",") { if (wasQuoted && cell.trim() !== "") return { ok: false, error: line + "번째 줄: 따옴표가 닫힌 뒤에 글자가 더 있어요." }; endCell(); i++; continue; }
      if (ch === "\r" || ch === "\n") {
        endRecord();
        i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
        line++; start = line; continue;
      }
      if (wasQuoted && ch !== " " && ch !== "\t") return { ok: false, error: line + "번째 줄: 따옴표가 닫힌 뒤에 글자가 더 있어요." };
      cell += ch; i++;
    }
    if (quoted) return { ok: false, error: start + "번째 줄에서 연 따옴표가 닫히지 않았어요." };
    if (cell !== "" || wasQuoted || cells.length) endRecord();
    return { ok: true, records };
  }

  /**
   * File bytes → text. UTF-8 first (with or without BOM); Korean Excel's plain "CSV" is CP949, so bytes that are
   * not valid UTF-8 are read as EUC-KR instead of turning every Hangul name into replacement characters.
   */
  function decode(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(view); }
    catch { return new TextDecoder("euc-kr").decode(view); }
  }

  const isEmpty = (cells: string[]) => cells.every((c) => c === "");

  /** File-level problems refuse the whole input; row-level problems mark only that row. Nothing is truncated. */
  function preview(text: string): RosterPreview {
    const raw = String(text ?? "");
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return { ok: false, error: "파일이 너무 커요. 64KB까지 받아요." };
    const parsed = parseRecords(raw);
    if (!parsed.ok) return parsed;
    const records = parsed.records.filter((r) => !isEmpty(r.cells));
    if (!records.length) return { ok: false, error: "내용이 없어요. 첫 줄에 handle 머리글을 쓰고 다음 줄부터 학생을 적어 주세요." };
    const header = records[0]!.cells.map((c) => c.normalize("NFC").toLowerCase());
    const unknown = header.filter((h) => !COLUMNS.includes(h));
    if (unknown.length) return { ok: false, error: "모르는 열이 있어요: " + unknown.map((h) => h || "(빈 머리글)").join(", ") + ". handle, name 열만 받아요. 다른 열은 지우고 다시 넣어 주세요." };
    if (new Set(header).size !== header.length) return { ok: false, error: "같은 머리글이 두 번 있어요. handle, name은 한 번씩만 써 주세요." };
    const hi = header.indexOf("handle"), ni = header.indexOf("name");
    if (hi < 0) return { ok: false, error: "첫 줄에 handle 머리글이 없어요. 예: handle,name" };
    const data = records.slice(1);
    if (!data.length) return { ok: false, error: "머리글 아래에 학생 줄이 없어요." };
    if (data.length > MAX_ROWS) return { ok: false, error: "한 번에 " + MAX_ROWS + "줄까지 받아요. 지금 " + data.length + "줄이에요. 나눠서 넣어 주세요." };
    const seen = new Map<string, number>();
    const rows: RosterRow[] = data.map(({ line, cells }) => {
      const handle = cells[hi] ?? "", name = ni < 0 ? "" : (cells[ni] ?? "").normalize("NFC").replace(FORMAT, "");
      const row: RosterRow = { line, handle, name, ok: false };
      if (cells.length !== header.length) row.reason = "칸 수가 머리글과 달라요 (" + cells.length + "칸, 머리글 " + header.length + "칸).";
      else if (cells.some((c) => FORMULA.test(c) || FORMULA.test(formulaView(c)))) row.reason = "=, +, -, @로 시작하는 칸이 있어요. 수식일 수 있어서 이 줄은 보내지 않아요.";
      else if (cells.some((c) => CONTROL.test(c))) row.reason = "칸 안에 줄바꿈이나 보이지 않는 글자가 있어요.";
      else if (!handle) row.reason = "handle이 비어 있어요.";
      else if (!HANDLE.test(handle)) row.reason = "handle은 영문 소문자·숫자·하이픈(-)만, 64자까지 쓸 수 있어요.";
      else if (seen.has(handle)) row.reason = seen.get(handle) + "번째 줄과 같은 handle이에요.";
      else if (name.length > MAX_NAME) row.reason = "이름은 " + MAX_NAME + "자까지예요.";
      else { row.ok = true; seen.set(handle, line); }
      return row;
    });
    const valid = rows.filter((r) => r.ok).length;
    return { ok: true, rows, valid, invalid: rows.length - valid, hasName: ni >= 0 };
  }

  /** Exactly what the single-add form sends: handles only. Names stay in this browser tab. */
  function requestBody(handles: string[]): { users: string[] } {
    // Only valid handle strings pass. Handing it preview rows (which carry names) throws instead of serializing a name.
    for (const h of handles) if (typeof h !== "string" || !HANDLE.test(h)) throw new TypeError("requestBody takes handle strings only");
    return { users: [...handles] };
  }

  /**
   * One answer → one result per sent handle.
   * `answer` is { status, body } from the append call, or { network: true } when no answer arrived.
   * `mapError` turns a server message into the page's Korean wording (the page passes its mapServerError).
   */
  function mapAppend(sent: string[], answer: { status?: number; body?: any; network?: boolean }, mapError: (m: string) => string = (m) => m): Map<string, RowResult> {
    const out = new Map<string, RowResult>();
    const all = (reason: string) => { for (const h of sent) out.set(h, { state: "failed", reason }); return out; };
    const unknown = "결과를 확인하지 못했어요. 다시 보내도 같은 학생이 두 번 등록되지는 않아요.";
    if (answer.network || typeof answer.status !== "number") return all(unknown);
    const body = answer.body && typeof answer.body === "object" ? answer.body : {};
    const err = body.error, message = typeof err === "string" ? err : err && typeof err.message === "string" ? err.message : "";
    if (answer.status >= 500) return all(unknown);
    if (answer.status >= 200 && answer.status < 300) {
      const added = body.added;
      if (!Array.isArray(added) || added.some((h: unknown) => typeof h !== "string" || !sent.includes(h as string))) return all("서버 응답에서 추가 여부를 읽지 못했어요. 다시 보내도 같은 학생이 두 번 등록되지는 않아요.");
      for (const h of sent) out.set(h, added.includes(h) ? { state: "added" } : { state: "exists" });
      return out;
    }
    // A 4xx from roster/append is decided before the roster is written: nobody in this request was added.
    if (body.code === "synthetic_handle_required" && Array.isArray(body.refused)) {
      for (const h of sent) out.set(h, body.refused.includes(h)
        ? { state: "failed", reason: "연습용 수업이라 synthetic-으로 시작하는 handle만 받아요." }
        : { state: "failed", reason: "같이 보낸 다른 줄이 거절되어 이 줄도 추가되지 않았어요." });
      return out;
    }
    if (/would exceed/.test(message)) return all("명단이 최대 인원을 넘게 되어 아무도 추가되지 않았어요. " + message.replace(/^.*exceed\s*/, "최대 "));
    return all((message ? mapError(message) : "서버가 거절했어요 (" + answer.status + ").") + " 이 요청에서는 아무도 추가되지 않았어요.");
  }

  /** A retry's answer replaces only the rows it carried; every other row keeps its earlier result. */
  function merge(prev: Map<string, RowResult>, next: Map<string, RowResult>): Map<string, RowResult> {
    const out = new Map(prev);
    for (const [h, r] of next) out.set(h, r);
    return out;
  }

  /** The rows "실패한 줄만 다시" sends, in the order they were first sent. */
  function failed(order: string[], results: Map<string, RowResult>): string[] {
    return order.filter((h) => results.get(h)?.state === "failed");
  }

  function counts(order: string[], results: Map<string, RowResult>) {
    const c = { added: 0, exists: 0, failed: 0 };
    for (const h of order) { const s = results.get(h)?.state; if (s) c[s]++; }
    return c;
  }

  return { MAX_ROWS, MAX_BYTES, decode, parseRecords, preview, requestBody, mapAppend, merge, failed, counts };
}

export const ROSTER_CSV_SCRIPT =
  "const rosterCsvKit=((__name)=>(" + rosterCsvKit.toString() + ")())((f)=>f);";
