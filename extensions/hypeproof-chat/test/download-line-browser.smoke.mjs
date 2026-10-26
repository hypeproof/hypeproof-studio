// CGP-KNOW-D-021 (DES-KNOW-38): download lines in the chat timeline, the real App bundle in headless
// Chromium, measured on the real markup. Both seats (personal, classroom), dark and light, 800 and
// 1420 px, plus forced colours:
//   1. a line is secondary (muted) text: personal at 14px (learner minimum; the register's 13px loses),
//      smaller than the answer body; classroom at that seat's tool-row size, never above its answers;
//      it stays inside the chat column;
//   2. a done line shows name, size, 열기 and 폴더에서 보기 as 44px targets with a solid focus ring;
//      a press posts {downloadLineAction, id, action}; a host refusal shows under the line;
//   3. a failure line (stored history) persists with name and cause and has no buttons;
//   4. a running line says 받는 중 and shows no percentage until a total is known, and its final line
//      replaces it in place.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { downloadDoneNotice, downloadFailedNotice, downloadProgressNotice } = await import('../src/browserDownloadNotice.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN download line: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'download-line-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.DOWNLOAD_LINE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };

const done = downloadDoneNotice('수업자료 1주차.pdf', 2048);
const failed = downloadFailedNotice('big.bin', 'interrupted');
const tool = (id, n, at) => ({ id, role: 'tool', content: '', createdAt: at, tool: { icon: '📄', label: n.label, state: n.state } });
const history = [
  { id: 'u1', role: 'user', content: '수업 자료 받아 줘', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '브라우저에서 자료 링크를 열었어요. 받은 파일은 downloads 폴더에 들어가요.', createdAt: 2 },
  tool('download-d1', done, 3),
  tool('download-f1', failed, 4),
];

const probe = `(()=>{
  const list=document.querySelector('.hps-messages'), L=list.getBoundingClientRect();
  const rect=(e)=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right,top:q.top,bottom:q.bottom,w:q.width,h:q.height}};
  const answer=document.querySelector('.hps-msg-assistant p');
  const probeTool=document.createElement('div');probeTool.className='hps-tool-log-line';list.appendChild(probeTool);const tool=parseFloat(getComputedStyle(probeTool).fontSize);probeTool.remove();
  const lines=[...document.querySelectorAll('[data-testid=download-line]')].map(e=>{const t=e.querySelector('.hps-download-text');const s=getComputedStyle(t);
    return {state:e.dataset.downloadState,text:t.textContent,font:parseFloat(s.fontSize),color:s.color,box:rect(e),
      buttons:[...e.querySelectorAll('button')].map(x=>({text:x.textContent,label:x.getAttribute('aria-label'),...rect(x),border:getComputedStyle(x).borderTopStyle})),
      notice:e.querySelector('.hps-download-notice')?.textContent??null}});
  return {list:{left:L.left,right:L.right},tool,answer:answer?{font:parseFloat(getComputedStyle(answer).fontSize),color:getComputedStyle(answer).color}:null,lines};
})()`;

