import type { ChatConfig } from '../../src/protocol';
import { postToHost } from './vscode';

export function ModelControl({ config, streaming }: { config: ChatConfig; streaming: boolean }) {
  return <>
        {config.profile?.model_selection && <div className="hps-model-selection">
          <label>모델 <select aria-label="대화 모델" value={config.model}
            disabled={config.profile.model_selection.choices.length === 1}
            onChange={e => postToHost({ type: 'selectModel', alias: e.target.value })}
            onKeyDown={e => {
              // Embedded Mac webviews can forward native select keys to the workbench.
              // Keep version navigation in this control, including without a native popup.
              if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
              const choices = config.profile?.model_selection?.choices ?? [];
              if (!choices.length) return;
              const current = choices.findIndex(c => c.alias === config.model);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
                : Math.max(0, Math.min(choices.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
              e.preventDefault(); e.stopPropagation();
              if (choices[next]) postToHost({ type: 'selectModel', alias: choices[next].alias });
            }}>

            {config.profile.model_selection.choices.map(c => <option key={c.id} value={c.alias}>{c.label}</option>)}
          </select></label>
          <small>{config.profile.model_selection.choices.length === 1
            ? (config.profile.model_selection.source === 'lesson' ? '이 수업에서 고정한 모델' : '사용 가능한 모델 1개')
            : streaming ? '변경하면 다음 요청부터 적용돼요' : '대화를 유지하며 모델을 바꿀 수 있어요'}</small>
        </div>}
  </>;
}
