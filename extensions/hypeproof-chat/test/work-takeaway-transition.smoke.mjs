import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const built=await build({stdin:{contents:"export {StartPage} from './src/startPage';export {ActivityConnections} from './src/activityConnections';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
let enabled=true,answer='내 작업 가져가기',offers=0,copies=0,changing=0,network=0,copyOkay=false;
const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='workTakeawayEnabled'?enabled:key==='proxyUrl'?'https://example.invalid/v1':fallback})},window:{showInformationMessage:async(title)=>{assert.match(title,/수업으로 바꾸기 전에/);offers++;return answer;}}};
const mod={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),console,URL,Buffer,process,TextEncoder,AbortSignal,setTimeout,clearTimeout,fetch:async()=>{network++;return new Response('{}',{status:503});}});
const {StartPage,ActivityConnections}=mod.exports;
const raw={globalStorageUri:{fsPath:'/synthetic'},workspaceState:{get:()=>undefined},secrets:{get:async()=>undefined},subscriptions:[]};
const connections=new ActivityConnections(raw,()=> 'https://example.invalid/v1',()=>'/synthetic',async()=>({}));
connections.active={id:'trial-source',kind:'trial',workspace:'/synthetic',token:'never-copy'};
const page=Object.create(StartPage.prototype);page.context=connections.wrap();page.refresh=async()=>{};page.panel={};
page.chat={hasActiveStream:()=>false,setConnectionChanging:async value=>{if(value)changing++;},takeMyWork:async()=>{assert.equal(changing,0,'copy before activity replacement');copies++;return copyOkay;}};
const candidate={profile:{activity_kind:'classroom'},token:'new-class-secret',proxyUrl:'https://example.invalid/v1'};
page.candidate=candidate;
await page.handle({type:'beginCourse'});assert.equal(offers,1);assert.equal(copies,1);assert.equal(changing,0);assert.equal(network,0);assert.equal(connections.current.token,'never-copy');
answer=undefined;await page.handle({type:'beginCourse'});assert.equal(offers,2);assert.equal(copies,1);assert.equal(network,0);
answer='그대로 계속';await page.handle({type:'beginCourse'});assert.equal(offers,3);assert.equal(copies,1);assert.ok(network>0);
const count=offers;enabled=false;await page.handle({type:'beginCourse'});assert.equal(offers,count);
enabled=true;connections.active.kind='personal';await page.handle({type:'beginCourse'});assert.equal(offers,count);
connections.active.kind='trial';candidate.profile.activity_kind='personal';await page.handle({type:'beginCourse'});assert.equal(offers,count);
// The candidate changed while the copy was running: the old classroom switch must not continue.
{const other={profile:{activity_kind:'classroom'},token:'other-secret',proxyUrl:'https://example.invalid/v1'};enabled=true;connections.active={id:'trial-source',kind:'trial',workspace:'/synthetic',token:'never-copy'};candidate.profile.activity_kind='classroom';const savedTake=page.chat.takeMyWork;const before=network;
 const changingBefore=changing;answer='내 작업 가져가기';page.chat.takeMyWork=async()=>{page.candidate=other;return true;};
 await page.handle({type:'beginCourse'});assert.equal(changing,changingBefore,'switch must not start for a stale candidate');assert.equal(network,before);
 page.chat.takeMyWork=savedTake;page.candidate=candidate;answer='그대로 계속';}

const manifest=JSON.parse(require('node:fs').readFileSync('package.json','utf8'));
assert.equal(manifest.contributes.configuration.properties['hypeproofChat.workTakeawayEnabled'].default,false);
assert.equal(manifest.contributes.configuration.properties['hypeproofChat.workTakeawayEnabled'].scope,'machine');
console.log('trial→class offer uses old activity, cancel preserves binding, gate stays off PASS');
