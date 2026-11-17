// CGP-LEARN-R-007 / CGP-LEARN-D-007 (REQ-CGP-LEARN-07, DES-CGP-LEARN-07) — motion in learning blocks, in headless Chromium with
// the shipped stylesheet. No shipped kind animates yet, so this is a guard plus the controller the first animated kind must use:
// 1. Guard: on the mounted ChatPanel, every kind marked "static" in MATERIAL_MOTION (all nine today) is opened and left alone
//    for 3 s: its text, field values, markup and computed styles do not change and no animation runs. A kind marked "animated"
//    must instead start paused with the playback controls (none today; the branch is exercised by the mutant run).
// 2. Controller (BlockPlayback.tsx on a test-only 5-frame block, not a catalog type): it starts paused on "1 / 5 장면" with
//    재생 and 한 단계 and does not move by itself; 재생 plays at >= 334 ms a frame even when the block asks for 50 ms (<= 3 Hz);
//    멈춤 keeps the frame; 한 단계 moves one frame; play stops on the last frame. With the host's reduced-motion setting, and
//    separately with the OS prefers-reduced-motion, 재생 is not offered, a running play stops on its frame, 한 단계 stays, and
//    the controls' transitions compute to at most 0.01 ms (the reduced-motion token). Focus never drops to the page (end of
//    play, end of 한 단계, reduced motion removing 멈춤), and a hidden page stops play without resuming it.
// 3. 44px buttons and 14px text in light/dark at 320/800/1420 px; in forced colours a disabled button keeps a visible border.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps, weekFixture } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { MATERIAL_KINDS, MATERIAL_MOTION } = await import('../src/lessonFocus.ts');
const props = chatPanelProps({});
const callbacks = Object.entries(props).filter(([, v]) => typeof v === 'function').map(([k]) => `${k}:()=>{}`).join(',');
const data = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v !== 'function'));
delete data.messages; delete data.config;
const asset = await build({ entryPoints: [`${root}/webview-ui/src/main.tsx`], bundle: true, write: false, outdir: 'out', loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = asset.outputFiles.find((f) => f.path.endsWith('.css')).text;
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';import{useBlockPlayback,PlaybackControls}from'./src/BlockPlayback';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);
function Fixture(){const p=useBlockPlayback(5,50);return <section data-fixture=""><p data-fixture-frame="">{'장면 '+(p.state.frame+1)}</p><PlaybackControls playback={p}/></section>;}
let remounts=0;window.mountFixture=()=>root.render(<Fixture key={++remounts}/>);// a new key: a fresh, paused controller each time`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3 with every kind on its own step; the parametric ones with valid params.
const content = weekFixture(3);
const base = content.steps.at(-1);
const PARAMS = { box_spacing: { padding: 16, border: 1, margin: 8, layout: 'block' }, stage_stepper: { stages: [{ title: '첫 장면', sentence: '무엇이 바뀌는지 봐요.' }, { title: '둘째 장면', sentence: '다시 살펴봐요.' }] },
  narrated_diagram: { diagram: 'html_to_page', beats: [{ title: '코드 쓰기', sentence: 'HTML 코드를 적어요.' }, { title: '브라우저가 읽기', sentence: '브라우저가 코드를 읽어요.' }, { title: '화면에 그리기', sentence: '읽은 것을 화면에 그려요.' }] } };
content.steps = MATERIAL_KINDS.map((kind, i) => ({ ...(content.steps[i] ?? base), id: 'm' + i, title: '단계 ' + (i + 1), ui: kind, ui_version: 1, ...(PARAMS[kind] ? { ui_params: PARAMS[kind] } : {}) }));
const config = (() => { const b = chatConfig(3); return { ...b, profile: { ...b.profile, lesson: { ...b.profile.lesson, content } } }; })();

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-motion browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (e) => browser.evaluate(e);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const HELP = `window.card=(k)=>document.querySelector('[data-block-card="'+k+'"]');
window.pickStep=(id)=>{const b=document.querySelector('button[data-step-id="'+id+'"]');if(b)b.click();};
window.openCard=(k)=>{const b=card(k)&&card(k).querySelector('[data-block-toggle][aria-expanded="false"]');if(b)b.click();};
window.snapshot=(k)=>{const c=card(k);if(!c)return null;const all=[c,...c.querySelectorAll('*')];
  return {html:c.outerHTML,text:c.innerText,fields:[...c.querySelectorAll('input,textarea,select')].map(f=>f.type==='radio'||f.type==='checkbox'?String(f.checked):f.value),
    styles:all.map(e=>{const s=getComputedStyle(e);return [s.transform,s.opacity,s.width,s.height,s.color,s.backgroundColor,s.visibility].join('|')}).join(';'),
    running:document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&a.effect.target&&c.contains(a.effect.target)).length,
    playback:c.querySelector('[data-block-playback]')?c.querySelector('[data-block-playback]').dataset.playing:null}};
window.frame=()=>document.querySelector('[data-fixture-frame]').textContent;
window.scene=()=>document.querySelector('[data-playback-scene]').textContent;
window.btn=(n)=>document.querySelector('[data-playback-'+n+']');
window.watchFrames=()=>{window.__changes=[];const t=document.querySelector('[data-fixture-frame]');new MutationObserver(()=>window.__changes.push(performance.now())).observe(t,{childList:true,characterData:true,subtree:true});};`;
const emulate = (dark, forced, reduce) => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });

