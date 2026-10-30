import React, {useRef, useState} from 'react';
import type {CompanionExecutionResult} from '../../../extensions/hypeproof-chat/src/companionExecutionResult';
import {COMPANION_AUTHORING_TEXT_BYTES} from '../../../extensions/hypeproof-chat/src/companionAuthoringIntent';

/** No transport or execution authority here; the caller owns the verified selection and lifetime. */
export function AuthoringComposer({disabled, submit, check, outcome, execution}: {
 disabled: boolean;
 submit(text: string): Promise<{state:'relay_received';requestId:string}>;
 check?():Promise<void>;
 outcome?:{state:'imported_draft'|'cancelled'|'denied'|'outcome_unknown'};
 execution?:Readonly<CompanionExecutionResult>;
}) {
 const [draft,setDraft]=useState(''),[review,setReview]=useState(false);
 const [state,setState]=useState<'editing'|'sending'|'received'|'unknown'>('editing');
 const locked=useRef(false);
 const checking=useRef(false),[checkMessage,setCheckMessage]=useState(''),[checkBusy,setCheckBusy]=useState(false);
 const size=new TextEncoder().encode(draft).length;
 const valid=!!draft.trim()&&!draft.includes('\0')&&size<=COMPANION_AUTHORING_TEXT_BYTES;
 async function send(){
  if(disabled||!valid||!review||locked.current)return;
  locked.current=true;setState('sending');
  try{const result=await submit(draft);setState(result.state==='relay_received'?'received':'unknown');}
  catch{setState('unknown');}
 }
 async function inspect(){
  if(disabled||checking.current||!check)return;checking.current=true;setCheckBusy(true);
  try{await check();setCheckMessage('상태 확인을 마쳤어요. 아래에 컴퓨터 응답이 없다면 아직 검토 결과를 받지 못한 상태예요.');}
  catch{setCheckMessage('검토 상태를 확인하지 못했어요. 요청은 다시 보내지 않았어요.');}
  finally{checking.current=false;setCheckBusy(false);}
 }
 return <section aria-labelledby="authoring-title">
  <h2 id="authoring-title">어떻게 바꾸고 싶나요?</h2>
  <p>컴퓨터에서 정한 실행 허용 범위 안에서 요청을 처리해요. 실행이 허용되지 않았다면 컴퓨터에서 내용을 확인하고 보내기를 눌러 주세요.</p>
  <label htmlFor="authoring-draft">수정하고 싶은 점</label>
  <textarea id="authoring-draft" value={draft} readOnly={review||state!=='editing'} disabled={disabled}
   onChange={event=>setDraft(event.target.value)} aria-describedby="authoring-limit"/>
  <p id="authoring-limit" className="detail">짧은 요청 한 가지를 적어 주세요. {size}/{COMPANION_AUTHORING_TEXT_BYTES} 바이트 · 앱을 닫으면 이 초안은 지워져요.</p>
  {!valid&&size>COMPANION_AUTHORING_TEXT_BYTES&&<p role="alert">요청을 조금 줄여 주세요. 글을 자동으로 자르지 않아요.</p>}
  {state==='editing'&&!review&&<button disabled={disabled||!valid} onClick={()=>setReview(true)}>보낼 내용 확인</button>}
  {state==='editing'&&review&&<><p>이 내용을 연결된 컴퓨터에 검토 요청할까요?</p>
   <button disabled={disabled} onClick={()=>void send()}>컴퓨터에 검토 요청</button>
   <button className="secondary" disabled={disabled} onClick={()=>setReview(false)}>다시 고치기</button></>}
  {state==='sending'&&<p role="status">전달 여부를 확인하고 있어요.</p>}
  {state==='received'&&!outcome&&!execution&&<p role="status">중계 서비스가 요청을 받았어요. 컴퓨터의 검토와 AI 실행은 아직 확인하지 않았어요.</p>}
  {state==='unknown'&&!outcome&&!execution&&<p role="status">전달 여부를 확인하지 못했어요. 적은 내용은 여기 남아 있어요. 중복 요청을 막기 위해 다시 보내지 않아요. 컴퓨터에서 확인해 주세요.</p>}
  {(state==='received'||state==='unknown')&&check&&!outcome&&!execution&&<button disabled={disabled||checkBusy} onClick={()=>void inspect()}>컴퓨터 검토 상태 확인</button>}
  {checkMessage&&!outcome&&!execution&&<p role="status">{checkMessage}</p>}
  {execution&&<p role="status">{execution.state==='completed'?'컴퓨터에서 AI 작업을 마쳤어요. 새 버전을 받아 결과를 확인해 주세요. 화면의 보기는 요청 전에 받은 결과예요.':execution.state==='failed'?'컴퓨터의 AI 작업이 오류로 끝났어요. 파일이 바뀌었을 수 있어요. 컴퓨터에서 결과와 복원 기록을 확인해 주세요. 요청을 다시 보내지 않았어요.':execution.state==='denied'?'컴퓨터에서 이 요청을 실행하지 않았어요. 작업과 실행 허용 상태를 컴퓨터에서 확인해 주세요. 적은 내용은 여기 남아 있어요.':'컴퓨터의 AI 작업 결과를 확인하지 못했어요. 중복 실행을 막기 위해 요청을 다시 보내지 않았어요. 컴퓨터에서 확인해 주세요.'}</p>}
  {outcome&&<p role="status">{outcome.state==='imported_draft'?'컴퓨터 대화 입력에 가져왔어요. 컴퓨터에서 내용을 확인하고 보내기를 눌러 주세요. 아직 AI 작업은 시작하지 않았어요.':outcome.state==='cancelled'?'컴퓨터에서 가져오기를 취소했어요. 적은 내용은 여기 남아 있어요.':outcome.state==='denied'?'현재 컴퓨터 작업에는 가져오지 못했어요. 작업과 연결 상태를 컴퓨터에서 확인해 주세요.':'컴퓨터의 가져오기 결과를 확인하지 못했어요. 컴퓨터 대화 입력을 확인해 주세요. 다시 보내지 않았어요.'}</p>}
 </section>;
}
