// CGP-KNOW-R-032 (REQ-STUDIO-LEARNER-NICKNAME, DES-KNOW-50): the real App bundle in headless Chromium.
// 대화 설정 on a personal seat shows one nickname field ("뭐라고 불러 줄까요?") and nothing else about
// the learner: no occupation or "about me" field, for an adult and a minor cohort alike. A classroom
// config (no `learnerNickname`) shows no field. The counter is text, counts committed characters only
// (an open Korean IME composition does not move it), and a refused value (phone number, over 20
// characters, phone digits spelled in Korean, a domain, a blank-looking name, an "at" address, a
// school and grade) shows its reason inline and posts nothing; a good value posts exactly one
// setLearnerNickname. Computed geometry on the real markup: 44px input and buttons, >=14px text, the
// field inside the dialog, dark and light, 1420 and 800 px, plus a forced-colours border and focus ring.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN learner nickname App: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'nickname-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin), evidence = process.env.NICKNAME_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const field = `document.querySelector('.hps-nickname input')`;
const text = (sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const counter = () => text('.hps-nickname-count');
const posted = () => b.evaluate(`JSON.stringify(window.__posted.filter(m=>m.type==='setLearnerNickname').map(m=>({type:m.type,nickname:m.nickname})))`).then(JSON.parse);
const focusField = () => b.evaluate(`(${field}).focus()`);
const key = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk }); await settle(); };
const clearField = async () => { await focusField(); await b.evaluate(`(${field}).select()`); await key('Backspace', 'Backspace', 8); };
const typeCommitted = async (value) => { await clearField(); await b.send('Input.insertText', { text: value }); await settle(); };
const compose = async (value) => { await focusField(); await b.send('Input.imeSetComposition', { text: value, selectionStart: value.length, selectionEnd: value.length }); await settle(); };
const pressEnter = () => key('Enter', 'Enter', 13);
const clickButton = (label) => b.evaluate(`[...document.querySelectorAll('.hps-nickname button')].find(e=>e.textContent===${JSON.stringify(label)}).click()`).then(() => settle());

