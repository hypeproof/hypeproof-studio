import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'probe-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,js=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const bin=findChromium();assert.ok(bin,'Chromium required');const b=await launch(bin);
const evidence=process.env.ACCESS_EVIDENCE ?? mkdtempSync(join(tmpdir(),'hps-classroom-composer-'));mkdirSync(evidence,{recursive:true});
const settle=()=>new Promise(r=>setTimeout(r,100));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle()};
const workspace={scope:'access-test',revision:1,activeTaskId:'t1',sourceSelection:null,tasks:[{id:'t1',title:'고양이 페이지',createdAt:1,updatedAt:1,messageCount:1},{id:'t2',title:'다른 작업',createdAt:1,updatedAt:1,messageCount:0}]};
const personalConfig=chatConfig(3,{activity:{...chatConfig().activity,id:'access-test',kind:'personal'},profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},taskWorkspace:workspace});

const hash=x=>createHash('sha256').update(x).digest('hex');
writeFileSync(`${evidence}/bundle.js`,js);writeFileSync(`${evidence}/bundle.css`,css);writeFileSync(`${evidence}/runtime.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:dir}).trim(),node:process.version,nodeSHA256:hash(readFileSync(process.execPath)),chromium:bin,chromiumSHA256:hash(readFileSync(bin)),jsSHA256:hash(js),cssSHA256:hash(css)},null,2));
const results=[];
const measure=()=>b.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea'),c=document.querySelector('.hps-input');const r=t.getBoundingClientRect(),ts=getComputedStyle(t),cs=getComputedStyle(c);return {mode:document.querySelector('.hps-shell').dataset.chatDetail,height:r.height,client:t.clientHeight,scroll:t.scrollHeight,lines:t.value.split(String.fromCharCode(10)).length,textareaOutline:ts.outlineStyle==='none'?'0px':ts.outlineWidth,cardOutline:cs.outlineStyle==='none'?'0px':cs.outlineWidth,textareaOutlineStyle:ts.outlineStyle,cardOutlineStyle:cs.outlineStyle,focused:document.activeElement===t}})()`);
try {
for(const width of [390,1420])for(const height of [600,1000])for(const personal of [false,true])for(const forcedColors of [false,true]) {
 const vars=Object.entries(THEMES['Dark+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="vscode-dark"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}})</script><script>${js}</script>`,{width,height,dark:true,forcedColors});
 await settle();await send({type:'config',config:personal?personalConfig:chatConfig()});
 await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await settle();
 const before=await measure();
 await b.send('Input.insertText',{text:Array.from({length:12},(_,i)=>'검토할 문장 '+i).join('\n')});await settle();
 const after=await measure();assert.equal(after.lines,12);assert.equal(after.focused,true);
 const grows=after.height>before.height+10;
 const cardFocus=parseFloat(after.cardOutline)>0&&parseFloat(after.textareaOutline)===0;
 assert.ok(after.height<=192&&after.height<=height/3+1,'bounded editor');
 const pos=await b.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');t.scrollTop=0;const r=t.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await b.send('Input.dispatchMouseEvent',{type:'mouseWheel',...pos,deltaX:0,deltaY:300});await settle();
 const scrollTop=await b.evaluate(`document.querySelector('.hps-input textarea').scrollTop`);
 assert.ok(scrollTop>0,'long input remains internally scrollable');
 await b.evaluate(`document.querySelector('.hps-input textarea').select()`);
 await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await settle();
 const cleared=await measure();assert.equal(cleared.lines,1);assert.ok(cleared.height<after.height,'cleared text shrinks input');
 results.push({width,height,personal,forcedColors,before,after,cleared,scrollTop,grows,cardFocus});
 writeFileSync(`${evidence}/${width}-${height}-${personal}-${forcedColors}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.equal(await b.evaluate(`posted.filter(m=>m.type==='send').length`),0);
}
writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert.ok(results.filter(r=>r.personal).every(r=>r.grows&&r.cardFocus),'personal positive control');
assert.ok(results.filter(r=>!r.personal).every(r=>r.grows&&r.cardFocus),'classroom must grow and place focus ring on composer card');
}finally{await b.close()}
