// CGP-LEARN-R-009 / D-009 — narrated_diagram on the shipped stylesheet in headless Chromium, measured as RENDERED:
// - In the mounted ChatPanel (week 3, a narrated_diagram step): the 자료 card draws the built-in drawing with three beats;
//   "1 / 3 장면 · 시작", 이전 disabled; 다음 and → move, ← back, nothing while an IME composes; no autoplay over 2.5 s; the card's
//   polite caption is "<n / 3 장면 · 역할>: <title>. <sentence>"; a markup-looking beat is literal text and creates no element;
//   nothing is posted; 44px buttons; the SVG is role=img and its name maps every legend letter; light/dark, forced colours.
// - The block alone in rails of 280 / 360 / 480 px (content = rail − 32 px card padding), at 100 % and 200 % zoom (the
//   container in CSS px halves): every word in the block is HTML with a computed size ≥ 14 px and its box inside the
//   container; the SVG box letters, which DO scale, have a rendered size (font units × the SVG's on-screen
//   scale) ≥ 14 px at 100 %; no horizontal overflow at either zoom; the title of 12 Hangul syllables fits its 168 px box on
//   one line wherever the container is at least 168 px wide (decisions/CGP-LEARN-R-009.md: computed font-size alone
//   would pass for SVG text drawn at 6 px).
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps, weekFixture } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { diagramAriaLabel, DIAGRAMS, DIAGRAM_TEXT, LETTER_UNITS } from '../src/narratedDiagram.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';import{NarratedDiagramBlock}from'./src/ParamBlocks';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);
window.mountBlock=(w,diagram,beats,index)=>root.render(<div className="hps-shell" style={{inlineSize:w+'px',boxSizing:'border-box'}} data-box=""><NarratedDiagramBlock diagram={diagram} beats={beats} index={index} onMove={()=>{}}/></div>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Instructor text that looks like markup (within the v1 limits: a title of 20, a sentence of 60).
const BEATS = [
  { title: '<script>x</script>', sentence: '<img src=x onerror="window.__pwn=1"> 그림 보기' },
  { title: '서버가 찾기', sentence: '서버는 요청한 파일을 찾아서 돌려줄 준비를 해요.' },
  { title: '화면에 보이기', sentence: '받은 HTML 을 브라우저가 읽어 화면에 그려요.' },
];
const WIDEST = [
  { title: '가'.repeat(12), sentence: '가'.repeat(60) },
  { title: '나'.repeat(12), sentence: '나'.repeat(60) },
  { title: '다'.repeat(12), sentence: '다'.repeat(60) },
];
const content = weekFixture(3);
content.steps = content.steps.map((s) => (s.id === 'build' ? { ...s, ui: 'narrated_diagram', ui_version: 1, ui_params: { diagram: 'page_request', beats: BEATS } } : s));
const config = (() => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } } }; })();

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: narrated-diagram browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (e) => browser.evaluate(e);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const KEYS = { ArrowRight: 39, ArrowLeft: 37 };
const press = async (key) => {
  const base = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await settle(40);
};
const HELP = `window.__fetches=0;const __f=window.fetch;window.fetch=(...a)=>{window.__fetches++;return __f(...a)};
window.card=(k)=>document.querySelector('[data-block-card="'+k+'"]');
window.openCard=(k)=>{const b=card(k).querySelector('[data-block-toggle][aria-expanded="false"]');if(b)b.click();};
window.beat=()=>{const c=card('narrated_diagram');return {count:c.querySelector('[data-beat-count]').textContent,title:c.querySelector('[data-beat-title]').textContent,sentence:c.querySelector('[data-beat-sentence]').textContent,prev:c.querySelector('[data-beat-prev]').disabled,next:c.querySelector('[data-beat-next]').disabled,at:c.querySelector('[data-surface="narrated_diagram"]').dataset.beat,elements:c.querySelectorAll('img,script').length,pwn:window.__pwn??null,caption:c.querySelector('.hp-block-card-state').textContent,svgRole:c.querySelector('svg.hp-diagram-art').getAttribute('role'),svgName:c.querySelector('svg.hp-diagram-art').getAttribute('aria-label')}};
// Every element in the block that draws text, and how large it renders. HTML: computed px (no ancestor transform here, asserted).
// SVG text: its font units times the SVG's on-screen scale (its rendered width over the 640 viewBox).
window.measure=()=>{const box=document.querySelector('[data-box]')||document.querySelector('.hp-diagram').parentElement,b=box.querySelector('.hp-diagram'),svg=b.querySelector('svg'),scale=svg.getBoundingClientRect().width/640;
  const cb=box.getBoundingClientRect();const html=[...b.querySelectorAll('p,h4,li,button,span')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  const transformed=[...function*(){let e=b;while(e){yield e;e=e.parentElement}}()].some(e=>getComputedStyle(e).transform!=='none'||(getComputedStyle(e).zoom&&getComputedStyle(e).zoom!=='1'));
  return {transformed,scale,overflow:box.scrollWidth>box.clientWidth+0.5||document.documentElement.scrollWidth>innerWidth,
    html:html.map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,text:e.textContent.slice(0,20),px:parseFloat(getComputedStyle(e).fontSize),inside:r.left>=cb.left-0.5&&r.right<=cb.right+0.5}}),
    svg:[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,units:parseFloat(t.getAttribute('font-size')),rendered:parseFloat(t.getAttribute('font-size'))*scale})),
    title:(()=>{const t=b.querySelector('[data-beat-title]'),r=t.getBoundingClientRect();return {w:r.width,h:r.height,line:parseFloat(getComputedStyle(t).lineHeight)||parseFloat(getComputedStyle(t).fontSize)*1.5,cw:cb.width}})(),
    buttons:[...b.querySelectorAll('button')].map(x=>[x.getBoundingClientRect().width,x.getBoundingClientRect().height])}};`;
