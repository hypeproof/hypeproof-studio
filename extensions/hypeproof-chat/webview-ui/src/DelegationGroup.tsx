import {normalizeTextSize} from '../../src/textSize';
import {useEffect,useId,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {ChatMessage} from '../../src/protocol';
import type {DelegationView} from '../../src/delegationRow';
import {DelegationRow} from './DelegationRow';
import {useDialogFocus} from './dialogFocus';
import {imeComposing} from './imeGuard';
import {finishModal} from './modalMotion';
import './modalSurface.css';

export function DelegationGroup({views,renderChild,onStopAll,stopState,textSize}:{textSize?:unknown;views:DelegationView[];renderChild:(m:ChatMessage)=>ReactNode;onStopAll:()=>void;stopState?:import("../../src/delegationStop").DelegationStopState}) {
 const [open,setOpen]=useState(false),[stopping,setStopping]=useState(false),stopSent=useRef(false);
 const summary=`도우미 ${views.length}명 · ${views.filter(v=>v.status==='done').length}명 끝남`;
 const active=views.some(v=>v.status==='running');
 const stopLabel=stopState==='confirmed'?'멈춤 확인':stopState==='unconfirmed'?'멈춤 확인 안 됨':stopping||stopState==='pending'?'멈추는 중…':'모두 멈추기';
 return <section className="hps-delegation-group" style={{"--hp-font-caption":`calc(14px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(textSize)]}px)`} as CSSProperties}>
  <button type="button" className="hps-delegation-toggle" aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(true)}>{summary}</button>
  {open&&<DelegationPanel summary={summary} onClose={()=>setOpen(false)}>
   {views.map(view=><DelegationRow key={view.id} view={view} renderChild={renderChild}/>)}
   {(active||stopping||stopState)&&<button type="button" className="hps-delegation-stop" disabled={stopping||!!stopState} onClick={()=>{if(stopSent.current||stopState)return;stopSent.current=true;setStopping(true);onStopAll();}}>{stopLabel}</button>}
  </DelegationPanel>}
 </section>;
}
function DelegationPanel({summary,children,onClose}:{summary:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),composing=useRef(false),closing=useRef(false),id=useId();
 const close=()=>{if(closing.current)return;closing.current=true;finishModal(ref.current,onClose);};
 useDialogFocus(ref,{open:true,kind:'modal',initialFocus:'[data-delegation-close]'});
 useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
 return <dialog ref={ref} className="hps-delegation-panel hp-modal" aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!composing.current)close();}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDownCapture={e=>{if(imeComposing(e,composing.current)){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
  <header><h2 id={id}>{summary}</h2><button type="button" data-delegation-close onClick={close}>닫기</button></header>
  {children}
 </dialog>;
}
