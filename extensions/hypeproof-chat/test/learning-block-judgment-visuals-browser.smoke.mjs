// REQ-STUDIO-LEARNING-BLOCK-NO-JUDGMENT-VISUALS (CGP-LEARN-D-002, DES-CGP-LEARN-02) — no judgment visuals inside a learning block.
// The mounted ChatPanel with the shipped stylesheet in headless Chromium walks every state each block shows (criterion: empty,
// written, saved by the host, edited after the save, cleared; decision: empty, only what, only why, both, saved; each of the
// five kinds this Studio cannot draw yet, with its 자료 card) on classroom and personal seats, dark and light, 800 and 1420 px. In every state the block draws no
// check / cross / celebration glyph (text, spoken attributes, ::before/::after/::marker content, icon SVGs, images, canvases,
// background images), no green or red result colour, no animation (a save starts none anywhere on the page), and no numeral
// that is not the learner's own words. With the colour removed (grayscale(1) on the page), every state of a block still reads
// differently in words, and its text keeps 4.5:1. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN
// otherwise. LEARNING_BLOCK_VISUALS_EVIDENCE=<dir> saves a grayscale PNG of each block state.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'fixture-assets', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3 with every one of the seven kinds: expect = criterion_form, build = decision_form, then the five kinds this Studio
// cannot draw yet (each still shows its 자료 card): test = canvas_preview, diff = evidence_note, fix = coach_request,
// retest = canvas_editor, board = metric_board (an added last step).
const content = weekFixture(3);
const KIND_OF = { build: 'decision_form', retest: 'canvas_editor' };
content.steps = content.steps.map((s) => (KIND_OF[s.id] ? { ...s, ui: KIND_OF[s.id] } : s));
content.steps.push({ ...content.steps.at(-1), id: 'board', title: '정리', ui: 'metric_board' });
const UNDRAWN = [['test', 'canvas_preview'], ['diff', 'evidence_note'], ['fix', 'coach_request'], ['retest', 'canvas_editor'], ['board', 'metric_board']];
const lessonConfig = (kind) => {
  const base = chatConfig(3);
  return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } }, activity: kind === 'classroom' ? base.activity : { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/p', verified: true } };
};
const SHA = 'f'.repeat(64);

/** Result and celebration marks: checks, crosses, O/X, stars, trophies, party, applause, 100. */
const GLYPHS = /[☑☒✓-✘❌❎✅⭕⭐★☆✔\u{1F31F}\u{1F389}\u{1F38A}\u{1F3C6}\u{1F3C5}\u{1F947}-\u{1F949}\u{1F44F}\u{1F44D}\u{1F44E}\u{1F4AF}\u{1F973}\u{1F525}\u{1F6AB}✖✕×╳]|\bO\/X\b/u;
/** ChatIcon kinds that read as a verdict or a celebration on the learner's work. */
const JUDGMENT_ICONS = ['check', 'check-square', 'close', 'ban', 'sparkle'];
/** The learner's own words in this run: the only text a numeral may come from. None of them carries a glyph. */
const LEARNER = ['예약 버튼이 첫 화면에 보인다', '예약 버튼이 크다', '토요일 진료시간을 고친다', '원장님이 확인한 시간이라서'];

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-judgment-visuals browser unavailable'); process.exit(0); }
const browser = await launch(bin), evidence = process.env.LEARNING_BLOCK_VISUALS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await browser.evaluate(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};
const settle = () => browser.evaluate('new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');

const HELPERS = `
window.typeInto=(sel,value)=>{const el=document.querySelector(sel);const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
window.hostSaved=(work)=>window.postMessage({type:'lessonWorkState',sha256:${JSON.stringify(SHA)},work},'*');
window.pickStep=(id)=>document.querySelector('button[data-step-id="'+id+'"]').click();
window.running=()=>document.getAnimations().filter((a)=>a.playState==='running').length;`;

