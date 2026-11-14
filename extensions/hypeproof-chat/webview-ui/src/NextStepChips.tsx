import { useId } from 'react';

/**
 * Compact coach layout (`ux.coach_layout`): the steps the coach itself offered in a trailing
 * "다음에 해볼 만한 것" block (nextStepsParser.ts), as a wrapping row of single-line pills under the
 * latest answer. A press hands the text to the same path as every other chip: it fills the composer
 * and never sends. Not ChipRack: that component and its `hps-chip*` classes stay as they are.
 */
export function NextStepChips({ steps, onPick }: { steps: string[]; onPick: (text: string) => void }) {
  const labelId = useId();
  return <div className="hps-next-steps" role="group" aria-labelledby={labelId}>
    <div id={labelId} className="hps-next-steps-label">다음에 해볼 만한 것</div>
    <div className="hps-next-steps-list">
      {steps.map((step, i) => <button key={i} type="button" className="hps-next-step" data-hp-tooltip="탭하면 입력창에 들어가요" onClick={() => onPick(step)}>
        {step}
      </button>)}
    </div>
  </div>;
}
