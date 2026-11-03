import { useEffect, useId, useRef, useState } from 'react';
import { NICKNAME_COPY, NICKNAME_MAX, nicknameLength, normalizeNickname, screenNickname } from '../../src/learnerNickname';
import { imeComposing } from './imeGuard';

/**
 * CGP-KNOW-R-032 / DES-KNOW-50 — 뭐라고 불러 줄까요? in 대화 설정. One nickname field and nothing else:
 * no occupation or "about me" field exists for any seat, so a minor cohort sees only the nickname.
 * The counter is text and counts committed characters only (an open IME composition does not move it).
 * The same screen the host applies runs here first, so a refusal shows inline and nothing is posted.
 */
export function NicknameSetting({ saved, post }: { saved: string; post: (message: { type: 'setLearnerNickname'; nickname: string }) => void }) {
  const [draft, setDraft] = useState(saved);
  const [counted, setCounted] = useState(nicknameLength(normalizeNickname(saved)));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dirty = useRef(false);
  // The value posted and not yet confirmed: the status line appears only once the host's saved value matches.
  const pending = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  // A saved value from the host (another window, a reload) replaces the field unless the learner is editing.
  useEffect(() => {
    if (pending.current !== null && pending.current === saved) {
      setStatus(saved ? NICKNAME_COPY.saved : NICKNAME_COPY.cleared);
      pending.current = null;
    }
    if (dirty.current) return;
    setDraft(saved);
    setCounted(nicknameLength(normalizeNickname(saved)));
  }, [saved]);
  const commit = (value: string) => setCounted(nicknameLength(normalizeNickname(value)));
  const save = (value: string) => {
    const result = screenNickname(value);
    if (!result.ok) { setError(result.message); setStatus(''); return; }
    setError(''); setStatus('');
    dirty.current = false;
    setDraft(result.value);
    commit(result.value);
    pending.current = result.value;
    post({ type: 'setLearnerNickname', nickname: result.value });
    // Saving the value already saved gets no new config: confirm it from the value in hand.
    if (result.value === saved) { setStatus(result.value ? NICKNAME_COPY.saved : NICKNAME_COPY.cleared); pending.current = null; }
  };
  return <fieldset className="hps-nickname">
    <legend>{NICKNAME_COPY.legend}</legend>
    <p id={`${id}-hint`}>{NICKNAME_COPY.hint}</p>
    <div className="hps-nickname-row">
      <input ref={input} type="text" aria-label={NICKNAME_COPY.legend} aria-describedby={`${id}-hint ${id}-count ${id}-error`}
        aria-invalid={error ? true : undefined} autoComplete="off" spellCheck={false} value={draft}
        onChange={event => {
          dirty.current = true;
          setDraft(event.target.value);
          setError(''); setStatus('');
          if (!(event.nativeEvent as InputEvent).isComposing) commit(event.target.value);
        }}
        onCompositionEnd={event => commit(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !imeComposing(event)) { event.preventDefault(); save(draft); } }} />
      <button type="button" onClick={() => save(draft)}>{NICKNAME_COPY.save}</button>
      {(saved || draft) && <button type="button" onClick={() => { save(''); input.current?.focus(); }}>{NICKNAME_COPY.clear}</button>}
    </div>
    <p id={`${id}-count`} className="hps-nickname-count" data-over={counted > NICKNAME_MAX ? 'true' : undefined}>{counted}/{NICKNAME_MAX}자</p>
    <p id={`${id}-error`} className="hps-nickname-error" role="alert">{error}</p>
    <p className="hps-nickname-status" role="status">{status}</p>
  </fieldset>;
}
