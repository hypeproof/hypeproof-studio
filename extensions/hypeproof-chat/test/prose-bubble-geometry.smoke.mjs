import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES as VSCODE_THEMES } from './lib/vscode-default-themes.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('prose-bubble-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('prose-bubble-geometry NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-accuracy-education-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// Use the complete pinned default palette, including inactive-selection bubble backgrounds.
const THEMES=Object.fromEntries([['dark','Dark+'],['light','Light+']].map(([key,name])=>[key,
 '--vscode-font-size:13px;--vscode-font-family:sans-serif;'+Object.entries(VSCODE_THEMES[name]).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>'--vscode-'+k.replaceAll('.','-')+':'+v).join(';')]));

const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});


const out=process.env.PROSE_EVIDENCE,results=[];let b;if(out)mkdirSync(out,{recursive:true});
try {b=await launch(bin);
for(const surface of ['personal','classroom'])for(const theme of ['dark','light'])for(const width of [320,390,800,1280]){
 await b.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
 const {identifier}=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>undefined,setState:()=>{}});`});
 try{
 await b.send('Page.navigate',{url:base});for(let i=0;i<100&&!await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(()=>false);i++)await new Promise(r=>setTimeout(r,50));
 await b.evaluate(`document.documentElement.style.cssText=${JSON.stringify(THEMES[theme])};window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(surface))}}}));`);await new Promise(r=>setTimeout(r,100));
 await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:[{id:'u',role:'user',content:'긴 질문을 읽고 차분하게 설명해 주세요. '.repeat(12),createdAt:1},{id:'a',role:'assistant',content:'답변을 한 줄씩 읽고 결과를 확인할 수 있어요. '.repeat(12),createdAt:2}]}}));`);await new Promise(r=>setTimeout(r,100));
 const r=await b.evaluate(`(()=>{const inspect=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return {font:c.fontSize,maxInline:c.maxInlineSize,maxWidth:c.maxWidth,radius:c.borderRadius,bg:c.backgroundColor,border:c.borderWidth,width:e.getBoundingClientRect().width,parent:e.parentElement.getBoundingClientRect().width}};const u=document.querySelector('.hps-msg-user .hps-msg-body'),probe=document.createElement('div');probe.style.background='var(--vscode-list-inactiveSelectionBackground)';document.body.appendChild(probe);const host=getComputedStyle(probe).backgroundColor;probe.remove();const a=document.querySelector('.hps-msg-assistant');const squares=a?[...a.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return Math.round(r.width)===18&&Math.round(r.height)===18&&!e.closest('button')}).length+[...a.querySelectorAll('*'),a].reduce((n,e)=>n+['::before','::after'].filter(q=>{const c=getComputedStyle(e,q);return c.content!=='none'&&c.content!=='normal'&&parseFloat(c.width)===18&&parseFloat(c.height)===18}).length,0):0;const uc=u?getComputedStyle(u):null;
 return {host,fg:uc&&uc.color,userRadii:uc&&[uc.borderTopLeftRadius,uc.borderTopRightRadius,uc.borderBottomRightRadius,uc.borderBottomLeftRadius],asstBorder:a&&getComputedStyle(a.querySelector('.hps-msg-body')).borderTopWidth,asstBg:a&&getComputedStyle(a.querySelector('.hps-msg-body')).backgroundColor,squares,prose:inspect('.hps-prose'),user:inspect('.hps-msg-user .hps-msg-body'),assistant:inspect('.hps-msg-assistant .hps-msg-body'),mark:inspect('.hps-assistant-mark'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
 results.push({surface,theme,width,...r});assert.ok(r.user&&r.assistant);assert.equal(r.overflow,false);if(surface==='personal'){assert.ok(r.prose);assert.ok(r.user.width<=r.user.parent*0.85+1,'personal bubble including padding exceeds 85%: '+JSON.stringify(r.user));assert.equal(parseFloat(r.prose.maxInline),40*parseFloat(r.prose.font));
 // CGP-DS-D-017 owner decisions D1-D3 (decisions.md).
 assert.equal(r.mark,null,'D1: no identity mark in the personal chat');assert.equal(r.squares,0,'D1: no 18px square mark node in an assistant message');
 assert.equal(r.user.bg,r.host,'D2: user bubble background is the mapped host colour ('+r.user.bg+' vs '+r.host+')');
 assert.deepEqual(r.userRadii,['18px','18px','6px','18px'],'D3: 18px bubble with a 6px tail corner');
 assert.equal(r.asstBorder,'0px','assistant unboxed: no border');assert.match(r.asstBg,/rgba\(0, 0, 0, 0\)|transparent/,'assistant unboxed: no fill');
 const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
 const L1=lum(r.fg),L2=lum(r.user.bg);assert.ok((Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05)>=4.5,'D2: bubble text keeps 4.5:1 ('+r.fg+' on '+r.user.bg+')');}
 if(out&&surface==='personal'){const png=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'personal-'+theme+'-'+width+'.png'),Buffer.from(png.data,'base64'));}
 }finally{await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
console.log('PASS prose/bubble geometry: 16 states, no document overflow; personal prose 40em and padded user bubble <=85%. D1-D3 owner decisions asserted: no mark, host-token background with 4.5:1 text, 18/18/6/18 radii.');
}finally{try{if(out)writeFileSync(path.join(out,'geometry.json'),JSON.stringify(results,null,2));}finally{await b?.close();server.close();rmSync(temp,{recursive:true,force:true});}}
