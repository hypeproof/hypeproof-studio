// Provider-free completion fixture. Actual guard admission/persistence, scripted SSE only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {startGuard,digest} from '../feedback-live/guard.mjs';
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
export async function startCompletionUpstream({directory,config}){
 assert.equal(config.completion,true);const cli=config.cli===true;
 const url=cli?null:new URL(config.origin);if(url)assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/');
 if(cli){assert(path.isAbsolute(config.workspace));assert.equal(config.outputHtml,'candidate-1.html');assert.equal(config.outputBrief,'candidate-1.brief.json');assert(typeof config.candidateHtml==='string'&&Buffer.byteLength(config.candidateHtml)<16000);assert(config.brief?.schema==='hps-reference-design/1');}
 let cliWrapper;
 const keyFile=path.join(directory,'completion-provider'),serviceCredentialFile=path.join(directory,'completion-service'),controlKeyFile=path.join(directory,'completion-control');
 const serviceCredential='hps-guard-only-'+digest(directory),control='hps-guard-control-'+digest('control'+directory);
 for(const [file,value]of[[keyFile,'sk-ant-synthetic-completion-only'],[serviceCredentialFile,serviceCredential],[controlKeyFile,control]])fs.writeFileSync(file,value,{flag:'wx',mode:0o600});
 const observations=[];
 const guard=await startGuard({keyFile,serviceCredentialFile,controlKeyFile,activityId:config.activityId,ledgerFile:path.join(directory,'completion-guard.json'),renderRepetitionId:config.repetitionId,renderCompletion:true,fetchImpl:async(_url,init)=>{
  const body=JSON.parse(init.body),blocks=body.messages.flatMap(m=>typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[]),texts=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const match=texts.match(/HPS_COMPLETION_PROOF:(positive|browser-error|builtin-error|denial|policy-denial|provider-error)/);assert(match,'Scripted completion marker required');const mode=match[1];
  if(cli&&!cliWrapper){
   const found=[...texts.matchAll(/The owned preview is (http:\/\/127\.0\.0\.1:[0-9]+\/__hp_viewport\?path=[^\s]+)\. After writing the HTML/g)];assert.equal(found.length,1,'Exactly one actual CLI wrapper instruction required');
   const candidate=new URL(found[0][1]);assert(candidate.protocol==='http:'&&candidate.hostname==='127.0.0.1'&&!candidate.username&&!candidate.password&&!candidate.hash&&candidate.pathname==='/__hp_viewport');assert(!['8802','8803'].includes(candidate.port));assert.equal(candidate.search,'?path='+encodeURIComponent('/'+config.outputHtml));cliWrapper=candidate.href;
  }
  const results=blocks.filter(b=>b.type==='tool_result'),get=id=>results.find(b=>b.tool_use_id===id),resumed=texts.includes('Render acceptance feedback:');
  const images=results.flatMap(b=>(Array.isArray(b.content)?b.content:[]).filter(c=>c.type==='image').map(c=>digest(Buffer.from(c.source.data,'base64'))));
  observations.push({mode,resumed,prior_user_present:!!match,tool_result_errors:results.filter(b=>b.is_error===true).length,prior_image_hashes:images,advertised_tools:(body.tools??[]).map(t=>t.name),...(cli?{completed_fixture_tools:results.map(r=>r.tool_use_id).filter(id=>typeof id==='string'&&/^completion_[a-z0-9_]+$/.test(id))}:{})});
  fs.writeFileSync(path.join(directory,'completion-observations.json'),JSON.stringify(observations,null,2));
  if(mode==='provider-error')return new Response(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'Synthetic provider refusal'}}),{status:429,headers:{'content-type':'application/json'}});
  if(resumed)assert(get('completion_shot390')&&images.length,'Resume must contain prior real tool image, not repeated text');
  let content,stop='tool_use';const tool=(id,name,input)=>({type:'tool_use',id,name,input});
  if(mode==='builtin-error')content=tool('completion_read_error','Read',{file_path:config.workspace+'/absent-file'});
  else if(mode==='policy-denial')content=tool('completion_policy_denied','mcp__hypeproof__browser_type',{ref:'no-typing-grant',text:'synthetic'});
  else if(mode==='denial')content=tool('completion_denied','Bash',{command:'echo unavailable'});
  else if(cli&&!get('completion_write_html'))content=tool('completion_write_html','Write',{file_path:path.join(config.workspace,config.outputHtml),content:config.candidateHtml});
  else if(cli&&!get('completion_write_brief'))content=tool('completion_write_brief','Write',{file_path:path.join(config.workspace,config.outputBrief),content:JSON.stringify(config.brief,null,2)});
  else if(!get('completion_open'))content=tool('completion_open','mcp__hypeproof__browser_open',{url:cli?cliWrapper:url.origin+'/__hp_viewport?path=%2Fkeyboard.html'});
  else if(mode==='browser-error')content=tool('completion_bad_click','mcp__hypeproof__browser_click',{ref:'missing-owned-ref'});
  else if(!get('completion_shot390'))content=tool('completion_shot390','mcp__hypeproof__browser_screenshot',{});
  else if(!resumed){content={type:'text',text:'Initial render turn concluded.'};stop='end_turn';}
  else if(!get('completion_read'))content=tool('completion_read','mcp__hypeproof__browser_read',{});
  else if(!get('completion_click')){
   const read=get('completion_read').content,text=typeof read==='string'?read:read.filter(x=>x.type==='text').map(x=>x.text).join('\n'),ref=text.split('\n').find(s=>s.includes('데스크톱 1280px'))?.match(/ref=(e\d+)/)?.[1];assert(ref,'Actual browser_read desktop control required');content=tool('completion_click','mcp__hypeproof__browser_click',{ref});
  }else if(!get('completion_shot1280'))content=tool('completion_shot1280','mcp__hypeproof__browser_screenshot',{});
  else{content={type:'text',text:'Both actual viewport screenshots inspected.'};stop='end_turn';}
  let stream=event('message_start',{type:'message_start',message:{id:'msg_completion_'+observations.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:17,output_tokens:0}}});
  stream+=event('content_block_start',{type:'content_block_start',index:0,content_block:content.type==='tool_use'?{...content,input:{}}:{type:'text',text:''}});
  stream+=event('content_block_delta',{type:'content_block_delta',index:0,delta:content.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(content.input)}:{type:'text_delta',text:content.text}})+event('content_block_stop',{type:'content_block_stop',index:0});
  stream+=event('message_delta',{type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:19}})+event('message_stop',{type:'message_stop'});
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
 }});
 return{...guard,serviceCredential};
}
