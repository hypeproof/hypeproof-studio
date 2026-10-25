/**
 * CGP-CHAT-R-028 (REQ-STUDIO-MY-QUESTIONS): the "내 질문" jump list in the task header.
 * Pure rules only: which lines count as the learner's prompts, how each one is shortened to a
 * single plain first line, and when the list is offered at all. The webview draws and jumps.
 */

/** The list is offered only from this many drawn user turns on. */
export const MY_QUESTIONS_MIN = 4;
/** Longest first line, in characters (grapheme clusters), before it is cut. */
export const MY_QUESTION_LINE_MAX = 60;
/** Longest first line in UTF-16 code units, whatever its cluster count. */
export const MY_QUESTION_UNITS_MAX = 240;
/** Appended to a cut line. */
export const MY_QUESTION_CUT_MARK = '…';
/** Set on a drawn user message row; the value is the message id (the jump target). */
export const MY_QUESTION_ATTR = 'data-my-question';
/** The header button's label and the list's name. */
export const MY_QUESTIONS_LABEL = '내 질문';
/** A prompt with no text of its own. */
export const MY_QUESTION_IMAGE_ONLY = '이미지만 보낸 질문';
export const MY_QUESTION_EMPTY = '내용 없는 질문';

export interface MyQuestionSource {
  id: string;
  role: string;
  content: string;
  images?: readonly string[];
}

export interface MyQuestion {
  id: string;
  /** 1-based position among the drawn user turns. */
  n: number;
  line: string;
}

// C0/C1 controls (tab, VT and FF collapse as whitespace; newlines are split on first), bidi
// embeddings, overrides, isolates and marks, the zero-width space and the BOM. ZWJ/ZWNJ stay: they
// hold emoji and scripts together. Learner text is shown as one plain line, never steered.
const INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;

// Characters that draw nothing on their own: a line made only of these is not a visible line.
const BLANK = /[\s\u00AD\u115F\u1160\u200C\u200D\u3164\uFFA0]/g;
/** Longest stretch of a prompt that is scanned for its first line (a whole long paste is never split). */
const SCAN_MAX = 20000;

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.segment) : Array.from(text);
}

/**
 * The first line of the learner's own words in one prompt. A leading `> ` block is a quoted
 * answer (CGP-CHAT-R-007), not the learner's question, so it is skipped when anything follows it.
 */
export function myQuestionLine(content: string, images?: readonly string[]): string {
  const lines = String(content ?? '').slice(0, SCAN_MAX).split(LINE_BREAK)
    .map(line => line.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim())
    .filter(line => line.replace(BLANK, '').length > 0);
  const own = lines.find(line => !line.startsWith('>')) ?? lines[0]?.replace(/^(>\s*)+/, '').trim();
  if (!own || !own.replace(BLANK, '')) return images && images.length ? MY_QUESTION_IMAGE_ONLY : MY_QUESTION_EMPTY;
  // At most MY_QUESTION_LINE_MAX clusters and MY_QUESTION_UNITS_MAX code units (a combining-mark flood
  // is one cluster), never splitting a cluster.
  const chars = graphemes(own.slice(0, MY_QUESTION_UNITS_MAX * 2));
  let line = '', count = 0;
  for (const c of chars) {
    if (count === MY_QUESTION_LINE_MAX || line.length + c.length > MY_QUESTION_UNITS_MAX) return line.trimEnd() + MY_QUESTION_CUT_MARK;
    line += c; count++;
  }
  return own.length > line.length ? line.trimEnd() + MY_QUESTION_CUT_MARK : line;
}

/**
 * The numbered list for the drawn transcript (one version per prompt, as on screen), or an empty
 * list when it has fewer than MY_QUESTIONS_MIN user turns.
 */
export function myQuestions(items: readonly MyQuestionSource[]): MyQuestion[] {
  const users = items.filter(item => item.role === 'user');
  if (users.length < MY_QUESTIONS_MIN) return [];
  return users.map((item, index) => ({ id: item.id, n: index + 1, line: myQuestionLine(item.content, item.images) }));
}
