// DMC-4/5 presentation; injected verified result/controller, no host/relay/auth fixture.
import { mountPoint, click } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { CompanionSessionView } from '../webview-ui/src/CompanionSessionView';
import { companionSessionPresentation, type CompanionSessionSnapshot, type CompanionSessionController } from '../webview-ui/src/companionSessionPresentation';
import type { CompanionHostRequest, CompanionDispatchResult } from '../src/companionHostDispatch';
const reactAct = (React as unknown as { act(fn: () => unknown): Promise<void> }).act;
const act = (fn: () => unknown): Promise<void> => reactAct(async () => { await fn(); await Promise.resolve(); });
const request: CompanionHostRequest = { schema:'hps-companion-host-request/1',requestId:'request-one',actorId:'actor-one',deviceId:'phone-one',hostId:'host-one',workspaceId:'workspace-one',projectId:'project-one',taskId:'task-one',version:2,epoch:1,consentRevision:4,artifactId:'quiz',artifactVersion:'f357d56dda15620eda9e960b0ee4aa494adf603bae0484e220ed4e3172cc982e',operation:'preview.read' };
const result: CompanionDispatchResult = { state:'completed',code:'preview_read',requestId:request.requestId,artifact:{id:'quiz',version:request.artifactVersion,text:'<p>exact selected artifact bytes</p>'} };
const initial: CompanionSessionSnapshot = { computerName:'교실 컴퓨터',connection:'connected',selection:{request,projectName:'내가 만든 첫 퀴즈',artifactName:'색깔 퀴즈'},receipt:null,busy:false };
const clone = <T,>(value:T):T => structuredClone(value);
let checks=0;
const eq=(a:unknown,b:unknown,label:string)=>{assert.deepEqual(a,b,label);checks++;};
const good={...clone(initial),receipt:{request:clone(request),outcome:clone(result)}};
const view=companionSessionPresentation(good);eq(view.phase,'completed','only exact verified selected result completes');eq(view.preview?.text,result.artifact!.text,'renderer receives exact source text without transformation');
for(const field of ['schema','requestId','actorId','deviceId','hostId','workspaceId','projectId','taskId','version','epoch','consentRevision','artifactId','artifactVersion','operation'] as const){
 const changed=clone(good);(changed.receipt!.request as unknown as Record<string,unknown>)[field]=typeof changed.receipt!.request[field]==='number'?99:'different-value';
 eq(companionSessionPresentation(changed).phase,'stale','late receipt cannot cross '+field);eq(companionSessionPresentation(changed).preview,null,'no stale preview for '+field);
}
for(const field of ['id','version'] as const){const changed=clone(good);changed.receipt!.outcome.artifact![field]='different-value';eq(companionSessionPresentation(changed).preview,null,'mismatched artifact '+field+' never rendered');}
for(const connection of ['waiting_for_computer','reconnecting'] as const){const changed={...clone(good),connection};eq(companionSessionPresentation(changed).preview,null,'offline/reconnect hides former preview');eq(companionSessionPresentation(changed).phase,connection,'connection state overrides old completion');}
const unconfirmed:CompanionSessionSnapshot={...clone(good),connection:'waiting_for_computer',waitingReason:'request_unconfirmed'};
const pendingView=companionSessionPresentation(unconfirmed);eq(pendingView.title,'요청 결과를 아직 확인하지 못했어요','timeout does not claim the computer is offline');eq(pendingView.body,'같은 요청을 다시 보내지 않고 결과 상태를 확인해요.','pending copy preserves the same request');eq(pendingView.actionLabel,'결과 상태 확인','pending action checks result state');eq(pendingView.preview,null,'pending state hides a former completed artifact');
eq(companionSessionPresentation({...unconfirmed,waitingReason:'host_unavailable'}).body.includes('컴퓨터를 켜고'),true,'confirmed offline keeps computer recovery copy');
const invalidConnection={...clone(good),connection:'unknown'} as unknown as CompanionSessionSnapshot;eq(companionSessionPresentation(invalidConnection).preview,null,'unknown connection cannot show completion');
for(const state of ['wait_for_host','accepted','running','outcome_unknown','desktop_handoff','denied','failed'] as const){
 const changed={...clone(initial),receipt:{request:clone(request),outcome:{state,code:'synthetic_status',requestId:request.requestId}}};
 const shown=companionSessionPresentation(changed);eq(shown.phase,state,'explicit '+state+' state retained');eq(shown.preview,null,'non-completed '+state+' has no preview');eq(shown.action,'reconnect','non-completed '+state+' reconciles without resubmission');
}
const deniedLarge={...clone(initial),receipt:{request:clone(request),outcome:{state:'denied',code:'result_too_large',requestId:request.requestId} as CompanionDispatchResult}};eq(companionSessionPresentation(deniedLarge).title,'결과가 커서 가져오지 못했어요','existing oversized result denial uses easy copy');eq(companionSessionPresentation(deniedLarge).phase,'denied','oversized result never becomes handoff or success');
const unsupported=clone(initial);unsupported.selection!.request.operation='desktop.continue';eq(companionSessionPresentation(unsupported).phase,'denied','non-preview operation cannot become mobile desktop workaround');
const injectedArtifact={...clone(initial),receipt:{request:clone(request),outcome:{...clone(result),state:'denied' as const}}};eq(companionSessionPresentation(injectedArtifact).preview,null,'denial cannot smuggle prior HTML');

