// cr-review (#1398) — the Weekly Review panel's state in the webview, kept out of App's reducer
// so the decision press can be run in a test: the press puts a status line where the decide
// button was, and the host's next answer ends it (CR-52, one decision in flight). Types only are
// imported, so the module runs as it is under Node's type stripping (test/cr-review.smoke.mjs).
import type { WebviewMessage } from "../../src/protocol";
import type { ReviewView } from "../../src/reviewView";

/** The "주간 리뷰" panel, the student's or the director's (null = hidden); `deciding` from a decision's press until the host answers. */
export type ReviewPanelState = { view: ReviewView; error: string | null; done: string | null; deciding: boolean } | null;

export type ReviewPanelAction =
  | { type: "reviewState"; view: ReviewView | null; error?: string; done?: string }
  | { type: "reviewDeciding" }
  | { type: "reviewClose" };

export type ReviewDecisionMessage = Extract<WebviewMessage, { type: "reviewDecision" }>;

export function reviewPanelReducer(state: ReviewPanelState, action: ReviewPanelAction): ReviewPanelState {
  switch (action.type) {
    case "reviewState":
      // Every answer of the host redraws the panel; the one to a decision ends its status line.
      return action.view ? { view: action.view, error: action.error ?? null, done: action.done ?? null, deciding: false } : null;
    case "reviewDeciding":
      // The decide button gives way to a status line until the host answers this one.
      return state ? { ...state, error: null, done: null, deciding: true } : state;
    case "reviewClose":
      return null;
  }
}

/** A decision's press: the status line first, then the decision to the host. */
export function pressDecision(dispatch: (action: ReviewPanelAction) => void, post: (msg: ReviewDecisionMessage) => void, msg: ReviewDecisionMessage): void {
  dispatch({ type: "reviewDeciding" });
  post(msg);
}
