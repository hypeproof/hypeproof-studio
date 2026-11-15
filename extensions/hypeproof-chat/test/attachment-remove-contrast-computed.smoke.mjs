// The staged photo chip's remove ×, computed: the real ChatPanel with the shipped stylesheet in headless Chromium, for every
// bundled theme (test/lib/vscode-default-themes.mjs), classroom and personal seats, on the refused photo chip (every chip on
// the page is measured; a restored photo is the one this page can stage without a file).
// The × is text (14px+), so it needs 4.5:1 against what is actually painted behind it:
// - where the button draws its ::before dot, the dot's containing block must be the button itself (the button is not
//   `position: static`), so the dot sits under the ×, and the × is measured against the dot;
// - where it does not, the × is measured against the composited background of the button and its ancestors.
// The refused-photo chip made the button static (#2365), so its dot moved to the chip's centre and the white × sat on the
// light panel at 1.19:1 (Light+; found on #4053). The refused chip is staged through ChatPanel's own sessionStorage
// restore (a restored photo comes back as "pick it again", i.e. with a failure block). The 44px target is checked too.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { KIND_CLASS, THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
window.mount=(config)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: attachment-remove-contrast browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (e) => browser.evaluate(e);
// sessionStorage needs a real origin (a document set on about:blank has none), so each case is served over loopback.
let pageHtml = '';
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(pageHtml); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;
let nav = 0;
const open = async (html, opts) => {
  await browser.load('<html></html>', opts); // the viewport and media emulation for this case
  pageHtml = html;
  const loaded = browser.waitForEvent((m) => m.method === 'Page.loadEventFired', 'page load');
  await browser.send('Page.navigate', { url: origin + '?n=' + ++nav });
  await loaded;
};
const settle = () => new Promise((r) => setTimeout(r, 120));

const seatConfig = (seat) => {
  const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null } });
  return seat === 'personal' ? { ...base, taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } } : base;
};
// ChatPanel restores staged photo metadata from sessionStorage under this key (ChatPanel.tsx photoMetadataKey).
const photoKey = (config) => `hps.photo-metadata.${JSON.stringify([config?.activity?.id, config?.taskWorkspace?.activeTaskId])}`;

const MEASURE = `(()=>{const p=s=>{const m=s&&s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const v=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}};
const lum=c=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
const over=(top,under)=>({r:top.r*top.a+under.r*(1-top.a),g:top.g*top.a+under.g*(1-top.a),b:top.b*top.a+under.b*(1-top.a),a:1});
return [...document.querySelectorAll('.hps-attachment-remove')].map(btn=>{
  const chip=btn.closest('.hps-attachment'),refused=!!chip.querySelector('.hps-photo-failure');
  let bg={r:255,g:255,b:255,a:1};const chain=[];for(let n=btn;n;n=n.parentElement)chain.push(n);
  for(const n of chain.reverse()){const c=p(getComputedStyle(n).backgroundColor);if(c&&c.a>0)bg=over(c,bg);}
  const before=getComputedStyle(btn,'::before'),dot=before.content!=='none'&&before.content!=='normal'?p(before.backgroundColor):null;
  const pos=getComputedStyle(btn).position;
  const backdrop=dot&&dot.a>0?over(dot,bg):bg;
  const fg=p(getComputedStyle(btn).color);const L=[lum(over(fg,backdrop)),lum(backdrop)].sort((x,y)=>y-x);
  const r=btn.getBoundingClientRect();
  return {refused,position:pos,dot:!!(dot&&dot.a>0),ratio:(L[0]+0.05)/(L[1]+0.05),fg:getComputedStyle(btn).color,w:r.width,h:r.height,size:parseFloat(getComputedStyle(btn).fontSize)};
});})()`;

let cases = 0;
try {
  for (const [name, theme] of Object.entries(THEMES)) for (const seat of ['classroom', 'personal']) {
    const vars = Object.entries(theme).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const config = seatConfig(seat);
    const tag = `${name} ${seat}`;
    const seed = `try{sessionStorage.setItem(${JSON.stringify(photoKey(config))},${JSON.stringify(JSON.stringify([{ id: 'p1', name: 'cat.heic' }]))})}catch(e){window.__noStorage=String(e)}`;
    await open(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${KIND_CLASS[theme.kind] ?? 'vscode-dark'}" style="margin:0"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>({}),setState(){}});${seed}</script><script>${js}</script></body></html>`, { width: 800, height: 900, dark: theme.kind !== 'light' && theme.kind !== 'hcLight' });
    assert.equal(await ev('window.__noStorage ?? null'), null, `${tag}: sessionStorage available for the staged photo`);
    await ev(`mount(${JSON.stringify(config)})`); await settle();
    const rows = await ev(MEASURE);
    const refused = rows.filter((r) => r.refused);
    assert.ok(refused.length === 1, `${tag}: the restored photo renders as a refused chip (${JSON.stringify(rows)})`);
    for (const r of rows) {
      const what = `${tag} ${r.refused ? 'refused' : 'normal'} chip ×`;
      if (r.dot) assert.notEqual(r.position, 'static', `${what}: its dot is drawn, so the button must anchor it (position ${r.position})`);
      assert.ok(r.ratio >= 4.5, `${what}: ${r.ratio.toFixed(2)} >= 4.5:1 against what is painted behind it (${JSON.stringify(r)})`);
      assert.ok(r.w >= 44 && r.h >= 44, `${what}: 44px target (${r.w}x${r.h})`);
    }
    cases++;
  }
  server.close();
  console.log(`PASS attachment-remove-contrast-computed: ${cases} theme/seat cases (${Object.keys(THEMES).join(', ')})`);
} finally { await browser.close(); }
