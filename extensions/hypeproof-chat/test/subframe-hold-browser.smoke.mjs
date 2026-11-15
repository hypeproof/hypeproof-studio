// #4128 (CGP-SHELL-R-026 follow-up F1) — minor seats: a cross-site iframe in the browser panel loads only when the
// lesson list admits it, with no dialog; subresources are not held (accepted residual, decisions.md).
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/subframe-hold-browser.smoke.mjs
// Real cross-site origins: headless Chromium with --site-per-process and a.test / b.test / c.test resolved to one
// local server that records every hit. a.test is the top page, b.test is off the list, c.test is on it. The guard is
// the shipped LinkNavigationGuard on the page session plus the browser endpoint (what a tab's root session is).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN subframe hold: no Chromium'); process.exit(0); }
const { LinkNavigationGuard } = await import('../src/linkNavigationGuard.ts');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const hits = [];
const server = createServer((req, res) => {
  const host = req.headers.host.split(':')[0], port = server.address().port;
  const at = (h) => `http://${h}:${port}`;
  hits.push(`${host}${req.url.split('?')[0]}`);
  res.setHeader('content-type', 'text/html');
  const page = (body) => res.end(`<!doctype html><title>${host}</title><body>${body}</body>`);
  const u = req.url.split('?')[0];
  if (host === 'a.test') {
    if (u === '/static') return page(`<iframe src="${at('b.test')}/static"></iframe>`);
    if (u === '/script') return page(`<script>var f=document.createElement('iframe');f.src='${at('b.test')}/script';document.body.appendChild(f)</script>`);
    if (u === '/allowed') return page(`<iframe id="f" src="${at('c.test')}/frame"></iframe><script>setTimeout(function(){document.getElementById('f').src='${at('b.test')}/src2'},900)</script>`);
    if (u === '/own-move') return page(`<iframe src="${at('c.test')}/moves"></iframe>`);
    if (u === '/nested') return page(`<iframe src="${at('c.test')}/nests"></iframe>`);
    if (u === '/same') return page(`<iframe src="/same-frame"></iframe><iframe srcdoc="<p>inline</p>"></iframe><iframe src="about:blank"></iframe>`);
    if (u === '/subres') return page(`<img src="${at('b.test')}/img.png"><script>fetch('${at('b.test')}/fetch',{mode:'no-cors'}).catch(function(){});navigator.sendBeacon('${at('b.test')}/beacon','x')</script><iframe src="${at('c.test')}/with-img"></iframe>`);
    if (u === '/redir') return page(`<iframe src="/go-b"></iframe>`);
    if (u === '/go-b') { res.statusCode = 302; res.setHeader('location', `${at('b.test')}/redirected`); return res.end(); }
    if (u === '/popup') return page(`<script>window.open('/popup-page')</script>`);
    if (u === '/popup-page') return page(`<iframe src="${at('b.test')}/in-popup"></iframe><iframe src="${at('c.test')}/moves"></iframe>`);
    if (u === '/list-frame') return page(`<iframe src="${at('c.test')}/frame"></iframe><iframe src="/same-frame"></iframe>`);
    return page('a');
  }
  if (host === 'c.test') {
    if (u === '/moves') return page(`<script>setTimeout(function(){location.href='${at('b.test')}/own-move'},300)</script>`);
    if (u === '/nests') return page(`<iframe src="${at('b.test')}/nested"></iframe><iframe src="${at('c.test')}/nested-ok"></iframe>`);
    if (u === '/with-img') return page(`<img src="${at('b.test')}/img-in-frame.png">`);
    return page('c');
  }
  return page('b');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const A = (path) => `http://a.test:${port}${path}`;
const reached = (h) => hits.includes(h);

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
  // A child session is addressed on the connection that attached it: popups on the root (browser) connection, the
  // page's out-of-process iframes on the page connection, and each child's own children on its parent's connection.
  const onRoot = new Set();
  b.onEvent((m) => { if (m.method === 'Target.attachedToTarget' && m.sessionId && onRoot.has(m.sessionId)) onRoot.add(m.params.sessionId); });
  root.onEvent((m) => { if (m.method === 'Target.attachedToTarget') onRoot.add(m.params.sessionId); });
  const port0 = (refuse = []) => ({
    send: (m, p) => (refuse.includes(m) ? Promise.reject(new Error(`'${m}' wasn't found`)) : b.send(m, p)),
    sendIn: (sid, m, p) => (refuse.includes(m) ? Promise.reject(new Error(`'${m}' wasn't found`)) : onRoot.has(sid) ? root.send(m, p, sid) : b.send(m, p, sid)),
    sendRoot: (m, p) => root.send(m, p), targetId: targetInfo.targetId,
    onEvent: (l) => {
      const off = b.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId }); });
      const offRoot = root.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId, ...(msg.sessionId ? {} : { root: true }) }); });
      return { dispose: () => { off(); offRoot(); } };
    },
  });
  const dialogs = [], frameAsks = [];
  const onList = (url) => { frameAsks.push(url); return Promise.resolve(new URL(url).hostname === 'c.test'); };
  // Each visit records how many subframe requests the guard refused during it, so a "sends nothing" is a refusal and
  // not a frame that never asked.
  let guard; const refusedIn = {};
  const visit = async (path, ms = 1500) => { hits.length = 0; const before = guard ? guard.stats.framesRefused : 0; await b.send('Page.navigate', { url: A(path) }); await settle(ms); if (guard) refusedIn[path] = guard.stats.framesRefused - before; };
  const closePopups = async () => { const { targetInfos } = await root.send('Target.getTargets'); for (const t of targetInfos) if (t.type === 'page' && t.targetId !== targetInfo.targetId) await root.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); };

  // Minor seat: decideFrame set (the host passes the lesson-list rule); layer 1 off so popups come through layer 2.
  await visit('/blank', 400);
  guard = new LinkNavigationGuard(port0(), async (url) => { dialogs.push(url); return false; }, { decideFrame: onList });
  await guard.start();
  ok(guard.capabilities.autoAttach, 'the session auto-attaches (out-of-process iframes come in paused)');

  await visit('/static');
  ok(!reached('b.test/static'), `a static iframe to an off-list site sends nothing (${JSON.stringify(hits)})`);
  await visit('/script');
  ok(!reached('b.test/script'), `a script-made iframe to an off-list site sends nothing (${JSON.stringify(hits)})`);
  await visit('/allowed', 2200);
  ok(reached('c.test/frame'), `an iframe the list admits loads (${JSON.stringify(hits)})`);
  ok(!reached('b.test/src2'), `the page then pointing that out-of-process iframe off the list sends nothing (${JSON.stringify(hits)})`);
  await visit('/own-move', 1800);
  ok(reached('c.test/moves') && !reached('b.test/own-move'), `an admitted iframe moving itself off the list sends nothing (${JSON.stringify(hits)})`);
  await visit('/nested', 1800);
  ok(reached('c.test/nests') && !reached('b.test/nested'), `an off-list iframe inside an admitted one sends nothing (${JSON.stringify(hits)})`);
  ok(reached('c.test/nested-ok'), `and an admitted one inside it loads (${JSON.stringify(hits)})`);
  await visit('/redir');
  ok(reached('a.test/go-b') && !reached('b.test/redirected'), `a same-site iframe that 302s off the list stops at the hop (${JSON.stringify(hits)})`);
  await visit('/popup', 2000);
  ok(reached('a.test/popup-page') && !reached('b.test/in-popup'), `an off-list iframe in a popup sends nothing (${JSON.stringify(hits)})`);
  ok(reached('c.test/moves') && !reached('b.test/own-move'), `an admitted iframe in a popup loads, and moving itself off the list sends nothing (${JSON.stringify(hits)})`);
  await closePopups();
  // Positive controls: same-origin, srcdoc and about:blank frames load; subresources are not held (accepted residual).
  await visit('/same');
  ok(reached('a.test/same-frame'), `a same-origin iframe loads (${JSON.stringify(hits)})`);
  const frames = (await b.evaluate(`[...document.querySelectorAll('iframe')].map(f=>{try{return f.contentDocument&&f.contentDocument.body?f.contentDocument.body.textContent:'x'}catch(e){return 'x'}})`));
  ok(Array.isArray(frames) && frames[1] === 'inline', `a srcdoc iframe renders (${JSON.stringify(frames)})`);
  await visit('/subres', 1800);
  ok(reached('b.test/img.png') && reached('b.test/fetch') && reached('b.test/beacon'), `the page's cross-site img, fetch and beacon are not held (${JSON.stringify(hits)})`);
  ok(reached('c.test/with-img') && reached('b.test/img-in-frame.png'), `nor an admitted frame's cross-site image (${JSON.stringify(hits)})`);
  ok(dialogs.length === 0, `no subframe ever asks the confirm dialog (${JSON.stringify(dialogs)})`);
  ok(frameAsks.every((u) => !/a\.test/.test(u)), `same-origin frames are not even asked about (${JSON.stringify(frameAsks)})`);
  for (const path of ['/static', '/script', '/allowed', '/own-move', '/nested', '/redir', '/popup']) ok(refusedIn[path] >= 1, `${path}: the guard refused it (refusals per visit ${JSON.stringify(refusedIn)})`);
  guard.dispose();

  // Fail closed: a page session that cannot attach its out-of-process iframes refuses a cross-site frame even when the
  // list admits it (its later loads could not be held); a same-origin frame still loads.
  guard = new LinkNavigationGuard(port0(['Target.setAutoAttach']), async () => false, { decideFrame: onList });
  await guard.start();
  await visit('/list-frame');
  ok(!reached('c.test/frame') && reached('a.test/same-frame'), `no iframe auto-attach: an admitted cross-site frame is refused, a same-origin one loads (${JSON.stringify(hits)})`);
  guard.dispose();

  // No network hold anywhere (Fetch.enable rejected in every session): a cross-site frame committed off the list is sent
  // back to about:blank (it may have loaded for a moment); an admitted one stays; nothing asks to close the tab.
  const frameUrls = async () => (await root.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'iframe').map((t) => t.url);
  const unheld = [];
  guard = new LinkNavigationGuard(port0(['Fetch.enable']), async () => false, { decideFrame: onList, onFrameUnheld: () => unheld.push(1) });
  await guard.start();
  ok(!guard.capabilities.fetch, 'the no-Fetch session really has no network hold');
  await visit('/static', 1800);
  const after = await frameUrls();
  ok(!after.some((u) => u.includes('b.test')), `no Fetch: an off-list frame does not stay loaded (frames now ${JSON.stringify(after)})`);
  await visit('/allowed', 2400);
  const after2 = await frameUrls();
  ok(!after2.some((u) => u.includes('b.test')), `no Fetch: an admitted frame re-pointed off the list does not stay loaded (frames now ${JSON.stringify(after2)})`);
  await visit('/list-frame', 1500);
  ok((await frameUrls()).some((u) => u.includes('c.test')), 'no Fetch: an admitted frame stays (positive control)');
  ok(unheld.length === 0, `no Fetch: every frame could be sent back, so the tab was not closed (${unheld.length})`);
  guard.dispose();

  // Adults (no decideFrame): frames load as before (negative control).
  guard = new LinkNavigationGuard(port0(), async () => false, {});
  await guard.start();
  await visit('/static');
  ok(reached('b.test/static'), `adult seat: a cross-site iframe loads (${JSON.stringify(hits)})`);
  guard.dispose();
  root.close();
} finally { server.close(); await b.close?.(); }
console.log(`PASS subframe hold: ${checks} checks (minor seats: cross-site frames by the lesson list, no dialog; subresources not held)`);
process.exit(0);
