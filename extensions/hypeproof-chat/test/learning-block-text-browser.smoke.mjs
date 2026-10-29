// REQ-STUDIO-LEARNING-BLOCK-TEXT (CGP-LEARN-R-003, REQ-CGP-LEARN-03 (a)(b)) — every block the lesson attaches shows its live
// text equivalent on the mounted ChatPanel with the shipped stylesheet in headless Chromium: a title that names the block
// region, one controls help sentence, and a state sentence in a polite live region. Changing any control (each field, the
// save press answered by the host, a step switch) puts the new state sentence into that same mounted region within 500 ms,
// measured from the input event to the region's mutation. The text is visible (not screen-reader only) at 14px or more with
// 4.5:1 contrast, and each field names the help and state as its description. Classroom and personal seats, dark and light,
// 800 and 1420 px. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
// LEARNING_BLOCK_TEXT_EVIDENCE=<dir> saves PNGs of the block.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { chatConfig, chatPanelProps, weekFixture } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { MATERIAL_TEXT } from '../src/lessonFocus.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3 with a decision step and an undrawable kind: expect = criterion_form, build = decision_form, test = canvas_preview.
const content = weekFixture(3);
content.steps = content.steps.map((s) => (s.id === 'build' ? { ...s, ui: 'decision_form' } : s));
const lessonConfig = (kind) => {
  const base = chatConfig(3);
  return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } }, activity: kind === 'classroom' ? base.activity : { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/p', verified: true } };
};
const SHA = 'f'.repeat(64);

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-text browser unavailable'); process.exit(0); }
const evidence = process.env.LEARNING_BLOCK_TEXT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await browser.evaluate(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};

// Page helpers: `change` performs one change and records, from that moment, when the live region's words change.
const HELPERS = `
window.__region=null;
window.track=()=>{window.__region=document.querySelector('.hp-material-state');return !!window.__region};
window.change=(act)=>{window.__stopMeasurement?.();const live=window.__region,before=live.textContent;window.__m=null;const t0=performance.now();
  const owner={};window.__measurement=owner;let timer,settled=false;
  const cleanup=()=>{mo.disconnect();clearTimeout(timer)};
  const finish=(timeout)=>{if(settled||window.__measurement!==owner)return;settled=true;cleanup();window.__m={ms:timeout?1e9:performance.now()-t0,text:live.textContent,key:live.dataset.materialState}};
  const mo=new MutationObserver(()=>{if(live.textContent!==before)finish(false)});
  mo.observe(live,{subtree:true,childList:true,characterData:true});timer=setTimeout(()=>finish(true),1500);
  window.__stopMeasurement=()=>{settled=true;cleanup()};try{act()}catch(error){window.__stopMeasurement();throw error}};
window.typeInto=(sel,value)=>window.change(()=>{const el=document.querySelector(sel);const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))});
window.hostSaved=(work)=>window.change(()=>window.postMessage({type:'lessonWorkState',sha256:${JSON.stringify(SHA)},work},'*'));
window.pickStep=(id)=>window.change(()=>document.querySelector('button[data-step-id="'+id+'"]').click());
window.openCard=()=>{const b=document.querySelector('[data-block-card] [data-block-toggle][aria-expanded="false"]');if(b)b.click();return !!b};`;

// A prior action's timeout/observer must never fill the next action's result.
// Exercise the exact page helper with controlled event ordering, including queued
// callbacks after cancellation; the actual browser below still owns the 500 ms gate.
{
  let now=0;const timers=[],observers=[],live={textContent:'empty',dataset:{materialState:'empty'}};
  const page={};
  runInNewContext(HELPERS,{window:page,document:{querySelector:()=>live},performance:{now:()=>now},
    setTimeout:fn=>{const timer={fn,active:true};timers.push(timer);return timer},clearTimeout:timer=>{if(timer)timer.active=false},
    MutationObserver:class{constructor(fn){this.fn=fn;this.active=true;observers.push(this)}observe(){}disconnect(){this.active=false}}});
  page.track();const mutate=(text)=>{live.textContent=text;live.dataset.materialState=text;for(const o of observers)if(o.active)o.fn()};
  page.change(()=>{now=10;mutate('written')});assert.equal(page.__m.ms,10);assert.equal(timers[0].active,false);
  now=100;page.change(()=>{});const current=timers.at(-1);assert.equal(page.__m,null);
  now=1500;timers[0].fn();observers[0].fn();assert.equal(page.__m,null,'stale callbacks cannot finish a new measurement');
  mutate('saved');assert.equal(page.__m.ms,1400,'late changes stay late; never relax the 500 ms gate');assert.equal(current.active,false);
  now=2000;page.change(()=>{});const abandoned=timers.at(-1),abandonedObserver=observers.at(-1);
  now=2100;page.change(()=>{});abandoned.fn();abandonedObserver.fn();assert.equal(page.__m,null,'superseded measurement cannot report');
  now=2110;mutate('edited');assert.equal(page.__m.ms,10);
  now=3000;page.change(()=>{});now=4500;timers.at(-1).fn();const timeout=page.__m;assert.equal(timeout.ms,1e9);
  mutate('too-late');observers.at(-1).fn();assert.equal(page.__m,timeout,'timeout cannot be overwritten by a late mutation');
  assert.throws(()=>page.change(()=>{throw Error('action failed')}),/action failed/);
  assert.equal(timers.at(-1).active,false);assert.equal(observers.at(-1).active,false);
  console.log('PASS live-region observation controls: stale, superseded, late, timed-out and thrown actions stay isolated');
}

