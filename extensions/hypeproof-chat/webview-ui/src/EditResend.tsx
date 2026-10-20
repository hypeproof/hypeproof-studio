// CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — "수정" on the latest sent prompt, the in-place
// editor, and the version pager. Rules (which line, which version, what the model sees) live in
// src/editResend.ts; this file only draws them.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VersionPager as Pager } from "../../src/editResend";
import { ChatIcon } from "./ChatDetails";
import { AttemptPager } from "./AttemptPager";
import { imeComposing } from "./imeGuard";
import { useDialogFocus } from "./dialogFocus";

export const EDIT_LABEL = "보낸 메시지 수정";
export const REVERT_NOTE = "이전 답변이 바꾼 파일은 그대로예요. 되돌리려면 그 답변의 되돌리기를 쓰세요.";
export const PAGER_TITLE = "버전을 바꿔 봐도 새로 묻지 않아요. 다음 대화는 마지막 버전에서 이어져요.";

export function EditAction({ onEdit }: { onEdit: () => void }) {
  return <button type="button" className="hps-edit-prompt" onClick={onEdit} aria-label={EDIT_LABEL} title={EDIT_LABEL}><ChatIcon kind="pencil" size={16} />수정</button>;
}

/** "‹ 1/2 ›" — switches which version of this prompt and its answer is drawn. Never sends anything. */
export function VersionPager({ pager, onPage }: { pager: Pager; onPage: (index: number) => void }) {
  return <AttemptPager index={pager.index} count={pager.count} onPage={onPage}
    label="메시지 버전" previousLabel="이전 버전" nextLabel="다음 버전" title={PAGER_TITLE}
    note={pager.index < pager.count - 1 ? "이 버전은 보기만 해요" : undefined} />;
}

/**
 * The prompt opened in place. The composer and its saved draft are not touched, so Cancel is
 * exact: nothing changed anywhere. Save hands the text and the kept images to the caller.
 */
export function EditPrompt({ text, images, revertNote, onCancel, onSave, onChange }: {
  text: string;
  images: string[];
  revertNote: boolean;
  onChange?: (text: string, images: string[]) => void;
  onCancel: () => void;
  onSave: (text: string, images: string[]) => void;
}) {
  const [value, setValue] = useState(text);
  const [kept, setKept] = useState(images);
  const area = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useEffect(() => { area.current?.focus({ preventScroll: true }); }, []);
  // REQ-STUDIO-FOCUS-RESTORE: closing returns focus to this message's 수정 (drawn again after the
  // editor goes), or to the composer when the message is gone.
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<Element | null>(null);
  useLayoutEffect(() => { row.current = box.current?.closest(".hps-msg") ?? null; }, []);
  useDialogFocus(box, { open: true, kind: "inline", initialFocus: false, opener: () => row.current?.isConnected ? row.current.querySelector<HTMLElement>(".hps-edit-prompt") : null });
  const save = () => { if (value.trim()) onSave(value, kept); };
  return <div ref={box} className="hps-edit-box" role="group" aria-label={EDIT_LABEL}>
    {kept.length > 0 && <div className="hps-msg-images">
      {kept.map((url, i) => <span key={i} className="hps-edit-image">
        <img src={url} alt={`첨부 이미지 ${i + 1}`} />
        <button type="button" onClick={(event) => {
          const next = kept.filter((_, j) => j !== i);
          // Return the keyboard before its last attachment control unmounts.
          // An unrelated focus owner keeps its focus; no delayed callback can steal it.
          if (!next.length && document.activeElement === event.currentTarget) area.current?.focus({ preventScroll: true });
          setKept(next);
          onChange?.(value, next);
        }} aria-label={`첨부 이미지 ${i + 1} 빼기`}>×</button>
      </span>)}
    </div>}
    <textarea
      ref={area}
      value={value}
      aria-label="고칠 메시지"
      onChange={(e) => { setValue(e.target.value); onChange?.(e.target.value, kept); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(e) => {
        if (imeComposing(e, composing.current)) { e.stopPropagation(); return; }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
      }}
    />
    {revertNote && <p className="hps-edit-note">{REVERT_NOTE}</p>}
    <div className="hps-edit-actions">
      <button type="button" onClick={onCancel}>취소</button>
      <button type="button" className="hps-edit-save" disabled={!value.trim()} onClick={save}>다시 보내기</button>
    </div>
  </div>;
}
