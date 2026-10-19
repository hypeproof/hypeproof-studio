// CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — "수정" on the latest sent prompt, the in-place
// editor, and the version pager. Rules (which line, which version, what the model sees) live in
// src/editResend.ts; this file only draws them.

import { useEffect, useRef, useState } from "react";
import type { VersionPager as Pager } from "../../src/editResend";
import { imeComposing } from "./imeGuard";

export const EDIT_LABEL = "보낸 메시지 수정";
export const REVERT_NOTE = "이전 답변이 바꾼 파일은 그대로예요. 되돌리려면 그 답변의 되돌리기를 쓰세요.";
export const PAGER_TITLE = "버전을 바꿔 봐도 새로 묻지 않아요. 다음 대화는 마지막 버전에서 이어져요.";

export function EditAction({ onEdit }: { onEdit: () => void }) {
  return <button type="button" className="hps-edit-prompt" onClick={onEdit} aria-label={EDIT_LABEL} title={EDIT_LABEL}>수정</button>;
}

/** "‹ 1/2 ›" — switches which version of this prompt and its answer is drawn. Never sends anything. */
export function VersionPager({ pager, onPage }: { pager: Pager; onPage: (index: number) => void }) {
  const { index, count } = pager;
  return <div className="hps-version-pager" role="group" aria-label="메시지 버전" title={PAGER_TITLE}>
    <button type="button" disabled={index === 0} onClick={() => onPage(index - 1)} aria-label="이전 버전">‹</button>
    <span aria-live="polite">{index + 1}/{count}</span>
    <button type="button" disabled={index === count - 1} onClick={() => onPage(index + 1)} aria-label="다음 버전">›</button>
    {index < count - 1 && <span className="hps-version-note">이 버전은 보기만 해요</span>}
  </div>;
}

/**
 * The prompt opened in place. The composer and its saved draft are not touched, so Cancel is
 * exact: nothing changed anywhere. Save hands the text and the kept images to the caller.
 */
export function EditPrompt({ text, images, revertNote, onCancel, onSave }: {
  text: string;
  images: string[];
  revertNote: boolean;
  onCancel: () => void;
  onSave: (text: string, images: string[]) => void;
}) {
  const [value, setValue] = useState(text);
  const [kept, setKept] = useState(images);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus({ preventScroll: true }); }, []);
  const save = () => { if (value.trim()) onSave(value, kept); };
  return <div className="hps-edit-box" role="group" aria-label={EDIT_LABEL}>
    {kept.length > 0 && <div className="hps-msg-images">
      {kept.map((url, i) => <span key={i} className="hps-edit-image">
        <img src={url} alt={`첨부 이미지 ${i + 1}`} />
        <button type="button" onClick={() => setKept((all) => all.filter((_, j) => j !== i))} aria-label={`첨부 이미지 ${i + 1} 빼기`}>×</button>
      </span>)}
    </div>}
    <textarea
      ref={area}
      value={value}
      aria-label="고칠 메시지"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (imeComposing(e)) return;
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
      }}
    />
    {revertNote && <p className="hps-edit-note">{REVERT_NOTE}</p>}
    <div className="hps-edit-actions">
      <button type="button" onClick={onCancel}>취소</button>
      <button type="button" className="hps-edit-save" disabled={!value.trim()} onClick={save}>보내기</button>
    </div>
  </div>;
}
