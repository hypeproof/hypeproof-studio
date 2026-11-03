// REQ-STUDIO-FINISH-NOTICE (CGP-AGENT-R-023): when a coach turn ends while the chat is not on
// screen, one calm, non-modal notice says so and offers to open the chat. Approval already uses a
// modal, so this covers only "the turn finished" and "the turn failed".
//
// Pure: no vscode import. The host (finishNoticeHost.ts) supplies how to show a notice and how to
// reveal the chat. Nothing here ever receives the answer text: the notice must be safe on a
// shared or projected screen.

import { profileAudience } from "./seatVocabulary.ts";

/** Learner-facing copy (Korean is the product; see CLAUDE.md §Language). */
export const FINISH_NOTICE_COPY = {
  done: "AI 답이 준비됐어요.",
  error: "AI가 이번 답을 끝내지 못했어요. 채팅에서 확인해 주세요.",
  open: "채팅 열기",
} as const;

/** How the turn ended, as the host's turn record names it. `aborted` = stopped by a person. */
export type FinishStatus = "ok" | "error" | "aborted";

export type FinishSeat = {
  activity_kind?: string | null;
  pass?: unknown;
  lesson?: unknown;
  lesson_binding?: { enforced?: boolean } | null;
} | null | undefined;

/**
 * Seats that may be notified: personal work only (personal, trial, a bought pass). Never a
 * classroom seat, a seat with a served lesson or an enforced lesson binding, the instructor
 * surface, or a seat Studio cannot identify. This follows the stricter existing quiet rule
 * (REQ-STUDIO-FOLDER-CONSENT seats, CGP-SHELL-R-001 classUpdateHold: unknown counts as a class),
 * so a notice never interrupts a lesson.
 */
export function finishNoticeApplies(seat: FinishSeat, instructor = false): boolean {
  if (!seat || instructor) return false;
  if (seat.activity_kind === "classroom") return false;
  if (seat.lesson || seat.lesson_binding?.enforced) return false;
  return profileAudience(seat) === "solo";
}

export type FinishInput = {
  status: FinishStatus;
  /** Is any chat surface (sidebar view or editor panel) visible right now? */
  chatVisible: boolean;
  seat: FinishSeat;
  instructor?: boolean;
};

/** Which notice, if any. Null when the chat is on screen, the turn was stopped, or the seat is quiet. */
export function finishNoticeKind(input: FinishInput): "done" | "error" | null {
  if (input.chatVisible) return null;
  if (input.status === "aborted") return null;
  if (!finishNoticeApplies(input.seat, input.instructor === true)) return null;
  return input.status === "ok" ? "done" : "error";
}

export type FinishNoticeUi = {
  /** Show one non-modal notice with one action; resolves with the chosen action or undefined. */
  show(message: string, action: string): PromiseLike<string | undefined>;
  /** Bring the chat into view. */
  reveal(): PromiseLike<void> | void;
};

/** Longest a shown notice holds later ones back, about a toast's life plus a short read. */
export const FINISH_NOTICE_HOLD_MS = 120_000;

/**
 * At most one notice at a time. While a notice is open, later turn ends are coalesced into it (not
 * stacked): it already sends the learner to the chat, where every answer is.
 *
 * VS Code never settles the promise of an information message whose toast timed out into the
 * notification center, so settling cannot be the only release. The hold also ends when the learner
 * has seen the chat (`release()` on a chat surface becoming visible, and at the next turn start,
 * which is sent from the chat) and after `holdMs` at the latest.
 */
export class FinishNotifier {
  private shownAt: number | null = null;
  private generation = 0;
  private readonly ui: FinishNoticeUi;
  private readonly now: () => number;
  private readonly holdMs: number;
  constructor(ui: FinishNoticeUi, opts: { now?: () => number; holdMs?: number } = {}) {
    this.ui = ui;
    this.now = opts.now ?? Date.now;
    this.holdMs = opts.holdMs ?? FINISH_NOTICE_HOLD_MS;
  }

  get isPending(): boolean {
    return this.shownAt !== null && this.now() - this.shownAt < this.holdMs;
  }

  /** The learner has seen the chat (it became visible, or a new turn started): stop holding. */
  release(): void { this.shownAt = null; this.generation++; }

  /** Returns the notice kind shown, or null when nothing was shown. Never throws. */
  turnEnded(input: FinishInput): "done" | "error" | null {
    const kind = finishNoticeKind(input);
    if (!kind || this.isPending) return null;
    const mine = ++this.generation;
    this.shownAt = this.now();
    // Only this notice's own settling may end its hold; an older notice settling late must not
    // release a newer one.
    const settle = () => { if (this.generation === mine) this.shownAt = null; };
    let shown: PromiseLike<string | undefined>;
    try {
      shown = this.ui.show(FINISH_NOTICE_COPY[kind], FINISH_NOTICE_COPY.open);
    } catch {
      settle();
      return null;
    }
    Promise.resolve(shown)
      .then(async (choice) => {
        settle();
        if (choice === FINISH_NOTICE_COPY.open) await this.ui.reveal();
      })
      .catch(settle);
    return kind;
  }
}
