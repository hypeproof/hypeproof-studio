// CGP-LEARN-R-006 / D-006 (box_spacing) and CGP-LEARN-R-005 / D-005 (stage_stepper) — on the mounted ChatPanel with the
// shipped stylesheet in headless Chromium, with real key events (CDP Input.dispatchKeyEvent):
// - box_spacing: a range cannot leave its bounds by keys; PageUp/PageDown step 10 % of the range; the value is text beside it;
//   the layout is a segmented radio group; the caption (the card's polite line) is boxCaption of what is on screen and the
//   measured preview agrees with it (content-box: the box is wider than its content by 2 × (padding + border)); 처음으로 goes
//   back to the pinned preset, 되돌리기 undoes; nothing is posted.
// - box_spacing, defence in depth: BoxSpacingBlock given a served "8px;background:url(x)" directly (as if re-validation were
//   bypassed) puts no url() and no extra property on the DOM.
// - EnumParam with more than 4 options: one "{값}. {라벨} 전체 보기" button that opens the whole list.
// - stage_stepper: "1 / 3 단계", 이전 disabled at the start, 다음 and → move, ← back, no key during an IME composition, no
//   autoplay over 2.5 s; an instructor title of "<img onerror>" / "<script>" is literal text and creates no element.
// - 44px targets, 14px text (stage title 16px), the focus ring; light/dark at 320/800/1420 px, plus forced colours.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps, weekFixture } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';import{BoxSpacingBlock,EnumParam}from'./src/ParamBlocks';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);
window.mountRaw=(values)=>root.render(<BoxSpacingBlock values={values} onChange={()=>{}}/>);
window.mountEnum=(n)=>{const options=Array.from({length:n},(_,i)=>({value:'v'+i,label:'선택'+(i+1)}));let v='v0';const R=()=>root.render(<EnumParam name="many" label="모양" value={v} options={options} onChange={(x)=>{v=x;R();}}/>);R();};`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3: expect = box_spacing (pinned 넉넉하게), build = stage_stepper (three stages, the first title markup-looking).
const ROOMY = { padding: 32, border: 2, margin: 24, layout: 'block' };
const STAGES = [
  { title: '<img src=x onerror="window.__pwn=1">', sentence: '<script>window.__pwn=2</script> 첫 단계' },
  { title: '두 번째 단계', sentence: '여백이 어떻게 바뀌는지 봐요.' },
  { title: '세 번째 단계', sentence: '마지막으로 정리해요.' },
];
const content = weekFixture(3);
content.steps = content.steps.map((s) => (s.id === 'expect' ? { ...s, ui: 'box_spacing', ui_version: 1, ui_params: ROOMY } : s.id === 'build' ? { ...s, ui: 'stage_stepper', ui_version: 1, ui_params: { stages: STAGES } } : s));
const config = (() => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } } }; })();
const BC = (await import('../src/blockParams.ts'));

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: param-blocks browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (e) => browser.evaluate(e);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const KEYS = { ArrowRight: 39, ArrowLeft: 37, PageUp: 33, PageDown: 34, Home: 36, End: 35, Enter: 13, Tab: 9 };
const press = async (key) => {
  const base = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); await settle(40);
};
const HELP = `window.__fetches=0;const __f=window.fetch;window.fetch=(...a)=>{window.__fetches++;return __f(...a)};
window.card=(k)=>document.querySelector('[data-block-card="'+k+'"]');
window.openCard=(k)=>{const b=card(k).querySelector('[data-block-toggle][aria-expanded="false"]');if(b)b.click();};
window.range=(n)=>card('box_spacing').querySelector('[data-param="'+n+'"] input[type=range]');
window.vals=()=>Object.fromEntries(['padding','border','margin'].map(n=>[n,Number(range(n).value)]).concat([['layout',card('box_spacing').querySelector('[data-param="layout"] input:checked').value]]));
window.caption=(k)=>card(k).querySelector('.hp-block-card-state').textContent;
window.measure=()=>{const o=card('box_spacing').querySelector('[data-box-outer]'),c=o.querySelector('[data-box-content]'),cs=getComputedStyle(o);return {outer:o.getBoundingClientRect().width,content:c.getBoundingClientRect().width,display:cs.display,margin:parseFloat(cs.marginLeft),sizing:cs.boxSizing}};`;
const hostMsgs = () => ev('posted.length+window.__fetches');

let checks = 0;
try {
  const runs = [];
  for (const dark of [false, true]) for (const width of [320, 800, 1420]) runs.push({ dark, width, forced: false });
  runs.push({ dark: false, width: 800, forced: true });
  for (const { dark, width, forced } of runs) {
    const tag = `${dark ? 'dark' : 'light'} ${width}${forced ? ' forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELP}</script></body></html>`, { width, height: 1100, dark, forcedColors: forced });
    await ev(`mount(${JSON.stringify(config)})`); await settle(120);
    assert.ok(await ev(`!!card('box_spacing')`), `${tag}: the box_spacing block draws`);
    await ev(`openCard('box_spacing')`); await settle();
    const before = await hostMsgs();
    // Pinned start state.
    assert.deepEqual(await ev('vals()'), ROOMY, `${tag}: starts at the pinned preset`);
    assert.equal(await ev(`caption('box_spacing')`), BC.boxCaption(ROOMY), `${tag}: the caption is boxCaption of the pinned values`);
    // Keys: End, PageDown 10 %, arrows; bounds hold.
    await ev(`range('padding').focus()`);
    await press('End'); assert.equal((await ev('vals()')).padding, 48);
    await press('ArrowRight'); assert.equal((await ev('vals()')).padding, 48, `${tag}: not above max`);
    await press('PageDown'); assert.equal((await ev('vals()')).padding, 43, `${tag}: PageDown is 10 % of 48 (5)`);
    await press('Home'); await press('ArrowLeft'); assert.equal((await ev('vals()')).padding, 0, `${tag}: not below min`);
    // The range keys are handled in code (same step in every engine), so a handled key is never left to the browser.
    await ev(`(()=>{window.__kp=[];const h=e=>window.__kp.push([e.key,e.defaultPrevented]);document.addEventListener('keydown',h);window.__kpOff=()=>document.removeEventListener('keydown',h);})()`);
    await press('PageUp'); await press('End'); await press('Home');
    const handled = await ev('window.__kp'); await ev('window.__kpOff()');
    assert.deepEqual(handled, [['PageUp', true], ['End', true], ['Home', true]], `${tag}: PageUp/End/Home are handled by the block, not the browser`);
    assert.equal((await ev('vals()')).padding, 0);
    // No range key acts while an IME composition is open.
    await ev(`(()=>{for(const key of ['End','PageUp','ArrowRight'])range('padding').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,isComposing:true}));})()`); await settle();
    assert.equal((await ev('vals()')).padding, 0, `${tag}: a composing key does not move the range`);
    await ev(`(()=>{const e=new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{get:()=>229});range('padding').dispatchEvent(e);})()`); await settle();
    assert.equal((await ev('vals()')).padding, 0, `${tag}: nor does a keyCode 229 key`);
    await ev(`range('border').focus()`); await press('End'); await press('PageUp');
    assert.equal((await ev('vals()')).border, 8, `${tag}: border max 8`);
    // The layout segmented control.
    await ev(`card('box_spacing').querySelector('[data-param="layout"] input[value="flex"]').click()`); await settle();
    const now = await ev('vals()');
    assert.deepEqual(now, { padding: 0, border: 8, margin: 24, layout: 'flex' });
    assert.equal(await ev(`card('box_spacing').querySelector('[data-param-value="padding"]').textContent`), '0px', `${tag}: the value as text`);
    assert.equal(await ev(`caption('box_spacing')`), BC.boxCaption(now), `${tag}: the caption follows every change`);
    const m = await ev('measure()');
    assert.equal(m.sizing, 'content-box'); assert.equal(m.display, 'flex'); assert.equal(m.margin, 24);
    assert.ok(Math.abs(m.outer - m.content - 2 * (now.padding + now.border)) < 1.01, `${tag}: measured box is 2×(padding+border) wider than its content (${JSON.stringify(m)})`);
    // Undo then reset.
    await settle(1100); // the next change starts a new step
    await ev(`range('margin').focus()`); await press('Home'); await settle(1100);
    assert.equal((await ev('vals()')).margin, 0);
    await ev(`card('box_spacing').querySelector('[data-block-undo]').click()`); await settle();
    assert.equal((await ev('vals()')).margin, 24, `${tag}: 되돌리기 undoes the last change`);
    await ev(`card('box_spacing').querySelector('[data-block-reset]').click()`); await settle();
    assert.deepEqual(await ev('vals()'), ROOMY, `${tag}: 처음으로 is the pinned preset`);
    assert.equal(await ev(`card('box_spacing').querySelector('[data-block-reset]').disabled`), true);
    assert.equal(await hostMsgs(), before, `${tag}: nothing posted to the host`);
    // Sizes and ring.
    const look = await ev(`(()=>{const c=card('box_spacing'),b=[...c.querySelectorAll('.hp-param-option, [data-block-undo], [data-block-reset]')].map(e=>e.getBoundingClientRect().height),r=range('padding').getBoundingClientRect().height,f=[...c.querySelectorAll('.hp-param-label,.hp-param-value,.hp-param-option')].map(e=>parseFloat(getComputedStyle(e).fontSize));return {b,r,f,scroll:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.ok(look.b.every((h) => h >= 44) && look.r >= 44 && look.f.every((x) => x >= 14), `${tag}: 44px / 14px ${JSON.stringify(look)}`);
    assert.equal(look.scroll, false, `${tag}: no sideways scroll`);
    if (!forced) { const ring = await browser.focusVisibleStyle('[data-param="padding"] input[type=range]'); assert.ok(parseFloat(ring['outline-width']) > 0, `${tag}: range focus ring`); }
    checks += 14;

    // stage_stepper on the build step.
    await ev(`document.querySelector('button[data-step-id="build"]').click()`); await settle(120);
    await ev(`openCard('stage_stepper')`); await settle();
    const st = () => ev(`(()=>{const c=card('stage_stepper');return {count:c.querySelector('[data-stage-count]').textContent,title:c.querySelector('[data-stage-title]').textContent,sentence:c.querySelector('[data-stage-sentence]').textContent,prev:c.querySelector('[data-stage-prev]').disabled,next:c.querySelector('[data-stage-next]').disabled,imgs:c.querySelectorAll('img,script').length,pwn:window.__pwn??null,caption:c.querySelector('.hp-block-card-state').textContent}})()`);
    let s = await st();
    assert.deepEqual([s.count, s.title, s.sentence, s.prev, s.next], ['1 / 3 단계', STAGES[0].title, STAGES[0].sentence, true, false], `${tag}: first stage, text literal`);
    assert.deepEqual([s.imgs, s.pwn], [0, null], `${tag}: markup-looking stage text creates no element and runs nothing`);
    assert.equal(s.caption, `1 / 3 단계: ${STAGES[0].title}`);
    await settle(2500); assert.equal((await st()).count, '1 / 3 단계', `${tag}: no autoplay`);
    const before2 = await hostMsgs();
    await ev(`card('stage_stepper').querySelector('[data-stage-next]').click()`); await settle();
    assert.equal((await st()).count, '2 / 3 단계');
    await ev(`card('stage_stepper').querySelector('[data-surface="stage_stepper"]').focus()`);
    await press('ArrowRight'); s = await st(); assert.deepEqual([s.count, s.next], ['3 / 3 단계', true], `${tag}: → moves, 다음 disabled at the end`);
    await press('ArrowRight'); assert.equal((await st()).count, '3 / 3 단계', `${tag}: not past the end`);
    await press('ArrowLeft'); assert.equal((await st()).count, '2 / 3 단계', `${tag}: ← moves back`);
    // An IME composition: the arrow belongs to the IME.
    await ev(`(()=>{const e=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true,isComposing:true});card('stage_stepper').querySelector('[data-surface="stage_stepper"]').dispatchEvent(e)})()`); await settle();
    assert.equal((await st()).count, '2 / 3 단계', `${tag}: no move while composing`);
    assert.equal(await hostMsgs(), before2, `${tag}: stepping posts nothing`);
    const sl = await ev(`(()=>{const c=card('stage_stepper'),b=[...c.querySelectorAll('[data-stage-prev],[data-stage-next]')].map(e=>e.getBoundingClientRect().height),t=parseFloat(getComputedStyle(c.querySelector('[data-stage-title]')).fontSize),w=getComputedStyle(c.querySelector('[data-stage-title]')).fontWeight,f=[...c.querySelectorAll('[data-stage-count],[data-stage-sentence]')].map(e=>parseFloat(getComputedStyle(e).fontSize));return {b,t,w,f}})()`);
    assert.ok(sl.b.every((h) => h >= 44) && sl.t >= 16 && Number(sl.w) >= 600 && sl.f.every((x) => x >= 14), `${tag}: 44px buttons, 16px semibold title, 14px text ${JSON.stringify(sl)}`);
    if (!forced) { const ring = await browser.focusVisibleStyle('[data-surface="stage_stepper"]'); assert.ok(parseFloat(ring['outline-width']) > 0, `${tag}: stepper focus ring`); }
    checks += 11;

    // Defence in depth: BoxSpacingBlock fed served CSS text directly (re-validation bypassed).
    await ev(`mountRaw(${JSON.stringify({ padding: '8px;background:url(https://x.invalid/a)', border: '1px;background-image:url(x)', margin: 'calc(1px)', layout: 'block;background:url(x)' })})`); await settle();
    const raw = await ev(`(()=>{const o=document.querySelector('[data-box-outer]');return {style:o.getAttribute('style'),bg:getComputedStyle(o).backgroundImage,styles:document.querySelectorAll('#root style').length}})()`);
    assert.doesNotMatch(raw.style, /url|calc|background/i, `${tag}: no served CSS text in the style attribute (${raw.style})`);
    assert.match(raw.style, /^--param-padding: 0px; --param-border: 0px; --param-margin: 0px;?$/, `${tag}: only the three clamped sizes (${raw.style})`);
    assert.deepEqual([raw.bg, raw.styles], ['none', 0]);
    // EnumParam with more than 4 options: the overflow button.
    await ev('mountEnum(6)'); await settle();
    assert.equal(await ev(`document.querySelector('[data-param-overflow]').textContent`), '선택1. 모양 전체 보기');
    assert.equal(await ev(`document.querySelectorAll('[data-param="many"] input[type=radio]').length`), 0, `${tag}: closed, the list is not drawn`);
    await ev(`document.querySelector('[data-param-overflow]').click()`); await settle();
    assert.equal(await ev(`document.querySelectorAll('[data-param="many"] input[type=radio]').length`), 6, `${tag}: the whole list`);
    await ev(`document.querySelectorAll('[data-param="many"] input[type=radio]')[4].click()`); await settle();
    assert.equal(await ev(`document.querySelector('[data-param-overflow]').textContent`), '선택5. 모양 전체 보기');
    checks += 6;
  }
  console.log(`PASS param-blocks-browser: ${checks} checks (light/dark, 320/800/1420 px, forced colours)`);
} finally { await browser.close(); }
