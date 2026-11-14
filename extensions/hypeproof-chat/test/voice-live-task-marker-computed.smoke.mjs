// CGP-VOICE-R-030 (REQ-CGPV-43) — the task rail's "음성 대화 중" marker, computed on the real App (webview-ui/src/main.tsx) in
// headless Chromium for every bundled theme (test/lib/vscode-default-themes.mjs THEMES), plus forced colours:
// - the marker's 14px words reach 4.5:1 against the active row's composited background (the row's own text colour);
// - the icon keeps the accent, and the words do not use it (verify-3928: the accent is 3.85:1 in Dark+, 4.36:1 in 2026 Light);
// - in forced colours the words and the icon take the row button's forced system colour (ButtonText), at 4.5:1 or more;
// - no live task, no marker (control).
// The marker is lit through the window's own live-task store, the one VoiceConversationControl publishes to; the session
// behaviour itself is voice-conversation-browser's. Fails under FOCUS_REQUIRE_BROWSER=1 without a browser.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN voice live task marker: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
// The App as shipped, plus a handle on the same bundle's live-task store.
const app = await build({ stdin: { contents: `import './src/main.tsx';import {windowVoiceLiveTask} from '../src/voiceLiveTask';window.__voiceLive=windowVoiceLiveTask;`, resolveDir: dir, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', outdir: 'marker-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find((f) => f.path.endsWith('.css')).text, script = app.outputFiles.find((f) => f.path.endsWith('.js')).text;
const b = await launch(bin);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const stub = `window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});`;
const page = (vars, cls) => `<html style="${vars}"><style>${css}</style><body class="${cls}"><div id="root"></div><script>${stub}</script><script>${script}</script></body></html>`;
const workspace = { scope: 'marker-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '질문 만들기', createdAt: 1, updatedAt: 9, messageCount: 2 }, { id: 'other', title: '다른 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const BODY = { light: 'vscode-light', dark: 'vscode-dark', hcDark: 'vscode-high-contrast', hcLight: 'vscode-high-contrast-light' };
// Composite the row's background over every ancestor's, so an alpha selection colour (2026 Light) is measured as drawn.
const measure = `(()=>{const p=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const v=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}};
const lum=c=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
const m=document.querySelector('.tw-task [data-voice-live]');if(!m)return {count:0};
const layers=[];for(let n=m;n;n=n.parentElement){const c=p(getComputedStyle(n).backgroundColor);if(c&&c.a>0)layers.push(c);}
let bg={r:255,g:255,b:255};for(const c of layers.reverse()){bg={r:c.r*c.a+bg.r*(1-c.a),g:c.g*c.a+bg.g*(1-c.a),b:c.b*c.a+bg.b*(1-c.a)};}
const fg=p(getComputedStyle(m).color),icon=p(getComputedStyle(m.querySelector('svg')).color),row=p(getComputedStyle(m.closest('.tw-task')).color);
const probe=k=>{const s=document.createElement('span');s.style.color=k;document.body.append(s);const c=getComputedStyle(s).color;s.remove();return c};
const L=[lum(fg),lum(bg)].sort((x,y)=>y-x);
return {count:document.querySelectorAll('.tw-task [data-voice-live]').length,ratio:(L[0]+0.05)/(L[1]+0.05),fg:getComputedStyle(m).color,icon:getComputedStyle(m.querySelector('svg')).color,row:getComputedStyle(m.closest('.tw-task')).color,size:parseFloat(getComputedStyle(m).fontSize),buttonText:probe('ButtonText'),forced:matchMedia('(forced-colors: active)').matches,onActive:m.closest('.tw-task').getAttribute('aria-current')==='page'}})()`;

let cases = 0;
try {
  const runs = [...Object.keys(THEMES).map((name) => ({ name, forced: false })), { name: 'Dark+', forced: true }, { name: 'Light+', forced: true }];
  for (const run of runs) {
    const theme = THEMES[run.name];
    const vars = Object.entries(theme).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const tag = `${run.name}${run.forced ? ' forced' : ''}`;
    await b.load(page(vars, BODY[theme.kind] ?? 'vscode-dark'), { width: 1420, height: 900, dark: theme.kind !== 'light' && theme.kind !== 'hcLight', forcedColors: run.forced, appReady: true });
    await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace }) });
    await send({ type: 'history', messages: [] });
    assert.equal((await b.evaluate(measure)).count, 0, `${tag}: no live task, no marker (control)`);
    await b.evaluate(`window.__voiceLive.set('task')`); await settle();
    const m = await b.evaluate(measure);
    assert.equal(m.count, 1, `${tag}: one marker`); assert.equal(m.onActive, true, `${tag}: on the active row`);
    assert.ok(m.size >= 14, `${tag}: 14px floor (${m.size})`);
    if (run.forced) {
      assert.equal(m.forced, true, `${tag}: forced colours really engaged (instrument check)`);
      // The UA forces the row's <button> to its system pair (ButtonText on ButtonFace); a probe span outside a button is
      // forced to CanvasText, so the comparison is with the row's own computed colour, and the contrast is measured.
      assert.equal(m.fg, m.row, `${tag}: the words take the row's forced system colour (${JSON.stringify(m)})`);
      assert.equal(m.icon, m.row, `${tag}: the icon takes it too`);
      assert.ok(m.ratio >= 4.5, `${tag}: forced contrast ${m.ratio.toFixed(2)} >= 4.5:1`);
    } else {
      assert.equal(m.forced, false);
      assert.equal(m.fg, m.row, `${tag}: the words keep the row's own text colour (${JSON.stringify(m)})`);
      assert.ok(m.ratio >= 4.5, `${tag}: words contrast ${m.ratio.toFixed(2)} >= 4.5:1 (${JSON.stringify(m)})`);
    }
    await b.evaluate(`window.__voiceLive.set(null)`); await settle();
    assert.equal((await b.evaluate(measure)).count, 0, `${tag}: cleared, no marker`);
    cases++;
  }
  console.log(`PASS voice-live-task-marker-computed: ${cases} theme cases (${Object.keys(THEMES).join(', ')}; forced Dark+/Light+)`);
} finally { await b.close(); }
