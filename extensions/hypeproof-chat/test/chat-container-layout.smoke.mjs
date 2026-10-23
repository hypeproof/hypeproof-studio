// CGP-DS-R-013: pane resizing must work without resizing the window.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { renderComponent } from './sx-render.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN chat container layout: no Chromium');process.exit(0);}
const built=await build({entryPoints:[fileURLToPath(new URL('../webview-ui/src/main.tsx',import.meta.url))],bundle:true,platform:'browser',format:'esm',outdir:'layout-test-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
const browser=await launch(bin);const evidence=process.env.CHAT_CONTAINER_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
try{
 for(const seat of ['personal','classroom']){
  const config=chatConfig(3,{taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined,profile:{...chatConfig().profile,lesson:null},activity:{id:'layout',name:'패널 너비 확인',kind:seat,workspace:'/w',verified:true}});
  const markup=await renderComponent('ChatPanel',chatPanelProps({config,messages:[{id:'answer',role:'assistant',createdAt:1,content:'창 크기를 유지하면서 대화를 읽고 입력할 수 있어요.\n\n긴 문장도 패널 안에서 줄을 바꿉니다.'}]}));
  for(const dark of [false,true])for(const viewport of [800,1420]){
   const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
   await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><main id="pane" style="width:280px;height:800px">${markup}</main></body></html>`,{width:viewport,height:900,dark});
   // A real comparison component uses this grid. Probe it inside the actual chat container;
   // its independent test owns the data/content contract.
   await browser.evaluate(`{const compare=document.createElement('div');compare.className='hp-evidence-compare';for(const text of ['이전','이후']){const cell=document.createElement('div');cell.textContent=text;compare.append(cell)};document.querySelector('.hps-messages').append(compare)}`);
   await browser.evaluate(`{const sibling=document.getElementById('pane').cloneNode(true);sibling.id='sibling';sibling.style.cssText='position:absolute;left:-2000px;width:720px;height:800px';document.body.append(sibling)}`);
   // Probes for every converted container rule, placed inside the real shell. They are invisible and out of flow,
   // so they cannot change the sweep measurements; the window width stays fixed while only the pane changes.
   await browser.evaluate(`{const shell=document.querySelector('.hps-shell');const add=(html)=>{const t=document.createElement('div');t.innerHTML=html;const el=t.firstElementChild;el.style.cssText+=';position:absolute;visibility:hidden;pointer-events:none';el.dataset.probe='1';shell.append(el);return el};
    add('<div class="hps-attachment-failure" id="p-fail"><strong>x</strong><p>y</p><button>a</button><button>b</button></div>');
    add('<div class="hps-header" id="p-cap"><span class="hps-coach-name">c</span><button class="hp-capability-reopen">r</button></div>');
    add('<div class="hps-header" id="p-access"><span class="hps-coach-name">c</span><div class="hps-access-header">a</div></div>');
    add('<div class="hps-turn-split" id="p-split"><div>a</div><div>b</div></div>');
    add('<div class="hp-ai-can-do" id="p-cando"></div>');
    add('<div class="hps-preview-recovery" id="p-recovery"></div>');
    add('<div class="cp-rack" id="p-rack" style="width:200px"><div role="listitem"><div class="cp-citation">c</div></div></div>');}`);
   const measures=[];
   for(const width of [280,360,389,390,391,447,448,600,640,641,687,688,720,1023,1024,1100,360]){
    await browser.evaluate(`document.getElementById('pane').style.width='${width}px'`);
    const m=await browser.evaluate(`(()=>{const q=s=>document.querySelector(s);const msg=q('.hps-messages'),shell=q('.hps-shell');return {viewport:innerWidth,width:shell.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(msg).paddingLeft),columns:getComputedStyle(q('.hp-evidence-compare')).gridTemplateColumns.split(' ').length,overflow:shell.scrollWidth>shell.clientWidth+1,font:parseFloat(getComputedStyle(q('.hps-msg-body')).fontSize),
     failRow:getComputedStyle(q('#p-fail button')).gridRowEnd,failTracks:getComputedStyle(q('#p-fail')).gridTemplateColumns,capWrap:getComputedStyle(q('#p-cap')).flexWrap,accessWrap:getComputedStyle(q('#p-access')).flexWrap,splitDisplay:getComputedStyle(q('#p-split')).display,
     candoMargin:getComputedStyle(q('#p-cando')).marginLeft,recoveryMargin:getComputedStyle(q('#p-recovery')).marginLeft,citationMax:getComputedStyle(q('#p-rack .cp-citation')).maxWidth,itemWidth:getComputedStyle(q('#p-rack > [role=listitem]')).width,rackWidth:getComputedStyle(q('#p-rack')).width}})()`);
    assert.equal(m.viewport,viewport);assert.equal(m.width,width);assert.equal(m.columns,width>=688?2:1,`pane ${width} at viewport ${viewport} must select comparison columns`);
    assert.equal(m.failRow,width<448?'auto':'span 2',`attachment failure buttons at pane ${width}/${viewport}`);
    assert.equal(m.capWrap,width<688?'wrap':'nowrap',`capability header wrap at pane ${width}/${viewport}`);
    assert.equal(m.accessWrap,width<=640?'wrap':'nowrap',`classroom access header wrap at pane ${width}/${viewport}`);
    assert.equal(m.splitDisplay,width>=1024?'grid':'none',`turn split at pane ${width}/${viewport}`);
    assert.equal(m.citationMax==='100%',width<=390,`citation rack at pane ${width}/${viewport}: ${m.citationMax}`);
    assert.equal(m.itemWidth===m.rackWidth,width<=390,`citation item fills the narrow pane at ${width}/${viewport}: ${m.itemWidth} in ${m.rackWidth}`);
    assert.equal(m.overflow,false,`horizontal overflow ${seat}/${width}`);if(seat==='personal')assert.ok(m.font>=14,JSON.stringify(m));
    const siblingColumns=await browser.evaluate(`getComputedStyle(document.querySelector('#sibling .hp-evidence-compare')).gridTemplateColumns.split(' ').length`);
    assert.equal(siblingColumns,2,'another pane keeps its independent wide layout');
    measures.push({...m,pane:width});
    if(evidence&&[280,360,448,600,720].includes(width)){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${viewport}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
   }
   // A chat pane is a flex item in the host layout: wide content inside must not push the pane past its track.
   await browser.evaluate(`{const pane=document.getElementById('pane');const flex=document.createElement('div');flex.id='flexhost';flex.style.cssText='display:flex;width:300px;height:800px';pane.before(flex);pane.style.cssText='width:auto;height:800px;display:flex;flex:0 1 auto';flex.append(pane);const shell=pane.querySelector('.hps-shell');const wide=document.createElement('div');wide.style.cssText='width:900px;height:10px';shell.querySelector('.hps-messages').append(wide)}`);
   const flexWidth=await browser.evaluate(`document.querySelector('.hps-shell').getBoundingClientRect().width`);
   assert.ok(flexWidth<=300,`pane shrinks inside a flex parent (min-width:0): ${flexWidth} at ${viewport}`);
   const at=w=>measures.find(m=>m.pane===w);
   if(seat==='personal'){
    assert.ok(at(447).padding<at(448).padding,'compact ends at 448px');
    assert.equal(at(280).padding,at(360).padding);assert.equal(at(360).padding,measures.at(-1).padding,'shrinking restores compact');
    for(const key of ['candoMargin','recoveryMargin']){
     assert.equal(at(280)[key],at(447)[key],`${key} stays compact below 448 (${viewport})`);
     assert.equal(at(448)[key],at(720)[key],`${key} is regular from 448 (${viewport})`);
     assert.notEqual(at(447)[key],at(448)[key],`${key} changes at the 448 boundary (${viewport}): ${at(447)[key]} vs ${at(448)[key]}`);
    }
   }
  }
 }
 console.log('PASS fixed-window pane sweeps: both seats/themes, 800/1420 windows, compact 448 and wide 688 boundaries, shrink-back and no horizontal overflow');
}finally{await browser.close();}
