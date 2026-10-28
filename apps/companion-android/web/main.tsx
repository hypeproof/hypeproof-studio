import React, {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {CompanionPreviewClient,CompanionRelayClient} from '@hypeproof/companion-client';
import {CompanionSelectionReceiver} from '@companion/selection';
import {CompanionClientAdapter} from '../../../extensions/hypeproof-chat/src/companionClientAdapter';
import {CompanionTransportBudget} from '../../../extensions/hypeproof-chat/src/companionTransportBudget';
import {CompanionMobileSessionController} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionController';
import {CompanionSessionView} from '../../../extensions/hypeproof-chat/webview-ui/src/CompanionSessionView';
import {companionSessionPresentation,companionSelectionIdentity} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionPresentation';
import {PREVIEW_IFRAME_SANDBOX,PREVIEW_IFRAME_ALLOW} from '../../../extensions/hypeproof-chat/src/cspBuilder';
import {createNativePort} from './nativePort';
import {CompanionAndroidResultTransport} from './resultTransport';
import {AuthoringComposer} from './AuthoringComposer';
import {CompanionAuthoringReceiptObserver,type AuthoringReceiptWaitState} from './authoringReceiptObserver';
import {createCompanionAuthoringIntent} from '../../../extensions/hypeproof-chat/src/companionAuthoringIntent';
import {parseCompanionAuthoringResult,type CompanionAuthoringResult} from '../../../extensions/hypeproof-chat/src/companionAuthoringResult';
import {parseCompanionExecutionResult,type CompanionExecutionResult} from '../../../extensions/hypeproof-chat/src/companionExecutionResult';
import './style.css';
type AuthoringReply=CompanionAuthoringResult|Readonly<CompanionExecutionResult>;
const parseAuthoringReply=(text:string,id:string,hash:string):AuthoringReply|null=>parseCompanionAuthoringResult(text,id,hash)??parseCompanionExecutionResult(text,id,hash);
const replyState=(reply:AuthoringReply)=>reply.schema==='hps-companion-execution-result/1'?reply.state:reply.outcome.state;
declare global {interface Window {CompanionNative:Parameters<typeof createNativePort>[0]}}
const port=createNativePort(window.CompanionNative);
const budget=new CompanionTransportBudget({minSpacingMs:1200});
let identity:any,pairing:any,relay:any,receiver:any,adapter:CompanionClientAdapter|undefined,controller:CompanionMobileSessionController|undefined;
let lifetime=new AbortController(),closed=false;
let bootstrap:any[]|null=null;
let resultTransport:CompanionAndroidResultTransport|undefined;
let mobileTransport:ReturnType<CompanionAndroidResultTransport['bind']>|undefined;
let authoringPending:{requestId:string;requestHash:string;reply?:string;received:boolean;current():boolean}|undefined;
let authoringObserver:CompanionAuthoringReceiptObserver|undefined;
let authoringStarted=false,adoptingSelection=false;
const retiredAuthoringReplies=new Set<string>();
const rawPair=(_role:any,invitationId:any,action:any,payload:any,signal?:AbortSignal)=>port.call({kind:'pairing',invitationId,action,payload},signal??lifetime.signal);
const rawRelay=(_role:any,invitationId:any,action:any,raw:any,signal?:AbortSignal)=>port.call({kind:'relay',invitationId,action,raw},signal??lifetime.signal);
const schedule=<Args extends any[],Result>(operation:(...args:Args)=>Promise<Result>)=>(...args:Args):Promise<Result>=>budget.run<Result>(()=>operation(...args),lifetime.signal);
function erasePair(client:any){if(client){client.keys=null;client.qr=null;client.claim=null;client.frozenClaim=null;}}
function clear(){closed=true;retiredAuthoringReplies.clear();authoringObserver?.close();authoringObserver=undefined;mobileTransport=undefined;authoringPending=undefined;lifetime.abort();resultTransport?.close();resultTransport=undefined;controller?.dispose();adapter?.dispose();relay?.close();receiver?.close();erasePair(pairing);pairing=null;relay=null;receiver=null;bootstrap=null;identity=null;budget.dispose();port.close();}
window.addEventListener('pagehide',clear,{once:true});
function App(){
 const [stage,setStage]=useState('identity'),[challenge,setChallenge]=useState(''),[message,setMessage]=useState('컴퓨터에서 작업과 저장 HTML을 준비해 주세요.'),[busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState<any>(null),[comparison,setComparison]=useState('');
 const [authoringActive,setAuthoringActive]=useState(false);
 const [authoringResult,setAuthoringResult]=useState<AuthoringReply|null>(null);
 const [authoringWait,setAuthoringWait]=useState<AuthoringReceiptWaitState|null>(null);
 const [heldSelection,setHeldSelection]=useState<{revision:number;requestId:string}|null>(null),[previousPreview,setPreviousPreview]=useState<any>(null);
 const inFlight=useRef(false);
 useEffect(()=>()=>clear(),[]);
 async function act(action:()=>Promise<void>){if(inFlight.current||closed)return;inFlight.current=true;setBusy(true);try{await action();}catch{if(!closed)setMessage('이번 확인을 마치지 못했어요. 완료로 표시하지 않았어요. 상태를 확인하고 직접 다시 시도해 주세요.');}finally{inFlight.current=false;setBusy(false);}}
 async function verify(){identity=await port.call({kind:'identity'},lifetime.signal);if(closed)return;
  if(!crypto.subtle||!crypto.getRandomValues)throw Error('webcrypto_required');
  pairing=new CompanionPreviewClient({role:'device',sessionId:identity.sessionId,transport:schedule(rawPair)});setStage('invitation');setMessage('DEV 테스트 계정 연결을 확인했어요. 컴퓨터의 초대 정보를 직접 붙여 넣어 주세요.');}
 async function claim(){const client=pairing;try{if(new TextEncoder().encode(challenge).length>8192)throw Error('challenge_bound');await client.inspect(JSON.parse(challenge));if(closed)return;await client.claimDevice();if(closed)return;setChallenge('');setComparison(client.invitation.compare_code);setStage('approval');setMessage('두 화면의 코드를 직접 비교하고 컴퓨터에서 승인해 주세요.');}finally{if(closed)erasePair(client);}}
 async function offer(){await pairing.refresh();if(pairing.invitation.status==='approved')await pairing.consume();if(pairing.invitation.status!=='paired')throw Error('pairing_waiting');if(!relay)relay=new CompanionRelayClient({pairing,transport:schedule(rawRelay)});await relay.publishOffer();if(closed)return;setStage('cipher');setMessage('기기 암호화 키를 준비했어요. 컴퓨터에서 암호화 연결을 준비한 뒤 연결을 확인해 주세요.');}
 async function connect(){await relay.connect();if(closed)return;receiver=new CompanionSelectionReceiver({pair:relay.row});setStage('selection');setMessage('암호화 연결을 확인했어요. 컴퓨터에서 선택한 작업을 알린 뒤 여기에서 받아 주세요.');}
 async function selection(){
  if(!bootstrap)bootstrap=await relay.receive();
  const batch=bootstrap!;let chosen:any;const acknowledgements:string[]=[];
  try{for(const item of batch){const result=await receiver.accept(item);if(!result)throw Error('unexpected_bootstrap_message');acknowledgements.push(result.messageId);if(result.kind!=='stale'&&(!chosen||result.revision>chosen.revision))chosen=result;}}
  catch{clear();setStage('closed');setMessage('선택 정보를 확인하지 못해 연결을 닫았어요. 승인하거나 전송 확인하지 않았어요. 다시 연결해 주세요.');return;}
  if(!chosen){if(!batch.length){bootstrap=null;setMessage('아직 선택 정보가 없어요. 컴퓨터에서 선택한 작업을 알린 뒤 다시 받아 주세요.');return;}throw Error('selection_missing');}
  for(const id of acknowledgements)await relay.acknowledge(id);
  bootstrap=null;
  if(closed)return;
  // Settled, exclusive handoff: adapter now admits each raw transport HTTP with the same budget.
  pairing.transport=rawPair;relay.transport=rawRelay;
  const validateReply=(message:Readonly<{text:string}>)=>{if(closed)return false;if(retiredAuthoringReplies.has(message.text))return true;if(!authoringPending?.current())return false;const parsed=parseAuthoringReply(message.text,authoringPending.requestId,authoringPending.requestHash);if(!parsed||(authoringPending.reply&&authoringPending.reply!==message.text))return false;authoringPending.reply=message.text;return true;};
  const publishReply=(message:Readonly<{text:string}>)=>{if(closed||!authoringPending?.current())return;const parsed=parseAuthoringReply(message.text,authoringPending.requestId,authoringPending.requestHash);if(parsed&&authoringPending.reply===message.text&&!authoringPending.received){authoringPending.received=true;setAuthoringResult(parsed);}};
  resultTransport=new CompanionAndroidResultTransport({relay,selection:receiver,initialRevision:chosen.revision,
   validateAuthoringResult:validateReply,onAuthoringResult:publishReply,validateExecutionResult:validateReply,onExecutionResult:publishReply,
   onHeld:value=>{if(!closed){setHeldSelection(value);setMessage('컴퓨터에서 새 선택 정보를 받았어요. 지금 보기는 그대로예요. 새 버전은 직접 선택한 뒤 보기를 요청해 주세요.');}},
   onInvalid:()=>{if(closed)return;clear();setStage('closed');setMessage('선택 정보 처리를 마치지 못해 이 기기 연결을 닫았어요. 이미 받은 결과만 남아 있어요. 현재 컴퓨터 작업의 취소나 완료를 확인한 것은 아니에요.');}});
  adapter=new CompanionClientAdapter({pairing,relay,requestId:chosen.request.requestId,budget});
  mobileTransport=resultTransport.bind(adapter);
  await openSelection(chosen);
 }
 async function openSelection(chosen:any){
  const selected={request:chosen.request,projectName:'선택한 작업',artifactName:'저장된 HTML'};
  const ownedAdapter=adapter!,ownedRelay=relay,ownedPair=pairing,ownedTransport=mobileTransport!;
  const ownedController=new CompanionMobileSessionController({transport:ownedTransport,descriptor:async(signal,phase)=>{
   if(closed||controller!==ownedController||adapter!==ownedAdapter||mobileTransport!==ownedTransport)return null;
   if(phase!=='before_ack')await ownedAdapter.refresh(signal);const diagnostics=ownedRelay.diagnostics();
   if(closed||signal.aborted||controller!==ownedController||adapter!==ownedAdapter||mobileTransport!==ownedTransport||diagnostics.closed||!diagnostics.context_digest||ownedPair.invitation.status!=='paired')return null;
   return {computerName:'연결된 컴퓨터',online:true,selection:selected};
  }},{timeoutMs:60000,pollMs:1000});
  controller=ownedController;
  const facade={requestPreview:(...args:Parameters<CompanionMobileSessionController['requestPreview']>)=>authoringStarted||adoptingSelection||controller!==ownedController?Promise.resolve():ownedController.requestPreview(...args),reconnect:(...args:Parameters<CompanionMobileSessionController['reconnect']>)=>authoringStarted||adoptingSelection||controller!==ownedController?Promise.resolve():ownedController.reconnect(...args),forget:async()=>{if(adoptingSelection||controller!==ownedController)return;await ownedController.forget();if(closed)return;const saved=ownedController.getSnapshot();clear();setPreviousPreview(null);setHeldSelection(null);setSnapshot(saved);setComparison('');setChallenge('');setStage('forgotten');setMessage('이 기기의 보기 기록을 지웠어요. 컴퓨터 원본과 이미 허용한 작업은 그대로예요.');}};
  (ownedController as any).presentationFacade=facade;
  ownedController.subscribe(value=>{if(!closed&&controller===ownedController)setSnapshot(value);});
  setSnapshot(ownedController.getSnapshot());await ownedController.reconnect(null);if(closed||controller!==ownedController)return;
  setSnapshot(ownedController.getSnapshot());setStage('preview');setMessage('최근 연결을 확인했어요. 보기를 직접 요청하면 컴퓨터에서 별도로 허용해야 해요.');
 }
 function settledForSelection():boolean{
  const current=controller?.getSnapshot();
  return !!current&&!current.busy&&!!current.receipt&&['completed','denied','failed','desktop_handoff'].includes(current.receipt.outcome.state)
   &&(!authoringStarted||(authoringPending?.received===true&&!!authoringResult&&replyState(authoringResult)!=='outcome_unknown'));
 }
 async function checkNewSelection(){
  if(closed||adoptingSelection||!settledForSelection()||!resultTransport||!controller?.getSnapshot().selection)throw Error('previous_request_unconfirmed');
  await resultTransport.checkSelections(controller.getSnapshot().selection!.request,lifetime.signal);
  if(!closed&&!resultTransport.heldSelection)setMessage('아직 새 선택 정보를 받지 못했어요. 지금 보기는 그대로예요. 요청을 다시 보내지 않았어요.');
 }
 async function adoptNewSelection(){
  const held=resultTransport?.heldSelection,ownedAdapter=adapter,ownedController=controller,ownedResults=resultTransport,ownedTransport=mobileTransport;
  const prior=ownedController?.getSnapshot(),pending=authoringPending,ownedPair=pairing,ownedRelay=relay;
  const cipher=ownedRelay?.diagnostics().context_digest;
  if(closed||adoptingSelection||!held||!prior?.selection||!ownedController||!ownedAdapter||!ownedResults||!settledForSelection())throw Error('previous_request_unconfirmed');
  const current=()=>!closed&&!lifetime.signal.aborted&&adapter===ownedAdapter&&controller===ownedController&&resultTransport===ownedResults&&mobileTransport===ownedTransport&&pairing===ownedPair&&relay===ownedRelay&&ownedPair.invitation.status==='paired'&&ownedRelay.row.grant_expires_at*1000>Date.now()&&!!cipher&&!ownedRelay.diagnostics().closed&&ownedRelay.diagnostics().context_digest===cipher&&authoringPending===pending&&ownedController.getSnapshot()===prior&&settledForSelection();
  adoptingSelection=true;
  try{
   const next=await ownedResults.adoptHeld({revision:held.revision,requestId:held.request.requestId},prior.selection.request,lifetime.signal,request=>ownedAdapter.adoptSelection(request,prior.selection!.request.requestId,lifetime.signal,current));
   if(!current())throw Error('owner_changed');
   authoringObserver?.close();authoringObserver=undefined;
   if(pending?.reply)retiredAuthoringReplies.add(pending.reply);
   setPreviousPreview(companionSessionPresentation(prior).preview??previousPreview);ownedController.dispose();
   authoringStarted=false;authoringPending=undefined;setAuthoringActive(false);setAuthoringResult(null);setAuthoringWait(null);setHeldSelection(null);
   await openSelection(next);
  }finally{adoptingSelection=false;}
 }

 async function submitAuthoring(draft:string):Promise<{state:'relay_received';requestId:string}>{
  if(closed||adoptingSelection||authoringStarted||!adapter||!relay||!controller||!mobileTransport||controller.getSnapshot().busy)throw Error('authoring_not_ready');
  const current=controller.getSnapshot(),selected=current.selection?.request;
  if(!selected||companionSessionPresentation(current).phase!=='completed')throw Error('verified_preview_required');
  const packet=createCompanionAuthoringIntent({requestId:'intent_'+crypto.randomUUID().replaceAll('-',''),pairingId:relay.row.id,selection:selected,text:draft});
  const ownedAdapter=adapter,ownedRelay=relay,ownedController=controller,ownedTransport=mobileTransport,ownedPair=pairing;
  const selectedIdentity=companionSelectionIdentity(selected),pairId=relay.row.id,cipher=relay.diagnostics().context_digest;
  authoringStarted=true;setAuthoringActive(true);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(packet.text));
  if(closed||adapter!==ownedAdapter||relay!==ownedRelay||controller!==ownedController||mobileTransport!==ownedTransport)throw Error('owner_closed');
  const pending={requestId:packet.requestId,requestHash:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),received:false,current:():boolean=>false};
  pending.current=()=>!closed&&!lifetime.signal.aborted&&authoringPending===pending&&adapter===ownedAdapter&&relay===ownedRelay&&controller===ownedController&&mobileTransport===ownedTransport&&pairing===ownedPair&&ownedPair.invitation?.id===pairId&&ownedPair.invitation.status==='paired'&&ownedRelay.row.grant_expires_at*1000>Date.now()&&!ownedRelay.diagnostics().closed&&ownedRelay.diagnostics().context_digest===cipher&&companionSelectionIdentity(ownedController.getSnapshot().selection?.request)===selectedIdentity;
  authoringPending=pending;
  const observer=new CompanionAuthoringReceiptObserver({current:pending.current,received:()=>pending.received,receive:async signal=>{const messages=await ownedTransport.receive(signal);if(messages.length)throw Error('unexpected_preview_result_during_authoring');},changed:state=>{if(!closed&&authoringPending===pending)setAuthoringWait(state);}});authoringObserver=observer;
  try{return await ownedAdapter.submitAuthoring(packet.text,packet.requestId,lifetime.signal);}
  finally{if(pending.current())void observer.start(lifetime.signal);}
 }
 async function checkAuthoring(){
  if(closed||adoptingSelection||!authoringPending||!authoringObserver||controller?.getSnapshot().busy)throw Error('authoring_not_ready');
  await authoringObserver.check(lifetime.signal);
 }
 function cancel(){clear();setComparison('');setChallenge('');setStage('closed');setBusy(false);setMessage('이 기기의 연결을 닫았어요. 이미 받은 결과만 이 화면에 남아 있어요. 서버 권한 철회나 이미 허용한 작업 취소를 뜻하지 않아요.');}
 const artifact=(value:any)=>{const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return <iframe title="선택한 HTML 미리보기" sandbox={PREVIEW_IFRAME_SANDBOX} allow={PREVIEW_IFRAME_ALLOW} referrerPolicy="no-referrer" srcDoc={'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'">'+value.text}/>;};
 return <main><h1>컴퓨터에서 고른 결과 보기</h1><p className="experiment">DEV APK 실험 · 테스트 계정 · 원본은 컴퓨터에 있어요</p><p role="status">{message}</p>
 {stage==='identity'&&<button disabled={busy} onClick={()=>act(verify)}>기기 연결 확인</button>}
 {stage==='invitation'&&<><label htmlFor="challenge">컴퓨터 초대 정보</label><textarea id="challenge" value={challenge} maxLength={8192} onChange={e=>setChallenge(e.target.value)} disabled={busy}/><button disabled={busy||!challenge} onClick={()=>act(claim)}>초대 확인·참여 요청</button></>}
 {comparison&&stage!=='closed'&&<p aria-label="기기 비교 코드">비교 코드: <strong>{comparison}</strong></p>}
 {stage==='approval'&&<button disabled={busy} onClick={()=>act(offer)}>컴퓨터 승인 확인·기기 키 준비</button>}
 {stage==='cipher'&&<button disabled={busy} onClick={()=>act(connect)}>암호화 연결 확인</button>}
 {stage==='selection'&&<button disabled={busy} onClick={()=>act(selection)}>선택한 작업 받기</button>}
 {(stage==='preview'||stage==='forgotten')&&!authoringActive&&snapshot&&controller&&<CompanionSessionView snapshot={snapshot} controller={(controller as any).presentationFacade} renderPreview={artifact}/>}
 {stage==='preview'&&previousPreview&&snapshot&&!companionSessionPresentation(snapshot).preview&&<section><h2>이전에 확인한 결과</h2>{artifact(previousPreview)}</section>}
 {stage==='preview'&&snapshot?.receipt&&<section><button className="secondary" disabled={busy||!settledForSelection()} onClick={()=>act(checkNewSelection)}>컴퓨터의 새 버전 확인</button>{heldSelection&&<><p>새 선택 정보가 있어요. 선택하면 요청 초안을 새로 시작하며, 새 결과는 다시 보기를 요청해야 해요.</p><button disabled={busy||!settledForSelection()} onClick={()=>act(adoptNewSelection)}>새 버전 선택</button></>}</section>}
 {authoringActive&&stage==='preview'&&snapshot&&companionSessionPresentation(snapshot).preview&&<section><h2>요청 전에 본 결과</h2>{artifact(companionSessionPresentation(snapshot).preview)}</section>}
 {authoringActive&&stage==='preview'&&!authoringResult&&authoringWait==='waiting'&&<p role="status">컴퓨터의 검토 응답을 잠시 기다리고 있어요. 요청을 자동으로 다시 보내지 않아요.</p>}
 {authoringActive&&stage==='preview'&&!authoringResult&&authoringWait==='unconfirmed'&&<p role="status">아직 컴퓨터 응답을 확인하지 못했어요. 아래 ‘컴퓨터 검토 상태 확인’으로 직접 확인할 수 있어요. 요청은 다시 보내지 않았어요.</p>}
 {snapshot&&companionSessionPresentation(snapshot).preview&&!['forgotten'].includes(stage)&&<AuthoringComposer key={companionSelectionIdentity(snapshot.selection?.request)} disabled={closed||busy||!!snapshot.busy} submit={submitAuthoring} check={checkAuthoring} outcome={authoringResult?.schema==='hps-companion-authoring-result/1'?authoringResult.outcome:undefined} execution={authoringResult?.schema==='hps-companion-execution-result/1'?authoringResult:undefined}/>}
 {stage==='closed'&&snapshot&&(companionSessionPresentation(snapshot).preview??previousPreview)&&<section><h2>이 기기에 남은 결과</h2>{artifact(companionSessionPresentation(snapshot).preview??previousPreview)}</section>}
 {!['closed','forgotten'].includes(stage)&&<button className="secondary" onClick={cancel}>이 기기 연결 닫기</button>}
 <p className="detail">연결 표시는 최근 확인한 암호화 전송 상태예요. 컴퓨터가 지금 켜져 있다는 확인은 아니에요. 컴퓨터 응답은 요청 후 확인하며, 꺼져 있으면 기다려요. 기기 연결은 파일 실행 권한이 아니에요. 앱을 다시 시작하면 키를 복원하지 않아요.</p></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
