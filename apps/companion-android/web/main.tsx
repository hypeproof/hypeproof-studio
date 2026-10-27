import React, {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {CompanionPreviewClient,CompanionRelayClient} from '@hypeproof/companion-client';
import {CompanionSelectionReceiver} from '@companion/selection';
import {CompanionClientAdapter} from '../../../extensions/hypeproof-chat/src/companionClientAdapter';
import {CompanionTransportBudget} from '../../../extensions/hypeproof-chat/src/companionTransportBudget';
import {CompanionMobileSessionController} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionController';
import {CompanionSessionView} from '../../../extensions/hypeproof-chat/webview-ui/src/CompanionSessionView';
import {companionSessionPresentation} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionPresentation';
import {PREVIEW_IFRAME_SANDBOX,PREVIEW_IFRAME_ALLOW} from '../../../extensions/hypeproof-chat/src/cspBuilder';
import {createNativePort} from './nativePort';
import {CompanionAndroidResultTransport} from './resultTransport';
import './style.css';
declare global {interface Window {CompanionNative:Parameters<typeof createNativePort>[0]}}
const port=createNativePort(window.CompanionNative);
const budget=new CompanionTransportBudget({minSpacingMs:1200});
let identity:any,pairing:any,relay:any,receiver:any,adapter:CompanionClientAdapter|undefined,controller:CompanionMobileSessionController|undefined;
let lifetime=new AbortController(),closed=false;
let bootstrap:any[]|null=null;
let resultTransport:CompanionAndroidResultTransport|undefined;
const rawPair=(_role:any,invitationId:any,action:any,payload:any,signal?:AbortSignal)=>port.call({kind:'pairing',invitationId,action,payload},signal??lifetime.signal);
const rawRelay=(_role:any,invitationId:any,action:any,raw:any,signal?:AbortSignal)=>port.call({kind:'relay',invitationId,action,raw},signal??lifetime.signal);
const schedule=<Args extends any[],Result>(operation:(...args:Args)=>Promise<Result>)=>(...args:Args):Promise<Result>=>budget.run<Result>(()=>operation(...args),lifetime.signal);
function erasePair(client:any){if(client){client.keys=null;client.qr=null;client.claim=null;client.frozenClaim=null;}}
function clear(){closed=true;lifetime.abort();resultTransport?.close();resultTransport=undefined;controller?.dispose();adapter?.dispose();relay?.close();receiver?.close();erasePair(pairing);pairing=null;relay=null;receiver=null;bootstrap=null;identity=null;budget.dispose();port.close();}
window.addEventListener('pagehide',clear,{once:true});
function App(){
 const [stage,setStage]=useState('identity'),[challenge,setChallenge]=useState(''),[message,setMessage]=useState('컴퓨터에서 작업과 저장 HTML을 준비해 주세요.'),[busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState<any>(null),[comparison,setComparison]=useState('');
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
  resultTransport=new CompanionAndroidResultTransport({relay,selection:receiver,initialRevision:chosen.revision,
   onHeld:()=>{if(!closed)setMessage('컴퓨터에서 새 선택 정보를 받았어요. 현재 요청의 결과는 계속 확인하며, 새 선택을 자동으로 요청하지 않아요. 새 선택으로 보려면 연결을 새로 준비해 주세요.');},
   onInvalid:()=>{if(closed)return;clear();setStage('closed');setMessage('선택 정보 처리를 마치지 못해 이 기기 연결을 닫았어요. 이미 받은 결과만 남아 있어요. 현재 컴퓨터 작업의 취소나 완료를 확인한 것은 아니에요.');}});
  adapter=new CompanionClientAdapter({pairing,relay,requestId:chosen.request.requestId,budget});
  const selected={request:chosen.request,projectName:'선택한 작업',artifactName:'저장된 HTML'};
  controller=new CompanionMobileSessionController({transport:resultTransport.bind(adapter),descriptor:async(signal)=>{
   await adapter!.refresh(signal);const diagnostics=relay.diagnostics();
   if(closed||diagnostics.closed||!diagnostics.context_digest||pairing.invitation.status!=='paired')return null;
   // This is transport readiness after authenticated metadata, not a host heartbeat.
   return {computerName:'연결된 컴퓨터',online:pairing.invitation.status==='paired'&&!diagnostics.closed,selection:selected};
  }},{timeoutMs:60000,pollMs:1000});
  const facade={requestPreview:controller.requestPreview.bind(controller),reconnect:controller.reconnect.bind(controller),forget:async()=>{await controller!.forget();if(closed)return;clear();setSnapshot(controller!.getSnapshot());setComparison('');setChallenge('');setStage('forgotten');setMessage('이 기기의 보기 기록을 지웠어요. 컴퓨터 원본과 이미 허용한 작업은 그대로예요.');}};
  controller.subscribe(setSnapshot);await controller.reconnect(null);if(closed)return;
  (controller as any).presentationFacade=facade;setSnapshot(controller.getSnapshot());setStage('preview');setMessage('최근 연결을 확인했어요. 컴퓨터 응답은 요청 후 확인해요. 보기를 요청하면 컴퓨터에서 별도로 허용해야 해요.');
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
 {(stage==='preview'||stage==='forgotten')&&snapshot&&controller&&<CompanionSessionView snapshot={snapshot} controller={(controller as any).presentationFacade} renderPreview={artifact}/>}
 {stage==='closed'&&snapshot&&companionSessionPresentation(snapshot).preview&&<section><h2>이 기기에 남은 결과</h2>{artifact(companionSessionPresentation(snapshot).preview)}</section>}
 {!['closed','forgotten'].includes(stage)&&<button className="secondary" onClick={cancel}>이 기기 연결 닫기</button>}
 <p className="detail">연결 표시는 최근 확인한 암호화 전송 상태예요. 컴퓨터가 지금 켜져 있다는 확인은 아니에요. 컴퓨터 응답은 요청 후 확인하며, 꺼져 있으면 기다려요. 기기 연결은 파일 실행 권한이 아니에요. 앱을 다시 시작하면 키를 복원하지 않아요.</p></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