const hostMsgs = () => ev('posted.length+window.__fetches');

let checks = 0;
try {
  const page = async ({ dark, width, forced }) => {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELP}</script></body></html>`, { width, height: 1100, dark, forcedColors: forced });
  };
  // A. The real ChatPanel.
  for (const run of [{ dark: false, width: 800 }, { dark: true, width: 800 }, { dark: false, width: 320 }, { dark: false, width: 800, forced: true }]) {
    const tag = `${run.dark ? 'dark' : 'light'} ${run.width}${run.forced ? ' forced' : ''}`;
    await page(run);
    await ev(`mount(${JSON.stringify(config)})`); await settle(120);
    await ev(`document.querySelector('button[data-step-id="build"]').click()`); await settle(120);
    assert.ok(await ev(`!!card('narrated_diagram')`), `${tag}: the narrated_diagram card draws`);
    await ev(`openCard('narrated_diagram')`); await settle();
    let s = await ev('beat()');
    assert.deepEqual([s.count, s.title, s.sentence, s.prev, s.next, s.at], ['1 / 3 장면 · 시작', BEATS[0].title, BEATS[0].sentence, true, false, '0'], `${tag}: first beat, text literal`);
    assert.deepEqual([s.elements, s.pwn], [0, null], `${tag}: markup-looking beat text creates no element and runs nothing`);
    assert.equal(s.caption, `1 / 3 장면 · 시작: ${BEATS[0].title}. ${BEATS[0].sentence}`, `${tag}: the polite caption`);
    assert.deepEqual([s.svgRole, s.svgName], ['img', diagramAriaLabel('page_request')], `${tag}: the drawing is one image whose name maps the letters`);
    await settle(2500); assert.equal((await ev('beat()')).count, '1 / 3 장면 · 시작', `${tag}: no autoplay`);
    const before = await hostMsgs();
    await ev(`card('narrated_diagram').querySelector('[data-beat-next]').click()`); await settle();
    assert.equal((await ev('beat()')).count, '2 / 3 장면 · 변화');
    await ev(`card('narrated_diagram').querySelector('[data-surface="narrated_diagram"]').focus()`);
    await press('ArrowRight'); s = await ev('beat()'); assert.deepEqual([s.count, s.next, s.title], ['3 / 3 장면 · 결과', true, BEATS[2].title], `${tag}: → moves, 다음 disabled at the end`);
    await press('ArrowRight'); assert.equal((await ev('beat()')).count, '3 / 3 장면 · 결과', `${tag}: not past the end`);
    await press('ArrowLeft'); assert.equal((await ev('beat()')).count, '2 / 3 장면 · 변화', `${tag}: ← back`);
    await ev(`(()=>{const e=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true,isComposing:true});card('narrated_diagram').querySelector('[data-surface="narrated_diagram"]').dispatchEvent(e)})()`); await settle();
    assert.equal((await ev('beat()')).count, '2 / 3 장면 · 변화', `${tag}: no move while composing`);
    assert.equal(await hostMsgs(), before, `${tag}: stepping posts nothing`);
    const roles = await ev(`[...card('narrated_diagram').querySelectorAll('[data-part]')].map(e=>[e.dataset.part,e.dataset.role])`);
    assert.deepEqual(Object.fromEntries(roles), { browser: 'muted', server: 'accent', request: 'line', response: 'line' }, `${tag}: beat 2 emphasises the server only`);
    const m = await ev('measure()');
    assert.ok(m.buttons.every(([w, h]) => w >= 44 && h >= 44), `${tag}: 44px buttons ${JSON.stringify(m.buttons)}`);
    assert.ok(m.html.every((x) => x.px >= 14), `${tag}: HTML text ≥ 14px ${JSON.stringify(m.html.filter((x) => x.px < 14))}`);
    assert.equal(m.overflow, false, `${tag}: no sideways scroll`);
    if (!run.forced) { const ring = await browser.focusVisibleStyle('[data-surface="narrated_diagram"]'); assert.ok(parseFloat(ring['outline-width']) > 0, `${tag}: focus ring`); }
    checks += 14;
  }
  // B. The block alone in rails of 280 / 360 / 480 px, at 100 % and 200 % zoom.
  await page({ dark: false, width: 1000 });
  for (const diagram of ['page_request', 'html_to_page']) for (const rail of [280, 360, 480]) for (const zoom of [1, 2]) for (const beats of [BEATS, WIDEST]) for (const index of [0, 2]) {
    const w = (rail - 32) / zoom, tag = `${diagram} rail ${rail} zoom ${zoom * 100}% beat ${index + 1}${beats === WIDEST ? ' widest' : ''}`;
    await ev(`mountBlock(${w},${JSON.stringify(diagram)},${JSON.stringify(beats)},${index})`); await settle(40);
    const m = await ev('measure()');
    assert.equal(m.transformed, false, `${tag}: no transform or zoom above the block (computed px are rendered px)`);
    assert.equal(m.overflow, false, `${tag}: no horizontal overflow`);
    const words = m.html.map((x) => x.text).join(' ');
    for (const id of DIAGRAMS[diagram].nodes.map((n) => n.id)) assert.ok(words.includes(DIAGRAM_TEXT[diagram].nodes[id].slice(0, 20)) || m.html.some((x) => x.text.includes(DIAGRAM_TEXT[diagram].nodes[id])), `${tag}: legend label ${id} is HTML`);
    assert.ok(m.html.every((x) => x.px >= 14 && x.inside), `${tag}: every word is HTML ≥ 14px inside the rail ${JSON.stringify(m.html.filter((x) => x.px < 14 || !x.inside))}`);
    assert.ok(m.svg.every((t) => t.units === LETTER_UNITS && /^[A-Z]$/.test(t.text)), `${tag}: the SVG holds box letters only (no numeral, no word)`);
    if (zoom === 1) assert.ok(m.svg.every((t) => t.rendered >= 14), `${tag}: SVG letters render ≥ 14px (scale ${m.scale.toFixed(3)}: ${m.svg.map((t) => t.rendered.toFixed(1)).join(', ')})`);
    if (beats === WIDEST && m.title.cw >= 168) assert.ok(m.title.w <= 168.5 && m.title.h <= m.title.line + 1, `${tag}: 12 syllables fit the 168px title on one line ${JSON.stringify(m.title)}`);
    checks += 5;
  }
  console.log(`PASS narrated-diagram-browser: ${checks} checks (ChatPanel light/dark/320/forced; rails 280/360/480 at 100% and 200%)`);
} finally { await browser.close(); }
