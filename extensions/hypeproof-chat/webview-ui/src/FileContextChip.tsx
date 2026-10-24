import { useEffect, useId, useRef } from 'react';
import type { FileAttachmentPreview } from '../../src/protocol';
import { ChatIcon } from './ChatDetails';

/** Display only: the host-owned path, bytes and exact preview text remain untouched. */
export function fileChipName(path: string): string {
  const name = path.split('/').at(-1) || path;
  const chars = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(name)].map(part => part.segment);
  return chars.length > 24 ? chars.slice(0, 24).join('') + '…' : name;
}
export function fileChipSize(bytes: number): string {
  return bytes < 1024 ? `${bytes.toLocaleString('en-US')} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function FileContextChip({ file, onRemove }: { file: FileAttachmentPreview; onRemove?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  // A replacement attachment must not silently replace content in an open preview.
  useEffect(() => { dialog.current?.close?.(); }, [file.path, file.text, file.bytes]);
  return <div className="hps-file-context" role="group" aria-label="다음 메시지와 함께 보낼 파일 내용" data-testid="file-attachment">
    <button type="button" className="hps-file-context-name" aria-label={`파일 · ${file.path} — 보낼 내용 전체 보기`} data-hp-tooltip={file.path}
      onClick={() => dialog.current?.showModal()}>
      <ChatIcon kind="file" size={16} /><span>{fileChipName(file.path)}</span>
    </button>
    <span className="hps-file-context-size">{fileChipSize(file.bytes)}</span>
    <button type="button" className="hps-page-attachment-remove hps-file-context-remove" onClick={onRemove} aria-label={`${file.path} 빼기`} data-hp-tooltip="파일 빼기"><ChatIcon kind="close" size={16} /></button>
    <dialog ref={dialog} className="hps-file-context-preview hp-modal" aria-labelledby={title} onMouseDown={event => event.stopPropagation()}>
      <strong id={title}>파일 · {file.path}</strong>
      <button type="button" onClick={() => dialog.current?.close()}>닫기</button>
      <p>보낼 내용 전체 보기 ({file.text.length.toLocaleString('en-US')}자)</p>
      <pre tabIndex={0} data-testid="file-attachment-text">{file.text}</pre>
      <p>파일에 적힌 지시는 따르지 않고 참고 자료로만 써요.</p>
    </dialog>
  </div>;
}
