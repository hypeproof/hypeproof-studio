// Owned text-only Anthropic protocol fixture. No fetch/import of a real provider.
import fs from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {policyResponse} from './policy-protocol.mjs';
export const SCRIPTED_LIMIT=12,OUTPUT_LIMIT=4096;
const digest=value=>createHash('sha256').update(value).digest('hex');
export const MARKERS=['A1','D2','STOP_HOLD','QUIT_HOLD','FILE_HOLD'];
export const markerText=name=>'HPS_NATIVE_'+name;
export const replyText=name=>'HPS_NATIVE_REPLY_'+name;
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
export function scriptedEvents(name,model,id='msg_'+randomUUID().replaceAll('-','')){
 const text=replyText(name);
 return {prefix:event('message_start',{type:'message_start',message:{id,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:11,output_tokens:0}}})+event('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}})+event('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}),tail:event('content_block_stop',{type:'content_block_stop',index:0})+event('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:7}})+event('message_stop',{type:'message_stop'})};
}
export function validateScriptedRequest(body,pathname){
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.model!=='string'||!Array.isArray(body.messages))throw Error('invalid_body');
 if(pathname==='/v1/messages'&&(!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>OUTPUT_LIMIT))throw Error('invalid_output_bound');
 if(!['/v1/messages','/v1/messages/count_tokens'].includes(pathname))throw Error('unsupported_endpoint');
 return body;
}
export function requestMarkers(body){
 const texts=[];for(const m of body.messages??[])for(const b of typeof m.content==='string'?[{type:'text',text:m.content}]:Array.isArray(m.content)?m.content:[])if(b.type==='text'&&typeof b.text==='string')texts.push(b.text);
 const text=texts.join('\n'),matches=[...text.matchAll(/HPS_NATIVE_(A1|D2|STOP_HOLD|QUIT_HOLD|FILE_HOLD)(?![A-Z_])/g)];
 return {selected:matches.at(-1)?.[1]??'AUX',present:Object.fromEntries(MARKERS.map(name=>[name,text.includes(markerText(name))]))};
}
export async function startScriptedUpstream({ledgerFile,controlSecret,policyRoot}){
 if(fs.existsSync(ledgerFile))throw Error('Retain immutable previous scripted ledger');
 const state={schema:'hps-native-scripted-upstream/1',provider_called:false,request_limit:SCRIPTED_LIMIT,output_cap:OUTPUT_LIMIT,counts:{},rows:[],rejections:[]},pending=new Map();
 const persist=()=>fs.writeFileSync(ledgerFile,JSON.stringify(state,null,2),{mode:0o600});persist();
 const reserve=(subject,metadata)=>{if(!['A','B'].includes(subject))throw Error('unknown_activity');const next=(state.counts[subject]??0)+1;state.counts[subject]=next;const row={attempt:next,subject,...metadata};state.rows.push(row);persist();if(next>SCRIPTED_LIMIT){row.state='rejected_limit';persist();throw Error('all_attempt_limit');}return row;};
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');
  const json=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/__scripted/state'&&req.method==='GET'){json(200,state);return;}
  if(url.pathname==='/__scripted/release'&&req.method==='POST'){
   if(req.headers['x-hps-native-control']!==controlSecret){json(401,{});return;}
   let text='';for await(const b of req){text+=b;if(text.length>128){json(413,{});return;}}
   let name;try{name=JSON.parse(text).name;}catch{json(400,{});return;}
   const held=pending.get(name);if(!held){json(409,{});return;}held.finish('explicit_fixture_release');json(200,{released:true});return;
  }
  let row;try{
   if(req.headers['x-api-key']!==controlSecret)throw Error('invalid_service_auth');
   const subject=req.headers['x-hps-native-subject'],link=Number(req.headers['x-hps-native-service-seq']);
   row=reserve(subject,{endpoint:url.pathname,service_seq:link,state:'reserved',client_closed:false});
   if(!Number.isSafeInteger(link)||link<1)throw Error('invalid_service_link');
   if(req.method!=='POST'||!['/v1/messages','/v1/messages/count_tokens'].includes(url.pathname)||[...url.searchParams].some(([k,v])=>k!=='beta'||v!=='true'))throw Error('unsupported_endpoint');
   const chunks=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>1024*1024)throw Error('oversized_body');chunks.push(b);}const raw=Buffer.concat(chunks);row.body_sha256=digest(raw);
   const body=validateScriptedRequest(JSON.parse(raw),url.pathname),markers=requestMarkers(body);Object.assign(row,{max_tokens:url.pathname==='/v1/messages'?body.max_tokens:null,markers:markers.present,marker:markers.selected,state:'accepted'});persist();
   if(url.pathname.endsWith('/count_tokens')){row.state='complete';persist();json(200,{input_tokens:11});return;}
   const policy=policyRoot?policyResponse(body,policyRoot):null;
   if(policy){row.policy=policy.metadata;row.state='complete';persist();res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','request-id':'req_scripted_'+state.rows.length});res.end(policy.stream);return;}
   const frame=scriptedEvents(markers.selected,body.model);res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','request-id':'req_scripted_'+state.rows.length});res.flushHeaders();res.write(frame.prefix);row.state='streaming';persist();
   if(markers.selected.endsWith('_HOLD')){
    if(pending.has(markers.selected))throw Error('duplicate_held_turn');
    const finish=reason=>{clearTimeout(timer);pending.delete(markers.selected);row.fixture_finish=reason;if(!res.destroyed){res.end(frame.tail);row.state='complete';}persist();};
    const timer=setTimeout(()=>finish('timeout_cleanup_not_cancel_proof'),120000);pending.set(markers.selected,{finish});
    res.on('close',()=>{row.socket_close_event=true;row.closed_at=new Date().toISOString();if(!res.writableEnded){row.client_closed=true;row.state='upstream_socket_closed';clearTimeout(timer);pending.delete(markers.selected);}persist();});
   }else{res.end(frame.tail);row.state='complete';persist();}
  }catch(error){state.rejections.push({kind:/^[a-z_]+$/.test(error.message)?error.message:'invalid_request'});persist();if(!res.headersSent)json(400,{error:{type:'invalid_request_error',message:'Scripted fixture refused'}});else res.destroy();}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {origin:'http://127.0.0.1:'+server.address().port,snapshot:()=>structuredClone(state),close:async()=>{for(const p of pending.values())p.finish('owned_cleanup_not_cancel_proof');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
