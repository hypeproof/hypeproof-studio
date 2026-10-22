// CGP-SHELL-R-012 (REQ-SHELL-12 / DES-SHELL-11): the skip link and the panel splitters, measured in headless Chromium on the real
// markup. Real Tab / Arrow / mouse events go through the DevTools protocol into the headless page only. The static part below only
// guards the one thing a computed test cannot see: that this stylesheet never redraws the shared focus ring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url)), postcss = require('postcss');
const own = postcss.parse(readFileSync(new URL('../webview-ui/src/keyboardNavigation.css', import.meta.url), 'utf8'));
own.walkDecls(/^outline/, d => assert.fail(`keyboardNavigation.css must not draw its own ring (${d.parent.selector} ${d.prop}); focusGeometry.css owns it`));
console.log('PASS keyboard navigation stylesheet leaves the focus ring to focusGeometry.css');
const bin = process.env.KEYBOARD_STATIC_ONLY ? null : findChromium();
if (!bin) {
 if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('FOCUS_REQUIRE_BROWSER=1: no Chromium');
 console.log('NOT RUN keyboard navigation computed layout: no Chromium');
} else {
 let browser;
 try { browser = await launch(bin); } catch (error) {
  if (process.env.FOCUS_REQUIRE_BROWSER) throw error;
  console.log(`NOT RUN keyboard navigation computed layout: ${error.message}`);
  process.exit(0);
 }
 try {
  const entry = `import './webview-ui/src/tokens.css'; import './webview-ui/src/focusGeometry.css'; import './webview-ui/src/localReview.css'; import './webview-ui/src/start.css';
   import React from 'react'; import {createRoot} from 'react-dom/client';
   import {TaskWorkspaceFrame} from './webview-ui/src/TaskWorkspace'; import {ChatPanel} from './webview-ui/src/ChatPanel';
   import './webview-ui/src/styles.css'; import './webview-ui/src/chatDetails.css'; import './webview-ui/src/tooltips.css'; import './webview-ui/src/koreanProse.css';
   const view={scope:'seat-a',revision:1,activeTaskId:'a',sourceSelection:null,tasks:[{id:'a',title:'내 작업',createdAt:1,updatedAt:1,messageCount:0}]};
   window.renderSeat=(personal)=>createRoot(document.getElementById('root')).render(<TaskWorkspaceFrame view={personal?view:undefined} messages={[]} busy={false} error={null} onDismissError={()=>{}}><ChatPanel config={{activity:{id:'a',kind:personal?'personal':'classroom',name:'수업',workspace:'/tmp/test',verified:true},hasToken:true,model:'fixture',proxyUrl:'http://localhost',coach:{name:'HypeProof',personality:'',configured:true}}} messages={[]} streaming={false} error={null} onSend={()=>{}} onCancel={()=>{}} onClear={()=>{}} onSetToken={()=>{}} /></TaskWorkspaceFrame>);`;
  const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',format:'iife',jsx:'automatic',alias:{react:'./webview-ui/node_modules/react','react-dom':'./webview-ui/node_modules/react-dom'},loader:{'.svg':'dataurl'}});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text, style=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = x => browser.evaluate(x);
  // The webview state survives a page reload the way VS Code's does: the stub keeps it on the window, which a reload keeps here
  // because every load below re-runs the page in the same frame.
  const load = async (personal, width, dark, forcedColors) => {
   await browser.load(`<html lang="ko"><style>${style}html,body,#root{height:100%;margin:0}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>window.__vsState,setState:s=>{window.__vsState=s}})</script><script>${js}</script><script>renderSeat(${personal})</script></body></html>`,{width,dark,forcedColors});
   await sleep(100);
  };
  const key = async (name, code, vk, modifiers = 0, text) => {
   await browser.send('Input.dispatchKeyEvent',{type:text?'keyDown':'rawKeyDown',key:name,code,windowsVirtualKeyCode:vk,modifiers,text});
   await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:vk,modifiers});
   await sleep(30);
  };
  const fromTop = () => ev(`(()=>{document.activeElement.blur();document.body.setAttribute('tabindex','-1');document.body.focus();document.body.removeAttribute('tabindex')})()`);
  const tab = (shift = false) => key('Tab','Tab',9,shift?8:0);
  const arrow = (dir, shift = false) => key(dir>0?'ArrowRight':'ArrowLeft',dir>0?'ArrowRight':'ArrowLeft',dir>0?39:37,shift?8:0);
  const mouse = async (type, x, y) => { await browser.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:1}); await sleep(30); };
  // Page-side helpers: effective background behind a point, WCAG contrast, rectangle of an element.
  await ev(`window.__t = {
   rgb(c){const m=/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(c);if(m)return [+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]];const k=document.createElement('canvas').getContext('2d');k.fillStyle='#000';k.fillStyle=c;k.fillRect(0,0,1,1);const d=k.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];},
   lum(c){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);},
   ratio(a,b){const x=this.lum(a),y=this.lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);},
   under(x,y){let el=document.elementFromPoint(x,y),layers=[];for(;el;el=el.parentElement){const c=this.rgb(getComputedStyle(el).backgroundColor);if(c[3]>0)layers.push(c);if(c[3]>=1)break;}
    let base=[255,255,255,1];if(!layers.length||layers[layers.length-1][3]<1)layers.push(base);let out=layers.pop();while(layers.length){const t=layers.pop();out=[0,1,2].map(i=>t[i]*t[3]+out[i]*(1-t[3])).concat([1]);}return out;},
   info(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2,vis:s.visibility,disp:s.display,ow:s.outlineWidth,os:s.outlineStyle,oc:s.outlineColor,oo:s.outlineOffset};},
   vw:document.documentElement.clientWidth, vh:document.documentElement.clientHeight };`);
  const focused = () => ev(`(()=>{const e=document.activeElement;return {cls:e.className,tag:e.tagName,id:e.id,...window.__t.info(e)}})()`);
  // A focused control must be visible, inside the viewport, topmost at its centre, ringed 2px solid in a colour that is not
  // transparent, and that ring must contrast >= 3:1 with every surface it touches (WCAG 1.4.11), also in forced colours.
  const assertRinged = async (what, forced) => {
   const f = await focused();
   assert.equal(f.vis,'visible',`${what}: visible`); assert.notEqual(f.disp,'none',`${what}: displayed`);
   assert.ok(f.l>=0&&f.t>=0&&f.r<=await ev('innerWidth')&&f.b<=await ev('innerHeight'),`${what}: inside the viewport ${JSON.stringify(f)}`);
   assert.equal(await ev(`(()=>{const e=document.elementFromPoint(${f.cx},${f.cy});return e===document.activeElement})()`),true,`${what}: topmost at its centre`);
   assert.equal(f.ow,'2px',`${what}: ring width`); assert.equal(f.os,'solid',`${what}: ring style`); assert.equal(f.oo,'2px',`${what}: ring sits outside the control`);
   const ring = await ev(`window.__t.rgb(getComputedStyle(document.activeElement).outlineColor)`);
   assert.ok(ring[3]>=(forced?0.8:0.99),`${what}: ring colour is not transparent ${ring}`); // Chromium paints the forced-colours Highlight outline at 0.8
   if (forced) assert.deepEqual(ring.slice(0,3), (await ev(`(()=>{const p=document.createElement('i');p.style.color='Highlight';document.body.append(p);const c=window.__t.rgb(getComputedStyle(p).color);p.remove();return c})()`)).slice(0,3),`${what}: forced-colours ring is Highlight`);
   for (const [dx,dy,side] of [[-5,f.h/2,'left'],[f.w+5,f.h/2,'right'],[f.w/2,-5,'above']]) {
    const x=f.l+dx,y=f.t+dy; if (x<0||y<0||x>=await ev('innerWidth')) continue;
    const bg = await ev(`window.__t.under(${x},${y})`), ratio = await ev(`window.__t.ratio(${JSON.stringify(ring)},${JSON.stringify(bg)})`);
    assert.ok(ratio>=3,`${what}: ring contrast ${ratio.toFixed(2)}:1 against the surface ${side} of it (${ring} on ${bg})`);
   }
   return f;
  };
  const widthOf = sel => ev(`document.querySelector('${sel}').offsetWidth`);
  const reach = async (cls, what) => { // real Tab until the splitter is focused
   for (let i=0;i<40;i++) { await tab(); if (await ev(`document.activeElement.classList.contains('${cls}')`)) return i+1; }
   assert.fail(`${what}: Tab never reached .${cls}`);
  };
  for (const personal of [true,false]) for (const width of [1420,800]) for (const dark of [true,false]) for (const forced of [false,true]) {
   const where = `${personal?'personal':'classroom'} ${width}px ${dark?'dark':'light'}${forced?' forced-colours':''}`;
   await load(personal,width,dark,forced);
   // The composer keeps its initial autofocus (owner decision): a learner types at once, and from there the skip link is
   // one backwards step in a keyboard user's tab order, not a forward one.
   assert.equal(await ev('document.activeElement.tagName'),'TEXTAREA',`${where}: the composer has focus on load`);
   await ev(`document.querySelector('textarea').value='보존할 글'`);
   let back = 0; for (; back<60; back++) { await tab(true); if (await ev(`document.activeElement.classList.contains('hps-skip-input')`)) break; }
   assert.ok(back<60,`${where}: Shift+Tab from the composer never reached the skip link`);
   const skipBack = await assertRinged(`${where}: skip link (Shift+Tab)`,forced);
   assert.deepEqual([skipBack.l,skipBack.t,skipBack.h],[8,8,44]);
   await key('Enter','Enter',13,0,'\r');
   assert.equal(await ev('document.activeElement.tagName'),'TEXTAREA',`${where}: Enter on the skip link focuses the composer`);
   assert.equal(await ev(`document.querySelector('textarea').value`),'보존할 글');
   // Focus anywhere but the composer (or a view without autofocus): the skip link is the first stop of the first Tab.
   await fromTop();
   await tab();
   assert.equal(await ev('document.activeElement.className'),'hps-skip-input',`${where}: first Tab from the top is the skip link`);
   const skip = await assertRinged(`${where}: skip link`,forced);
   assert.deepEqual([skip.l,skip.t,skip.h],[8,8,44],`${where}: skip link position and 44px height`);
   assert.equal(await ev('getComputedStyle(document.activeElement).fontSize'),'14px');
   await key('Enter','Enter',13,0,'\r');
   assert.equal(await ev('document.activeElement.tagName'),'TEXTAREA');
   assert.equal(await ev(`document.querySelector('textarea').value`),'보존할 글');
   if (!personal) { assert.equal(await ev(`document.querySelector('.tw-splitter')`),null,`${where}: no splitter without a workspace`); continue; }
   // ---- rail splitter, reached with real Tab from the top of the page
   await load(personal,width,dark,forced); await fromTop();
   const tabs = await reach('tw-splitter-rail',where); assert.ok(tabs>=2,`${where}: rail splitter after ${tabs} Tabs`);
   const rs = await assertRinged(`${where}: rail splitter`,forced);
   assert.ok(rs.w>=44,`${where}: rail splitter hit target ${rs.w}px >= 44`);
   assert.equal(rs.l, await ev(`document.querySelector('.tw-rail').getBoundingClientRect().right`),`${where}: rail splitter starts at the rail edge`);
   assert.equal(await widthOf('.tw-rail'),204,`${where}: rail keeps the token default width`);
   assert.equal(await ev(`document.querySelector('.tw-splitter-rail').getAttribute('aria-valuenow')`),'204');
   await arrow(1); assert.equal(await widthOf('.tw-rail'),220,`${where}: ArrowRight +16`);
   await arrow(-1); assert.equal(await widthOf('.tw-rail'),204);
   await arrow(1,true); assert.equal(await widthOf('.tw-rail'),268,`${where}: Shift+ArrowRight +64`);
   await arrow(1,true); await arrow(1,true); assert.equal(await widthOf('.tw-rail'),320,`${where}: clamped at 320`);
   assert.equal(await ev(`document.querySelector('.tw-splitter-rail').getAttribute('aria-valuenow')`),'320');
   await arrow(-1,true); await arrow(-1,true); await arrow(-1,true); await arrow(-1,true); assert.equal(await widthOf('.tw-rail'),200,`${where}: clamped at 200`);
   assert.equal(await ev(`document.querySelector('.tw-main').getBoundingClientRect().left`),200,`${where}: conversation follows the rail`);
   await arrow(1);
   // ---- mouse drag (a pointer cursor must do what it promises) and persistence across a reload
   const dragged = await ev(`window.__t.info(document.querySelector('.tw-splitter-rail'))`);
   await mouse('mouseMoved',dragged.cx,dragged.cy); await mouse('mousePressed',dragged.cx,dragged.cy);
   await mouse('mouseMoved',dragged.cx+20,dragged.cy); await mouse('mouseMoved',dragged.cx+40,dragged.cy); await mouse('mouseReleased',dragged.cx+40,dragged.cy);
   assert.equal(await widthOf('.tw-rail'),256,`${where}: dragging 40px right grows the rail 216 -> 256`);
   assert.equal(await ev('document.activeElement.classList.contains("tw-splitter-rail")'),true,`${where}: drag focuses the splitter`);
   await load(personal,width,dark,forced);
   assert.equal(await widthOf('.tw-rail'),256,`${where}: the rail size survives a reload`);
   await ev(`document.querySelector('.tw-sources-toggle').click()`); await fromTop(); await sleep(50);
   if (width>1050) {
    assert.equal(await widthOf('.tw-sources'),280,`${where}: sources keep the token default width`);
    await reach('tw-splitter-sources',where);
    const ss = await assertRinged(`${where}: sources splitter`,forced);
    assert.ok(ss.w>=44,`${where}: sources splitter hit target ${ss.w}px >= 44`);
    assert.equal(ss.l, await ev(`document.querySelector('.tw-sources').getBoundingClientRect().left`),`${where}: sources splitter starts at the sources edge`);
    await arrow(-1); assert.equal(await widthOf('.tw-sources'),296,`${where}: ArrowLeft grows sources +16`);
    await arrow(1); assert.equal(await widthOf('.tw-sources'),280);
    await arrow(-1,true); await arrow(-1,true); assert.equal(await widthOf('.tw-sources'),400,`${where}: sources clamped at 400`);
    const d = await ev(`window.__t.info(document.querySelector('.tw-splitter-sources'))`);
    await mouse('mouseMoved',d.cx,d.cy); await mouse('mousePressed',d.cx,d.cy); await mouse('mouseMoved',d.cx+30,d.cy); await mouse('mouseMoved',d.cx+90,d.cy); await mouse('mouseReleased',d.cx+90,d.cy);
    assert.equal(await widthOf('.tw-sources'),310,`${where}: dragging right shrinks sources 400 -> 310`);
    await load(personal,width,dark,forced); await ev(`document.querySelector('.tw-sources-toggle').click()`); await sleep(50);
    assert.equal(await widthOf('.tw-sources'),310,`${where}: the sources size survives a reload`);
    await ev('window.__vsState=undefined');
   } else assert.equal(await ev(`document.querySelector('.tw-splitter-sources')`),null,`${where}: sources is a modal here, no splitter`);
   await ev('window.__vsState=undefined');
  }
  console.log('PASS browser: skip link, Tab to each splitter, rings, hit targets, keys, drag and persistence at 1420/800 dark/light personal/classroom/forced colours');
 } finally {await browser.close();}
}
