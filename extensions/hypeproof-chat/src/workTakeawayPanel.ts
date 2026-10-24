import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { TakeawayItem, TakeawayResult } from './workTakeaway';

export type TakeawayPanel = { destination: string; items: readonly TakeawayItem[]; results?: readonly (TakeawayResult & { directory?: string })[] };
export type TakeawayAction = { action: 'confirm' | 'close' } | { action: 'retry'; index: number };
const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
/** Only presentation fields cross into the panel; file bytes and credentials stay in the host. */
export function workTakeawayHtml(model: TakeawayPanel, nonce: string): string {
  const list = (taking: boolean) => {
    const rows = model.items.filter(item => Boolean(item.bytes) === taking);
    return rows.length ? `<ul>${rows.map(item => `<li><strong>${escape(item.label)}</strong><p>${escape(item.reason)}</p></li>`).join('')}</ul>` : '<p>해당하는 항목이 없어요.</p>';
  };
  const results = model.results ? `<section aria-labelledby="results"><h2 id="results">항목별 결과</h2><ul>${model.results.map((row, index) => `<li><strong>${row.status} · ${escape(row.label)}</strong><p>${escape(row.reason)}</p>${row.directory && row.status === '옮김' ? `<p>사본 위치: ${escape(row.directory)}</p>` : ''}${row.status === '실패' ? `<button type="button" data-retry="${index}" aria-label="${escape(row.label)} 다시 시도">다시 시도</button>` : ''}</li>`).join('')}</ul></section>` : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escape(nonce)}'"><style>
body{margin:0;padding:20px;font:14px/1.5 system-ui;color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow-wrap:anywhere}main{max-width:960px;margin:auto}h1{font-size:22px}h2{font-size:18px}p{margin:8px 0}ul{padding-left:20px}li{margin:12px 0}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.group{border:1px solid var(--vscode-panel-border);padding:16px;min-width:0}button{font:inherit;min-height:44px;min-width:44px;padding:8px 16px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,transparent);cursor:pointer}#confirm{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:focus-visible{outline:2px solid var(--vscode-focusBorder,Highlight);outline-offset:2px}footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}@media(max-width:600px){.columns{grid-template-columns:minmax(0,1fr)}body{padding:16px}}@media(forced-colors:active){.group,button{border:1px solid CanvasText}button:focus-visible{outline-color:Highlight}}
</style></head><body><main><h1>내 작업 가져가기${model.results ? ' 결과' : ''}</h1><p>사본 위치: ${escape(model.destination)}</p><div class="columns"><section class="group" aria-labelledby="taking"><h2 id="taking">가져가는 것</h2>${list(true)}</section><section class="group" aria-labelledby="staying"><h2 id="staying">남는 것</h2>${list(false)}</section></div><p>원본은 삭제하지 않아요. 가져간 작업은 읽기용 사본이며 AI 이용 권한은 옮겨지지 않아요.</p>${results}<footer><button id="close" type="button" autofocus>${model.results ? '닫기' : '취소'}</button>${model.results ? '' : '<button id="confirm" type="button">사본 가져가기</button>'}</footer></main><script nonce="${escape(nonce)}">(()=>{const api=acquireVsCodeApi(),nonce=${JSON.stringify(nonce)};let sent=false;const send=m=>{if(sent)return;sent=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);api.postMessage({...m,nonce})};document.getElementById('close').onclick=()=>send({action:'close'});const confirm=document.getElementById('confirm');if(confirm)confirm.onclick=()=>send({action:'confirm'});for(const b of document.querySelectorAll('[data-retry]'))b.onclick=()=>send({action:'retry',index:Number(b.dataset.retry)});document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();send({action:'close'})}});})();</script></body></html>`;
}

/** A fresh nonce and model per view; messages cannot choose bytes, paths or a successful item to retry. */
export async function showWorkTakeawayPanel(model: TakeawayPanel): Promise<TakeawayAction> {
  let panel: vscode.WebviewPanel | undefined;
  try {
    panel = vscode.window.createWebviewPanel('hypeproof.workTakeaway', '내 작업 가져가기', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
    const target = panel, nonce = randomBytes(24).toString('hex');
    return await new Promise(resolve => {
      let done = false;
      const finish = (answer: TakeawayAction) => { if (done) return; done = true; clearTimeout(timer); received.dispose(); closed.dispose(); resolve(answer); };
      const timer = setTimeout(() => finish({ action: 'close' }), 5 * 60_000);
      const closed = target.onDidDispose(() => finish({ action: 'close' }));
      const received = target.webview.onDidReceiveMessage(message => {
        if (message?.nonce !== nonce) return;
        if (message.action === 'close') finish({ action: 'close' });
        else if (message.action === 'confirm' && !model.results) finish({ action: 'confirm' });
        else if (message.action === 'retry' && Number.isInteger(message.index) && model.results?.[message.index]?.status === '실패') finish({ action: 'retry', index: message.index });
      });
      target.webview.html = workTakeawayHtml(model, nonce);
    });
  } catch { return { action: 'close' }; }
  finally { panel?.dispose(); }
}
