// CGP-SHELL-R-013 (REQ-C7 / S-04 extension) — a render error in one independent panel replaces
// only that panel. The composer, its draft, the transcript and the other panels keep running,
// because the boundary sits below them in the tree and none of their state lives inside it.
//
// - 다시 불러오기 remounts only the children of this boundary (the fallback unmounted them), never
//   the chat. Unsaved input inside the failed panel itself is lost; that is the cost of a remount.
//   After a retry that renders, focus moves to the panel's first focusable element.
// - A second throw shows the same fallback again. Nothing retries on its own, so there is no loop.
// - Each panel id is reported to the host once per webview session, through the existing
//   `webviewError` path, with the panel id and the error class only. The error message and stack
//   are never sent: a message can quote learner text (a task title, a draft, an answer).
// - A notice that holds sending (`blocking`) keeps that meaning in its fallback, so a held send
//   never looks like a silent dead composer.
// - React boundaries do not see errors thrown in event handlers or host-message listeners.
//   Listeners that parse host payloads use `guardHostPayload`, which turns a malformed payload
//   into the listener's empty state and reports it once.
// - The top-level ChatErrorBoundary stays as the last resort for everything outside a panel,
//   the composer included.

import { Component, createRef, type ErrorInfo, type ReactNode } from "react";
import { postToHost } from "./vscode";

export const PANEL_FALLBACK_TEXT = "이 부분을 잠깐 보여 줄 수 없어요";
export const PANEL_BLOCKED_TEXT = "지금은 보낼 수 없어요. 다시 불러오기를 눌러 이유를 확인해 주세요.";
export const PANEL_RETRY_LABEL = "다시 불러오기";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]';

/** Panel and listener ids already reported in this webview session. */
const reported = new Set<string>();

/** Test hook: forget which panels and listeners were reported. */
export function resetPanelReports(): void {
  reported.clear();
}

const errorName = (err: unknown) => (err instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(err.name) ? err.name : "Error");
const safeId = (id: string) => (/^[a-z][a-z0-9-]{0,39}$/.test(id) ? id : "unknown");

/** The report for one panel failure. Panel id and error class only; no message, no stack. */
export function panelErrorReport(panel: string, err: unknown): { type: "webviewError"; message: string; stack: string; componentStack: string } {
  return { type: "webviewError", message: `panel render error: ${safeId(panel)} (${errorName(err)})`, stack: "", componentStack: "" };
}

function reportOnce(key: string, msg: ReturnType<typeof panelErrorReport>): void {
  if (reported.has(key)) return;
  reported.add(key);
  try {
    postToHost(msg);
  } catch {
    /* postMessage can fail during teardown */
  }
}

/**
 * Parse a host payload inside a listener. A throw becomes `empty` (the listener's empty state) and
 * one report per listener id, `host payload error: <listener> (<ErrorClass>)`, never the payload.
 */
export function guardHostPayload<T>(listener: string, parse: () => T, empty: T): T {
  try {
    return parse();
  } catch (err) {
    reportOnce(`listener:${listener}`, { type: "webviewError", message: `host payload error: ${safeId(listener)} (${errorName(err)})`, stack: "", componentStack: "" });
    return empty;
  }
}

type Render = ReactNode | (() => ReactNode);

interface Props {
  /** Stable kebab-case panel id; it names the panel in the report and in `data-panel-fallback`. */
  panel: string;
  /** The panel holds sending (a missing folder, an ended trial): the fallback says sending is held. */
  blocking?: boolean;
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
  private fallbackBox = createRef<HTMLDivElement>();
  private refocus = false;
  /** Where the fallback sat, so the remounted panel can be found without a wrapper element. */
  private slot: { parent: Node; before: Node | null; after: Node | null } | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(err: Error, _info: ErrorInfo): void {
    reportOnce(`panel:${this.props.panel}`, panelErrorReport(this.props.panel, err));
  }

  componentDidUpdate(): void {
    if (!this.refocus) return;
    this.refocus = false;
    // A retry that threw again: keep keyboard focus on the new 다시 불러오기 button.
    if (this.state.failed) { this.retryButton.current?.focus(); this.slot = null; return; }
    // A retry that rendered: focus the panel's first focusable element, not <body>.
    const slot = this.slot;
    this.slot = null;
    if (!slot) return;
    for (let n = slot.before ? slot.before.nextSibling : slot.parent.firstChild; n && n !== slot.after; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as HTMLElement;
      const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
      if (target) { target.focus(); return; }
    }
  }

  private retry = (): void => {
    const box = this.fallbackBox.current;
    this.slot = box?.parentNode ? { parent: box.parentNode, before: box.previousSibling, after: box.nextSibling } : null;
    this.refocus = true;
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return <PanelBody render={this.props.children} />;
    return (
      <div ref={this.fallbackBox} className="hps-panel-fallback" role="status" data-panel-fallback={this.props.panel}>
        <svg className="hps-panel-fallback-icon" aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6v5" />
          <path d="M10 14h.01" />
        </svg>
        <span className="hps-panel-fallback-text">{this.props.blocking ? PANEL_BLOCKED_TEXT : PANEL_FALLBACK_TEXT}</span>
        <button type="button" ref={this.retryButton} className="hps-panel-fallback-retry" onClick={this.retry}>
          {PANEL_RETRY_LABEL}
        </button>
      </div>
    );
  }
}
