import {CommandApprovalRequest} from '../../src/commandApprovalPrompt.ts';
// Drive the actual request state machine; callers script a human button answer.
export function installCommandApproval(host, present) {
 const request=new CommandApprovalRequest({scope:()=>JSON.stringify([host.taskCommandAllowState(),host.taskCommandAllows.generation]),present:async prompt=>{
  if(!prompt)return true;
  const choice=await present(prompt);
  request.respond(prompt.id,choice==='허락'?'allow':choice==='이번 작업 동안 이 명령 허용'?'remember':'deny');
  return true;
 }});
 host.commandApprovalRequest=request;
 return host;
}
