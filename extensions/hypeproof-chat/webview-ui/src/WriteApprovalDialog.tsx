import { finishModal } from './modalMotion';
import './modalSurface.css';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {WriteApprovalPrompt} from '../../src/writeApprovalPrompt';
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
export function WriteApprovalDialog({prompt,onAnswer,textSize}:{prompt:WriteApprovalPrompt;onAnswer:(id:string,approved:boolean)=>void;textSize?:unknown}) {
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
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6l4 4v10H3zM9 1v4h4" fill="none" stroke="currentColor"/></svg>
          <span>{middleFileName(safe)}</span>
        </span>
        {focused===index && <span className="hps-write-full-name">{safe}</span>}
      </li>;})}
    </ul>
    {prompt.files.length>5 && <button type="button" aria-expanded={expanded} aria-controls="write-approval-files" className="hps-write-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'접기':`외 ${prompt.files.length-5}개`}</button>}
    <div className="hps-write-actions"><button type="button" data-write-deny onClick={()=>finish(false)}>거절</button><button type="button" onClick={()=>finish(true)}>{visible(prompt.verb)}</button></div>
  </dialog>;
}
