// CGP-SHELL-R-026 (REQ-SHELL-26, DES-SHELL-25) — the link confirm dialog in the real App bundle, and the preview's link
// relay, in headless Chromium with real (CDP) key and mouse input.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/link-confirm-browser.smoke.mjs
// Dialog: 취소 holds the first focus, Enter on it and Esc cancel, only 열기 opens; the host line is bold ASCII; an IDN
// host also shows its decoded form and the look-alike warning; the full address wraps inside a 320px pane; 44px
// buttons; the dialog is named by its title and described by the host and the address. Dark/light, 320/800px.
// Relay: a real click on an external link posts the relay message and does not navigate; a scripted el.click()
// (isTrusted false) and a same-page link post nothing. A page script can still post the shape itself, which is why the
// host confirms and rate-limits every preview link (test/link-confirm-host.smoke.mjs).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { createServer } from 'node:http';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN link confirm: no Chromium'); process.exit(0); }
const { injectLinkRelay, PREVIEW_LINK_MESSAGE } = await import('../src/previewHtml.ts');
const { LinkNavigationGuard, studioNavigations, studioNavigate } = await import('../src/linkNavigationGuard.ts');
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'link-confirm-assets', write: false, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin);
// The browser-level endpoint (what a tab's root CDP session is in Studio: Target.* reaches the tab's popups).
const rootSession = async () => {
  const port = b.port;
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), listeners = new Set();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else for (const l of [...listeners]) l(m); };
  return { send: (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); }),
    onEvent: (l) => { listeners.add(l); return () => listeners.delete(l); }, close: () => ws.close() };
};
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const ev = (x) => b.evaluate(x);
const send = async (data) => { await ev(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const hostShim = `window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`;
const press = async (key, code, vk) => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); await settle(450); };
const answers = () => ev(`window.__posts.filter(m=>m.type==='linkConfirmAnswer').map(m=>m.choice)`);
const LONG = 'https://news.example.com/' + 'section/'.repeat(14) + 'story?ref=classroom&utm_source=chat&page=2#comments';
const idnHost = new URL('https://аpple.com/').hostname;
const prompt = (id, over = {}) => ({ id, host: 'news.example.com', unicodeHost: null, warning: false, url: LONG, where: 'integrated', source: 'chat', ...over });
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

