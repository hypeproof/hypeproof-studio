import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { postToHost } from './vscode';

interface Props { messageId: string; rawText: unknown; children: () => ReactNode }
interface State { failed: boolean; raw: boolean }
let nextRawId = 0;
function TurnBody({ render }: { render: () => ReactNode }): ReactNode { return render(); }

/** One response row owns its fallback. No automatic retries or answer/stack logging. */
export class TurnBoundary extends Component<Props, State> {
  state: State = { failed: false, raw: false };
  private reported = false;
  private rawId = `hps-turn-raw-${++nextRawId}`;
  private box = createRef<HTMLDivElement>();
  private retryButton = createRef<HTMLButtonElement>();
  private rawText = createRef<HTMLPreElement>();
  private refocus = false;
  private slot: { parent: Node; before: Node | null; after: Node | null } | null = null;
  static getDerivedStateFromError(): State { return { failed: true, raw: false }; }
  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    if (this.reported) return;
    this.reported = true;
    const messageId = /^[A-Za-z0-9_.:#-]{1,128}$/.test(this.props.messageId) ? this.props.messageId : 'unknown';
    let name = 'Error';
    try { if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name)) name = error.name; } catch { /* malformed thrown value */ }
    try { postToHost({ type: 'webviewError', message: `turn render error (${name})`, messageId, stack: '', componentStack: '' }); } catch { /* teardown */ }
  }
  componentDidUpdate(): void {
    if (!this.refocus) return;
    this.refocus = false;
    const slot = this.slot;this.slot = null;
    if (this.state.failed) { this.retryButton.current?.focus();return; }
    if (!slot) return;
    for (let node = slot.before ? slot.before.nextSibling : slot.parent.firstChild; node && node !== slot.after; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const element = node as HTMLElement;
      const target = element.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]');
      if (target) { target.focus();return; }
      element.tabIndex = -1;element.focus();return;
    }
  }
  private retry = (): void => {
    const box = this.box.current;
    this.slot = box?.parentNode ? { parent: box.parentNode, before: box.previousSibling, after: box.nextSibling } : null;
    this.refocus = true;this.setState({ failed: false, raw: false });
  };
  render(): ReactNode {
    if (!this.state.failed) return <TurnBody render={this.props.children} />;
    return <div ref={this.box} className="hps-panel-fallback hps-turn-fallback" data-turn-fallback={this.props.messageId}>
      <p className="hps-panel-fallback-text" role="status">이 답변을 표시하지 못했어요</p>
      <button ref={this.retryButton} type="button" className="hps-panel-fallback-retry" onClick={this.retry}>다시 보기</button>
      <button type="button" className="hps-panel-fallback-retry" aria-expanded={this.state.raw} aria-controls={this.rawId}
        onClick={() => this.setState({ raw: !this.state.raw }, () => { if (this.state.raw) this.rawText.current?.focus(); })}>{this.state.raw ? '원문 닫기' : '원문 보기'}</button>
      {this.state.raw && <pre id={this.rawId} ref={this.rawText} tabIndex={-1} className="hps-turn-raw" aria-label="답변 원문">{typeof this.props.rawText === 'string' ? this.props.rawText : '텍스트 원문이 없습니다.'}</pre>}
    </div>;
  }
}
