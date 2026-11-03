import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {goalEditorOf,goalEditorOnView,goalEditorOnEdit,goalEditOf,goalSavedNoteShown,GOAL_CHANGED_ELSEWHERE,type GoalNote} from '../../src/studentGoal';
import {normalizeTextSize} from '../../src/textSize';
import {GoalEditor} from './StudentGoal';
import {IntentChip} from './StatusChip';
import {imeComposing} from './imeGuard';
import type { ChatConfig } from '../../src/protocol';
import { GOAL_STATUSES, type GoalSaveRequest, type StudentGoalView } from '../../src/studentGoal';
import './goalStatusBar.css';

/** Only a confirmed, selected class request ledger is a lesson budget. No estimate or personal balance. */
export function lessonBudget(config: ChatConfig): string {
  const access = config.access;
  const view = access?.view;
  const choice = view?.choices.find(item => item.id === access?.selected);
  if (access?.status !== 'ready' || !view?.configured || !Number.isFinite(Date.parse(view.as_of)) ||
      !choice || choice.active !== true || (choice.state === 'ready' && choice.available !== true) || !['cohort', 'organization'].includes(choice.source_kind) ||
      !['ready', 'exhausted'].includes(choice.state)) return '확인 안 됨';
  const meters = choice.resources.filter(item => item.meter === 'requests:count');
  const meter = meters.length === 1 ? meters[0] : undefined;
  if (!meter || !Number.isSafeInteger(meter.remaining) || meter.remaining < 0 || meter.unresolved !== 0) return '확인 안 됨';
  return `${meter.shared ? '함께 쓰는 ' : ''}${meter.remaining.toLocaleString('ko-KR')}회 · ${new Date(view.as_of).toLocaleString('ko-KR')} 확인`;
}


/** Only a valid denominator from the same selected ledger permits a percentage. */
export function lessonBudgetMeter(config:ChatConfig):{percent:number|null;label:string;detail:string}{
 const detail=lessonBudget(config),access=config.access;
 const choice=access?.view?.choices.find(c=>c.id===access.selected);
 const meter=choice?.resources.find(r=>r.meter==='requests:count');
 if(detail==='확인 안 됨'||!meter||!Number.isSafeInteger(meter.limit)||meter.limit<=0||meter.remaining>meter.limit||
    (choice?.state==='exhausted'&&meter.remaining!==0))return {percent:null,label:'확인 안 됨',detail};
 const percent=Math.floor(meter.remaining/meter.limit*100);
 return {percent,label:`남은 사용량 ${percent}%`,detail};
}

/** Goal changes are self-reports, not runtime controls or completion evidence. */
export function GoalStatusBar({config,view,pending,onSave,note=null}:{
 config:ChatConfig;view:StudentGoalView|null;pending:boolean;onSave:(request:GoalSaveRequest)=>void;note?:GoalNote;
}){
 const [open,setOpen]=useState(false),[editor,setEditor]=useState(()=>goalEditorOf(view));
 const composing=useRef(false),latest=useRef(view),scope=useRef('');latest.current=view;
 const currentScope=JSON.stringify([view?.activity,view?.lesson.sha256]);
 const own=!!note?.saved&&note.revision===view?.revision;
 useEffect(()=>{
  if(scope.current!==currentScope){scope.current=currentScope;composing.current=false;setOpen(false);setEditor(goalEditorOf(view));}
  else if(!composing.current)setEditor(s=>goalEditorOnView(s,view,own));
 },[currentScope,view?.revision,own]);
 if(!view)return null;
 const status=view.status??'active',label=GOAL_STATUSES[status]??GOAL_STATUSES.active;
 const budget=lessonBudgetMeter(config),showBudget=!config.activity?.free&&config.profile?.profile_id!=='studio-open-trial';
 const edit=goalEditOf(view,view.lesson.sha256,editor.fields,pending);
 return <section className="hps-goal-status" aria-label="내 목표 상태" style={{'--hp-font-caption':`calc(14px + ${{base:0,large:2,xlarge:4}[normalizeTextSize(config.textSize)]}px)`} as CSSProperties}>
  <button type="button" className="hps-goal-strip" aria-expanded={open} aria-label={`목표 보기·고치기: ${view.goal||'아직 적지 않았어요'} · ${label}`} onClick={()=>{if(!composing.current)setOpen(v=>!v);}}>
   <span className="hps-goal-strip-text"><bdi>{view.goal||'내 목표 적기'}</bdi></span>
   <IntentChip chip={{label,icon:status==='complete'?'check':status==='paused'?'stop':status==='budget_limit'?'ban':'pencil',intent:status==='budget_limit'?'caution':'info'}} status={status}/>
   {showBudget&&<span className="hps-goal-meter"><span>{budget.label}</span>{budget.percent!==null&&<meter min={0} max={100} value={budget.percent} aria-label={budget.label}/>}</span>}
  </button>
  {open&&<div className="hps-goal-expanded"
   onCompositionStart={()=>{composing.current=true;}}
   onCompositionEnd={e=>{const target=e.target as HTMLTextAreaElement;composing.current=false;const patch=target.name==='criteria'?{criteria:target.value}:{goal:target.value};setEditor(s=>goalEditorOnView(goalEditorOnEdit(s,patch),latest.current,own));}}
   onKeyDownCapture={e=>{if(imeComposing(e,composing.current))e.stopPropagation();}}
   onSubmitCapture={e=>{if(composing.current){e.preventDefault();e.stopPropagation();}}}>
   <p>내 목표 · <bdi>{view.goal||'아직 적지 않았어요'}</bdi></p>
   <p role="status">{label} · {view.status?'내가 표시한 상태':'상태를 직접 표시해 주세요'}</p>
   {showBudget&&<p>남은 수업 예산 · {budget.detail}</p>}
   <div role="group" aria-label="목표 상태 직접 표시">
    {Object.entries(GOAL_STATUSES).map(([status,label])=><button type="button" key={status} aria-pressed={(view.status??'active')===status} disabled={pending||!view.goal.trim()} onClick={()=>onSave({lesson:view.lesson.sha256,goal:view.goal,criteria:view.criteria,base:view.revision,status:status as keyof typeof GOAL_STATUSES})}>{label}</button>)}
   </div>
   <GoalEditor fields={editor.fields} edit={edit} onEdit={patch=>setEditor(s=>goalEditorOnEdit(s,patch))} onSave={onSave}/>
   {note?.error?<p role="alert">{note.error}</p>:editor.elsewhere&&!edit.unchanged?<p role="status">{GOAL_CHANGED_ELSEWHERE}</p>:goalSavedNoteShown(note,view,edit)?<p role="status">저장했어요.</p>:null}
   <p>상태 표시는 AI를 시작하거나 멈추지 않아요. AI에게 부탁하려면 메시지를 보내 주세요.</p>
  </div>}
 </section>;
}
