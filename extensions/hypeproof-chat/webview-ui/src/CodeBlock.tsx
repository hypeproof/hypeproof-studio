import { useState, type ReactNode } from 'react';
import { ChatIcon, useConfirmedCopy } from './ChatDetails';
import './codeBlock.css';

/**
 * CGP-CHAT-R-008 (REQ-STUDIO-CODE-BLOCK-TOOLS): every code block offers 복사 and 줄 바꿈.
 * Copy writes exactly this block's text with the same confirmed feedback as the answer copy.
 * The wrap choice is remembered per block for this webview session only (never persisted):
 * re-rendering, streaming more text or remounting the transcript keeps it, a reload forgets it.
 * Blocks are keyed by their text, so two identical blocks share one choice.
 */
const wrapMemory = new Map<string, boolean>();
const WRAP_MEMORY_LIMIT = 200;

export function rememberedWrap(key: string, fallback: boolean): boolean {
  return wrapMemory.get(key) ?? fallback;
}

export function rememberWrap(key: string, wrap: boolean): void {
  wrapMemory.delete(key);
  wrapMemory.set(key, wrap);
  // Oldest choices go first; the cap only bounds memory in a very long session.
  while (wrapMemory.size > WRAP_MEMORY_LIMIT) wrapMemory.delete(wrapMemory.keys().next().value as string);
}

/** Test hook: forget every remembered choice. */
export function resetWrapMemory(): void { wrapMemory.clear(); }

export const CODE_COPY_LABEL = '코드 복사';
export const wrapLabel = (wrap: boolean) => (wrap ? '줄 바꿈 끄기' : '줄 바꿈 켜기');

export function CodeBlockTools({ code, wrap, onToggleWrap }: { code: string; wrap: boolean; onToggleWrap: () => void }) {
  const [state, copy] = useConfirmedCopy(code);
  return <div className="hps-codeblock-tools">
    <button type="button" className="hps-codeblock-tool" onClick={copy} aria-label={CODE_COPY_LABEL} title={CODE_COPY_LABEL}>
      <ChatIcon kind={state === 'copied' ? 'check' : 'copy'} size={14} /><span>{state === 'copied' ? '복사됨' : '복사'}</span>
    </button>
    <button type="button" className="hps-codeblock-tool" onClick={onToggleWrap} aria-label={wrapLabel(wrap)} aria-pressed={wrap} title={wrapLabel(wrap)}>
      <span>줄 바꿈</span>
    </button>
    <span role="status" className="hps-copy-status hps-codeblock-status">{state === 'copied' ? '코드를 복사했습니다' : state === 'failed' ? '복사하지 못했습니다. 코드를 선택해 복사해 주세요.' : ''}</span>
  </div>;
}

/**
 * A code block with its tools above the code. `defaultWrap` keeps each surface's existing
 * behaviour: the code pill body does not wrap (`white-space: pre`), prose `<pre>` wraps.
 * `children` replaces the default `<pre>` when the caller already renders one (Markdown).
 */
export function CodeBlock({ code, defaultWrap, preClassName, children }: { code: string; defaultWrap: boolean; preClassName?: string; children?: ReactNode }) {
  const [wrap, setWrap] = useState(() => rememberedWrap(code, defaultWrap));
  const toggle = () => setWrap((current) => { const next = !current; rememberWrap(code, next); return next; });
  return <div className="hps-codeblock" data-wrap={wrap ? 'on' : 'off'}>
    <CodeBlockTools code={code} wrap={wrap} onToggleWrap={toggle} />
    {children ?? <pre className={preClassName}>{code}</pre>}
  </div>;
}
