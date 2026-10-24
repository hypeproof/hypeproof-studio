// REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — one card under the coach turn that built or changed pages
// in the work folder. Drawn only from what the host measured (pageCardHost.ts): up to 3 rows plus
// "외 N개", each with 열기 (Studio preview) and 폴더에서 보기 (revealFileInOS). The host re-checks every press.

import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { pageCardRows, PAGE_CARD_COPY, type PageCardView, type PageCardPage } from "../../src/pageCard";

export interface PageCardProps {
  view: PageCardView;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
}

function ResultThumbnail({page}:{page:PageCardPage}) {
  const thumbnail=page.presentation?.thumbnail;
  const [waiting,setWaiting]=useState(thumbnail?.state==='loading');
  const [broken,setBroken]=useState(false);
  const image=thumbnail?.state==='ready'?thumbnail.dataUrl:null;
  useEffect(()=>{setBroken(false)},[image]);
  useEffect(()=>{
    setWaiting(thumbnail?.state==='loading');
    if(thumbnail?.state!=='loading')return;
    const timer=setTimeout(()=>setWaiting(false),2000);
    return()=>clearTimeout(timer);
  },[thumbnail?.state,page.presentation?.versionId]);
  return <div className="hps-page-result-thumbnail" aria-label={waiting?'미리보기 준비 중':'페이지 미리보기'}>
    {image&&!broken?<img loading="lazy" src={image} alt="" onError={()=>setBroken(true)}/>
      :waiting?<span className="hps-page-result-shimmer" aria-hidden="true"/>
      :<span className="hps-page-result-icon" aria-label="페이지 이미지 없음">▤</span>}
  </div>;
}
const RESULT_STATUS={verified:[<ChatIcon kind="check" size={16}/>,'확인됨'],unchecked:['○','아직 확인 안 함'],previous:['↶','이전 판']} as const;

export function PageCard({ view, onOpen, onReveal }: PageCardProps) {
  const { rows, more } = pageCardRows(view);
  return (
    <div className="hps-page-card" role="group" aria-label={PAGE_CARD_COPY.title} data-testid="page-card">
      <p className="hps-page-card-title">{PAGE_CARD_COPY.title}</p>
      <ul>
        {rows.map((page) => (
          <li key={page.path} className="hps-page-card-row" data-kind={page.kind}>
            <ResultThumbnail page={page}/>
            <span className="hps-page-card-name">
              <code className="hps-page-result-title" title={page.presentation?.title??page.path}>{page.presentation?.title??page.path}</code>
              <span className="hps-page-card-kind">{page.kind === "added" ? PAGE_CARD_COPY.added : PAGE_CARD_COPY.changed}</span>
            </span>
            <div className="hps-page-result-meta">
              <span>{page.presentation?`판 ${page.presentation.versionId.replace(/^sha256:/,'').slice(0,8)}`:'판 확인 중'}</span>
              <span className="hps-page-result-badge"><span aria-hidden="true">{RESULT_STATUS[page.presentation?.status??'unchecked'][0]}</span> {RESULT_STATUS[page.presentation?.status??'unchecked'][1]}</span>
            </div>
            <span className="hps-page-card-actions">
              <button type="button" aria-label={`${page.path} ${PAGE_CARD_COPY.open}`} onClick={() => onOpen(page.path)}>{PAGE_CARD_COPY.open}</button>
              <button type="button" aria-label={`${page.path} ${PAGE_CARD_COPY.reveal}`} onClick={() => onReveal(page.path)}>{PAGE_CARD_COPY.reveal}</button>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="hps-page-card-more">{PAGE_CARD_COPY.more(more)}</p>}
      {view.notice && <p className="hps-page-card-notice" role="status">{view.notice}</p>}
    </div>
  );
}
