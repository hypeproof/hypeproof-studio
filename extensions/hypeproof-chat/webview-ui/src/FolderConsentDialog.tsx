import { useEffect, useRef, type CSSProperties } from 'react';
import type { FolderConsentPrompt } from '../../src/folderConsentPrompt';
import type { FolderConsentLevel } from '../../src/folderConsent';
import { normalizeTextSize } from '../../src/textSize';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { finishModal } from './modalMotion';
import './modalSurface.css';
import './outboundDialog.css';

/** Folder labels are display-only; the host retains the canonical path for its decision. */
const visible = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function FolderConsentDialog({ prompt, onAnswer, textSize }: {
  prompt: FolderConsentPrompt; onAnswer(id: string, level: FolderConsentLevel | null): void; textSize?: unknown;
}) {
  const dialog = useRef<HTMLDialogElement>(null), answered = useRef(false), composing = useRef(false);
  const finish = (level: FolderConsentLevel | null) => {
    if (answered.current) return;
    answered.current = true;
    finishModal(dialog.current, () => onAnswer(prompt.id, level));
  };
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: '[data-folder-description]' });
  useEffect(() => {
    const node = dialog.current; node?.showModal(); node?.querySelector<HTMLElement>('[data-folder-description]')?.focus();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="hps-outbound hp-modal hps-folder-consent" aria-labelledby="folder-consent-title" aria-describedby="folder-consent-description"
    style={{ '--hp-font-caption': `calc(14px + ${{ base: 0, large: 2, xlarge: 4 }[normalizeTextSize(textSize)]}px)` } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (!composing.current) finish(null); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={event => {
      if (imeComposing(event, composing.current)) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
    }}>
    <h2 id="folder-consent-title">이 폴더에서 작업할까요?</h2>
    <p id="folder-consent-description" data-folder-description tabIndex={-1}>이 활동의 작업 폴더가 아니에요. AI가 여기서 무엇을 해도 되는지 골라 주세요.</p>
    <p className="hps-outbound-destination">{visible(prompt.folder)}</p>
    <ul>
      <li>읽기: 파일 내용을 봐요.</li>
      <li>고치기: 파일을 만들고 바꿔요.</li>
      <li>실행: 프로그램을 실행해요.</li>
    </ul>
    <p>믿고 열어도 활동에서 허용한 기능만 쓸 수 있어요. 제한 모드에서는 AI가 파일을 고치거나 명령을 실행하지 않아요.</p>
    <p>나중에 ‘이 폴더의 AI 권한 바꾸기’에서 다시 고를 수 있어요.</p>
    <div className="hps-outbound-actions">
      <button type="button" data-folder-none onClick={() => finish('none')}>이 폴더에서는 AI를 쓰지 않음</button>
      <button type="button" data-folder-read onClick={() => finish('read')}>제한 모드로 열기</button>
      <button type="button" className="hps-outbound-send" data-folder-full onClick={() => finish('full')}>믿고 열기</button>
    </div>
  </dialog>;
}