const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

const MEASURE = `(()=>{const sec=[...document.querySelectorAll('[data-hps-material]')];if(sec.length!==1)return {count:sec.length};const s=sec[0];
  const title=s.querySelector('.hp-material-title'),help=s.querySelector('.hp-material-help'),state=s.querySelector('.hp-material-state');
  const bgOf=(n)=>{for(;n;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b}return getComputedStyle(document.body).backgroundColor};
  const vis=(n)=>{if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),c=getComputedStyle(n);const hit=document.elementFromPoint(r.left+Math.min(8,r.width/2),r.top+r.height/2);
    return {text:n.textContent,w:r.width,h:r.height,font:parseFloat(c.fontSize),color:c.color,bg:bgOf(n),hidden:c.visibility!=='visible'||c.display==='none'||r.width<2||r.height<2||c.clipPath!=='none'&&c.clipPath!=='',hit:!!hit&&n.contains(hit),inView:r.right<=innerWidth+0.5&&r.left>=-0.5}};
  const ids=(v)=>(v||'').split(/\\s+/).filter(Boolean).map(i=>document.getElementById(i)?.textContent??null);
  const fields=[...s.querySelectorAll('input,textarea')].map(f=>({label:f.closest('label')?.textContent?.replace(f.value,'').trim()??'',desc:ids(f.getAttribute('aria-describedby'))}));
  return {count:1,kind:s.dataset.hpsMaterial,tag:s.localName,labelled:ids(s.getAttribute('aria-labelledby')),described:ids(s.getAttribute('aria-describedby')),
    title:vis(title),titleTag:title?.localName,help:vis(help),state:vis(state),role:state?.getAttribute('role'),live:state?.getAttribute('aria-live'),atomic:state?.getAttribute('aria-atomic'),key:state?.dataset.materialState,
    fields,pageScroll:document.documentElement.scrollWidth>innerWidth}})()`;

const checkVisible = (t, m, kind) => {
  const c = MATERIAL_TEXT[kind];
  assert.equal(m.count, 1, `${t}: one block on screen`);
  assert.equal(m.kind, kind, `${t}: the step's block`);
  assert.deepEqual(m.labelled, [c.title], `${t}: the block region is named by its title`);
  assert.deepEqual(m.described, [c.controlsHelp], `${t}: the block region is described by its controls help`);
  assert.equal(m.title.text, c.title); assert.equal(m.help.text, c.controlsHelp);
  assert.equal(m.role, 'status'); assert.equal(m.live, 'polite'); assert.equal(m.atomic, 'true');
  for (const part of ['title', 'help', 'state']) {
    const p = m[part];
    assert.ok(!p.hidden && p.hit && p.inView, `${t}: ${part} is drawn and visible, not screen-reader only ${JSON.stringify(p)}`);
    assert.ok(p.font >= 14, `${t}: ${part} at 14px or more (${p.font})`);
    const ratio = contrast(parse(p.color), parse(p.bg));
    assert.ok(ratio >= 4.5, `${t}: ${part} contrast ${ratio.toFixed(2)} >= 4.5 (${p.color} on ${p.bg})`);
  }
  for (const f of m.fields) {
    assert.ok(f.label.length > 0, `${t}: every field has a visible label ${JSON.stringify(f)}`);
    assert.deepEqual(f.desc, [c.controlsHelp, m.state.text], `${t}: every field is described by the help and the current state`);
  }
  assert.equal(m.pageScroll, false, `${t}: no horizontal page scroll`);
};

const changed = async (t, expectKey) => {
  await waitFor('window.__m', `${t} change`);
  const m = await browser.evaluate('window.__m');
  assert.ok(m.ms <= 500, `${t}: the live region took ${m.ms.toFixed(1)} ms (limit 500)`);
  assert.equal(m.key, expectKey, `${t}: state`);
  assert.equal(await browser.evaluate('window.__region===document.querySelector(".hp-material-state")&&window.__region.isConnected'), true, `${t}: the same mounted live region changed its words`);
  return m;
};

