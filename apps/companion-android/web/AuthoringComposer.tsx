import React, {useRef, useState} from 'react';
import {COMPANION_AUTHORING_TEXT_BYTES} from '../../../extensions/hypeproof-chat/src/companionAuthoringIntent';

/** No transport or execution authority here; the caller owns the verified selection and lifetime. */
export function AuthoringComposer({disabled, submit}: {
 disabled: boolean;
 submit(text: string): Promise<{state:'relay_received';requestId:string}>;
}) {
 const [draft,setDraft]=useState(''),[review,setReview]=useState(false);
 const [state,setState]=useState<'editing'|'sending'|'received'|'unknown'>('editing');
 const locked=useRef(false);
 const size=new TextEncoder().encode(draft).length;
 const valid=!!draft.trim()&&!draft.includes('\0')&&size<=COMPANION_AUTHORING_TEXT_BYTES;
 async function send(){
  if(disabled||!valid||!review||locked.current)return;
  locked.current=true;setState('sending');
  try{const result=await submit(draft);setState(result.state==='relay_received'?'received':'unknown');}
  catch{setState('unknown');}
 }
 return <section aria-labelledby="authoring-title">
  <h2 id="authoring-title">어떻게 바꾸고 싶나요?</h2>
  <p>요청을 보내면 컴퓨터에서 먼저 검토해요. 컴퓨터에서 보내기를 눌러야 AI 작업이 시작돼요.</p>
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
  {state==='received'&&<p role="status">중계 서비스가 요청을 받았어요. 컴퓨터의 검토와 AI 실행은 아직 확인하지 않았어요.</p>}
  {state==='unknown'&&<p role="status">전달 여부를 확인하지 못했어요. 적은 내용은 여기 남아 있어요. 중복 요청을 막기 위해 다시 보내지 않아요. 컴퓨터에서 확인해 주세요.</p>}
 </section>;
}
