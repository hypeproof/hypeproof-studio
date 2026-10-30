/** #3135: reachable even when the Studio shell hides its status bar. */
import {useEffect,useState} from 'react';
import {onHostMessage,postToHost} from './vscode';
import {companionReceivingLabels,type CompanionReceivingControls as Controls,type CompanionReceivingAction} from '../../src/companionReceivingControls';
export function CompanionReceivingControls(){
  const [controls,setControls]=useState<Controls|null>(null);
  const [pending,setPending]=useState<string|null>(null);
  useEffect(()=>{
    const off=onHostMessage(msg=>{if(msg.type==='companionReceivingState'){setControls(msg.controls);setPending(null);}});
    postToHost({type:'companionReceivingStateRequest'});return off;
  },[]);
  if(!controls||controls.state==='closed')return null;
  const act=(action:CompanionReceivingAction)=>{if(pending===controls.nonce)return;setPending(controls.nonce);postToHost({type:'companionReceivingAction',nonce:controls.nonce,action});};
  return <section className="hps-companion-receiving" aria-label="휴대폰 연결">
    <span role="status">{companionReceivingLabels[controls.state]}</span>
    <button type="button" disabled={!controls.canStop||pending===controls.nonce} onClick={()=>act('stop')}>수신 중지</button>
    <button type="button" disabled={!controls.canRevoke||pending===controls.nonce} onClick={()=>act('revoke')}>기기 연결 해제</button>
    <span className="hps-companion-receiving-note">수신을 멈춰도 기기의 연결 권한은 남을 수 있어요. 승인 창이 열려 있으면 먼저 취소해 주세요.</span>
  </section>;
}
