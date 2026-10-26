// CGP-CHAT-R-029 / CGP-CHAT-D85 (REQ-STUDIO-REMOVAL-UNDO) — the 되돌리기 toast on the mounted ChatPanel
// (personal seat inside the real TaskWorkspaceFrame, classroom seat bare), headless Chromium.
// Behaviour: removing an image, a folded paste, a staged photo, the file or page chip, cancelling a
// queued message and renaming the task each show one toast; 되돌리기 restores the exact prior state;
// a recovery item (보내지 못한 메시지) keeps its confirm and shows no toast. Geometry (computed, real markup):
// centred above the composer, ≤360px wide, 44px 되돌리기, ≥14px text on the personal seat, role=status,
// no page overflow at 320px, a visible border in forced colours, inside the chat panel box (CGP-CHAT-D-029).
// Timing: gone after 6 s, held by hover and by focus, running again once either ends.
// Throws under FOCUS_REQUIRE_BROWSER=1 without Chromium; prints NOT RUN otherwise.
// Run: FOCUS_REQUIRE_BROWSER=1 node test/removal-undo-browser.smoke.mjs   (PNGs: UNDO_TOAST_EVIDENCE=<dir>)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatPanelProps, chatConfig, resolvedProfile } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'esm', outdir: 'assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text;
const fixture = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';import {TaskWorkspaceFrame} from './src/TaskWorkspace';
function Fixture(){
  const [file,setFile]=useState(null),[page,setPage]=useState(null),[streaming,setStreaming]=useState(false),[view,setView]=useState(window.view);
  Object.assign(window,{setFile,setPage,setStreaming,setView});
  const panel=<ChatPanel {...window.fixture} streaming={streaming} fileAttachment={file} pageAttachment={page} onAttachFile={()=>{}}
    onRemoveFileAttachment={id=>{window.removedFile.push(id??null);setFile(null)}} onRemovePageAttachment={id=>{window.removedPage.push(id??null);setPage(null)}} onSend={()=>window.sent++}/>;
  return window.personal?<TaskWorkspaceFrame view={view} messages={[]} busy={false} error={null} onDismissError={()=>{}}>{panel}</TaskWorkspaceFrame>:panel;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const js = await build({ stdin: { contents: fixture, resolveDir: dir, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, logLevel: 'silent' });

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN removal undo toast: no Chromium'); process.exit(0); }
const evidence = process.env.UNDO_TOAST_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const pause = (ms = 120) => new Promise(r => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const LONG = Array.from({ length: 45 }, (_, i) => `붙여넣은 ${i + 1}번째 줄`).join('\n');

const b = await launch(bin);
const ev = x => b.evaluate(x);
const key = async (k, code = k, vk = 0) => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
const toast = () => ev(`(()=>{const t=document.querySelector('[data-testid="undo-toast"]');const btn=[...t.querySelectorAll('button')].find(x=>x.textContent==='되돌리기');return {shown:t.dataset.shown,kind:t.dataset.undoKind??null,text:t.textContent.trim(),icon:t.querySelector('.hps-undo-toast-text > svg')?.dataset.icon??null,role:t.getAttribute('role'),live:t.getAttribute('aria-live'),button:!!btn}})()`);
const press = async () => { await ev(`(()=>{const btn=[...document.querySelectorAll('[data-testid="undo-toast"] button')].find(x=>x.textContent==='되돌리기');btn.focus();btn.click()})()`); await pause(); };
const posts = type => ev(`window.posts.filter(p=>p.type===${JSON.stringify(type)})`);
const hostSays = async msg => { await ev(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`); await pause(); };
let shots = 0;
const shot = async name => { if (!evidence) return; const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); shots++; };

const load = async ({ seat, dark, width, forcedColors = false, draft = {}, profile = {} }) => {
  const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
  const personal = seat === 'personal';
  const view = { scope: 'seat-a', revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [{ id: 't1', title: '새 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }] };
  const config = chatConfig(3, {
    fileAttach: true,
    activity: { ...chatConfig().activity, id: 'act-1', kind: seat },
    profile: { ...resolvedProfile(3), lesson: null, input: { image_paste: true, image_files: true }, sdk_tools: { read: true }, ...profile },
    taskWorkspace: personal ? view : undefined,
    activityDraft: { text: '', images: [], queued: null, ...draft },
  });
  await b.load(`<!doctype html><html lang="ko" style="${vars}"><style>${css}html,body,#root{height:100%;margin:0}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root" style="height:800px"></div>
<script>window.posts=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.posts.push(JSON.parse(JSON.stringify(m))),getState:()=>undefined,setState:()=>{}});window.removedFile=[];window.removedPage=[];window.sent=0;window.personal=${personal};window.view=${JSON.stringify(view)};window.fixture=${JSON.stringify(chatPanelProps({ config }))};</script>
<script>${js.outputFiles[0].text}</script></body></html>`, { width, height: 900, dark, forcedColors });
  await pause(200);
};

try {
  // ── geometry in every seat, theme, width and forced-colour mode ──
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 800, 1420]) for (const forcedColors of [false, true]) {
    const tag = `${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}`;
    await load({ seat, dark, width, forcedColors, draft: { images: [PNG, PNG2] } });
    let t = await toast();
    assert.deepEqual([t.shown, t.role, t.live, t.text], ['false', 'status', 'polite', ''], `${tag}: an empty, invisible live region before any removal`);
    const empty = await ev(`document.querySelector('[data-testid="undo-toast"]').getBoundingClientRect().height`);
    assert.ok(empty <= 0.5, `${tag}: the empty toast takes no space (${empty})`);
    await ev(`document.querySelectorAll('.hps-attachment-remove')[0].click()`); await pause();
    t = await toast();
    assert.deepEqual([t.shown, t.kind, t.button], ['true', 'image', true], `${tag}: removing an image offers 되돌리기`);
    assert.ok(t.text.startsWith('이미지를 뺐어요'), t.text);
    assert.equal(t.icon, 'info', `${tag}: icon + text (DS-D-022)`);
    assert.equal(await ev(`document.querySelectorAll('.hps-attachment img').length`), 1);
    const g = await ev(`(()=>{const t=document.querySelector('[data-testid="undo-toast"]'),input=document.querySelector('.hps-input'),btn=t.querySelector('.hps-undo-toast-action'),txt=t.querySelector('.hps-undo-toast-text');const r=t.getBoundingClientRect(),i=input.getBoundingClientRect(),c=btn.getBoundingClientRect(),p=t.parentElement.getBoundingClientRect();const s=getComputedStyle(t);return {bottom:r.bottom,inputTop:i.top,center:(r.left+r.right)/2,colCenter:(p.left+p.right)/2,width:r.width,left:r.left,right:r.right,pl:p.left,pr:p.right,bw:c.width,bh:c.height,font:parseFloat(getComputedStyle(txt).fontSize),btnFont:parseFloat(getComputedStyle(btn).fontSize),border:s.borderTopStyle,borderW:parseFloat(s.borderTopWidth),borderColor:s.borderTopColor,bg:s.backgroundColor,color:s.color,page:document.documentElement.scrollWidth}})()`);
    assert.ok(g.bottom <= g.inputTop + 0.5 && g.inputTop - g.bottom <= 24, `${tag}: directly above the composer (gap ${g.inputTop - g.bottom})`);
    assert.ok(Math.abs(g.center - g.colCenter) <= 1, `${tag}: centred in the chat column (${g.center} vs ${g.colCenter})`);
    // CGP-CHAT-D-029 / D85 "inside the chat panel": the toast is drawn by the panel itself and stays inside its box.
    const inPanel = await ev(`(()=>{const t=document.querySelector('[data-testid="undo-toast"]'),shell=t.closest('.hps-shell');if(!shell)return null;const r=t.getBoundingClientRect(),s=shell.getBoundingClientRect();return r.left>=s.left-0.5&&r.right<=s.right+0.5&&r.top>=s.top-0.5&&r.bottom<=s.bottom+0.5})()`);
    assert.equal(inPanel, true, `${tag}: the toast sits inside the chat panel box`);
    assert.ok(g.width <= 360.5 && g.left >= g.pl - 0.5 && g.right <= g.pr + 0.5, `${tag}: content width ≤360px inside the column (${g.width})`);
    assert.ok(g.bw >= 44 && g.bh >= 44, `${tag}: 되돌리기 is a 44px target (${g.bw}×${g.bh})`);
    if (seat === 'personal') assert.ok(g.font >= 14 && g.btnFont >= 14, `${tag}: ≥14px text (${g.font}/${g.btnFont})`);
    assert.ok(g.page <= width + 1, `${tag}: no horizontal page scroll (${g.page})`);
    assert.ok(g.border === 'solid' && g.borderW >= 1, `${tag}: the toast has a visible edge`);
    if (forcedColors) assert.notEqual(g.borderColor, g.bg, `${tag}: forced-colour border differs from the canvas`);
    const focus = await b.focusVisibleStyle('.hps-undo-toast-action');
    assert.ok(parseFloat(focus['outline-width']) > 0 && focus['outline-style'] !== 'none', `${tag}: 되돌리기 shows a focus ring`);
    if (!forcedColors || width === 800) await shot(`toast-${tag}`);
    await press();
    t = await toast();
    assert.deepEqual([t.button, t.text], [false, '되돌렸어요'], `${tag}: undo confirms and the button goes`);
    const imgs = await ev(`[...document.querySelectorAll('.hps-attachment img')].map(i=>i.getAttribute('src'))`);
    assert.deepEqual(imgs, [PNG, PNG2], `${tag}: the same image is back at the same place`);
    assert.equal(await ev(`document.activeElement===document.querySelector('.hps-input textarea')`), true, `${tag}: focus lands on the composer, never <body>`);
    if (width === 800 && !forcedColors) await shot(`done-${tag}`);
    console.log('PASS geometry', tag);
  }

  // ── each removal kind, behaviour (personal seat, dark, 800px) ──
  await load({ seat: 'personal', dark: true, width: 800, draft: { images: [PNG, PNG2] } });
  // A second removal replaces the first offer; the first removal stays done.
  await ev(`document.querySelectorAll('.hps-attachment-remove')[1].click()`); await pause();
  await ev(`document.querySelectorAll('.hps-attachment-remove')[0].click()`); await pause();
  await press();
  assert.deepEqual(await ev(`[...document.querySelectorAll('.hps-attachment img')].map(i=>i.getAttribute('src'))`), [PNG], 'only the latest removal is undone');
  // An edit of the subject ends the offer: no undo over a list that changed since.
  await ev(`document.querySelectorAll('.hps-attachment-remove')[0].click()`); await pause();
  assert.equal((await toast()).button, true);
  await hostSays({ type: 'imageStagedByHost', stageId: 'photo-1', name: '사진.png', dataUrl: null });
  assert.equal((await toast()).kind, 'image', 'another list (photos) does not end the image offer');

  // Staged photo: the host file is deleted only when the offer ends, never on undo.
  await ev(`document.querySelector('[aria-label="사진.png 빼기"]').click()`); await pause();
  assert.equal((await toast()).kind, 'photo');
  assert.equal((await posts('discardStagedImage')).length, 0, 'no delete while 되돌리기 is offered');
  await press();
  assert.equal(await ev(`!!document.querySelector('[aria-label="사진.png 빼기"]')`), true, 'the staged photo chip is back');
  assert.equal((await posts('discardStagedImage')).length, 0, 'undo never deletes the staged file');
  await ev(`document.querySelector('[aria-label="사진.png 빼기"]').click()`); await pause();
  assert.equal((await posts('discardStagedImage')).length, 0, 'removed again: still kept while offered');
  await ev(`document.querySelector('.hps-input textarea').focus()`);
  await b.send('Input.insertText', { text: '보낼 글' }); await pause();
  await key('Enter', 'Enter', 13); await pause(300);
  assert.equal((await posts('discardStagedImage')).map(p => p.stageId).join(), 'photo-1', 'the photo is deleted once its offer ends (send)');

  // Folded paste: back in place; typing ends the offer.
  await load({ seat: 'personal', dark: true, width: 800 });
  await ev(`(()=>{const t=document.querySelector('.hps-input textarea');t.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(LONG)});t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`); await pause();
  assert.equal(await ev(`document.querySelectorAll('.hps-pasted-chip').length`), 1);
  await ev(`document.querySelector('.hps-pasted-chip button[aria-label="붙여넣은 글 빼기"]').click()`); await pause();
  assert.equal((await toast()).kind, 'paste');
  await press();
  assert.equal(await ev(`document.querySelector('.hps-pasted-chip button').textContent`), '붙여넣은 글 · 45줄', 'the same paste is back');
  await ev(`document.querySelector('.hps-pasted-chip button[aria-label="붙여넣은 글 빼기"]').click()`); await pause();
  await ev(`document.querySelector('.hps-input textarea').focus()`); await b.send('Input.insertText', { text: '가' }); await pause();
  assert.equal((await toast()).shown, 'false', 'a draft edit ends the paste offer (undo could not restore it exactly)');

  // Queued message while a turn runs: × returns it to the draft; 되돌리기 queues it again.
  await load({ seat: 'personal', dark: true, width: 800 });
  await ev(`window.setStreaming(true)`); await pause();
  await ev(`document.querySelector('.hps-input textarea').focus()`); await b.send('Input.insertText', { text: '다음 질문' }); await pause();
  await key('Enter', 'Enter', 13); await pause();
  assert.equal(await ev(`document.querySelector('.hps-queued .hps-queued-text')?.textContent`), '다음 질문', 'Enter queues while the turn runs');
  await ev(`document.querySelector('.hps-queued-cancel').click()`); await pause();
  assert.equal(await ev(`document.querySelector('.hps-input textarea').value`), '다음 질문', 'cancel puts the text back in the draft');
  assert.equal((await toast()).kind, 'queued');
  await press();
  assert.equal(await ev(`document.querySelector('.hps-queued .hps-queued-text')?.textContent`), '다음 질문', 'undo queues it again');
  assert.equal(await ev(`document.querySelector('.hps-input textarea').value`), '', 'and the draft is as it was');
  await ev(`document.querySelector('.hps-queued-cancel').click()`); await pause();
  await ev(`window.setStreaming(false)`); await pause();
  assert.equal((await toast()).shown, 'false', 'once the turn ends there is nothing to wait for: the offer ends');

  // Recovery items keep confirm + 취소 and never offer 되돌리기 (UX38).
  await load({ seat: 'personal', dark: true, width: 800, draft: { recovered: [{ text: '보내지 못한 글', images: [], toolMode: 'auto' }] } });
  await ev(`[...document.querySelectorAll('.hps-recovered button')].find(x=>x.textContent==='삭제').click()`); await pause();
  assert.equal(await ev(`!!document.querySelector('.hps-recovery-confirm')`), true, 'recovery removal asks first');
  assert.equal((await toast()).shown, 'false', 'no undo toast for a recovery item');

  // Host-held chips: the host keeps the snapshot; only its answer for this id confirms the undo.
  await load({ seat: 'personal', dark: true, width: 800 });
  const file = { path: '노트/계획.md', bytes: 2048, text: '첫 줄' };
  await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
  await ev(`document.querySelector('.hps-file-context-remove').click()`); await pause();
  const fileId = await ev(`window.removedFile[0]`);
  assert.match(fileId, /^[A-Za-z0-9_-]{1,64}$/, 'the removal carries a host-valid undo id');
  assert.equal((await toast()).kind, 'file');
  await press();
  assert.deepEqual((await posts('restoreFileContext')).map(p => p.undoId), [fileId], 'undo asks the host for that snapshot');
  assert.deepEqual([(await toast()).text, await ev(`document.querySelector('.hps-undo-toast-action').getAttribute('aria-disabled')`)], ['파일을 뺐어요 되돌리기', 'true'], 'pending until the host answers (no optimistic success)');
  await hostSays({ type: 'removalUndoResult', undoId: 'someone-else', restored: true });
  assert.equal((await toast()).text, '파일을 뺐어요 되돌리기', 'another id is not this answer');
  await press();
  assert.deepEqual([(await toast()).text, (await posts('restoreFileContext')).length], ['파일을 뺐어요 되돌리기', 1], 'a second press while pending neither dismisses nor asks again');
  await hostSays({ type: 'removalUndoResult', undoId: fileId, restored: false });
  assert.ok((await toast()).text.startsWith('되돌리지 못했어요'), 'a refused restore says so and stays');
  await ev(`[...document.querySelectorAll('[data-testid="undo-toast"] button')].find(x=>x.textContent==='닫기').click()`); await pause();
  // A new chip in place of the removed one ends the offer (undo would overwrite it).
  await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
  await ev(`document.querySelector('.hps-file-context-remove').click()`); await pause();
  assert.equal((await toast()).kind, 'file');
  await ev(`window.setFile(${JSON.stringify({ ...file, path: '다른.md' })})`); await pause();
  assert.equal((await toast()).shown, 'false', 'a newer file chip ends the file offer');
  await ev(`window.setFile(null)`); await pause();
  // Backspace at the caret start removes the chip the same way.
  await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
  await ev(`(()=>{const t=document.querySelector('.hps-input textarea');t.focus();t.setSelectionRange(0,0)})()`);
  await key('Backspace', 'Backspace', 8); await pause();
  assert.equal((await ev(`window.removedFile.length`)), 3);
  await press();
  await hostSays({ type: 'removalUndoResult', undoId: await ev(`window.removedFile[2]`), restored: true });
  assert.equal((await toast()).text, '되돌렸어요');
  // A send makes the removal final: the host no longer holds the file, so the offer ends with it.
  await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
  await ev(`document.querySelector('.hps-file-context-remove').click()`); await pause();
  assert.equal((await toast()).kind, 'file');
  await ev(`document.querySelector('.hps-input textarea').focus()`); await b.send('Input.insertText', { text: '질문' }); await pause();
  assert.equal((await toast()).kind, 'file', 'typing does not end a host-chip offer');
  await key('Enter', 'Enter', 13); await pause(300);
  assert.equal((await toast()).shown, 'false', 'a send ends the offer');
  const page = { url: 'https://example.com/', title: '예시 페이지', text: '본문', textNote: null };
  await ev(`window.setPage(${JSON.stringify(page)})`); await pause();
  await ev(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('빼기')&&x.closest('.hps-page-attachment, [data-testid="page-attachment"]'))?.click()`); await pause();
  const pageId = await ev(`window.removedPage[0]`);
  assert.match(pageId ?? '', /^[A-Za-z0-9_-]{1,64}$/, 'the page removal carries an undo id');
  await press();
  assert.deepEqual((await posts('restorePageContext')).map(p => p.undoId), [pageId]);

  // Rename (task header): offered after the host saved it; undo asks the host and returns focus to the title.
  await ev(`document.querySelector('.tw-title-button').click()`); await pause();
  await ev(`(()=>{const i=document.querySelector('.tw-rename input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'내 계획');i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause();
  await ev(`document.querySelector('.tw-rename').requestSubmit()`); await pause();
  const rename = (await posts('taskRename')).at(-1);
  assert.equal(rename.title, '내 계획');
  // The host posts the saved workspace state first, then the result (chatPanelProvider handleTaskMessage).
  await ev(`window.setView({...window.view,revision:2,tasks:[{...window.view.tasks[0],title:'내 계획'}]})`); await pause();
  await hostSays({ type: 'taskRenameResult', requestId: rename.requestId, saved: true, undoId: 'undo-rename-1' });
  let t = await toast();
  assert.deepEqual([t.kind, t.button], ['rename', true]);
  assert.ok(t.text.startsWith('작업 이름을 바꿨어요'));
  await shot('rename-personal-800-dark');
  await press();
  assert.deepEqual((await posts('taskRenameUndo')).map(p => p.undoId), ['undo-rename-1']);
  await hostSays({ type: 'removalUndoResult', undoId: 'undo-rename-1', restored: true });
  await ev(`window.setView({...window.view,revision:3})`); await pause();
  assert.equal((await toast()).text, '되돌렸어요');
  assert.equal(await ev(`document.activeElement?.className`), 'tw-title-button', 'focus returns to the task title');
  // A title that changed since (another window, a later rename) ends the rename offer.
  await ev(`document.querySelector('.tw-title-button').click()`); await pause();
  await ev(`(()=>{const i=document.querySelector('.tw-rename input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'둘째 이름');i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause();
  await ev(`document.querySelector('.tw-rename').requestSubmit()`); await pause();
  await ev(`window.setView({...window.view,revision:4,tasks:[{...window.view.tasks[0],title:'둘째 이름'}]})`); await pause();
  await hostSays({ type: 'taskRenameResult', requestId: (await posts('taskRename')).at(-1).requestId, saved: true, undoId: 'undo-rename-2' });
  assert.equal((await toast()).kind, 'rename');
  await ev(`window.setView({...window.view,revision:5,tasks:[{...window.view.tasks[0],title:'다른 창에서 바꾼 이름'}]})`); await pause();
  assert.equal((await toast()).shown, 'false', 'a newer title ends the rename offer');

  // No host answer: a failure after 15 s, never a success; a late answer for the id still corrects it.
  await load({ seat: 'classroom', dark: true, width: 800 });
  await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
  await ev(`document.querySelector('.hps-file-context-remove').click()`); await pause();
  await press();
  await pause(14000);
  assert.equal((await toast()).text, '파일을 뺐어요 되돌리기', 'still waiting before 15 s');
  await pause(1500);
  assert.ok((await toast()).text.startsWith('되돌리지 못했어요'), 'no answer in 15 s is a failure');
  await pause(6500);
  assert.ok((await toast()).text.startsWith('되돌리지 못했어요'), 'a failure stays until 닫기 (CGP-DS-R-025)');
  await hostSays({ type: 'removalUndoResult', undoId: await ev(`window.removedFile[0]`), restored: true });
  assert.equal((await toast()).text, '되돌렸어요', 'a late restore corrects the failure');

  // ── every send path ends the offer: the host forgets the removed chip on any send ──
  const offerFile = async tag => {
    await ev(`window.setFile(${JSON.stringify(file)})`); await pause();
    await ev(`document.querySelector('.hps-file-context-remove').click()`); await pause();
    assert.deepEqual([(await toast()).kind, (await toast()).button], ['file', true], `${tag}: offered before the send`);
  };
  // Resend of an unsent message (보내지 못한 메시지 → 다시 보내기).
  await load({ seat: 'personal', dark: true, width: 800, draft: { recovered: [{ text: '보내지 못한 글', images: [], toolMode: 'auto' }] } });
  await offerFile('resend');
  await ev(`[...document.querySelectorAll('.hps-recovered button')].find(x=>x.textContent==='다시 보내기').click()`); await pause();
  assert.equal(await ev(`window.sent`), 1, 'resend: the unsent message went out');
  assert.equal((await toast()).shown, 'false', 'resend: a resend of an unsent message ends the offer');
  // Roll send (떠오른 것에 한 줄 더).
  const roll = { ux: { ...resolvedProfile(3).ux, hints: { ...resolvedProfile(3).ux.hints, roll_input_button: { enabled: true, label: '한 줄 더', probe_md: '' } } } };
  await load({ seat: 'classroom', dark: true, width: 800, profile: roll });
  await ev(`document.querySelector('.hps-input textarea').focus()`); await b.send('Input.insertText', { text: '첫 생각' }); await pause();
  await ev(`document.querySelector('.hps-btn-roll').click()`); await pause();
  await ev(`document.querySelector('.hps-input textarea').focus()`); await b.send('Input.insertText', { text: '보탠 생각' }); await pause();
  await offerFile('roll');
  await ev(`document.querySelector('.hps-btn-send').click()`); await pause();
  assert.equal(await ev(`window.sent`), 1, 'roll: the combined message went out');
  assert.equal((await toast()).shown, 'false', 'roll: a roll send ends the offer');
  // World chip (친구 고르기).
  await load({ seat: 'classroom', dark: true, width: 800, profile: { worlds: [{ id: 'w1', guest: '고양이', emoji: '🐱', chip: '고양이 세상에 가 볼래', aliases: [] }] } });
  await offerFile('world');
  await ev(`document.querySelector('.hps-worlds button').click()`); await pause();
  assert.equal(await ev(`window.sent`), 1, 'world: the chip went out');
  assert.equal((await toast()).shown, 'false', 'world: a world-chip send ends the offer');
  // A send from the other chat window (sidebar vs editor share the host): the host's echo ends a host-held offer.
  await load({ seat: 'classroom', dark: true, width: 800, draft: { images: [PNG] } });
  await offerFile('echo');
  await hostSays({ type: 'removalsFinal' });
  assert.equal((await toast()).shown, 'false', 'echo: a send from the other window ends the file offer');
  assert.equal(await ev(`window.sent`), 0, 'echo: nothing was sent from this window');
  await ev(`document.querySelector('.hps-attachment-remove').click()`); await pause();
  await hostSays({ type: 'removalsFinal' });
  assert.equal((await toast()).kind, 'image', 'echo: an offer this window holds by itself (its own image) is not the host\'s to end');

  // ── timing: 6 s, held while hovered or focused (classroom seat) ──
  await load({ seat: 'classroom', dark: true, width: 800, draft: { images: [PNG] } });
  await ev(`document.querySelector('.hps-attachment-remove').click()`); await pause();
  await pause(5500);
  assert.equal((await toast()).shown, 'true', 'still offered before 6 s');
  await pause(800);
  assert.equal((await toast()).shown, 'false', 'gone after 6 s');
  await load({ seat: 'classroom', dark: true, width: 800, draft: { images: [PNG] } });
  await ev(`document.querySelector('.hps-attachment-remove').click()`); await pause();
  const box = await ev(`(()=>{const r=document.querySelector('[data-testid="undo-toast"]').getBoundingClientRect();return {x:r.left+4,y:r.top+r.height/2}})()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await pause(6800);
  assert.equal((await toast()).shown, 'true', 'hover holds the toast');
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await pause(6400);
  assert.equal((await toast()).shown, 'false', 'a full 6 s after the hover ends, it goes');
  await load({ seat: 'classroom', dark: true, width: 800, draft: { images: [PNG] } });
  await ev(`document.querySelector('.hps-attachment-remove').click()`); await pause();
  await ev(`document.querySelector('.hps-undo-toast-action').focus()`);
  await pause(6800);
  assert.equal((await toast()).shown, 'true', 'focus holds the toast');
  // CGP-CHAT-D-029: the focus hold ends with the focus; the time then runs again (never shorter than 6 s).
  await ev(`document.querySelector('.hps-input textarea').focus()`);
  await pause(5500);
  assert.equal((await toast()).shown, 'true', 'after focus leaves, still offered before 6 s');
  await pause(900);
  assert.equal((await toast()).shown, 'false', 'a full 6 s after focus leaves, it goes');
  console.log(`PASS removal undo toast: geometry, behaviour per removal kind, timing${evidence ? ` (${shots} PNGs in ${evidence})` : ''}`);
} finally { await b.close(); }
