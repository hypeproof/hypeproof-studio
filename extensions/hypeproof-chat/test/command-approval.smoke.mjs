import assert from 'node:assert/strict';
import {CommandApprovalRequest,COMMAND_APPROVAL_PURPOSE,commandApprovalPurposeFor,commandApprovalPurposeText} from '../src/commandApprovalPrompt.ts';
import {sdkToolToActionRequest} from '../src/sdkCoachHelpers.ts';
const prompt={id:'one',purpose:'shell',command:'git status',destructive:false,rememberAllowed:true};
let scope='a',shown=[];
const request=new CommandApprovalRequest({scope:()=>scope,present:async p=>(shown.push(p),true)},1000);
let pending=request.confirm(prompt);
assert.equal(await request.confirm({...prompt,id:'overlap'}),'deny');
request.respond('foreign','allow');assert.equal(shown.at(-1).id,'one');
request.respond('one','remember');assert.equal(await pending,'remember');
pending=request.confirm({...prompt,id:'destructive',destructive:true});request.respond('destructive','remember');assert.equal(shown.at(-1).id,'destructive');request.respond('destructive','deny');assert.equal(await pending,'deny');
pending=request.confirm({...prompt,id:'not-listed',rememberAllowed:false});request.respond('not-listed','remember');request.respond('not-listed','allow');assert.equal(await pending,'allow');
pending=request.confirm({...prompt,id:'stale'});scope='b';request.respond('stale','allow');assert.equal(await pending,'deny');
pending=request.confirm({...prompt,id:'cancel'});request.cancel();request.respond('cancel','allow');assert.equal(await pending,'deny');
const unavailable=new CommandApprovalRequest({scope:()=>scope,present:async()=>false});assert.equal(await unavailable.confirm(prompt),'deny');
const timeout=new CommandApprovalRequest({scope:()=>scope,present:async()=>true},5);assert.equal(await timeout.confirm(prompt),'deny');
const copy={...prompt};pending=request.confirm(copy);copy.command='changed';assert.equal(shown.at(-1).command,'git status');request.respond('one','deny');await pending;
// The heading is chosen by request kind from the real SDK request shape, never from its text.
for(const [input,want] of [[{toolName:'Bash',input:{command:'ls -la'}},'shell'],[{toolName:'Bash',input:{command:'rm -rf ./build'}},'destructive'],[{toolName:'mystery_tool',input:{x:1}},'unrecognized']]){
 const req=sdkToolToActionRequest(input);assert.equal(req.kind,'executeShell');const kind=commandApprovalPurposeFor(req.payload,req.destructive===true);assert.equal(kind,want,JSON.stringify(input));
 const text=commandApprovalPurposeText(kind);assert.ok(!text.includes(input.toolName)&&!text.includes(String(input.input.command??'')||'\u0000'),'heading never repeats the tool name or command');assert.ok(text.length<=24,'one short line');
}
for(const hostile of ['Bash: rm -rf /','__proto__','toString',null,42,undefined])assert.equal(commandApprovalPurposeText(hostile),COMMAND_APPROVAL_PURPOSE.unrecognized,`unknown purpose falls back: ${String(hostile)}`);
console.log('PASS command approval request: nonce-like id, phase, destructive no-remember, unavailable, timeout, scope, cancel, overlap, frozen command');