const browser = await launch(bin);
let cases = 0, changes = 0, slowest = 0;
try {
  for (const seat of ['classroom', 'personal']) for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${seat} ${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELPERS}</script></body></html>`, { width, height: 1100, dark });
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await browser.evaluate(`mount(${JSON.stringify(lessonConfig(seat))})`);
    await waitFor(`document.querySelector('[data-hps-material="criterion_form"] .hp-material-state')`, `${tag} criterion block`);
    await browser.evaluate('track()');
    // CGP-LEARN-D-001: the block is a 자료 card, closed by default; the learner opens it with 열어 보기 before reading or editing.
    assert.equal(await browser.evaluate('openCard()'), true, `${tag}: the criterion card starts closed with 열어 보기`);
    const note = async (m) => { changes++; slowest = Math.max(slowest, m.ms); };

    // criterion_form: empty -> written -> host save -> edited -> cleared.
    let m = await browser.evaluate(MEASURE);
    checkVisible(`${tag} criterion empty`, m, 'criterion_form');
    assert.equal(m.key, 'empty');
    const crit = '[data-surface="criterion_form"] textarea';
    await browser.evaluate(`typeInto(${JSON.stringify(crit)},'예약 버튼이 첫 화면에 보인다')`); await note(await changed(`${tag} criterion type`, 'written'));
    await browser.evaluate(`document.querySelector('[data-surface="criterion_form"] button[type=submit]').click()`);
    const post = await browser.evaluate(`posted.filter(p=>p.type==='lessonWork').at(-1)`);
    assert.deepEqual({ kind: post.kind, text: post.text, stepId: post.stepId }, { kind: 'criterion', text: '예약 버튼이 첫 화면에 보인다', stepId: 'expect' }, `${tag}: the save press asks the host`);
    await browser.evaluate(`hostSaved({expect:{kind:'criterion',text:'예약 버튼이 첫 화면에 보인다',savedAt:1}})`); await note(await changed(`${tag} criterion saved`, 'saved'));
    m = await browser.evaluate(MEASURE);
    checkVisible(`${tag} criterion saved`, m, 'criterion_form');
    if (evidence && seat === 'classroom' || evidence && width === 800) {
      const r = await browser.evaluate(`(()=>{const b=document.querySelector('[data-hps-material]').getBoundingClientRect();return {x:Math.max(0,b.left-8),y:Math.max(0,b.top-8),w:b.width+16,h:b.height+16}})()`);
      const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
      writeFileSync(`${evidence}/${seat}-${dark ? 'dark' : 'light'}-${width}-criterion-saved.png`, Buffer.from(shot.data, 'base64'));
    }
    await browser.evaluate(`typeInto(${JSON.stringify(crit)},'예약 버튼이 크다')`); await note(await changed(`${tag} criterion edit`, 'edited'));
    await browser.evaluate(`typeInto(${JSON.stringify(crit)},'')`); await note(await changed(`${tag} criterion clear`, 'cleared'));

    // A step switch to the decision block: same region, new block, its own sentence.
    await browser.evaluate(`pickStep('build')`); await note(await changed(`${tag} step to decision`, 'empty'));
    assert.equal(await browser.evaluate('openCard()'), true, `${tag}: the decision card starts closed`);
    m = await browser.evaluate(MEASURE);
    checkVisible(`${tag} decision empty`, m, 'decision_form');
    assert.equal(m.state.text, MATERIAL_TEXT.decision_form.state({ text: '', reason: '' }).sentence);
    await browser.evaluate(`typeInto('[data-surface="decision_form"] input','토요일 진료시간을 고친다')`); await note(await changed(`${tag} decision what`, 'need-reason'));
    await browser.evaluate(`typeInto('[data-surface="decision_form"] textarea','원장님이 확인한 시간이라서')`); await note(await changed(`${tag} decision why`, 'written'));
    await browser.evaluate(`typeInto('[data-surface="decision_form"] input','')`); await note(await changed(`${tag} decision clear what`, 'need-decision'));

    // An undrawable kind keeps its title, help and a fixed state (the header's step buttons only move forward).
    await browser.evaluate(`pickStep('test')`); await note(await changed(`${tag} step to undrawable`, 'unavailable'));
    assert.equal(await browser.evaluate('openCard()'), true, `${tag}: the undrawable card starts closed`);
    m = await browser.evaluate(MEASURE);
    checkVisible(`${tag} canvas_preview`, m, 'canvas_preview');
    assert.ok(/열 수 없습니다/.test(await browser.evaluate(`document.querySelector('[data-hps-material]').textContent`)), `${tag}: the honest notice stays`);
    cases++;
  }
  console.log(`PASS learning-block-text-browser: ${cases} seat/theme/width cases, ${changes} control changes each announced in the same polite region (slowest ${slowest.toFixed(1)} ms <= 500), title/help/state visible at >= 14px and 4.5:1`);
} finally { await browser.close(); }
