import { useEffect, useRef, useState } from 'react';
import { approvalCanDecide, approvalStatus, type ApprovalView } from '../../src/memberApproval';
import type { StartRequest } from '../../src/startPageProtocol';
import './memberApproval.css';
import './modalSurface.css';
export function MemberApprovalInbox({view,post,close}:{view?:ApprovalView;post:(message:StartRequest)=>void;close:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [now,setNow]=useState(Date.now()/1000);
  useEffect(()=>{dialog.current?.showModal();const timer=setInterval(()=>setNow(Date.now()/1000),1000);return()=>clearInterval(timer)},[]);
  const messages:Record<string,string>={signedOut:'로그인하면 내 확인 요청을 볼 수 있어요.',loading:'확인 요청을 불러오고 있어요.',not_enrolled:'아직 승인 담당자로 등록되지 않았어요.',unavailable:'지금은 확인 요청함을 이용할 수 없어요.',error:'요청함을 확인하지 못했어요. 다시 확인해 주세요.'};
  return <dialog className="member-approval hp-modal" ref={dialog} aria-labelledby="approval-title" onCancel={close}>
    <header><h2 id="approval-title">확인 요청</h2><button onClick={close} aria-label="확인 요청 닫기">닫기</button></header>
    <p>내 판단이 필요한 변경만 확인해요. 선택을 보낸 뒤 실제 반영 결과까지 확인할 수 있어요.</p>
    <button disabled={view?.busy} onClick={()=>post({type:'memberApprovalRefresh'})}>새로고침</button>
    <p role="status">{view?.message ?? messages[view?.status ?? 'loading'] ?? (!view?.cards.length?'지금 확인할 요청이 없어요.':'')}</p>
    {view?.cards.map(card=>{const allowed=view.status==='ready'&&!view.busy&&!view.pending.some(p=>p.cardID===card.id)&&approvalCanDecide(card,now);return <article key={card.id} aria-label={`${card.source.repo} #${card.source.pr} 확인 요청`}>
      <h3>{card.source.repo} #{card.source.pr}</h3><p>이 변경의 검토 담당자로 지정되어 확인을 요청했어요.</p>
      <p className="approval-status" role="status">{approvalStatus(card)}</p>
      <p>정확한 버전 <code>{card.source.head}</code></p>
      <details><summary>변경 설명과 검증 근거</summary><h4>작성자가 설명한 변경</h4><ul>{card.brief.authored.map((text,i)=><li key={i}>{text}</li>)}</ul><h4>검증된 근거</h4><ul>{card.brief.verified.map((text,i)=><li key={i}>{text}</li>)}</ul><p>기준: {card.source.base}</p><p>검토자: {card.reviewer}</p></details>
      {!allowed&&!card.decision&&!card.review&&<p>지금 이 요청에 답할 수 없어요. 새로고침해 최신 요청을 확인해 주세요.</p>}
      <div className="approval-actions">{([['approve','승인'],['reject','보류'],['question','설명 요청']] as const).map(([choice,label])=><button key={choice} disabled={!allowed} onClick={()=>post({type:'memberApprovalDecision',id:card.id,requestDigest:card.request_digest,choice})}>{label}</button>)}</div>
      {card.review&&<a href={card.review.html_url} target="_blank" rel="noreferrer">GitHub에 반영된 승인 보기</a>}
    </article>})}
  </dialog>;
}
