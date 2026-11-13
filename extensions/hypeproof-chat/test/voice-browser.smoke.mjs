// Studio voice in the real App bundle, in headless Chromium (CDP, no window, no microphone hardware):
//   - a seat with no voice block draws nothing voice (and the composer has no addon marker)
//   - with a voice block the mic button and read-aloud button are on screen at 320 / 480 / 800 px in
//     both seats and both themes: 44px targets, 14px text, inside the viewport, no overlap, no sideways scroll
//   - the status and recovery cards (recording, permission denied, class off, the disclosure sheet) stay
//     inside the viewport and clear of the composer at 320 and 480
//   - a real MediaRecorder clip goes to the host as WebM/Opus, base64, under 2 MiB, and the transcript the
//     host answers lands in the composer without a send
//   - the read-aloud control (CGP-CHAT-D-009, CGP-CHAT-D67) at 320 px in both seats and themes: 읽어 주기 with
//     the speaker glyph; pressed, it is aria-pressed, says 그만 읽기, draws the level glyph and a fill; the
//     glyph never animates (no-preference, OS reduced motion, data-reduced-motion); the second answer takes
//     over and one control is pressed at a time; forced colours keep the pressed state
// Run: node --experimental-strip-types test/voice-browser.smoke.mjs   (FOCUS_REQUIRE_BROWSER=1 fails without a browser)
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN voice browser smoke: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'voice-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.VOICE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
// `mic`: 'ok' hands out a real stream from an AudioContext, 'denied' rejects like a refused permission.
const host = (mic) => `window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}
window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});
window.__mic=${JSON.stringify(mic)};window.__media=0;
// A synthesizer that records and never finishes on its own, so a reading stays on until it is stopped. No voices:
// the App then speaks with the default voice (a plain object is not a SpeechSynthesisVoice).
window.__spoken=[];window.__cancels=0;
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:u=>window.__spoken.push(u.text),cancel:()=>{window.__cancels++;},getVoices:()=>[]}});
// The VS Code webview is a secure context and has mediaDevices; a page loaded into about:blank may not.
if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});
navigator.mediaDevices.getUserMedia=async()=>{window.__media++;if(window.__mic==='denied'){const e=new Error('denied');e.name='NotAllowedError';throw e;}
 const ctx=new AudioContext();const osc=ctx.createOscillator();const dest=ctx.createMediaStreamDestination();osc.connect(dest);osc.start();return dest.stream;};`;
