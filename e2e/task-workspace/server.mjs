import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskHarness } from '../../extensions/hypeproof-chat/test/task-workspace-harness.mjs';

export async function serveTaskWorkspace({ port = 0, directory } = {}) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'hps-vessel-browser-'));
  const clients = new Set();
  const f = await createTaskHarness(root, message => { for (const client of clients) client.write(`data: ${JSON.stringify(message)}\n\n`); });
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
      if (target.endsWith('index.html')) body = Buffer.from(body.toString().replace('<head>', '<head>' + bridge));
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
