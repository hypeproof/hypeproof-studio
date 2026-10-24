import {useEffect, useRef} from 'react';
import type {AnnotationLeavePrompt} from '../../src/annotationLeavePrompt';
import {useDialogFocus} from './dialogFocus';
import {imeComposing} from './imeGuard';
import {finishModal} from './modalMotion';
import './modalSurface.css';
export function AnnotationLeaveDialog({prompt,onAnswer}:{prompt:AnnotationLeavePrompt;onAnswer:(id:string,discard:boolean)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null), answered=useRef(false), composing=useRef(false);
  const finish=(discard:boolean)=>{if(answered.current)return;answered.current=true;finishModal(dialog.current,()=>onAnswer(prompt.id,discard));};
  useDialogFocus(dialog,{open:true,kind:'modal',initialFocus:'[data-annotation-keep]',keepFocusOnDismiss:true,onDismiss:()=>finish(false)});
  useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLButtonElement>('[data-annotation-keep]')?.focus();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="hps-annotation-leave hp-modal" aria-labelledby="annotation-leave-title"
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDownCapture={e=>{if(imeComposing(e,composing.current)){e.preventDefault();e.stopPropagation();}}}
    onCancel={e=>{e.preventDefault();if(!composing.current)finish(false);}}>
    <h2 id="annotation-leave-title">보내지 않은 표시가 {prompt.count}개 있어요</h2>
    <div className="hps-annotation-leave-actions">
      <button type="button" data-annotation-keep onClick={()=>finish(false)}>계속 고치기</button>
      <button type="button" onClick={()=>finish(true)}>버리기</button>
    </div>
  </dialog>;
}
