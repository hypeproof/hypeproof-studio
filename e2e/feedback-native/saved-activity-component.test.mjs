// Actual StartPage DOM contract + native helper selection; no desktop/model/input launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {NativeUI} from './native-ui.mjs';
const require=createRequire(new URL('../../extensions/hypeproof-chat/package.json',import.meta.url));
const {build}=require('esbuild'),{JSDOM}=require('jsdom');

test('saved activity uses the real component full path while visible workspace remains shortened',async()=>{
 const directory=fileURLToPath(new URL('../../extensions/hypeproof-chat/webview-ui/',import.meta.url));
 const bundle=await build({entryPoints:[directory+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'native-start-contract',write:false,loader:{'.svg':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl'},logLevel:'silent'});
 const dom=new JSDOM('<!doctype html><html data-surface="start"><body><div id="root"></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 try{
  dom.window.acquireVsCodeApi=()=>({postMessage(){},getState(){},setState(){}});
  dom.window.TextEncoder=TextEncoder;dom.window.TextDecoder=TextDecoder;
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.eval(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);
  const wanted=process.platform==='win32'?'C:\\Users\\runner\\owned\\activity-B':'/Users/runner/owned/activity-B';
  const foreign=process.platform==='win32'?'D:\\Users\\runner\\owned\\activity-B':'/another/runner/owned/activity-B';
  const activities=[{ref:'foreign',id:'foreign',name:'Other activity',kind:'classroom',workspace:foreign},{ref:'owned',id:'owned',name:'Owned activity',kind:'classroom',workspace:wanted}];
  const show=async rows=>{
   dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'fixture',activities:rows}}}));
   for(let n=0;n<100;n++){if(dom.window.document.querySelectorAll('.studio-saved-activities button').length===rows.length)return;await new Promise(resolve=>setTimeout(resolve,10));}
   throw Error('Actual StartPage did not render saved activity rows');
  };
  await new Promise(resolve=>setTimeout(resolve,20));await show(activities);
  const buttons=[...dom.window.document.querySelectorAll('.studio-saved-activities button')];
  assert.equal(buttons[1].title,wanted);assert.ok(buttons[1].getAttribute('aria-label').endsWith(', '+wanted));
  assert.notEqual(buttons[1].querySelector('small').textContent,wanted);assert.ok(buttons[1].querySelector('small').textContent.startsWith('…'));
  const ui=new NativeUI('http://127.0.0.1:9777'),pressed=[],view={evaluate:async expression=>dom.window.eval(expression)};
  ui.press=async(_view,selector)=>{assert.equal(dom.window.document.querySelector(selector).title,wanted);pressed.push(selector);};
  await ui.savedActivity(view,wanted,50);
  assert.deepEqual(pressed,['.studio-saved-activities button:nth-of-type(2)']);
  await show([...activities,{...activities[1],ref:'duplicate'}]);
  await assert.rejects(ui.savedActivity(view,wanted,1),/unique saved activity/);
  assert.equal(pressed.length,1,'ambiguous full identity must never click');
 }finally{dom.window.close();}
});
