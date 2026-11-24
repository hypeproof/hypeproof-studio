// TC-0066..TC-0070 on the learner's path: the real start page host (src/startPage.ts) talks to the
// real webview bundle in headless Chromium, on a synthetic Service. Visibility is measured in the
// page (layout, CSS, hit testing), and the choice is pressed with real mouse input.
//
// Run: node --experimental-strip-types test/trial-choice-disclosure-browser.smoke.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';

const require = createRequire(import.meta.url);
const CODE_LINE = '지금은 발급받은 체험 코드가 있어야 시작할 수 있습니다.';
const bin = findChromium();
if (!bin && process.env.FOCUS_REQUIRE_BROWSER === '1') throw new Error('Chromium required');
const browserTest = bin ? {} : { skip: 'NOT RUN: no Chromium' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser, hostCode, css, js;
before(async () => {
  if (!bin) return;
  const root = fileURLToPath(new URL('..', import.meta.url));
  const host = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
  hostCode = host.outputFiles[0].text;
  const app = await build({ entryPoints: [root + 'webview-ui/src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'start-assets', write: false, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
  css = app.outputFiles.find(f => f.path.endsWith('.css')).text;
  js = app.outputFiles.find(f => f.path.endsWith('.js')).text;
  browser = await launch(bin);
});
after(async () => { await browser?.close(); });

function pageHtml() {
  const vars = Object.entries(THEMES['Dark+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
  return `<!doctype html><html data-surface="start" style="${vars}"><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>window.__toHost=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__toHost.push(m)},getState(){},setState(){}});</script><script>${js}</script></body></html>`;
}

// `answer` is what GET /trial/offer does: { body }, { status }, { thrown: true }, and optionally { held: promise }.
async function openStartPage(answer, { width = 800 } = {}) {
  const reads = [], failures = [];
  const service = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname !== '/v1/trial/offer') return new Response('{}', { status: 404 });
    reads.push({ authorization: new Headers(init.headers).get('authorization') });
    if (answer.held) await answer.held;
    if (answer.thrown) throw new Error('service unreachable');
    return answer.body ? new Response(JSON.stringify(answer.body), { status: 200 }) : new Response('{}', { status: answer.status ?? 404 });
  };
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
  const chat = { openInEditor: async () => {}, ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const vscodeStub = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? 'https://service.test/v1' : fallback }) }, window: {}, commands: { executeCommand: async () => {} }, Uri: { parse: s => s }, env: {} };
  const hostTimer = (fn, ms, ...args) => { const t = setTimeout(fn, ms, ...args); t.unref?.(); return t; };
  const module = { exports: {} };
  vm.runInNewContext(hostCode, { module, exports: module.exports, require: id => id === 'vscode' ? vscodeStub : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch: service, Response, Headers, Date, JSON, setTimeout: hostTimer, clearTimeout });
  const host = new module.exports.StartPage(ctx, chat, async () => false);
  let live = true;
  host.panel = { webview: { postMessage: async msg => { if (live) await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`); return true; } } };
  await browser.load(pageHtml(), { width, height: 900, dark: true, appReady: 'start' });
  const pump = (async () => {
    while (live) {
      for (const msg of await browser.evaluate('window.__toHost.splice(0)')) Promise.resolve(host.handle(msg)).catch(e => failures.push(e));
      await sleep(20);
    }
  })();
  return { reads, close: async () => { live = false; await pump; assert.deepEqual(failures, [], 'the host handled every webview message'); } };
}

const SNAPSHOT = `(()=>{
  const button=[...document.querySelectorAll('button.studio-choice')].find(b=>b.textContent.replace('→','').trim()==='AI 체험하기');
  if(!button)return {button:false,codeForm:!!document.getElementById('course-code')};
  const id=button.getAttribute('aria-describedby'),note=id?document.getElementById(id):null;
  if(note)note.scrollIntoView({block:'center',behavior:'instant'});
  const lines=note?[...note.querySelectorAll('span')].map(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    const shown=el.checkVisibility({opacityProperty:true,visibilityProperty:true})&&r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth&&!!hit&&(hit===el||el.contains(hit))&&s.color!=='rgba(0, 0, 0, 0)'&&parseFloat(s.fontSize)>0;
    return {text:el.innerText.trim(),shown};
  }):[];
  return {button:true,enabled:!button.disabled,describedBy:id,noteId:note?note.id:null,codeForm:!!document.getElementById('course-code'),lines};
})()`;

// Waits until the unclicked choice is enabled and shows exactly these lines on screen.
async function expectNoteBeforeChoice(expected, label) {
  const want = { button: true, enabled: true, describedBy: 'trial-entry-note', noteId: 'trial-entry-note', codeForm: false, lines: expected.map(text => ({ text, shown: true })) };
  let seen;
  for (const end = Date.now() + 8000; Date.now() < end; await sleep(25)) {
    seen = await browser.evaluate(SNAPSHOT);
    if (JSON.stringify(seen) === JSON.stringify(want)) return;
  }
  assert.deepEqual(seen, want, label);
}

async function pressButton(name) {
  const box = await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace('→','').trim()===${JSON.stringify(name)});if(!b)return null;b.scrollIntoView({block:'center',behavior:'instant'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  assert.ok(box, `${name} is on screen`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

async function waitForCodeForm(open) {
  for (const end = Date.now() + 5000; Date.now() < end; await sleep(20)) {
    if (await browser.evaluate(`!!document.getElementById('course-code')`) === open) return;
  }
  assert.fail(open ? 'the code form opens' : 'the code form closes');
}

async function expectAnswerShows(answer, expected, label, options) {
  const page = await openStartPage(answer, options);
  try {
    await expectNoteBeforeChoice(expected, label);
    assert.equal(page.reads.length, 1, `${label}: one read`);
    assert.equal(page.reads[0].authorization, null, `${label}: no credential`);
  } finally { await page.close(); }
}

test('test_tc_0066_code_line_on_screen_without_allowance_when_no_numbers_are_offered', browserTest, async () => {
  await expectAnswerShows({ status: 404 }, [CODE_LINE], 'no offer');
  await expectAnswerShows({ body: { entry: 'open' } }, [CODE_LINE], 'open entry without numbers');
});

test('test_tc_0067_advertised_allowance_on_screen_before_choice', browserTest, async () => {
  await expectAnswerShows({ body: { entry: 'code', duration_hours: 48, request_limit: 50 } }, [CODE_LINE, '체험 2일 · AI 요청 50번'], '48 h, 50 requests');
  for (const width of [320, 800, 1420]) {
    await expectAnswerShows({ body: { entry: 'code', duration_hours: 1.5, request_limit: 1000 } }, [CODE_LINE, '체험 1시간 30분 · AI 요청 1,000번'], `1.5 h, 1000 requests at ${width}px`, { width });
  }
});

test('test_tc_0068_partial_or_zero_allowance_is_omitted_on_screen', browserTest, async () => {
  await expectAnswerShows({ body: { entry: 'code', duration_hours: 48 } }, [CODE_LINE], 'duration only');
  await expectAnswerShows({ body: { entry: 'code', duration_hours: 48, request_limit: 0 } }, [CODE_LINE], 'zero requests');
});

test('test_tc_0069_late_offer_note_is_visible_before_click_and_after_returning', browserTest, async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const page = await openStartPage({ held, body: { entry: 'code', duration_hours: 48, request_limit: 50 } });
  try {
    // The host stops waiting after 1.5 s and paints: the code line is readable while the offer is still out.
    await expectNoteBeforeChoice([CODE_LINE], 'before the late offer');
    await sleep(100);
    assert.equal(page.reads.length, 1, 'a slow Service is read once');
    release();
    await expectNoteBeforeChoice([CODE_LINE, '체험 2일 · AI 요청 50번'], 'after the late offer, still unclicked');
    assert.equal(page.reads.length, 1, 'the late answer does not trigger another read');

    await pressButton('AI 체험하기');
    await waitForCodeForm(true);
    await pressButton('시작 방법 다시 선택');
    await waitForCodeForm(false);
    await expectNoteBeforeChoice([CODE_LINE, '체험 2일 · AI 요청 50번'], 'after returning to the choice');
  } finally { release(); await page.close(); }
});

test('test_tc_0070_failed_read_shows_code_line_only_without_authorization', browserTest, async () => {
  await expectAnswerShows({ status: 500 }, [CODE_LINE], 'HTTP 500');
  await expectAnswerShows({ thrown: true }, [CODE_LINE], 'unreachable Service');
});
