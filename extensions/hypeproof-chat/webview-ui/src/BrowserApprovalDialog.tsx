import {useEffect,useRef,type CSSProperties} from 'react';
import type {BrowserApprovalPrompt,BrowserApprovalChoice} from '../../src/browserApprovalPrompt';
import {normalizeTextSize} from '../../src/textSize';
import {useDialogFocus} from './dialogFocus';
import {imeComposing} from './imeGuard';
import {finishModal} from './modalMotion';
import './modalSurface.css';
import './writeApprovalDialog.css';
export function BrowserApprovalDialog({prompt,onAnswer,textSize}:{prompt:BrowserApprovalPrompt;onAnswer:(id:string,choice:BrowserApprovalChoice)=>void;textSize?:unknown}) {
  const dialog=useRef<HTMLDialogElement>(null),answered=useRef(false),composing=useRef(false);
  const finish=(choice:BrowserApprovalChoice)=>{if(answered.current)return;answered.current=true;finishModal(dialog.current,()=>onAnswer(prompt.id,choice));};
  useDialogFocus(dialog,{open:true,kind:'modal',initialFocus:'[data-browser-deny]'});
  useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLButtonElement>('[data-browser-deny]')?.focus();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="hps-write-approval hps-browser-approval hp-modal" aria-labelledby="browser-approval-title" style={{'--hp-font-caption':`calc(14px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(textSize)]}px)`} as CSSProperties}
    onCancel={e=>{e.preventDefault();if(!composing.current)finish('deny');}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDownCapture={e=>{if(imeComposing(e,composing.current)){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish('deny');}}}>
    <h2 id="browser-approval-title">{prompt.title}</h2>
    <strong className="hps-browser-host" dir="ltr">{prompt.host}</strong>
    <p><span className="hps-browser-badge" data-place={prompt.place}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d={prompt.place==='preview'?'M1 2h14v10H1zM5 15h6M8 12v3':prompt.place==='file'?'M3 1h6l4 4v10H3zM9 1v4h4':prompt.place==='blank'?'M2 2h12v12H2z':'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1M1 8h14M8 1c-4 4-4 10 0 14M8 1c4 4 4 10 0 14'} fill="none" stroke="currentColor"/></svg>
      {prompt.label}</span></p>
    <div className="hps-write-actions"><button type="button" data-browser-deny onClick={()=>finish('deny')}>거절</button><button type="button" data-browser-open onClick={()=>finish('open')}>열기</button>
      {prompt.rememberLabel && <button type="button" data-browser-remember onClick={()=>finish('remember')}>{prompt.rememberLabel}</button>}</div>
  </dialog>;
}
