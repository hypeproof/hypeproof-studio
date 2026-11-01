import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const ext=fileURLToPath(new URL('../',import.meta.url));
const {build}=createRequire(ext+'/package.json')('esbuild');
const temp=await mkdtemp(path.join(os.tmpdir(),'studio-review-browser-'));
const bin=findChromium();assert.ok(bin,'headless browser required');
let browser;
try{
 await build({stdin:{contents:`import './tokens.css';import './focusGeometry.css';import './styles.css';import './chatDetails.css';import React from 'react';import {createRoot} from 'react-dom/client';import {FileContextChip} from './FileContextChip';
 window.file={path:'notes.txt',bytes:12000,text:'첫 문장'+String.fromCharCode(10)+('긴 자료 한 줄'+String.fromCharCode(10)).repeat(700)+'NEEDLE 마지막 문장'};
 createRoot(document.getElementById('root')).render(<FileContextChip file={window.file} onRemove={()=>{}}/>);`,resolveDir:ext+'/webview-ui/src',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:temp+'/ui.js',alias:{react:ext+'/webview-ui/node_modules/react','react-dom':ext+'/webview-ui/node_modules/react-dom'},loader:{'.svg':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},logLevel:'error'});
 const js=await readFile(temp+'/ui.js','utf8'),css=await readFile(temp+'/ui.css','utf8');
 browser=await launch(bin);
 const pause=()=>new Promise(r=>setTimeout(r,70));
 async function key(key,code,n){await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(key==='Enter'?{text:'\r'}:{})});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n});await pause();}
 for(const width of [320,800])for(const forcedColors of [false,true]){
  await browser.load(`<html lang="ko"><style>${css}</style><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`,{width,height:800,forcedColors});await pause();
  await browser.evaluate(`document.querySelector('.hps-file-context-name').focus();document.querySelector('.hps-file-context-name').click()`);await pause();
  await browser.evaluate(`document.querySelector('input[aria-label="파일 내용 검색"]').focus()`);
  await browser.send('Input.insertText',{text:'needle'});await pause();
  const result=await browser.evaluate(`(()=>{const d=document.querySelector('dialog'),s=document.querySelector('input[type=search]'),m=document.querySelector('mark'),p=document.querySelector('pre');const dr=d.getBoundingClientRect(),sr=s.getBoundingClientRect(),mr=m.getBoundingClientRect();return {width:innerWidth,dialogScroll:d.scrollTop,preScroll:p.scrollTop,match:m.textContent,original:p.textContent===window.file.text,searchVisible:sr.top>=dr.top&&sr.bottom<=dr.bottom,matchVisible:mr.top>=dr.top&&mr.bottom<=dr.bottom,overflow:d.scrollWidth>d.clientWidth+1}})()`);
  assert.equal(result.match,'NEEDLE');assert.equal(result.original,true);
  assert.equal(result.searchVisible,true,'finding a late match must keep search controls visible: '+JSON.stringify(result));
  assert.equal(result.matchVisible,true);assert.equal(result.overflow,false);
  await key('Tab','Tab',9);await key('Tab','Tab',9);
  assert.equal(await browser.evaluate(`document.activeElement.getAttribute('aria-label')`),'다음 검색 결과');
  await key('Enter','Enter',13);
  await key('Escape','Escape',27);
  assert.equal(await browser.evaluate(`document.querySelector('dialog').open`),false);
  assert.equal(await browser.evaluate(`document.activeElement.className`),'hps-file-context-name');
  console.log('PASS',JSON.stringify({width,forcedColors,...result}));
 }

}finally{if(browser)await browser.close();await rm(temp,{recursive:true,force:true});}
