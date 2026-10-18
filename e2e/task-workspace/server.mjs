import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskHarness } from '../../extensions/hypeproof-chat/test/task-workspace-harness.mjs';

export async function serveTaskWorkspace({ port = 0, directory, profile = null } = {}) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'hps-vessel-browser-'));
  const clients = new Set();
  const f = await createTaskHarness(root, message => { for (const client of clients) client.write(`data: ${JSON.stringify(message)}\n\n`); }, { profile });
  let failNextDraft = false;
  const saveDraft = f.store.saveDraft.bind(f.store);
  f.store.saveDraft = (...args) => {
    if (failNextDraft) { failNextDraft = false; return Promise.reject(new Error('Injected local draft failure')); }
    return saveDraft(...args);
  };
  const id = f.store.getView().activeTaskId;
  if (f.store.getHistory().length === 0 && f.store.getView().tasks.length === 1) {
    await f.store.rename(id, '릴리즈 엔진 설계');
    await f.store.append(id, [
      { id: 'fixture-user', role: 'user', content: '매일 새 기능을 전달하려면 어디부터 바꾸면 좋을까?', createdAt: 1 },
      { id: 'fixture-tool', role: 'tool', content: '공식 문서 확인', createdAt: 2, tool: { icon: '↗', label: '공식 문서에서 빌드 환경 확인', state: 'done' } },
      { id: 'fixture-answer', role: 'assistant', content: '먼저 릴리즈 후보와 검증 결과를 하나로 묶겠습니다.\n\n**검증이 끝난 같은 파일**을 담당자가 승인하도록 만들고, 실패하면 원인을 남겨 다음 실행에서 이어갑니다.\n\n기존 화면과 기록 저장을 재사용하면 앱 전체를 매번 다시 만들 필요가 없습니다.', createdAt: 3, citations: [{ url: 'https://www.electronjs.org/docs/latest/tutorial/security', title: 'Electron 보안 지침', domain: 'electronjs.org', tier: 3 }] },
    ]);
  }
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extensions/hypeproof-chat/webview-ui/dist');
  const bridge = `<script>
    (() => {
      const events = new EventSource('/events');
      const ready = new Promise(resolve => events.addEventListener('open', resolve, {once:true}));
      events.onmessage = event => window.dispatchEvent(new MessageEvent('message', {data:JSON.parse(event.data)}));
      window.acquireVsCodeApi = () => ({postMessage: message => { ready.then(() => fetch('/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(message)})); }, getState:()=>undefined,setState:()=>{throw Error('Transcript must belong to host');}});
    })();
  </script>`;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/fixture-controls') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><html lang="ko"><title>독립 검증용 제어</title><body><h1>독립 검증용 제어</h1><p>실제 제품 UI 밖의 합성 이벤트입니다. 다른 탭의 작업 화면에 적용합니다.</p><button data-action="source">새 출처 추가</button> <button data-action="stream">실행 시작</button> <button data-action="stop">실행 종료</button> <button data-action="fail-draft">다음 입력 저장 실패</button><p id="status" role="status"></p><p><a href="/?theme=light" target="_blank">밝은 화면 열기</a> <a href="/" target="_blank">어두운 화면 열기</a></p><script>document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{const response=await fetch('/fixture/'+button.dataset.action,{method:'POST'});document.querySelector('#status').textContent=response.ok?button.textContent+' 적용됨':'실패';});</script></body></html>`); return;
      }
      if (url.pathname === '/fixture/fail-draft' && request.method === 'POST') { failNextDraft = true; response.end('{}'); return; }
      if (url.pathname === '/fixture/image' && request.method === 'POST') {
        await f.h.post({ type: 'attachImage', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }); response.end('{}'); return;
      }
      if (url.pathname === '/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); response.write(': connected\n\n'); clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (url.pathname === '/messages' && request.method === 'POST') {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1000000) throw Error('fixture input too large'); }
        await f.handle(JSON.parse(body)); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/stream' && request.method === 'POST') {
        f.h.pendingSends = 1; await f.h.post({ type: 'streamStart', streamId: 'fixture-run', messageId: 'fixture-answer-2' }); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/stop' && request.method === 'POST') {
        f.h.pendingSends = 0; await f.h.post({ type: 'streamEnd', streamId: 'fixture-run' }); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/source' && request.method === 'POST') {
        await f.h.appendHistory([{ id: 'fixture-extra-source', role: 'assistant', content: '다른 출처도 확인했습니다.', createdAt: 4, citations: [{ url: 'https://docs.github.com/en/actions', title: 'GitHub Actions 문서', domain: 'docs.github.com', tier: 3 }] }]); await f.h.postHistory(); response.end('{}'); return;
      }
      const target = resolve(dist, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
      if (!target.startsWith(dist + '/')) throw Error('fixture path outside dist');
      let body = await readFile(target);
      if (target.endsWith('index.html')) {
        const light = url.searchParams.get('theme') === 'light' ? '<style>:root{color-scheme:light;--vscode-sideBar-background:#f5f6f7;--vscode-editor-background:#fff;--vscode-foreground:#24282f;--vscode-descriptionForeground:#626873;--vscode-panel-border:#d9dde2;--vscode-input-background:#f4f5f6;--vscode-list-inactiveSelectionBackground:#e9edf2;--vscode-list-hoverBackground:#e4e9ef;--vscode-focusBorder:#3068a7;--vscode-button-background:#365d95;--vscode-button-foreground:#fff;}</style>' : '';
        body = Buffer.from(body.toString().replace('<head>', '<head>' + bridge + light));
      }
      response.setHeader('content-type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html'); response.end(body);
    } catch (error) { response.writeHead(500).end(String(error.message)); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, root, fixture: f, close: async () => { for (const client of clients) client.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv.includes('--serve')) {
  const result = await serveTaskWorkspace({ port: Number(process.env.PORT ?? 8789), directory: process.env.HPS_TASK_FIXTURE_DIR });
  console.log(JSON.stringify({ url: result.url, directory: result.root, scope: 'built product React + actual host task handlers + real local store; synthetic Service and browser API' }));
}
