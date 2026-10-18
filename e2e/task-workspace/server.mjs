import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskHarness } from '../../extensions/hypeproof-chat/test/task-workspace-harness.mjs';

export async function serveTaskWorkspace({ port = 0, directory, profile = null, turnTools = { webSearch: { available: false, reason: "현재 연결에서는 웹 검색을 사용할 수 없습니다." } } } = {}) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'hps-vessel-browser-'));
  const clients = new Set();
  const f = await createTaskHarness(root, message => { for (const client of clients) client.write(`data: ${JSON.stringify(message)}\n\n`); }, { profile, turnTools });
  let failNextDraft = false;
  const sent = [], canceled = [];
  let streamSerial = 0;
  const startStream = async () => {
    f.h.pendingSends = 1;
    await f.h.post({ type: 'streamStart', streamId: 'fixture-run', messageId: `fixture-stream-${++streamSerial}` });
  };
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
        response.end(`<!doctype html><html lang="ko"><title>독립 검증용 제어</title><body><h1>독립 검증용 제어</h1><p>실제 제품 UI 밖의 합성 이벤트입니다. 다른 탭의 작업 화면에 적용합니다.</p><button data-action="rich">표·코드·긴 문장 추가</button> <button data-action="history">이전 대화 20개 추가</button> <button data-action="source">새 출처 추가</button> <button data-action="stream">실행 시작</button> <button data-action="delta">응답 이어 쓰기</button> <button data-action="stop">실행 종료</button> <button data-action="fail-draft">다음 입력 저장 실패</button> <button data-action="tools-available">합성 웹 검색 사용 가능</button> <button data-action="tools-unavailable">합성 웹 검색 사용 불가</button> <button data-action="reject">합성 요청 실패</button><p id="status" role="status"></p><p><a href="/?theme=light" target="_blank">밝은 화면 열기</a> <a href="/" target="_blank">어두운 화면 열기</a></p><script>document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{const response=await fetch('/fixture/'+button.dataset.action,{method:'POST'});document.querySelector('#status').textContent=response.ok?button.textContent+' 적용됨':'실패';});</script></body></html>`); return;
      }
      if (url.pathname === '/fixture/tools-available' && request.method === 'POST') { turnTools.webSearch = { available: true }; await f.h.postConfig(); response.end('{}'); return; }
      if (url.pathname === '/fixture/tools-unavailable' && request.method === 'POST') { turnTools.webSearch = { available: false, reason: '현재 연결에서는 웹 검색을 사용할 수 없습니다.' }; await f.h.postConfig(); response.end('{}'); return; }
      if (url.pathname === '/fixture/reject' && request.method === 'POST') {
        const last = sent.at(-1); f.h.pendingSends = 0;
        if (last) await f.h.post({ type: 'inputRejected', text: last.text ?? last.prompt, toolMode: last.toolMode, images: last.images });
        await f.h.post({ type: 'streamError', streamId: 'fixture-run', error: '합성 연결 오류: 입력이 보존되었습니다.' }); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/fail-draft'  && request.method === 'POST') { failNextDraft = true; response.end('{}'); return; }
      if (url.pathname === '/fixture/rich' && request.method === 'POST') {
        await f.h.appendHistory([
          { id: `rich-user-${Date.now()}`, role: 'user', content: '검증 항목을 표로 정리하고, 실패했을 때 이어갈 방법도 보여줘.', createdAt: Date.now() },
          { id: `rich-answer-${Date.now()}`, role: 'assistant', content: '## 오늘 확인할 것\n\n빌드가 끝나면 **같은 후보 파일**로 설치와 업데이트를 확인합니다. 실패한 단계에서 다시 시작할 수 있도록 결과를 보관합니다.\n\n| 단계 | 확인할 결과 | 담당 |\n| --- | --- | --- |\n| 설치 | 앱이 정상으로 열림 | 자동 검증 |\n| 업데이트 | 이전 대화가 그대로 남음 | 자동 검증 |\n| 승인 | 결과와 변경 내용 확인 | 릴리즈 매니저 |\n\n### 실패하면 이렇게 이어갑니다\n\n1. 실패한 실행과 재현 방법을 남깁니다.\n2. 수정 후 같은 검증을 다시 실행합니다.\n3. 모든 검증이 끝난 후보를 승인합니다.\n\n```json\n{ "candidate": "same-bytes", "status": "awaiting-review" }\n```\n\n출처: [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security)\n\n긴 식별자도 보존합니다: release-candidate-sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', createdAt: Date.now(), citations: [{ url: 'https://www.electronjs.org/docs/latest/tutorial/security', title: 'Electron 보안 지침', domain: 'electronjs.org', tier: 3 }] },
        ]); await f.h.postHistory(); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/history' && request.method === 'POST') {
        await f.h.appendHistory(Array.from({ length: 20 }, (_, i) => ({ id: `history-${Date.now()}-${i}`, role: i % 2 ? 'assistant' : 'user', content: `이전 대화 ${i + 1}. ` + '기록을 읽는 동안 새 응답이 와도 읽던 위치를 유지합니다. '.repeat(8), createdAt: Date.now() + i })));
        await f.h.postHistory(); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/delta' && request.method === 'POST') {
        await f.h.post({ type: 'streamChunk', streamId: 'fixture-run', delta: '\n\n' + '추가 확인 결과입니다. 승인 전에 설치와 업데이트 흐름을 점검하고, 실패한 항목은 재현 방법과 함께 남깁니다. '.repeat(5) }); response.end('{}'); return;
      }
      if (url.pathname === '/fixture/image' && request.method === 'POST') {
        await f.h.post({ type: 'attachImage', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }); response.end('{}'); return;
      }
      if (url.pathname === '/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); response.write(': connected\n\n'); clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (url.pathname === '/messages' && request.method === 'POST') {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1000000) throw Error('fixture input too large'); }
        const message = JSON.parse(body);
        // Model seam only: record send/cancel intent without dispatching a paid request.
        // Task/history/draft handling still goes through the actual provider and store.
        if (message.type === 'sendMessage' || message.type === 'retryMessage') { sent.push(message); await startStream(); }
        else if (message.type === 'cancelStream') { canceled.push(message); f.h.pendingSends = 0; await f.h.post({ type: 'streamStopped', by: 'user' }); }
        else await f.handle(message);
        response.end('{}'); return;
      }
      if (url.pathname === '/fixture/stream' && request.method === 'POST') {
        await startStream(); response.end('{}'); return;
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
        if (url.searchParams.get('clipboard') === 'denied') response.setHeader('Permissions-Policy', 'clipboard-write=()');
        const light = url.searchParams.get('theme') === 'light' ? '<style>:root{color-scheme:light;--vscode-sideBar-background:#f5f6f7;--vscode-editor-background:#fff;--vscode-foreground:#24282f;--vscode-descriptionForeground:#626873;--vscode-panel-border:#d9dde2;--vscode-input-background:#f4f5f6;--vscode-list-inactiveSelectionBackground:#e9edf2;--vscode-list-hoverBackground:#e4e9ef;--vscode-focusBorder:#3068a7;--vscode-button-background:#365d95;--vscode-button-foreground:#fff;}</style>' : '';
        body = Buffer.from(body.toString().replace('<head>', '<head>' + bridge + light));
      }
      response.setHeader('content-type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html'); response.end(body);
    } catch (error) { response.writeHead(500).end(String(error.message)); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, root, fixture: f, sent, canceled, close: async () => { for (const client of clients) client.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv.includes('--serve')) {
  const result = await serveTaskWorkspace({ port: Number(process.env.PORT ?? 8789), directory: process.env.HPS_TASK_FIXTURE_DIR });
  console.log(JSON.stringify({ url: result.url, directory: result.root, scope: 'built product React + actual host task handlers + real local store; synthetic Service and browser API' }));
}
