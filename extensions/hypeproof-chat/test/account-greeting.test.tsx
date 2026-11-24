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
// StartPage calls accountGreeting(state.account) for that line, so the exact return value is also pinned
// where the screen cannot tell two values apart (null vs undefined both show the fallback).
const base={checking:false,version:'test',freeStart:{age:'14+',claiming:false},purchase:{available:false}};
const named=(display_name?:string)=>({status:'signedIn',account:{display_name,email:'member@example.invalid'},passes:[]});
let show:(account:any)=>Promise<{text:string,marked:boolean}>;
let greet:(account:any)=>string|null;

async function test_tc_0153_signed_out_and_missing_account_return_null(){
 for (const account of [{status:'signedOut'},undefined,{status:'waiting',userCode:'ABCD1234'}]) {
  assert.strictEqual(greet(account),null,JSON.stringify(account));
  const seen=await show(account);
  assert.equal(seen.text,FALLBACK,JSON.stringify(account)); assert.equal(seen.marked,false);
 }
}

async function test_tc_0154_blank_or_missing_display_name_greets_without_a_name(){
 for (const name of ['   ','\n\t ',undefined,'']) {
  assert.strictEqual(greet(named(name)),'안녕하세요.',JSON.stringify(name));
  const seen=await show(named(name));
  assert.equal(seen.text,'안녕하세요.',JSON.stringify(name)); assert.equal(seen.marked,true);
 }
 assert.equal((await show({status:'signedIn',passes:[]})).text,'안녕하세요.');
}

async function test_tc_0155_control_characters_become_spaces_and_name_is_trimmed(){
 assert.equal((await show(named('  Kim\nLee  '))).text,'안녕하세요, Kim Lee님.');
 assert.equal((await show(named('\u0007Kim\u007fLee\t'))).text,'안녕하세요, Kim Lee님.');
}

async function test_tc_0156_display_name_is_cut_to_80_code_points(){
 assert.equal((await show(named('a'.repeat(81)))).text,`안녕하세요, ${'a'.repeat(80)}님.`);
 assert.equal((await show(named('a'.repeat(80)))).text,`안녕하세요, ${'a'.repeat(80)}님.`);
 const emoji=String.fromCodePoint(0x1F600);
 assert.equal((await show(named('a'.repeat(79)+emoji))).text,`안녕하세요, ${'a'.repeat(79)}${emoji}님.`);
 assert.equal((await show(named('a'.repeat(79)+emoji+'b'))).text,`안녕하세요, ${'a'.repeat(79)}${emoji}님.`);
}

async function main(){
 const {StartPage}=await import('../webview-ui/src/StartPage');
 greet=(await import('../src/accountGreeting')).accountGreeting as any;
 const root=createRoot(document.getElementById('root')!);
 await act(async()=>root.render(<StartPage/>));
 show=async(account:any)=>{
  await act(async()=>{window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state:{...base,account}}}));});
  const eyebrow=document.querySelector('.studio-eyebrow')!;
  return {text:eyebrow.textContent!.trim(),marked:eyebrow.getAttribute('data-testid')==='account-greeting'};
 };
 for (const t of [test_tc_0153_signed_out_and_missing_account_return_null,test_tc_0154_blank_or_missing_display_name_greets_without_a_name,test_tc_0155_control_characters_become_spaces_and_name_is_trimmed,test_tc_0156_display_name_is_cut_to_80_code_points]) {
  try { await t(); console.log(`ok - ${t.name}`); }
  catch (e) { console.error(`not ok - ${t.name}`); throw e; }
 }
 await act(async()=>root.unmount()); dom.window.close();
 console.log('PASS: start page greeting follows sign-in state, name cleaning and the 80 code point limit (TC-0153, TC-0154, TC-0155, TC-0156)');
}
main().then(()=>process.exit(0),e=>{console.error(e);dom.window.close();process.exit(1)});