try {
  for (const theme of ['Dark+', 'Light+']) for (const width of [320, 800]) {
    const t = THEMES[theme];
    const vars = Object.entries(t).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${t.kind === 'dark' ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${hostShim}</script><script>${script}</script></body></html>`, { width, height: 800, dark: t.kind === 'dark', appReady: true });
    await send({ type: 'config', config: chatConfig(3) });
    await send({ type: 'history', messages: [] });
    const label = `${theme} ${width}px`;

    // Enter on the first focus cancels.
    await send({ type: 'linkConfirmPrompt', prompt: prompt('a') });
    const m = await ev(`(()=>{const d=document.querySelector('dialog.hps-link-confirm[open]');if(!d)return null;const r=e=>e.getBoundingClientRect();const by=id=>document.getElementById(id);
      const btns=[...d.querySelectorAll('.hps-write-actions button')].map(x=>({t:x.textContent,h:r(x).height,w:r(x).width,right:r(x).right}));
      const host=d.querySelector('.hps-browser-host');const url=d.querySelector('.hps-link-url');
      return {focus:document.activeElement?.textContent,labelled:by(d.getAttribute('aria-labelledby'))?.textContent,described:d.getAttribute('aria-describedby').split(' ').map(i=>by(i)?.textContent||''),
        hostWeight:getComputedStyle(host).fontWeight,hostText:host.textContent,url:url.textContent,urlRight:r(url).right,dialogRight:r(d).right,page:document.documentElement.scrollWidth>innerWidth+0.5,btns,width:innerWidth}})()`);
    ok(m, `the dialog opens (${label})`);
    ok(m.focus === '취소', `취소 holds the first focus (${label}): ${m.focus}`);
    ok(m.labelled === '바깥 사이트를 열까요?' && m.described.some(x => x.includes('news.example.com')) && m.described.some(x => x === LONG), `named by its title, described by host and address (${label})`);
    ok(Number(m.hostWeight) >= 600 && m.hostText === 'news.example.com', `the host is bold (${label})`);
    ok(m.url === LONG && m.urlRight <= m.dialogRight + 0.5 && !m.page, `the full address wraps inside the dialog, no page scroll (${label})`);
    ok(m.btns.map(x => x.t).join('|') === '취소|열기|링크 복사' && m.btns.every(x => x.h >= 43.99 && x.w >= 43.99 && x.right <= m.width + 0.5), `three 44px buttons inside the pane (${label}): ${JSON.stringify(m.btns)}`);
    await press('Enter', 'Enter', 13);
    ok(JSON.stringify(await answers()) === '["cancel"]', `Enter on 취소 cancels (${label}): ${JSON.stringify(await answers())}`);
    ok(!(await ev(`!!document.querySelector('dialog.hps-link-confirm[open]')`)), `and closes the dialog (${label})`);

    // Esc cancels; only a real activation of 열기 opens; 링크 복사 copies.
    const clickOn = async (sel) => { const r = await ev(`(()=>{const x=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:x.left+x.width/2,y:x.top+x.height/2}})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await settle(450); };
    await send({ type: 'linkConfirmPrompt', prompt: prompt('b') });
    await press('Escape', 'Escape', 27);
    await send({ type: 'linkConfirmPrompt', prompt: prompt('c') });
    // A scripted click (isTrusted false) and a held Enter on 열기 open nothing.
    await ev(`document.querySelector('[data-link-open]').click()`); await settle(200);
    await ev(`document.querySelector('[data-link-open]').focus()`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true, text: '\r', unmodifiedText: '\r' });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await settle(300);
    ok(JSON.stringify(await answers()) === '["cancel","cancel"]' && (await ev(`!!document.querySelector('dialog.hps-link-confirm[open]')`)), `a scripted click and a held Enter on 열기 do nothing (${label}): ${JSON.stringify(await answers())}`);
    await clickOn('[data-link-open]');
    await send({ type: 'linkConfirmPrompt', prompt: prompt('d') });
    await clickOn('[data-link-copy]');
    // A fresh Enter on 열기 itself opens.
    await send({ type: 'linkConfirmPrompt', prompt: prompt('d2') });
    await ev(`document.querySelector('[data-link-open]').focus()`); await press('Enter', 'Enter', 13);
    ok(JSON.stringify(await answers()) === '["cancel","cancel","open","copy","open"]', `Esc cancels, a real click or a fresh Enter on 열기 opens, 링크 복사 copies (${label}): ${JSON.stringify(await answers())}`);
    // An Enter held down in the composer when the dialog opens: its repeats reach the dialog and activate nothing.
    await ev(`document.querySelector('.hps-input textarea')?.focus()`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await send({ type: 'linkConfirmPrompt', prompt: prompt('held') });
    for (let i = 0; i < 4; i++) await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true, text: '\r', unmodifiedText: '\r' });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await settle(300);
    ok((await answers()).length === 5 && (await ev(`!!document.querySelector('dialog.hps-link-confirm[open]')`)), `a held Enter from the composer neither opens nor closes the dialog (${label}): ${JSON.stringify(await answers())}`);
    await press('Escape', 'Escape', 27);

    // IDN look-alike: ASCII host in bold, the decoded form beside it, and the warning.
    await send({ type: 'linkConfirmPrompt', prompt: prompt('e', { host: idnHost, unicodeHost: 'аpple.com', warning: true, url: `https://${idnHost}/login`, where: 'system', source: 'preview' }) });
    const idn = await ev(`(()=>{const d=document.querySelector('dialog.hps-link-confirm[open]');return {host:d.querySelector('.hps-browser-host').textContent,text:d.textContent,warning:d.querySelector('.hps-link-warning[role=note]')?.textContent}})()`);
    ok(idn.host === idnHost && idn.host.startsWith('xn--'), `an IDN host is shown as punycode in bold (${label})`);
    ok(idn.text.includes('аpple.com') && /흉내/.test(idn.warning ?? ''), `with its decoded form and the look-alike warning (${label})`);
    ok(idn.text.includes('미리 보기 화면에 있던 링크예요.') && idn.text.includes('컴퓨터의 기본 브라우저에서 열려요.'), `it says where the link came from and where it opens (${label})`);
    await press('Escape', 'Escape', 27);
    // Negative control: a plain host has no warning.
    await send({ type: 'linkConfirmPrompt', prompt: prompt('f') });
    ok(!(await ev(`!!document.querySelector('dialog.hps-link-confirm[open] .hps-link-warning')`)), `no warning for a plain host (${label})`);
    await press('Escape', 'Escape', 27);
  }

  // ---- The preview relay ----
  const relayPage = injectLinkRelay(`<!doctype html><html><head></head><body><a id="out" href="https://news.example.com/x" style="display:block;padding:20px">밖</a><a id="same" href="#part" style="display:block;padding:20px">안</a><p id="part">p</p></body></html>`)
    .replace('<head>', `<head><script>window.__relay=[];addEventListener('message',e=>{if(e.data&&e.data.type===${JSON.stringify(PREVIEW_LINK_MESSAGE)})__relay.push(e.data.href)});addEventListener('DOMContentLoaded',()=>document.body.addEventListener('click',e=>e.preventDefault()));</script>`);
  await b.load(relayPage, { width: 400, height: 400 });
  const clickAt = async (sel) => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center'});const x=e.getBoundingClientRect();return {x:x.left+5,y:x.top+5}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }); await settle(150); };
  await clickAt('#out');
  // (The test page itself keeps the window in place after the relay's turn, since a top-level page is not sandboxed.)
  ok(JSON.stringify(await ev('window.__relay')) === '["https://news.example.com/x"]' && (await ev('location.protocol')) !== 'https:', 'a real click posts the relay message and does not navigate');
  await ev(`document.getElementById('out').click()`); await settle(150);
  ok((await ev('window.__relay.length')) === 1, 'a scripted el.click() (isTrusted false) is not relayed');
  await clickAt('#same');
  ok((await ev('window.__relay.length')) === 1, 'a same-page link is not relayed');
  await ev(`parent.postMessage({type:${JSON.stringify(PREVIEW_LINK_MESSAGE)},href:'https://forged.example/'},'*')`); await settle(150);
  ok((await ev('window.__relay.at(-1)')) === 'https://forged.example/', 'a page script can still post the shape itself: the host is the boundary');
  // ---- The browser-panel guard on a real page (CDP Fetch hold) ----
  // Two origins on one local server that records every hit: A = 127.0.0.1, B = localhost. Each way a page can leave
  // for B is tried twice: refused (no request may reach B) and allowed (the request reaches B).
  const hits = [];
  const server = createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    hits.push(`${host}${req.url}`);
    const B = `http://localhost:${server.address().port}`;
    res.setHeader('content-type', 'text/html');
    if (host === 'localhost') { res.end('<title>B</title><p>B</p>'); return; }
    if (req.url.startsWith('/302')) { res.statusCode = 302; res.setHeader('location', `${B}/hit302`); res.end(); return; }
    if (req.url.startsWith('/meta')) { res.end(`<title>M</title><meta http-equiv="refresh" content="0;url=${B}/hitmeta">`); return; }
    // Popups that open on this site first and leave for B afterwards (verify-3928).
    if (req.url.startsWith('/go302')) { res.statusCode = 302; res.setHeader('location', `${B}/hitp302`); res.end(); return; }
    // verify-r027 on #4187: <base target> is the effective target of a link or form with none of its own.
    // verify-r027 on #4187: a form inside a shadow root (open, closed, declarative). Its submit event is not composed.
    if (req.url.startsWith('/shadowpage')) { const f = (id) => `<form method="post" action="${B}/hit${id}" target="_blank"><button style="display:block;width:200px;height:40px">${id}</button></form>`;
      res.end(`<title>S</title><div id="sho" style="width:200px;height:40px"></div><div id="shc" style="width:200px;height:40px"></div><div id="shd" style="width:200px;height:40px"><template shadowrootmode="closed">${f('shadowd')}</template></div>
        <script>document.getElementById('sho').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(f('shadowo'))};document.getElementById('shc').attachShadow({mode:'closed'}).innerHTML=${JSON.stringify(f('shadowc'))};</script>`); return; }
    // verify-r027 round 3: a renamed iframe, an empty target under a base, and a later listener changing the page.
    if (req.url.startsWith('/namepage')) { res.end(`<title>N</title><base target="_blank"><iframe name="fr2" style="width:60px;height:30px"></iframe>
      <form method="post" action="/hitrenamed" target="fr2"><button id="rnf" style="display:block;padding:12px">form to the renamed frame's old name</button></form>
      <a id="rnl" href="/hitrenamedlink" target="fr2" style="display:block;padding:12px">link to the old name</a>
      <a id="emp" href="${B}/hitempty" target="" style="display:block;padding:12px">empty target under base</a>
      <form method="post" action="${B}/hitemptyform" target=""><button id="empf" style="display:block;padding:12px">empty-target form under base</button></form>
      <script>frames[0].name='zz'</script>`); return; }
    if (req.url.startsWith('/tocpage')) { res.end(`<title>T</title><iframe name="inner" style="width:60px;height:30px"></iframe>
      <form id="toc1" method="post" action="/go302" target="inner"><button id="toc1b" style="display:block;padding:12px">frame removed after the check</button></form>
      <form id="toc2" method="post" action="${B}/hittoc2"><button id="toc2b" style="display:block;padding:12px">base added after the check</button></form>
      <script>document.getElementById('toc1').addEventListener('submit',function(){document.querySelector('iframe[name=inner]').remove()});
      document.getElementById('toc2').addEventListener('submit',function(){var b=document.createElement('base');b.target='_blank';document.head.appendChild(b)});</script>`); return; }
    if (req.url.startsWith('/basepage')) { res.end(`<title>Base</title><base target="_blank"><a id="bl" href="${B}/hitbase" style="display:block;padding:12px">base link</a><form method="post" action="${B}/hitbaseform"><button id="bf" style="display:block;padding:12px">base form</button></form><a id="bown" href="/hitbaseown" target="_self" style="display:block;padding:12px">own _self</a>`); return; }
    // Existing-window fix: a form submitted by name into a window that already exists (a popup, or the opener).
    // verify-r027 (verify-ew-baseline): a declarative shadow root, which layer 1 does not see, opens a same-site popup
    // w2 (no decision: same origin) and then posts a form into it, to B. Both layers on, the minor-seat configuration.
    if (req.url.startsWith('/dsdpage')) { res.end(`<title>D</title><div id="dsl" style="width:200px;height:40px"><template shadowrootmode="closed"><a href="/w2same" target="w2" style="display:block;width:200px;height:40px">open w2</a></template></div>
      <div id="dsf" style="width:200px;height:40px"><template shadowrootmode="closed"><form method="post" action="${B}/hitdsd" target="w2"><button style="display:block;width:200px;height:40px">post into w2</button></form></template></div>`); return; }
    if (req.url.startsWith('/w1page')) { res.end(`<title>W</title><button id="w1open" onclick="window.open('/w1same','w1')" style="display:block;padding:12px">open w1</button>
      <form method="get" action="${B}/hitw1get" target="w1"><button id="w1g" style="display:block;padding:12px">GET into w1</button></form>
      <form method="post" action="${B}/hitw1post" target="w1"><button id="w1p" style="display:block;padding:12px">POST into w1</button></form>
      <form method="get" action="${B}/hitw1noref" target="w1" rel="noreferrer"><button id="w1n" style="display:block;padding:12px">no-referrer GET into w1</button></form>`); return; }
    if (req.url.startsWith('/w1back')) { const k = (req.url.split('k=')[1] || ''); res.end(`<title>Back</title><form id="g" method="get" action="${B}/hitopget" target="mainwin"></form><form id="p" method="post" action="${B}/hitoppost" target="mainwin"></form><form id="n" method="get" action="${B}/hitopnoref" target="mainwin" rel="noreferrer"></form><script>setTimeout(function(){document.getElementById('${k}').submit()},300)</script>`); return; }
    if (req.url.startsWith('/openerpage')) { const k = (req.url.split('k=')[1] || ''); res.end(`<title>O</title><script>window.name='mainwin'</script><button id="oo" onclick="window.open('/w1back?k=${k}','w2')" style="display:block;padding:12px">open back</button>`); return; }
    if (req.url.startsWith('/plocate')) { res.end(`<title>P</title><script>setTimeout(function(){location.href='${B}/hitploc'},50)</script>`); return; }
    res.end(`<title>A</title>
      <a id="go" href="${B}/hitlink" style="display:block;padding:12px">link</a>
      <a id="r302" href="/302" style="display:block;padding:12px">302</a>
      <a id="meta" href="/meta" style="display:block;padding:12px">meta</a>
      <a id="blank" href="${B}/hitblank" target="_blank" style="display:block;padding:12px">blank</a>
      <button id="pop" onclick="window.open('${B}/hitpop')" style="display:block;padding:12px">pop</button>
      <button id="ifr" onclick="var f=document.createElement('iframe');document.body.appendChild(f);f.contentWindow.open('${B}/hitiframe')" style="display:block;padding:12px">iframe pop</button>
      <form id="f" method="post" action="${B}/hitform"><button id="fb" style="display:block;padding:12px">post</button></form>
      <button id="det" onclick="var a=document.createElement('a');a.href='${B}/hitdet';a.target='_blank';a.click()" style="display:block;padding:12px">detached anchor</button>
      <button id="fsub" onclick="var f=document.createElement('form');f.method='post';f.action='${B}/hitfsub';f.target='_blank';document.body.appendChild(f);f.submit()" style="display:block;padding:12px">form.submit</button>
      <iframe name="inner" style="width:80px;height:40px"></iframe>
      <form id="fin" method="post" action="/hitinner" target="inner"><button id="finb" style="display:block;padding:12px">form into the page's named iframe</button></form>
      <button id="fins" onclick="HTMLFormElement.prototype.submit.call(document.getElementById('fin'))" style="display:block;padding:12px">script submit into the named iframe</button>
      <a id="lin" href="/hitinner-link" target="inner" style="display:block;padding:12px">link into the named iframe</a>
      <form id="finx" method="post" action="${B}/hitinnerx" target="inner"><button id="finxb" style="display:block;padding:12px">cross-site form into the named iframe</button></form>
      <form id="fnone" method="post" action="/hitnone" target="nosuch"><button id="fnoneb" style="display:block;padding:12px">form to a name no frame has</button></form>
      <form id="ft" method="post" action="/hitself-t"><input name="target" value="shadow"><button id="ftb" style="display:block;padding:12px">self form, field named target</button></form>
      <form id="fa" method="post" action="/hitself-a"><input name="action" value="shadow"><button id="fab" style="display:block;padding:12px">self form, field named action</button></form>
      <form id="fs" method="post" action="/hitself-s"><input name="submit" value="shadow"><button id="fsb" style="display:block;padding:12px">self form, field named submit</button></form>
      <button id="fts" onclick="HTMLFormElement.prototype.submit.call(document.getElementById('ft'))" style="display:block;padding:12px">script submit, field named target</button>
      <button id="ftr" onclick="document.getElementById('ft').requestSubmit()" style="display:block;padding:12px">script requestSubmit, field named target</button>
      <button id="fss" onclick="HTMLFormElement.prototype.submit.call(document.getElementById('fs'))" style="display:block;padding:12px">script submit, field named submit</button>
      <form id="fov" method="post" action="/hitoverride" target="_blank"><button id="fovb" formtarget="_self" style="display:block;padding:12px">_self button in a _blank form</button></form>
      <a id="lcase" href="/hitcase-link" target="_Self" style="display:block;padding:12px">_Self link</a>
      <form id="fcase" method="post" action="/hitcase-form" target="_SELF"><button id="fcaseb" style="display:block;padding:12px">_SELF form</button></form>
      <form id="fbt" method="post" action="${B}/hitbt" target="_blank"><input name="target" value="_self"><button id="fbtb" style="display:block;padding:12px">blank form, field named target</button></form>
      <form id="fea" method="post" action="${B}/hitfea" target="_blank"><button id="feab" formaction="" style="display:block;padding:12px">empty formaction</button></form>
      <form id="fact" method="post" action="${B}/hitfact" target="_blank"><input name="action" value="shadow"><button id="factb" style="display:block;padding:12px">form named action</button></form>
      <button id="p302" onclick="window.open('/go302')" style="display:block;padding:12px">popup then 302</button>
      <button id="ploc" onclick="window.open('/plocate')" style="display:block;padding:12px">popup then location</button>
      <button id="a302" onclick="var a=document.createElement('a');a.href='/go302';a.target='_blank';a.click()" style="display:block;padding:12px">same-site anchor popup then 302</button>
      <button id="aloc" onclick="var a=document.createElement('a');a.href='/plocate';a.target='_blank';a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))" style="display:block;padding:12px">same-site dispatched anchor popup then location</button>
      <button id="f302" onclick="var f=document.createElement('form');f.method='get';f.action='/go302';f.target='_blank';document.body.appendChild(f);f.submit()" style="display:block;padding:12px">same-site form popup then 302</button>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${server.address().port}/a`;
  const reachedB = (path) => hits.includes(`localhost/${path}`);
  const reachedA = (path) => hits.includes(`127.0.0.1/${path}`);
  const Bo = `http://localhost:${server.address().port}`;
  try {
    await b.send('Page.enable');
    const decisions = []; let allow = false;
    // The root session VS Code gives a tab is browser-like (Target.* works there): emulated with the browser endpoint.
    const root = await rootSession();
    const { targetInfo } = await b.send('Target.getTargetInfo');
    const port = {
      send: (m, p) => b.send(m, p), sendIn: (sid, m, p) => root.send(m, p, sid), sendRoot: (m, p) => root.send(m, p), targetId: targetInfo.targetId,
      onEvent: (l) => {
        const off = b.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId }); });
        const offRoot = root.onEvent((msg) => { if (msg.method && !msg.id) l({ method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId, ...(msg.sessionId ? {} : { root: true }) }); });
        return { dispose: () => { off(); offRoot(); } };
      },
    };
    const popups = [], studioOpened = [], formStops = []; let shift = 0;
    const guard = new LinkNavigationGuard(port, async (url) => { decisions.push(url); return allow; }, { onPopup: (url, ok2) => popups.push([url, ok2]), interceptPopups: true, now: () => Date.now() + shift, onFormStopped: (url) => formStops.push(url), openPopup: (url) => { studioOpened.push(url); if (!/\/(go302|plocate)$/.test(url)) void fetch(url).catch(() => {}); } });
    // The harness's own navigations stand for Studio's: recorded first, as Studio's code does (existing-window fix).
    const studioNav = (url) => studioNavigate({ send: (m, p) => b.send(m, p), targetId: targetInfo.targetId }, url);
    const fresh = async () => { await studioNav(A); await settle(500); };
    await fresh();
    await guard.start();
    const tryIt = async (sel, path, label) => {
      for (const a of [false, true]) {
        allow = a; hits.length = 0; await fresh();
        await clickAt(sel); await settle(900);
        if (!a) ok(!reachedB(path), `${label}: refused, no request reached the other site (${JSON.stringify(hits)})`);
        else ok(reachedB(path), `${label}: allowed, the request went on (${JSON.stringify(hits)})`);
      }
    };
    await tryIt('#go', 'hitlink', 'a link to another site');
    await tryIt('#r302', 'hit302', 'a same-site link that 302s to another site');
    await tryIt('#meta', 'hitmeta', 'a meta refresh to another site');
    await tryIt('#fb', 'hitform', 'a form POST to another site');
    await tryIt('#blank', 'hitblank', 'a target=_blank link (replaced by the binding: no popup is created)');
    await tryIt('#pop', 'hitpop', 'window.open (replaced by the binding: no popup is created)');
    await tryIt('#ifr', 'hitiframe', 'window.open from a script-made frame (round the replacement: held by auto-attach)');
    await tryIt('#det', 'hitdet', 'a detached anchor with target=_blank and a.click() (the wrapped prototype)');
    // form.submit with target=_blank: stopped outright (a POST is never replayed), refused or allowed.
    for (const a of [false, true]) { allow = a; hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#fsub'); await settle(900);
      ok(!reachedB('hitfsub'), `form.submit to another window is stopped (${a ? 'allowed' : 'refused'}): ${JSON.stringify(hits)}`);
      ok(formStops.length === 1 && formStops[0] === `${Bo}/hitfsub`, `and the stop is reported to the host with its address (F4): ${JSON.stringify(formStops)}`); }
    // A learner's real click on a form aimed at another window (the submit-event path), with a field named "action"
    // shadowing form.action: still stopped, and reported with the real address.
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#factb'); await settle(900);
    ok(!reachedB('hitfact') && formStops.length === 1 && formStops[0] === `${Bo}/hitfact`, `a clicked form to another window is stopped and reported (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    // verify-r027 on #4182: a field named "target", "action" or "submit" must not change what the guard reads. A form
    // aimed at this window submits normally, by a real click and by script; one aimed at another window is still
    // stopped, and a submitter's empty formaction means the document's own address (HTML spec).
    const reachedA = (path) => hits.includes(`127.0.0.1/${path}`);
    for (const [sel, path, how] of [['#ftb', 'hitself-t', 'a click, field named target'], ['#fab', 'hitself-a', 'a click, field named action'], ['#fsb', 'hitself-s', 'a click, field named submit'],
      ['#fts', 'hitself-t', 'submit() by script, field named target'], ['#ftr', 'hitself-t', 'requestSubmit() by script, field named target'], ['#fss', 'hitself-s', 'submit() by script, field named submit']]) {
      hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt(sel); await settle(900);
      ok(reachedA(path) && formStops.length === 0, `a form aimed at this window submits (${how}): ${JSON.stringify(hits)} stops ${JSON.stringify(formStops)}`);
    }
    // A same-origin form or link aimed at a named iframe of this page is an in-page pattern (verify-3928 on #4128).
    for (const [sel, path, how] of [['#finb', 'hitinner', 'a clicked form'], ['#fins', 'hitinner', 'submit() by script'], ['#lin', 'hitinner-link', 'a link']]) {
      hits.length = 0; formStops.length = 0; studioOpened.length = 0; shift += 10_000; await fresh(); await clickAt(sel); await settle(900);
      ok(reachedA(path) && formStops.length === 0 && studioOpened.length === 0, `${how} into the page's named iframe goes through, in the page (${JSON.stringify(hits)} stops ${JSON.stringify(formStops)} studio ${JSON.stringify(studioOpened)})`);
    }
    // A submitter's formtarget overrides its form's target: a _self button in a _blank form submits in place.
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#fovb'); await settle(900);
    ok(reachedA('hitoverride') && formStops.length === 0, `formtarget=_self in a _blank form submits in place (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    // Browsing-context keywords are ASCII case-insensitive (HTML spec): _Self and _SELF are this window.
    for (const [sel, path] of [['#lcase', 'hitcase-link'], ['#fcaseb', 'hitcase-form']]) {
      hits.length = 0; formStops.length = 0; studioOpened.length = 0; const nd = decisions.length; shift += 10_000; await fresh(); await clickAt(sel); await settle(900);
      ok(reachedA(path) && formStops.length === 0 && studioOpened.length === 0 && decisions.length === nd, `${sel}: a mixed-case _self target stays in the page (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    }
    // <base target="_blank">: layer 1 sees the effective target. The link goes to the binding (allowed, Studio opens it),
    // the form is stopped and reported, and a link with its own _self target stays in the page.
    const base = async () => { await b.send('Page.navigate', { url: A.replace(/\/a$/, '/basepage') }); await settle(500); };
    allow = true; hits.length = 0; studioOpened.length = 0; await base(); await clickAt('#bl'); await settle(900);
    ok(studioOpened.some((u) => u.endsWith('/hitbase')), `a link under <base target=_blank> is replaced by layer 1 (${JSON.stringify(studioOpened)} ${JSON.stringify(hits)})`);
    allow = false; hits.length = 0; formStops.length = 0; shift += 10_000; await base(); await clickAt('#bf'); await settle(900);
    ok(!reachedB('hitbaseform') && formStops[0] === `${Bo}/hitbaseform`, `a form under <base target=_blank> is stopped and reported (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    hits.length = 0; studioOpened.length = 0; await base(); await clickAt('#bown'); await settle(900);
    ok(reachedA('hitbaseown') && studioOpened.length === 0, `a link with its own _self under <base target=_blank> stays in the page (${JSON.stringify(hits)})`);
    // The browser resolves a named target by the frame's browsing-context name: after frames[0].name='zz' the old
    // attribute name "fr2" is a new window (here under <base target=_blank> too). An empty target is no target.
    const page = async (p2) => { await b.send('Page.navigate', { url: A.replace(/\/a$/, p2) }); await settle(500); };
    allow = false;
    for (const [sel, id] of [['#rnf', 'hitrenamed'], ['#rnl', 'hitrenamedlink'], ['#emp', 'hitempty'], ['#empf', 'hitemptyform']]) {
      hits.length = 0; formStops.length = 0; studioOpened.length = 0; const nd = decisions.length, np = guard.stats.popups; shift += 10_000; await page('/namepage'); await clickAt(sel); await settle(1000);
      // Layer 1's signal: a form is reported; a link goes to the binding (a decision with no popup target created).
      const layer1 = sel.endsWith('f') ? formStops.length === 1 : decisions.length > nd && guard.stats.popups === np;
      ok(!hits.some((h) => h.endsWith(`/${id}`)) && layer1, `${sel}: layer 1 sees it as another window and nothing is sent (${JSON.stringify(hits)} stops ${JSON.stringify(formStops)} popups ${guard.stats.popups - np})`);
    }
    // Time of check: a page listener that runs after layer 1's check removes the named frame or adds a base target.
    // Layer 1 does not see the change; layer 2 holds the window that opens, so nothing reaches the other site.
    for (const [sel, id] of [['#toc1b', 'hitp302'], ['#toc2b', 'hittoc2']]) {
      hits.length = 0; shift += 10_000; await page('/tocpage'); await clickAt(sel); await settle(1300);
      ok(!reachedB(id), `${sel}: a page that changes the target after the check still sends nothing to the other site (layer 2) (${JSON.stringify(hits)})`);
    }
    // A learner's real click on a submit button of a _blank form inside a shadow root: the submit event does not leave
    // the root, so layer 1 listens in every root (attachShadow is wrapped before the page runs). Refused: nothing is
    // sent, whichever layer stops it; and layer 1 reports it for open and closed roots made by script.
    const shadow = async () => { await b.send('Page.navigate', { url: A.replace(/\/a$/, '/shadowpage') }); await settle(500); };
    for (const [sel, id, reported] of [['#sho', 'shadowo', true], ['#shc', 'shadowc', true], ['#shd', 'shadowd', false]]) {
      allow = false; hits.length = 0; formStops.length = 0; shift += 10_000; await shadow(); await clickAt(sel); await settle(1100);
      ok(!reachedB(`hit${id}`), `${id}: a _blank form in a shadow root sends nothing when refused (${JSON.stringify(hits)})`);
      if (reported) ok(formStops[0] === `${Bo}/hit${id}`, `${id}: layer 1 stops and reports it (${JSON.stringify(formStops)})`);
    }
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#finxb'); await settle(900);
    ok(!reachedB('hitinnerx') && formStops[0] === `${Bo}/hitinnerx`, `a cross-site form into the named iframe is still stopped (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#fnoneb'); await settle(900);
    ok(!reachedA('hitnone') && formStops.length === 1, `a same-site form to a name no frame has (a new window) is still stopped (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#fbtb'); await settle(900);
    ok(!reachedB('hitbt') && formStops[0] === `${Bo}/hitbt`, `a form aimed at another window with a field named target is still stopped (${JSON.stringify(hits)} ${JSON.stringify(formStops)})`);
    hits.length = 0; formStops.length = 0; shift += 10_000; await fresh(); await clickAt('#feab'); await settle(900);
    ok(!reachedB('hitfea') && formStops.length === 1 && formStops[0] === A, `an empty formaction reports the document's address (${JSON.stringify(formStops)})`);
    // The cap is per action origin: a stop to one site does not hide a stop to another within the window.
    formStops.length = 0; shift += 10_000; await fresh();
    await ev(`(()=>{var f=document.createElement('form');f.action='/x';f.target='_blank';document.body.appendChild(f);f.submit();f.action='${Bo}/y';f.submit()})()`); await settle(400);
    ok(formStops.length === 2, `stops to two origins within the window are both reported (${JSON.stringify(formStops)})`);
    // A page looping submit() gets one report per window, not a flood.
    formStops.length = 0; shift += 10_000; await fresh();
    await ev(`(()=>{var f=document.createElement('form');f.action='${Bo}/hitloop';f.target='_blank';document.body.appendChild(f);for(var i=0;i<20;i++)f.submit()})()`); await settle(400);
    ok(formStops.length === 1 && !reachedB('hitloop'), `twenty submit() calls give one report (${formStops.length})`);
    // window.open('/go302') is replaced: no popup at all; refused, nothing is sent; allowed, the address goes to Studio,
    // which opens it as its own tab (a guarded tab, where the 302 hop is held like any tab's; checked by layer 2 below).
    for (const a of [false, true]) { allow = a; hits.length = 0; studioOpened.length = 0; await fresh(); await clickAt('#p302'); await settle(900);
      ok(!reachedB('hitp302') && !hits.some((h) => h.endsWith('/go302')), `window.open to a redirecting page creates no popup (${a ? 'allowed' : 'refused'}): ${JSON.stringify(hits)}`);
      ok(a ? studioOpened.some((u) => u.endsWith('/go302')) : studioOpened.length === 0, `and only an allowed one is handed to Studio to open (${JSON.stringify(studioOpened)} decisions ${JSON.stringify(decisions.slice(-3))})`); }
    for (const a of [false, true]) { allow = a; hits.length = 0; studioOpened.length = 0; await fresh(); await clickAt('#ploc'); await settle(900);
      ok(!reachedB('hitploc') && !hits.some((h) => h.endsWith('/plocate')), `window.open to a page that then sets location creates no popup (${a ? 'allowed' : 'refused'}): ${JSON.stringify(hits)}`); }
    // verify-3928's bypass: a script-made same-site anchor or form aimed at a new window, which then leaves the site.
    for (const [sel, path] of [['#a302', 'hitp302'], ['#aloc', 'hitploc'], ['#f302', 'hitp302']]) for (const a of [false, true]) {
      allow = a; hits.length = 0; studioOpened.length = 0; await fresh(); await clickAt(sel); await settle(900);
      ok(!reachedB(path) && !hits.some((h) => /\/(go302|plocate)/.test(h)), `${sel}: a same-site popup made by script creates no popup (${a ? 'allowed' : 'refused'}): ${JSON.stringify(hits)}`);
    }
    ok(popups.some(([u, a]) => u.endsWith('/hitpop') && a === false) && popups.some(([u, a]) => u.endsWith('/hitpop') && a === true), 'the popup decisions are reported to the host');
    // The declarative-shadow-root path to an existing window (both layers on): refused, nothing reaches B.
    {
      allow = false; hits.length = 0;
      await studioNav(A.replace(/\/a$/, '/dsdpage')); await settle(500);
      await clickAt('#dsl'); await settle(900);
      ok(reachedA('w2same'), `the declarative root's same-site link opened w2 (${JSON.stringify(hits)})`);
      await clickAt('#dsf'); await settle(1300);
      ok(!reachedB('hitdsd'), `both layers: a declarative root's POST into the existing window w2 is refused, nothing reached the other site (${JSON.stringify(hits)})`);
      const { targetInfos } = await root.send('Target.getTargets'); for (const t of targetInfos) if (t.type === 'page' && t.targetId !== targetInfo.targetId) await root.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    }
    // Layer 2 alone (no interception at all): the real fix holds by itself. Popups get the main-frame rules for their
    // whole life, so a popup that opens on this site and then leaves is decided at its cross-site hop.
    {
      const g2 = new LinkNavigationGuard(port, async (url) => { decisions.push(url); return allow; }, { onPopup: (url, ok2) => popups.push([url, ok2]) });
      guard.dispose(); await g2.start();
      for (const [sel, path, label] of [['#pop', 'hitpop', 'window.open'], ['#blank', 'hitblank', 'a target=_blank link'], ['#det', 'hitdet', 'a detached anchor click'],
        ['#fsub', 'hitfsub', 'form.submit with target=_blank'], ['#p302', 'hitp302', 'a popup that opens on this site, then 302s away'], ['#ploc', 'hitploc', 'a popup that opens on this site, then sets location away'],
        ['#a302', 'hitp302', 'a script-made same-site anchor popup that then 302s away'], ['#aloc', 'hitploc', 'a dispatched same-site anchor popup that then sets location away'],
        ['#f302', 'hitp302', 'a form.submit same-site popup that then 302s away']]) {
        for (const a of [false, true]) {
          allow = a; hits.length = 0; await fresh();
          await clickAt(sel); await settle(1100);
          if (!a) ok(!reachedB(path), `auto-attach only, ${label}: refused, nothing reached the other site (${JSON.stringify(hits)})`);
          else ok(reachedB(path), `auto-attach only, ${label}: allowed, it went on (${JSON.stringify(hits)}; decisions ${JSON.stringify(decisions.slice(-2))}; stats ${JSON.stringify(g2.stats)})`);
        }
      }
      // Shadow-root forms with layer 2 alone: the paused popup holds them (no minor-seat bypass without layer 1).
      for (const [sel, id] of [['#sho', 'shadowo'], ['#shc', 'shadowc'], ['#shd', 'shadowd']]) for (const a of [false, true]) {
        allow = a; hits.length = 0; await b.send('Page.navigate', { url: A.replace(/\/a$/, '/shadowpage') }); await settle(500); await clickAt(sel); await settle(1300);
        ok(a ? reachedB(`hit${id}`) : !reachedB(`hit${id}`), `auto-attach only, ${id} form: ${a ? 'allowed, it went on' : 'refused, nothing reached the other site'} (${JSON.stringify(hits)})`);
      }
      // A form by name into an EXISTING window. The popup opened on this site first (no decision), then the page
      // submits into it; or the popup submits into its opener. Neither fires frameRequestedNavigation in the window it
      // moves; each must still be decided. Refused throughout, so nothing may reach the other site.
      const closeOthers = async () => { const { targetInfos } = await root.send('Target.getTargets'); for (const t of targetInfos) if (t.type === 'page' && t.targetId !== targetInfo.targetId) await root.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); };
      const at = (p2) => A.replace(/\/a$/, p2);
      allow = false;
      for (const [sel, id, how] of [['#w1g', 'hitw1get?', 'a GET form'], ['#w1p', 'hitw1post', 'a POST form'], ['#w1n', 'hitw1noref?', 'a no-referrer GET form']]) {
        hits.length = 0; await studioNav(at('/w1page')); await settle(500);
        await clickAt('#w1open'); await settle(900);
        ok(reachedA('w1same'), `the same-site popup w1 opened (${JSON.stringify(hits)})`);
        await clickAt(sel); await settle(1300);
        ok(!reachedB(id), `auto-attach only, ${how} into an existing popup by name: refused, nothing reached the other site (${JSON.stringify(hits)})`);
        await closeOthers();
      }
      // The exemption race (verify-r027 on #4192): Studio has a navigation to the very address in flight on this tab
      // while the popup posts into the opener. The page's request is not Studio's (another loaderId): decided.
      {
        hits.length = 0; await studioNav(at('/openerpage?k=p')); await settle(500);
        const rec = studioNavigations.begin(targetInfo.targetId, `http://localhost:${server.address().port}/hitoppost`);
        await clickAt('#oo'); await settle(1700);
        rec.fail();
        ok(reachedA('w1back?k=p') && !reachedB('hitoppost'), `a Studio navigation in flight does not exempt the page's own cross-window POST (${JSON.stringify(hits)})`);
        await closeOthers();
      }
      for (const [k, id, how] of [['g', 'hitopget?', 'GET'], ['p', 'hitoppost', 'POST'], ['n', 'hitopnoref?', 'no-referrer GET']]) {
        hits.length = 0; await studioNav(at(`/openerpage?k=${k}`)); await settle(500);
        await clickAt('#oo'); await settle(1600);
        ok(reachedA(`w1back?k=${k}`) && !reachedB(id), `auto-attach only, a popup's ${how} form into its opener by name: refused, nothing reached the other site (${JSON.stringify(hits)})`);
        await closeOthers();
      }
      g2.dispose();
    }
    // Negative controls: a navigation Studio starts (recorded in studioNavigations before it is sent) is not held; one
    // nothing recorded (what VS Code core's address bar or back/forward looks like) is decided (the stated cost).
    // (A guard is running: before this fix the control ran after every guard was disposed, and so measured nothing.)
    await studioNav(A); await settle(500);
    const g3 = new LinkNavigationGuard(port, async (url) => { decisions.push(url); return allow; }, {});
    await g3.start();
    const n = decisions.length;
    hits.length = 0; allow = false;
    const studioUrl = `http://localhost:${server.address().port}/studio`;
    await studioNav(studioUrl); await settle(500);
    ok(decisions.length === n && reachedB('studio'), 'a navigation Studio starts (recorded, not page-requested, not a redirect) is not held');
    await studioNav(A); await settle(500);
    hits.length = 0;
    await b.send('Page.navigate', { url: `http://localhost:${server.address().port}/typed` }); await settle(500);
    ok(decisions.length === n + 1 && !reachedB('typed'), `an unrecorded cross-origin load (the address bar) is decided, here refused (${JSON.stringify(hits)})`);
    g3.dispose();
  } finally { server.close(); }
  console.log(`PASS link confirm dialog, preview relay and browser-panel guard: ${checks} checks (dark/light x 320/800px)`);
} finally { await b.close(); }
