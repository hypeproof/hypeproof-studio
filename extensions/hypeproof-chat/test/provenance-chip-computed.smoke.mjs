import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PROVENANCE_LABELS } from '../src/artifactProvenanceView.ts';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER)throw Error('Chromium required');console.log('NOT RUN provenance chips: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const fixture=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ArtifactProvenanceList} from './src/ArtifactProvenanceList';createRoot(document.getElementById('root')).render(<ArtifactProvenanceList view={window.view}/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const expected=[['✦','AI가 만듦'],['↻','AI가 고침'],['▣','Studio가 만듦'],['▤','Studio가 고침'],['⇡','내가 올림'],['○','기록 없음'],['○','기록 없음']];
const entries=Object.entries(PROVENANCE_LABELS).map(([kind,v],i)=>({path:`${i}-긴파일이름${'가'.repeat(30)}.md`,kind,...v,history:i===0?['기록 없음','AI가 만듦']:[]}));
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const color=value=>value.match(/[\d.]+/g).map(Number);
const evidence=process.env.PROVENANCE_CHIP_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const b=await launch(bin);
try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forcedColors of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<!doctype html><style>:root{${vars}}${css}.tw-workspace{display:block;max-width:100%;padding:8px;box-sizing:border-box}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)"><div class="hps-shell" ${seat==='personal'?'data-chat-detail="personal"':''}><div class="tw-workspace"><div id="root"></div></div></div><script>window.view=${JSON.stringify({entries,more:0,unobserved:false,unconfirmed:false})}</script><script>${fixture.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body>`,{width,height:1100,dark,forcedColors});
 const rows=await b.evaluate(`Array.from(document.querySelectorAll('[data-provenance]')).map(row=>{const chip=row.querySelector('.tw-provenance-chip');if(!chip)return null;const s=getComputedStyle(chip),g=chip.querySelector('[data-provenance-symbol]'),r=chip.getBoundingClientRect(),text=chip.querySelector('strong');return {label:text.textContent,glyph:g.textContent,hidden:g.getAttribute('aria-hidden'),glyphDisplay:getComputedStyle(g).display,glyphWidth:g.getBoundingClientRect().width,font:parseFloat(getComputedStyle(text).fontSize),fg:getComputedStyle(text).color,bg:s.backgroundColor,border:parseFloat(s.borderTopWidth),display:s.display,left:r.left,right:r.right,clipped:chip.scrollWidth>chip.clientWidth,rowHeight:row.getBoundingClientRect().height}})`);
 assert.equal(rows.length,7);assert.ok(rows.every(Boolean),'every recorded origin has a text chip');assert.deepEqual(rows.map(x=>[x.glyph,x.label]),expected);
 for(const row of rows){assert.equal(row.hidden,'true');assert.notEqual(row.glyphDisplay,'none');assert.ok(row.glyphWidth>0);assert.ok(row.font>=14);assert.ok(row.border>=1);assert.equal(row.display,'inline-flex');assert.ok(!row.clipped&&row.left>=0&&row.right<=width);assert.ok(row.rowHeight>=44);const fg=luminance(color(row.fg)),bg=luminance(color(row.bg));assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,`contrast ${row.fg}/${row.bg}`);}
 const text=await b.evaluate(`document.querySelector('.tw-artifacts').textContent`);assert.match(text,/지금까지: 기록 없음 → AI가 만듦/);assert.doesNotMatch(text,/%|점수|OWNERSHIP|JUDGMENT|내가 고침/);
 assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 console.log(`PASS provenance chips ${seat} ${dark?'dark':'light'} ${width} ${forcedColors?'forced':'normal'}`);
}}finally{await b.close();}
