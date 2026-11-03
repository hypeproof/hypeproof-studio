import type { RunningProcess } from '../../src/runningProcesses';
const labels = { running: '실행 중', stopping: '끄는 중', unknown: '실행 상태 확인 불가', stopped: '멈췄어요', done: '끝남', error: '오류' };
// A preview server says what it is in its title; a background shell keeps its purpose as the title.
const previewTitle: Record<RunningProcess['state'], string> = {
  running: '미리보기 서버 실행 중', stopping: '미리보기 서버 끄는 중', unknown: '미리보기 서버 상태 확인 불가',
  stopped: '미리보기 서버를 껐어요', done: '미리보기 서버가 꺼졌어요', error: '미리보기 서버 오류',
};
/** "." never reaches the screen, whatever the host sent (Jay 2026-10-29: "폴더: ." told him nothing). */
const place = (folder: string) => folder === '.' ? '작업 폴더 전체' : folder;

/**
 * One card per running thing (Jay 2026-10-29: "줄 구분도 잘 안 되고"): a visible boundary, a status dot and
 * label, a plain title, what it serves and its address, and one 끄기/멈추기 button while it runs.
 */
export function RunningProcessesPanel({ entries, onStop }: { entries: RunningProcess[]; onStop: (id: string) => void }) {
  if (!entries.length) return null;
  return <section className="hps-running-processes" aria-labelledby="hps-running-processes-title">
    <h2 id="hps-running-processes-title">실행 중인 것</h2>
    <ul>{entries.map(e => {
      const preview = e.kind === 'preview';
      const live = e.state === 'running' || e.state === 'stopping';
      return <li key={e.id} className="hps-process-card" data-state={e.state} data-kind={preview ? 'preview' : 'shell'}>
        <div className="hps-process-text">
          <p className="hps-process-title"><span className="hps-process-dot" aria-hidden="true" /><span className="hps-shell-purpose">{preview ? previewTitle[e.state] : e.purpose}</span></p>
          {e.folder !== undefined && <p className="hps-shell-folder">{preview ? '보여 주는 곳' : '폴더'}: {place(e.folder)}</p>}
          {preview && e.address && <p className="hps-shell-folder">주소: {e.address}</p>}
          {preview && live && <p className="hps-process-note">미리보기 창을 보는 동안 켜 두어요. 다 봤으면 꺼도 돼요.</p>}
        </div>
        <div className="hps-process-actions"><span role="status" className="hps-process-state">{labels[e.state]}</span>
          {live && <button type="button" disabled={e.state === 'stopping'} onClick={() => onStop(e.id)}>
            {e.state === 'stopping' ? '끄는 중' : preview ? '끄기' : '멈추기'}</button>}</div>
      </li>;
    })}</ul></section>;
}