const page = (vars, dark, mic) => `<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${host(mic)}</script><script>${script}</script></body></html>`;
const MODS = { altKey: 1, ctrlKey: 2, metaKey: 4, shiftKey: 8 };
const press = async (focus, { key, code, vk, ...mods }) => {
  if (focus) await b.evaluate(`(${focus}).focus()`);
  const modifiers = Object.entries(mods).reduce((sum, [name, on]) => sum + (on ? MODS[name] : 0), 0);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await settle();
};
const click = async (selector) => { await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const clickText = async (text) => { const hit = await b.evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`); assert.ok(hit, `button ${text} not found`); await settle(); };
const composer = `document.querySelector('.hps-input textarea')`;
const V1 = 'hps-voice-policy/1';
const VOICE = { dictation: true, read_aloud: true, policy_version: V1, engine: { dictation: 'hosted', read_aloud: 'device' } };
const workspace = { scope: 'voice-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const configFor = (seat, voice) => chatConfig(3, {
  activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null, ...(voice ? { voice } : {}) },
  taskWorkspace: seat === 'personal' ? workspace : undefined, access: seat === 'classroom' ? { status: 'unavailable' } : undefined,
});
const MESSAGES = [{ id: 'u1', role: 'user', content: '안녕', createdAt: 1 }, { id: 'm1', role: 'assistant', content: '안녕하세요. 무엇을 만들어 볼까요?', createdAt: 2 }];
const TWO_ANSWERS = [...MESSAGES, { id: 'u2', role: 'user', content: '또 알려 줘', createdAt: 3 }, { id: 'm2', role: 'assistant', content: '두 번째 답이에요.', createdAt: 4 }];
/** Every read-aloud button: state, words, glyph, and computed box and paint (font-independent reads only). */
const listenState = () => b.evaluate(`[...document.querySelectorAll('.hps-voice-listen')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),svg=el.querySelector('svg[data-icon]');
return {pressed:el.getAttribute('aria-pressed'),label:el.getAttribute('aria-label'),text:el.textContent.trim(),icon:svg&&svg.getAttribute('data-icon'),w:r.width,h:r.height,fs:parseFloat(s.fontSize),bg:s.backgroundColor,ink:s.color}})`);
/** The pressed control's glyph: computed animation names of the svg and every shape, and anything running on it. */
const glyphMotion = () => b.evaluate(`(()=>{const svg=document.querySelector('.hps-voice-listen[aria-pressed="true"] svg[data-icon="level"]');if(!svg)return null;
return {names:[svg,...svg.querySelectorAll('*')].map(n=>getComputedStyle(n).animationName),running:svg.getAnimations({subtree:true}).length}})()`);
/** The page's emulated media: the theme's colour scheme, no forced colours, motion allowed, unless overridden. */
const media = (dark, overrides = {}) => b.send('Emulation.setEmulatedMedia', { features: Object.entries({ 'forced-colors': 'none', 'prefers-color-scheme': dark ? 'dark' : 'light', 'prefers-reduced-motion': 'no-preference', ...overrides }).map(([name, value]) => ({ name, value })) });

/** Geometry of the voice surfaces: every number is read from the computed layout. */
const measure = (selectors) => b.evaluate(`(()=>{const out={vw:innerWidth,vh:innerHeight,scrollX:document.documentElement.scrollWidth>document.documentElement.clientWidth,items:{}};
for(const [name,sel] of Object.entries(${JSON.stringify(selectors)})){const el=document.querySelector(sel);if(!el){out.items[name]=null;continue;}const r=el.getBoundingClientRect(),s=getComputedStyle(el);out.items[name]={x:r.x,y:r.y,w:r.width,h:r.height,r:r.right,b:r.bottom,fs:parseFloat(s.fontSize),disabled:!!el.disabled};}return out})()`);
const overlap = (a, c) => a && c && a.x < c.r - 0.5 && c.x < a.r - 0.5 && a.y < c.b - 0.5 && c.y < a.b - 0.5;
const inside = (a, vw) => a.x >= -0.5 && a.r <= vw + 0.5;
const themeVars = (dark) => Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
let states = 0;
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 480, 800]) {
    const label = `${seat} ${dark ? 'dark' : 'light'} ${width}px`;
    // A fresh window per load: setDocumentContent keeps the old window, and with it the old App's window listeners.
    let nav = 0;
    const load = async (mic = 'ok', height = 700) => { await b.send('Page.navigate', { url: `data:text/html,<p>voice-${++nav}</p>` }); await settle(120); await b.load(page(themeVars(dark), dark, mic), { width, height, dark }); };

    // 1. No voice block: nothing voice is drawn, and the composer is unmarked.
    await load();
    await send({ type: 'config', config: configFor(seat) }); await send({ type: 'history', messages: MESSAGES });
    assert.equal(await b.evaluate(`document.querySelectorAll('[class*="hps-voice"]').length`), 0, `${label}: no voice element without a voice block`);
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-input[data-addon]')`), false, `${label}: composer unmarked`);
    assert.ok(await b.evaluate(`!!document.querySelector('[data-message-id="m1"]')`), `${label}: the answer rendered, so the absence above is not vacuous`);
    assert.equal(await b.evaluate(`window.__posts.filter(m=>/^voice/.test(m.type)).length`), 0, `${label}: no voice message to the host`);

    // 2. Served: the controls are on screen and clear of each other.
    await send({ type: 'config', config: configFor(seat, VOICE) });
    await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
    const sel = { mic: '.hps-voice-mic', send: '.hps-btn-send', input: '.hps-input textarea', listen: '.hps-voice-listen', card: '.hps-input-area' };
    let m = await measure(sel);
    assert.ok(m.items.mic, `${label}: mic button is mounted`); assert.ok(m.items.listen, `${label}: read-aloud button is mounted`);
    assert.ok(m.items.mic.w >= 43.5 && m.items.mic.h >= 43.5, `${label}: mic target ${m.items.mic.w}x${m.items.mic.h}`);
    assert.ok(m.items.listen.h >= 43.5 && m.items.listen.fs >= 13.99, `${label}: read-aloud target ${m.items.listen.h}px / ${m.items.listen.fs}px text`);
    for (const k of ['mic', 'send', 'listen']) assert.ok(inside(m.items[k], m.vw), `${label}: ${k} inside the viewport (${m.items[k].x}..${m.items[k].r} of ${m.vw})`);
    assert.ok(!overlap(m.items.mic, m.items.send), `${label}: mic and send do not overlap`);
    assert.ok(!overlap(m.items.mic, m.items.input), `${label}: mic and text box do not overlap`);
    assert.ok(!m.scrollX, `${label}: no sideways scroll`);
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-input[data-addon]')`), true, `${label}: composer marked`);
    states++;

    // 2b. The read-aloud control (CGP-CHAT-D-009, CGP-CHAT-D67), two answers, at the narrowest width.
    if (width === 320) {
      await load();
      await send({ type: 'config', config: configFor(seat, VOICE) }); await send({ type: 'history', messages: TWO_ANSWERS });
      await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
      const words = (list) => list.map((x) => [x.pressed, x.label, x.text, x.icon].join('|'));
      const IDLE = 'false|읽어 주기|읽어 주기|speaker', PLAYING = 'true|그만 읽기|그만 읽기|level';
      let st = await listenState();
      assert.deepEqual(words(st), [IDLE, IDLE], `${label}: one idle 읽어 주기 control per answer, speaker glyph`);
      const idle = st[0];
      await b.evaluate(`document.querySelectorAll('.hps-voice-listen')[0].click()`); await settle();
      assert.deepEqual(await b.evaluate(`window.__spoken`), ['안녕하세요. 무엇을 만들어 볼까요?'], `${label}: the first answer is spoken (the stub is in place)`);
      st = await listenState();
      assert.deepEqual(words(st), [PLAYING, IDLE], `${label}: pressed, 그만 읽기, the level glyph`);
      assert.notEqual(st[0].bg, idle.bg, `${label}: the pressed control has a fill (${st[0].bg} vs ${idle.bg})`);
      assert.ok(st[0].h >= 43.5 && st[0].w >= 43.5 && st[0].fs >= 13.99, `${label}: pressed control ${st[0].w}x${st[0].h}, ${st[0].fs}px text`);
      // The indicator is still: no animation on the glyph or its shapes, and nothing running on it, in every motion mode.
      for (const [mode, apply] of [
        ['motion allowed', () => media(dark)],
        ['OS reduced motion', () => media(dark, { 'prefers-reduced-motion': 'reduce' })],
        ['workbench.reduceMotion on', async () => { await media(dark); await b.evaluate(`document.documentElement.setAttribute('data-reduced-motion','true')`); }],
      ]) {
        await apply(); await settle();
        const motion = await glyphMotion();
        assert.ok(motion, `${label} ${mode}: the level glyph is drawn`);
        assert.ok(motion.names.length >= 2 && motion.names.every((n) => n === 'none'), `${label} ${mode}: the glyph is not animated (${motion.names.join(',')})`);
        assert.equal(motion.running, 0, `${label} ${mode}: nothing runs on the glyph`);
      }
      await b.evaluate(`document.documentElement.removeAttribute('data-reduced-motion')`); await media(dark);
      // Forced colours: the pressed state survives as the system selection pair.
      await media(dark, { 'forced-colors': 'active' }); await settle();
      const forced = await listenState();
      assert.notEqual(forced[0].bg, forced[1].bg, `${label} forced colours: pressed and idle differ (${forced[0].bg} vs ${forced[1].bg})`);
      await media(dark); await settle();
      // One at a time: the second answer takes over and releases the first.
      const cancels = await b.evaluate(`window.__cancels`);
      await b.evaluate(`document.querySelectorAll('.hps-voice-listen')[1].click()`); await settle();
      st = await listenState();
      assert.deepEqual(words(st), [IDLE, PLAYING], `${label}: the second answer takes over, the first is released`);
      assert.equal(st.filter((x) => x.pressed === 'true').length, 1, `${label}: one control pressed at a time`);
      assert.ok((await b.evaluate(`window.__cancels`)) > cancels, `${label}: the first reading was cancelled`);
      assert.equal(await b.evaluate(`window.__spoken.at(-1)`), '두 번째 답이에요.', `${label}: the second answer is spoken`);
      await shot(`${label.replaceAll(' ', '-')}-read-aloud`);
      await b.evaluate(`document.querySelectorAll('.hps-voice-listen')[1].click()`); await settle();
      assert.deepEqual(words(await listenState()), [IDLE, IDLE], `${label}: the pressed control stops its own reading`);
      assert.equal(await b.evaluate(`window.__posts.filter(m=>/^voice/.test(m.type)&&m.type!=='voiceDisclosureRead').length`), 0, `${label}: read-aloud sends the host nothing`);
      states++;
    }

    // 3. Recovery cards: permission denied, recording, recovered text, at the narrow widths.
    if (width <= 480) {
      await load('denied');
      await send({ type: 'config', config: configFor(seat, VOICE) }); await send({ type: 'history', messages: MESSAGES });
      await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
      await click('.hps-voice-mic'); await settle(150);
      const denied = await measure({ card: '.hps-voice-card', input: '.hps-input', open: '.hps-voice-primary', skip: '.hps-voice-link' });
      assert.ok(denied.items.card, `${label}: permission card shown`);
      assert.ok(inside(denied.items.card, denied.vw) && !denied.scrollX, `${label}: permission card inside the viewport`);
      assert.ok(!overlap(denied.items.card, denied.items.input), `${label}: permission card clear of the composer`);
      assert.ok(denied.items.open.h >= 43.5 && denied.items.skip.h >= 43.5, `${label}: card buttons are 44px targets`);
      assert.ok(denied.items.card.fs >= 13.99, `${label}: card text ${denied.items.card.fs}px`);
      assert.equal(await b.evaluate(`window.__posts.filter(m=>m.type==='voiceTranscribe').length`), 0, `${label}: nothing sent when the microphone is refused`);
      await clickText('마이크 설정 열기');
      const handoff = await b.evaluate(`window.__posts.filter(m=>m.type==='voiceOpenMicSettings').map(m=>Object.keys(m).filter(k=>!['activityId','taskId'].includes(k)))`);
      assert.deepEqual(handoff, [['type']], `${label}: settings handoff is one message that names no URL`);
      await shot(`${label.replaceAll(' ', '-')}-denied`);

      await load('ok');
      await send({ type: 'config', config: configFor(seat, VOICE) }); await send({ type: 'history', messages: MESSAGES });
      await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
      await b.evaluate(`${composer}.focus()`);
      // Alt+Shift+M starts, the real recorder runs on an AudioContext stream.
      await press(composer, { key: 'M', code: 'KeyM', vk: 77, altKey: true, shiftKey: true }); await settle(400);
      const rec = await measure({ card: '.hps-voice-recording', input: '.hps-input', stop: '.hps-voice-mic-on' });
      assert.ok(rec.items.card, `${label}: recording card shown`);
      assert.ok(inside(rec.items.card, rec.vw) && !rec.scrollX && !overlap(rec.items.card, rec.items.input), `${label}: recording card inside the viewport and clear of the composer`);
      assert.ok(rec.items.card.fs >= 13.99 && rec.items.stop && rec.items.stop.h >= 43.5, `${label}: recording text and stop control`);
      assert.equal(await b.evaluate(`document.querySelector('.hps-voice-mic').getAttribute('aria-label')`), '받아쓰기 끝내기', `${label}: the key started a recording`);
      await shot(`${label.replaceAll(' ', '-')}-recording`);
      await settle(1200);
      await click('.hps-voice-mic'); await settle(400);
      const clip = await b.evaluate(`window.__posts.filter(m=>m.type==='voiceTranscribe')`);
      assert.equal(clip.length, 1, `${label}: one clip sent`);
      assert.equal(clip[0].mime, 'audio/webm', `${label}: sent as webm`);
      const bytes = Buffer.from(clip[0].audio, 'base64');
      assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], `${label}: the bytes are a real WebM (EBML header)`);
      assert.ok(bytes.length > 100 && bytes.length <= 2 * 1024 * 1024, `${label}: clip size ${bytes.length}`);
      assert.ok(clip[0].seconds >= 1 && clip[0].seconds <= 60, `${label}: declared seconds ${clip[0].seconds}`);
      assert.equal(await b.evaluate(`window.__media`), 1, `${label}: one microphone grant`);
      // The host answers: text lands in the composer, nothing is sent.
      await send({ type: 'voiceTranscribeResult', requestId: clip[0].requestId, ok: true, text: '고양이 사진을 넣어 줘' });
      assert.equal(await b.evaluate(`${composer}.value`), '고양이 사진을 넣어 줘', `${label}: transcript in the composer`);
      assert.equal(await b.evaluate(`window.__posts.filter(m=>m.type==='sendMessage').length`), 0, `${label}: never auto-sent`);
      // Unreadable clip: the softer line, 44px retry.
      await b.evaluate(`window.__media=0`);
      await click('.hps-voice-mic'); await settle(900); await click('.hps-voice-mic'); await settle(400);
      const second = await b.evaluate(`window.__posts.filter(m=>m.type==='voiceTranscribe').at(-1)`);
      await send({ type: 'voiceTranscribeResult', requestId: second.requestId, ok: false, kind: 'unreadable', message: '소리가 잘 들리지 않았어요. 다시 말해 볼까요?', retry: true });
      const notice = '.hps-voice-note[role="status"]';
      assert.equal(await b.evaluate(`document.querySelectorAll('${notice}').length`), 1, `${label}: exactly one manual dictation status`);
      const note = await measure({ card: notice, input: '.hps-input', retry: `${notice} .hps-voice-link` });
      assert.ok(note.items.card && inside(note.items.card, note.vw) && !overlap(note.items.card, note.items.input), `${label}: refusal note inside the viewport and clear of the composer`);
      assert.ok(note.items.retry.h >= 43.5, `${label}: retry is a 44px target`);
      assert.ok((await b.evaluate(`document.querySelector('${notice}').textContent`)).includes('소리가 잘 들리지 않았어요. 다시 말해 볼까요?'), `${label}: the softer line`);

      // Disclosure sheet (a first use): fits a 320x480 / 480x480 viewport without scrolling and has one 시작하기 (DES-CGPV-04).
      await load('ok', 480);
      await send({ type: 'config', config: configFor(seat, VOICE) }); await send({ type: 'history', messages: MESSAGES });
      await send({ type: 'voiceDisclosureState', acknowledged: [] });
      await click('.hps-voice-mic'); await settle(250);
      const sheet = await measure({ dlg: 'dialog.hps-voice-disclosure[open]', start: '.hps-voice-disclosure-start' });
      assert.ok(sheet.items.dlg, `${label}: the sheet opened before any recording`);
      assert.ok(inside(sheet.items.dlg, sheet.vw) && sheet.items.dlg.b <= sheet.vh + 0.5 && sheet.items.dlg.y >= -0.5 && !sheet.scrollX, `${label}: sheet inside a ${sheet.vw}x${sheet.vh} viewport`);
      assert.equal(await b.evaluate(`(()=>{const d=document.querySelector('dialog.hps-voice-disclosure[open]');const body=d.querySelector('.hps-preferences-body');return body.scrollHeight<=body.clientHeight+1&&d.scrollHeight<=d.clientHeight+1})()`), true, `${label}: the sheet needs no scrolling`);
      assert.ok(sheet.items.start.h >= 43.5, `${label}: 시작하기 is a 44px target`);
      assert.equal(await b.evaluate(`window.__media`), 0, `${label}: no microphone before 시작하기`);
      await shot(`${label.replaceAll(' ', '-')}-disclosure`);
      await press(null, { key: 'Escape', code: 'Escape', vk: 27 }); await settle(200);
      assert.equal(await b.evaluate(`!!document.querySelector('dialog.hps-voice-disclosure[open]')`), false, `${label}: Escape closes the sheet`);
      assert.equal(await b.evaluate(`window.__media`), 0, `${label}: Escape did not start the microphone`);

      // Class off: the disabled state with its reason, nothing overlapping.
      await load('ok');
      await send({ type: 'config', config: configFor(seat, VOICE) }); await send({ type: 'history', messages: MESSAGES });
      await send({ type: 'voiceDisclosureState', acknowledged: [V1] });
      await send({ type: 'config', config: configFor(seat) });
      const off = await measure({ mic: '.hps-voice-mic', note: '.hps-voice-classoff', input: '.hps-input', send: '.hps-btn-send', listen: '.hps-voice-listen' });
      assert.ok(off.items.mic && off.items.mic.disabled, `${label}: class off, mic disabled`);
      assert.ok(off.items.listen && off.items.listen.disabled, `${label}: class off, read-aloud disabled`);
      assert.ok(off.items.note && (await b.evaluate(`document.querySelector('.hps-voice-classoff').textContent`)).includes('이 수업에서는 쓸 수 없어요'), `${label}: the reason is visible text`);
      assert.ok(inside(off.items.note, off.vw) && !overlap(off.items.note, off.items.input) && !overlap(off.items.mic, off.items.send) && !off.scrollX, `${label}: class-off state clear of the composer`);
      assert.ok(off.items.note.fs >= 13.99, `${label}: class-off text ${off.items.note.fs}px`);
      await shot(`${label.replaceAll(' ', '-')}-class-off`);
      states++;
    }
  }
  console.log(`PASS actual App voice surfaces in ${states} seat/theme/width states: not mounted without a voice block; 44px targets, 14px text, no overlap at 320/480/800; recorder, permission, refusal, disclosure and class-off states; read-aloud control pressed state, still glyph in three motion modes, one pressed at a time`);
} finally { await b.close(); }