let checks = 0;
try {
  assert.deepEqual(Object.keys(MATERIAL_MOTION).sort(), [...MATERIAL_KINDS].sort(), 'MATERIAL_MOTION names every kind');
  const runs = [];
  for (const dark of [false, true]) for (const width of [320, 800, 1420]) runs.push({ dark, width, forced: false });
  runs.push({ dark: false, width: 800, forced: true });
  for (const { dark, width, forced } of runs) {
    const tag = `${dark ? 'dark' : 'light'} ${width}${forced ? ' forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const page = `<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELP}</script></body></html>`;

    // 1. Guard: every static kind is left alone for 3 s (sampled at 0, 1.5 and 3 s) and nothing changes.
    if (width === 800 && !forced) {
      await browser.load(page, { width, height: 1100, dark, forcedColors: forced });
      await ev(`mount(${JSON.stringify(config)})`); await settle(150);
      for (const [i, kind] of MATERIAL_KINDS.entries()) {
        await ev(`pickStep('m${i}')`); await settle(80); await ev(`openCard('${kind}')`); await settle(120);
        const first = await ev(`snapshot('${kind}')`);
        assert.ok(first, `${tag}: the ${kind} card is drawn`);
        if (MATERIAL_MOTION[kind] === 'animated') {
          assert.equal(first.playback, 'false', `${tag}: animated ${kind} starts paused with the playback controls`);
          continue;
        }
        assert.equal(first.playback, null, `${tag}: static ${kind} has no playback controls`);
        for (const at of [1500, 1500]) {
          await settle(at);
          const later = await ev(`snapshot('${kind}')`);
          assert.equal(later.running, 0, `${tag}: no animation runs in ${kind}`);
          assert.deepEqual(later, first, `${tag}: ${kind} does not change with no input`);
        }
        checks += 3;
      }
    }

    // 2. The controller on a test-only 5-frame block.
    await browser.load(page, { width, height: 900, dark, forcedColors: forced });
    await ev('mountFixture()'); await settle(80);
    assert.deepEqual(await ev(`[scene(),frame(),!!btn('play'),!!btn('pause'),!!btn('step'),document.querySelector('[data-block-playback]').dataset.playing]`), ['1 / 5 장면', '장면 1', true, false, true, 'false'], `${tag}: starts paused on the first frame with 재생 and 한 단계`);
    await settle(1200);
    assert.equal(await ev('frame()'), '장면 1', `${tag}: does not move by itself`);
    await ev(`watchFrames();btn('play').click()`); await settle(1150);
    const played = await ev(`({f:frame(),pause:!!btn('pause'),gaps:window.__changes.map((t,i,a)=>i?t-a[i-1]:null).slice(1)})`);
    assert.ok(['장면 3', '장면 4'].includes(played.f) && played.pause, `${tag}: 재생 plays at ~334 ms a frame (asked 50 ms): ${JSON.stringify(played)}`);
    assert.ok(played.gaps.every((g) => g >= 320), `${tag}: never faster than 3 Hz ${JSON.stringify(played.gaps)}`);
    const kept = await ev(`(()=>{const f=frame();btn('pause').click();return f})()`); await settle(40);
    assert.notEqual(kept, '장면 1', `${tag}: play had moved before 멈춤`);
    assert.equal(await ev('frame()'), kept, `${tag}: 멈춤 keeps the frame it was on`);
    await settle(1000);
    assert.equal(await ev('frame()'), kept, `${tag}: and stays there`);
    await ev(`btn('step').click()`); await settle(40);
    assert.equal(await ev('frame()'), '장면 ' + (Number(kept.split(' ')[1]) + 1), `${tag}: 한 단계 moves one frame`);
    await ev(`btn('play').click()`); await settle(1500);
    assert.deepEqual(await ev(`[frame(),scene(),btn('play').getAttribute('aria-disabled'),btn('step').getAttribute('aria-disabled'),document.querySelector('[data-block-playback]').dataset.playing]`), ['장면 5', '5 / 5 장면', 'true', 'true', 'false'], `${tag}: play stops on the last frame`);
    checks += 7;

    // Focus never drops to the page: at the end of play, at the end of 한 단계, and when reduced motion removes 멈춤.
    const inControls = `(()=>{const a=document.activeElement;return a&&a!==document.body&&!!a.closest('[data-block-playback]')?(a.dataset.playbackStep!==undefined?'step':'toggle'):'lost'})()`;
    await ev('mountFixture()'); await settle(60);
    await ev(`btn('play').focus();btn('play').click()`); await settle(1700);
    assert.deepEqual(await ev(`[frame(),${inControls},btn('play').getAttribute('aria-disabled')]`), ['장면 5', 'toggle', 'true'], `${tag}: play reaches the end and focus stays on 재생 (now unavailable)`);
    await ev(`btn('play').click()`); await settle(400);
    assert.equal(await ev('frame()'), '장면 5', `${tag}: an unavailable 재생 does nothing`);
    await ev('mountFixture()'); await settle(60);
    await ev(`btn('step').focus();for(let i=0;i<4;i++)btn('step').click()`); await settle(60);
    assert.deepEqual(await ev(`[frame(),${inControls},btn('step').getAttribute('aria-disabled')]`), ['장면 5', 'step', 'true'], `${tag}: 한 단계 reaches the end and keeps focus`);
    await ev(`btn('step').click()`); await settle(60);
    assert.equal(await ev('frame()'), '장면 5', `${tag}: an unavailable 한 단계 does nothing`);
    await ev('mountFixture()'); await settle(60);
    await ev(`btn('play').focus();btn('play').click()`); await settle(400);
    assert.equal(await ev(`btn('pause')===document.activeElement`), true, `${tag}: 재생 becomes 멈춤 on the same focused button`);
    await ev(`document.documentElement.dataset.reducedMotion='true'`); await settle(80);
    assert.equal(await ev(inControls), 'step', `${tag}: reduced motion removes 멈춤 and focus moves to 한 단계`);
    await ev(`delete document.documentElement.dataset.reducedMotion`); await settle(60);
    checks += 5;

    // A hidden page stops play, and coming back does not resume it.
    await ev('mountFixture()'); await settle(60);
    await ev(`btn('play').click()`); await settle(400);
    await ev(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`); await settle(40);
    const hid = await ev('frame()'); await settle(900);
    assert.deepEqual(await ev(`[frame(),document.querySelector('[data-block-playback]').dataset.playing]`), [hid, 'false'], `${tag}: hidden: play stops on its frame`);
    await ev(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`); await settle(900);
    assert.deepEqual(await ev(`[frame(),document.querySelector('[data-block-playback]').dataset.playing,!!btn('play')]`), [hid, 'false', true], `${tag}: visible again: still paused, 재생 offered`);
    await ev(`delete document.hidden`);
    checks += 2;

    // Reduced motion: the host setting, then the OS setting. 재생 is not offered; a running play stops on its frame.
    for (const via of ['host', 'os']) {
      await ev('mountFixture()'); await settle(60);
      await ev(`document.documentElement.removeAttribute('data-reduced-motion');btn('play').click()`); await settle(400);
      if (via === 'host') await ev(`document.documentElement.dataset.reducedMotion='true'`);
      else await emulate(dark, forced, true);
      await settle(60);
      const at = await ev('frame()'); await settle(800);
      const r = await ev(`({f:frame(),play:!!btn('play'),pause:!!btn('pause'),step:!!btn('step'),playing:document.querySelector('[data-block-playback]').dataset.playing,tr:(v=>v.endsWith('ms')?parseFloat(v):parseFloat(v)*1000)(getComputedStyle(btn('step')).transitionDuration)<=0.01})`);
      assert.deepEqual(r, { f: at, play: false, pause: false, step: true, playing: 'false', tr: true }, `${tag} ${via}: reduced motion offers no 재생, stops on its frame, keeps 한 단계`);
      await ev(`btn('step').click()`); await settle(40);
      assert.notEqual(await ev('frame()'), at, `${tag} ${via}: 한 단계 still moves`);
      await ev(`delete document.documentElement.dataset.reducedMotion`); await emulate(dark, forced, false); await settle(60);
      assert.equal(await ev(`!!btn('play')`), true, `${tag} ${via}: 재생 comes back when motion is allowed again`);
      checks += 3;
    }

    // 3. Geometry; forced colours keep a border on a disabled button.
    await ev('mountFixture()'); await settle(60);
    const g = await ev(`({h:[...document.querySelectorAll('.hp-playback-nav>button')].map(b=>b.getBoundingClientRect().height),w:[...document.querySelectorAll('.hp-playback-nav>button')].map(b=>b.getBoundingClientRect().width),f:[...document.querySelectorAll('.hp-playback-scene,.hp-playback-nav>button')].map(e=>parseFloat(getComputedStyle(e).fontSize)),overflow:document.scrollingElement.scrollWidth-innerWidth})`);
    assert.ok(g.h.every((x) => x >= 44) && g.w.every((x) => x >= 44), `${tag}: 44px buttons ${JSON.stringify(g)}`);
    assert.ok(g.f.every((x) => x >= 14), `${tag}: 14px text ${JSON.stringify(g.f)}`);
    assert.ok(g.overflow <= 0, `${tag}: no horizontal scroll (${g.overflow})`);
    if (forced) {
      await ev(`for(let i=0;i<4;i++)btn('step').click()`); await settle(60);
      const b = await ev(`(()=>{const s=getComputedStyle(btn('step'));return [btn('step').getAttribute('aria-disabled')==='true',s.borderTopStyle,parseFloat(s.borderTopWidth)]})()`);
      assert.ok(b[0] && b[1] !== 'none' && b[2] >= 1, `${tag}: a disabled button keeps a visible border ${JSON.stringify(b)}`);
      checks += 1;
    } else {
      const ring = await browser.focusVisibleStyle('[data-playback-step]');
      assert.ok(parseFloat(ring['outline-width']) > 0, `${tag}: focus ring on 한 단계`);
      checks += 1;
    }
    checks += 3;
  }
  console.log(`PASS learning-block-motion-browser: ${checks} checks (guard over ${MATERIAL_KINDS.length} kinds; controller in light/dark, 320/800/1420 px, forced colours; host and OS reduced motion)`);
} finally { await browser.close(); }
