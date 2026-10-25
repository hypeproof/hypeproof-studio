// #2646: the start page's "저장된 활동" rows share one left edge, span the card, read as 44px choices,
// and show a short workspace (full path in the title and the accessible name, no mid-path wrap).
// Mounts the real webview bundle on the start surface in headless Chromium and measures it.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN start saved activities: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'start-assets',write:false,loader:{'.svg':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,js=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const long='/Users/learner/Library/Application Support/HypeProof/local-trial-744/workspace';
const activities=[
 {ref:'r1',id:'a1',name:'첫 활동',kind:'trial',workspace:long},
 {ref:'r2',id:'a2',name:'이름이 조금 더 긴 두 번째 활동',kind:'personal',workspace:'/Users/learner/Documents/수업 자료/2학기 프로젝트'},
 {ref:'r3',id:'a3',name:'교실',kind:'classroom',workspace:'C:\\Users\\learner\\Documents\\class'},
 // A folder name longer than any row: its short form must end in an ellipsis, never widen the page (320 px included).
 {ref:'r4',id:'a4',name:'긴 폴더',kind:'personal',workspace:'/Users/learner/Documents/HypeProof Studio Projects - 2026 Fall Semester - Class A - '+'very long folder name '.repeat(6)+'/workspace'},
];
const b=await launch(bin);
try{for(const dark of [true,false])for(const width of [320,800,1420]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<!doctype html><html data-surface="start" style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){},setState(){}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
 await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'1.0.0',activities:${JSON.stringify(activities)}}}}))`);
 let rows=null;for(let n=0;n<50&&!rows;n++){rows=await b.evaluate(`document.querySelectorAll('.studio-saved-activities button').length===4||null`);if(!rows)await new Promise(r=>setTimeout(r,20));}
 assert.ok(rows,`${width}px: the four saved activities render`);
 const m=await b.evaluate(`(()=>{const nav=document.querySelector('.studio-saved-activities'),n=nav.getBoundingClientRect(),s=getComputedStyle(nav);const inner=n.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);return {inner,page:document.documentElement.scrollWidth,rows:[...nav.querySelectorAll('button')].map(el=>{const r=el.getBoundingClientRect(),small=el.querySelector('small'),sr=small.getBoundingClientRect();const ss=getComputedStyle(small);return {left:r.left,width:r.width,height:r.height,title:el.title,name:el.getAttribute('aria-label'),visible:small.textContent,smallHeight:sr.height,line:parseFloat(ss.lineHeight)||parseFloat(ss.fontSize)*1.5,wrap:ss.whiteSpace,cut:small.scrollWidth>small.clientWidth,ellipsis:ss.textOverflow,clip:ss.overflowX,inside:sr.right<=r.right+0.5}})}})()`);
 const label=`${width}px ${dark?'dark':'light'}: ${JSON.stringify(m)}`;
 const lefts=m.rows.map(r=>r.left);
 assert.ok(Math.max(...lefts)-Math.min(...lefts)<0.5,'every row starts at the same left edge: '+label);
 for(const r of m.rows){
  assert.ok(Math.abs(r.width-m.inner)<1,'each row spans the card: '+label);
  assert.ok(r.height>=44,'each row is a 44px target: '+label);
  assert.equal(r.wrap,'nowrap','the workspace line never wraps mid-path: '+label);
  assert.ok(r.smallHeight<=r.line*1.5,'the workspace line stays on one line: '+label);
  assert.ok(r.inside,'the workspace line ends inside its row: '+label);
 }
 assert.deepEqual(m.rows.map(r=>r.title),activities.map(a=>a.workspace),'the full path stays in the title');
 assert.ok(m.rows.every((r,i)=>r.name.endsWith(', '+activities[i].workspace)),'the full path is in the accessible name: '+label);
 assert.deepEqual(m.rows.map(r=>r.visible).slice(0,3),['…/local-trial-744/workspace','…/수업 자료/2학기 프로젝트','…\\Documents\\class'],'the visible workspace is short: '+label);
 const longRow=m.rows[3];
 assert.ok(longRow.cut&&longRow.ellipsis==='ellipsis'&&longRow.clip==='hidden','a folder longer than the row ends in an ellipsis: '+label);
 assert.ok(m.page<=width+1,'no horizontal page scroll: '+label);
}
console.log('PASS start page saved activities: one left edge, full width, 44px rows and short workspaces at 320/800/1420 px in both themes');
}finally{await b.close();}
