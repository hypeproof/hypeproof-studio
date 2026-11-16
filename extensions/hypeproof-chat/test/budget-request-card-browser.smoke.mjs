// CGP-SHELL-R-030 (Jay, 2026-11-16) — the request-more card in the real ChatPanel, shipped stylesheet, headless Chromium:
// - allowance run out (state exhausted): the status screen that replaces the composer carries the card under the cause;
// - too low to send (5% left): the card sits above the composer, which stays usable;
// - 요청하기 is at least 48px high; it opens three reason rows of at least 44px with no text field on a minor seat; 보내기 posts
//   {type:'requestBudget', reason} to the host and nothing else; every word of the card is at least 14px (title 16px);
// - no horizontal scroll at 320 and 800 px, light and dark, and under forced colours; the card's text passes the SX audit and
//   shows no meter figure.
// Fails under FOCUS_REQUIRE_BROWSER=1 without a browser; prints NOT RUN otherwise.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { auditRegionText } from './sx-audit.mjs';

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

const REASONS = [{ id: 'finish_work', label: '하던 작업을 마무리하고 싶어요' }, { id: 'fix_problem', label: '문제를 고치는 중이에요' }, { id: 'check_again', label: '결과를 한 번 더 확인하고 싶어요' }];
const access = (over) => ({ status: 'ready', selected: 'class-1', view: { schema: 'hps-access-view/1', configured: true, as_of: '2026-11-16T00:00:00Z', choices: [{ id: 'class-1', label: '수업', source_kind: 'cohort', mode: 'included', active: true, available: true, state: 'ready', ends_at: 1893456000000, can_request: true, allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [{ meter: 'currency:USD:micro', limit: 1000000, remaining: 50000, held: 0, spent: 950000, unresolved: 0, overrun: 0, shared: true }], request_policy: { reasons: REASONS, note: false, note_max: 200, cooldown_until: null }, ...over }] } });
const seat = (over) => { const base = chatConfig(3); return { ...base, profile: { ...base.profile, minor_cohort: true }, access: access(over) }; };

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN: budget-request-card browser unavailable'); process.exit(0); }
const browser = await launch(bin);
const ev = (e) => browser.evaluate(e);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const HELP = `window.card=()=>document.querySelector('[data-request-card]');
window.look=()=>{const c=card();if(!c)return null;const r=(e)=>e.getBoundingClientRect();
  const words=[...c.querySelectorAll('h3,p,label,button,legend,small')].filter(e=>e.textContent.trim()&&getComputedStyle(e).display!=='none');
  return {inStatus:!!c.closest('[data-testid="activity-status"]'),composerHidden:!!document.querySelector('.hps-input[hidden]'),
    text:c.innerText,open:c.querySelector('[data-request-open]')?r(c.querySelector('[data-request-open]')).height:null,
    rows:[...c.querySelectorAll('.hps-budget-request-reasons label')].map(e=>r(e).height),texts:c.querySelectorAll('input:not([type="radio"])').length,
    fonts:words.map(e=>[e.tagName,parseFloat(getComputedStyle(e).fontSize)]),title:parseFloat(getComputedStyle(c.querySelector('h3')).fontSize),
    outside:[...c.querySelectorAll('*')].filter(e=>r(e).width>0&&(r(e).right>r(c).right+0.5||r(e).left<r(c).left-0.5)).map(e=>e.tagName+'.'+e.className+' '+Math.round(r(e).left)+'..'+Math.round(r(e).right)+' of '+Math.round(r(c).left)+'..'+Math.round(r(c).right)),scroll:document.documentElement.scrollWidth>innerWidth,sw:document.documentElement.scrollWidth}};`;

let checks = 0;
try {
  for (const run of [{ dark: false, width: 320 }, { dark: true, width: 320 }, { dark: false, width: 800 }, { dark: true, width: 800 }, { dark: false, width: 320, forced: true }]) {
    const vars = Object.entries(THEMES[run.dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    for (const exhausted of [true, false]) {
      const tag = `${run.dark ? 'dark' : 'light'} ${run.width}${run.forced ? ' forced' : ''} ${exhausted ? 'exhausted' : 'low'}`;
      await browser.load(`<html lang="ko" style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${run.dark ? 'vscode-dark' : 'vscode-light'}" style="margin:0"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script><script>${HELP}</script></body></html>`, { width: run.width, height: 1000, dark: run.dark, forcedColors: !!run.forced });
      await ev(`mount(${JSON.stringify(seat(exhausted ? { state: 'exhausted', available: false } : {}))})`); await settle(200);
      let m = await ev('look()');
      assert.ok(m, `${tag}: the card draws`);
      assert.equal(m.inStatus, exhausted, `${tag}: ${exhausted ? 'inside the status screen' : 'above the composer, not a status screen'}`);
      assert.equal(m.composerHidden, exhausted, `${tag}: the composer is ${exhausted ? 'replaced' : 'kept'}`);
      assert.ok(m.open >= 47.5, `${tag}: 요청하기 is ${m.open}px high`);
      const before = await ev('posted.filter(m=>m.type==="requestBudget").length');
      await ev(`card().querySelector('[data-request-open]').click()`); await settle();
      m = await ev('look()');
      assert.equal(m.rows.length, 3, `${tag}: three reasons`); assert.ok(m.rows.every((h) => h >= 43.5), `${tag}: 44px reason rows ${m.rows}`);
      assert.equal(m.texts, 0, `${tag}: no text field on a minor seat`);
      assert.ok(m.fonts.every(([, px]) => px >= 14) && m.title >= 16, `${tag}: 14px words, 16px title ${JSON.stringify(m.fonts)}`);
      assert.ok(!m.outside.length && !m.scroll, `${tag}: inside its card, no horizontal scroll ${JSON.stringify({outside:m.outside,sw:m.sw})}`);
      assert.ok(!/토큰|정산|USD|micro|\d+\s*남음/.test(m.text), `${tag}: no meter figure`);
      assert.deepEqual(auditRegionText(m.text).findings, [], `${tag}: SX audit`);
      await ev(`card().querySelectorAll('.hps-budget-request-reasons input')[1].click()`); await settle();
      await ev(`[...card().querySelectorAll('button')].find(b=>b.textContent==='보내기').click()`); await settle();
      const sent = await ev('posted.filter(m=>m.type==="requestBudget")');
      assert.equal(sent.length, before + 1); assert.deepEqual(sent.at(-1), { type: 'requestBudget', reason: 'fix_problem' }, `${tag}: only the reason id is posted`);
      checks += 12;
    }
  }
  console.log(`PASS budget-request-card-browser: ${checks} checks (exhausted and low; light/dark at 320 and 800 px; forced colours)`);
} finally { await browser.close(); }