// Everything one block state draws, read from the live page. `learner` is the learner's own words, removed before numerals are read.
const MEASURE = (learner) => `(()=>{const sec=[...document.querySelectorAll('[data-hps-material]')];if(sec.length!==1)return {count:sec.length};const b=sec[0];
  const all=[b,...b.querySelectorAll('*')];const learner=${JSON.stringify(learner)};
  const cx=(window.__cx??=Object.assign(document.createElement('canvas'),{width:1,height:1}).getContext('2d',{willReadFrequently:true}));
  const rgb=(c)=>{if(!c||c==='transparent')return null;cx.clearRect(0,0,1,1);cx.fillStyle='rgba(0,0,0,0)';cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return {r:d[0],g:d[1],b:d[2],a:d[3]/255}};
  const css=(c)=>{const x=rgb(c);return x?'rgba('+x.r+','+x.g+','+x.b+','+x.a+')':'rgba(0,0,0,0)'};
  const pseudo=[];for(const e of all)for(const p of ['::before','::after','::marker']){const c=getComputedStyle(e,p).content;if(c&&c!=='none'&&c!=='normal'&&c!=='""')pseudo.push(e.localName+p+' '+c)}
  const spoken=all.flatMap((e)=>['aria-label','aria-description','title','placeholder','alt'].map((a)=>e.getAttribute(a)||'')).filter(Boolean);
  const media=all.filter((e)=>['svg','img','canvas','video','object','iframe','picture','embed'].includes(e.localName)).map((e)=>({tag:e.localName,icon:e.getAttribute('data-icon')}));
  const images=all.map((e)=>{const c=getComputedStyle(e);return [c.backgroundImage,c.listStyleImage,c.maskImage||c.webkitMaskImage,c.borderImageSource].filter((v)=>v&&v!=='none').map((v)=>e.localName+' '+v.slice(0,60))}).flat();
  const anim=all.filter((e)=>getComputedStyle(e).animationName!=='none').map((e)=>e.localName+' '+getComputedStyle(e).animationName);
  const own=document.getAnimations().filter((a)=>a.effect&&a.effect.target&&b.contains(a.effect.target)).length;
  const colors=[];for(const e of all){const c=getComputedStyle(e);for(const [k,v] of [['color',c.color],['background',c.backgroundColor],['border',c.borderTopColor],['border-right',c.borderRightColor],['border-bottom',c.borderBottomColor],['border-left',c.borderLeftColor],['outline',c.outlineColor],['underline',c.textDecorationColor],...(c.boxShadow.match(/rgba?\\([^)]*\\)/g)||[]).map((v)=>['shadow',v])]){const x=rgb(v);if(x&&x.a>0)colors.push({el:e.localName+(e.className?'.'+String(e.className).split(' ')[0]:''),k,...x})}}
  const fields=[...b.querySelectorAll('input,textarea')].map((f)=>f.value);
  let words=b.innerText;for(const l of learner)words=words.split(l).join('');
  const bgOf=(n)=>{for(;n;n=n.parentElement){const v=rgb(getComputedStyle(n).backgroundColor);if(v&&v.a>0)return css(getComputedStyle(n).backgroundColor)}return css(getComputedStyle(document.body).backgroundColor)};
  const texts=all.filter((e)=>[...e.childNodes].some((n)=>n.nodeType===3&&n.textContent.trim())&&!e.disabled&&!e.closest('[hidden]')).map((e)=>({el:e.localName,text:[...e.childNodes].filter((n)=>n.nodeType===3).map((n)=>n.textContent).join('').trim().slice(0,30),fg:css(getComputedStyle(e).color),bg:bgOf(e),opacity:getComputedStyle(e).opacity}));
  return {count:1,kind:b.dataset.hpsMaterial,text:b.innerText,spoken,pseudo,media,images,anim,own,colors,fields,words,texts,signature:b.innerText.replace(/\\s+/g,' ').trim()+' | '+fields.join(' / ')};})()`;

