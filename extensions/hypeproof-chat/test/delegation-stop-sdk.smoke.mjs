import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'delegation-sdk-'));
try{
 const out=join(dir,'sdk.cjs');
 await build({entryPoints:['src/sdkCoach.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',external:['@anthropic-ai/claude-agent-sdk','zod'],plugins:[{name:'vscode-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}}',loader:'js'}));}}]});
 const {runSdkCoach}=createRequire(import.meta.url)(out);
 let control,options;const states=[],calls=[];
 const sdk={query(arg){options=arg.options;const stream=(async function*(){
  yield {type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'helper',name:'Agent',input:{subagent_type:'코드리뷰어'}}]}};
  yield {type:'system',subtype:'task_started',task_id:'task',tool_use_id:'helper',task_type:'local_agent',run_id:'r1'};
  assert.equal(typeof control,'function');control();control();
  assert.deepEqual(calls,['task']);assert.equal(states.at(-1),'pending');
  const denied=await options.canUseTool('Agent',{subagent_type:'코드리뷰어'},{toolUseID:'new'});assert.equal(denied.behavior,'deny','no replacement helper after user stop');
  yield {type:'system',subtype:'task_notification',task_id:'task',tool_use_id:'helper',run_id:'r1',status:'stopped'};
  assert.equal(states.at(-1),'confirmed');
  yield {type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'denied-after-confirm',name:'Task',input:{subagent_type:'리서처'}}]}};
  assert.equal(states.at(-1),'pending');
  assert.equal((await options.canUseTool('Task',{subagent_type:'리서처'},{toolUseID:'denied-after-confirm'})).behavior,'deny');
  assert.equal(states.at(-1),'confirmed','a refusal is positive evidence this helper never launched');
  yield {type:'result',subtype:'success',is_error:false};
 })();stream.stopTask=async id=>{calls.push(id)};return stream;}};
 await runSdkCoach({sdk,binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'t',model:'m',profile:{},systemPrompt:'',history:[],userText:'q',signal:new AbortController().signal,stallTimeoutMs:0,onDelta(){},onDelegationControl:stop=>{control=stop},onDelegationStop:s=>states.push(s)});
 assert.equal(control,null,'settled turn releases control');assert.equal(states.at(-1),'confirmed');
 console.log('PASS real runSdkCoach: SDK task events, exact stopTask request once, no early confirmation, replacement delegation refused, actual notification confirmation and cleanup');
}finally{await rm(dir,{recursive:true,force:true});}
