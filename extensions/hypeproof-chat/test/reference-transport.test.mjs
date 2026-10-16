// Real runtime entrypoints with recorded inputs; no model/network/installed-app claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyChat } from '../src/proxyClient.ts';
let dir,runSdkCoach;
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII=';
const image=`data:image/png;base64,${data}`;
test.before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'hps-vision-'));const out=join(dir,'sdk.cjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/sdkCoach.ts',import.meta.url))],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',external:['@anthropic-ai/claude-agent-sdk','zod'],plugins:[{name:'vscode-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};',loader:'js'}));}}]});
 ({runSdkCoach}=createRequire(import.meta.url)(out));
});
test.after(async()=>rm(dir,{recursive:true,force:true}));
test('actual SDK entrypoint hands current image pixels to query; ordinary follow-up stays text-only',async()=>{
 const captured=[];
 const sdk={query:({prompt})=>(async function*(){captured.push(typeof prompt==='string'?prompt:await Array.fromAsync(prompt));yield {type:'result',subtype:'success',is_error:false};})()};
 const args={sdk,binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'t',model:'m',profile:{},systemPrompt:'',history:[{role:'user',content:'old',images:[image]}],userText:'reference',signal:new AbortController().signal,stallTimeoutMs:0,onDelta:()=>{}};
 await runSdkCoach({...args,images:[image]});
 assert.equal(captured[0][0].message.content[1].type,'image');assert.equal(captured[0][0].message.content[1].source.data,data);
 await runSdkCoach(args);assert.equal(typeof captured[1],'string');assert.equal(captured[1].includes(data),false);
});
test('actual proxy entrypoint sends pixels in current turn and drops history thumbnails',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 try{
 await proxyChat({proxyUrl:'https://example.test/v1',token:'t',model:'m',history:[{role:'user',content:'old',images:[image]}],userText:'reference',images:[image],signal:new AbortController().signal,onDelta:()=>{}});
 assert.equal(sent.messages[0].content,'old');assert.equal(sent.messages[1].content[1].image_url.url,image);
 }finally{globalThis.fetch=original;}
});
