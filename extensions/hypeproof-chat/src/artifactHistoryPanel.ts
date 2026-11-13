/** DES-KNOW-30: local, opt-in history; the panel never accepts paths from its webview. */
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { captureArtifactVersion, listRestorePoints, readArtifactVersion, restoreArtifactVersion, type RestoreManifest } from './turnRestore';

export interface ArtifactHistoryContext {
  store: string; root: string; rel: string;
  current(): boolean;
  writeAllowed(): boolean;
  canStart(): boolean;
  busy(value: boolean): void;
  restored(): Promise<void>;
  attest(): Promise<void>;
}
export function historyRelativeTime(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 1 ? '방금' : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`;
}
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '�').slice(0, 160);
const escape = (s: string) => clean(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function artifactHistoryHtml(points: RestoreManifest[], currentId: string, name: string, nonce: string, error = ''): string {
  const rows = points.map(p => {
    const actor = p.turnId === 'artifact-ai' ? 'AI' : p.turnId === 'artifact-learner' ? '나' : '기록 없음';
    const time = new Date(p.createdAt).toLocaleString('ko-KR');
    return `<li><div><span class="actor">${actor}</span> <time title="${escape(time)}">${historyRelativeTime(p.createdAt)}</time> ${p.id === currentId ? '<strong>지금</strong>' : ''}</div><div class="actions"><button data-action="compare" data-id="${escape(p.id)}" aria-pressed="false">비교</button>${p.id !== currentId ? `<button data-action="restore" data-id="${escape(p.id)}" aria-label="${escape(time)} 버전 복원">복원</button>` : p.turnId === 'artifact-unknown' ? '<button data-action="attest">내 수정 확인</button>' : ''}</div></li>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:16px;color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#202226);font:14px/1.6 system-ui,sans-serif}h1{font-size:18px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}ul{list-style:none;padding:0}li{min-height:44px;padding:12px 0;border-bottom:1px solid var(--vscode-panel-border,#888)}.actor{display:inline-block;border:1px solid currentColor;border-radius:4px;padding:0 6px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}button{min-height:44px;min-width:44px;padding:8px 12px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer}button:focus-visible{outline:2px solid var(--vscode-focusBorder,#799ed7);outline-offset:2px}button[aria-pressed=true]{font-weight:700;text-decoration:underline}button:disabled{opacity:.6;cursor:default}#error{border:1px solid currentColor;padding:12px}#error[hidden]{display:none}strong{margin-left:8px}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}@media(forced-colors:active){button,.actor,#error{border-color:ButtonText}}
</style></head><body><h1>${escape(name)} · 이전 버전</h1><p>나는 확인한 수정·업로드·복원 기록이에요. 작성자를 모르면 기록 없음으로 표시해요.</p><section id="error" role="alert" ${error ? '' : 'hidden'}><p id="error-text">${escape(error)}</p><button id="dismiss">오류 닫기</button></section><button data-action="refresh">새로 고침</button><ul>${rows}</ul><script nonce="${nonce}">
const api=acquireVsCodeApi();let pending=false;const buttons=[...document.querySelectorAll('[data-action]')];
for(const button of buttons)button.addEventListener('click',()=>{if(pending)return;pending=true;for(const b of buttons)b.disabled=true;api.postMessage({action:button.dataset.action,id:button.dataset.id,close:button.getAttribute('aria-pressed')==='true'});});
document.getElementById('dismiss').addEventListener('click',()=>{document.getElementById('error').hidden=true;api.postMessage({action:'dismiss'});document.querySelector('[data-action=refresh]').focus();});
window.addEventListener('message',({data})=>{if(!data||data.type!=='result')return;pending=false;for(const b of buttons)b.disabled=false;if(data.error){document.getElementById('error-text').textContent=data.error;document.getElementById('error').hidden=false;}if(data.compared!==undefined){for(const b of buttons)if(b.dataset.action==='compare')b.setAttribute('aria-pressed',String(b.dataset.id===data.compared));}});
</script></body></html>`;
}

/** One instance owns one immutable activity/profile/file context. */
export class ArtifactHistoryPanel {
  private panel: vscode.WebviewPanel;
  private points: RestoreManifest[] = [];
  private head: RestoreManifest | null = null;
  private pending = false;
  private disposed = false;
  private error = '';
  private content = new Map<string, string>();
  private provider: vscode.Disposable;
  private scheme = `hps-history-${randomUUID()}`;
  private compareUris: vscode.Uri[] = [];
  constructor(private context: ArtifactHistoryContext) {
    this.panel = vscode.window.createWebviewPanel('hypeproof.artifactHistory', '이전 버전', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
    this.provider = vscode.workspace.registerTextDocumentContentProvider(this.scheme, { provideTextDocumentContent: uri => this.content.get(uri.toString()) ?? '' });
    this.panel.onDidDispose(() => { this.disposed = true; void this.closeCompare().catch(() => undefined).finally(() => { this.provider.dispose(); this.content.clear(); }); });
    this.panel.webview.onDidReceiveMessage(message => this.handle(message));
  }
  async open(): Promise<void> { await this.handle({ action: 'refresh' }); }
  private valid(): boolean { return !this.disposed && this.context.current(); }
  private async refresh(): Promise<void> {
    if (!this.valid()) throw new Error('stale');
    const head = await captureArtifactVersion(this.context.store, this.context.root, this.context.rel, 'unknown', undefined, () => this.valid());
    if (!head) throw new Error('unavailable');
    const points = await listRestorePoints(this.context.store);
    if (!this.valid()) throw new Error('stale');
    await this.closeCompare();
    if (!this.valid()) throw new Error('stale');
    this.head = head; this.points = points;
    this.panel.webview.html = artifactHistoryHtml(points, head.id, this.context.rel, randomUUID(), this.error);
  }
  private async closeCompare(): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff && this.compareUris.some(uri => (tab.input as vscode.TabInputTextDiff).original.toString() === uri.toString()));
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    this.compareUris = [];
    this.content.clear();
  }
  async handle(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const m = message as { action?: unknown; id?: unknown; close?: unknown };
    // Dismiss only clears the learner's own notice, so it is honoured even while an action is pending
    // (otherwise the pending action's result would show the error the learner already closed).
    if (m.action === 'dismiss') { this.error = ''; return; }
    if (this.pending) return;
    if (!['refresh', 'restore', 'compare', 'attest'].includes(String(m.action))) return;
    this.pending = true;
    let compared: string | undefined;
    try {
      if (!this.valid() || !this.context.canStart()) throw new Error('stale');
      if (m.action === 'refresh') { await this.refresh(); return; }
      if (m.action === 'attest') { await this.context.attest(); await this.refresh(); return; }
      const selected = this.points.find(p => p.id === m.id);
      if (!selected || !this.head) throw new Error('invalid');
      if (m.action === 'compare') {
        await this.closeCompare();
        if (m.close === true) { compared = ''; return; }
        if (!await captureArtifactVersion(this.context.store, this.context.root, this.context.rel, 'unknown', this.head.files[0].sha256, () => this.valid())) throw new Error('changed');
        const before = await readArtifactVersion(this.context.store, selected.id, this.context.rel);
        const after = await readArtifactVersion(this.context.store, this.head.id, this.context.rel);
        if (before === null || after === null || !this.valid()) throw new Error('unavailable');
        const left = vscode.Uri.parse(`${this.scheme}:/${selected.id}/before`), right = vscode.Uri.parse(`${this.scheme}:/${this.head.id}/current`);
        this.content.set(left.toString(), before); this.content.set(right.toString(), after);
        this.compareUris = [left, right];
        await vscode.commands.executeCommand('vscode.diff', left, right, `${clean(this.context.rel)} · 보관된 버전 ↔ 지금`, { preview: true });
        compared = selected.id;
        return;
      }
      if (selected.id === this.head.id) return;
      this.context.busy(true);
      try {
        const time = new Date(selected.createdAt).toLocaleString('ko-KR');
        const answer = await vscode.window.showWarningMessage(`${time} 버전으로 복원할까요?`, { modal: true, detail: '현재 파일을 먼저 보관한 뒤 이 파일만 바꿔요.' }, '복원하기');
        if (answer !== '복원하기') return;
        if (!this.valid() || !this.context.writeAllowed()) throw new Error('stale');
        const result = await restoreArtifactVersion({ store: this.context.store, root: this.context.root, rel: this.context.rel, id: selected.id, expected: this.head.files[0].sha256, stillCurrent: () => this.valid() && this.context.writeAllowed() });
        if (!result.ok) throw new Error(result.reason === 'changed' ? 'changed' : 'failed');
        await this.context.restored();
        await this.refresh();
      } finally { this.context.busy(false); }
    } catch (error) {
      this.error = error instanceof Error && (error.message === 'changed' || error.message === 'stale') ? '파일이 바뀌었어요. 파일과 활동을 확인하고 다시 열어 주세요.' : '이전 버전을 처리하지 못했어요. 파일이나 활동이 바뀌었는지 확인하고 다시 열어 주세요.';
      if (!this.head && !this.disposed) this.panel.webview.html = artifactHistoryHtml([], '', this.context.rel, randomUUID(), this.error);
    } finally {
      this.pending = false;
      if (!this.disposed) await this.panel.webview.postMessage({ type: 'result', error: this.error || undefined, compared });
    }
  }
}
