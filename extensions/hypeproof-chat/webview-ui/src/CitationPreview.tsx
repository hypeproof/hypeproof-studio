import { createContext, useContext } from 'react';
import { ChatIcon, type IconSize } from './ChatDetails';
import type { Citation } from '../../src/protocol';
import { postToHost } from './vscode';
import './citationPreview.css';

export interface CitationPreviewController {
  previewSource: (citation: Citation, trigger: HTMLElement, messageId?: string) => void;
  openSource: (url: string) => void;
  preview: { url: string; messageId?: string } | null;
}

/** One workspace owns the preview; message racks never mount competing popovers. */
export const CitationPreviewContext = createContext<CitationPreviewController | null>(null);
export const useCitationPreview = () => useContext(CitationPreviewContext);

export function citationAddress(url: string): URL | null {
  try {
    if (typeof url !== 'string' || url.length > 8192 || url !== url.trim() || /[\u0000-\u0020\u007f]/.test(url)) return null;
    const address = new URL(url);
    return (address.protocol === 'https:' || address.protocol === 'http:') && !address.username && !address.password ? address : null;
  } catch { return null; }
}

/** The sources panel's icons, drawn from the one stroke set (REQ-STUDIO-STROKE-ICONS). */
export function SourceIcon({ kind, size = 20 }: { kind: 'open' | 'pin' | 'close' | 'source' | 'back'; size?: IconSize }) {
  const map = { open: 'open-window', pin: 'pin', close: 'close', source: 'source', back: 'return' } as const;
  return <ChatIcon kind={map[kind]} size={size} />;
}

/** These are message-level sources, not invented anchors for individual claims. */
export function CitationRack({ citations, messageId }: { citations: Citation[]; messageId?: string }) {
  const workspace = useCitationPreview();
  if (!citations.length) return null;
  return <div className="cp-rack" role="list" aria-label="이 답변의 출처">
    {citations.map((citation, index) => {
      const address = citationAddress(citation.url);
      const expanded = workspace?.preview?.url === citation.url && workspace.preview.messageId === messageId;
      return <span key={`${citation.url}-${index}`} role="listitem"><button
        type="button"
        className="cp-citation"
        disabled={!address}
        aria-label={`${citation.title || address?.hostname || '출처'}${address ? `, ${address.hostname}, ${workspace ? '출처 미리보기' : '출처 열기'}` : ', 열 수 없는 주소'}`}
        aria-expanded={workspace ? expanded : undefined}
        aria-controls={workspace ? 'task-sources' : undefined}
        data-hp-tooltip={address ? citation.url : '이 출처의 주소를 열 수 없습니다.'}
        onClick={event => {
          if (!address) return;
          if (workspace) workspace.previewSource(citation, event.currentTarget, messageId);
          else postToHost({ type: 'openExternal', url: citation.url });
        }}
      >
        <span className="cp-citation-number" aria-hidden="true">{index + 1}</span>
        <span className="cp-citation-copy"><span className="cp-citation-title">{citation.title || address?.hostname || '출처'}</span><span className="cp-citation-domain">{address?.hostname || '주소 확인 필요'}</span></span>
        <SourceIcon kind="source" size={16} />
      </button></span>;
    })}
  </div>;
}

interface PreviewProps {
  citation: Citation;
  pinned: boolean;
  otherPinned: boolean;
  ephemeral: boolean;
  opening: boolean;
  blocked: boolean;
  opened: boolean;
  returning: boolean;
  error?: string;
  onOpen: () => void;
  onPin: () => void;
  onReturn: () => void;
}

/** Metadata only: no page fetch, fabricated excerpt, screenshot, or inferred claim mapping. */
export function CitationPreview({ citation, pinned, otherPinned, ephemeral, opening, blocked, opened, returning, error, onOpen, onPin, onReturn }: PreviewProps) {
  const address = citationAddress(citation.url);
  return <div className="tw-source-detail cp-preview">
    <div className="tw-source-domain cp-preview-domain"><SourceIcon kind="source" /><span>{address?.hostname || '주소 확인 필요'}</span></div>
    <h3 id="task-source-title" tabIndex={-1}>{citation.title || address?.hostname || '출처'}</h3>
    <p className="cp-source-context">이 답변에 포함된 출처입니다.</p>
    <p className="cp-source-url" dir="ltr" aria-label="출처 주소">{citation.url}</p>
    <div className="cp-preview-actions">
      <button type="button" className="tw-open-source" disabled={!address} aria-disabled={blocked || undefined} aria-busy={opening || undefined} onClick={() => { if (!blocked) onOpen(); }}><span>{opening ? '브라우저 여는 중…' : '브라우저에서 열기'}</span><SourceIcon kind="open" /></button>
      <button type="button" className="tw-quiet tw-pin" disabled={!address} aria-pressed={pinned} onClick={onPin}><SourceIcon kind="pin" /><span>{pinned ? '고정 해제' : '이 자료 고정'}</span></button>
      {opened && <button type="button" className="tw-quiet cp-return" aria-disabled={returning || undefined} aria-busy={returning || undefined} onClick={() => { if (!returning) onReturn(); }}><SourceIcon kind="back" /><span>{returning ? '대화로 돌아가는 중…' : '대화로 돌아가기'}</span></button>}
    </div>
    {error && <p className="cp-source-error" role="alert">{error}</p>}
    {opening && <p className="cp-source-status" role="status">오른쪽 브라우저가 열리는지 확인하고 있습니다.</p>}
    <p className="tw-source-policy">{pinned ? '새 출처가 와도 이 자료를 유지합니다.' : otherPinned ? '기존에 고정한 자료는 그대로 유지됩니다.' : ephemeral ? '고정하면 이 자료를 계속 모아 둘 수 있습니다.' : '최근 출처를 따라갑니다.'}</p>
  </div>;
}
