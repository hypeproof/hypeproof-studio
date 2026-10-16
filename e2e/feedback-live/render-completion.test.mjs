import test from 'node:test';
import assert from 'node:assert/strict';
import {completionConfig,createCompletionSession,completionDecision,completionFeedback} from './render-completion.mjs';
const id='01234567-1234-4321-8123-012345678901';
const rows=count=>Array.from({length:count},(_,index)=>({attempt:index+1,phase:'complete',status:200}));
const initial=()=>{const captures=[{source_sha256:'source',page:{url:'owned',frameWidth:390},upstream_pixel_delivery:'OBSERVED'}];return{session:{queries:1,session_sha256:'bound',terminal:{subtype:'success',is_error:false,stop_reason:'end_turn'}},guard:{completion:{enabled:true,held:false},armed:true,request_limit:12,output_cap:4096,render_screenshot_limit:6,attempts:3,candidate_attempts:1,render_screenshot_attempts:1,rows:rows(3),rejected:{}},host:{actions:[],captures,screenshot_attempts:1},captures,sourceSha:'source',wrapperUrl:'owned',deadline:100,now:1};};
function addCapture(s,width){s.captures.push({...s.captures[0],page:{url:'owned',frameWidth:width}});s.guard.render_screenshot_attempts++;s.host.screenshot_attempts++;}
test('explicit opt-in only; exact clean incomplete state can continue within all existing caps',()=>{
 assert.equal(completionConfig({},[],null),false);assert.throws(()=>completionConfig({},['--allow-render-completion'],true));
 assert(completionConfig({renderCompletion:{enabled:true,mode:'missing-width-only'},attempts:[{}]},['--allow-render-completion'],true));
 for(const change of [s=>s.session.fatal='denied',s=>s.session.terminal.stop_reason='max_tokens',s=>s.session.terminal.is_error=true,s=>s.host.actions.push({isError:true}),s=>s.host.blocked_requests=1,s=>s.guard.rows[0].phase='http_error',s=>s.captures[0].upstream_pixel_delivery='NOT_OBSERVED',s=>s.captures[0].source_sha256='other',s=>s.captures[0].page.url='other',s=>s.guard.attempts=undefined]){const s=initial();change(s);assert.equal(completionDecision(s).status,'STOP_HOLD');}
 for(const change of [s=>{s.guard.attempts=12;s.guard.rows=rows(12);},s=>s.guard.candidate_attempts=3,s=>{while(s.captures.length<6)addCapture(s,390);},s=>s.session.queries=3]){const s=initial();change(s);assert.equal(completionDecision(s).status,'INCOMPLETE_BUDGET');}
 const s=initial(),d=completionDecision(s);assert.deepEqual(d,{status:'INCOMPLETE_EVIDENCE',missing:[1280]});assert(completionFeedback(d,'source').includes('1280'));addCapture(s,1280);assert.equal(completionDecision(s).status,'COMPLETE');
});
test('corrupted ledger and capture counters stop instead of authorizing continuation',()=>{
 for(const change of [s=>s.guard.rows.pop(),s=>s.guard.rows[1].attempt=1,s=>s.guard.rows[1].attempt=4,s=>delete s.guard.rows[0].status,s=>s.guard.rows[0].status='200',s=>s.guard.rows=null,s=>s.guard.render_screenshot_attempts=2,s=>s.host.screenshot_attempts=2,s=>s.host.captures=[],s=>s.captures=[]]){
  const s=initial();change(s);assert.equal(completionDecision(s).status,'STOP_HOLD');
 }
});
test('even complete pixels cannot pass at or after the common deadline or with an unknown clock',()=>{
 for(const change of [s=>s.now=100,s=>s.now=101,s=>s.now=NaN,s=>s.deadline=Infinity,s=>s.deadline=undefined]){
  const s=initial();addCapture(s,1280);change(s);assert.deepEqual(completionDecision(s),{status:'STOP_HOLD',reason:'deadline_expired_or_unknown'});
 }
 const s=initial();s.now=100;assert.equal(completionDecision(s).status,'STOP_HOLD');
});
const options=()=>({abortController:new AbortController(),cwd:'/owned',model:'model',pathToClaudeCodeExecutable:'/binary',env:{CLAUDE_CONFIG_DIR:'/owned/config',ANTHROPIC_BASE_URL:'http://127.0.0.1',ANTHROPIC_AUTH_TOKEN:'synthetic'},allowedTools:[],settingSources:[],strictMcpConfig:true,tools:['Read'],canUseTool:async()=>({behavior:'allow'})});
test('actual event/prompt identity passes through; only observed exact session resumes; denial aborts before returning',async()=>{
 const seen=[],events=[{type:'system',subtype:'init',session_id:id},{type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',session_id:id}];
 const sdk={query(input){seen.push(input);return Object.assign((async function*(){yield*events;})(),{close(){}});}},s=createCompletionSession(),prompt={async*[Symbol.asyncIterator](){yield{};}};
 const first=options(),stream=s.wrap(sdk).query({prompt,options:first});let n=0;for await(const e of stream)assert.equal(e,events[n++]);assert.equal(seen[0].prompt,prompt);assert.equal(seen[0].options.resume,undefined);
 const second=options();for await(const e of s.wrap(sdk,{resume:true}).query({prompt,options:second})){}assert.equal(seen[1].options.resume,id);assert.equal(s.snapshot().queries,2);assert(!JSON.stringify(s.snapshot()).includes(id));
 second.canUseTool=async()=>({behavior:'deny',message:'test'});s.wrap(sdk,{resume:true}).query({prompt,options:second});const denied=await seen[2].options.canUseTool('Write',{});assert.equal(denied.behavior,'deny');assert(second.abortController.signal.aborted);assert.equal(s.snapshot().fatal,'tool_denied');assert.throws(()=>s.wrap(sdk,{resume:true}));
});
test('tool failure hook aborts synchronously; wrong session and context cannot silently resume',async()=>{
 let received;const s=createCompletionSession(),o=options();s.wrap({query(i){received=i;return Object.assign((async function*(){})(),{close(){}});}}).query({prompt:'x',options:o});await received.options.hooks.PostToolUseFailure[0].hooks[0]({});assert(o.abortController.signal.aborted);assert.equal(s.snapshot().fatal,'tool_failure');
 const wrong=createCompletionSession(),a=options();for await(const e of wrong.wrap({query(){return Object.assign((async function*(){yield{type:'system',subtype:'init',session_id:id};yield{type:'result',session_id:'another',subtype:'success',is_error:false,stop_reason:'end_turn'};})(),{close(){}});}}).query({prompt:'x',options:a})){}assert.equal(wrong.snapshot().fatal,'terminal_session_mismatch');assert(a.abortController.signal.aborted);
});
