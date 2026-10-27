import { finishModal } from './modalMotion';
import './modalSurface.css';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {WRITE_CHANGE_STEPS,WRITE_CHANGE_TEXT,writeChangeDetail,writeChangeSteps,writeChangeStepsLabel,writeChangeWarning,type WriteApprovalPrompt,type WriteChangeView} from '../../src/writeApprovalPrompt';
import {ChatIcon} from './ChatDetails';
import {useDialogFocus} from './dialogFocus';
import {imeComposing} from './imeGuard';
import {normalizeTextSize} from '../../src/textSize';
import './writeApprovalDialog.css';

/** Keep both filename ends; the complete safe name remains visible on focus and to AT. */
export function middleFileName(name:string):string {
  const chars=Array.from(name);
  return chars.length<=36 ? name : chars.slice(0,18).join('')+'…'+chars.slice(-17).join('');
}
const visible=(name:string)=>name.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
/**
 * REQ-STUDIO-WRITE-APPROVAL-CHANGE (CGP-ART-R-021): how much of one existing file the write changes, computed by the
 * host before the dialog opened. A rewrite and an unknown change carry a warning icon plus words (never colour only).
 */
function WriteChange({file,change,onDiff}:{file:string;change:WriteChangeView;onDiff?:()=>void}) {
  const warn=change.kind==='unknown' ? `${WRITE_CHANGE_TEXT.unknown} · ${WRITE_CHANGE_TEXT.reasons[change.reason]}` : writeChangeWarning(change);
  const steps=change.kind==='measured' ? writeChangeSteps(change) : 0;
  return <div className="hps-write-change" role="group" aria-label={`${file} ${WRITE_CHANGE_TEXT.heading}`} data-change={change.kind==='unknown'?'unknown':change.rewrite?'rewrite':'partial'}>
    <span className="hps-write-change-file">{middleFileName(file)}</span>
    {change.kind==='measured' && <>
      <span className="hps-write-change-amount">{WRITE_CHANGE_TEXT.heading}: {change.percent}</span>
      {/* CGP-ART-D-021 (DES-ART-21): four steps, named in words for assistive tech; the percentage stays visible beside it. */}
      <span className="hps-write-change-bar" role="img" aria-label={writeChangeStepsLabel(change)} data-steps={steps}>
        {Array.from({length:WRITE_CHANGE_STEPS},(_,i)=><span key={i} className="hps-write-change-step" data-filled={i<steps}/>)}
      </span>
      <span>{writeChangeDetail(change)}</span>
    </>}
    {warn && <span className="hps-write-change-warning"><ChatIcon kind="alert" size={16}/>{warn}</span>}
    {change.kind==='measured' && change.diff===true && onDiff && <button type="button" className="hps-write-change-diff" aria-label={`${file} ${WRITE_CHANGE_TEXT.showDiff}`} onClick={onDiff}>{WRITE_CHANGE_TEXT.showDiff}</button>}
  </div>;
}
export function WriteApprovalDialog({prompt,onAnswer,onDiff,textSize}:{prompt:WriteApprovalPrompt;onAnswer:(id:string,approved:boolean)=>void;onDiff?:(id:string,index:number)=>void;textSize?:unknown}) {
  const dialog=useRef<HTMLDialogElement>(null), answered=useRef(false), composing=useRef(false);
  const [expanded,setExpanded]=useState(false),[focused,setFocused]=useState<number|null>(null);
  const finish=(approved:boolean)=>{if(answered.current)return;answered.current=true;finishModal(dialog.current,()=>onAnswer(prompt.id,approved));};
  useDialogFocus(dialog,{open:true,kind:'modal',initialFocus:'[data-write-deny]'});
  useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLButtonElement>('[data-write-deny]')?.focus();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="hps-write-approval hp-modal" aria-labelledby="write-approval-title" style={{'--hp-font-caption':`calc(14px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(textSize)]}px)`} as CSSProperties}
    onCancel={e=>{e.preventDefault();if(!composing.current)finish(false);}}
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDownCapture={e=>{if(imeComposing(e,composing.current)){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}}}>
    <h2 id="write-approval-title">{visible(prompt.title)}</h2>
    <p>바꿀 파일 {prompt.files.length}개</p>
    <ul aria-label="바꿀 파일" id="write-approval-files" className="hps-write-files">
      {prompt.files.slice(0,expanded?prompt.files.length:5).map((name,index)=>{const safe=visible(name);return <li key={index}>
        <span className="hps-write-chip" tabIndex={0} aria-label={safe} data-hp-tooltip={safe} onFocus={()=>setFocused(index)} onBlur={()=>setFocused(null)}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6l4 4v10H3zM9 1v4h4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
          <span>{middleFileName(safe)}</span>
        </span>
        {focused===index && <span className="hps-write-full-name">{safe}</span>}
      </li>;})}
    </ul>
    {prompt.files.length>5 && <button type="button" aria-expanded={expanded} aria-controls="write-approval-files" className="hps-write-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'접기':`외 ${prompt.files.length-5}개`}</button>}
    {prompt.files.map((name,index)=>{const change=prompt.changes?.[index];return change ? <WriteChange key={`change-${index}`} file={visible(name)} change={change} onDiff={onDiff ? ()=>{if(!answered.current)onDiff(prompt.id,index);} : undefined}/> : null;})}
    <div className="hps-write-actions"><button type="button" data-write-deny onClick={()=>finish(false)}>거절</button><button type="button" onClick={()=>finish(true)}>{visible(prompt.verb)}</button></div>
  </dialog>;
}
