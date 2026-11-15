// Jay's decision (2026-11-15), the CGP-SHELL-R-026 subresource slice: on minor seats an AI-made loopback page may
// not send fetch, XHR, sendBeacon or EventSource to a site off the lesson list. Images, CDN scripts, stylesheets
// and fonts are unchanged, and pages on other sites are not affected.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/outbound-hold-browser.smoke.mjs
// One local server records every hit. 127.0.0.1 is the loopback top, b.test is off the list, c.test is on it, and
// a.test is a non-loopback site. The guard is the shipped LinkNavigationGuard over the tab's page and root sessions.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN outbound hold: no Chromium'); process.exit(0); }
const { LinkNavigationGuard, studioNavigate } = await import('../src/linkNavigationGuard.ts');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const hits = [];
const server = createServer((req, res) => {
  const host = req.headers.host.split(':')[0], port = server.address().port, u = req.url.split('?')[0];
  const at = (h) => `http://${h}:${port}`;
  hits.push(`${host}${u}`);
  res.setHeader('access-control-allow-origin', '*');
  if (u.startsWith('/sse')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: x\n\n'); return; }
  if (u.endsWith('.png')) { res.setHeader('content-type', 'image/png'); return res.end(); }
  if (u.endsWith('.css')) { res.setHeader('content-type', 'text/css'); return res.end('p{}'); }
  if (u.endsWith('.js')) { res.setHeader('content-type', 'text/javascript'); return res.end('void 0'); }
  res.setHeader('content-type', 'text/html');
  const page = (body) => res.end(`<!doctype html><title>${host}</title><body>${body}</body>`);
  // Every way a page sends data out, to the site off the list.
  const send = (to, tag) => `<script>
    fetch('${at(to)}/${tag}-fetch',{mode:'no-cors',method:'POST',body:'typed'}).catch(function(){});
    var x=new XMLHttpRequest();x.open('POST','${at(to)}/${tag}-xhr');x.send('typed');
    navigator.sendBeacon('${at(to)}/${tag}-beacon','typed');
    try{var es=new EventSource('${at(to)}/sse-${tag}');setTimeout(function(){es.close()},500)}catch(e){}
  </script>`;
  if (u === '/ai') return page(send('b.test', 'b'));
  if (u === '/ai-assets') return page(`<img src="${at('b.test')}/img.png"><link rel="stylesheet" href="${at('b.test')}/s.css"><script src="${at('b.test')}/cdn.js"></script>`);
  if (u === '/ai-allowed') return page(send('c.test', 'c'));
  if (u === '/ai-loop') return page(send('localhost', 'loop') + `<script>fetch('/same-fetch').catch(function(){})</script>`);
  if (u === '/ai-frame') return page(`<iframe src="/frame-send"></iframe><iframe src="${at('c.test')}/frame-send-c"></iframe>`);
  if (u === '/frame-send') return page(send('b.test', 'fr'));
  if (u === '/frame-send-c') return page(send('b.test', 'frc'));
  if (u === '/ai-popup') return page(`<button id="po" style="display:block;width:200px;height:40px" onclick="window.open('/popup-send')">open</button>`);
  if (u === '/popup-send') return page(send('b.test', 'pop'));
  if (u === '/site') return page(send('b.test', 'site'));
  // verify-3928 on #4214: a redirect hop to the off-list site, requests fired as the page goes away, and workers.
  if (u === '/hop-local') { res.statusCode = 302; res.setHeader('location', `${at('b.test')}/hop-from-local`); return res.end(); }
  if (u === '/hop-list') { res.statusCode = 302; res.setHeader('location', `${at('b.test')}/hop-from-list`); return res.end(); }
  if (u === '/ai-hops') return page(`<script>fetch('/hop-local',{mode:'no-cors'}).catch(function(){});fetch('${at('c.test')}/hop-list',{mode:'no-cors'}).catch(function(){})</script>`);
  if (u === '/ai-leave') return page(`<script>addEventListener('pagehide',function(){fetch('${at('b.test')}/leave-keepalive',{method:'POST',body:'typed',keepalive:true,mode:'no-cors'});navigator.sendBeacon('${at('b.test')}/leave-beacon','typed')})</script>`);
  if (u === '/worker-d') { res.setHeader('content-type', 'text/javascript'); return res.end(`fetch('${at('b.test')}/from-worker',{mode:'no-cors'}).catch(function(){})`); }
  if (u === '/worker-s') { res.setHeader('content-type', 'text/javascript'); return res.end(`onconnect=function(){};fetch('${at('b.test')}/from-shared',{mode:'no-cors'}).catch(function(){})`); }
  if (u === '/worker-sw') { res.setHeader('content-type', 'text/javascript'); return res.end(`fetch('${at('b.test')}/from-service',{mode:'no-cors'}).catch(function(){})`); }
  if (u === '/ai-workers') return page(`<script>new Worker('/worker-d');try{new SharedWorker('/worker-s')}catch(e){}try{navigator.serviceWorker.register('/worker-sw')}catch(e){}</script>`);
  if (u === '/ai-ws') return page(`<script>try{new WebSocket('ws://b.test:${port}/ws-b')}catch(e){}</script>`);
  return page('ok');
});
// A WebSocket handshake arrives as an upgrade: record it, then drop the socket.
server.on('upgrade', (req, sock) => { hits.push(`UPGRADE ${req.headers.host.split(':')[0]}${req.url}`); sock.destroy(); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const LOOP = (path) => `http://127.0.0.1:${port}${path}`;
const kinds = (tag) => [`${tag}-fetch`, `${tag}-xhr`, `${tag}-beacon`, `sse-${tag}`];

const b = await launch(bin, 1, { args: ['--site-per-process', '--host-resolver-rules=MAP *.test 127.0.0.1'] });
const rootSession = async () => {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${b.port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), listeners = new Set();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else for (const l of [...listeners]) l(m); };
  return { send: (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); }),
    onEvent: (l) => { listeners.add(l); return () => listeners.delete(l); }, close: () => ws.close() };
};
try {
  await b.send('Page.enable');
  const root = await rootSession();
  const { targetInfo } = await b.send('Target.getTargetInfo');
  const onRoot = new Set();
  b.onEvent((m) => { if (m.method === 'Target.attachedToTarget' && m.sessionId && onRoot.has(m.sessionId)) onRoot.add(m.params.sessionId); });
  root.onEvent((m) => { if (m.method === 'Target.attachedToTarget') onRoot.add(m.params.sessionId); });
  const port0 = {
    send: (m, p) => b.send(m, p), sendIn: (sid, m, p) => (onRoot.has(sid) ? root.send(m, p, sid) : b.send(m, p, sid)),
    sendRoot: (m, p) => root.send(m, p), targetId: targetInfo.targetId,
    onEvent: (l) => {
      const off = b.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId }); });
      const offRoot = root.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId, ...(msg.sessionId ? {} : { root: true }) }); });
      return { dispose: () => { off(); offRoot(); } };
    },
  };
  const onList = async (url) => ['c.test', '127.0.0.1', 'localhost'].includes(new URL(url).hostname);
  const blocked = [];
  const minor = { decideFrame: onList, outbound: { allowed: onList, onBlocked: (url) => blocked.push(url) } };
  // The harness's navigations stand for Studio's (recorded), so the main-frame rule lets them go.
  const nav = async (url, ms = 1500) => { hits.length = 0; blocked.length = 0; await studioNavigate({ send: (m, p) => b.send(m, p), targetId: targetInfo.targetId }, url); await settle(ms); };
  const none = (tag) => kinds(tag).every((k) => !hits.some((h) => h.endsWith(`/${k}`)));
  const all = (tag) => kinds(tag).every((k) => hits.some((h) => h.endsWith(`/${k}`)));

  let guard = new LinkNavigationGuard(port0, async () => false, minor);
  await guard.start();

  await nav(LOOP('/ai'));
  ok(none('b'), `minor seat, loopback page: fetch, XHR, sendBeacon and EventSource to a site off the list send nothing (${JSON.stringify(hits)})`);
  ok(blocked.length >= 4, `each refusal is reported to the host (${blocked.length})`);
  await nav(LOOP('/ai-assets'));
  ok(['img.png', 's.css', 'cdn.js'].every((k) => hits.includes(`b.test/${k}`)), `images, stylesheets and CDN scripts from that site still load (${JSON.stringify(hits)})`);
  await nav(LOOP('/ai-allowed'));
  ok(all('c'), `a site on the lesson list receives them (${JSON.stringify(hits)})`);
  await nav(LOOP('/ai-loop'));
  ok(all('loop') && hits.includes('127.0.0.1/same-fetch'), `loopback-to-loopback and same-origin requests go on (${JSON.stringify(hits)})`);
  await nav(LOOP('/ai-frame'), 2200);
  ok(none('fr') && none('frc'), `frames of a loopback page, same-origin and cross-site, send nothing off the list (${JSON.stringify(hits)})`);
  await nav(LOOP('/ai-popup'), 300);
  {
    const r = await b.evaluate(`(()=>{const x=document.getElementById('po').getBoundingClientRect();return {x:x.left+10,y:x.top+10}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    const until = Date.now() + 10_000;
    while (Date.now() < until && !(hits.includes('127.0.0.1/popup-send') && blocked.length >= 4)) await settle(50);
    await settle(300);
  }
  ok(hits.includes('127.0.0.1/popup-send') && none('pop'), `a loopback popup sends nothing off the list (${JSON.stringify(hits)})`);
  { const { targetInfos } = await root.send('Target.getTargets'); for (const t of targetInfos) if (t.type === 'page' && t.targetId !== targetInfo.targetId) await root.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); }
  await nav(`http://a.test:${port}/site`);
  ok(all('site'), `a page on another (non-loopback) site is not affected (${JSON.stringify(hits)})`);
  ok(guard.stats.outboundRefused >= 16, `refusals are counted (${JSON.stringify(guard.stats)})`);
  // A redirect hop to the off-list site, from a loopback URL and from one on the list: the hop is refused.
  await nav(LOOP('/ai-hops'));
  ok(hits.includes('127.0.0.1/hop-local') && hits.includes('c.test/hop-list') && !hits.includes('b.test/hop-from-local') && !hits.includes('b.test/hop-from-list'),
    `a 302 from a loopback or listed address to the off-list site is refused at the hop (${JSON.stringify(hits)})`);
  // Requests fired as the page goes away (fetch keepalive and sendBeacon on pagehide), leaving for another loopback page
  // and for a page on another site: refused.
  for (const next of [LOOP('/blank'), `http://a.test:${port}/blank`]) {
    await nav(LOOP('/ai-leave'), 600); hits.length = 0; await nav(next, 1200);
    ok(!hits.includes('b.test/leave-keepalive') && !hits.includes('b.test/leave-beacon'), `keepalive fetch and sendBeacon on pagehide (to ${next}) send nothing (${JSON.stringify(hits)})`);
  }
  // Workers. A dedicated worker's requests are paused in its page's session, so they are held like the page's own.
  // EXPECTED RESIDUAL (in Jay's scope, NOT covered by the CDP guard): shared and service workers are separate targets
  // the guard does not attach, so their requests are not held. Core's webRequest sees them; the planned fix is the
  // #4209 core patch (its optional second commit). These checks pin today's behaviour; flip them when that lands.
  await nav(LOOP('/ai-workers'), 2500);
  ok(hits.includes('127.0.0.1/worker-d') && !hits.includes('b.test/from-worker'), `a dedicated worker's fetch to an off-list site is refused (${JSON.stringify(hits)})`);
  ok(hits.includes('b.test/from-shared'), `EXPECTED RESIDUAL: a shared worker's fetch to an off-list site still goes (${JSON.stringify(hits)})`);
  ok(hits.includes('b.test/from-service'), `EXPECTED RESIDUAL: a service worker's fetch to an off-list site still goes (${JSON.stringify(hits)})`);
  // EXPECTED RESIDUAL (Jay's 2026-11-15 scope includes WebSocket; not yet covered). The Fetch domain cannot pause a
  // WebSocket handshake and Network.setBlockedURLs does not stop it, so a loopback page on a minor seat still opens a
  // WebSocket to a site off the list. This check pins today's behaviour; the planned fix is a safe-session core patch
  // blocking ws/wss upgrades (decisions.md). When that lands, flip this assertion.
  await nav(LOOP('/ai-ws'), 1200);
  ok(hits.includes('UPGRADE b.test/ws-b'), `EXPECTED RESIDUAL: a minor loopback page's WebSocket to an off-list site still connects (${JSON.stringify(hits)})`);
  guard.dispose();

  // Adults: no outbound hold (negative control).
  guard = new LinkNavigationGuard(port0, async () => false, {});
  await guard.start();
  await nav(LOOP('/ai'));
  ok(all('b'), `adult seat: a loopback page's requests go on (${JSON.stringify(hits)})`);
  await nav(LOOP('/ai-workers'), 2500);
  ok(hits.includes('b.test/from-worker') && hits.includes('b.test/from-shared'), `adult seat: workers' requests go on (control for the worker cases) (${JSON.stringify(hits)})`);
  guard.dispose();

  root.close();
} finally { server.close(); await b.close?.(); }
console.log(`PASS outbound hold: ${checks} checks (minor seats, loopback pages: fetch/XHR/beacon/EventSource off the list refused; assets unchanged)`);
process.exit(0);
