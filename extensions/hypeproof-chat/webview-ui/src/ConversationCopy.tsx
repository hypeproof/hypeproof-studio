// CGP-CHAT-R-024 (REQ-STUDIO-COPY-CONVERSATION) — "대화 내용 복사" in the personal task menu.
// The text is built from the visible transcript at the press (src/conversationCopy.ts) and the
// result is shown only after the clipboard write settles, bound to the attempt and the task.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../src/protocol';
import { COPY_CONVERSATION_CONFIRM_MS, COPY_CONVERSATION_DONE, COPY_CONVERSATION_FAILED, conversationMarkdown, copyableMessages } from '../../src/conversationCopy';
import { writeClipboard, type CopyState } from './ChatDetails';

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

/** Always mounted, so the live region exists before the message arrives. Failure is an alert. */
export function ConversationCopyStatus({ state }: { state: CopyState }) {
  const text = state === 'copied' ? COPY_CONVERSATION_DONE : state === 'failed' ? COPY_CONVERSATION_FAILED : '';
  return <div className="tw-copy-conversation-status" role={state === 'failed' ? 'alert' : 'status'} aria-atomic="true" data-shown={text ? 'true' : 'false'}>{text}</div>;
}
