// REQ-STUDIO-LEARNING-BLOCK-RESET-UNDO (CGP-LEARN-R-010, CGP-LEARN-D-010) — on the mounted ChatPanel with the shipped stylesheet
// in headless Chromium, a learning block's "처음으로" restores its preset (empty fields) exactly and "되돌리기" reverts one change
// (one typing burst, or one reset); undo is disabled while there is nothing to undo and reset while the fields are the preset.
// Neither posts anything to the host (no save, no observation event). Both are quiet buttons, not Primary, 44px targets with
// 14px text, and a disabled one reads differently from an enabled one (colour and boundary style), not only by opacity.
// The saved work stays saved. Classroom seat, dark and light, 800 and 1420 px; criterion_form and decision_form.
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
const js = (await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';
const root=createRoot(document.getElementById('root'));
window.mount=(config)=>root.render(<ChatPanel {...${JSON.stringify(data)}} {...{${callbacks}}} config={config} messages={[]}/>);`, resolveDir: root + '/webview-ui', loader: 'tsx' }, bundle: true, write: false, outdir: 'out', platform: 'browser', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })).outputFiles.find((f) => f.path.endsWith('.js')).text;

// Week 3: expect = criterion_form, build = decision_form.
const content = weekFixture(3);
content.steps = content.steps.map((s) => (s.id === 'build' ? { ...s, ui: 'decision_form' } : s));
const config = (() => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, lesson: { ...base.profile.lesson, content } } }; })();
const SHA = 'f'.repeat(64);

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: learning-block-reset-undo browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (expr) => browser.evaluate(expr);
const waitFor = async (expr, what, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) { if (await ev(`!!(${expr})`)) return; if (Date.now() > end) throw Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 16)); }
};
const HELPERS = `
window.typeInto=(sel,value)=>{const el=document.querySelector(sel);el.focus();const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
window.blurAll=()=>{document.activeElement&&document.activeElement.blur()};
window.vals=(surf)=>[...document.querySelectorAll('[data-surface="'+surf+'"] input,[data-surface="'+surf+'"] textarea')].map(e=>e.value);
window.btn=(surf,which)=>document.querySelector('[data-surface="'+surf+'"] [data-block-'+which+']');
window.openCard=()=>{const b=document.querySelector('[data-block-card] [data-block-toggle][aria-expanded="false"]');if(b)b.click();return !!b};
window.hostMsgs=()=>posted.filter(p=>p.type!=='lessonFocus').length;`;
const settle = () => new Promise((r) => setTimeout(r, 60));

let checks = 0;
try {
  for (const dark of [false, true]) for (const width of [800, 1420]) {
    const tag = `${dark ? 'dark' : 'light'} ${width}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELPERS}</script></body></html>`, { width, height: 1100, dark });
    await ev(`mount(${JSON.stringify(config)})`);
    await waitFor(`document.querySelector('[data-hps-material="criterion_form"]')`, `${tag} criterion block`);
    assert.equal(await ev('openCard()'), true, `${tag}: open the card`);
    const crit = '[data-surface="criterion_form"] textarea';

    // Initial: both disabled (preset fields, no history).
    assert.deepEqual(await ev(`[btn('criterion_form','reset').disabled,btn('criterion_form','undo').disabled,btn('criterion_form','reset').textContent,btn('criterion_form','undo').textContent]`), [true, true, '처음으로', '되돌리기'], `${tag}: start disabled`);
    const before = await ev('hostMsgs()');
    // Two bursts separated by a blur.
    await ev(`typeInto(${JSON.stringify(crit)},'예약')`); await ev(`typeInto(${JSON.stringify(crit)},'예약 버튼')`); await ev('blurAll()'); await settle();
    await ev(`typeInto(${JSON.stringify(crit)},'예약 버튼이 보인다')`); await ev('blurAll()'); await settle();
    assert.deepEqual(await ev(`[btn('criterion_form','reset').disabled,btn('criterion_form','undo').disabled]`), [false, false], `${tag}: enabled after edits`);
    // Reset → preset; undo → back; undo → first burst; undo → empty; undo disabled.
    await ev(`btn('criterion_form','reset').click()`); await settle();
    assert.deepEqual(await ev(`vals('criterion_form')`), [''], `${tag}: 처음으로 restores the preset`);
    assert.equal(await ev(`btn('criterion_form','reset').disabled`), true, `${tag}: nothing more to reset`);
    await ev(`btn('criterion_form','undo').click()`); await settle();
    assert.deepEqual(await ev(`vals('criterion_form')`), ['예약 버튼이 보인다'], `${tag}: undo reverts the reset`);
    await ev(`btn('criterion_form','undo').click()`); await settle();
    assert.deepEqual(await ev(`vals('criterion_form')`), ['예약 버튼'], `${tag}: undo reverts one burst`);
    await ev(`btn('criterion_form','undo').click()`); await settle();
    assert.deepEqual(await ev(`vals('criterion_form')`), [''], `${tag}: back to the start`);
    assert.equal(await ev(`btn('criterion_form','undo').disabled`), true, `${tag}: empty history disables undo`);
    assert.equal(await ev('hostMsgs()'), before, `${tag}: reset and undo post nothing to the host`);
    checks += 8;

    // Saved work stays saved across a reset.
    await ev(`typeInto(${JSON.stringify(crit)},'저장할 기준')`); await ev('blurAll()');
    await ev(`window.postMessage({type:'lessonWorkState',sha256:${JSON.stringify(SHA)},work:{expect:{kind:'criterion',text:'저장할 기준',savedAt:5}}},'*')`);
    await waitFor(`document.querySelector('[data-saved-work="criterion"]')`, `${tag} saved line`);
    const posts = await ev('hostMsgs()');
    await ev(`btn('criterion_form','reset').click()`); await settle();
    assert.deepEqual(await ev(`[vals('criterion_form')[0], !!document.querySelector('[data-saved-work="criterion"]'), document.querySelector('.hp-material-state').dataset.materialState, hostMsgs()]`), ['', true, 'cleared', posts], `${tag}: reset empties the field, keeps the saved criterion and sends nothing`);
    checks += 1;

    // Look: quiet (not Primary), 44px, 14px, disabled reads differently.
    const look = await ev(`(()=>{const r=btn('criterion_form','reset'),u=btn('criterion_form','undo');const cs=e=>getComputedStyle(e),b=e=>e.getBoundingClientRect();
      return {cls:[r.className,u.className],h:[b(r).height,b(u).height],f:[parseFloat(cs(r).fontSize),parseFloat(cs(u).fontSize)],rd:r.disabled,ud:u.disabled,rc:cs(r).color,uc:cs(u).color,rb:cs(r).borderTopStyle,ub:cs(u).borderTopStyle,primary:document.querySelectorAll('[data-surface] .hp-cta-primary').length,scroll:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.deepEqual(look.cls, ['hp-cta-quiet', 'hp-cta-quiet'], `${tag}: quiet buttons`);
    assert.equal(look.primary, 0, `${tag}: no Primary inside the block`);
    assert.ok(look.h.every((x) => x >= 44) && look.f.every((x) => x >= 14), `${tag}: 44px / 14px ${JSON.stringify(look)}`);
    assert.equal(look.rd, true); assert.equal(look.ud, false, `${tag}: undo enabled after the reset`);
    assert.notEqual(look.rc, look.uc, `${tag}: a disabled button's colour differs from an enabled one`);
    assert.deepEqual([look.rb, look.ub], ['dashed', 'solid'], `${tag}: disabled boundary is dashed`);
    assert.equal(look.scroll, false, `${tag}: no horizontal scroll`);
    checks += 7;

    // decision_form: reset empties both fields; undo restores both.
    await ev(`document.querySelector('button[data-step-id="build"]').click()`);
    await waitFor(`document.querySelector('[data-hps-material="decision_form"]')`, `${tag} decision block`);
    await ev('openCard()');
    await ev(`typeInto('[data-surface="decision_form"] input','토요일 오후 2시')`); await ev('blurAll()'); await settle();
    await ev(`typeInto('[data-surface="decision_form"] textarea','원장님 확인')`); await ev('blurAll()'); await settle();
    await ev(`btn('decision_form','reset').click()`); await settle();
    assert.deepEqual(await ev(`vals('decision_form')`), ['', ''], `${tag}: decision reset`);
    await ev(`btn('decision_form','undo').click()`); await settle();
    assert.deepEqual(await ev(`vals('decision_form')`), ['토요일 오후 2시', '원장님 확인'], `${tag}: decision undo`);
    // History belongs to the step: back on expect, its own history is gone only for other steps (not carried across).
    await ev(`btn('decision_form','undo').click()`); await settle();
    assert.deepEqual(await ev(`vals('decision_form')`), ['토요일 오후 2시', ''], `${tag}: one burst per field change`);
    checks += 3;
  }
  console.log(`PASS learning-block-reset-undo-browser: ${checks} checks (light/dark, 800/1420 px)`);
} finally { await browser.close(); }
