// REQ-KNOW-63: serve only an immutable copy of the outbound bytes, never a workspace.
import { createServer } from 'node:http';
import { extname } from 'node:path';
export interface VisitorSnapshot { entry: string; audience: string; files: readonly { path: string; data: Uint8Array }[] }
export type VisitorPreview = (snapshot: VisitorSnapshot) => Promise<boolean>;
// With `nosniff`, an unknown type is served as text/plain and a module script or font would
// break here while working live, so every type a static site commonly ships is named.
const mime: Record<string, string> = {
  '.html':'text/html', '.htm':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.map':'application/json', '.webmanifest':'application/manifest+json', '.txt':'text/plain', '.md':'text/markdown', '.xml':'application/xml', '.csv':'text/csv', '.wasm':'application/wasm', '.pdf':'application/pdf',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon', '.bmp':'image/bmp',
  '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.otf':'font/otf',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.mp4':'video/mp4', '.webm':'video/webm', '.ogv':'video/ogg', '.vtt':'text/vtt',
};
const textual = (type: string) => type.startsWith('text/') || /^application\/(json|manifest\+json|xml)$/.test(type) || type === 'image/svg+xml';
/** Content-Type for a snapshot path; charset only on textual types. */
export function visitorContentType(path: string): string {
  const type = mime[extname(path).toLowerCase()] ?? 'text/plain';
  return textual(type) ? `${type}; charset=utf-8` : type;
}
export const VISITOR_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-same-origin";
export function validVisitorPath(p: string): boolean {
  return !!p && !/[\\\u0000-\u001f\u007f?#]/.test(p) && p.split('/').every(s => !!s && s !== '.' && s !== '..');
}
export async function startVisitorSnapshot(snapshot: VisitorSnapshot) {
  const files = new Map<string, Buffer>();
  for (const f of snapshot.files) {
    if (!validVisitorPath(f.path) || files.has(f.path)) throw new Error('Invalid preview file');
    files.set(f.path, Buffer.from(f.data));
  }
  const entry = snapshot.entry.replace(/^\//, '');
  if (!files.has(entry) || !snapshot.audience.trim()) throw new Error('Missing preview entry or audience');
  let markServed!: () => void;
  // Resolves when the entry page is actually requested: proof the panel's frame reached the server.
  const served = new Promise<void>(resolve => { markServed = resolve; });
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', VISITOR_CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()');
    const address = server.address();
    if (!address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}` || !['GET','HEAD'].includes(req.method ?? '')) { res.writeHead(403).end(); return; }
    let rel: string;
    try { rel = decodeURIComponent((req.url ?? '').split('?')[0]!.slice(1)); } catch { res.writeHead(400).end(); return; }
    if (!rel) rel = entry;
    else if (rel.endsWith('/')) rel += 'index.html';
    if (!validVisitorPath(rel) || !files.has(rel)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', visitorContentType(rel));
    if (rel === entry && req.method === 'GET') markServed();
    res.end(req.method === 'HEAD' ? undefined : files.get(rel));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Preview unavailable');
  return { url: `http://127.0.0.1:${address.port}/${entry.split('/').map(encodeURIComponent).join('/')}`, served, close: () => { server.closeAllConnections(); server.close(); } };
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const VISITOR_FALLBACK_MS = 15_000;
/**
 * Next unlocks only when the frame fired `load` AND the host reports (with the nonce) that the
 * snapshot server served the entry page; a message from the framed page itself is ignored.
 * If that has not happened within `fallbackMs`, the panel says so honestly, opens the file list
 * and lets the learner continue on the file list and audience alone (send consent still follows).
 */
export function visitorPreviewHtml(snapshot: VisitorSnapshot, url: string, nonce: string, fallbackMs = VISITOR_FALLBACK_MS): string {
  const origin = new URL(url).origin;
  const css = `body{font:14px system-ui;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:16px}`
    + `h1{overflow-wrap:anywhere}`
    + `button{font:inherit;min-height:44px;margin:4px;padding:8px 16px;border-radius:4px;border:1px solid var(--vscode-button-border,transparent);cursor:pointer}`
    + `#next{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}#cancel{color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,transparent)}button:disabled{opacity:.5;cursor:default}`
    + `summary{display:list-item;min-height:44px;box-sizing:border-box;padding:12px 8px;cursor:pointer}`
    + `button:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}`
    + `@media (forced-colors:active){button,summary{border:1px solid ButtonText}button:focus-visible,summary:focus-visible{outline:2px solid Highlight}}`
    + `iframe{background:#fff;width:100%;height:65vh;border:1px solid var(--vscode-panel-border)}li{overflow-wrap:anywhere}`;
  const script = `(()=>{const api=acquireVsCodeApi();const N=${JSON.stringify(nonce)};const frame=document.querySelector('iframe');const next=document.getElementById('next');const status=document.getElementById('status');let loaded=false,served=false,settled=false;`
    + `const ready=()=>{if(settled||!loaded||!served)return;settled=true;clearTimeout(t);status.textContent='공개할 화면과 범위를 확인해 주세요.';next.disabled=false};`
    + `frame.addEventListener('load',()=>{loaded=true;ready()});`
    + `window.addEventListener('message',e=>{if(e.source===frame.contentWindow||e.data?.type!=='served'||e.data?.nonce!==N)return;served=true;ready()});`
    + `const t=setTimeout(()=>{if(settled)return;settled=true;document.querySelector('details').open=true;status.textContent='이 창에서 미리보기 화면을 열지 못했어요. 공개할 파일과 공개 범위는 위 목록에서 확인할 수 있어요. 화면은 공개한 뒤 실제 주소에서 확인해 주세요.';next.textContent='화면 없이 목록 확인 · 다음';next.disabled=false},${Math.max(0, Math.floor(fallbackMs))});`
    + `for(const id of ['cancel','next'])document.getElementById(id).onclick=()=>api.postMessage({action:id,nonce:N});})();`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escape(nonce)}'; frame-src ${escape(origin)}"><style>${css}</style></head><body><h1>방문자에게 이렇게 보여요 · 공개 범위: ${escape(snapshot.audience)}</h1><p>공개할 파일만 보여요. 외부 연결·로그인·전송 기능은 미리보기에서 차단돼요. 아직 공개하지 않았어요.</p><details><summary>공개할 파일 ${snapshot.files.length}개</summary><ul>${snapshot.files.map(f=>`<li>${escape(f.path)} (${f.data.byteLength.toLocaleString('ko-KR')} 바이트)</li>`).join('')}</ul></details><iframe title="방문자 미리보기" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" src="${escape(url)}"></iframe><p id="status" role="status">미리보기를 불러오는 중이에요.</p><button id="cancel" autofocus>취소</button><button id="next" disabled>미리보기 확인 · 다음</button><script nonce="${escape(nonce)}">${script}</script></body></html>`;
}
