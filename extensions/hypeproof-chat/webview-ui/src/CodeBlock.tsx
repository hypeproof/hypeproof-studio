import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChatIcon, useConfirmedCopy } from './ChatDetails';
import './codeBlock.css';

/**
 * CGP-CHAT-R-008 (REQ-STUDIO-CODE-BLOCK-TOOLS): every code block offers 복사 and 줄 바꿈.
 * Copy writes exactly this block's text with the same confirmed feedback as the answer copy.
 *
 * The wrap choice is remembered per block for this webview session only (never persisted).
 * A block's key is its position, not its text: conversation (activity + task) › message id ›
 * answer segment (or a reply-choice question's before/after text) › block offset. So two identical
 * blocks, the same snippet in another message or task, never share a choice, and a block that is
 * still streaming keeps its key as it grows. Rerenders and remounts (task switch and back) keep the
 * choice, a reload forgets it. A key needs at least the conversation and the message level; a
 * block rendered with less (no scope, or a conversation scope only) keeps its choice only while it
 * is mounted, so a surface that forgets its message scope cannot share choices across messages.
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

type Scope = { key: string; depth: number } | null;
const ScopeContext = createContext<Scope>(null);
/** Conversation + message: the least a key needs. */
const MIN_KEY_DEPTH = 2;

/**
 * One level of a block's key. `root` starts a conversation scope; nested scopes append their id.
 * A missing id anywhere leaves the blocks below without a key (mount-local state only).
 */
export function CodeBlockScope({ id, root = false, children }: { id: string | null | undefined; root?: boolean; children: ReactNode }) {
  const parent = useContext(ScopeContext);
  const value: Scope = id == null || id === '' ? null : root ? { key: id, depth: 1 } : parent == null ? null : { key: `${parent.key}|${id}`, depth: parent.depth + 1 };
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const CODE_COPY_LABEL = '코드 복사';
export const WRAP_LABEL = '줄 바꿈';
export const COPY_DONE_STATUS = '코드를 복사했습니다';
export const COPY_FAILED_STATUS = '복사하지 못했습니다. 코드를 선택해 복사해 주세요.';

export function CodeBlockTools({ code, wrap, onToggleWrap }: { code: string; wrap: boolean; onToggleWrap: () => void }) {
  const [state, copy] = useConfirmedCopy(code);
  // An empty block has nothing to copy: writing "" would clear the learner's clipboard.
  const empty = code.trim() === '';
  return <div className="hps-codeblock-tools">
    <button type="button" className="hps-codeblock-tool" onClick={copy} disabled={empty} aria-label={CODE_COPY_LABEL} title={CODE_COPY_LABEL}>
      <ChatIcon kind={state === 'copied' ? 'check' : 'copy'} size={14} /><span>{state === 'copied' ? '복사됨' : '복사'}</span>
    </button>
    {/* A toggle keeps one fixed name; aria-pressed carries the state (WAI-ARIA APG). */}
    <button type="button" className="hps-codeblock-tool" onClick={onToggleWrap} aria-label={WRAP_LABEL} aria-pressed={wrap} title={WRAP_LABEL}>
      <span>{WRAP_LABEL}</span>
    </button>
    <span role="status" className="hps-copy-status hps-codeblock-status">{state === 'copied' ? COPY_DONE_STATUS : state === 'failed' ? COPY_FAILED_STATUS : ''}</span>
  </div>;
}

/**
 * A code block with its tools above the code. `defaultWrap` keeps each surface's existing
 * behaviour: the code pill body does not wrap (`white-space: pre`), prose `<pre>` wraps.
 * `blockKey` is the block's position inside the nearest scope. `children` replaces the default
 * `<pre>` when the caller already renders one (Markdown).
 */
export function CodeBlock({ code, defaultWrap, blockKey, preClassName, children }: { code: string; defaultWrap: boolean; blockKey?: string; preClassName?: string; children?: ReactNode }) {
  const scope = useContext(ScopeContext);
  const key = scope != null && scope.depth >= MIN_KEY_DEPTH && blockKey ? `${scope.key}|${blockKey}` : null;
  const [wrap, setWrap] = useState(() => (key ? rememberedWrap(key, defaultWrap) : defaultWrap));
  const toggle = () => setWrap((current) => { const next = !current; if (key) rememberWrap(key, next); return next; });
  return <div className="hps-codeblock" data-wrap={wrap ? 'on' : 'off'}>
    <CodeBlockTools code={code} wrap={wrap} onToggleWrap={toggle} />
    {children ?? <pre className={preClassName}>{code}</pre>}
  </div>;
}
