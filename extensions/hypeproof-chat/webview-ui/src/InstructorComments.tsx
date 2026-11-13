import { useEffect, useState, type SyntheticEvent } from "react";
import type { InboxCard } from "../../src/classroomInbox";
import { MAX_REPLY_CHARS, fingerprint, pinPlace, placeWords, type CommentAnswer } from "../../src/artifactComment";
import "./instructorComments.css";

/**
 * CGP-ART-R-005 / CGP-ART-D-005 — the instructor's comments on THIS learner's approved page versions, as a side list grouped
 * by open and handled. The host already dropped every comment that is not on a version this learner approved here.
 *
 * What it must never do:
 *   - draw the instructor's text as anything but text: no markdown, no HTML, no live link (a URL stays characters);
 *   - send anything to the coach: there is no button, path or message from here into the chat or the composer;
 *   - send a reply or a state on its own: only 답글 보내기 / 확인했어요 / 다시 열기 send, and "보냈습니다" appears only
 *     once the host saw the Service record it;
 *   - say who wrote what with one voice: the instructor's words and the learner's own reply are labelled apart (REQ-F8).
 * The pin is a 16px mark on a miniature of the page (the live preview tab has no trusted surface to draw in; CGP-ART-D-006).
 * The place is also said in words, so nothing depends on seeing the pin.
 */
export type CommentPost = (msg: { type: "inboxAnswer"; objectId: string; revision: number; generation: number; answer: CommentAnswer } | { type: "inboxOpen"; objectId: string; generation: number }) => void;

const sentOf = (card: InboxCard): CommentAnswer | null => { const s = card.answer?.sent; return s && typeof s === "object" && "handled" in s ? s as CommentAnswer : null; };
export const isHandled = (card: InboxCard) => sentOf(card)?.handled === true;

function Miniature(props: { card: InboxCard }) {
  const place = props.card.anchor ? pinPlace(props.card.anchor) : null;
  return (
    <div className="hp-comment-page" aria-hidden="true">
      {place && <span className="hp-comment-pin" style={{ insetInlineStart: `${place.inline}%`, insetBlockStart: `${place.block}%` }} />}
    </div>
  );
}

function CommentItem(props: { card: InboxCard; generation: number; post: CommentPost }) {
  const { card } = props, sent = sentOf(card), handled = sent?.handled === true, busy = !!card.answer_busy;
  const [reply, setReply] = useState(""), chars = [...reply].length;
  const sentKey = sent ? JSON.stringify(sent) : "";
  // A reply the Service confirmed clears the field.
  useEffect(() => { setReply(""); }, [sentKey]);
  const send = (answer: CommentAnswer) => props.post({ type: "inboxAnswer", objectId: card.object_id, revision: card.revision, generation: props.generation, answer });
  const canReply = !busy && !!reply.trim() && chars <= MAX_REPLY_CHARS;
  const where = card.anchor ? placeWords(card.anchor) : "";
  const titleId = `hp-comment-${card.object_id}-${card.revision}`;
  return (
    <li className="hp-comment" data-comment-object={card.object_id} data-comment-state={handled ? "handled" : "open"} data-comment-version={card.version} aria-labelledby={titleId}>
      <div className="hp-comment-head">
        <Miniature card={card} />
        <div className="hp-comment-where">
          <p id={titleId} className="hp-comment-title">
            {card.is_new && <span className="hp-comment-unread" data-comment-unread="">새 의견</span>}
            <span>강사 의견 · {where}</span>
          </p>
          <p className="hp-comment-meta">
            {card.anchor && <span>승인한 판 지문 {fingerprint(card.anchor.artifact_sha256)}</span>}
            {card.version === "previous" && <span className="hp-comment-badge" data-comment-previous="">이전 판에 남긴 의견</span>}
          </p>
        </div>
      </div>
      {card.version === "previous" && <p className="hp-comment-meta">지금 결과물은 이 판에서 바뀌었습니다. 의견은 승인했던 판을 보고 남긴 것입니다.</p>}
      <p className="hp-comment-author">강사</p>
      <p className="hp-comment-body">{card.body}</p>
      {sent?.reply && <>
        <p className="hp-comment-author" data-comment-mine="">나 (내가 보낸 답글)</p>
        <p className="hp-comment-body hp-comment-reply">{sent.reply}</p>
      </>}
      <label className="hp-comment-field">답글 ({chars}/{MAX_REPLY_CHARS}자)
        <textarea rows={2} maxLength={MAX_REPLY_CHARS} value={reply} disabled={busy} onChange={(e) => setReply(e.currentTarget.value)} />
      </label>
      <div className="hp-comment-actions">
        <button type="button" className="hp-cta-quiet" data-comment-reply="" disabled={!canReply} onClick={() => { if (canReply) send({ handled, reply }); }}>답글 보내기</button>
        {handled
          ? <button type="button" className="hp-cta-quiet" data-comment-reopen="" disabled={busy} onClick={() => send({ handled: false, ...(sent?.reply ? { reply: sent.reply } : {}) })}>다시 열기</button>
          : <button type="button" className="hp-cta-quiet" data-comment-handled="" disabled={busy} onClick={() => send({ handled: true, ...(sent?.reply ? { reply: sent.reply } : {}) })}>확인했어요</button>}
      </div>
      <p className="hp-comment-meta" role="status">
        {busy ? "보내는 중입니다…" : card.answer_note ? card.answer_note : sent ? (handled ? "확인했다고 강사에게 보냈습니다." : "답글을 강사에게 보냈습니다.") : "버튼을 누를 때만 강사에게 보냅니다. AI 코치에게는 보내지 않습니다."}
      </p>
    </li>
  );
}

export function InstructorComments(props: { cards: InboxCard[]; generation: number; post: CommentPost }) {
  const comments = props.cards.filter((c) => c.kind === "comment" && !c.withdrawn && !c.unreadable && c.version);
  const unread = comments.filter((c) => c.is_new).length;
  if (!comments.length) return null;
  const open = comments.filter((c) => !isHandled(c)), done = comments.filter(isHandled);
  // Opening the list marks what was shown as seen (this device only; reported to nobody), like opening an inbox card.
  const markSeen = (e: SyntheticEvent<HTMLDetailsElement>) => { if (e.currentTarget.open) for (const c of comments) if (c.is_new) props.post({ type: "inboxOpen", objectId: c.object_id, generation: props.generation }); };
  const group = (label: string, list: InboxCard[], key: string) => (
    <section className="hp-comment-group" aria-label={`${label} ${list.length}개`} data-comment-group={key}>
      <h4 className="hp-comment-group-title">{label} {list.length}개</h4>
      {list.length ? <ul className="hp-comment-list">{list.map((c) => <CommentItem key={`${c.object_id}:${c.revision}`} card={c} generation={props.generation} post={props.post} />)}</ul>
        : <p className="hp-comment-meta">{key === "open" ? "열린 의견이 없습니다." : "아직 확인한 의견이 없습니다."}</p>}
    </section>
  );
  return (
    <details className="hp-comments" data-comments="" onToggle={markSeen}>
      <summary>
        <span className="hp-comment-title">결과물에 남긴 강사 의견 {comments.length}개</span>
        {/* The unread dot is said in words too, and announced politely while the list is closed (DES-ART-05). */}
        <span className="hp-comment-live" role="status" aria-live="polite" data-comment-live="">{unread > 0 && <><span className="hp-comment-dot" aria-hidden="true" /> 새 의견 {unread}개</>}</span>
      </summary>
      {group("열린 의견", open, "open")}
      {group("확인한 의견", done, "handled")}
    </details>
  );
}
