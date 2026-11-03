// REQ-STUDIO-TOOL-LINE-LABELS (#2788): the real App bundle in headless Chromium, measured.
// RC1 (personal seat, agent-sdk): one turn was spread out (32px between tool rows, 28px between the
// copy row and the next tool row), the floating "최신 메시지" pill sat on the last lines, and the
// "이용권 상태를 확인해 주세요" strip took height above the composer. Measured here on the real markup:
//   1. adjacent tool rows are at most 4px apart, an answer (paragraph + copy row) and the tool row
//      next to it at most 8px, and nothing overlaps; the copy button keeps its 44px target;
//   2. scrolled to the end, the last text line sits fully above the strip, the pill and the composer;
//   3. with the pill shown, no transcript text line intersects it, and it is a 44px target.
// Both seats (personal, classroom), dark and light, 800 and 1420 px. Tool labels come from the
// host's learnerToolLine, the same function the SDK path calls.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const { learnerToolLine } = await import('../src/toolLineLabel.ts');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN turn compact layout: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'turn-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const evidence = process.env.TURN_LAYOUT_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shot = async (name) => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); };

const WS = '/w';
const tool = (id, name, input, at) => ({ id, role: 'tool', content: '', createdAt: at, tool: { ...learnerToolLine(name, input, WS), state: 'done' } });
const para = '네이버에서 서울 치과 임플란트 가격을 찾아봤어요. 검색 결과 첫 페이지의 병원 세 곳을 비교해서 표로 정리할게요.';
const earlier = Array.from({ length: 4 }, (_, i) => [
  { id: `pu${i}`, role: 'user', content: `이전 질문 ${i + 1}`, createdAt: 1 + i * 2 },
  { id: `pa${i}`, role: 'assistant', content: `${para} (${i + 1})`, createdAt: 2 + i * 2 },
]).flat();
const history = [...earlier,
  { id: 'u1', role: 'user', content: '서울 치과 임플란트 가격을 찾아서 정리해 줘', createdAt: 20 },
  { id: 'a1', role: 'assistant', content: '네이버에서 찾아볼게요.', createdAt: 21 },
  tool('t1', 'mcp__hypeproof__browser_open', { url: 'https://search.naver.com/search.naver?query=치과' }, 22),
  tool('t2', 'mcp__hypeproof__browser_read', {}, 23),
  tool('t3', 'Read', { file_path: '/w/index.html' }, 24),
  tool('t4', 'SomeFutureTool', { a: 1 }, 25),
  { id: 'a2', role: 'assistant', content: `${para}\n\n마지막 줄: 이 줄이 끝까지 보여야 해요.`, createdAt: 26 },
];

// Geometry probes, run in the page.
const probe = `(()=>{
  const list=document.querySelector('.hps-messages'), L=list.getBoundingClientRect();
  const r=(e)=>{const q=e.getBoundingClientRect();return {top:q.top,bottom:q.bottom,left:q.left,right:q.right,h:q.height}};
  const kids=[...list.children];
  const tools=kids.filter(e=>e.matches('.hps-tool-log-line'));
  const pairs=[];for(let i=1;i<kids.length;i++){const a=kids[i-1],c=kids[i];const ta=a.matches('.hps-tool-log-line'),tc=c.matches('.hps-tool-log-line');
    const aa=a.matches('.hps-msg-assistant'),ca=c.matches('.hps-msg-assistant');
    if((ta&&tc)||(aa&&tc)||(ta&&ca))pairs.push({kind:ta&&tc?'tool-tool':aa?'answer-tool':'tool-answer',gap:c.getBoundingClientRect().top-a.getBoundingClientRect().bottom});}
  const copy=[...document.querySelectorAll('.hps-copy-answer')].map(e=>r(e).h);
  // Every rendered text line in the transcript, as client rects.
  const lines=[];const w=document.createTreeWalker(list,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){if(!n.textContent.trim())continue;const g=document.createRange();g.selectNodeContents(n);for(const q of g.getClientRects()){if(q.width<1||q.height<1)continue;lines.push({top:q.top,bottom:q.bottom,left:q.left,right:q.right,text:n.textContent.slice(0,24)});}}
  // A line the list clips still reports its full box; keep only the part the list actually paints.
  const visible=lines.filter(q=>q.bottom>L.top+1&&q.top<L.bottom-1).map(q=>({...q,top:Math.max(q.top,L.top),bottom:Math.min(q.bottom,L.bottom)}));
  const last=lines.filter(q=>q.text.startsWith('마지막 줄')).at(-1)??null;
  const pill=document.querySelector('.hps-catchup button'), strip=document.querySelector('.hps-access-attention'), input=document.querySelector('.hps-input');
  return {list:r(list),pairs,copy,toolCount:tools.length,visible,last,
    pill:pill?r(pill):null,strip:strip?r(strip):null,input:input?r(input):null,
    labels:tools.map(e=>e.querySelector('.hps-tool-label')?.textContent??''),
    dist:list.scrollHeight-list.scrollTop-list.clientHeight};
})()`;
const hit = (a, q) => a.left < q.right - 0.5 && a.right > q.left + 0.5 && a.top < q.bottom - 0.5 && a.bottom > q.top + 0.5;

