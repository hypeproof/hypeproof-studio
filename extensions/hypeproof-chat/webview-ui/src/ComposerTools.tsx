import { useEffect, useRef, useState } from 'react';
import type { TurnToolMode } from '../../src/turnTools';
import { denialCopy } from '../../src/denialSource';
import { ChatIcon } from './ChatDetails';

/** Selection belongs to the next draft. Execution status comes from host tool events. */
export function ComposerTools({ mode, onMode, webSearch, locked, onAttach, onAttachFile, webSearchItem = true }: {
  mode: TurnToolMode;
  onMode: (mode: TurnToolMode) => void;
  webSearch?: { available: boolean; reason?: string };
  locked: boolean;
  onAttach?: () => void;
  /** CGP-CHAT-R-011 — attach a work-folder text file to the next message. */
  onAttachFile?: () => void;
  /** False on a classroom seat, whose menu carries only the file item. */
  webSearchItem?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const reason = locked ? '예약한 메시지를 보내거나 입력창으로 가져온 뒤 변경할 수 있습니다.' : webSearch?.reason || denialCopy({ source: 'unknown', feature: '웹 검색' }, 'neutral');
  return <div ref={root} className="hps-composer-tools">
    <button ref={trigger} type="button" className="hps-tool-trigger" aria-label="도구 열기" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><ChatIcon kind="plus" /></button>
    {open && <div ref={menu} className="hps-tools-menu" role="menu" aria-label="메시지 도구" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); close(); if (!event.shiftKey) root.current?.closest('.hps-input')?.querySelector('textarea')?.focus({ preventScroll: true }); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      {onAttach && <button type="button" role="menuitem" onClick={() => { close(); onAttach(); }}><ChatIcon kind="image" /><span>이미지 첨부<small>이 메시지에 사진이나 화면 추가</small></span></button>}
      {onAttachFile && <button type="button" role="menuitem" onClick={() => { close(); onAttachFile(); }}><ChatIcon kind="file" /><span>작업 폴더 파일 붙이기<small>글로 된 파일 내용을 다음 메시지에 함께 보내요</small></span></button>}
      {webSearchItem && <button type="button" role="menuitemcheckbox" aria-checked={mode === 'web-search'} aria-disabled={locked || !webSearch?.available} onClick={() => {
        if (locked || !webSearch?.available) return;
        onMode(mode === 'web-search' ? 'auto' : 'web-search'); close(); root.current?.closest('.hps-input')?.querySelector('textarea')?.focus({ preventScroll: true });
      }}><ChatIcon kind="globe" /><span>웹 검색<small>{locked || !webSearch?.available ? reason : '웹 자료를 찾아 답변하도록 요청'}</small></span>{mode === 'web-search' && <ChatIcon kind="check" />}</button>}
    </div>}
  </div>;
}

export function SelectedTool({ locked, onClear }: { locked: boolean; onClear: () => void }) {
  return <button type="button" className="hps-selected-tool" disabled={locked} onClick={onClear} aria-label="웹 검색 선택 해제" title={locked ? '예약 메시지를 먼저 처리해 주세요' : '이번 메시지의 웹 검색 선택 해제'}><ChatIcon kind="globe" /><span>웹 검색</span><span aria-hidden="true">×</span></button>;
}
