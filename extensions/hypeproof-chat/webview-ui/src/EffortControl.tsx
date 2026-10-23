import { useId } from 'react';
import { ChatIcon } from './ChatDetails';
import type { ChatConfig, CourseEffort, EffortRequestRecord, ResolvedProfile, WebviewMessage } from '../../src/protocol';

const labels: Record<CourseEffort,string> = {low:'Low',medium:'Medium',high:'High'};
/** Personal chat: the same levels in the learner's language (Jay 2026-10-19: "Effort" in a Korean UI). */
export const PERSONAL_EFFORT_LABEL = '생각 깊이';
const personalLabels: Record<CourseEffort,string> = {low:'가볍게',medium:'보통',high:'깊게'};

// ADR 0011 (orchestrator spec §5.2, AE-27) — on an orchestrator seat the Service records which
// agent sent each request, and each row names it before the model: `검토 도우미 · Claude Haiku
// 5.5: 요청 수업 기본값 → 적용 Low`. Claude Code's own background calls read `보조 작업`. Quiet by
// default: the rows live behind the closed details. A row without an agent (an older Service, or a
// seat without the orchestrator) reads exactly as before.
export const AUX_REQUEST_LABEL = '보조 작업';
const AGENT_LABEL_MAX = 40;

function oneLabel(value: string): string {
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > AGENT_LABEL_MAX ? t.slice(0, AGENT_LABEL_MAX) : t;
}

function servedAgents(profile: ResolvedProfile | null | undefined) {
  const served = profile?.orchestrator;
  return served && 'agents' in served && Array.isArray(served.agents) ? served.agents : [];
}

/** S4's own values: an `x-hps-agent` it could not read, and a request class the orchestrator never sends. */
export const UNKNOWN_AGENT_LABEL = '담당 미확인';
export const ANOMALY_AGENT_LABEL = '예상 밖 요청';

/**
 * Who sent the request: the Service's title, else the roster's, else the wire name ('' when not
 * recorded). `coach`, `aux`, `unknown` and `anomaly:<class>` are worded here when no title came.
 */
export function requestAgentLabel(r: EffortRequestRecord, profile: ResolvedProfile | null | undefined): string {
  if (r.request_class === 'auxiliary' || r.agent === 'aux') return AUX_REQUEST_LABEL;
  if (typeof r.agent_title === 'string' && r.agent_title.trim()) return oneLabel(r.agent_title);
  if (typeof r.agent !== 'string' || !r.agent.trim()) return '';
  if (r.agent === 'unknown') return UNKNOWN_AGENT_LABEL;
  if (r.agent.startsWith('anomaly:')) return ANOMALY_AGENT_LABEL;
  const served = servedAgents(profile).find(a => a.name === r.agent);
  return oneLabel(served?.title || (r.agent === 'coach' ? '코치' : r.agent));
}

/** The model as the learner's menu names it (as before), else as the served roster does, else its id. */
export function requestModelLabel(r: EffortRequestRecord, profile: ResolvedProfile | null | undefined): string {
  return profile?.model_selection?.choices.find(c=>c.id===r.model)?.label
    ?? servedAgents(profile).find(a => a.model?.id === r.model)?.model?.label
    ?? r.model;
}

export function EffortControl({config,post,personal=false}:{config:ChatConfig;post:(m:WebviewMessage)=>void;personal?:boolean}) {
  const reasonId = useId();
  const locked = config.cohortSettings?.effort === true;
  const policy = config.effort;
  const result = config.effortResult;
  const shown = personal ? personalLabels : labels;
  return <div className="hps-effort">
    {policy && <label>{personal ? `${PERSONAL_EFFORT_LABEL} ` : 'Effort '}<select aria-label={personal ? PERSONAL_EFFORT_LABEL : 'Effort'} value={policy.value} disabled={locked || policy.allowed.length===1}
      aria-disabled={locked || undefined} aria-describedby={locked ? reasonId : undefined}
      onChange={e=>post({type:'selectEffort',value:e.target.value as CourseEffort})}
      onKeyDown={e=>{
        if(e.altKey||e.ctrlKey||e.metaKey||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
        const current=policy.allowed.indexOf(policy.value);
        const next=e.key==='Home'?0:e.key==='End'?policy.allowed.length-1:Math.max(0,Math.min(policy.allowed.length-1,current+(e.key==='ArrowDown'?1:-1)));
        e.preventDefault();e.stopPropagation();post({type:'selectEffort',value:policy.allowed[next]});
      }}>{policy.allowed.map(v=><option key={v} value={v}>{shown[v]}</option>)}</select></label>}
    {policy && locked && <small id={reasonId} className="hps-managed-reason"><ChatIcon kind="lock" size={20} /> 선생님이 정한 설정이에요</small>}
    {config.effortNotice && <small role="status">{config.effortNotice}</small>}
    {(policy||result) && <details><summary>{personal ? '적용 기록' : 'Effort 설정 확인'}</summary>
      {policy && <p>{policy.allowed.length===1?'강사가 정한 처리 수준입니다.':'수업에서 허용한 범위 안에서 다음 요청부터 바뀝니다.'} 모델마다 속도와 사용량이 다릅니다.</p>}
      {result?.state==='loading' && <p>이번 요청의 적용 기록을 확인 중입니다.</p>}
      {result?.state==='unknown' && <p>적용 기록 미확인 — 기록이 늦거나 연결되지 않았을 수 있습니다.</p>}
      {result?.state==='observed' && <>
        <p>서버에서 확인된 요청별 전송 설정입니다. 응답 내용의 정확성을 뜻하지 않습니다.</p>
        <ul>{result.requests.map(r=>{
          const who=requestAgentLabel(r,config.profile);
          // no_receipt: no effort was recorded for this request, so no level is claimed either way.
          // unknown: a reason this build cannot word; only that part is marked.
          return <li key={r.request_id} data-agent={who?r.agent||undefined:undefined}>
            {who?`${who} · `:null}{requestModelLabel(r,config.profile)}: {r.reason==='no_receipt'?'처리 수준 기록 없음':<>요청 {r.requested?shown[r.requested]:'수업 기본값'} → 적용 {r.applied?shown[r.applied]:'처리 수준 미지원'}</>}
            {r.reason==='course_default'?' · 수업 기본값':''}{r.reason==='unknown'?' · 적용 이유 미확인':''}{r.status>=400?' · 요청 실패':''}
          </li>;
        })}</ul>
        {result.truncated && <p>처음 100개 요청만 표시합니다.</p>}
      </>}
      {result && <button type="button" onClick={()=>post({type:'refreshEffort'})}>적용 기록 다시 확인</button>}
    </details>}
  </div>;
}
