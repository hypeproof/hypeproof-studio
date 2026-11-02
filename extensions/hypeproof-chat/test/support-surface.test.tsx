import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
import { createRoot } from 'react-dom/client';
const dom = new JSDOM('<div id="root"></div>', {url:'https://studio.invalid'});
const posted: any[]=[];
Object.assign(globalThis, {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
(window as any).acquireVsCodeApi=()=>({postMessage:(m:any)=>posted.push(m),getState:()=>undefined,setState:()=>{}});
async function main() {
  const { StartPage } = await import('../webview-ui/src/StartPage');
  const { ChatErrorBoundary } = await import('../webview-ui/src/ChatErrorBoundary');
  const root=createRoot(document.getElementById('root')!);
  await act(async()=>root.render(<StartPage/>));
  const help=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='도움 요청 · 문제 신고')!;
  assert(help()); assert.equal(help().disabled,false); // startup busy, no account or token
  await act(async()=>help().click()); assert.equal(posted.at(-1).type,'startSupport');
  await act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state:{checking:true,version:'2026.1029.0',error:'연결하지 못했어요'}}})));
  assert.equal(help().disabled,false);
  await act(async()=>help().click()); assert.equal(posted.at(-1).type,'startSupport');
  // The broken renderer must use a host dialog, never attempt to open the failed chat dialog.
  const boundary=new ChatErrorBoundary({children:null}); boundary.state={err:new Error('synthetic render failure')};
  await act(async()=>root.render(boundary.render() as React.ReactElement));
  const fallback=[...document.querySelectorAll('button')].find(b=>b.textContent==='도움 요청')!;
  await act(async()=>fallback.click()); assert.equal(posted.at(-1).type,'supportFallback');
  await act(async()=>root.unmount());
  console.log('PASS: prelogin/busy/error help remains clickable; renderer recovery dispatches independent host fallback');
}
main().then(()=>{dom.window.close();process.exit(0);},e=>{console.error(e);dom.window.close();process.exit(1);});
