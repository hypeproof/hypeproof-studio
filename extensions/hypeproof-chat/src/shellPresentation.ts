import * as path from 'node:path';

/** `folder` is present only when the host knows it; the SDK Bash input carries no working directory. */
export interface ShellPresentation { purpose: string; command: string; folder?: string; collapsed: boolean }
export const SHELL_PURPOSE_MAX = 500;
export const SHELL_COMMAND_MAX = 2000;
/**
 * Characters that can hide or reorder how untrusted text reads: C0/C1 controls, line/paragraph
 * separators, bidi embeddings/overrides/isolates, the LRM/RLM/ALM marks, zero-width characters,
 * invisible operators, the soft hyphen, the BOM, the combining grapheme joiner, the Hangul
 * fillers, the interlinear annotation marks and the tag block. Each becomes a visible space.
 */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;
/** Never end (or start) a slice on half of a surrogate pair. */
const head = (text: string, n: number) => { const s = text.slice(0, n); return /[\ud800-\udbff]$/.test(s) ? s.slice(0, -1) : s; };
const tail = (text: string, n: number) => { const s = n > 0 ? text.slice(-n) : ''; return /^[\udc00-\udfff]/.test(s) ? s.slice(1) : s; };
/**
 * Display-only sanitization; never feed this text back to a command interpreter.
 * Text over `limit` keeps its start AND its end around a visible Korean marker, so padding a
 * command can never hide its tail (e.g. `echo "<1990 chars>"; curl … | sh`). The result,
 * marker included, is at most `limit` UTF-16 units.
 */
export function shellText(value: unknown, fallback: string, limit = SHELL_COMMAND_MAX): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const clean = value.replace(HIDDEN, ' ');
  if (clean.length <= limit) return clean.trim() ? clean : fallback;
  const widest = shellOmission(clean.length);
  const budget = limit - widest.length;
  const end = tail(clean, Math.floor(budget / 3));
  const start = head(clean, budget - Math.floor(budget / 3));
  const omitted = Array.from(clean.slice(start.length, clean.length - end.length)).length;
  return `${start}${shellOmission(omitted)}${end}`;
}
/** The marker that stands where the middle of an over-long purpose or command was left out. */
export function shellOmission(omitted: number): string { return ` … (가운데 ${omitted}자 생략) … `; }
/** A folder relative to the coach root, for a directory the host itself knows (never model input). */
export function shellFolder(root: string | undefined, dir: string | undefined): string {
  if (!root || !dir) return '폴더 확인 불가';
  const relative = path.relative(root, path.resolve(root, dir));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? '작업 폴더 밖' : relative.split(path.sep).join('/') || '.';
}
/**
 * The Bash/PowerShell tool input has `command` and `description` but no working directory, and the
 * shell session keeps `cd` between calls, so no folder is claimed for a tool call.
 */
export function shellPresentation(name: string, raw: unknown, collapsed: boolean): ShellPresentation | undefined {
  if (name !== 'Bash' && name !== 'PowerShell') return;
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { purpose: shellText(input.description, '실행 목적이 제공되지 않았어요', SHELL_PURPOSE_MAX), command: shellText(input.command, '명령 확인 불가'), collapsed };
}
