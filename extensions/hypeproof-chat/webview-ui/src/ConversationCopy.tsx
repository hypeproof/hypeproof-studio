// CGP-CHAT-R-024 (REQ-STUDIO-COPY-CONVERSATION) — "대화 내용 복사" in the personal task menu.
// The text is built from the visible transcript at the press (src/conversationCopy.ts) and the
// result is shown only after the clipboard write settles, bound to the attempt and the task.
// CGP-CHAT-D-024: the result uses the answer-copy toast (CopyFeedback), not a line of its own.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../src/protocol';
import { COPY_CONVERSATION_CONFIRM_MS, COPY_CONVERSATION_DONE, COPY_CONVERSATION_FAILED, conversationMarkdown, copyableMessages } from '../../src/conversationCopy';
import { ChatIcon, writeClipboard, type CopyState } from './ChatDetails';
import { CopyFeedback } from './CopyFeedback';

interface Feedback { state: CopyState; attempt: number }

export function useConversationCopy(scope: string, input: { messages: readonly ChatMessage[]; title?: string; coachName?: string }): {
  state: CopyState; available: boolean; copy: () => Promise<void>;
} {
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle', attempt: 0 });
  const attempt = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Another task or activity: a pending write may still finish, but its result is not this task's.
  useEffect(() => { attempt.current++; setFeedback({ state: 'idle', attempt: attempt.current }); }, [scope]);
  useEffect(() => {
    if (feedback.state !== 'copied') return;
    const timer = setTimeout(() => setFeedback(now => now.attempt === feedback.attempt ? { state: 'idle', attempt: now.attempt } : now), COPY_CONVERSATION_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  const available = useMemo(() => copyableMessages(input.messages).length > 0, [input.messages]);
  const copy = async () => {
    // Built from the transcript as it is at the press, never from a later render.
    const text = conversationMarkdown(input);
    if (!text) return;
    const mine = ++attempt.current;
    const startedIn = scope;
    setFeedback({ state: 'idle', attempt: mine });
    const result = await writeClipboard(text);
    if (mounted.current && mine === attempt.current && currentScope.current === startedIn) setFeedback({ state: result, attempt: mine });
  };
  return { state: feedback.state, available, copy };
}

/** The same toast, icon and live regions as answer copy: success is polite, a failure assertive and kept. */
export function ConversationCopyStatus({ state }: { state: CopyState }) {
  return <CopyFeedback failed={state === 'failed'} className="hps-conversation-copy-status">{state !== 'idle' && <><ChatIcon kind={state === 'failed' ? 'alert' : 'check'} size={16} /><span>{state === 'copied' ? COPY_CONVERSATION_DONE : COPY_CONVERSATION_FAILED}</span></>}</CopyFeedback>;
}
