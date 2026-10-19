import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postToHost } from './vscode';

/** Stable element types preserve table scroll and link focus across text updates. */
const components: Components = {
  a: ({ href, children }) => /^https?:\/\//i.test(href ?? '')
    ? <a href={href} onClick={event => { event.preventDefault(); postToHost({ type: 'openExternal', url: href! }); }}>{children}</a>
    : <span>{children}</span>,
  // A model-supplied image URL is not authorization to fetch it.
  img: ({ alt }) => <span>{alt ? `[이미지: ${alt}]` : '[이미지]'}</span>,
  table: ({ children }) => <div className="hps-markdown-table" role="region" aria-label="대화의 표" tabIndex={0}><table>{children}</table></div>,
  input: ({ checked }) => <span aria-label={checked ? '완료 항목' : '미완료 항목'}>{checked ? '☑' : '☐'}</span>,
};

/** Render prose as React elements. Code fences keep their existing disclosure
 * in ChatPanel; model HTML and remote images must never execute or load here. */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return (
    <div className="hps-prose">
      <Markdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        components={components}
      >{text}</Markdown>
    </div>
  );
});
