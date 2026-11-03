import './coachRunState.css';
import { COACH_RUN_STATES, deriveCoachRunState, type CoachRunInputs } from '../../src/coachRunState';
import { ChatIcon } from './ChatDetails';

/**
 * REQ-STUDIO-COACH-RUN-STATE (CGP-LEARN-R-016 / CGP-LEARN-D-016): exactly one run state in the chat
 * header. The element stays mounted so its polite live region announces each change of state; the
 * label text changes only when the derived state does, never on a timer.
 */
export function CoachRunState(props: CoachRunInputs) {
  const state = deriveCoachRunState(props);
  const { label, icon } = COACH_RUN_STATES[state];
  return <span className="hps-run-state" data-run-state={state} role="status" aria-live="polite" aria-atomic="true">
    <ChatIcon kind={icon} size={20} />
    <span className="hps-run-state-label">{label}</span>
  </span>;
}
