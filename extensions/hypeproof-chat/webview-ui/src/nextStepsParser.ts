/**
 * Coach-driven next-step chips. A reply that ENDS with this block offers up to three follow-up
 * prompts as chips (compact coach layout only, `ux.coach_layout === 'compact'`):
 *
 *   다음에 해볼 만한 것        (a line of exactly this text, an optional trailing colon)
 *   → first step
 *   → second step
 *
 * Anything else (extra text after the block, a fourth step, a link, markup, control characters)
 * is not a block and the text stays ordinary prose. Modelled on replyChoiceParser.ts.
 */
export interface NextSteps { body: string; steps: string[] }

/** The header line, trimmed, with an optional ASCII colon. */
const HEADER = /^다음에 해볼 만한 것:?$/;
const STEP_PREFIX = '→ ';
const MAX_STEPS = 3;
const MAX_STEP_CHARS = 60;

// Same character classes as replyChoiceParser: Cf covers bidi marks and overrides, zero-width and
// invisible characters (a ZWJ inside an emoji too), soft hyphen and tag characters. They are checked on the
// block's own lines only: the body is drawn as it is and a ZWJ emoji in it must not switch the feature off.
// A step may keep none of the controls.
const UNSAFE_BLOCK = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;
const UNSAFE_STEP = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

function validStep(step: string): boolean {
  const length = [...step].length;
  if (length < 1 || length > MAX_STEP_CHARS) return false;
  return !UNSAFE_STEP.test(step) && !/[<>`]/.test(step) && !/http/i.test(step) && !/\[[^\]]*\]\(/.test(step)
    && !/\*\*|__/.test(step) && !/^www\./i.test(step);
}

/** True when a fenced code block (3 or more backticks or tildes, closed by at least as many) is still open after `lines`. */
function fenceOpenAfter(lines: string[]): boolean {
  let open: { char: string; length: number } | null = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const char = m[1][0];
    if (open) { if (char === open.char && m[1].length >= open.length && !m[2].trim()) open = null; }
    else if (!(char === '`' && m[2].includes('`'))) open = { char, length: m[1].length };
  }
  return open !== null;
}

/** Index of the last header line, or -1. A header inside an open code fence does not count. */
function lastHeaderLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!HEADER.test(lines[i].trim())) continue;
    return fenceOpenAfter(lines.slice(0, i)) ? -1 : i;
  }
  return -1;
}

const bodyBefore = (lines: string[], header: number) => lines.slice(0, header).join('\n').trimEnd();

/** `{ body, steps }` when the text ends with a well-formed block, otherwise null. */
export function nextSteps(text: string): NextSteps | null {
  if (!text) return null;
  const lines = text.split('\n');
  const header = lastHeaderLine(lines);
  if (header < 0 || UNSAFE_BLOCK.test(lines.slice(header).join('\n'))) return null;
  const steps: string[] = [];
  for (const raw of lines.slice(header + 1)) {
    const line = raw.replace(/\r$/, '').trimEnd();
    if (!line.trim()) continue;
    if (!line.startsWith(STEP_PREFIX)) return null;
    const step = line.slice(STEP_PREFIX.length).trim();
    if (!validStep(step)) return null;
    steps.push(step);
  }
  if (steps.length < 1 || steps.length > MAX_STEPS) return null;
  return { body: bodyBefore(lines, header), steps };
}

/**
 * The text a bubble draws. A finished block is cut off. While the answer streams, a block that has
 * only partly arrived is cut off too, so its lines never flash as prose: the header line is
 * complete (followed by a newline) and every non-empty line after it starts with an arrow.
 */
export function nextStepsBody(text: string, streaming: boolean): string {
  const found = nextSteps(text);
  if (found) return found.body;
  if (!streaming || !text) return text;
  const lines = text.split('\n');
  const header = lastHeaderLine(lines);
  // The last array element is the unterminated line being typed; a header must already be complete.
  if (header < 0 || header >= lines.length - 1 || UNSAFE_BLOCK.test(lines.slice(header).join('\n'))) return text;
  const tail = lines.slice(header + 1).filter(line => line.trim());
  return tail.every(line => line.trimStart().startsWith('→')) ? bodyBefore(lines, header) : text;
}
