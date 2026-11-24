import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createRoot } from 'react-dom/client';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', {url:'https://studio.invalid'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
(window as any).acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});
const FALLBACK='생각에서, 나의 결과물로';
// The start page's top line is the only place the greeting is seen; every case drives it through StartPage.
async function main(){
 const {StartPage}=await import('../webview-ui/src/StartPage');
 const root=createRoot(document.getElementById('root')!);
 await act(async()=>root.render(<StartPage/>));
 const base={checking:false,version:'test',freeStart:{age:'14+',claiming:false},purchase:{available:false}};
 const show=async(account:any)=>{
  await act(async()=>{window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state:{...base,account}}}));});
  const eyebrow=document.querySelector('.studio-eyebrow')!;
  return {text:eyebrow.textContent!.trim(),marked:eyebrow.getAttribute('data-testid')==='account-greeting'};
 };
 const named=(display_name?:string)=>({status:'signedIn',account:{display_name,email:'member@example.invalid'},passes:[]});

 // test_tc_0153_signed_out_and_missing_account_return_null
 for (const account of [{status:'signedOut'},undefined,{status:'waiting',userCode:'ABCD1234'}]) {
  const seen=await show(account);
  assert.equal(seen.text,FALLBACK,JSON.stringify(account)); assert.equal(seen.marked,false);
 }

 // test_tc_0154_blank_or_missing_display_name_greets_without_a_name
 for (const name of ['   ','\n\t ',undefined,'']) {
  const seen=await show(named(name));
  assert.equal(seen.text,'안녕하세요.',JSON.stringify(name)); assert.equal(seen.marked,true);
 }
 assert.equal((await show({status:'signedIn',passes:[]})).text,'안녕하세요.');

 // test_tc_0155_control_characters_become_spaces_and_name_is_trimmed
 assert.equal((await show(named('  Kim\nLee  '))).text,'안녕하세요, Kim Lee님.');
 assert.equal((await show(named('\u0007Kim\u007fLee\t'))).text,'안녕하세요, Kim Lee님.');

 // test_tc_0156_display_name_is_cut_to_80_code_points
 assert.equal((await show(named('a'.repeat(81)))).text,`안녕하세요, ${'a'.repeat(80)}님.`);
 assert.equal((await show(named('a'.repeat(80)))).text,`안녕하세요, ${'a'.repeat(80)}님.`);
 const emoji=String.fromCodePoint(0x1F600);
 assert.equal((await show(named('a'.repeat(79)+emoji))).text,`안녕하세요, ${'a'.repeat(79)}${emoji}님.`);
 assert.equal((await show(named('a'.repeat(79)+emoji+'b'))).text,`안녕하세요, ${'a'.repeat(79)}${emoji}님.`);

 await act(async()=>root.unmount()); dom.window.close();
 console.log('PASS: start page greeting follows sign-in state, name cleaning and the 80 code point limit');
}
main().then(()=>process.exit(0),e=>{console.error(e);dom.window.close();process.exit(1)});
