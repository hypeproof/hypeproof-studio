import type { RunningProcess } from '../../src/runningProcesses';
const labels = { running: '실행 중', stopping: '멈추는 중', unknown: '실행 상태 확인 불가', stopped: '멈췄어요', done: '끝남', error: '오류' };
export function RunningProcessesPanel({ entries, onStop }: { entries: RunningProcess[]; onStop: (id: string) => void }) {
  if (!entries.length) return null;
  return <section className="hps-running-processes" aria-label="실행 중인 것"><h2>실행 중인 것</h2><ul>{entries.map(e => <li key={e.id}>
    <div className="hps-process-text"><p className="hps-shell-purpose">{e.purpose}</p>{e.folder !== undefined && <p className="hps-shell-folder">폴더: {e.folder}</p>}</div>
    <div className="hps-process-actions"><span role="status">{labels[e.state]}</span>
    {(e.state === 'running' || e.state === 'stopping') && <button type="button" disabled={e.state === 'stopping'} onClick={() => onStop(e.id)}>{e.state === 'stopping' ? '멈추는 중' : '멈추기'}</button>}</div>
  </li>)}</ul></section>;
}
