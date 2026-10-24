import {useEffect,useRef,type CSSProperties} from 'react';
import {commandApprovalPurposeText,type CommandApprovalPrompt,type CommandApprovalChoice} from '../../src/commandApprovalPrompt';
import {TASK_COMMAND_ALLOW_LABEL} from '../../src/taskCommandAllow';
import {normalizeTextSize} from '../../src/textSize';
import {useDialogFocus} from './dialogFocus';
import {imeComposing} from './imeGuard';
import {finishModal} from './modalMotion';
import './modalSurface.css';
import './writeApprovalDialog.css';
const visible = (value:string) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,ch=>`\\u${ch.charCodeAt(0).toString(16).padStart(4,'0')}`);
export function CommandApprovalDialog({prompt,onAnswer,textSize}:{prompt:CommandApprovalPrompt;onAnswer:(id:string,choice:CommandApprovalChoice)=>void;textSize?:unknown}) {
  const dialog=useRef<HTMLDialogElement>(null),answered=useRef(false),composing=useRef(false);
  const initial=prompt.destructive?'[data-command-deny]':'[data-command-allow]';
  const finish=(choice:CommandApprovalChoice)=>{if(answered.current)return;answered.current=true;finishModal(dialog.current,()=>onAnswer(prompt.id,choice));};
  useDialogFocus(dialog,{open:true,kind:'modal',initialFocus:initial});
  useEffect(()=>{const node=dialog.current;node?.showModal();node?.querySelector<HTMLButtonElement>(initial)?.focus();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="hps-write-approval hps-command-approval hp-modal" data-destructive={prompt.destructive} aria-labelledby="command-approval-purpose" style={{'--hp-font-caption':`calc(14px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(textSize)]}px)`,'--hp-font-body':`calc(16px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(textSize)]}px)`} as CSSProperties}
    onCancel={e=>{e.preventDefault();if(!composing.current)finish('deny');}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
    onKeyDownCapture={e=>{if(imeComposing(e,composing.current)){e.stopPropagation();return;}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish('deny');}}}>
    <h2 id="command-approval-purpose">{commandApprovalPurposeText(prompt.purpose)}</h2>
    <pre className="hps-command-code" tabIndex={0} aria-label="실행할 명령"><code>{'$ '+visible(prompt.command)}</code></pre>
    {prompt.destructive && <p className="hps-command-warning">되돌릴 수 없어요</p>}
    <div className="hps-write-actions"><button type="button" data-command-deny onClick={()=>finish('deny')}>거절</button><button type="button" data-command-allow onClick={()=>finish('allow')}>허락</button>
      {!prompt.destructive && prompt.rememberAllowed && <button type="button" onClick={()=>finish('remember')}>{TASK_COMMAND_ALLOW_LABEL}</button>}</div>
  </dialog>;
}
