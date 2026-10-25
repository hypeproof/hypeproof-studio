import { memo, useSyncExternalStore } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
// CGP-CHAT-R-022: KaTeX's own styles and fonts load from index.html (webview-ui/styles/katex.css), so
// the esbuild-based tests that bundle this module never have to resolve font files.
import './mathRender.css';
import { MATH_TAG, installMathCopy, mathElement, mathVersion, rehypeAnswerMath, subscribeMath } from './mathRender';
import { postToHost } from './vscode';
import { CodeBlock } from './CodeBlock';

type HastNode = { type: string; value?: string; children?: HastNode[]; position?: { start?: { offset?: number } } };
/** The raw text of a hast subtree: exactly what the block shows, without a trailing newline. */
export const hastText = (node: HastNode | undefined): string =>
  !node ? '' : node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(hastText).join('');

/** One typeset formula. Memoised on its TeX, so a finished formula is not rendered again while
 * later text of the same answer streams in; the elements themselves come from mathRender's cache. */
const MathFormula = memo(function MathFormula({ tex, display }: { tex: string; display: boolean }) {
  return <>{mathElement(tex, display)}</>;
});

/** Stable element types preserve table scroll and link focus across text updates. */
const components: Components = {
  a: ({ href, children }) => /^https?:\/\//i.test(href ?? '')
    ? <a href={href} onClick={event => { event.preventDefault(); postToHost({ type: 'openExternal', url: href! }); }}>{children}</a>
    : <span>{children}</span>,
  // A model-supplied image URL is not authorization to fetch it.
  img: ({ alt }) => <span>{alt ? `[이미지: ${alt}]` : '[이미지]'}</span>,
  table: ({ children }) => <div className="hps-markdown-table" role="region" aria-label="대화의 표" tabIndex={0}><table>{children}</table></div>,
  // CGP-CHAT-R-008: a code block in prose (indented or `~~~` fence) gets copy and wrap tools;
  // inline `code` does not. Prose blocks already wrap, so wrapping stays on by default.
  // The block's start offset in this text is its key: it stays put while later text streams in.
  pre: ({ node, children }) => {
    const hast = node as HastNode | undefined;
    const offset = hast?.position?.start?.offset;
    return <CodeBlock code={hastText(hast).replace(/\n$/, '')} defaultWrap blockKey={offset == null ? undefined : `pre@${offset}`}><pre>{children}</pre></CodeBlock>;
  },
  ...{ [MATH_TAG]: ({ node }: { node?: { properties?: Record<string, unknown> } }) =>
    <MathFormula tex={String(node?.properties?.dataTex ?? '')} display={node?.properties?.dataDisplay === 'true'} /> } as Components,
  input: ({ checked }) => <span aria-label={checked ? '완료 항목' : '미완료 항목'}>{checked ? '☑' : '☐'}</span>,
};

// Copying a selection that covers rendered math puts its TeX source on the clipboard.
if (typeof document !== 'undefined') installMathCopy(document);

/** Render prose as React elements. ``` fences keep their existing disclosure
 * in ChatPanel (split out before this renders); model HTML and remote images must never execute or load here. */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  // KaTeX loads on the first math span; this renders the text again once it has.
  useSyncExternalStore(subscribeMath, mathVersion, mathVersion);
  return (
    <div className="hps-prose">
      <Markdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]}
        rehypePlugins={[rehypeAnswerMath]}
        components={components}
      >{text}</Markdown>
    </div>
  );
});
