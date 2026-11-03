// CGP-CHAT-R-022 (REQ-STUDIO-ANSWER-MATH): the KaTeX half of answer math. mathRender.ts loads this
// module with a dynamic import on the first math span, so KaTeX and the HTML parser live in their
// own chunk and an answer without math never loads them.
import katex from 'katex';
import { fromHtml } from 'hast-util-from-html';
import type { HNode } from './mathRender';

/** Typeset `tex`, or null when KaTeX refuses it. A refusal is either a parse error (KaTeX throws)
 * or a command that asks for trust (\href, \url, \includegraphics, \htmlClass/Style/Data/Id).
 * Trust is never granted: the callback only records that it was asked, and the caller then shows
 * the exact raw source instead of KaTeX's red error glyph with the argument dropped. */
export function typesetUncached(tex: string, display: boolean): HNode[] | null {
  let refused = false;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: () => { refused = true; return false; },
      strict: 'ignore',
      output: 'htmlAndMathml',
      maxSize: 20,
      maxExpand: 500,
    });
  } catch {
    return null;
  }
  if (refused) return null;
  return fromHtml(html, { fragment: true }).children as HNode[];
}
