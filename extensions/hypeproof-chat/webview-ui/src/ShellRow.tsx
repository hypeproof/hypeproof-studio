import type { ShellPresentation } from '../../src/shellPresentation';
import { ChatIcon, useConfirmedCopy } from './ChatDetails';
import { CopyFeedback } from './CopyFeedback';

export const SHELL_COPY_LABEL = '명령 복사';
export const SHELL_COPY_DONE_STATUS = '명령을 복사했습니다';
export const SHELL_COPY_FAILED_STATUS = '복사하지 못했습니다. 명령을 선택해 복사해 주세요.';

/**
 * REQ-CGP-AGENT-60 / CGP-AGENT-D-025 (DES-CGP-AGENT-60): a shell row is the purpose line, then a collapsible
 * monospace block with `$ command` and, only where the host knows it, the folder caption. The host collapses
 * the block on summary seats (`collapsed`); stored rows come back collapsed.
 */
export function ShellRow({ shell, state }: { shell: ShellPresentation; state: 'running' | 'done' | 'error' }) {
  return <div className={`hps-shell-row hps-tool-${state}`}>
    <p className="hps-shell-purpose">{shell.purpose}</p>
    <details open={!shell.collapsed}><summary>실행 명령 · {state === 'running' ? '처리 중' : state === 'error' ? '실패' : '완료'}</summary>
      <div className="hps-shell-block"><pre><code>{`$ ${shell.command}`}</code></pre><ShellCopy command={shell.command} /></div>
      {shell.folder !== undefined && <p className="hps-shell-folder">폴더: {shell.folder}</p>}
    </details>
  </div>;
}

/**
 * Copies the command exactly as the row shows it (without the `$ ` prompt): the display text is already
 * neutralised, with ` ⏎ ` marks and the `… (가운데 N자 생략) …` marker, so the clipboard never holds a
 * character the learner did not see. The host never sends the raw model input to the webview.
 * The button is always in the tab order; styles.css draws it while the row is hovered or holds focus.
 * Feedback goes through the shared copy outlet with the answer-copy lifetimes (CGP-DS-R-025).
 */
function ShellCopy({ command }: { command: string }) {
  const [state, copy] = useConfirmedCopy(command);
  return <>
    <button type="button" className="hps-shell-copy" data-copy-state={state} onClick={copy} aria-label={SHELL_COPY_LABEL} data-hp-tooltip={SHELL_COPY_LABEL}>
      <ChatIcon kind={state === 'copied' ? 'check' : 'copy'} size={16} />
    </button>
    <CopyFeedback failed={state === 'failed'}>{state !== 'idle' && <><ChatIcon kind={state === 'failed' ? 'alert' : 'check'} size={16} /><span>{state === 'copied' ? SHELL_COPY_DONE_STATUS : SHELL_COPY_FAILED_STATUS}</span></>}</CopyFeedback>
  </>;
}