let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [800, 1420]) for (const forcedColors of width === 800 && dark ? [false, true] : [false]) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark, forcedColors });
    const workspace = { scope: 'dl-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '자료', createdAt: 1, updatedAt: 1, messageCount: history.length }], sourceSelection: null };
    await send({ type: 'config', config: chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined }) });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${tag}: seat branch`);

    // A running download arrives outside any turn: first without a total, then with one.
    await send({ type: 'downloadNotice', id: 'download-r1', icon: '📄', at: 5, ...downloadProgressNotice('movie.mp4', 2 * 1024 * 1024, 0) });
    let m = await b.evaluate(probe);
    const run = m.lines.find(l => l.state === 'running');
    assert.ok(run, `${tag}: running line rendered`);
    assert.match(run.text, /받는 중/, `${tag}: 받는 중`);
    assert.ok(!run.text.includes('%'), `${tag}: no invented percentage (${run.text})`);
    assert.deepEqual(run.buttons, [], `${tag}: no actions while running`);
    await shot(`${tag}-running`);
    await send({ type: 'downloadNotice', id: 'download-r1', icon: '📄', at: 5, ...downloadProgressNotice('movie.mp4', 1024 * 1024, 4 * 1024 * 1024) });
    m = await b.evaluate(probe);
    assert.match(m.lines.find(l => l.state === 'running').text, /25%/, `${tag}: a percentage once the total is known`);

    m = await b.evaluate(probe);
    assert.ok(m.answer, `${tag}: answer rendered`);
    for (const l of m.lines) {
      // 1. Secondary text, subordinate to the answer, inside the column.
      if (seat === 'personal') {
        assert.ok(Math.abs(l.font - 14) < 0.5, `${tag}: ${l.state} line text ${l.font}px is the 14px caption`);
        assert.ok(l.font < m.answer.font, `${tag}: ${l.state} line (${l.font}px) is smaller than the answer (${m.answer.font}px)`);
      } else {
        // The classroom chat is 13px; the line takes that size (the register's 13px), never above the answer
        // and never down to the 12px tool rows.
        assert.ok(Math.abs(l.font - 13) < 0.5 && l.font <= m.answer.font + 0.1, `${tag}: ${l.state} line ${l.font}px is 13px, answer ${m.answer.font}px`);
        assert.ok(l.font > m.tool, `${tag}: ${l.state} line (${l.font}px) above the ${m.tool}px tool rows`);
      }
      if (!forcedColors) assert.notEqual(l.color, m.answer.color, `${tag}: ${l.state} line uses the secondary colour`);
      assert.ok(l.box.left >= m.list.left - 0.5 && l.box.right <= m.list.right + 0.5, `${tag}: ${l.state} line inside the chat column`);
    }
    // 2. Done line: name, size, two 44px actions.
    const d = m.lines.find(l => l.state === 'done');
    assert.ok(d.text.includes('수업자료 1주차.pdf') && d.text.includes('2.0KB'), `${tag}: name and size (${d.text})`);
    assert.deepEqual(d.buttons.map(x => x.text), ['열기', '폴더에서 보기']);
    assert.deepEqual(d.buttons.map(x => x.label), ['수업자료 1주차.pdf 열기', '수업자료 1주차.pdf 폴더에서 보기']);
    for (const x of d.buttons) {
      assert.ok(x.w >= 43.5 && x.h >= 43.5, `${tag}: ${x.text} target ${x.w}x${x.h} >= 44`);
      assert.ok(x.right <= m.list.right + 0.5, `${tag}: ${x.text} inside the column`);
      assert.notEqual(x.border, 'none', `${tag}: ${x.text} has a visible edge`);
    }
    const ring = await b.focusVisibleStyle('[data-download-state=done] .hps-download-actions button');
    assert.equal(ring['outline-style'], 'solid', `${tag}: focus ring`);
    assert.ok(parseFloat(ring['outline-width']) >= 2, `${tag}: focus ring width ${ring['outline-width']}`);
    // 3. Failure line persists with name and cause, no buttons.
    const f = m.lines.find(l => l.state === 'failed');
    assert.ok(f && f.text.includes('big.bin') && f.text.includes('받는 중에 멈췄어요'), `${tag}: failure line (${f?.text})`);
    assert.deepEqual(f.buttons, []);
    await shot(`${tag}-lines`);

    // 2b. A press posts the line's id; a host refusal shows under that line only.
    await b.evaluate(`document.querySelector('[data-download-state=done] .hps-download-actions button').click()`);
    await b.evaluate(`document.querySelectorAll('[data-download-state=done] .hps-download-actions button')[1].click()`);
    const posted = await b.evaluate(`posted.filter(p=>p.type==='downloadLineAction').map(p=>({type:p.type,id:p.id,action:p.action}))`);
    assert.deepEqual(posted, [{ type: 'downloadLineAction', id: 'download-d1', action: 'open' }, { type: 'downloadLineAction', id: 'download-d1', action: 'reveal' }]);
    await send({ type: 'downloadLineNotice', id: 'download-d1', notice: 'downloads 폴더에서 이 파일을 찾지 못했어요. 옮겨졌거나 이름이 바뀌었을 수 있어요.' });
    m = await b.evaluate(probe);
    assert.equal(m.lines.find(l => l.state === 'done').notice, 'downloads 폴더에서 이 파일을 찾지 못했어요. 옮겨졌거나 이름이 바뀌었을 수 있어요.');
    assert.ok(m.lines.filter(l => l.state !== 'done').every(l => l.notice === null), `${tag}: notice only under its own line`);
    await shot(`${tag}-notice`);
    await send({ type: 'downloadLineNotice', id: 'download-d1', notice: null });
    assert.equal((await b.evaluate(probe)).lines.find(l => l.state === 'done').notice, null, `${tag}: cleared after a press goes through`);

    // 4. The final line replaces the running one in place.
    const count = (await b.evaluate(probe)).lines.length;
    await send({ type: 'downloadNotice', id: 'download-r1', icon: '📄', at: 5, ...downloadDoneNotice('movie.mp4', 4 * 1024 * 1024) });
    m = await b.evaluate(probe);
    assert.equal(m.lines.length, count, `${tag}: same number of lines`);
    assert.ok(!m.lines.some(l => l.state === 'running'), `${tag}: no running line left`);
    assert.equal(m.lines.filter(l => l.state === 'done').length, 2);
    // A forged line (not the host's shape) is not drawn as a download line.
    await send({ type: 'downloadNotice', id: 'download-x', icon: '📄', at: 6, state: 'done', label: '다운로드 완료: downloads/a‮.txt (1B)' });
    assert.equal((await b.evaluate(probe)).lines.length, count, `${tag}: forged label refused`);
    states++;
  }
  console.log(`PASS download lines in ${states} seat/theme/width states: secondary text (personal 14px below the answer, classroom 13px), 44px 열기/폴더에서 보기 with a focus ring, persistent failure line, 받는 중 without an invented percentage, in-place final line`);
} finally { await b.close(); }