type El={getAttribute(n:string):string|null;textContent:string;localName:string;findAll(fn:(e:El)=>boolean):El[]};
const host=mountPoint() as unknown as El,root=createRoot(host as unknown as HTMLElement);
let requested=0,reconnected=0,rendered=0,lastRequest:Readonly<CompanionHostRequest>|null=null;
const controller:CompanionSessionController={async requestPreview(r){requested++;lastRequest=r;},async reconnect(r){reconnected++;lastRequest=r;}};
const renderPreview=(artifact:NonNullable<CompanionDispatchResult['artifact']>)=>{rendered++;return <div data-testid="injected-preview">{artifact.text}</div>;};
const render=async(snapshot:CompanionSessionSnapshot,c=controller)=>act(()=>{root.render(<CompanionSessionView snapshot={snapshot} controller={c} renderPreview={renderPreview}/>);});
const buttons=()=>host.findAll(e=>e.localName==='button');
async function run(){
await render(clone(initial));eq(requested,0,'mount never requests or auto-approves');eq(reconnected,0,'mount never creates connection work');eq(buttons().length,1,'one primary action');eq(buttons()[0].textContent,'선택한 결과 보기','single clear primary action label');
await act(()=>click(buttons()[0]));eq(requested,1,'explicit preview request uses existing controller');eq(lastRequest,request,'exact current request passed unchanged');
await render(good);eq(rendered,1,'exact completed result invokes injected existing renderer once');eq(host.textContent.includes('원본은 컴퓨터에 있어요.'),true,'local source ownership remains visible');
await act(()=>click(buttons()[0]));eq(reconnected,1,'completed view only reconciles state, never reruns work');eq(requested,1,'state check sends no new preview request');
await render(unconfirmed);eq(buttons()[0].textContent,'결과 상태 확인','unconfirmed result has one clear status action');await act(()=>click(buttons()[0]));eq(requested,1,'pending status action does not send a new preview request');eq(reconnected,2,'pending status action reconciles existing request');
const before=rendered;await render({...clone(good),connection:'waiting_for_computer'});eq(rendered,before,'offline does not rerender cached completion');eq(host.findAll(e=>e.getAttribute('data-testid')==='injected-preview').length,0,'old preview unmounted while waiting');
let release:()=>void=()=>{};const pending:CompanionSessionController={...controller,reconnect:async()=>{reconnected++;await new Promise<void>(resolve=>{release=resolve;});}};
await render({...clone(initial),connection:'waiting_for_computer'},pending);
await act(()=>{click(buttons()[0]);click(buttons()[0]);});eq(reconnected,3,'rapid repeated presses start one connection check');eq(buttons()[0].getAttribute('disabled')!==null,true,'pending action is visibly disabled');
await act(()=>release());eq(buttons()[0].getAttribute('disabled'),null,'controller completion unlocks without inventing a connection');eq(host.textContent.includes('컴퓨터를 기다리고 있어요'),true,'resolved callback alone never shows connected/completed');
const failing:CompanionSessionController={...controller,reconnect:async()=>{throw Error('do not display raw credential or provider detail');}};
await render({...clone(initial),connection:'waiting_for_computer'},failing);await act(()=>click(buttons()[0]));eq(host.textContent.includes('연결 상태를 확인하지 못했어요.'),true,'action failure offers clear Korean recovery');eq(host.textContent.includes('provider detail'),false,'raw error details not shown');
await render(deniedLarge);eq(rendered,before,'oversize denial never invokes renderer');eq(host.textContent.includes('승인'),false,'view contains no mobile host approval control');
await act(()=>root.unmount());
console.log(`PASS ${checks} companion session presentation/render assertions; injected verified receipts/controllers only. Real host/mobile/auth/transport NOT_RUN.`);

}
run().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
