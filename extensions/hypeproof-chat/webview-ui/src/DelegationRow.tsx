// REQ-STUDIO-DELEGATION-ROW (CGP-AGENT-R-009) — one collapsed row per coach delegation: helper,
// short task and status in the summary; the helper's final response and its own tool calls inside.
// "모두 멈추기" is offered only while the row's turn runs, and calls the same cancel as Stop
// (aborting the SDK query ends the CLI process the helpers run in).

import type { ReactNode } from "react";
import {
  CHILDREN_HEADING,
  DELEGATION_ICON,
  DELEGATION_STATUS_LABEL,
  NO_RESULT_YET,
  RESULT_HEADING,
  STOP_ALL_LABEL,
  type DelegationView,
} from "../../src/delegationRow";
import type { ChatMessage } from "../../src/protocol";
import { ChatIcon } from "./ChatDetails";
import { glyphIconKind } from "./glyphIcon";

export function DelegationRow({ view, renderChild, onStopAll }: {
  view: DelegationView;
  renderChild: (message: ChatMessage) => ReactNode;
  onStopAll?: () => void;
}) {
  const status = DELEGATION_STATUS_LABEL[view.status];
  return (
    <div className="hps-delegation-wrap" data-delegation-status={view.status}>
      <details className="hps-delegation">
        <summary className="hps-delegation-summary" style={{ minHeight: 44 }} aria-label={`${view.helper}에게 맡긴 일: ${view.task} · ${status}`}>
          <span className="hps-tool-icon" data-glyph={DELEGATION_ICON}><ChatIcon kind={glyphIconKind(DELEGATION_ICON)} size={16} /></span>
          <strong className="hps-delegation-helper">{view.helper}</strong>
          <span className="hps-delegation-task">{view.task}</span>
          <span className="hps-delegation-status" role="status">{status}</span>
        </summary>
        <div className="hps-delegation-body">
          <p className="hps-delegation-heading">{RESULT_HEADING}</p>
          <p className="hps-delegation-result">{view.result ?? NO_RESULT_YET}</p>
          {view.children.length > 0 && (
            <div className="hps-delegation-children" role="group" aria-label={CHILDREN_HEADING}>
              <p className="hps-delegation-heading">{CHILDREN_HEADING}</p>
              {view.children.map((m) => <div key={m.id}>{renderChild(m)}</div>)}
            </div>
          )}
        </div>
      </details>
      {view.status === "running" && onStopAll && (
        <button type="button" className="hps-delegation-stop" style={{ minHeight: 44, minWidth: 44 }} onClick={onStopAll}>
          {STOP_ALL_LABEL}
        </button>
      )}
    </div>
  );
}