const workspace = { scope: 'activity-a', revision: 1, activeTaskId: 'a1', tasks: [{ id: 'a1', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const personal = (minor, nickname = '') => chatConfig(3, { activity: { ...chatConfig().activity, id: 'activity-a', kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null, activity_kind: 'personal', minor_cohort: minor }, taskWorkspace: workspace, learnerNickname: { value: nickname } });
const openSettings = async () => {
  // Personal chat: the header actions sit in the 대화 메뉴; 설정 there opens 대화 설정.
  await b.evaluate(`document.querySelector('.tw-chat-menu button[aria-haspopup]').click()`); await settle(200);
  await b.evaluate(`[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정').click()`); await settle(300);
};
const LEARNER_FIELDS = /직업|하는 일|나에 대해|자기소개|더 알려|occupation|about you|about me/i;

let states = 0;
try {
  for (const dark of [true, false]) for (const width of [1420, 800]) for (const minor of [false, true]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 900, dark });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await send({ type: 'config', config: personal(minor) });
    await send({ type: 'history', messages: [] });
    await openSettings();
    const label = `${dark ? 'dark' : 'light'} ${width} ${minor ? 'minor' : 'adult'}`;

    // Only a nickname: one text input in the field, no textarea anywhere in the dialog, no occupation/about field.
    const shape = await b.evaluate(`(()=>{const d=document.querySelector('dialog.hps-preferences');const f=d.querySelector('.hps-nickname');return {open:d.open,legend:f?.querySelector('legend')?.textContent,inputs:f?f.querySelectorAll('input').length:0,textareas:d.querySelectorAll('textarea').length,text:d.textContent,labels:[...d.querySelectorAll('[aria-label],[placeholder]')].map(e=>(e.getAttribute('aria-label')||'')+(e.getAttribute('placeholder')||'')).join('|')}})()`);
    assert.equal(shape.open, true, `settings dialog open: ${label}`);
    assert.equal(shape.legend, '뭐라고 불러 줄까요?', label);
    assert.equal(shape.inputs, 1, `one nickname input: ${label}`);
    assert.equal(shape.textareas, 0, `no free-text field: ${label}`);
    assert.ok(!LEARNER_FIELDS.test(shape.text) && !LEARNER_FIELDS.test(shape.labels), `no occupation or about-me field: ${label}`);
    assert.equal(await counter(), '0/20자', 'empty counter');

    // Computed geometry on the real markup.
    const g = await b.evaluate(`(()=>{const d=document.querySelector('dialog.hps-preferences').getBoundingClientRect();const f=document.querySelector('.hps-nickname');const els=[f.querySelector('input'),...f.querySelectorAll('button')];return {targets:els.map(e=>{const r=e.getBoundingClientRect();return {h:r.height,w:r.width,font:parseFloat(getComputedStyle(e).fontSize),inside:r.left>=d.left-0.5&&r.right<=d.right+0.5}}),text:[...f.querySelectorAll('legend,p')].map(e=>parseFloat(getComputedStyle(e).fontSize))}})()`);
    for (const t of g.targets) { assert.ok(t.h >= 44 && t.w >= 44, `44px target ${label}: ${JSON.stringify(t)}`); assert.ok(t.font >= 14, `>=14px control text ${label}: ${JSON.stringify(t)}`); assert.equal(t.inside, true, `inside the dialog ${label}`); }
    for (const size of g.text) assert.ok(size >= 14, `>=14px text ${label}: ${JSON.stringify(g.text)}`);

    // IME: an open composition does not move the counter; the commit does.
    await clearField();
    await compose('ㅂ'); assert.equal(await counter(), '0/20자', `composition ㅂ not counted: ${label}`);
    await compose('별'); assert.equal(await counter(), '0/20자', 'composition 별 not counted');
    await compose('별이'); assert.equal(await b.evaluate(`(${field}).value`), '별이', 'the field shows the composing text');
    assert.equal(await counter(), '0/20자', 'composition 별이 not counted');
    await b.send('Input.insertText', { text: '별이' }); await settle();
    assert.equal(await counter(), '2/20자', `the commit counts: ${label}`);

    // Refused values say why inline and post nothing.
    await typeCommitted('010-1234-5678'); await pressEnter();
    assert.equal(await text('.hps-nickname-error'), '한글, 영문 글자, 띄어쓰기와 - _ 만 쓸 수 있어요.', 'digits are outside the allowlist');
    assert.equal(await b.evaluate(`(${field}).getAttribute('aria-invalid')`), 'true');
    assert.deepEqual(await posted(), [], `a phone number posts nothing: ${label}`);
    await typeCommitted('가'.repeat(21));
    assert.equal(await counter(), '21/20자', 'over-long count shown as text');
    await clickButton('저장');
    assert.equal(await text('.hps-nickname-error'), '20자까지 쓸 수 있어요.');
    assert.deepEqual(await posted(), [], 'over 20 characters posts nothing');
    // Verify round 1: digit words, a domain, a blank-looking name, an "at" address and a school are refused here too.
    for (const [value, message] of [['공일공 일이삼사 오육칠팔', '전화번호, 주소, 주민등록번호처럼 보여요. 부를 이름만 써 주세요.'],
      ['naver.com', '한글, 영문 글자, 띄어쓰기와 - _ 만 쓸 수 있어요.'], ['ㅤㅤ', '보이는 글자로 이름을 써 주세요.'],
      ['kim at naver', '이메일, 웹 주소나 SNS·메신저 아이디처럼 보여요. 부를 이름만 써 주세요.'],
      // Verify round 2: a glued contact marker, a Cyrillic homoglyph, an address in numeral words, a school abbreviation.
      ['kim앳naver', '이메일, 웹 주소나 SNS·메신저 아이디처럼 보여요. 부를 이름만 써 주세요.'], ['kim аt naver', '한글, 영문 글자, 띄어쓰기와 - _ 만 쓸 수 있어요.'],
      ['역삼동 일이삼', '전화번호, 주소, 주민등록번호처럼 보여요. 부를 이름만 써 주세요.'], ['별빛중 이-삼', '학교 이름이나 학년·반은 넣을 수 없어요. 부를 이름만 써 주세요.'],
      // Verify round 3: a messenger handle and a school demonym.
      ['카톡 kimjay', '이메일, 웹 주소나 SNS·메신저 아이디처럼 보여요. 부를 이름만 써 주세요.'], ['하늘초등학생 별이', '학교 이름이나 학년·반은 넣을 수 없어요. 부를 이름만 써 주세요.'], ['하늘초등학교 삼학년', '학교 이름이나 학년·반은 넣을 수 없어요. 부를 이름만 써 주세요.']]) {
      await typeCommitted(value); await clickButton('저장');
      assert.equal(await text('.hps-nickname-error'), message, `${value}: ${label}`);
      assert.deepEqual(await posted(), [], `${value} posts nothing: ${label}`);
    }
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/nickname-refused-${width}-${dark ? 'dark' : 'light'}-${minor ? 'minor' : 'adult'}.png`, Buffer.from(shot.data, 'base64')); }

    // A good value posts exactly one message and says when it applies.
    await typeCommitted('별이'); await clickButton('저장');
    assert.deepEqual(await posted(), [{ type: 'setLearnerNickname', nickname: '별이' }], `saved: ${label}`);
    assert.equal(await text('.hps-nickname-error'), '');
    assert.equal(await text('.hps-nickname-status'), '', 'no "saved" line before the host has saved it');
    await send({ type: 'config', config: personal(minor, '별이') });
    assert.equal(await text('.hps-nickname-status'), '저장했어요. 다음 요청부터 이 이름으로 불러요.', 'confirmed by the host value');
    assert.equal(await b.evaluate(`(${field}).value`), '별이', 'the saved value stays in the field');
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/nickname-saved-${width}-${dark ? 'dark' : 'light'}-${minor ? 'minor' : 'adult'}.png`, Buffer.from(shot.data, 'base64')); }
    // Pressed from the keyboard: focus sits on 지우기, which disappears once the field is empty.
    await b.evaluate(`[...document.querySelectorAll('.hps-nickname button')].find(e=>e.textContent==='지우기').focus()`);
    assert.equal(await b.evaluate(`document.activeElement.textContent`), '지우기', 'control: focus is on 지우기');
    await b.evaluate(`document.activeElement.click()`); await settle();
    assert.deepEqual((await posted()).at(-1), { type: 'setLearnerNickname', nickname: '' }, 'clear posts an empty nickname');
    assert.equal(await b.evaluate(`document.activeElement === ${field}`), true, 'focus moves to the field, not <body>');
    await send({ type: 'config', config: personal(minor) });
    assert.equal(await text('.hps-nickname-status'), '지웠어요. 다음 요청부터 이름 없이 대화해요.');

    // Forced colours: the input keeps a visible border and a keyboard focus ring.
    if (width === 800 && !minor) {
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      await b.evaluate(`document.querySelector('.hps-nickname button').focus()`); await key('Tab', 'Tab', 9); await b.evaluate(`(${field}).focus()`);
      const fc = await b.evaluate(`(()=>{const s=getComputedStyle(${field});return {border:s.borderTopStyle,bw:parseFloat(s.borderTopWidth)}})()`);
      assert.ok(fc.border !== 'none' && fc.bw >= 1, `forced-colours border: ${JSON.stringify(fc)}`);
      if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/nickname-forced-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    }
    states++;
  }
  assert.equal(states, 8, 'two themes x two widths x adult/minor');

  // A classroom config carries no learnerNickname: no field anywhere.
  await b.load(`<html><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width: 1420, height: 900, dark: true });
  await send({ type: 'config', config: chatConfig(3) });
  await send({ type: 'history', messages: [] });
  // The classroom gear is the only settings entry: it asks the host for app settings, no dialog field.
  await b.evaluate(`document.querySelector('.hps-header button[aria-label="설정"]').click()`); await settle(200);
  assert.equal(await b.evaluate(`window.__posted.some(m=>m.type==='openSettings')`), true, 'control: the classroom gear was pressed');
  assert.equal(await b.evaluate(`document.querySelector('.hps-nickname')`), null, 'classroom: no nickname field');
  // Negative control for the field itself: a personal config without the key shows none either.
  await send({ type: 'config', config: { ...personal(false), learnerNickname: undefined } });
  await openSettings();
  assert.equal(await b.evaluate(`document.querySelector('dialog.hps-preferences')?.open`), true, 'control: the dialog opened');
  assert.equal(await b.evaluate(`document.querySelector('.hps-nickname')`), null, 'no key, no field');
  console.log(`learner nickname App: ${states} states OK`);
} finally { await b.close(); }