const toGray = ({ r, g, b, a }) => { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return { r: y, g: y, b: y, a }; };
const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const parse = (c) => { const v = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
const contrast = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
/** A saturated green or red: the colour of a pass/fail mark. Neutral greys, the theme's blue focus and Lime accents are not. */
const verdictHue = ({ r, g, b }) => {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return null;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r / 255 ? ((g - b) / 255 / d) % 6 : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
  h = (h * 60 + 360) % 360;
  if (s < 0.4 || l < 0.15 || l > 0.85) return null;
  return h >= 100 && h <= 160 ? 'green' : h <= 15 || h >= 345 ? 'red' : null;
};

/** Every judgment-visual finding in one measured state. Empty = clean. */
function judgmentVisuals(m) {
  const out = [];
  for (const s of [m.text, ...m.spoken]) { const g = s.match(GLYPHS); if (g) out.push(`glyph:${g[0]}`); }
  for (const p of m.pseudo) out.push(`pseudo:${p}`);
  for (const x of m.media) if (x.tag !== 'svg' || !x.icon || JUDGMENT_ICONS.includes(x.icon)) out.push(`media:${x.tag}${x.icon ? ':' + x.icon : ''}`);
  for (const i of m.images) out.push(`image:${i}`);
  for (const a of m.anim) out.push(`animation:${a}`);
  if (m.own) out.push(`running:${m.own}`);
  for (const c of m.colors) { const h = verdictHue(c); if (h) out.push(`colour:${h} ${c.el} ${c.k} rgb(${c.r},${c.g},${c.b})`); }
  const n = m.words.match(/[0-9０-９①-⑳❶-❿]/);
  if (n) out.push(`numeral:${n[0]} in "${m.words.replace(/\s+/g, ' ').trim().slice(0, 80)}"`);
  return out;
}

// Controls: the instrument flags each kind of judgment visual, and passes a clean block state.
const CLEAN = { text: '저장한 기준: 버튼이 보인다', spoken: [], pseudo: [], media: [{ tag: 'svg', icon: 'pencil' }], images: [], anim: [], own: 0, colors: [{ el: 'p', k: 'color', r: 204, g: 204, b: 204 }, { el: 'textarea', k: 'outline', r: 0, g: 127, b: 212 }], words: '저장한 기준:' };
assert.deepEqual(judgmentVisuals(CLEAN), [], 'control: a clean state passes');
for (const [over, rule] of [[{ text: '정답 ✓' }, 'glyph'], [{ spoken: ['🎉'] }, 'glyph'], [{ pseudo: ['p::before "✔"'] }, 'pseudo'], [{ media: [{ tag: 'svg', icon: 'check' }] }, 'media'],
  [{ media: [{ tag: 'canvas', icon: null }] }, 'media'], [{ images: ['p url(check.svg)'] }, 'image'], [{ anim: ['p confetti'] }, 'animation'], [{ own: 1 }, 'running'],
  [{ colors: [{ el: 'p', k: 'color', r: 26, g: 127, b: 55 }] }, 'colour:green'], [{ colors: [{ el: 'p', k: 'border', r: 207, g: 34, b: 46 }] }, 'colour:red'], [{ words: '3점' }, 'numeral']]) {
  assert.ok(judgmentVisuals({ ...CLEAN, ...over }).some((f) => f.startsWith(rule)), `control: the instrument misses ${rule} ${JSON.stringify(over)}`);
}

/** Control: the walk reached all seven kinds, so a kind's card icon cannot go unmeasured. */
const eq7 = (kinds, tag) => assert.deepEqual([...kinds].sort(), ['canvas_editor', 'canvas_preview', 'coach_request', 'criterion_form', 'decision_form', 'evidence_note', 'metric_board'], `${tag}: every block kind measured`);

let cases = 0, states = 0;
const shots = [];
try {
  for (const seat of ['classroom', 'personal']) for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${seat} ${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELPERS}</script></body></html>`, { width, height: 1100, dark });
    await browser.evaluate(`mount(${JSON.stringify(lessonConfig(seat))})`);
    await waitFor(`document.querySelector('[data-hps-material="criterion_form"]')`, `${tag} criterion block`);

    // One state: measured in colour, then with the colour removed from the whole page.
    const seen = {};
    const state = async (kind, name, act) => {
      const before = await browser.evaluate('running()');
      if (act) await browser.evaluate(act);
      await settle();
      const m = await browser.evaluate(MEASURE(LEARNER));
      const t = `${tag} ${kind} ${name}`;
      assert.equal(m.count, 1, `${t}: one block on screen`);
      assert.equal(m.kind, kind, `${t}: the step's block`);
      assert.deepEqual(judgmentVisuals(m), [], `${t}: no judgment visual`);
      assert.ok(await browser.evaluate('running()') <= before, `${t}: the change started no animation on the page (celebration)`);
      await browser.evaluate(`document.documentElement.style.filter='grayscale(1)'`); await settle();
      const g = await browser.evaluate(MEASURE(LEARNER));
      assert.equal(g.signature, m.signature, `${t}: removing colour changes no word`);
      for (const x of g.texts) {
        const ratio = contrast(toGray(parse(x.fg)), toGray(parse(x.bg)));
        assert.ok(ratio >= 4.5 && Number(x.opacity) === 1, `${t}: "${x.text}" stays readable without colour (${ratio.toFixed(2)}:1, ${x.fg} on ${x.bg}, opacity ${x.opacity})`);
      }
      if (evidence && (seat === 'classroom' || width === 800)) {
        const r = await browser.evaluate(`(()=>{const e=document.querySelector('[data-hps-material]');e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:Math.max(0,b.left-8),y:Math.max(0,b.top-8),w:b.width+16,h:b.height+16}})()`);
        const shot = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
        const file = `${evidence}/${seat}-${dark ? 'dark' : 'light'}-${width}-${kind}-${name}-gray.png`;
        writeFileSync(file, Buffer.from(shot.data, 'base64')); shots.push(file);
      }
      await browser.evaluate(`document.documentElement.style.filter=''`);
      (seen[kind] ??= []).push([name, g.signature]);
      states++;
    };

    const crit = '[data-surface="criterion_form"] textarea';
    await state('criterion_form', 'empty');
    await state('criterion_form', 'written', `typeInto(${JSON.stringify(crit)},${JSON.stringify(LEARNER[0])})`);
    await state('criterion_form', 'saved', `hostSaved({expect:{kind:'criterion',text:${JSON.stringify(LEARNER[0])},savedAt:1}})`);
    await state('criterion_form', 'edited', `typeInto(${JSON.stringify(crit)},${JSON.stringify(LEARNER[1])})`);
    await state('criterion_form', 'cleared', `typeInto(${JSON.stringify(crit)},'')`);

    await browser.evaluate(`pickStep('build')`);
    await waitFor(`document.querySelector('[data-hps-material="decision_form"]')`, `${tag} decision block`);
    const what = '[data-surface="decision_form"] input', why = '[data-surface="decision_form"] textarea';
    await state('decision_form', 'empty');
    await state('decision_form', 'what-only', `typeInto(${JSON.stringify(what)},${JSON.stringify(LEARNER[2])})`);
    await state('decision_form', 'both', `typeInto(${JSON.stringify(why)},${JSON.stringify(LEARNER[3])})`);
    await state('decision_form', 'why-only', `typeInto(${JSON.stringify(what)},'')`);
    await state('decision_form', 'saved', `typeInto(${JSON.stringify(what)},${JSON.stringify(LEARNER[2])});hostSaved({expect:{kind:'criterion',text:${JSON.stringify(LEARNER[0])},savedAt:1},build:{kind:'decision',text:${JSON.stringify(LEARNER[2])},reason:${JSON.stringify(LEARNER[3])},savedAt:2}})`);

    for (const [id, kind] of UNDRAWN) {
      await browser.evaluate(`pickStep(${JSON.stringify(id)})`);
      await waitFor(`document.querySelector('[data-hps-material="${kind}"]')`, `${tag} ${kind} block`);
      await state(kind, 'unavailable');
    }
    eq7(Object.keys(seen), tag);

    // Colour removed, each state of a block still reads differently: no state is carried by colour alone.
    for (const [kind, list] of Object.entries(seen)) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        assert.notEqual(list[i][1], list[j][1], `${tag} ${kind}: "${list[i][0]}" and "${list[j][0]}" read the same without colour`);
      }
    }
    cases++;
  }
  console.log(`PASS learning-block-judgment-visuals-browser: ${cases} seat/theme/width cases, ${states} block states with no check/cross/celebration glyph, verdict colour, animation or learner-tied numeral; every state reads differently in words with the colour removed, text >= 4.5:1 in grayscale${shots.length ? `; ${shots.length} PNGs in ${evidence}` : ''}`);
} finally { await browser.close(); }
