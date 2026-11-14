// CGP-KNOW-D-022 (DES-KNOW-40) — the memory state line in the real App bundle, headless Chromium, measured on the real markup.
// Personal seat, dark and light, 1420/800/320 px, plus forced colours; and a classroom seat:
//   1. the activity header shows "AI 기억: 켜짐" with the folder: the state words are whole and inside the window at every
//      width (the folder yields first, the tooltip keeps the full line), 14px, 4.5:1 against the header;
//   2. the settings dialog shows "AI 기억: 켜짐 · .hypeproof/memory/" as plain text, 14px, inside the dialog;
//   3. neither is a control: no button, input, switch role or tab stop, no "꺼짐" and no "선생님이 정해요" anywhere;
//   4. a minor cohort's config (same memoryState) shows the same line; a seat without memoryState shows none.
// CGP-KNOW-D-005 (DES-KNOW-07): the state names its scope, "AI 기억: 켜짐 · 이 작업 공간 안에서만", whole at every width (at
//   320px it may wrap, but no scope word is cut or split across lines); the tooltip and the accessible text explain the
//   scope in one sentence; a classroom seat (no store) shows no scope line and no class wording.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { MEMORY_STATE_LABEL, MEMORY_FOLDER_LABEL, MEMORY_SCOPE_HEADER, MEMORY_SCOPE_SENTENCE, MEMORY_TEMPORARY_NOTE, MEMORY_TEMPORARY_SENTENCE } = await import('../src/activityMemoryView.ts');
assert.equal(MEMORY_SCOPE_HEADER, '이 작업 공간 안에서만');
assert.ok(MEMORY_SCOPE_SENTENCE.includes(MEMORY_FOLDER_LABEL) && MEMORY_SCOPE_SENTENCE.includes('수업 활동에서는') && MEMORY_SCOPE_SENTENCE.endsWith('요.'), 'one sentence naming the folder and the class rule');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN memory state line: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'memory-state-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.MEMORY_STATE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };
const STATE = `${MEMORY_STATE_LABEL} · ${MEMORY_SCOPE_HEADER}`;
const FULL = `${STATE} · ${MEMORY_FOLDER_LABEL}`;
const lum = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const rgb = v => v.match(/[\d.]+/g).map(Number);
const contrast = (a, c) => { const x = lum(rgb(a)), y = lum(rgb(c)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const bgOf = `e=>{let n=e;while(n){const c=getComputedStyle(n).backgroundColor;if(c&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c;n=n.parentElement;}return getComputedStyle(document.body).backgroundColor}`;

let states = 0;
try {
  for (const [seat, dark, width, forcedColors, minor, temp = false] of [
    ['personal', true, 1420, false, false], ['personal', false, 1420, false, false], ['personal', true, 800, false, false], ['personal', false, 800, false, true],
    ['personal', true, 320, false, false], ['personal', false, 320, false, false], ['personal', true, 800, true, false], ['classroom', false, 800, false, false],
    // A "기록 없이 묻기" task (R-029) adds the no-write phrase: whole and overlapping nothing at the narrow widths.
    ['personal', true, 320, false, false, true], ['personal', false, 320, false, false, true], ['personal', true, 480, false, false, true], ['personal', false, 480, false, false, true],
    ['personal', true, 800, false, false, true], ['personal', false, 1420, false, false, true],
  ]) {
    const tag = `${seat}${temp ? '-temporary' : ''}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}${minor ? '-minor' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 760, dark, forcedColors, appReady: true });
    const workspace = { scope: 'ms-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null, ...(temp ? { temporaryTaskId: 'task' } : {}) };
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null, ...(minor ? { minor_cohort: true } : {}) }, taskWorkspace: seat === 'personal' ? workspace : undefined });
    const config = seat === 'personal' ? { ...base, memoryState: { folder: MEMORY_FOLDER_LABEL } } : base;
    await send({ type: 'config', config });
    await send({ type: 'history', messages: [] });
    const header = await b.evaluate(`(()=>{const e=document.querySelector('[data-testid=memory-state-header]');if(!e)return null;const s=e.querySelector('.hps-memory-now-state');const r=s.getBoundingClientRect();const c=getComputedStyle(s);
      // Nothing else in the header row may overlap the state words.
      const others=[...document.querySelectorAll('.hps-header button, .tw-heading button, .tw-heading h1, .hps-activity-now, .hps-trial-left, .hps-run-state')].filter(x=>!e.contains(x)).map(x=>{const g=document.createRange();g.selectNodeContents(x);return x.matches('.hps-run-state')?g.getBoundingClientRect():x.getBoundingClientRect()}).filter(q=>q.width>2&&q.height>2);
      const overlap=others.some(q=>q.left<r.right-.5&&q.right>r.left+.5&&q.top<r.bottom-.5&&q.bottom>r.top+.5);
      // Every other header control stays in the window (the state must not push 자료 or the menu out).
      const out=[...document.querySelectorAll('.hps-header button, .tw-heading button')].filter(x=>!e.contains(x)).map(x=>x.getBoundingClientRect()).filter(q=>q.width>2&&q.height>2&&(q.right>innerWidth+.5||q.left<-.5)).length;
      // DES-KNOW-07: every scope word is drawn whole on one line (wrapping between words is allowed, a cut is not).
      const scope=e.querySelector('.hps-memory-now-scope');const words=[];if(scope){const text=scope.textContent;let i=0;for(const w of text.split(/\\s+/)){if(!w)continue;const at=text.indexOf(w,i);i=at+w.length;const node=[...scope.childNodes].find(n=>n.nodeType===3&&n.textContent.includes(w));if(!node)continue;const off=node.textContent.indexOf(w);const g=document.createRange();g.setStart(node,off);g.setEnd(node,off+w.length);const rs=[...g.getClientRects()].filter(q=>q.width>0);const box=s.getBoundingClientRect();words.push({w,lines:new Set(rs.map(q=>Math.round(q.top))).size,inside:rs.every(q=>q.left>=box.left-.5&&q.right<=box.right+.5&&q.left>=0&&q.right<=innerWidth+.5)});}}
      const sr=e.querySelector('[data-testid=memory-scope-sentence]');const srText=sr?.textContent.trim();
      const tp=e.querySelector('.hps-memory-now-temp');const temp=tp?(()=>{const q=tp.getBoundingClientRect();const g=document.createRange();g.selectNodeContents(tp);const t=g.getBoundingClientRect();return {whole:tp.scrollWidth<=tp.clientWidth+1,inside:t.left>=0&&t.right<=innerWidth,height:t.height,lineHeight:parseFloat(getComputedStyle(tp).lineHeight)||parseFloat(getComputedStyle(tp).fontSize)*1.5}})():null;
      return {temp,words,sentence:srText,srHidden:sr?getComputedStyle(sr).clipPath.includes('inset(50%'):null,scopeTip:e.querySelector('.hps-memory-now-folder')?.getAttribute('data-hp-tooltip'),out,overlap,label:e.textContent.replace(/\u00a0/g,' '),tip:s.getAttribute('data-hp-tooltip'),text:e.textContent.replace(/\u00a0/g,' '),state:s.textContent,whole:s.scrollWidth<=s.clientWidth+1&&r.width>0,inside:r.left>=0&&r.right<=innerWidth+.5,visible:r.width>0&&r.height>0&&getComputedStyle(s).visibility!=='hidden'&&!getComputedStyle(s).clipPath.includes('inset(50%'),
        font:parseFloat(c.fontSize),fg:c.color,bg:(${bgOf})(s),controls:e.querySelectorAll('button,input,select,textarea,[role=switch],[tabindex]').length,tab:e.tabIndex}})()`);
    if (seat === 'classroom') {
      assert.equal(header, null, `${tag}: no memory state on a seat without the store`);
      const page = await b.evaluate(`document.body.innerText`);
      assert.doesNotMatch(page, /이 수업 안에서만|이 작업 공간 안에서만/, `${tag}: no scope line on a seat without the store`);
      await shot(tag); states++; continue;
    }
    assert.ok(header, `${tag}: the header line is drawn`);
    assert.equal(header.label, temp ? `${STATE} · ${MEMORY_TEMPORARY_NOTE} · ${MEMORY_FOLDER_LABEL} ${MEMORY_SCOPE_SENTENCE} ${MEMORY_TEMPORARY_SENTENCE}` : `${FULL} ${MEMORY_SCOPE_SENTENCE}`, `${tag}: the full line and the scope sentence are in the text a screen reader reads`);
    assert.equal(header.sentence, temp ? `${MEMORY_SCOPE_SENTENCE} ${MEMORY_TEMPORARY_SENTENCE}` : MEMORY_SCOPE_SENTENCE, `${tag}: the accessible scope sentence`);
    assert.equal(header.srHidden, true, `${tag}: the sentence is for screen readers; the tooltip shows it on hover`);
    assert.equal(header.scopeTip, MEMORY_SCOPE_SENTENCE, `${tag}: the folder's tooltip explains the scope too`);
    assert.deepEqual(header.words.map(w => w.w), ['·', ...MEMORY_SCOPE_HEADER.split(' ')], `${tag}: the scope words are drawn`);
    for (const w of header.words) assert.ok(w.lines === 1 && w.inside, `${tag}: scope word "${w.w}" whole on one line, in view (${JSON.stringify(w)})`);
    if (temp) assert.ok(header.temp && header.temp.whole && header.temp.inside && header.temp.height < header.temp.lineHeight * 1.5, `${tag}: the no-write phrase is one whole line in view (${JSON.stringify(header.temp)})`);
    else assert.equal(header.temp, null, `${tag}: no no-write phrase outside a temporary task`);
    assert.equal(header.overlap, false, `${tag}: nothing in the header row overlaps the state words`);
    assert.equal(header.out, 0, `${tag}: every header control stays inside the window`);
    assert.equal(header.tip, temp ? `${MEMORY_SCOPE_SENTENCE} ${MEMORY_TEMPORARY_SENTENCE}` : MEMORY_SCOPE_SENTENCE, `${tag}: the tooltip explains the scope in one sentence (naming the folder)`);
    assert.equal(header.state, temp ? `${STATE} · ${MEMORY_TEMPORARY_NOTE}` : STATE, `${tag}: state and scope`);
    assert.ok(header.visible && header.whole && header.inside, `${tag}: the state words are whole and in view (${JSON.stringify(header)})`);
    assert.ok(header.font >= 14, `${tag}: ${header.font}px`);
    if (!forcedColors) assert.ok(contrast(header.fg, header.bg) >= 4.5, `${tag}: contrast ${header.fg} on ${header.bg}`);
    assert.equal(header.controls, 0, `${tag}: not a control`);
    assert.ok(header.tab < 0, `${tag}: no tab stop`);
    await shot(`${tag}-header`);
    // The settings dialog.
    // Personal chat: the header actions sit in the 대화 메뉴; 설정 there opens 대화 설정.
    await b.evaluate(`document.querySelector('.tw-chat-menu button[aria-haspopup]').click()`); await settle(200);
    await b.evaluate(`[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정').click()`); await settle(300);
    const setting = await b.evaluate(`(()=>{const e=document.querySelector('dialog[open] [data-testid=memory-state-settings]');if(!e)return null;const d=e.closest('dialog').getBoundingClientRect();const r=e.getBoundingClientRect();const c=getComputedStyle(e);
      return {text:e.textContent,font:parseFloat(c.fontSize),fg:c.color,bg:(${bgOf})(e),inside:r.left>=d.left-.5&&r.right<=d.right+.5,controls:e.querySelectorAll('button,input,select,textarea,[role=switch],[tabindex]').length,tag:e.tagName}})()`);
    assert.ok(setting, `${tag}: the settings dialog has the line`);
    assert.equal(setting.text, FULL, `${tag}: same words in settings`);
    assert.equal(setting.tag, 'P', `${tag}: a paragraph, not a control`);
    assert.equal(setting.controls, 0);
    assert.ok(setting.font >= 14 && setting.inside, `${tag}: 14px and inside the dialog`);
    if (!forcedColors) assert.ok(contrast(setting.fg, setting.bg) >= 4.5, `${tag}: settings contrast ${setting.fg} on ${setting.bg}`);
    const page = await b.evaluate(`document.body.innerText`);
    assert.doesNotMatch(page, /AI 기억: 꺼짐|선생님이 정해요/, `${tag}: no off state, no teacher wording`);
    await shot(`${tag}-settings`);
    states++;
  }
  // Width sweep (verify round 1): the line must cost the heading no word. At each width the activity kind is as whole as
  // on the same heading without the line (US-05: the kind stays; the name yields first), and no two visible items of the
  // heading overlap (state, folder, activity line, run state, title, controls).
  const sweep = `(()=>{const now=document.querySelector('.hps-activity-now');const kind=now?.querySelector('.hps-activity-kind');
    let kindWhole=null;if(now&&kind&&!getComputedStyle(now).clipPath.includes('inset(50%')){const g=document.createRange();g.selectNodeContents(kind);const k=g.getBoundingClientRect();const n=now.getBoundingClientRect();kindWhole=k.right<=n.right+.5&&k.left>=n.left-.5&&kind.textContent.length>0;}
    const shown=e=>{const c=getComputedStyle(e);return !c.clipPath.includes('inset(50%')&&c.display!=='none'&&c.visibility!=='hidden'};
    const box=e=>{if(e.matches('.hps-run-state')){const g=document.createRange();g.selectNodeContents(e);return g.getBoundingClientRect();}return e.getBoundingClientRect()};
    const items=[...document.querySelectorAll('.tw-heading > button, .tw-heading h1, .tw-heading .hps-activity-now, .tw-heading .hps-run-state, .tw-heading .hps-memory-now-state, .tw-heading .hps-memory-now-folder, .tw-heading .tw-chat-menu, .tw-heading .tw-chat-menu-toggle, .tw-heading .tw-sources-toggle, .tw-heading .tw-rail-toggle')].filter(shown).map(e=>({e,c:e.className,r:box(e)})).filter(x=>x.r.width>2&&x.r.height>2);
    const overlaps=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].r,b=items[j].r;if(a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5&&!items[i].e.contains(items[j].e)&&!items[j].e.contains(items[i].e))overlaps.push(items[i].c+' x '+items[j].c);}
    const out=[...document.querySelectorAll('.tw-heading button')].filter(shown).map(x=>x.getBoundingClientRect()).filter(q=>q.width>2&&(q.right>innerWidth+.5||q.left<-.5)).length;
    const lineWhole=now&&!getComputedStyle(now).clipPath.includes('inset(50%')?now.scrollWidth<=now.clientWidth+1:null;
    const folder=document.querySelector('.tw-heading .hps-memory-now-folder');const folderW=folder&&shown(folder)?folder.getBoundingClientRect().width:0;
    // The state sits inside the heading (its band) and is the element actually painted at its centre (nothing covers it).
    const st=document.querySelector('.tw-heading .hps-memory-now-state');let stateInHeading=null;
    if(st){const h=document.querySelector('.tw-heading').getBoundingClientRect(),q=st.getBoundingClientRect();const hit=document.elementFromPoint((q.left+q.right)/2,(q.top+q.bottom)/2);
      stateInHeading=q.width>2&&q.top>=h.top-.5&&q.bottom<=h.bottom+.5&&q.left>=h.left-.5&&q.right<=h.right+.5&&!!hit&&st.contains(hit);}
    return {stateInHeading,folderW,kindWhole,lineWhole,kindText:now?.textContent,overlaps,out,page:document.scrollingElement.scrollWidth>innerWidth}})()`;
  const sweepWidths = [320, 480, 481, 488, 495, 500, 510, 520, 560, 600, 640, 641, 650, 660, 680, 700, 760, 800, 900, 1024, 1100, 1420];
  let swept = 0;
  for (const [dark, forcedColors] of [[true, false], [false, false], [true, true]]) for (const width of sweepWidths) {
    if (forcedColors && ![481, 520, 641, 800].includes(width)) continue;
    const tag = `sweep-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const workspace = { scope: 'ms-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
    const measure = async (config) => {
      await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 600, dark, forcedColors, appReady: true });
      await send({ type: 'config', config });
      await send({ type: 'history', messages: [] });
      return b.evaluate(sweep);
    };
    const without = await measure(base);
    const withLine = await measure({ ...base, memoryState: { folder: MEMORY_FOLDER_LABEL } });
    if (without.kindWhole) assert.equal(withLine.kindWhole, true, `${tag}: the activity kind stays whole with the line (as without it): "${withLine.kindText}"`);
    if (without.lineWhole) assert.equal(withLine.lineWhole, true, `${tag}: the activity line (kind · name) is not cut where it is whole without the memory line`);
    assert.equal(withLine.stateInHeading, true, `${tag}: the state is drawn inside the heading, uncovered`);
    assert.deepEqual(withLine.overlaps, [], `${tag}: no two heading items overlap`);
    assert.equal(withLine.out, 0, `${tag}: every heading control stays in the window`);
    assert.equal(withLine.page, false, `${tag}: no sideways scroll`);
    if ([481, 520, 641, 680, 800, 1024].includes(width) && !forcedColors) await shot(tag);
    swept++;
  }
  console.log(`PASS memory state line width sweep: ${swept} widths/themes`);
  // A long activity name in the wide row (>1100px): the folder gives way before the activity line loses a letter
  // (verify round 2: an equal shrink factor kept both half-cut).
  const longName = '여름방학 개인 프로젝트 · 나만의 날씨 알림 웹사이트 만들기 3주차 발표 준비';
  for (const width of [1101, 1200, 1300, 1420]) {
    const vars = Object.entries(THEMES['Dark+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="vscode-dark"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 600, dark: true, appReady: true });
    const workspace = { scope: 'ms-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '발표', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal', name: longName }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
    await send({ type: 'config', config: { ...base, memoryState: { folder: MEMORY_FOLDER_LABEL } } });
    await send({ type: 'history', messages: [] });
    const r = await b.evaluate(sweep);
    if (r.lineWhole === false) assert.ok(r.folderW <= 1, `long-name-${width}: the folder yields before the activity line is cut (folder ${r.folderW}px)`);
    assert.deepEqual(r.overlaps, [], `long-name-${width}: no two heading items overlap`);
  }
  console.log(`PASS memory state line: ${states} states (personal dark/light 1420/800/320, forced colours, minor; classroom none)`);
} finally { await b.close(); }
