// Explicit owned render proof only. Never forwards to an external provider.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
export function renderResponse(body,config){
 const blocks=body.messages.flatMap(m=>typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[]);
 const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
 const match=text.match(/HPS_RENDER_PROOF:(390|1280):(positive|no-grant|no-host)/);assert(match,'Explicit bounded render marker required');
 const origin=new URL(config.origin);assert(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&origin.port&&origin.pathname==='/'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash,'Owned loopback render origin only');
 const width=Number(match[1]),mode=match[2],url=origin.origin+'/keyboard.html';
 const results=blocks.filter(b=>b.type==='tool_result'&&/^render_(open|shot)$/.test(b.tool_use_id));
 const metadata={width,mode,advertised_browser:body.tools?.some(t=>t.name==='mcp__hypeproof__browser_screenshot')??false,results:results.map(b=>({id:b.tool_use_id,is_error:b.is_error===true,images:(Array.isArray(b.content)?b.content:[]).filter(x=>x.type==='image'&&x.source?.type==='base64').map(x=>({mime:x.source.media_type,sha256:hash(Buffer.from(x.source.data,'base64')),bytes:Buffer.from(x.source.data,'base64').length}))}))};
 let content,stop='tool_use';
 if(!results.some(b=>b.tool_use_id==='render_open'))content={type:'tool_use',id:'render_open',name:'mcp__hypeproof__browser_open',input:{url}};
 else if(!results.some(b=>b.tool_use_id==='render_shot'))content={type:'tool_use',id:'render_shot',name:'mcp__hypeproof__browser_screenshot',input:{}};
 else{content={type:'text',text:'HPS_RENDER_PROOF_COMPLETE'};stop='end_turn';}
 let stream=event('message_start',{type:'message_start',message:{id:'msg_render_'+width+'_'+mode,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:17,output_tokens:0}}});
 stream+=event('content_block_start',{type:'content_block_start',index:0,content_block:content.type==='tool_use'?{...content,input:{}}:{type:'text',text:''}});
 stream+=event('content_block_delta',{type:'content_block_delta',index:0,delta:content.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(content.input)}:{type:'text_delta',text:content.text}})+event('content_block_stop',{type:'content_block_stop',index:0});
 stream+=event('message_delta',{type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:19}})+event('message_stop',{type:'message_stop'});
 return {stream,metadata};
}
