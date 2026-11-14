import type { RunningProcess } from '../../src/runningProcesses';
const labels = { running: '실행 중', stopping: '멈추는 중', unknown: '실행 상태 확인 불가', stopped: '멈췄어요', done: '끝남', error: '오류' };
/**
 * The stop control keeps its own verb while the stop is on its way: a shell task 멈추기 → 멈추는 중
 * (CGP-AGENT-D-025, DES-CGP-AGENT-60), the preview server 끄기 → 끄는 중 (Jay 2026-10-29). The pending word
 * stays until the host reports the exit; a stop request alone never settles the entry.
 */
const stopWords = { shell: { stop: '멈추기', pending: '멈추는 중' }, preview: { stop: '끄기', pending: '끄는 중' } } as const;
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
export function RunningProcessesPanel({ entries, onStop, compact = false }: { entries: RunningProcess[]; onStop: (id: string) => void; compact?: boolean }) {
  if (!entries.length) return null;
  // `compact` (ux.coach_layout): one row per card, title · address · stop. The heading, the served-place
  // line, the "why it stays on" note and the state word stay in the DOM only where a screen reader needs them.
  return <section className="hps-running-processes" aria-labelledby="hps-running-processes-title" {...(compact ? { 'data-coach-layout': 'compact' } : {})}>
    <h2 id="hps-running-processes-title" className={compact ? 'hps-sr-only' : undefined}>실행 중인 것</h2>
    <ul>{entries.map(e => {
      const preview = e.kind === 'preview';
      const live = e.state === 'running' || e.state === 'stopping';
      const words = stopWords[preview ? 'preview' : 'shell'];
      // The one place a compact card names: a preview's address (else the folder it serves), or a shell's folder.
      const folderPlace = e.folder !== undefined ? place(e.folder) : undefined;
      const [whereLabel, where] = preview && e.address ? ['주소', e.address] : [preview ? '보여 주는 곳' : '폴더', folderPlace];
      return <li key={e.id} className="hps-process-card" data-state={e.state} data-kind={preview ? 'preview' : 'shell'}>
        <div className="hps-process-text">
          <p className="hps-process-title"><span className="hps-process-dot" aria-hidden="true" /><span className="hps-shell-purpose">{preview ? previewTitle[e.state] : e.purpose}</span></p>
          {compact
            ? where && <p className="hps-shell-folder hps-process-address"><span className="hps-sr-only">{whereLabel}: </span>{where}</p>
            : <>
              {e.folder !== undefined && <p className="hps-shell-folder">{preview ? '보여 주는 곳' : '폴더'}: {place(e.folder)}</p>}
              {preview && e.address && <p className="hps-shell-folder">주소: {e.address}</p>}
              {preview && live && <p className="hps-process-note">미리보기 창을 보는 동안 켜 두어요. 다 봤으면 꺼도 돼요.</p>}
            </>}
        </div>
        <div className="hps-process-actions"><span role="status" className={compact ? 'hps-process-state hps-sr-only' : 'hps-process-state'}>{e.state === 'stopping' ? words.pending : labels[e.state]}</span>
          {live && <button type="button" disabled={e.state === 'stopping'} onClick={() => onStop(e.id)}>
            {e.state === 'stopping' ? words.pending : words.stop}</button>}</div>
      </li>;
    })}</ul></section>;
}
