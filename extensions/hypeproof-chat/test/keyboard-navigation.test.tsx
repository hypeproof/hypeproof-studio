import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { TaskWorkspaceFrame } from '../webview-ui/src/TaskWorkspace';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;
const view = { scope: 's', revision: 1, activeTaskId: 'a', sourceSelection: null, tasks: [{ id: 'a', title: '내 작업', createdAt: 1, updatedAt: 1, messageCount: 0 }] };
async function run() {
 const host = mountPoint(); let root = createRoot(host);
 const render = async (workspace = true) => act(() => root.render(<TaskWorkspaceFrame view={workspace ? view : undefined} messages={[]} busy={false} error={null} onDismissError={() => {}}><div className="hps-input"><textarea defaultValue="보존할 글" /></div></TaskWorkspaceFrame>));
 window.innerWidth = 1420; await render();
 const skip = host.querySelector('a');
 assert.equal(skip.textContent, '입력창으로 바로 가기'); assert.equal(skip.getAttribute('href'), '#chat-composer');
 await act(() => click(skip)); assert.equal(doc.activeElement, host.querySelector('textarea'));
 assert.equal(host.querySelector('textarea').value, '보존할 글');
 host.querySelector('textarea').disabled = true; skip.focus(); await act(() => click(skip)); assert.equal(doc.activeElement, skip, 'disabled composer must not receive focus'); host.querySelector('textarea').disabled = false;
 const key = async (el: any, key: string, extra = {}) => act(() => el.dispatchEvent({ type: 'keydown', bubbles: true, key, keyCode: 0, ...extra }));
 const size = (el: any) => Number(el.getAttribute('aria-valuenow'));
 const rail = host.querySelector('[role="separator"]');
 assert.equal(rail.getAttribute('aria-label'), '작업 목록 너비 조절'); assert.equal(rail.getAttribute('aria-controls'), 'task-rail');
 assert.equal(rail.getAttribute('tabindex'), '0'); assert.equal(rail.getAttribute('aria-orientation'), 'vertical');
 rail.focus(); assert.equal(doc.activeElement, rail);
 const start = size(rail); // the token width is measured from CSS; with no stylesheet it is the rail minimum
 assert.equal(host.querySelector('.tw-workspace').style['--tw-rail-width'], '', 'untouched rail keeps the token width');
 await key(rail, 'ArrowRight'); assert.equal(size(rail), start + 16);
 assert.equal(host.querySelector('.tw-workspace').style['--tw-rail-width'], `${start + 16}px`);
 await key(rail, 'ArrowLeft'); assert.equal(size(rail), start);
 await key(rail, 'ArrowRight', {shiftKey: true}); assert.equal(size(rail), start + 64);
 // CGP-SHELL-R-012: a size is remembered per seat across a re-mount (a reload), and another seat starts from the token width.
 await act(() => root.unmount()); const again = mountPoint(), root2 = createRoot(again);
 const frame = (scope: string) => <TaskWorkspaceFrame view={{ ...view, scope }} messages={[]} busy={false} error={null} onDismissError={() => {}}><div className="hps-input"><textarea /></div></TaskWorkspaceFrame>;
 await act(() => root2.render(frame('s'))); assert.equal(size(again.querySelector('[role="separator"]')), start + 64);
 await act(() => root2.render(frame('other-seat'))); assert.equal(size(again.querySelector('[role="separator"]')), start);
 await act(() => root2.render(frame('s'))); assert.equal(size(again.querySelector('[role="separator"]')), start + 64);
 await act(() => root2.unmount()); root = createRoot(host); await render();
 const rail2 = host.querySelector('[role="separator"]'); assert.equal(size(rail2), start + 64);
 for (const extra of [{isComposing:true}, {keyCode:229}, {altKey:true}, {ctrlKey:true}, {metaKey:true}, {defaultPrevented:true}]) {
  await key(rail2, 'ArrowLeft', extra); assert.equal(size(rail2), start + 64, JSON.stringify(extra));
 }
 await key(rail2, 'ArrowUp'); assert.equal(size(rail2), start + 64);
 for (let i=0;i<3;i++) await key(rail2, 'ArrowRight', {shiftKey:true});
 assert.equal(size(rail2), 320); assert.equal(rail2.getAttribute('aria-valuemin'), '200'); assert.equal(rail2.getAttribute('aria-valuemax'), '320');
 for (let i=0;i<3;i++) await key(rail2, 'ArrowLeft', {shiftKey:true});
 assert.equal(size(rail2), 200);
 await act(() => click(host.querySelector('.tw-sources-toggle')));
 const source = host.querySelector('.tw-splitter-sources'), sourceStart = size(source);
 assert.equal(source.getAttribute('aria-label'), '자료 패널 너비 조절'); assert.equal(source.getAttribute('aria-controls'), 'task-sources'); assert.equal(source.getAttribute('tabindex'), '0');
 await key(source, 'ArrowLeft'); assert.equal(size(source), sourceStart + 16); assert.equal(source.getAttribute('aria-valuetext'), `${sourceStart + 16} 픽셀`);
 assert.equal(host.querySelector('.tw-workspace').style['--tw-source-width'], `${sourceStart + 16}px`);
 await key(source, 'ArrowRight'); assert.equal(size(source), sourceStart);
 for (let i=0;i<3;i++) await key(source, 'ArrowLeft', {shiftKey:true}); assert.equal(size(source), 400);
 for (let i=0;i<4;i++) await key(source, 'ArrowRight', {shiftKey:true}); assert.equal(size(source), 240);
 window.innerWidth = 800; await act(() => window.dispatchEvent({type:'resize'} as any));
 assert.equal(host.querySelector('.tw-splitter-sources'), null); assert.ok(host.querySelector('.tw-splitter-rail'));
 host.querySelector('.tw-splitter-rail').focus();
 window.innerWidth = 600; await act(() => window.dispatchEvent({type:'resize'} as any)); assert.equal(host.querySelector('[role="separator"]'), null); assert.equal(doc.activeElement, host.querySelector('.tw-rail-toggle')); 
 await render(false); await act(() => click(host.querySelector('.hps-skip-input'))); assert.equal(doc.activeElement, host.querySelector('textarea'));
 await act(() => root.unmount());
 const second = mountPoint(), r = createRoot(second); doc.body.focus();
 await act(() => r.render(<TaskWorkspaceFrame messages={[]} busy={false} error={null} onDismissError={() => {}}><ChatPanel {...({config:{activity:{id:'a',kind:'classroom',name:'수업',workspace:'/tmp/test',verified:true}, hasToken:true, model:'fixture', proxyUrl:'http://localhost', coach:{name:'HypeProof', personality:'', configured:true}}, messages:[], streaming:false, error:null, onSend:()=>{}, onCancel:()=>{}, onClear:()=>{}, onSetToken:()=>{}} as any)} /></TaskWorkspaceFrame>));
 second.querySelector('.hps-skip-input').focus(); assert.notEqual(doc.activeElement, second.querySelector('textarea'));
 await act(() => click(second.querySelector('.hps-skip-input'))); assert.equal(doc.activeElement, second.querySelector('textarea'));
 await act(() => r.unmount());
 console.log('PASS keyboard navigation: skip, splitters, bounds, modifiers, responsive removal, composer');
}
run().then(() => process.exit(0)).catch(e => {console.error(e); process.exit(1);});
