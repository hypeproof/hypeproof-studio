// CGP-SHELL-R-013 (REQ-C7 / S-04 extension) — a render error in one independent panel replaces
// only that panel. The composer, its draft, the transcript and the other panels keep running,
// because the boundary sits below them in the tree and none of their state lives inside it.
//
// - 다시 불러오기 remounts only the children of this boundary (the fallback unmounted them), never
//   the chat.
// - A second throw shows the same fallback again. Nothing retries on its own, so there is no loop.
// - Each panel id is reported to the host once per webview session, through the existing
//   `webviewError` path, with the panel id and the error class only. The error message and stack
//   are never sent: a message can quote learner text (a task title, a draft, an answer).
// - The top-level ChatErrorBoundary stays as the last resort for everything outside a panel,
//   the composer included.

import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { postToHost } from "./vscode";

export const PANEL_FALLBACK_TEXT = "이 부분을 잠깐 보여 줄 수 없어요";
export const PANEL_RETRY_LABEL = "다시 불러오기";

/** Panel ids already reported in this webview session. */
const reported = new Set<string>();

/** Test hook: forget which panels were reported. */
export function resetPanelReports(): void {
  reported.clear();
}

/** The report for one panel failure. Panel id and error class only; no message, no stack. */
export function panelErrorReport(panel: string, err: unknown): { type: "webviewError"; message: string; stack: string; componentStack: string } {
  const name = err instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(err.name) ? err.name : "Error";
  const id = /^[a-z][a-z0-9-]{0,39}$/.test(panel) ? panel : "unknown";
  return { type: "webviewError", message: `panel render error: ${id} (${name})`, stack: "", componentStack: "" };
}

type Render = ReactNode | (() => ReactNode);

interface Props {
  /** Stable kebab-case panel id; it names the panel in the report and in `data-panel-fallback`. */
  panel: string;
  /**
   * The panel. Pass a function when the panel's JSX computes values inline: the function runs
   * inside this boundary, so a throw there is caught here instead of in the parent's render.
   */
  children: Render;
}

interface State {
  failed: boolean;
}

function PanelBody({ render }: { render: Render }): ReactNode {
  return typeof render === "function" ? render() : render;
}

export class PanelBoundary extends Component<Props, State> {
  state: State = { failed: false };
  private retryButton = createRef<HTMLButtonElement>();
  private refocus = false;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(err: Error, _info: ErrorInfo): void {
    if (reported.has(this.props.panel)) return;
    reported.add(this.props.panel);
    try {
      postToHost(panelErrorReport(this.props.panel, err));
    } catch {
      /* postMessage can fail during teardown; the fallback is already on screen */
    }
  }

  componentDidUpdate(): void {
    // A retry that threw again: keep keyboard focus on the new 다시 불러오기 button.
    if (this.refocus && this.state.failed) this.retryButton.current?.focus();
    this.refocus = false;
  }

  private retry = (): void => {
    this.refocus = true;
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return <PanelBody render={this.props.children} />;
    return (
      <div className="hps-panel-fallback" role="status" data-panel-fallback={this.props.panel}>
        <svg className="hps-panel-fallback-icon" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6v5" />
          <path d="M10 14h.01" />
        </svg>
        <span className="hps-panel-fallback-text">{PANEL_FALLBACK_TEXT}</span>
        <button type="button" ref={this.retryButton} className="hps-panel-fallback-retry" onClick={this.retry}>
          {PANEL_RETRY_LABEL}
        </button>
      </div>
    );
  }
}