let states = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [800, 1420]) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}`;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 720, dark });
    const workspace = { scope: 'turn-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '치과 가격', createdAt: 1, updatedAt: 1, messageCount: history.length }], sourceSelection: null };
    const base = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined,
      // The persistent pass-status strip (personal only): an access state the host could not confirm.
      access: seat === 'personal' ? { status: 'unknown' } : undefined });
    await send({ type: 'config', config: base });
    await send({ type: 'history', messages: history });
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${tag}: seat branch`);
    await b.evaluate(`(()=>{const l=document.querySelector('.hps-messages');l.scrollTop=l.scrollHeight;l.dispatchEvent(new Event('scroll'))})()`); await settle(150);
    const end = await b.evaluate(probe);
    await shot(`${tag}-end`);

    // Labels: the learner reads plain Korean, never a tool identifier.
    assert.deepEqual(end.labels, ['search.naver.com 열기 · 인터넷', '페이지 읽는 중', '파일 읽기 index.html', '도구 사용 중'], `${tag}: tool labels`);
    // 1. Compact turn group.
    assert.ok(end.pairs.length >= 5, `${tag}: measured pairs ${JSON.stringify(end.pairs)}`);
    for (const p of end.pairs) {
      assert.ok(p.gap >= -0.5, `${tag}: ${p.kind} rows never overlap (${p.gap}px)`);
      assert.ok(p.gap <= (p.kind === 'tool-tool' ? 4.5 : 8.5), `${tag}: ${p.kind} gap ${p.gap.toFixed(1)}px is compact`);
    }
    if (seat === 'personal') { assert.ok(end.copy.length >= 2); for (const h of end.copy) assert.ok(h >= 43.5, `${tag}: copy target ${h}px >= 44`); }
    // 2. The end of the answer is fully visible above the strip, the pill and the composer.
    assert.ok(end.last, `${tag}: last line rendered`);
    assert.ok(end.last.bottom <= end.list.bottom + 0.5, `${tag}: last line inside the list viewport (${end.last.bottom} > ${end.list.bottom})`);
    for (const [name, box] of [['strip', end.strip], ['composer', end.input], ['pill', end.pill]]) if (box) assert.ok(end.last.bottom <= box.top + 0.5, `${tag}: last line above the ${name} (${end.last.bottom} > ${box.top})`);
    if (seat === 'personal') {
      assert.ok(end.strip, `${tag}: the pass-status strip is shown (message kept)`);
      assert.equal(end.pill, null, `${tag}: no pill at the end`);
      // 3. Scrolled away (just past the follow threshold, and far up): the pill never covers text.
      for (const back of [80, 400]) {
        await b.evaluate(`(()=>{const l=document.querySelector('.hps-messages');l.scrollTop=l.scrollHeight-l.clientHeight-${back};l.dispatchEvent(new Event('scroll'))})()`); await settle(150);
        const away = await b.evaluate(probe);
        assert.ok(away.pill, `${tag}: the pill shows ${back}px from the end (${away.dist})`);
        assert.ok(away.pill.h >= 43.5, `${tag}: pill target ${away.pill.h}px >= 44`);
        const covered = away.visible.filter(q => hit(away.pill, q));
        assert.deepEqual(covered.map(q => q.text), [], `${tag}: the pill covers no transcript text ${back}px from the end`);
        if (away.strip) assert.ok(!hit(away.pill, away.strip), `${tag}: pill and strip do not overlap`);
        if (back === 80) await shot(`${tag}-pill`);
      }
    }
    states++;
  }
  console.log(`PASS turn layout in ${states} seat/theme/width states: tool rows <=4px apart, answer/tool <=8px, 44px copy and pill targets, last line above strip/pill/composer, pill covers no text`);
} finally { await b.close(); }
