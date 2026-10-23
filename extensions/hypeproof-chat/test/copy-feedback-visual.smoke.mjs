// The visible code-copy failure on real ChatPanel markup, not just the hook fixture.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN copy feedback visual: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'copy-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';createRoot(document.getElementById('root')).render(React.createElement(ChatPanel,window.__copyProps));`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin);const evidence=process.env.COPY_FEEDBACK_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
  const props=chatPanelProps({config,messages:[{id:'copy-answer',role:'assistant',createdAt:1,content:'코드를 확인해 주세요.\n\n    const answer = 42;'}]});
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div id="root"></div></div><script>window.__copyProps=${JSON.stringify(props)};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('synthetic denied')}}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:900,dark});
  // Force the failure path: headless clipboard access differs by platform (denied on macOS, granted on Linux CI).
  await b.evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})`);
  await b.evaluate(`document.querySelector('[aria-label="코드 복사"]').click()`);await new Promise(r=>setTimeout(r,40));
  const state=await b.evaluate(`(()=>{const e=document.querySelector('.hps-codeblock-status');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {role:e.getAttribute('role'),text:e.textContent,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth}})()`);
  assert.equal(state.role,'alert');assert.match(state.text,/복사하지 못했습니다/);assert.equal(state.visible,true);
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/studio-${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
 }
 console.log('PASS real ChatPanel copy failure visibility/alert, both seats/themes at800/1420');
}finally{await b.close()}
