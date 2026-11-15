// CGP-VOICE-R-019 / D-015 (DES-CGPV-23): the 마이크 row in the chat's settings dialog, in the real App bundle in
// headless Chromium (CDP, no window, no microphone hardware: getUserMedia hands out a real AudioContext stream).
//   node --experimental-strip-types test/mic-input-browser.smoke.mjs   (FOCUS_REQUIRE_BROWSER=1 fails without a browser)
// - a personal seat (설정) and a lesson seat (the access chip), Dark+ and Light+, 320 / 480 / 800 px: the select is
//   44px with 14px text inside the dialog, the hint is 14px, 마이크 시험 is 44px, no sideways scroll;
// - opening the dialog lists the microphones and never calls getUserMedia; a pick posts one setMicInput with the
//   device's id and label;
// - 마이크 시험 opens one stream, draws the level bar (none under reduced motion), and 시험 멈추기 stops every track;
//   left alone it ends by itself after 5 s with 소리가 들려요 for a real tone;
// - an unserved seat draws no row; HC Dark / HC Light and forced colours keep a visible edge and readable ink.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES, KIND_CLASS } from './lib/vscode-default-themes.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN mic input browser smoke: no Chromium'); process.exit(0); }
const built = await build({ entryPoints: ['webview-ui/src/main.tsx'], bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = built.outputFiles.find((f) => f.path.endsWith('.css')).text, js = built.outputFiles.find((f) => f.path.endsWith('.js')).text;
const browser = await launch(bin);
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const stubs = `window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.error&&e.error.stack||e.message)));const __ce=console.error;console.error=(...a)=>{window.__errors.push(a.map(String).join(' ').slice(0,600));__ce(...a)};window.__ctxStates=[];{const C=window.AudioContext;window.AudioContext=class extends C{constructor(...a){super(...a);window.__ctxStates.push(this.state);}};}window.messages=[];window.__media=0;window.__stopped=0;window.__enumerated=0;
if(!crypto.randomUUID)crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(Math.floor(Math.random()*1e12)).padStart(12,'0');
window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){},setState(){}});
if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});
navigator.mediaDevices.enumerateDevices=async()=>{window.__enumerated++;return [
 {kind:'audioinput',deviceId:'default',label:'기본값 - USB 헤드셋'},{kind:'audioinput',deviceId:'${A}',label:'USB 헤드셋'},
 {kind:'audioinput',deviceId:'${B}',label:'내장 마이크'},{kind:'videoinput',deviceId:'${'c'.repeat(64)}',label:'카메라'}];};
navigator.mediaDevices.getUserMedia=async()=>{window.__media++;const ctx=new AudioContext();const osc=ctx.createOscillator();const dest=ctx.createMediaStreamDestination();osc.connect(dest);osc.start();
 const s=dest.stream;for(const t of s.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{window.__stopped++;stop();};}return s;};
Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:'granted'})}});`;
const page = (theme) => {
  const vars = Object.entries(theme).filter(([k, v]) => !['kind', 'file'].includes(k) && v !== null).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
  return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>${stubs}</script><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
};
const V1 = 'hps-voice-policy/1';
const VOICE = { dictation: true, read_aloud: true, policy_version: V1, engine: { dictation: 'hosted', read_aloud: 'device' } };
const resource = { meter: 'requests:count', remaining: 37, held: 3, unresolved: 2, spent: 10, limit: 50, overrun: 0, shared: false };
const access = { status: 'ready', selected: 'c1', view: { schema: 'hps-access-view/1', configured: true, as_of: '2026-11-15T00:00:00Z', choices: [{ id: 'c1', label: '수업', source_kind: 'cohort', mode: 'included', active: true, available: true, state: 'ready', ends_at: 1, can_request: false, allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [resource] }] } };
// A lesson seat: its settings dialog is reached from the access chip (lesson-tips-off.smoke.mjs uses the same fixture).
const lesson = { course_id: 'globalbuddy', version: 'm1', sha256: 'f'.repeat(64), content: JSON.parse(readFileSync('test/fixtures/session-design/week-3.json', 'utf8')) };
const configFor = (seat, voice) => ({
  hasToken: true, coach: { name: '코치', configured: true }, textSize: 'base',
  activity: { id: 'a1', name: '작업', kind: seat, workspace: '/synthetic', verified: true },
  taskWorkspace: seat === 'personal' ? { scope: 's', revision: 1, tasks: [], sourceSelection: null } : undefined,
  ...(seat === 'classroom' ? { access } : {}),
  profile: { profile_id: 'synthetic', activity_kind: seat, lesson: seat === 'classroom' ? lesson : null, welcome: { greeting_md: '' }, ...(voice ? { voice } : {}),
    ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } } },
});
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const send = async (msg) => { await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`); await wait(); };
const ev = (src) => browser.evaluate(src);
/** A real pointer click through CDP: it gives the page user activation, as a learner's press does (audio may start). */
const pressReal = async (selector) => {
  const at = await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await wait();
};
const open = async ({ seat, theme = THEMES['Dark+'], width = 800, forced = false, reduced = false, voice = VOICE }) => {
  await browser.send('Page.navigate', { url: 'about:blank' });
  await browser.load(page(theme), { width, height: 900, dark: theme.kind !== 'light' && theme.kind !== 'hcLight', forcedColors: forced, appReady: true });
  if (reduced) await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'forced-colors', value: forced ? 'active' : 'none' }] });
  await send({ type: 'config', config: configFor(seat, voice) });
  await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
  assert.equal(await ev(`window.__media`), 0, `${seat}: no microphone before the dialog`);
  assert.equal(await ev(`!!document.querySelector('.hps-mic-setting')`), false, `${seat}: no row while the dialog is closed`);
  if (seat === 'personal') {
    // The personal chat menu's 설정 item opens 대화 설정 (memory-settings-browser.smoke.mjs does the same).
    await ev(`document.querySelector('.tw-chat-menu button[aria-haspopup]').click()`); await wait(200);
    assert.ok(await ev(`[...document.querySelectorAll('button[role=menuitem]')].some(x=>x.textContent.trim()==='설정')`), `${seat}: the menu has 설정`);
    await ev(`[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정').click()`); await wait(300);
  } else {
    assert.ok(await ev(`!!document.querySelector('.hps-access-chip')`), `${seat}: the access chip is drawn (errors: ${await ev(`JSON.stringify(window.__errors.slice(0,4))`)})`);
    await ev(`document.querySelector('.hps-access-chip').click()`); await wait(200);
  }
};
const row = () => ev(`(()=>{const f=document.querySelector('.hps-mic-setting');if(!f)return null;const s=f.querySelector('select'),t=f.querySelector('.hps-mic-test'),h=document.getElementById(s.getAttribute('aria-describedby')),d=f.closest('dialog')||f.parentElement;
 const box=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,r:r.right,w:r.width,h:r.height,fs:parseFloat(c.fontSize),edge:parseFloat(c.borderTopWidth)>=1&&c.borderTopStyle!=='none'}};
 return {name:document.getElementById(s.getAttribute('aria-labelledby'))?.textContent,options:[...s.options].map(o=>o.textContent),value:s.value,select:box(s),test:box(t),hint:box(h),hintText:h.textContent,dialog:box(d),
  scrollX:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
const lum = `const rgb=c=>c.match(/[\\d.]+/g).map(Number).slice(0,3);const L=c=>{const v=rgb(c).map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};const bg=e=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c;}return 'rgb(255,255,255)'};`;
let cases = 0;
try {
  // 1. Geometry and listing, both seats, both themes, three widths.
  for (const seat of ['personal', 'classroom']) for (const themeName of ['Dark+', 'Light+']) for (const width of [320, 480, 800]) {
    const tag = `${seat} ${themeName} ${width}px`;
    await open({ seat, theme: THEMES[themeName], width });
    const r = await row();
    assert.ok(r, `${tag}: the 마이크 row is in the dialog`);
    assert.equal(r.name, '마이크', `${tag}: the select is named 마이크`);
    assert.deepEqual(r.options, ['시스템 기본값', 'USB 헤드셋', '내장 마이크'], `${tag}: default first, pseudo-entries and the camera dropped`);
    assert.equal(r.value, '', `${tag}: the system default`);
    assert.ok(r.select.h >= 43.5 && r.select.fs >= 13.99, `${tag}: select ${r.select.h}px / ${r.select.fs}px`);
    assert.ok(r.test.h >= 43.5 && r.test.w >= 43.5 && r.test.fs >= 13.99, `${tag}: 마이크 시험 ${r.test.w}x${r.test.h} / ${r.test.fs}px`);
    assert.ok(r.hint.fs >= 13.99, `${tag}: hint ${r.hint.fs}px`);
    assert.ok(r.select.x >= r.dialog.x - 0.5 && r.select.r <= r.dialog.r + 0.5, `${tag}: the select stays inside the dialog (${r.select.x}..${r.select.r} of ${r.dialog.x}..${r.dialog.r})`);
    assert.ok(!r.scrollX, `${tag}: no sideways scroll`);
    assert.ok(await ev(`window.__enumerated`) >= 1, `${tag}: listed`);
    assert.equal(await ev(`window.__media`), 0, `${tag}: opening the row never opens the microphone`);
    if (width === 320) {
      await ev(`(()=>{const s=document.querySelector('.hps-mic-setting select');s.value='${A}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await wait();
      const writes = (await ev(`JSON.stringify(messages.filter(m=>m.type==='setMicInput'))`));
      assert.deepEqual(JSON.parse(writes).map((m) => m.choice), [{ id: A, label: 'USB 헤드셋' }], `${tag}: one write, id and label only`);
      // 마이크 시험, stopped early: one stream, the bar, every track stopped.
      await ev(`document.querySelector('.hps-mic-test').click()`); await wait(500);
      assert.equal(await ev(`window.__media`), 1, `${tag}: one stream for the test`);
      const live = await ev(`(()=>{const b=document.querySelector('.hps-mic-setting .hps-voice-level');return {bar:!!b,hidden:b?.getAttribute('aria-hidden'),pressed:document.querySelector('.hps-mic-test').getAttribute('aria-pressed'),text:document.querySelector('.hps-mic-test').textContent,status:document.querySelector('.hps-mic-test-result').textContent}})()`);
      assert.deepEqual(live, { bar: true, hidden: 'true', pressed: 'true', text: '시험 멈추기', status: '말해 보세요. 5초 동안 들어요.' }, `${tag}: listening`);
      await ev(`document.querySelector('.hps-mic-test').click()`); await wait();
      assert.ok(await ev(`window.__stopped`) >= 1, `${tag}: 시험 멈추기 stops the tracks`);
      assert.equal(await ev(`!!document.querySelector('.hps-mic-setting .hps-voice-level')`), false, `${tag}: no bar after`);
      assert.equal(await ev(`messages.filter(m=>/^voice/.test(m.type)&&m.type!=='voiceDisclosureRead').length`), 0, `${tag}: nothing voice sent`);
    }
    cases++;
  }

  // 2. Left alone, the test ends by itself after 5 s and hears the tone; the dialog closing mid-test closes it too.
  await open({ seat: 'personal' });
  await pressReal('.hps-mic-test'); await wait(5600);
  const heard = await ev(`[document.querySelector('.hps-mic-test-result').textContent, window.__ctxStates.join(',')].join(' | ')`);
  assert.equal(heard.split(' | ')[0], '소리가 들려요.', `a real tone is heard (${heard})`);
  assert.equal(await ev(`[window.__media, window.__stopped >= 1, document.querySelector('.hps-mic-test').textContent].join('|')`), '1|true|마이크 시험', 'ended by itself, tracks stopped');
  await ev(`document.querySelector('.hps-mic-test').click()`); await wait(400);
  const before = await ev(`window.__stopped`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await wait(300);
  if (await ev(`!!document.querySelector('.hps-mic-setting')`)) await ev(`document.querySelector('dialog[open] .hps-preferences-close, dialog[open] button[aria-label="대화 설정 닫기"]')?.click()`); await wait(300);
  assert.equal(await ev(`!!document.querySelector('.hps-mic-setting')`), false, 'the dialog closed');
  assert.ok(await ev(`window.__stopped`) > before, 'closing the dialog mid-test stops the tracks');
  cases++;

  // 3. Reduced motion: the words, no bar.
  await open({ seat: 'personal', reduced: true });
  await ev(`document.querySelector('.hps-mic-test').click()`); await wait(500);
  assert.equal(await ev(`[!!document.querySelector('.hps-mic-setting .hps-voice-level'), document.querySelector('.hps-mic-test-result').textContent].join('|')`), 'false|말해 보세요. 5초 동안 들어요.', 'reduced motion: no bar, the words');
  await ev(`document.querySelector('.hps-mic-test').click()`); await wait();
  cases++;

  // 4. Unserved: the dialog opens without the row and lists nothing.
  for (const seat of ['personal', 'classroom']) {
    await open({ seat, voice: null });
    assert.equal(await ev(`[!!document.querySelector('dialog[open]'), !!document.querySelector('.hps-mic-setting'), window.__enumerated].join('|')`), 'true|false|0', `${seat} unserved: dialog open, no row, no listing`);
    cases++;
  }

  // 5. High contrast and forced colours: a visible edge and readable ink on the select, the button and the hint.
  for (const [themeName, forced] of [['HC Dark', false], ['HC Light', false], ['Dark+', true], ['Light+', true]]) {
    const tag = `${themeName}${forced ? ' forced' : ''}`;
    await open({ seat: 'personal', theme: THEMES[themeName], forced });
    const r = await row();
    assert.ok(r.select.edge && r.test.edge, `${tag}: visible edges ${JSON.stringify([r.select.edge, r.test.edge])}`);
    const ink = await ev(`(()=>{${lum}const f=document.querySelector('.hps-mic-setting');const t=f.querySelector('.hps-mic-test'),h=f.querySelector('.hps-mic-hint');return {test:ratio(getComputedStyle(t).color,bg(t)),hint:ratio(getComputedStyle(h).color,bg(h))}})()`);
    assert.ok(ink.test >= 4.5 && ink.hint >= 4.5, `${tag}: ink ${JSON.stringify(ink)}`);
    cases++;
  }
  console.log(`PASS mic-input browser smoke: ${cases} cases`);
} finally { await browser.close(); }
