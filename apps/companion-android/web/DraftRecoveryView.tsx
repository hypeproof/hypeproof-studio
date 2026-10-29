import React,{useState} from 'react';
import type {DraftView} from './draftRecovery';
import {sameDraftSelection} from '../../../extensions/hypeproof-chat/webview-ui/src/companionDraftRecord';
import type {CompanionHostRequest} from '../../../extensions/hypeproof-chat/src/companionHostDispatch';
export function DraftRecoveryView({view,selection,disabled,recover,erase,liveAttempt=false}:{view:DraftView;selection?:CompanionHostRequest;disabled:boolean;recover(reassociate:boolean):Promise<void>;erase():Promise<void>;liveAttempt?:boolean}){
 const [confirm,setConfirm]=useState(false),[working,setWorking]=useState(false);
 const act=async(action:()=>Promise<void>)=>{if(working||disabled)return;setWorking(true);try{await action();setConfirm(false);}catch{/* Owner renders failure without claiming deletion. */}finally{setWorking(false);}};
 const scope=(s:CompanionHostRequest)=>`${s.hostId} / ${s.workspaceId} / ${s.projectId} / ${s.taskId} / ${s.artifactId} (작업 버전 ${s.version}, 파일 ${s.artifactVersion}, 연결 세대 ${s.epoch}, 동의 버전 ${s.consentRevision})`;
 const same=!!selection&&!!view.record&&sameDraftSelection(view.record.selection,selection);
 return <section aria-label="이 기기의 요청 기록">
  {view.status==='foreign'&&<p role="alert">다른 계정이나 서비스의 기록이 이 기기에 남아 있어요. 원래 계정과 서비스로 로그인해야 확인하거나 지울 수 있어요. 새 초안으로 덮어쓰지 않아요.</p>}
  {view.status==='corrupt'&&<p role="alert">이 기기의 기록을 읽지 못했어요. 원본 저장 내용은 지우거나 덮어쓰지 않았어요.</p>}
  {view.status==='error'&&<p role="alert">저장 기록을 확인하지 못했어요. 이번 확인에서 기록을 바꾸거나 요청을 다시 보내지 않았어요. 앱을 다시 열어 확인해 주세요.</p>}
  {['detached','unknown'].includes(view.status)&&!liveAttempt&&<><h2>이 기기에 남은 요청</h2><pre>{view.text}</pre>
   {view.status==='unknown'?<><p role="status">전달·실행 여부를 확인하지 못했어요. 컴퓨터에서 기록을 확인해 주세요. 이 요청을 다시 보내지 않아요.</p><p>요청 번호: {view.record?.phase==='attempted_unknown'?view.record.requestId:'확인되지 않음'}</p></>
    :<><p>아직 현재 작업에 적용하지 않았어요.</p><p>원래 작업: {view.record?scope(view.record.selection):'확인되지 않음'}</p>
     {selection&&<p>현재 작업: {scope(selection)}</p>}
     <button disabled={disabled||working||!selection} onClick={()=>void act(()=>recover(!same))}>{same?'이 초안으로 계속하기':'현재 선택으로 초안 옮기기'}</button></>}
  </>}
  {view.error&&view.status!=='error'&&<p role="alert">저장 또는 삭제를 확인하지 못했어요. 적은 내용은 남아 있으며 완료로 표시하지 않았어요.</p>}
  {['editing','detached','unknown','corrupt'].includes(view.status)&&<>
   {!confirm?<button className="secondary" disabled={disabled||working||view.busy} onClick={()=>setConfirm(true)}>이 기기의 초안 기록 지우기</button>
    :<><p role="alert">이 기기의 초안과 요청 기록을 지울까요? 컴퓨터 작업을 취소하거나 원본을 지우거나 공유를 철회하지 않아요. 실행되지 않았다는 확인도 아니에요.</p>
     <button disabled={disabled||working||view.busy} onClick={()=>void act(erase)}>기기 기록만 지우기</button><button disabled={working} onClick={()=>setConfirm(false)}>그대로 두기</button></>}
  </>}
 </section>;
}
